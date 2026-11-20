"""Fetch live jobs for every company with a confirmed ATS board and write web/public/data.json.

    python3 scripts/build.py
"""
import datetime
import json
import pathlib
import re
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ats  # noqa: E402
from extract import extract, lines_of  # noqa: E402
from collections import Counter  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load(c):
    if not c["ats"]:
        return c, None, None
    try:
        jobs = ats.fetch(c["ats"], c["ats_slug"])
    except Exception as e:  # board moved/renamed: keep company, mark as untracked this run
        return c, None, f"{type(e).__name__}: {e}"
    # Multinational boards (e.g. Nubank, VTEX) also list US/EU roles; keep LatAm-located jobs plus
    # ones with no real location ("Remote", "Global", blank). "US - Remote" is dropped.
    keep = [j for j in jobs if ats.is_latam(j["location"]) or generic_location(j["location"])]
    return c, keep, None


GENERIC = re.compile(r"\b(remote|remoto|global|anywhere|worldwide|americas|home ?office|teletrabajo|hybrid|h[ií]brido)\b|[^a-z]", re.I)


def generic_location(loc):
    """True for blank or location-free labels like "Remote" / "Global - Remote"; False for "US - Remote"."""
    return not GENERIC.sub("", loc or "")


def main():
    companies = json.loads((ROOT / "data/companies.json").read_text())
    cities = json.loads((ROOT / "data/cities.json").read_text())
    f = ROOT / "data/offices.json"  # street-level HQ pins from scripts/offices.py
    offices = json.loads(f.read_text()) if f.exists() else {}
    with ThreadPoolExecutor(16) as ex:
        results = list(ex.map(load, companies))

    out, errors, feed_addresses = [], [], {}
    for c, jobs, err in results:
        # Street addresses found in job feeds (Gupy, Teamtailor, Ashby) are office candidates for offices.py.
        addrs = Counter(j["address"] for j in jobs or [] if street(j.get("address")))
        if addrs:
            feed_addresses[c["id"]] = addrs.most_common(5)
        if jobs is not None:
            # Lines repeated across a company's postings are boilerplate ("About Nu…"), not the role.
            seen = Counter(l for j in jobs for l in set(lines_of(j.get("description"))))
            boiler = frozenset(l for l, n in seen.items() if n >= max(2, len(jobs) * 0.3))
            jobs = [slim(j, boiler) for j in jobs]
        if err:
            errors.append(f'{c["name"]} ({c["ats"]}/{c["ats_slug"]}): {err}')
        tracked = jobs is not None
        out.append({
            **{k: c[k] for k in ("id", "name", "website", "city", "sector", "stage")},
            "listed_by": c.get("listed_by") or "curated",  # where the company came from (scripts/sources.py)
            "listed_url": c.get("listed_url"),
            "tracked": tracked,
            "truncated": False,  # kept for the front end; Gupy pages now embed every job
            "office": office(offices.get(c["id"])),
            "ats": c["ats"] if tracked else None,
            "ats_configured": c["ats"],
            "feed_error": err,
            "careers_url": careers_url(c) if c["ats"] else None,
            "feed_url": feed_url(c) if c["ats"] else None,
            "jobs": sorted(jobs or [], key=lambda j: j["posted"] or "", reverse=True),
        })

    # A network outage makes every feed fail at once; publishing that would empty the site. Keep the last build.
    configured = sum(1 for c in companies if c["ats"])
    if configured >= 10 and len(errors) > configured * 0.6:
        sys.exit(f"{len(errors)}/{configured} feeds failed (network down?); not overwriting data.json or feed_addresses.json")

    data = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "cities": cities,
        "companies": out,
        # Slug probes from scripts/discover.py: which candidate boards exist on which ATS.
        "discovery": discovery(),
    }
    (ROOT / "data/feed_addresses.json").write_text(json.dumps(feed_addresses, ensure_ascii=False, indent=1, sort_keys=True))
    info = ROOT / "data/company_info.json"  # website details from scripts/scrape_companies.py
    seeds = {c["id"]: c for c in companies}
    if info.exists():
        extra = json.loads(info.read_text())
        for c in out:
            e = {**{k: v for k, v in seeds[c["id"]].items() if k in ("description",) and v},
                 **{k: v for k, v in (extra.get(c["id"]) or {}).items() if v}}
            if not e.get("employees") and seeds[c["id"]].get("team_size"):
                e["employees"] = seeds[c["id"]]["team_size"]
            wd = e.get("wikidata") or {}  # scripts/wikidata.py fills what the website doesn't say
            merged = {k: e.get(k) or wd.get(k) for k in ("description", "linkedin", "founded", "employees", "twitter", "founders")}
            merged["logo"] = e.get("icon") or seeds[c["id"]].get("logo") or wd.get("logo")  # the site's square icon reads better than a wide wordmark
            merged["wikidata"] = wd.get("url")
            c["info"] = {k: v for k, v in merged.items() if v} or None
    dest = ROOT / "web/public/data.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    n_jobs = sum(len(c["jobs"]) for c in out)
    hiring = sum(1 for c in out if c["jobs"])
    print(f"{len(out)} companies, {hiring} hiring, {n_jobs} jobs -> {dest.relative_to(ROOT)}")
    for e in errors:
        print("  warn:", e)


PIN_KEYS = ("lat", "lng", "label", "address", "source", "source_url", "city")


def office(e):
    """Street pins from data/offices.json: {"hq": pin|None, "extra": [pins in other cities]}."""
    if not e:
        return None
    if "lat" in e:  # first version of the file: a bare HQ pin
        e = {"hq": e}
    pin = lambda p: {k: p[k] for k in PIN_KEYS if p.get(k) is not None}
    hq, extra = e.get("hq"), [pin(p) for p in e.get("extra", [])]
    return {"hq": pin(hq) if hq else None, "extra": extra} if hq or extra else None


STREET = re.compile(r"\b(rua|r\.|av\.?|avenida|alameda|al\.|rodovia|praca|praça|calle|carrera|cra\.?|cl\.|paseo|"
                    r"blvd|boulevard|bulevar|jr\.?|jir[oó]n|camino|street|st\.|road|calzada|diagonal|transversal)\b", re.I)


def street(addr):
    """A real street address: names a street and has a building number."""
    return bool(addr and STREET.search(addr) and re.search(r"\b\d{1,5}\b", addr))


def slim(j, boiler=frozenset()):
    """Replace the full description with the facts extracted from it (keeps data.json small)."""
    facts = extract(j, boiler)
    keep = {k: v for k, v in j.items() if k not in ("description", "address", "salary", "employment")}
    return {**keep, **{k: v for k, v in facts.items() if v}}


def discovery():
    f = ROOT / "data/discovery.json"
    if not f.exists():
        return []
    return [{k: d.get(k) for k in ("name", "ats", "slug", "jobs", "latam_share")} for d in json.loads(f.read_text())]


def feed_url(c):
    """The public endpoint the jobs were read from (shown in the app's Sources view)."""
    s = c["ats_slug"]
    if c["ats"] == "workday":
        return workday_url(s, "wday/cxs/{tenant}/{site}/jobs")
    if c["ats"] == "jsonld":
        return s
    return {
        "greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs",
        "lever": f"https://api.lever.co/v0/postings/{s}?mode=json",
        "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{s}",
        "workable": f"https://apply.workable.com/api/v1/widget/accounts/{s}",
        "smartrecruiters": f"https://api.smartrecruiters.com/v1/companies/{s}/postings",
        "recruitee": f"https://{s}.recruitee.com/api/offers/",
        "breezy": f"https://{s}.breezy.hr/json",
        "gupy": f"https://{s}.gupy.io/",
        "teamtailor": f"https://{ats._host(s, '.teamtailor.com')}/jobs.rss",
        "inhire": "https://api.inhire.app/job-posts/public/pages",
        "bamboohr": f"https://{s}.bamboohr.com/careers/list",
        "getonbrd": f"https://www.getonbrd.com/api/v0/companies/{s}/jobs",
        "hiringroom": f"https://{s}.hiringroom.com/jobs",
        "buk": f"https://{s}/trabaja-con-nosotros",
        "peopleforce": f"https://{s}.peopleforce.io/careers",
        "yc": f"https://www.ycombinator.com/companies/{s}/jobs",
    }[c["ats"]]


def careers_url(c):
    s = c["ats_slug"]
    if c["ats"] == "workday":
        return workday_url(s, "{site}")
    if c["ats"] == "jsonld":
        return s
    return {
        "greenhouse": f"https://job-boards.greenhouse.io/{s}",
        "lever": f"https://jobs.lever.co/{s}",
        "ashby": f"https://jobs.ashbyhq.com/{s}",
        "workable": f"https://apply.workable.com/{s}/",
        "smartrecruiters": f"https://jobs.smartrecruiters.com/{s}",
        "recruitee": f"https://{s}.recruitee.com/",
        "breezy": f"https://{s}.breezy.hr/",
        "gupy": f"https://{s}.gupy.io/",
        "teamtailor": f"https://{ats._host(s, '.teamtailor.com')}/jobs",
        "inhire": f"https://{s}.inhire.app/vagas",
        "bamboohr": f"https://{s}.bamboohr.com/careers",
        "getonbrd": f"https://www.getonbrd.com/companies/{s}",
        "hiringroom": f"https://{s}.hiringroom.com/jobs",
        "buk": f"https://{s}/trabaja-con-nosotros",
        "peopleforce": f"https://{s}.peopleforce.io/careers",
        "yc": f"https://www.ycombinator.com/companies/{s}/jobs",
    }[c["ats"]]


def workday_url(slug, path):
    host, site = slug.split("/", 1)
    return f"https://{host}.myworkdayjobs.com/" + path.format(tenant=host.split(".")[0], site=site)


if __name__ == "__main__":
    main()
