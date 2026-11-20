"""Find each company's job board automatically -> data/discovery.json, and with --apply into data/companies.json.

    python3 scripts/detect.py            # untracked companies only, report
    python3 scripts/detect.py --apply    # also write confident matches into data/companies.json
    python3 scripts/detect.py --all      # re-check tracked companies too
    python3 scripts/detect.py --deep     # also guess "<name>careers", "carreiras<name>"... slugs (many more probes)

Two kinds of evidence:
  site  - the company's own website (home + careers pages) links to the board. Trusted.
  guess - a slug guessed from the name/domain answers on some ATS. Kept only when most jobs are in LatAm,
          since short slugs often belong to an unrelated company.
"""
import json
import pathlib
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ats  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
CAREER = re.compile(r"career|carreira|carrera|vagas|/jobs|empleo|trabaj|trabalhe|work-with|join|talent|unete|faca-parte", re.I)
GUESS_PATHS = ("careers", "carreiras", "jobs", "vagas", "trabaja-con-nosotros", "trabalhe-conosco", "empleos", "work-with-us")

# Board URL patterns -> (ats, slug). Order matters: the first match on a URL wins.
PATTERNS = [
    ("greenhouse", r"(?:boards|job-boards)(?:-api)?\.greenhouse\.io/(?:v1/boards/|embed/job_board(?:/js)?\?for=)?([\w-]+)"),
    ("lever", r"jobs\.lever\.co/([\w-]+)"),
    ("ashby", r"jobs\.ashbyhq\.com/([\w.-]+)"),
    ("workable", r"apply\.workable\.com/([\w-]+)"),
    ("smartrecruiters", r"(?:jobs|careers)\.smartrecruiters\.com/([\w-]+)"),
    ("recruitee", r"//([\w-]+)\.recruitee\.com"),
    ("breezy", r"//([\w-]+)\.breezy\.hr"),
    ("gupy", r"//([\w-]+)\.gupy\.io"),
    ("teamtailor", r"//([\w-]+(?:\.na|\.eu)?)\.teamtailor\.com"),
    ("teamtailor", r"teamtailor\.com/\?[^\"'\s]*utm_content=([\w.-]+)"),  # "powered by" link on a custom domain
    ("inhire", r"//([\w-]+)\.inhire\.app"),
    ("bamboohr", r"//([\w-]+)\.bamboohr\.com"),
    ("workday", r"//([\w-]+\.wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}(?:-[A-Z]{2})?/)?([\w-]+)"),
    ("getonbrd", r"getonbrd\.com/companies/([\w-]+)"),
    ("hiringroom", r"//([\w-]+)\.hiringroom\.com"),
    ("buk", r"//([\w-]+\.buk\.(?:cl|co|mx|pe))"),
    ("peopleforce", r"//([\w-]+)\.peopleforce\.io"),
    ("yc", r"ycombinator\.com/companies/([\w-]+)/jobs"),
]
NOT_SLUGS = {"www", "api", "app", "files", "static", "staticfe", "careers-analytics", "info", "academy", "conteudos",
             "candidatos", "portal", "boards", "embed", "js", "company", "jobs", "v1", "assets", "cdn", "help", "blog"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.geturl(), r.read(3_000_000).decode("utf-8", "replace")


def boards_in(text):
    out = set()
    text = text.replace("\\/", "/").replace("&amp;", "&")
    for a, pat in PATTERNS:
        for m in re.finditer(pat, text, re.I):
            slug = "/".join(m.groups())
            if a == "teamtailor" and "utm_content" in pat:
                slug = slug.split("&")[0]
            if a == "buk" and slug.lower().startswith(("buk.", "www.")):
                continue  # Buk's own job board, linked from "powered by Buk" footers
            if slug.split("/")[0].lower() not in NOT_SLUGS:
                out.add((a, slug))
    return out


SUBDOMAINS = ("careers", "jobs", "carreiras", "vagas", "trabajos", "trabajaconnosotros", "empleos", "talento", "talent", "work", "join")


def scripts_of(url, html):
    """JS bundles a page loads: SPA careers pages often only name their ATS (slug, API host) inside them."""
    out = []
    for src in re.findall(r'<script[^>]+src=["\']([^"\']+\.js[^"\']*)', html, re.I):
        u = urllib.parse.urljoin(url, src)
        if not re.search(r"googletagmanager|gtag|analytics|hotjar|facebook|clarity|intercom|hubspot|recaptcha|cookie|onetrust|segment", u, re.I):
            out.append(u)
    return out[:8]


def sitemap_links(final):
    """Careers-looking URLs listed in the site's sitemap(s)."""
    out = []
    root = urllib.parse.urljoin(final, "/")
    maps = [root + "sitemap.xml", root + "sitemap_index.xml"]
    try:
        maps += re.findall(r"(?im)^sitemap:\s*(\S+)", get(root + "robots.txt")[1])
    except Exception:
        pass
    for sm in maps[:4]:
        try:
            xml = get(sm)[1]
        except Exception:
            continue
        locs = re.findall(r"<loc>\s*([^<\s]+)", xml)
        subs = [u for u in locs if u.endswith(".xml")]
        for u in subs[:3]:
            try:
                locs += re.findall(r"<loc>\s*([^<\s]+)", get(u)[1])
            except Exception:
                pass
        out += [u for u in locs if CAREER.search(u) and not u.endswith(".xml")]
    return out[:20]


def crawl(c):
    """Home page, careers links, sitemap entries, careers subdomains and common paths; scans each page's HTML,
    final URL (redirects onto a board) and JS bundles for board URLs. Pages that carry schema.org JobPosting
    (or link to such pages) become "jsonld" boards."""
    found = set()
    site = c["website"].strip("/")
    try:
        final, home = get("https://" + site + "/")
    except Exception:
        try:
            final, home = get("https://www." + site + "/")
        except Exception:
            return found
    found |= boards_in(final + " " + home)
    links = []
    for href in re.findall(r'href=["\']([^"\'#]+)["\']', home):
        u = urllib.parse.urljoin(final, href)
        if CAREER.search(u) and u.startswith("http") and u not in links:
            links.append(u)
    links += sitemap_links(final)
    bare = urllib.parse.urlparse(final).netloc.removeprefix("www.")
    links += [f"https://{sub}.{bare}/" for sub in SUBDOMAINS]
    links += [urllib.parse.urljoin(final, "/" + p) for p in GUESS_PATHS]
    seen, bundles = set(), []
    for u in links[:40]:
        if u in seen:
            continue
        seen.add(u)
        try:
            f2, h2 = get(u)
        except Exception:
            continue
        b = boards_in(f2 + " " + h2)
        found |= b
        if not b and CAREER.search(f2):
            if "linkedin.com" in f2 or "linkedin.com" in u:
                continue
            if ats._jobpostings(h2) or len({m for m in re.findall(r'href=["\']([^"\'#?]+)', h2) if ats.JOB_LINK.search(m)}) >= 3:
                found.add(("jsonld", f2))
            bundles += [s for s in scripts_of(f2, h2) if s not in bundles]
    bundles += [s for s in scripts_of(final, home) if s not in bundles]
    for js in bundles[:12]:
        try:
            found |= boards_in(get(js)[1])
        except Exception:
            pass
    return found


def slug_guesses(c):
    norm = lambda s: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    name = norm(c["name"])
    stem = norm(c["website"]).split("/")[0].removeprefix("www.").split(".")[0]
    base = {c["id"], c["id"].replace("-", ""), re.sub(r"[^a-z0-9]", "", name), re.sub(r"[^a-z0-9]+", "-", name).strip("-"), stem}
    # Boards are often named "<name>careers", "carreiras<name>", "<name>-jobs", "<name>hq", "<name>app"...
    g = set(base)
    for b in list(base) if "--deep" in sys.argv else []:
        g |= {f"{b}careers", f"carreiras{b}", f"{b}jobs", f"{b}hq"}
    return {s for s in g if len(s) >= 3}


# The "<name>careers"-style variants only show up on these; the rest are probed with the plain names.
VARIANT_ATS = {"gupy", "inhire", "teamtailor", "greenhouse", "lever", "ashby"}


def is_variant(slug, c):
    return slug.endswith(("careers", "jobs", "hq")) or slug.startswith("carreiras")


# Workday/jsonld need a full URL, never guessable; Workable rate-limits bulk probing, so it's only used when linked.
# YC rate-limits too; its companies are checked under their own directory slug instead (listed_url).
GUESS_ATS = [a for a in ats.ATS if a not in ("workday", "jsonld", "workable", "yc")]


COUNTRY_WORDS = {
    "Brazil": ["brazil", "brasil", "são paulo", "sao paulo", ", sp", "rio de janeiro", "curitiba", "belo horizonte"],
    "Mexico": ["mexico", "méxico", "cdmx", "guadalajara", "monterrey"],
    "Colombia": ["colombia", "bogot", "medell"], "Argentina": ["argentina", "buenos aires"],
    "Chile": ["chile", "santiago"], "Peru": ["peru", "perú", "lima"], "Uruguay": ["uruguay", "montevideo"],
    "Ecuador": ["ecuador", "quito", "guayaquil"], "El Salvador": ["el salvador", "san salvador"],
    "Bolivia": ["bolivia", "la paz", "santa cruz", "cochabamba"], "Paraguay": ["paraguay", "asunci"],
    "Venezuela": ["venezuela", "caracas"], "Costa Rica": ["costa rica", "san jos"], "Panama": ["panam"],
    "Guatemala": ["guatemala"], "Honduras": ["honduras"], "Dominican Republic": ["dominican", "santo domingo"],
}


def check(task):
    cid, a, slug, evidence, country = task
    try:
        jobs = ats.fetch(a, slug)
    except Exception:
        return None
    if not jobs and evidence == "guess":
        return None
    if a == "buk" and jobs:  # a bare guess tried every country: keep the host that answered
        slug = urllib.parse.urlparse(jobs[0]["url"]).netloc
    latam = sum(ats.is_latam(j["location"]) for j in jobs)
    home = sum(any(w in (j["location"] or "").lower() for w in COUNTRY_WORDS.get(country, [])) for j in jobs)
    return {"id": cid, "ats": a, "slug": slug, "evidence": evidence, "jobs": len(jobs),
            "latam_share": round(latam / len(jobs), 2) if jobs else None,
            "home_share": round(home / len(jobs), 2) if jobs else None,
            "sample": sorted({j["location"] for j in jobs if j["location"]})[:5]}


def best(hits):
    """Site evidence beats guesses; among those, most LatAm jobs wins.
    A linked board with few LatAm jobs (<15%) is usually a parent company's (Pismo -> Visa), so it is skipped.
    A guessed board must be mostly LatAm and have jobs in the company's own country."""
    ok = [h for h in hits if (h["evidence"] == "site" and (h["latam_share"] is None or h["latam_share"] >= 0.15)
                              and not (h["ats"] in ("jsonld", "yc") and not h["jobs"]))
          or ((h["latam_share"] or 0) >= 0.5 and (h["home_share"] or 0) >= 0.3)]
    ok.sort(key=lambda h: (h["evidence"] != "site", -(h["jobs"] * (h["latam_share"] or 0.0)), -h["jobs"]))
    return ok[0] if ok else None


def main():
    companies = json.loads((ROOT / "data/companies.json").read_text())
    cities = json.loads((ROOT / "data/cities.json").read_text())
    todo = [c for c in companies if "--all" in sys.argv or not c["ats"]]
    ats.DETAILS = False  # board size and locations are enough to decide; skip per-job detail calls
    with ThreadPoolExecutor(20) as ex:
        site = dict(zip([c["id"] for c in todo], ex.map(crawl, todo)))
    tasks = set()
    for c in todo:
        k = cities[c["city"]]["country"]
        tasks |= {(c["id"], a, s, "site", k) for a, s in site[c["id"]]}
        if c.get("listed_by") == "yc" and c.get("listed_url"):
            tasks.add((c["id"], "yc", c["listed_url"].rstrip("/").split("/")[-1], "site", k))
        tasks |= {(c["id"], a, s, "guess", k) for s in slug_guesses(c) for a in GUESS_ATS
                  if (a, s) not in site[c["id"]] and (a in VARIANT_ATS or not is_variant(s, c))}
    with ThreadPoolExecutor(32) as ex:
        hits = [h for h in ex.map(check, sorted(tasks)) if h]
    hits.sort(key=lambda h: (h["id"], h["evidence"] != "site", -h["jobs"]))

    picks = {}
    for c in todo:
        b = best([h for h in hits if h["id"] == c["id"]])
        if b:
            picks[c["id"]] = b
    (ROOT / "data/discovery.json").write_text(json.dumps(hits, ensure_ascii=False, indent=1))
    print(f"{len(todo)} companies checked, {len(tasks)} probes, {len(hits)} boards answered, {len(picks)} matched")
    for cid, b in sorted(picks.items()):
        print(f'  {cid:<22} {b["ats"]:<15} {b["slug"]:<28} {b["evidence"]:<5} jobs={b["jobs"]:<4} latam={b["latam_share"]} {b["sample"][:3]}')
    if "--apply" in sys.argv:
        for c in companies:
            if c["id"] in picks and (not c["ats"] or "--all" in sys.argv):
                c["ats"], c["ats_slug"] = picks[c["id"]]["ats"], picks[c["id"]]["slug"]
        (ROOT / "data/companies.json").write_text(json.dumps(companies, ensure_ascii=False, indent=1) + "\n")
        print(f"applied {len(picks)} boards to data/companies.json")


if __name__ == "__main__":
    main()
