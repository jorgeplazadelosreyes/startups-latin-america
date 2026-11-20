"""Run the whole data pipeline in order.

    python3 scripts/pipeline.py                 # everything, re-using the cached directory crawl
    python3 scripts/pipeline.py --crawl         # also re-crawl startup directories (slow: ~40 min)
    python3 scripts/pipeline.py --from offices  # resume from a step

Steps: sources (new companies) -> detect (job boards) -> scrape (websites) -> build (jobs, feed addresses)
-> offices (geocode HQs) -> wikidata (facts) -> build (final data.json). Each step only reads files earlier
steps wrote, so a failed step can be re-run with --from.
"""
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
STEPS = [
    ("sources", ["sources.py", "--apply"]),
    ("detect", ["detect.py", "--apply"]),
    ("scrape", ["scrape_companies.py"]),
    ("build", ["build.py"]),
    ("offices", ["offices.py"]),
    ("wikidata", ["wikidata.py"]),
    ("final", ["build.py"]),
]


def main():
    args = sys.argv[1:]
    start = args[args.index("--from") + 1] if "--from" in args else STEPS[0][0]
    names = [n for n, _ in STEPS]
    if start not in names:
        sys.exit(f"unknown step {start!r}; steps: {', '.join(names)}")
    for name, cmd in STEPS[names.index(start):]:
        if name == "sources" and "--crawl" not in args:
            cmd = cmd + ["--cached"]
        t = time.time()
        print(f"\n== {name}: {' '.join(cmd)}", flush=True)
        r = subprocess.run([sys.executable, str(HERE / cmd[0]), *cmd[1:]])
        if r.returncode:
            sys.exit(f"step {name} failed (exit {r.returncode}); fix it and resume with --from {name}")
        print(f"== {name} done in {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()
