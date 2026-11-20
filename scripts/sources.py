"""Grow the company list from public startup directories -> data/companies.json (+ new cities in data/cities.json)

    python3 scripts/sources.py            # report what would be added
    python3 scripts/sources.py --apply    # add new companies and cities
    python3 scripts/sources.py --cached --apply   # reuse data/directory_listings.json instead of crawling again

Sources (only names, websites, city, sector and size are taken; each company is then verified by the rest of the
pipeline: its own website, its job board, its registered address):
  yc           - Y Combinator's public company directory, via the open yc-oss mirror: active companies in Latin America
  startupblink - StartupBlink's public "top startups" pages per city and per city x sector (no login, robots.txt
                 allows it). Crawled slowly. Their scores and descriptions are not copied.

Large incumbents some directories list as startups (telecoms, carmakers, listed corporates) are skipped via
NOT_STARTUPS. A company already in companies.json (same website domain or same name) is skipped. New cities are geocoded
with OpenStreetMap Nominatim.
"""
import html as htmlmod
import json
import pathlib
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; latam-startup-map/0.1)"
SB = "https://www.startupblink.com"
SB_DELAY = 1.5  # seconds between StartupBlink requests

COUNTRIES = {  # StartupBlink slug -> country name used in cities.json
    "argentina": "Argentina", "bolivia": "Bolivia", "brazil": "Brazil", "chile": "Chile", "colombia": "Colombia",
    "costa-rica": "Costa Rica", "dominican-republic": "Dominican Republic", "ecuador": "Ecuador",
    "el-salvador": "El Salvador", "guatemala": "Guatemala", "honduras": "Honduras", "mexico": "Mexico",
    "nicaragua": "Nicaragua", "panama": "Panama", "paraguay": "Paraguay", "peru": "Peru", "uruguay": "Uruguay",
    "venezuela": "Venezuela",
}
LATAM = set(COUNTRIES.values())
CC = {"Argentina": "ar", "Bolivia": "bo", "Brazil": "br", "Chile": "cl", "Colombia": "co", "Costa Rica": "cr",
      "Dominican Republic": "do", "Ecuador": "ec", "El Salvador": "sv", "Guatemala": "gt", "Honduras": "hn",
      "Mexico": "mx", "Nicaragua": "ni", "Panama": "pa", "Paraguay": "py", "Peru": "pe", "Uruguay": "uy", "Venezuela": "ve"}
# Hubs to try beyond the three cities a country page links (a missing page is just skipped).
HUBS = {
    "Brazil": ["São Paulo", "Florianópolis", "Porto Alegre", "Recife", "Campinas", "Brasília", "Joinville", "Fortaleza",
               "Salvador", "Goiânia", "Vitória", "Ribeirão Preto", "São José dos Campos", "Londrina", "Blumenau", "Manaus"],
    "Mexico": ["Mexico City", "Guadalajara", "Monterrey", "Querétaro", "Puebla", "Mérida", "Tijuana", "León"],
    "Argentina": ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "La Plata"],
    "Colombia": ["Bogotá", "Medellín", "Cali", "Barranquilla", "Bucaramanga"],
    "Chile": ["Santiago", "Valparaíso", "Concepción", "Viña del Mar"],
    "Peru": ["Lima", "Arequipa"], "Ecuador": ["Quito", "Guayaquil", "Cuenca"], "Paraguay": ["Asunción", "Ciudad del Este"],
    "Uruguay": ["Montevideo"], "Bolivia": ["La Paz", "Santa Cruz de la Sierra", "Cochabamba"],
    "Costa Rica": ["San José"], "Venezuela": ["Caracas"],
}

# Directory categories -> the sector names the map already uses.
SECTORS = [
    (r"crypto|blockchain|web3|bitcoin", "Crypto"), (r"insur", "Insurtech"),
    (r"fintech|financ|payment|bank|lending|credit|wealth|accounting", "Fintech"),
    (r"real estate|proptech|housing|construction", "Proptech"), (r"health|medic|biotech|pharma|wellness", "Healthtech"),
    (r"educat|edtech|learning", "Edtech"), (r"logistic|delivery|supply chain|freight|shipping", "Logistics"),
    (r"human|recruit|hr\b|hiring|talent|payroll", "HR Tech"), (r"food|restaurant|grocer|agri|farm", "Foodtech"),
    (r"energy|climate|solar|sustainab|cleantech|environment", "Climate & Energy"),
    (r"mobility|transport|automotive|car\b|vehicle", "Mobility"), (r"security|identity|fraud", "Identity & Security"),
    (r"marketplace", "Marketplace"), (r"e-?commerce|retail|consumer", "E-commerce"),
    (r"robot|hardware|iot|industrial|manufactur", "Industrial AI"), (r"artificial|\bai\b|machine learning", "AI & Software"),
    (r"saas|software|b2b|enterprise|data|developer|web development|apps", "SaaS"),
    (r"media|entertainment|gaming|social|leisure|music|arts|creator", "Creator Economy"),
    (r"telecom|connectivity", "Telecom"),
]


NOT_STARTUPS = {"vivo.com.br", "totvs.com", "vli-logistica.com.br", "wom.cl", "calix.com", "coninsa.co", "jac.mx", "axity.com"}


def sector_of(*texts):
    t = " ".join(x or "" for x in texts).lower()
    return next((s for pat, s in SECTORS if re.search(pat, t)), "Other")


def stage_of(team):
    """Coarse stage from headcount when no funding stage is known: <=50 Early, <=250 Growth, else Late."""
    if not team:
        return "Early"
    return "Early" if team <= 50 else "Growth" if team <= 250 else "Late"


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def domain(u):
    u = (u or "").strip()
    if not u or u in ("—", "-"):
        return None
    host = urllib.parse.urlparse(u if "//" in u else "//" + u).netloc.lower().removeprefix("www.")
    return host if "." in host and host not in ("none.com", "linkedin.com", "facebook.com", "instagram.com") else None


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


# ---------------------------------------------------------------- Y Combinator

STATE_CITY = {  # YC sometimes gives a state/region instead of a city
    "antioquia": "Medellín", "cundinamarca": "Bogotá", "jalisco": "Guadalajara", "nuevo leon": "Monterrey",
    "sp": "São Paulo", "sao paulo state": "São Paulo", "rj": "Rio de Janeiro", "mg": "Belo Horizonte",
    "pr": "Curitiba", "rs": "Porto Alegre", "sc": "Florianópolis", "pe": "Recife", "df": "Brasília",
    "cdmx": "Mexico City", "ciudad de mexico": "Mexico City", "region metropolitana": "Santiago",
}


def yc():
    out = []
    for c in json.loads(get("https://yc-oss.github.io/api/companies/all.json")):
        if "Latin America" not in (c.get("regions") or []) or c.get("status") not in ("Active", "Public"):
            continue
        loc = (c.get("all_locations") or "").split(";")[0].strip()
        parts = [p.strip() for p in loc.split(",") if p.strip()]
        if len(parts) < 2 or parts[-1] not in LATAM:
            continue
        team = c.get("team_size") or 0
        out.append({
            "name": c["name"], "website": domain(c.get("website")),
            "city_name": STATE_CITY.get(norm(parts[0]), parts[0]), "country": parts[-1],
            "sector": sector_of(c.get("industry"), c.get("subindustry"), " ".join(c.get("tags") or [])),
            "stage": "Public" if c.get("status") == "Public" else stage_of(team),
            "team_size": team or None, "listed_by": "yc", "listed_url": c.get("url"),
            "logo": c.get("small_logo_thumb_url"), "description": c.get("one_liner"),
        })
    return out


# ---------------------------------------------------------------- StartupBlink

def sb_entries(page_html):
    """Startups listed on one top-startups page: name, sector path, website, employee range."""
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", page_html, flags=re.S)
    lines = [l.strip() for l in htmlmod.unescape(re.sub(r"<[^>]+>", "\n", t)).split("\n") if l.strip()]
    out = []
    for i, l in enumerate(lines):
        if l != "SB Score:" or i < 1:
            continue
        name = lines[i - 1]
        # The entry ends where the next one starts (its name sits just before the next "SB Score:"), so a missing
        # field never borrows the next startup's value.
        nxt = next((k for k in range(i + 1, len(lines)) if lines[k] == "SB Score:"), len(lines) + 1)
        block = lines[i: nxt - 1]
        cat = " ".join(block[2:6])
        web = block[block.index("Website") + 1] if "Website" in block else None
        emp = block[block.index("Employee range") + 1] if "Employee range" in block else ""
        m = re.findall(r"\d[\d,]*", emp)
        team = int(m[-1].replace(",", "")) if m else None
        out.append({"name": htmlmod.unescape(name), "website": domain(web), "category": cat, "team_size": team})
    return out


def sb_title_city(page_html):
    m = re.search(r"Top Startups in ([^|<]+?)\s*\|", page_html)
    return htmlmod.unescape(m.group(1)).strip() if m else None


def startupblink(countries):
    out, seen_pages = [], set()

    def page(path):
        if path in seen_pages:
            return None
        seen_pages.add(path)
        time.sleep(SB_DELAY)
        try:
            return get(SB + path)
        except Exception as e:
            print(f"  skip {path}: {e}", file=sys.stderr)
            return None

    for cslug, country in countries.items():
        h = page(f"/top-startups/{cslug}")
        if not h:
            continue
        # City pages look like /top-startups/<city>-<cc>; city x sector pages add /<sector>.
        linked = {p for p in re.findall(r'href="(/top-startups/[A-Za-z0-9%-]+-[a-z]{2})"', h)}
        cc = CC[country]
        for name in HUBS.get(country, []):
            low = name.lower().replace(" ", "-")
            # StartupBlink keeps accents in its city slugs (percent-encoded); try both spellings.
            for variant in (urllib.parse.quote(low), slug(name)):
                linked.add(f"/top-startups/{variant}-{cc}")
        cities = sorted(linked)
        n0 = len(out)
        hits = [c for c in cities if c in {p for p in re.findall(r'href="(/top-startups/[A-Za-z0-9%-]+-[a-z]{2})"', h)}]
        if len(hits) == 1:  # one hub (Asunción, Montevideo...): the country's list is that city's list
            city = urllib.parse.unquote(hits[0].rsplit("/", 1)[1][:-3]).replace("-", " ").title()
            for e in sb_entries(h):
                out.append({**e, "city_name": city, "country": country, "listed_by": "startupblink",
                            "listed_url": SB + f"/top-startups/{cslug}"})
        for city_path in cities:
            ch = page(city_path)
            if not ch:
                continue
            city = sb_title_city(ch) or urllib.parse.unquote(city_path.rsplit("/", 1)[1][:-3]).replace("-", " ").title()
            pages = [ch] + [x for x in (page(p) for p in sorted(set(re.findall(
                rf'href="({re.escape(city_path)}/[a-z0-9-]+)"', ch)))) if x]
            for ph in pages:
                for e in sb_entries(ph):
                    out.append({**e, "city_name": city, "country": country, "listed_by": "startupblink",
                                "listed_url": SB + city_path})
        print(f"  startupblink {country}: {len(cities)} cities, {len(out) - n0} listings", file=sys.stderr)
    # A startup shows up on several sector pages of its city: keep one.
    uniq = {}
    for e in out:
        uniq.setdefault((norm(e["name"]), e["city_name"]), e)
    res = []
    for e in uniq.values():
        # StartupBlink's employee ranges are unreliable (a crypto token listed at "10,001+"), so no headcount
        # or stage is taken from it.
        res.append({**{k: e[k] for k in ("name", "website", "city_name", "country", "listed_by", "listed_url")},
                    "sector": sector_of(e["category"]), "stage": "Unknown"})
    return res


# ---------------------------------------------------------------- merge

def geocode_city(name, country):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"city": name, "country": country, "format": "jsonv2", "limit": 1})
    time.sleep(1.1)
    try:
        res = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read())
    except Exception:
        return None
    return (float(res[0]["lat"]), float(res[0]["lon"])) if res else None


def main():
    apply = "--apply" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    companies = json.loads((ROOT / "data/companies.json").read_text())
    cities = json.loads((ROOT / "data/cities.json").read_text())

    raw = ROOT / "data/directory_listings.json"  # cache of the last crawl; --cached reuses it
    if "--cached" in sys.argv and raw.exists():
        found = json.loads(raw.read_text())
    else:
        found = []
        if not only or "yc" in only:
            found += yc()
            print(f"yc: {len(found)} active LatAm companies", file=sys.stderr)
        if not only or "startupblink" in only:
            found += startupblink(COUNTRIES)
        raw.write_text(json.dumps(found, ensure_ascii=False, indent=1))

    # Companies liveness.py removed as defunct count as known, so a directory crawl doesn't add them back.
    rem = ROOT / "data/removed.json"
    gone = list(json.loads(rem.read_text()).values()) if rem.exists() else []
    have_dom = {domain(c.get("website")) for c in companies + gone} - {None}
    have_name = {norm(c["name"]) for c in companies + gone}
    have_id = {c["id"] for c in companies}
    city_key = {(norm(v["name"]), v["country"]): k for k, v in cities.items()}
    new, skipped = [], 0
    for e in found:
        d = e.get("website")
        if not d or d in NOT_STARTUPS or d in have_dom or norm(e["name"]) in have_name or not e.get("city_name"):
            skipped += 1
            continue
        have_dom.add(d)
        have_name.add(norm(e["name"]))
        new.append(e)

    added_cities = {}
    for e in new:
        key = (norm(e["city_name"]), e["country"])
        if key not in city_key:
            ck = slug(e["city_name"])
            if ck in cities:
                ck = f"{ck}-{slug(e['country'])}"
            if apply:
                at = geocode_city(e["city_name"], e["country"])
                if not at:
                    e["city"] = None
                    continue
                cities[ck] = {"name": e["city_name"], "country": e["country"], "lat": at[0], "lng": at[1]}
            city_key[key] = ck
            added_cities[ck] = e["city_name"] + ", " + e["country"]
        e["city"] = city_key[key]

    rows = []
    for e in new:
        if not e.get("city"):
            continue
        cid = slug(e["name"]) or slug(e["website"])
        while cid in have_id:
            cid += "-" + slug(e["country"])[:2]
        have_id.add(cid)
        rows.append({"id": cid, "name": e["name"], "website": e["website"], "city": e["city"], "sector": e["sector"],
                     "stage": e["stage"], "ats": None, "ats_slug": None, "listed_by": e["listed_by"],
                     "listed_url": e.get("listed_url"), "team_size": e.get("team_size"),
                     **({"logo": e["logo"]} if e.get("logo") else {}),
                     **({"description": e["description"]} if e.get("description") else {})})

    from collections import Counter
    print(f"{len(found)} listings, {skipped} already known or unusable, {len(rows)} new companies, {len(added_cities)} new cities")
    print("  by country:", dict(Counter(cities.get(r["city"], {}).get("country") or r["city"] for r in rows).most_common()))
    print("  new cities:", ", ".join(sorted(added_cities.values()))[:1500])
    if apply:
        (ROOT / "data/cities.json").write_text(json.dumps(cities, ensure_ascii=False, indent=1) + "\n")
        (ROOT / "data/companies.json").write_text(json.dumps(companies + rows, ensure_ascii=False, indent=1) + "\n")
        print(f"added {len(rows)} companies -> data/companies.json")


if __name__ == "__main__":
    main()
