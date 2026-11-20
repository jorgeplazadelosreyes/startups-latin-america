"""Adapters for public ATS job-board feeds. Each returns a list of normalized jobs:
{"title", "url", "location", "department", "remote", "posted",            (posted = ISO date or None)
 "description", "employment", "address", "salary"}                         (detail fields, may be None)

description is plain text (scripts/extract.py turns it into skills, pay, etc. and it is not shipped);
address is a street-level address when the feed has one (Gupy, some Ashby boards).
"""
import html as _html_mod
import json
import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
import urllib.request
import urllib.error

UA = "Mozilla/5.0 (compatible; latam-startup-map/0.1)"
TIMEOUT = 20
DETAILS = True  # fetch per-job detail pages (descriptions); detect.py turns this off to probe quickly


def _get(url, data=None, headers=None):
    headers = {"User-Agent": UA, "Accept": "application/json", **(headers or {})}
    if data is not None:
        data = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    for attempt in range(3):  # retry timeouts and 5xx/429; 404 etc. fail at once
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
            if e.code == 429:
                import time
                time.sleep(min(30, int(e.headers.get("Retry-After") or 0) or 5 * (attempt + 1)))
        except (TimeoutError, urllib.error.URLError) as e:
            if attempt == 2 or (isinstance(e, urllib.error.URLError) and not isinstance(e.reason, TimeoutError)):
                raise
        import time
        time.sleep(1 + attempt * 2)


def _remote(*texts):
    t = " ".join(x or "" for x in texts).lower()
    return any(k in t for k in ("remote", "remoto", "anywhere", "home office", "teletrabajo"))


LATAM_WORDS = [
    "brazil", "brasil", "paulo", "rio de janeiro", "curitiba", "belo horizonte", "florian",
    "joinville", "campinas", "mexico", "méxico", "cdmx", "guadalajara", "monterrey", "colombia",
    "bogot", "medell", "argentina", "buenos aires", "córdoba", "chile", "santiago", "uruguay",
    "montevideo", "peru", "perú", "lima", "ecuador", "quito", "guayaquil", "el salvador",
    "costa rica", "panam", "guatemala", "latam", "latin america", "américa latina", "south america",
    "bolivia", "la paz", "santa cruz de la sierra", "cochabamba", "paraguay", "asunci", "venezuela", "caracas",
    "honduras", "tegucigalpa", "nicaragua", "managua", "dominican", "santo domingo", "puerto rico",
]


def is_latam(loc):
    loc = (loc or "").lower()
    return any(w in loc for w in LATAM_WORDS)


def _job(title, url, location, department=None, remote=None, posted=None,
         description=None, employment=None, address=None, salary=None):
    return {
        "title": (title or "").strip(),
        "url": url,
        "location": (location or "").strip(),
        "department": (department or "").strip(),
        "remote": bool(remote) if remote is not None else _remote(title, location),
        "posted": (posted or "")[:10] or None,
        "description": text(description),
        "employment": (employment or "").strip() or None,
        "address": (address or "").strip() or None,
        "salary": salary or None,
    }


def text(html):
    """HTML (possibly entity-escaped twice, as Greenhouse does) -> plain text with line breaks."""
    if not html:
        return None
    t = _html_mod.unescape(_html_mod.unescape(html))
    t = re.sub(r"<(br|/p|/li|/h\d|/div)[^>]*>", "\n", t, flags=re.I)
    t = re.sub(r"<li[^>]*>", "\n- ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def _iso_ms(ms):
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).date().isoformat() if ms else None


def greenhouse(slug):
    d = _get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true")
    return [
        _job(j["title"], j["absolute_url"], (j.get("location") or {}).get("name"),
             (j.get("departments") or [{}])[0].get("name"),
             posted=j.get("first_published") or j.get("updated_at"),
             description=j.get("content"))
        for j in d.get("jobs", [])
    ]


def lever(slug):
    d = _get(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    out = []
    for j in d:
        c = j.get("categories") or {}
        wt = j.get("workplaceType")
        parts = [j.get("descriptionPlain") or ""]
        for lst in j.get("lists") or []:
            parts.append(lst.get("text", "") + "\n" + (text(lst.get("content")) or ""))
        parts.append(j.get("additionalPlain") or "")
        sal = j.get("salaryRange")
        out.append(_job(j["text"], j["hostedUrl"], c.get("location"), c.get("team"),
                        remote=(wt == "remote") or _remote(c.get("location")),
                        posted=_iso_ms(j.get("createdAt")),
                        description="\n".join(parts).replace("\n", "<br>"),
                        employment=c.get("commitment"),
                        salary=sal and {"min": sal.get("min"), "max": sal.get("max"), "currency": sal.get("currency"), "period": sal.get("interval")}))
    return out


def ashby(slug):
    d = _get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true")
    out = []
    for j in d.get("jobs", []):
        if not j.get("isListed", True):
            continue
        pa = ((j.get("address") or {}).get("postalAddress") or {})
        street = pa.get("streetAddress")
        addr = ", ".join(x for x in (street, pa.get("addressLocality"), pa.get("addressCountry")) if x) if street else None
        comp = (j.get("compensation") or {}).get("scrapeableCompensationSalarySummary") or (j.get("compensation") or {}).get("compensationTierSummary")
        out.append(_job(j["title"], j["jobUrl"], j.get("location"), j.get("department"),
                        remote=j.get("isRemote") or _remote(j.get("location")),
                        posted=j.get("publishedAt"),
                        description=(j.get("descriptionPlain") or "").replace("\n", "<br>"),
                        employment=j.get("employmentType"), address=addr,
                        salary=comp and {"text": comp}))
    return out


def workable(slug):
    d = _get(f"https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true")
    out = []
    for j in d.get("jobs", []):
        loc = ", ".join(x for x in (j.get("city"), j.get("country")) if x)
        out.append(_job(j["title"], j.get("url") or j.get("shortlink"), loc, j.get("department"),
                        remote=j.get("telecommuting") or _remote(loc),
                        posted=j.get("published_on") or j.get("created_at"),
                        description=j.get("description"), employment=j.get("employment_type")))
    return out


def _pmap(fn, items, n=8):
    """Fetch per-job detail pages in parallel; a failing page yields {} instead of dropping the board."""
    from concurrent.futures import ThreadPoolExecutor

    def safe(x):
        try:
            return fn(x) or {}
        except Exception:
            return {}
    if not DETAILS:
        return [{} for _ in items]
    with ThreadPoolExecutor(n) as ex:
        return list(ex.map(safe, items))


def smartrecruiters(slug):
    base = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    rows, offset = [], 0
    while True:  # paginated, 100 per page
        d = _get(f"{base}?limit=100&offset={offset}")
        rows += d.get("content", [])
        offset += 100
        if offset >= d.get("totalFound", 0) or not d.get("content"):
            break
    details = _pmap(lambda j: _get(f"{base}/{j['id']}"), rows)
    out = []
    for j, det in zip(rows, details):
        sections = ((det.get("jobAd") or {}).get("sections") or {})
        desc = "<br>".join((sections.get(k) or {}).get("text") or "" for k in ("companyDescription", "jobDescription", "qualifications", "additionalInformation"))
        loc = j.get("location") or {}
        locs = ", ".join(x for x in (loc.get("city"), loc.get("country", "").upper()) if x)
        out.append(_job(j["name"], f"https://jobs.smartrecruiters.com/{slug}/{j['id']}", locs,
                        (j.get("department") or {}).get("label"),
                        remote=loc.get("remote") or _remote(locs),
                        posted=j.get("releasedDate"), description=desc or None,
                        employment=(j.get("typeOfEmployment") or {}).get("label"),
                        address=loc.get("address")))
    return out


def recruitee(slug):
    d = _get(f"https://{slug}.recruitee.com/api/offers/")
    return [
        _job(j["title"], j["careers_url"], j.get("location"), j.get("department"),
             remote=j.get("remote") or _remote(j.get("location")),
             posted=j.get("published_at"),
             description=(j.get("description") or "") + (j.get("requirements") or ""),
             employment=j.get("employment_type_code"))
        for j in d.get("offers", [])
    ]


def breezy(slug):
    d = _get(f"https://{slug}.breezy.hr/json")
    out = []
    for j in d:
        loc = (j.get("location") or {}).get("name")
        out.append(_job(j["name"], j["url"], loc, j.get("department"),
                        remote=(j.get("location") or {}).get("is_remote") or _remote(loc),
                        posted=j.get("published_date"),
                        employment=(j.get("type") or {}).get("name")))
    return out


def _html(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


def _next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1))["props"]["pageProps"] if m else None


def gupy(slug):
    """Gupy has no public list API; the career page embeds its job list in __NEXT_DATA__.
    Each job page adds the description, publish date and the office's street address."""
    final, html = _html(f"https://{slug}.gupy.io/")
    pp = _next_data(html)
    if not pp or ".gupy.io" not in final or "careerPage" not in pp:
        raise ValueError("not a gupy board")
    rows = pp.get("jobs") or []
    details = _pmap(lambda j: (_next_data(_html(f"https://{slug}.gupy.io/jobs/{j['id']}")[1]) or {}).get("job"), rows)
    out = []
    for j, detail in zip(rows, details):
        wp = j.get("workplace") or {}
        a = wp.get("address") or {}
        loc = ", ".join(x for x in (a.get("city"), a.get("stateShortName"), a.get("country")) if x)
        url = f"https://{slug}.gupy.io/jobs/{j['id']}"
        desc = "<br>".join(x for x in (detail.get("description"), detail.get("responsibilities"), detail.get("prerequisites"), detail.get("relevantExperiences")) if x)
        out.append(_job(j["title"], url, loc, j.get("department"),
                        remote=wp.get("workplaceType") == "remote" or _remote(loc),
                        posted=detail.get("publishedAt"), description=desc or None,
                        employment={"vacancy_type_effective": "Full-time (CLT)", "vacancy_type_internship": "Internship",
                                    "vacancy_type_temporary": "Temporary", "vacancy_type_associate": "Contractor (PJ)"}.get(detail.get("jobType") or j.get("type")),
                        address=detail.get("addressLine")))
    return out


def _host(slug, suffix):
    """A slug is a subdomain ("loft", "robot.na") or, for boards on a custom domain, the full host."""
    return slug if re.search(r"\.[a-z]{2,}$", slug) and not slug.endswith((".na", ".eu")) else f"{slug}{suffix}"


def teamtailor(slug):
    final, xml = _html(f"https://{_host(slug, '.teamtailor.com')}/jobs.rss")
    root = ET.fromstring(xml)
    ns = {"tt": "https://teamtailor.com/locations"}
    out = []
    for it in root.iter("item"):
        locs, addr = [], None
        for l in it.findall(".//tt:location", ns):
            parts = [l.findtext(f"tt:{k}", "", ns) for k in ("city", "country")]
            locs.append(", ".join(p for p in parts if p))
            street = l.findtext("tt:address", "", ns)
            if street and not addr:
                addr = ", ".join(p for p in (street, parts[0], parts[1]) if p)
        loc = " / ".join(x for x in locs if x)
        posted = None
        if it.findtext("pubDate"):
            try:
                posted = parsedate_to_datetime(it.findtext("pubDate")).date().isoformat()
            except (TypeError, ValueError):
                pass
        remote = (it.findtext("remoteStatus") or "").lower() in ("fully", "remote")
        out.append(_job(it.findtext("title"), it.findtext("link"), loc,
                        it.findtext("department"), remote=remote or _remote(loc), posted=posted,
                        description=it.findtext("description"), address=addr))
    return out


COUNTRY = {"BR": "Brazil", "MX": "Mexico", "CO": "Colombia", "AR": "Argentina", "CL": "Chile", "PE": "Peru",
           "UY": "Uruguay", "EC": "Ecuador", "CR": "Costa Rica", "PA": "Panama", "GT": "Guatemala", "SV": "El Salvador",
           "US": "United States", "ES": "Spain", "PT": "Portugal"}


def inhire(slug):
    """InHire (Brazil): public career page API keyed by the X-Tenant header; one detail call per job."""
    h = {"X-Tenant": slug}
    d = _get("https://api.inhire.app/job-posts/public/pages", headers=h)
    rows = [j for j in d.get("jobsPage") or [] if j.get("status", "published") == "published"]
    details = _pmap(lambda j: _get(f"https://api.inhire.app/job-posts/public/pages/{j['jobId']}", headers=h), rows)
    out = []
    for j, det in zip(rows, details):
        loc = ", ".join(COUNTRY.get(p.strip(), p.strip()) for p in (j.get("location") or "").split(",") if p.strip())
        wt = (j.get("workplaceType") or "").lower()
        if wt == "remote" and "remot" not in loc.lower():
            loc = f"Remote, {loc}" if loc else "Remote"
        out.append(_job(j.get("displayName"), f"https://{slug}.inhire.app/vagas/{j['jobId']}", loc,
                        det.get("department") or j.get("department"), remote=wt == "remote" or None,
                        posted=det.get("publishedAt") or det.get("createdAt"), description=det.get("description"),
                        employment=", ".join(det.get("contractType") or []) or None))
    return out


def bamboohr(slug):
    rows = _get(f"https://{slug}.bamboohr.com/careers/list").get("result") or []
    details = _pmap(lambda j: _get(f"https://{slug}.bamboohr.com/careers/{j['id']}/detail").get("result", {}).get("jobOpening"), rows)
    out = []
    for j, det in zip(rows, details):
        l = det.get("location") or j.get("location") or {}
        al = j.get("atsLocation") or {}
        loc = ", ".join(x for x in (l.get("city") or al.get("city"), l.get("state") or al.get("state"),
                                    l.get("addressCountry") or al.get("country")) if x)
        remote = j.get("isRemote") or j.get("locationType") == "1"
        out.append(_job(j.get("jobOpeningName"), f"https://{slug}.bamboohr.com/careers/{j['id']}",
                        loc or ("Remote" if remote else ""), j.get("departmentLabel"), remote=remote or None,
                        posted=det.get("datePosted"), description=det.get("description"),
                        employment=j.get("employmentStatusLabel"),
                        salary=det.get("compensation") and {"text": det.get("compensation")}))
    return out


def workday(slug):
    """Workday: slug is "<tenant>.<wdN>/<site>", e.g. "rappi.wd12/Rappi_jobs"."""
    host, site = slug.split("/", 1)
    tenant = host.split(".")[0]
    base = f"https://{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"
    rows, offset = [], 0
    while True:
        d = _get(f"{base}/jobs", data={"limit": 20, "offset": offset, "appliedFacets": {}, "searchText": ""})
        rows += d.get("jobPostings") or []
        offset += 20
        if offset >= (d.get("total") or 0) or not d.get("jobPostings") or offset >= 2000:
            break
    details = _pmap(lambda j: _get(base + j["externalPath"]).get("jobPostingInfo"), rows)
    out = []
    for j, det in zip(rows, details):
        loc = det.get("location") or j.get("locationsText") or ""
        country = ((det.get("country") or {}).get("descriptor"))
        if country and country.lower() not in loc.lower():
            loc = f"{loc}, {country}"
        out.append(_job(j["title"], det.get("externalUrl") or f"https://{host}.myworkdayjobs.com/{site}{j['externalPath']}",
                        loc, None, remote=None, posted=det.get("startDate"),
                        description=det.get("jobDescription"), employment=det.get("timeType") or j.get("timeType")))
    return out


GETONBRD_SENIORITY = {1: "No experience", 2: "Junior", 3: "Semi Senior", 4: "Senior", 5: "Expert"}


def getonbrd(slug):
    """Get on Board (Chile/LatAm tech job board): companies post their roles with salary ranges."""
    import datetime
    rows, page = [], 1
    while True:
        d = _get(f"https://www.getonbrd.com/api/v0/companies/{slug}/jobs?per_page=100&page={page}")
        rows += d.get("data") or []
        if page >= ((d.get("meta") or {}).get("total_pages") or 1):
            break
        page += 1
    out = []
    for j in rows:
        a = j["attributes"]
        loc = ", ".join(a.get("countries") or [])
        desc = "<br>".join(f"{a.get(k + '_headline') or ''}<br>{a.get(k) or ''}" for k in ("description", "functions", "desirable", "benefits") if a.get(k))
        lo, hi = a.get("min_salary"), a.get("max_salary")
        posted = a.get("published_at")
        out.append(_job(a["title"], (j.get("links") or {}).get("public_url"), loc, a.get("category_name"),
                        remote=a.get("remote"), description=(a.get("projects") or "") + "<br>" + desc,
                        posted=datetime.datetime.fromtimestamp(posted, datetime.timezone.utc).date().isoformat() if posted else None,
                        salary=(lo or hi) and {"min": lo, "max": hi, "currency": "USD", "period": "month"}))
    return out


ATS = {
    "gupy": gupy,
    "teamtailor": teamtailor,
    "greenhouse": greenhouse,
    "lever": lever,
    "ashby": ashby,
    "workable": workable,
    "smartrecruiters": smartrecruiters,
    "recruitee": recruitee,
    "breezy": breezy,
    "inhire": inhire,
    "bamboohr": bamboohr,
    "workday": workday,
    "getonbrd": getonbrd,
}


def fetch(ats, slug):
    return ATS[ats](slug)


JOB_LINK = re.compile(r"/(?:jobs?|vagas?|vacantes?|empleos?|careers?|carreiras?|positions?|openings?|oportunidades?)/[\w%.-]{4,}", re.I)


def _jobpostings(html):
    """schema.org JobPosting objects embedded as JSON-LD (what Google for Jobs reads)."""
    out = []
    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            d = json.loads(m.group(1).strip())
        except ValueError:
            continue
        stack = [d]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                if "JobPosting" in str(x.get("@type")):
                    out.append(x)
                else:
                    stack.extend(v for v in x.values() if isinstance(v, (dict, list)))
    return out


def _jp_location(p):
    locs = p.get("jobLocation") or []
    locs = locs if isinstance(locs, list) else [locs]
    parts = []
    for l in locs:
        a = (l or {}).get("address") or {}
        if isinstance(a, str):
            parts.append(a)
            continue
        country = a.get("addressCountry")
        country = country.get("name") if isinstance(country, dict) else country
        parts.append(", ".join(str(x) for x in (a.get("addressLocality"), a.get("addressRegion"), COUNTRY.get(country, country)) if x))
    loc = " / ".join(x for x in parts if x)
    if "TELECOMMUTE" in str(p.get("jobLocationType", "")).upper():
        loc = f"Remote, {loc}" if loc else "Remote"
    return loc


def jsonld(slug, link_rx=None):
    """Any careers site that publishes schema.org JobPosting: slug is the listing page URL. Reads postings on the
    page itself and on every job-looking link from it (same host; link_rx overrides what counts as a job link)."""
    import urllib.parse
    final, html = _html(slug)
    found = {}
    for p in _jobpostings(html):
        found[p.get("url") or final + "#" + str(len(found))] = p
    host = urllib.parse.urlparse(final).netloc
    links = []
    for href in re.findall(r'href=["\']([^"\'#?]+)', html):
        u = urllib.parse.urljoin(final, href)
        if urllib.parse.urlparse(u).netloc == host and (link_rx or JOB_LINK).search(u) and u not in links and u.rstrip("/") != final.rstrip("/"):
            links.append(u)
    links = links[:300 if DETAILS else 25]  # probing only needs a sample to see locations
    from concurrent.futures import ThreadPoolExecutor

    def page(u):
        try:
            return _html(u)[1]
        except Exception:
            return ""
    with ThreadPoolExecutor(8) as ex:
        for u, h in zip(links, ex.map(page, links)):
            for p in _jobpostings(h):
                found.setdefault(p.get("url") or u, p)
    out = []
    for url, p in found.items():
        sal = (p.get("baseSalary") or {}).get("value") if isinstance(p.get("baseSalary"), dict) else None
        sal = sal if isinstance(sal, dict) else {}
        out.append(_job(_html_mod.unescape(str(p.get("title") or "")), url, _jp_location(p),
                        (p.get("hiringOrganization") or {}).get("department") if isinstance(p.get("hiringOrganization"), dict) else None,
                        remote="TELECOMMUTE" in str(p.get("jobLocationType", "")).upper() or None,
                        posted=str(p.get("datePosted") or "") or None, description=p.get("description"),
                        employment=", ".join(p["employmentType"]) if isinstance(p.get("employmentType"), list) else p.get("employmentType"),
                        salary=sal and {"min": sal.get("minValue"), "max": sal.get("maxValue"),
                                        "currency": (p.get("baseSalary") or {}).get("currency"), "period": sal.get("unitText")}))
    return out


ATS["jsonld"] = jsonld


def hiringroom(slug):
    """HiringRoom (Argentina/LatAm): <slug>.hiringroom.com/jobs; each vacancy page carries a JobPosting."""
    final, _ = _html(f"https://{slug}.hiringroom.com/jobs")
    if ".hiringroom.com" not in final:
        raise ValueError("not a hiringroom board")
    return jsonld(f"https://{slug}.hiringroom.com/jobs")


BUK_TLDS = ("cl", "co", "mx", "pe")


def buk(slug):
    """Buk (Chile/Colombia/Mexico/Peru HR suite): job portal at <slug>.buk.<cl|co|mx|pe>/trabaja-con-nosotros, each
    job at /s/<token> with a JobPosting. A slug with a dot is the full host; a bare one tries each country."""
    hosts = [slug] if "." in slug else [f"{slug}.buk.{t}" for t in BUK_TLDS]
    err = None
    for h in hosts:
        try:
            final, _ = _html(f"https://{h}/trabaja-con-nosotros")
        except Exception as e:
            err = e
            continue
        if ".buk." in final:
            return jsonld(f"https://{h}/trabaja-con-nosotros", link_rx=re.compile(r"/s/[A-Za-z0-9]{10,}/?$"))
    raise err or ValueError("not a buk board")


def peopleforce(slug):
    """PeopleForce: <slug>.peopleforce.io/careers lists cards (title, department, contract, location), 10 per page."""
    import urllib.parse
    out, seen = [], set()
    for page in range(1, 21):
        final, html = _html(f"https://{slug}.peopleforce.io/careers?page={page}")
        if ".peopleforce.io/careers" not in final:
            raise ValueError("not a peopleforce board")
        cards = re.split(r'<h4[^>]*>', html)[1:]
        new = 0
        for card in cards:
            m = re.search(r'href="(/careers/v/[^"]+)"[^>]*>([^<]+)</a>', card)
            if not m or m.group(1) in seen:
                continue
            seen.add(m.group(1))
            new += 1
            field = lambda icon: (re.search(rf'fa-{icon}[^>]*></i>\s*([^<]+?)\s*<', card) or [None, None])[1]
            out.append(_job(_html_mod.unescape(m.group(2)), urllib.parse.urljoin(final, m.group(1)),
                            _html_mod.unescape(field("map-marker-alt") or ""), _html_mod.unescape(field("briefcase") or ""),
                            employment=_html_mod.unescape(field("clock") or "") or None))
        if not new:
            break
    return out


def yc(slug):
    """Y Combinator's Work at a Startup: ycombinator.com/companies/<slug>/jobs embeds its postings as Inertia
    page props (data-page). Salary is a display string ("$30K - $42K"), kept as the range text."""
    import time
    for attempt in range(4):  # YC answers bursts with 429
        try:
            final, html = _html(f"https://www.ycombinator.com/companies/{slug}/jobs")
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    m = re.search(r'data-page="([^"]+)"', html)
    if not m:
        raise ValueError("not a yc company page")
    props = json.loads(_html_mod.unescape(m.group(1))).get("props") or {}
    out = []
    for j in props.get("jobPostings") or []:
        loc = j.get("location") or ""
        out.append(_job(j.get("title"), "https://www.ycombinator.com" + (j.get("url") or ""), loc, j.get("prettyRole"),
                        remote="remote" in loc.lower() or None, employment=j.get("type"),
                        salary={"text": j["salaryRange"]} if j.get("salaryRange") else None))
    return out


ATS.update({"hiringroom": hiringroom, "buk": buk, "peopleforce": peopleforce, "yc": yc})
