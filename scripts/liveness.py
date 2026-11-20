"""Find companies that no longer exist -> data/liveness.json; --apply moves the dead ones to data/removed.json.

    python3 scripts/liveness.py            # check every company, report
    python3 scripts/liveness.py --apply    # also drop "dead" companies from companies.json (kept in removed.json)

Per company, signals:
  jobs     - its job feed returned postings in the last build (web/public/data.json): alive, nothing else checked
  dns      - neither the domain nor www. resolves
  parked   - the site is a registrar/parking/"domain for sale" page or a suspended-hosting page
  closed   - the site says the company shut down ("encerramos as atividades", "we are shutting down", ...)
  yc       - YC's directory (yc-oss mirror) marks it Inactive
  moved    - the site redirects to a different domain (often acquired / rebranded; reviewed by hand)
  down     - unreachable (timeout, TLS, 5xx, 404 home); the Wayback Machine date of its last good snapshot is kept

dead = dns | parked | closed | yc (Inactive). "down" and "moved" are only reported: a site can be briefly down,
and a redirect can be a rebrand. data/removed.json records why each company was removed; sources.py skips
those ids/domains so a directory crawl doesn't add them back. Hand overrides go in KEEP.
"""
import json
import pathlib
import re
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
# Checked by hand and alive although a signal says otherwise (bot walls, odd hosting, ...): id -> note.
KEEP = {
    "tango": "tango.lat resolves to a security-vendor DNS sinkhole on some networks, not a lapsed domain",
    "moblix": "answering customers on Reclame Aqui in Feb 2026; domain lapse may be a move",
}
# Checked by hand and gone although no automatic signal fires: id -> reason (with a source).
DEAD = {
    "hash": "wound down in 2022 after failing to raise (https://ca.finance.yahoo.com/news/qed-investors-backed-fintech-hash-202954686.html)",
    "trela": "announced the end of its operations in 2026 (https://www.infomoney.com.br/?p=3278867)",
    "voltz-motors": "in judicial recovery with operations halted; site down since 2025 (https://neofeed.com.br/startups/com-divida-de-r-3351-milhoes-voltz-se-prepara-para-recuperacao-judicial/)",
    "magnetis": "acquired by BTG Pactual in 2023; site now redirects to BTG (https://www.bloomberglinea.com.br/negocios/btg-pactual-retoma-ma-e-compra-magnetis-gestora-digital-que-atende-alta-renda/)",
    "framework-science": "domain expired (fwscience.us redirects to an expired-domains marketplace)",
    "sled": "domain no longer connected to its site (Wix 'ConnectYourDomain' error)",
    "democracyos": "domain taken over: democracyos.org redirects to an unrelated download site",
    "seshat-financial-services": "hosting lapsed (HTTP 402 Payment Required), no archived site",
}

PARKED = re.compile(
    r"domain (?:name )?(?:is |may be )?for sale|buy this domain|this domain (?:is|has been) registered|"
    r"dom[ií]nio (?:est[aá] )?(?:à|a) venda|dominio (?:est[aá] )?en venta|este dom[ií]nio foi registrado|"
    r"sedoparking|parkingcrew|bodis\.com|dan\.com/buy|afternic|hugedomains|godaddy\.com/domainsearch|"
    r"domain parking|parked (?:free|domain)|account (?:has been )?suspended|cuenta suspendida|conta suspensa|"
    r"site (?:is )?(?:temporarily )?(?:unavailable|suspended)|this site is currently not available|"
    r"registro\.br.{0,80}(?:aguardando|em processo)|future home of something|"
    r"default web site page|welcome to nginx|it works!|apache2? (?:ubuntu|debian)? ?default page|"
    r"index of /|web hosting by|hostinger.{0,40}(?:parked|domain)", re.I)
CLOSED = re.compile(
    r"encerr(?:amos|ou|aram) (?:as |suas |nossas )?(?:atividades|opera[cç][oõ]es)|"
    r"(?:cerramos|cerr[oó]) (?:sus |nuestras )?operaciones|dejamos de operar|deixamos de operar|"
    r"(?:we|we've|we have|we're|we are) (?:shut|shutting|closed|closing) (?:down|our doors)|"
    r"(?:has|have) (?:officially )?(?:shut down|ceased operations)|is no longer (?:operating|in operation|available)|"
    r"ha cerrado (?:sus )?(?:puertas|operaciones)|fechou as portas|chegou ao fim|we are winding down|"
    r"(?:nos despedimos|nos despedimos de ustedes)|thank you for (?:the|an) (?:amazing )?(?:journey|ride)", re.I)
SSL_CTX = ssl.create_default_context()


def resolves(host):
    try:
        socket.getaddrinfo(host, 443)
        return True
    except socket.gaierror:
        return False
    except Exception:
        return True


def domain(host):
    host = host.lower().split(":")[0].removeprefix("www.")
    parts = host.split(".")
    # keep the registrable part: foo.com.br -> foo.com.br, app.foo.com -> foo.com
    n = 3 if len(parts) >= 3 and parts[-2] in ("com", "co", "net", "org", "gob", "gov", "edu") and len(parts[-1]) == 2 else 2
    return ".".join(parts[-n:])


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "en,es,pt"})
    with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
        return r.status, r.geturl(), r.read(1_500_000).decode("utf-8", "replace")


def wayback_last(site):
    """Timestamp (YYYYMMDD) of the newest Wayback snapshot that answered 200, or None."""
    try:
        q = urllib.parse.urlencode({"url": site, "output": "json", "limit": "-1", "filter": "statuscode:200",
                                    "fl": "timestamp", "fastLatest": "true"})
        with urllib.request.urlopen(urllib.request.Request("https://web.archive.org/cdx/search/cdx?" + q,
                                                           headers={"User-Agent": UA}), timeout=30) as r:
            rows = json.loads(r.read() or b"[]")
        return rows[-1][0][:8] if len(rows) > 1 else None
    except Exception:
        return None


def visible(html):
    html = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def check(c):
    out = {"id": c["id"]}
    site = (c.get("website") or "").strip("/").split("/")[0]
    if not site:
        out["signal"] = "no-website"
        return out
    host = site.removeprefix("www.")
    if not resolves(host) and not resolves("www." + host):
        out["signal"] = "dns"
        return out
    err = None
    for base in (f"https://{host}/", f"https://www.{host}/", f"http://{host}/", f"http://www.{host}/"):
        try:
            status, final, html = fetch(base)
            break
        except urllib.error.HTTPError as e:
            # 401/403/429 come from bot walls (Cloudflare, Akamai): the site is there.
            if e.code in (401, 403, 429):
                out["signal"] = "alive"
                out["note"] = f"HTTP {e.code} (bot wall)"
                return out
            err = f"HTTP {e.code}"
        except Exception as e:
            err = err or f"{type(e).__name__}: {getattr(e, 'reason', e)}"[:120]
    else:
        out["signal"] = "down"
        out["note"] = err
        out["wayback_last_ok"] = wayback_last(host)
        return out
    text = visible(html)
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    out["title"] = re.sub(r"\s+", " ", title.group(1)).strip()[:120] if title else None
    head = text[:4000]
    m = PARKED.search(head + " " + (out["title"] or ""))
    if m and len(text) < 6000:
        out["signal"], out["note"] = "parked", m.group(0)
        return out
    m = CLOSED.search(text[:20000])
    if m:
        out["signal"], out["note"] = "closed", text[max(0, m.start() - 120):m.end() + 160]
        return out
    fd = domain(urllib.parse.urlparse(final).netloc)
    if fd != domain(host):
        out["signal"], out["note"] = "moved", final
        return out
    if len(text) < 80 and "<script" not in html.lower():
        out["signal"], out["note"] = "empty", text[:80]
        return out
    out["signal"] = "alive"
    return out


def yc_status():
    try:
        req = urllib.request.Request("https://yc-oss.github.io/api/companies/all.json", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.loads(r.read())
    except Exception as e:
        print(f"yc directory unavailable: {e}", file=sys.stderr)
        return {}
    out = {}
    for r in rows:
        for key in (domain(urllib.parse.urlparse(r.get("website") or "").netloc or "x"), (r.get("name") or "").lower()):
            out.setdefault(key, r.get("status"))
    return out


def main():
    companies = json.loads((ROOT / "data/companies.json").read_text())
    built = {}
    try:
        built = {c["id"]: len(c.get("jobs") or []) for c in json.loads((ROOT / "web/public/data.json").read_text())["companies"]}
    except Exception:
        pass
    yc = yc_status()
    todo = [c for c in companies if not built.get(c["id"])]
    with ThreadPoolExecutor(24) as ex:
        res = {r["id"]: r for r in ex.map(check, todo)}
    for c in companies:
        if built.get(c["id"]):
            res[c["id"]] = {"id": c["id"], "signal": "jobs", "note": f"{built[c['id']]} open jobs"}
            continue
        r = res[c["id"]]
        st = yc.get(domain(c.get("website") or "x")) or (yc.get(c["name"].lower()) if c.get("listed_by") == "yc" else None)
        if st:
            r["yc"] = st
            if st == "Inactive" and r["signal"] not in ("jobs",):
                r["signal"] = "yc"
        if c["id"] in DEAD:
            r["signal"], r["note"] = "manual", DEAD[c["id"]]
        if c["id"] in KEEP:
            r["signal"], r["note"] = "alive", "kept: " + KEEP[c["id"]]
    dead = {k: r for k, r in res.items() if r["signal"] in ("dns", "parked", "closed", "yc", "manual")}
    (ROOT / "data/liveness.json").write_text(json.dumps(dict(sorted(res.items())), ensure_ascii=False, indent=1) + "\n")
    from collections import Counter
    print(Counter(r["signal"] for r in res.values()))
    byid = {c["id"]: c for c in companies}
    for sig in ("dns", "parked", "closed", "yc", "manual", "down", "moved", "empty"):
        rows = [r for r in res.values() if r["signal"] == sig]
        if rows:
            print(f"\n== {sig} ({len(rows)})")
            for r in sorted(rows, key=lambda r: r["id"]):
                c = byid[r["id"]]
                print(f"  {r['id']:<34} {c.get('website') or '':<28} {(r.get('note') or '')[:110]!s} {r.get('wayback_last_ok') or ''} {r.get('yc') or ''}")
    if "--apply" in sys.argv:
        path = ROOT / "data/removed.json"
        removed = json.loads(path.read_text()) if path.exists() else {}
        for c in companies:
            if c["id"] in dead:
                r = dead[c["id"]]
                removed[c["id"]] = {"name": c["name"], "website": c.get("website"), "signal": r["signal"],
                                    "note": r.get("note"), "company": c}
        keep = [c for c in companies if c["id"] not in dead]
        (ROOT / "data/companies.json").write_text(json.dumps(keep, ensure_ascii=False, indent=1) + "\n")
        path.write_text(json.dumps(dict(sorted(removed.items())), ensure_ascii=False, indent=1) + "\n")
        print(f"\nremoved {len(dead)} companies -> data/removed.json; {len(keep)} remain")


if __name__ == "__main__":
    main()
