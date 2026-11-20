"""Scrape each company's own website for facts the job feeds don't have -> data/company_info.json

    python3 scripts/scrape_companies.py            # every company
    python3 scripts/scrape_companies.py nubank vtex
    python3 scripts/scrape_companies.py --country Argentina,Mexico

Per company: description, LinkedIn page, founding year, headcount (from schema.org JSON-LD when the site
publishes it) and street-address candidates. Addresses come from JSON-LD PostalAddress first, then from
street-like text on the home page and on contact / about / legal pages (Brazilian footers usually carry the
registered address next to the CNPJ). scripts/offices.py geocodes the best candidate.
"""
import html as htmlmod
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data/company_info.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 latam-startup-map/0.1"
TIMEOUT = 15
MAX_PAGES = 16
# Legal / contact pages many sites have but don't link from the home page. Mexican privacy notices ("aviso de
# privacidad") must state the company's domicile by law; Argentine terms pages usually carry the legal address.
GUESS_PAGES = ["/contacto", "/contact", "/aviso-de-privacidad", "/privacidad", "/politica-de-privacidad",
               "/terminos-y-condiciones", "/terminos", "/legales", "/legal"]

PAGE_HINT = re.compile(r"contat|contact|fale-conosco|sobre|about|nosotros|quienes|quem-somos|empresa|company|"
                       r"privac|termos|terms|legal|aviso|imprint|oficina|office|ubicac|endereco|direccion", re.I)
STREET = (r"(?:Rua|R\.|Av\.|Avenida|Alameda|Al\.|Rodovia|Praça|Calle|Carrera|Cra\.?|Cl\.|Paseo|P\.º|Blvd\.?|Boulevard|"
          r"Bulevar|Jr\.|Jirón|Camino|Calzada|Diagonal|Transversal|Av)")
ADDR_RE = re.compile(STREET + r"\s+[^\n<>{}|]{3,90}?\d{1,5}[^\n<>{}|]{0,80}")
# "con domicilio en Av. X 123..." / "domicilio legal: ..." (privacy notices, terms).
DOMICILE_RE = re.compile(r"(?:domicilio|domiciliad[oa]|con sede|oficinas? (?:central(?:es)?|ubicadas?))\s*(?:legal|fiscal|social|"
                         r"real|constituido|convencional)?\s*(?:para[^:]{0,40})?(?:en|:)\s*(?:la\s+|el\s+)?([^\n;]{10,160})", re.I)
# Street without a "Calle/Av." prefix but with a number and a postcode or a known city: "Thames 2354, C1425 CABA",
# "Montes Urales 424, Lomas de Chapultepec, C.P. 11000".
POSTAL_RE = re.compile(r"\b[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.' ]{2,40}\s(?:N[°º]?\.?\s*|#\s*)?\d{2,5}\b[^\n<>]{0,90}?"
                       r"(?:\bC\.?\s?P\.?:?\s*\d{4,5}\b|\b[A-Z]\d{4}[A-Z]{0,3}\b|\bCABA\b|C\.A\.B\.A|Ciudad Aut[oó]noma de Buenos Aires|"
                       r"Capital Federal|CDMX|Ciudad de M[eé]xico)")
# Coordinates of an embedded Google Map or a map link: "...!2d-58.43!3d-34.58...", "/@-34.58,-58.43,17z", "?q=-34.5,-58.4".
MAP_COORDS = [(re.compile(r"!2d(-?\d{1,3}\.\d{3,})!3d(-?\d{1,2}\.\d{3,})"), "lnglat"),
              (re.compile(r"google\.[a-z.]+/maps/[^\s\"'<>]*?@(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})"), "latlng"),
              (re.compile(r"maps[^\s\"'<>]*?[?&](?:q|ll|query|center|destination)=(-?\d{1,2}\.\d{3,}),\s?(-?\d{1,3}\.\d{3,})"), "latlng")]
MAP_PLACE = re.compile(r"(?:google\.[a-z.]+/maps/(?:place|search)/|maps\.google\.[a-z.]+/[^\s\"'<>]*?[?&]q=)([^/@&\"'<>]{8,160})")
ORG_TYPES = re.compile(r"Organization|Corporation|LocalBusiness|FinancialService|BankOrCreditUnion|OnlineBusiness|"
                       r"ProfessionalService|EducationalOrganization|Store|Company", re.I)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "en,pt,es"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        if "html" not in (r.headers.get("Content-Type") or "html"):
            return r.geturl(), ""
        return r.geturl(), r.read(2_000_000).decode("utf-8", "replace")


def visible_text(html):
    html = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<br\s*/?>|</(p|div|li|span|h\d|footer|address)>", "\n", html, flags=re.I)
    t = htmlmod.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"[ \t\xa0]+", " ", t)


def jsonld(html):
    out = []
    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            d = json.loads(m.group(1).strip())
        except ValueError:
            continue
        stack = d if isinstance(d, list) else [d]
        while stack:
            x = stack.pop()
            if isinstance(x, dict):
                out.append(x)
                stack.extend(v for v in x.values() if isinstance(v, (dict, list)))
            elif isinstance(x, list):
                stack.extend(x)
    return out


def postal(a):
    if isinstance(a, list):
        a = a[0] if a else None
    if isinstance(a, str):
        return a
    if not isinstance(a, dict):
        return None
    parts = [a.get(k) for k in ("streetAddress", "addressLocality", "addressRegion", "addressCountry")]
    parts = [p.get("name") if isinstance(p, dict) else p for p in parts]
    return ", ".join(str(p) for p in parts if p) or None


CNPJ_RE = re.compile(r"\b(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})\b")


def cnpj_ok(d):
    """Checksum test, so random 14-digit numbers aren't sent to the registry."""
    if len(d) != 14 or len(set(d)) == 1:
        return False
    for n in (12, 13):
        w = list(range(n - 7, 1, -1)) + list(range(9, 1, -1))
        r = sum(int(x) * y for x, y in zip(d[:n], w)) % 11
        if int(d[n]) != (0 if r < 2 else 11 - r):
            return False
    return True


def icon_of(url, html):
    """Best square logo the site declares: apple-touch-icon, then the largest <link rel=icon>."""
    best = None
    for tag in re.findall(r"<link[^>]+>", html, re.I):
        rel = (re.search(r'rel=["\']([^"\']+)', tag, re.I) or [None, ""])[1].lower()
        href = re.search(r'href=["\']([^"\']+)', tag, re.I)
        if not href or "icon" not in rel or "mask" in rel:
            continue
        size = re.search(r'sizes=["\'](\d+)', tag)
        score = (2000 if "apple" in rel else 0) + (int(size.group(1)) if size else 16) + (500 if href.group(1).endswith(".svg") else 0)
        if not best or score > best[0]:
            best = (score, urllib.parse.urljoin(url, htmlmod.unescape(href.group(1))))
    return best[1] if best else None


def clean_addr(s):
    s = re.sub(r"\s+", " ", s).strip(" ,.-–|")
    return re.split(r"\s(?:CNPJ|Tel|Phone|Telefone|E-?mail|WhatsApp|©|Copyright|RUT|NIT|RFC|CUIT)\b|\s(?:en cumplimiento|quien|y es responsable|es responsable|el responsable|le informa|LA EMPRESA)", s, flags=re.I)[0].strip(" ,.-–|()\"")


def scrape(c, city):
    info = {"addresses": []}
    if not c.get("website"):
        return c["id"], {"error": "no website"}
    site = c["website"].strip("/")
    err = None
    # Some sites refuse the bare domain or plain bots; try the www host and http before giving up.
    for base in (f"https://{site}/", f"https://www.{site}/", f"http://{site}/"):
        try:
            final, home = fetch(base)
            break
        except Exception as e:
            err = err or f"{type(e).__name__}: {e}"[:200]
    else:
        return c["id"], {"error": err}
    pages = [(final, home)]
    info["icon"] = icon_of(final, home)
    links = []
    for href in re.findall(r'href=["\']([^"\'#]+)["\']', home):
        u = urllib.parse.urljoin(final, href)
        same = urllib.parse.urlparse(u).netloc.split(".")[-2:] == urllib.parse.urlparse(final).netloc.split(".")[-2:]
        if same and PAGE_HINT.search(urllib.parse.urlparse(u).path) and u not in links and not re.search(r"\.(pdf|jpg|png|svg)$", u, re.I):
            links.append(u)
        if "linkedin.com/company" in u and "linkedin" not in info:
            info["linkedin"] = u.split("?")[0]
    # Sitemaps list contact/legal pages that the home page doesn't link to.
    try:
        sm = fetch(urllib.parse.urljoin(final, "/sitemap.xml"))[1]
        for loc in re.findall(r"<loc>\s*([^<\s]+)", sm)[:2000]:
            if PAGE_HINT.search(urllib.parse.urlparse(loc).path) and loc not in links and not loc.endswith(".xml"):
                links.append(loc)
    except Exception:
        pass
    have = {urllib.parse.urlparse(u).path.rstrip("/") for u in links}
    links = links[: MAX_PAGES - 1 - len(GUESS_PAGES)] + [urllib.parse.urljoin(final, g) for g in GUESS_PAGES if g not in have]
    for u in links[: MAX_PAGES - 1]:
        try:
            pages.append(fetch(u))
        except Exception:
            pass

    city_words = [w for w in re.split(r"\W+", city["name"].lower()) if len(w) > 3]
    seen = set()
    cnpjs = []
    for url, html in pages:
        for m in CNPJ_RE.finditer(visible_text(html)):
            d = re.sub(r"\D", "", m.group(1))
            if cnpj_ok(d) and d not in cnpjs:
                cnpjs.append(d)
        for d in jsonld(html):
            t = d.get("@type")
            t = " ".join(t) if isinstance(t, list) else str(t or "")
            if not ORG_TYPES.search(t):
                continue
            if d.get("description") and "description" not in info:
                info["description"] = htmlmod.unescape(str(d["description"]))[:400]
            if d.get("foundingDate") and "founded" not in info:
                m = re.search(r"(19|20)\d\d", str(d["foundingDate"]))
                if m:
                    info["founded"] = int(m.group(0))
            emp = d.get("numberOfEmployees")
            if emp and "employees" not in info:
                info["employees"] = emp.get("value") if isinstance(emp, dict) else emp
            for s in d.get("sameAs") or []:
                if isinstance(s, str) and "linkedin.com/company" in s:
                    info.setdefault("linkedin", s)
            a = postal(d.get("address"))
            if a and re.search(r"\d", a) and a not in seen:
                seen.add(a)
                info["addresses"].append({"text": a, "url": url, "kind": "json-ld", "in_hq_city": any(w in a.lower() for w in city_words)})
        text = visible_text(html)
        for rx, order in MAP_COORDS:
            for m in rx.finditer(html):
                a, b = float(m.group(1)), float(m.group(2))
                lat, lng = (b, a) if order == "lnglat" else (a, b)
                if -60 < lat < 33 and -120 < lng < -30 and len(info.setdefault("map_pins", [])) < 4:
                    if all(abs(p["lat"] - lat) > 1e-4 or abs(p["lng"] - lng) > 1e-4 for p in info["map_pins"]):
                        info["map_pins"].append({"lat": lat, "lng": lng, "url": url})
        found = [(urllib.parse.unquote_plus(m.group(1)), "map-link") for m in MAP_PLACE.finditer(html)]
        found += [(m.group(1), "domicile") for m in DOMICILE_RE.finditer(text) if re.search(r"\d{2,}", m.group(1))]
        found += [(m.group(0), "page-text") for m in POSTAL_RE.finditer(text)]
        found += [(m.group(0), "page-text") for m in ADDR_RE.finditer(text)]
        for raw, kind in found:
            a = clean_addr(raw)
            if len(a) < 12 or a in seen:
                continue
            seen.add(a)
            info["addresses"].append({"text": a, "url": url, "kind": kind, "in_hq_city": any(w in a.lower() for w in city_words)})
        if "description" not in info:
            m = re.search(r'<meta[^>]+(?:name|property)=["\'](?:og:)?description["\'][^>]+content=["\']([^"\']{30,})', html, re.I)
            if m:
                info["description"] = htmlmod.unescape(m.group(1))[:400]
    # JSON-LD first, then addresses that name the HQ city.
    rank = {"json-ld": 0, "map-link": 1, "domicile": 2}
    info["addresses"].sort(key=lambda a: (not a["in_hq_city"], rank.get(a["kind"], 3)))
    info["addresses"] = info["addresses"][:8]
    info["pages"] = [u for u, _ in pages]
    if cnpjs:
        info["cnpj"] = cnpjs[:3]
    if not info["icon"]:
        del info["icon"]
    return c["id"], info


def main():
    companies = json.loads((ROOT / "data/companies.json").read_text())
    cities = json.loads((ROOT / "data/cities.json").read_text())
    args = sys.argv[1:]
    countries = set(args[args.index("--country") + 1].split(",")) if "--country" in args else None
    only = {a for a in args if not a.startswith("--") and (not countries or a != args[args.index("--country") + 1])}
    todo = [c for c in companies if (not only or c["id"] in only) and (not countries or cities[c["city"]]["country"] in countries)]
    cache = json.loads(OUT.read_text()) if OUT.exists() else {}
    with ThreadPoolExecutor(12) as ex:
        for cid, info in ex.map(lambda c: scrape(c, cities[c["city"]]), todo):
            wd = (cache.get(cid) or {}).get("wikidata")  # from scripts/wikidata.py, keep across re-scrapes
            cache[cid] = {**info, **({"wikidata": wd} if wd else {})}
    OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True))
    ok = [v for v in cache.values() if "error" not in v]
    print(f"{sum(1 for v in ok if v.get('map_pins'))} with map coordinates · {len(ok)}/{len(cache)} sites read · {sum(1 for v in ok if v.get('addresses'))} with address candidates · "
          f"{sum(1 for v in ok if v.get('description'))} with a description · {sum(1 for v in ok if v.get('linkedin'))} with LinkedIn")


if __name__ == "__main__":
    main()
