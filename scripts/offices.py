"""Pin company offices to street locations -> data/offices.json

    python3 scripts/offices.py           # geocode companies that don't have an HQ pin yet
    python3 scripts/offices.py --country Argentina,Mexico   # only these countries; retries their failed addresses
    python3 scripts/offices.py --redo    # start over (keeps hand-entered and web-search addresses)

Address candidates, best first:
  1. "manual" entries in offices.json: {"manual": [{"address": "...", "source_url": "..."}]}
     (hand-entered, or found by web search with the page it came from)
  2. data/web_addresses.json: {"<id>": {"address", "source_url"}}, addresses found by web search
     then the registered address of any CNPJ printed on a Brazilian company's site (public registry, BrasilAPI)
  3. the company's website (data/company_info.json, from scripts/scrape_companies.py): JSON-LD, then page text
  4. street addresses printed in its job postings (data/feed_addresses.json, from scripts/build.py)
  0. coordinates of a Google Map embedded on the company's own site (no geocoding needed)
  5. a place mapped in OpenStreetMap under the company's name in its HQ city

Each candidate is geocoded with OpenStreetMap Nominatim (1 request/second). It becomes the HQ pin only if it
lands within 40 km of the company's HQ city; one landing near another city on the map becomes an extra office.
Anything else (a foreign office, text that only looked like an address) is dropped, never pinned.
"""
import json
import math
import pathlib
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data/offices.json"
UA = "latam-startup-map/0.1 (open-source startup map)"
NEAR_KM = 40
MAX_TRIES = 6  # geocoding attempts per company per run

UNIT = re.compile(r"\b(?:\d{1,2}\s*[º°o]?\s*(?:andar|piso)|(?:andar|piso|sala|salas|conj\.?|conjunto|cj\.?|of\.?|oficina|suite|"
                  r"torre|edif[ií]cio|edificio|bloco|local|depto\.?|dpto\.?|int\.?|interior|apto\.?)\s*[\w./-]*)", re.I)
POSTCODE = re.compile(r"\b(?:CEP:?\s*)?\d{5}-?\d{3}\b|\bC\.?\s?P\.?:?\s*\d{4,5}\b|\b[A-Z]\d{4}[A-Z]{0,3}\b")
# Mexican/Argentine address noise Nominatim chokes on: "número 29", "Colonia", "Alcaldía Miguel Hidalgo", "de la ciudad de".
ES_NOISE = [(re.compile(r"\bn[uú]mero\b\.?", re.I), ""), (re.compile(r"\b(?:Colonia|Col\.)\s*", re.I), ""),
            (re.compile(r",?\s*\b(?:Alcald[ií]a|Delegaci[oó]n|Municipio|Partido)\s+[^,]+", re.I), ""),
            (re.compile(r"\bde la ciudad de\b|\bCiudad de (?=Rosario|C[oó]rdoba|Mendoza)", re.I), ", "),
            (re.compile(r"\b(?:Rep[uú]blica Argentina|Estados Unidos Mexicanos)\b", re.I), ""),
            (re.compile(r"\bCABA\b|C\.A\.B\.A\.?|Capital Federal|Ciudad Aut[oó]noma de Buenos Aires", re.I), "Buenos Aires"),
            (re.compile(r"\bCDMX\b", re.I), "Ciudad de México"), (re.compile(r"[“”\"]"), "")]


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def simplify(addr):
    """Drop floor/suite/postcode noise that makes Nominatim miss: 'Rua X, 39, 3º andar, sala 31' -> 'Rua X, 39'."""
    a = addr
    for rx, rep in ES_NOISE:
        a = rx.sub(rep, a)
    a = POSTCODE.sub("", a)
    a = UNIT.sub("", a)
    a = re.sub(r"\s*[–—|;]\s*", ", ", a)
    a = re.sub(r"\b(?:n[º°o]\.?|No\.|N°\.?)\s*|#\s*", "", a)
    a = re.split(r"\s(?:y|e) (?:el|la|los|las)\b", a)[0]
    a = re.sub(r"\s{2,}", " ", a)
    a = re.sub(r"(\d)\.(\d{3})\b", r"\1\2", a)  # 1.698 -> 1698
    return re.sub(r"(,\s*)+", ", ", a).strip(" ,")


def offline(e):
    """No DNS/connection at all: stop, rather than record every address as tried-and-failed (the run is saved per company)."""
    import urllib.error
    if isinstance(e, urllib.error.URLError) and not isinstance(e, urllib.error.HTTPError) and "nodename" in str(e.reason):
        sys.exit(f"network down ({e.reason}); stopping offices.py, re-run it when back online")


def geocode(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 1})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read())
    except Exception as e:
        offline(e)
        print("   geocode error:", e)
        res = []
    time.sleep(1.1)
    return (float(res[0]["lat"]), float(res[0]["lon"]), res[0]["display_name"]) if res else None


def photon(q):
    """Fallback geocoder (Komoot's Photon over OpenStreetMap): fuzzier than Nominatim with Spanish street names."""
    url = "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": q, "limit": 1})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            f = (json.loads(r.read()).get("features") or [None])[0]
    except Exception as e:
        offline(e)
        print("   photon error:", e)
        f = None
    time.sleep(1.1)
    if not f or f["properties"].get("type") not in ("house", "street", "other"):
        return None  # a city/district centroid is no better than the city pin we already have
    p = f["properties"]
    label = ", ".join(str(p[k]) for k in ("name", "street", "housenumber", "city", "country") if p.get(k))
    return f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0], label


def registry(cnpj):
    """Registered address of a Brazilian company from the public CNPJ registry (BrasilAPI mirror of Receita Federal)."""
    try:
        req = urllib.request.Request(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read())
    except Exception:
        return None
    street = " ".join(x for x in (d.get("descricao_tipo_de_logradouro"), d.get("logradouro")) if x)
    if not street or not d.get("municipio"):
        return None
    return f"{street.title()}, {d.get('numero') or ''}, {(d.get('bairro') or '').title()}, {d['municipio'].title()}, {d.get('uf')}"


def osm_named(name, city):
    """A place mapped in OpenStreetMap under the company's own name (office, coworking listing, building) in its city."""
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": f"{name}, {city['name']}, {city['country']}", "format": "jsonv2", "limit": 5, "addressdetails": 1})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            res = json.loads(r.read())
    except Exception:
        res = []
    time.sleep(1.1)
    want = re.sub(r"\W", "", name.lower())
    for h in res:
        label = re.sub(r"\W", "", (h.get("name") or "").lower())
        # Only an office/building carrying exactly the company's name: shops, cafés and streets named "Lemon"
        # or "Tango" are not the startup.
        if h.get("category") in ("office", "building") and len(want) >= 4 and label == want:
            a = h.get("address") or {}
            road = a.get("road")
            if road:
                return f"{road}, {a.get('house_number') or ''}, {a.get('city') or a.get('town') or city['name']}", h["display_name"]
    return None


def osm_by_website(companies):
    """Offices mapped in OpenStreetMap whose website tag is the company's own domain, in one Overpass query over
    Latin America: id -> [(lat, lng, label, osm url)]. Only office/building objects whose name matches the company,
    so restaurants that link to a delivery app's menu page don't count."""
    doms = {}
    for c in companies:
        d = (c.get("website") or "").lower().split("/")[0].removeprefix("www.")
        if len(d.split(".")[0]) >= 4:
            doms[d] = c
    if not doms:
        return {}
    rx = "|".join(re.escape(d) for d in doms).replace("\\", "\\\\")
    q = (f'[out:json][timeout:600];(nwr["website"~"//(www\\\\.)?({rx})",i](-56,-118,33,-34);'
         f'nwr["contact:website"~"//(www\\\\.)?({rx})",i](-56,-118,33,-34););out center tags;')
    try:
        req = urllib.request.Request("https://overpass-api.de/api/interpreter", headers={"User-Agent": UA},
                                     data=urllib.parse.urlencode({"data": q}).encode())
        with urllib.request.urlopen(req, timeout=700) as r:
            els = json.loads(r.read())["elements"]
    except Exception as e:
        print("   overpass error:", e)
        return {}
    norm = lambda s: re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower())
    out = {}
    for el in els:
        t = el.get("tags", {})
        site = (t.get("website") or t.get("contact:website") or "").lower()
        host = urllib.parse.urlparse(site).netloc.removeprefix("www.")
        c = doms.get(host)
        if not c or not ({"office", "building", "company"} & set(t)) or "amenity" in t:
            continue
        if not norm(t.get("name")).startswith(norm(c["name"])[:6]):
            continue
        lat, lng = (el["lat"], el["lon"]) if "lat" in el else (el["center"]["lat"], el["center"]["lon"])
        street = ", ".join(x for x in (t.get("addr:street"), t.get("addr:housenumber"), t.get("addr:city")) if x)
        out.setdefault(c["id"], []).append((lat, lng, street or t.get("name"), f"https://www.openstreetmap.org/{el['type']}/{el['id']}"))
    return out


def consistent(text, city_id, cities):
    """An address that names cities on our map ("..., Montevideo, Uruguay") must geocode near one of them; a fallback
    match on the street name alone ("Costa Rica 1661" exists in Mendoza too) is wrong."""
    fold = lambda x: unicodedata.normalize("NFKD", x).encode("ascii", "ignore").decode().lower()
    t = fold(text)
    named = {k for k, v in cities.items() if len(v["name"]) > 4 and fold(v["name"]) in t}
    if "buenos aires" in t or "caba" in t.split():
        named.add("buenos-aires")
    return not named or city_id in named or any(
        km((cities[k]["lat"], cities[k]["lng"]), (cities[city_id]["lat"], cities[city_id]["lng"])) < NEAR_KM for k in named)


ALIASES = {"mexico-city": ["cdmx", "ciudad de mexico", "mexico city", "mexico, d.f", "mexico df"],
           "buenos-aires": ["caba", "c.a.b.a", "capital federal", "buenos aires"], "sao-paulo": ["sao paulo", " sp,", "- sp"]}


def names_city(text, city_id, cities):
    """Does the address name this city (or an alias, or a neighbour within NEAR_KM, e.g. Guadalajara for Zapopan)?"""
    fold = lambda x: unicodedata.normalize("NFKD", x).encode("ascii", "ignore").decode().lower()
    t, here = fold(text), cities[city_id]
    for k, v in cities.items():
        if k == city_id or km((v["lat"], v["lng"]), (here["lat"], here["lng"])) < NEAR_KM:
            if fold(v["name"]) in t or any(x in t for x in ALIASES.get(k, [])):
                return True
    return False


def candidates(cid, entry, info, feed, web, company=None, city=None):
    out = [(m["address"], "manual", m.get("source_url")) for m in entry.get("manual", [])]
    if cid in web:
        out.append((web[cid]["address"], "web-search", web[cid].get("source_url")))
    for cnpj in (info.get(cid) or {}).get("cnpj", [])[:2]:
        if cnpj in entry.get("cnpj_tried", []):
            continue
        entry.setdefault("cnpj_tried", []).append(cnpj)
        a = registry(cnpj)
        if a:
            out.append((a, "registry", f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}"))
    for a in (info.get(cid) or {}).get("addresses", []):
        out.append((a["text"], "website", a["url"]))
    for text, _n in feed.get(cid, []):
        out.append((text, "job-feed", None))
    if company and city and not entry.get("hq") and not entry.get("osm_tried"):
        entry["osm_tried"] = True
        hit = osm_named(company["name"], city)
        if hit:
            out.append((hit[0], "openstreetmap", None))
    seen, uniq = set(), []
    out = [x for x in out if len(x[0]) <= 140 and not re.search(r"[§“”]|regulat|pursuant|C\.C\.R", x[0], re.I)]
    for text, src, url in out:
        key = simplify(text).lower()
        if key and re.search(r"\d", key) and key not in seen and key not in entry.get("tried", []):
            seen.add(key)
            uniq.append((text, src, url))
    return uniq


def main():
    redo = "--redo" in sys.argv
    countries = set(sys.argv[sys.argv.index("--country") + 1].split(",")) if "--country" in sys.argv else None
    companies = json.loads((ROOT / "data/companies.json").read_text())
    cities = json.loads((ROOT / "data/cities.json").read_text())
    load = lambda p: json.loads((ROOT / p).read_text()) if (ROOT / p).exists() else {}
    info, feed, cache = load("data/company_info.json"), load("data/feed_addresses.json"), load("data/offices.json")
    web = load("data/web_addresses.json")
    osm_site = osm_by_website([c for c in companies if not (cache.get(c["id"]) or {}).get("hq")])
    print(f"openstreetmap: {len(osm_site)} companies have an office tagged with their website")

    for c in companies:
        old = cache.get(c["id"], {})
        e = {"manual": old.get("manual", [])} if redo else old
        if "lat" in e:  # migrate the first version of this file (a bare HQ pin)
            e = {"hq": {k: e[k] for k in ("lat", "lng", "label", "source") if k in e}, "manual": []}
        e.setdefault("extra", [])
        e.setdefault("tried", [])
        hq_city = cities[c["city"]]
        if countries and hq_city["country"] not in countries:
            cache[c["id"]] = e
            continue
        if countries and not e.get("hq") and e.get("geo_v") != 2:
            e["tried"], e["geo_v"] = [], 2  # new address cleanup + Photon: worth retrying what failed before
        # A Google Map embedded on the company's own site is a pin with no geocoding needed.
        for mp in (info.get(c["id"]) or {}).get("map_pins", []):
            if e.get("hq") and e["hq"].get("source") in ("manual", "web-search", "registry", "website-map"):
                break
            if km((mp["lat"], mp["lng"]), (hq_city["lat"], hq_city["lng"])) < NEAR_KM:
                e["hq"] = {"lat": mp["lat"], "lng": mp["lng"], "label": "map on the company's website", "address": None,
                           "source": "website-map", "source_url": mp["url"], "city": c["city"]}
                print(f"HQ    {c['name']:<22} map      {mp['lat']:.5f},{mp['lng']:.5f}")
        # An OpenStreetMap office tagged with the company's website: mapped by hand, no geocoding needed.
        for lat, lng, label, url in osm_site.get(c["id"], []):
            if not e.get("hq") and km((lat, lng), (hq_city["lat"], hq_city["lng"])) < NEAR_KM:
                e["hq"] = {"lat": lat, "lng": lng, "label": label, "address": label, "source": "openstreetmap",
                           "source_url": url, "city": c["city"]}
                print(f"HQ    {c['name']:<22} osm-site {label[:60]}")
        tries = 0
        for text, src, url in candidates(c["id"], e, info, feed, web, c, hq_city):
            trusted = src in ("manual", "web-search", "registry")
            if e.get("hq") and (not trusted or e["hq"].get("source") in ("manual", "web-search", "registry", "website-map")) or tries >= MAX_TRIES:
                break
            tries += 1
            q = simplify(text)
            if hq_city["name"].lower() not in q.lower():
                q = f"{q}, {hq_city['name']}"
            hit = (geocode(q) or photon(q) or geocode(f"{q.split(',')[0]}, {hq_city['name']}, {hq_city['country']}"))
            e["tried"].append(simplify(text).lower())
            if not hit:
                continue
            lat, lng, label = hit
            near = min(((km((lat, lng), (v["lat"], v["lng"])), k) for k, v in cities.items()), default=(1e9, None))
            if not consistent(text, near[1], cities):
                print(f"   skip  {c['name']:<20} {text[:50]!r} names another city than where it geocoded ({near[1]})")
                continue
            pin = {"lat": lat, "lng": lng, "label": label, "address": text, "source": src, "source_url": url, "city": near[1]}
            if km((lat, lng), (hq_city["lat"], hq_city["lng"])) < NEAR_KM:
                pin["city"] = c["city"]
                if not e.get("hq") or trusted:
                    e["hq"] = pin
                    print(f"HQ    {c['name']:<22} {src:<8} {text[:60]}")
            # An office away from the HQ only counts when its address names that city: a bare street ("Carrera 13
            # #83-19") exists in many cities and the geocoder just picks one.
            elif near[0] < NEAR_KM and near[1] != c["city"] and names_city(text, near[1], cities) and all(x["city"] != near[1] for x in e["extra"]):
                e["extra"].append(pin)
                print(f"extra {c['name']:<22} {near[1]:<14} {text[:50]}")
        cache[c["id"]] = e
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True))

    pinned = sum(1 for v in cache.values() if v.get("hq"))
    extra = sum(len(v.get("extra", [])) for v in cache.values())
    print(f"{pinned}/{len(companies)} HQs pinned, {extra} extra offices -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
