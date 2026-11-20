"""Fill company facts from Wikidata -> merged into data/company_info.json under "wikidata"

    python3 scripts/wikidata.py

A Wikidata item is used only when its official website (P856) has the same domain as the company's, so a
name clash ("Mono", "Hash") never leaks in. Per match: founding year, headcount, founders, logo, LinkedIn,
X/Twitter and the item link. build.py prefers website-scraped values and falls back to these.
"""
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data/company_info.json"
API = "https://www.wikidata.org/w/api.php"
UA = "latam-startup-map/0.1 (open-source startup map)"


def api(**params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "maxlag": 5})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
                time.sleep(0.3)
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 4:
                raise
            time.sleep(int(e.headers.get("Retry-After") or 5) + attempt * 2)


def domain(u):
    host = urllib.parse.urlparse(u if "//" in u else "//" + u).netloc.lower()
    return host.removeprefix("www.")


def claims(e, p):
    return [c["mainsnak"].get("datavalue", {}).get("value") for c in e.get("claims", {}).get(p, []) if c["mainsnak"].get("datavalue")]


def match(c):
    want = domain(c["website"])
    ids = [r["id"] for r in api(action="wbsearchentities", search=c["name"], language="en", limit=7).get("search", [])]
    if not ids:
        return c["id"], None
    ents = api(action="wbgetentities", ids="|".join(ids), props="claims|labels").get("entities", {})
    for qid in ids:
        e = ents.get(qid) or {}
        sites = [domain(s) for s in claims(e, "P856") if isinstance(s, str)]
        if any(s == want or s.endswith("." + want) or want.endswith("." + s) for s in sites):
            return c["id"], facts(qid, e)
    return c["id"], None


def facts(qid, e):
    out = {"qid": qid, "url": f"https://www.wikidata.org/wiki/{qid}"}
    inception = claims(e, "P571")
    if inception:
        m = re.search(r"(\d{4})", inception[0].get("time", ""))
        if m:
            out["founded"] = int(m.group(1))
    emp = claims(e, "P1128")
    if emp:
        out["employees"] = int(float(emp[-1]["amount"]))  # latest statement last
    logo = claims(e, "P154")
    if logo:
        out["logo"] = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(logo[0].replace(" ", "_"))
    li = claims(e, "P4264")
    if li:
        out["linkedin"] = f"https://www.linkedin.com/company/{li[0]}"
    tw = claims(e, "P2002")
    if tw:
        out["twitter"] = f"https://x.com/{tw[0]}"
    founders = [v["id"] for v in claims(e, "P112") if isinstance(v, dict)]
    if founders:
        names = api(action="wbgetentities", ids="|".join(founders[:8]), props="labels", languages="en|pt|es").get("entities", {})
        out["founders"] = [next(iter((names.get(f, {}).get("labels") or {"x": {"value": f}}).values()))["value"] for f in founders[:8]]
    return out


def main():
    companies = json.loads((ROOT / "data/companies.json").read_text())
    info = json.loads(OUT.read_text()) if OUT.exists() else {}

    def safe(c):
        try:
            return match(c)
        except Exception:
            return c["id"], None
    with ThreadPoolExecutor(1) as ex:  # one at a time: the public API rate-limits bursts
        for cid, wd in ex.map(safe, companies):
            entry = info.setdefault(cid, {})
            if wd:
                entry["wikidata"] = wd
            else:
                entry.pop("wikidata", None)
    OUT.write_text(json.dumps(info, ensure_ascii=False, indent=1, sort_keys=True))
    hits = [v["wikidata"] for v in info.values() if v.get("wikidata")]
    print(f"{len(hits)}/{len(companies)} matched on Wikidata · {sum('founded' in h for h in hits)} founding years · "
          f"{sum('employees' in h for h in hits)} headcounts · {sum('founders' in h for h in hits)} with founders · "
          f"{sum('logo' in h for h in hits)} logos")


if __name__ == "__main__":
    main()
