"""Probe each candidate's slug guesses against every supported ATS.
Writes data/discovery.json: every board that answered, with job count and LatAm share,
so a human can confirm matches before they go into data/companies.json.

    python3 scripts/discover.py
"""
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ats  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def probe(task):
    name, a, slug = task
    try:
        jobs = ats.fetch(a, slug)
    except Exception:
        return None
    if not jobs:
        return {"name": name, "ats": a, "slug": slug, "jobs": 0, "latam_share": None, "sample": []}
    latam = sum(ats.is_latam(j["location"]) for j in jobs)
    return {
        "name": name, "ats": a, "slug": slug, "jobs": len(jobs),
        "latam_share": round(latam / len(jobs), 2),
        "sample": sorted({j["location"] for j in jobs})[:5],
    }


def main():
    cands = json.loads((ROOT / "data/candidates.json").read_text())
    tasks = [(c["name"], a, s) for c in cands for s in c["slugs"] for a in ats.ATS]
    with ThreadPoolExecutor(32) as ex:
        hits = [r for r in ex.map(probe, tasks) if r]
    hits.sort(key=lambda r: (r["name"], -r["jobs"]))
    (ROOT / "data/discovery.json").write_text(json.dumps(hits, ensure_ascii=False, indent=1))
    found = {h["name"] for h in hits}
    print(f"{len(tasks)} probes, {len(hits)} boards answered, {len(found)}/{len(cands)} companies")
    for h in hits:
        print(f'{h["name"]:<24} {h["ats"]:<16} {h["slug"]:<16} jobs={h["jobs"]:<4} latam={h["latam_share"]} {h["sample"][:3]}')


if __name__ == "__main__":
    main()
