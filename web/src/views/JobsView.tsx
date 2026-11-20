import { pay } from "../lib/format";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Download, Star } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { useColors } from "../lib/colors";
import { SENIORITIES } from "../lib/enrich";
import { useFiltered } from "../lib/filter";
import { useStore } from "../lib/store";
import type { Job } from "../lib/types";

type Col = { key: string; label: string; get: (j: Job) => string | number; cls: string };

const COLS: Col[] = [
  { key: "title", label: "Role", get: (j) => j.title.toLowerCase(), cls: "flex-[3] min-w-0" },
  { key: "company", label: "Company", get: (j) => j.company.name.toLowerCase(), cls: "flex-[1.6] min-w-0 hidden sm:flex" },
  { key: "family", label: "Family", get: (j) => j.family, cls: "w-32 hidden lg:flex" },
  { key: "seniority", label: "Level", get: (j) => SENIORITIES.indexOf(j.seniority), cls: "w-28 hidden md:flex" },
  { key: "location", label: "Location", get: (j) => j.location.toLowerCase(), cls: "flex-[1.4] min-w-0 hidden xl:flex" },
  { key: "mode", label: "Mode", get: (j) => j.mode, cls: "w-20 hidden md:flex" },
  { key: "posted", label: "Posted", get: (j) => j.posted ?? "", cls: "w-24" },
  { key: "source", label: "Source", get: (j) => j.company.source, cls: "w-24 hidden 2xl:flex" },
];

export default function JobsView() {
  const { jobs } = useFiltered();
  const saved = useStore((s) => s.saved);
  const toggleSaved = useStore((s) => s.toggleSaved);
  const set = useStore((s) => s.set);
  const famColor = useColors("family");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "posted", dir: -1 });
  const [savedOnly, setSavedOnly] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key)!;
    const list = savedOnly ? jobs.filter((j) => saved.includes(j.url)) : jobs;
    return [...list].sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.company.name.localeCompare(b.company.name);
    });
  }, [jobs, sort, savedOnly, saved]);

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 52, overscan: 12 });

  const exportCsv = () => {
    const head = ["title", "company", "family", "seniority", "mode", "location", "countries", "posted", "source", "skills", "pay", "english", "contract", "url"];
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const body = rows.map((j) => [j.title, j.company.name, j.family, j.seniority, j.mode, j.location, j.countries.join("/"), j.posted ?? "", j.company.source, (j.skills ?? []).join("; "), pay(j) ?? "", j.english ?? "", j.employment ?? "", j.url].map((x) => esc(String(x))).join(","));
    const url = URL.createObjectURL(new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "latam-startup-jobs.csv" }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <span className="tabular-nums text-muted"><b className="text-ink">{rows.length.toLocaleString()}</b> jobs at <b className="text-ink">{new Set(rows.map((j) => j.company.id)).size}</b> companies</span>
        <div className="ml-auto flex gap-2">
          <button className="btn" aria-pressed={savedOnly} onClick={() => setSavedOnly(!savedOnly)}>
            <Star size={14} fill={savedOnly ? "currentColor" : "none"} className={savedOnly ? "text-amber-400" : ""} /> Saved ({saved.length})
          </button>
          <button className="btn" onClick={exportCsv}><Download size={14} /> CSV</button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span className="w-5" />
        {COLS.map((c) => (
          <button key={c.key} className={`${c.cls} items-center gap-1 text-left hover:text-ink ${c.cls.includes("hidden") ? "" : "flex"}`}
            onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : c.key === "posted" ? -1 : 1 }))}>
            {c.label} {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
          </button>
        ))}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {!rows.length && <p className="p-10 text-center text-muted">{savedOnly ? "No saved jobs yet. Star a job to keep it here." : "No jobs match these filters."}</p>}
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const j = rows[it.index];
            const isSaved = saved.includes(j.url);
            return (
              <div key={j.id} className="absolute inset-x-0 flex items-center gap-3 border-b border-line/60 px-4 text-sm hover:bg-surface-2/60" style={{ top: it.start, height: it.size }}>
                <button onClick={() => toggleSaved(j.url)} className={`w-5 ${isSaved ? "text-amber-400" : "text-muted/50 hover:text-amber-400"}`} aria-label="Save job">
                  <Star size={14} fill={isSaved ? "currentColor" : "none"} />
                </button>
                <div className={`${COLS[0].cls} flex flex-col`}>
                  <a href={j.url} target="_blank" rel="noopener" className="truncate font-medium hover:text-accent">{j.title}</a>
                  <span className="truncate text-xs text-muted sm:hidden">{j.company.name} · {j.location}</span>
                  {(pay(j) || j.skills?.length || j.english) && (
                    <span className="hidden truncate text-[11px] text-muted sm:block">
                      {pay(j) && <b className="font-medium text-emerald-600 dark:text-emerald-400">{pay(j)} · </b>}
                      {[...(j.skills ?? []).slice(0, 5), j.english && `English ${j.english.toLowerCase()}`, j.years && `${j.years}+ yrs`].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
                <button className={`${COLS[1].cls} items-center gap-2 text-left hover:text-accent`} onClick={() => set({ drawer: j.company.id })}>
                  <Logo c={j.company} size={20} /> <span className="truncate">{j.company.name}</span>
                </button>
                <span className={`${COLS[2].cls} items-center gap-1.5 truncate text-xs`}><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: famColor(j.family) }} />{j.family}</span>
                <span className={`${COLS[3].cls} truncate text-xs text-muted`}>{j.seniority}</span>
                <span className={`${COLS[4].cls} truncate text-xs text-muted`} title={j.location}>{j.location || "—"}</span>
                <span className={`${COLS[5].cls} text-xs`}><span className={`rounded px-1.5 py-0.5 ${j.mode === "Remote" ? "bg-emerald-500/15 text-emerald-500" : j.mode === "Hybrid" ? "bg-sky-500/15 text-sky-500" : "bg-surface-2 text-muted"}`}>{j.mode}</span></span>
                <span className={`${COLS[6].cls} flex text-xs tabular-nums text-muted`}>{j.ageDays != null ? (j.ageDays === 0 ? "today" : `${j.ageDays}d ago`) : "—"}</span>
                <span className={`${COLS[7].cls} truncate text-xs capitalize text-muted`}>{j.company.source}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
