# LatAm Startup Map

A free map of Latin American startups that are hiring — the LatAm take on [startupmap.one](https://startupmap.one/).
Jobs are pulled from each company's public careers feed (Greenhouse, Lever, Ashby, Workable, Gupy, Teamtailor, InHire,
BambooHR, Workday, Get on Board, HiringRoom, Buk, PeopleForce, YC's Work at a Startup, …);
no backend, no keys.


## Run locally

```sh
python3 scripts/liveness.py         # optional: report companies that look defunct (--apply removes them)
python3 scripts/detect.py --apply   # optional: find job boards for untracked companies
python3 scripts/scrape_companies.py # optional: refresh company facts from their websites
python3 scripts/wikidata.py         # optional: founding year, headcount, founders from Wikidata
python3 scripts/build.py      # fetch live jobs -> web/public/data.json (stdlib only)
cd web && npm install
npm run dev                   # http://localhost:5173
npm run build                 # static site -> web/dist
```

## The app

A Vite + React + TypeScript single-page app (Tailwind, MapLibre + deck.gl, ECharts, cmdk). Every filter, view
and open company lives in the URL, so any view is a shareable link.

| View | What |
|---|---|
| Map | The sidebar lists the companies and jobs inside the visible area. Default mode drills down: zoomed out, a flag + name per country; click it for its cities; click a city to see each company's logo at its office. Other modes: city hubs, job heatmap, 3D hexagons, and HQ → hiring-city flow arcs. Heat/3D/flows have a time scrubber that replays postings |
| Jobs | Virtualized, sortable table; star jobs to save them (local to the browser); CSV export |
| Companies | Card grid with role-mix bars; sort and group by any company dimension |
| Explore | Pivot heatmap (any two dimensions), multi-stage Sankey, sunburst, treemap, force network. Clicks filter |
| Trends | Weekly postings stacked by any dimension, posting calendar, hiring velocity, seniority × work mode, posting language by country, title keywords |
| Sources | Per-ATS stats, freshness and location quality by source, coverage gaps, discovery-probe matrix, full data lineage with raw feed URLs |

⌘K (or `/`) opens a palette that searches companies, jobs, cities, sectors and roles. Jobs are enriched in the
browser (`web/src/lib/enrich.ts`): role family, seniority, work mode and posting language come from title
regexes (EN/PT/ES), and locations are geocoded with a small gazetteer (`web/src/lib/geo.ts`). New dimensions only
need an entry in `web/src/lib/dims.ts` to show up in facets, pivot, Sankey and trends.

The build also reads each job description (`scripts/extract.py`) for skills, pay range, English level, years of
experience, benefits, contract type and a one-line summary. These show on job rows and are filterable (Skill,
English, Contract, Pay shown). The descriptions themselves are not shipped.

## Layout

| Path | What |
|---|---|
| `data/companies.json` | Curated company list: city, sector, stage, and the confirmed ATS board (`ats`, `ats_slug`) |
| `data/cities.json` | City names + coordinates |
| `data/candidates.json` | Seed list with slug guesses, input to discovery |
| `scripts/ats.py` | One adapter per ATS, all returning the same job shape |
| `scripts/detect.py` | Finds each company's board: crawls its website, sitemap, careers subdomains/pages and their JS bundles for ATS links (or schema.org JobPosting pages, read by the generic `jsonld` adapter), then probes slug guesses on every ATS. Linked boards are trusted; guesses must be mostly LatAm with jobs in the HQ country. `--apply` writes matches to `data/companies.json`; all hits go to `data/discovery.json` |
| `scripts/discover.py` | Probes hand-written slug guesses from `data/candidates.json` (older, manual flow) |
| `scripts/liveness.py` | Flags defunct companies: domain no longer resolves, parked/suspended site, a shutdown notice on the site, YC marks it Inactive, plus hand-checked `DEAD`/`KEEP` overrides with sources. Down and redirecting sites are only reported. `--apply` moves dead ones to `data/removed.json` (with the reason), which `sources.py` skips so they aren't re-added. Run by hand and read the report first: it is not part of the daily build |
| `data/removed.json` | Companies removed as defunct, each with its signal, note and the full original entry |
| `scripts/wikidata.py` | Matches companies to Wikidata by official-website domain → founding year, headcount, founders, X, LinkedIn |
| `scripts/scrape_companies.py` | Reads each company's website (home, contact/about/legal pages, sitemap) → `data/company_info.json`: description, logo icon, LinkedIn, founding year, headcount, CNPJs, address candidates |
| `data/web_addresses.json` | HQ addresses found by web search, each with the page it came from |
| `data/offices.json` | Street pins per company: `hq`, `extra` offices, and `manual` entries (`{"address", "source_url"}`) |
| `scripts/offices.py` | Geocodes address candidates (manual → web search → CNPJ registry → website → job postings → OpenStreetMap office tagged with the company's website or named after it) with OpenStreetMap; a pin is kept only within 40 km of the HQ city (or of another mapped city, as an extra office) |
| `scripts/extract.py` | Pattern-based facts from job descriptions (EN/PT/ES) |
| `scripts/build.py` | Fetches jobs for confirmed boards, keeps LatAm/remote ones, writes `web/public/data.json` |
| `web/` | The front end |

## Adding a company

1. Add it to `data/companies.json` with `ats`/`ats_slug` set to `null` (new cities also need `data/cities.json`).
2. Run `python3 scripts/detect.py --apply`. Check its line in the output: **`guess` matches are worth a look**
   (sample locations, `latam_share`), since short slugs can belong to an unrelated company.
3. If nothing is found, the board may be on an unsupported ATS or behind a JS-only careers page. Set
   `ats`/`ats_slug` by hand (Workday slugs look like `rappi.wd12/Rappi_jobs`; Teamtailor accepts a custom domain).

## Known limits

- 85 of 138 HQs have a street pin; the rest show as hollow rings around their city center. Many addresses come
  from company sites, legal notices or business directories and can be out of date; each one links its source
  in the company drawer. Other office cities mostly come from job locations (2+ city-level jobs there).
- Few postings state pay (6 of 930), so "Pay shown" is mostly "No pay info".
- Company sector/stage are coarse and hand-curated; stage buckets are Early (seed/A), Growth (B/C), Late (D+), Public.
- 67 of 138 companies have no feed found yet and show as "jobs not tracked". Most have JS-only careers pages,
  post on LinkedIn only, or use an ATS without a public API (Pismo's jobs live on parent Visa's Workday, so it's skipped).

## Deploy

`.github/workflows/refresh.yml` refreshes jobs daily, builds `web/` and publishes `web/dist` to GitHub Pages
(enable Pages → "GitHub Actions" in repo settings).
