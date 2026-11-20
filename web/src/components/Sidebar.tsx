import { pay } from "../lib/format";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Building2, Briefcase, MapPin, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useFiltered } from "../lib/filter";
import { useStore } from "../lib/store";
import type { Company, Job } from "../lib/types";
import { Logo } from "./Logo";

export const inBounds = (lat: number, lng: number, b: [number, number, number, number] | null) =>
  !b || (lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]);

/** What the map is showing right now: companies with an office in view and jobs located in view. */
export function useInView() {
  const { jobs, companies } = useFiltered();
  const bounds = useStore((s) => s.bounds);
  return useMemo(() => {
    const cos = companies.filter((c) => c.offices.some((o) => inBounds(o.lat, o.lng, bounds)));
    const js = jobs.filter((j) => j.places.some((p) => inBounds(p.lat, p.lng, bounds)));
    const n = new Map<Company, number>();
    for (const j of js) n.set(j.company, (n.get(j.company) ?? 0) + 1);
    cos.sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || a.name.localeCompare(b.name));
    js.sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""));
    return { companies: cos, jobs: js, jobsHere: n };
  }, [jobs, companies, bounds]);
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { companies, jobs, jobsHere } = useInView();
  const hiringOnly = useStore((s) => s.hiringOnly);
  const bounds = useStore((s) => s.bounds);
  const set = useStore((s) => s.set);
  const [tab, setTab] = useState<"companies" | "jobs">("companies");
  const places = new Set(companies.flatMap((c) => c.offices.filter((o) => inBounds(o.lat, o.lng, bounds)).map((o) => o.place.name)));
  const where = places.size === 1 ? [...places][0] : places.size <= 3 ? [...places].join(", ") : `${places.size} cities`;

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[88vw] max-w-sm flex-col border-r border-line bg-surface transition-transform lg:static lg:z-0 lg:w-96 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="space-y-2.5 border-b border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted"><MapPin size={12} /> In this area</p>
              <p className="truncate text-sm font-semibold">{where || "Nothing in view"}</p>
            </div>
            <button onClick={onClose} className="text-muted lg:hidden" aria-label="Close list"><X size={18} /></button>
          </div>
          <div className="flex items-center gap-2">
            <div className="seg flex-1">
              <button className="flex-1 justify-center" aria-pressed={tab === "companies"} onClick={() => setTab("companies")}><Building2 size={14} /> {companies.length} companies</button>
              <button className="flex-1 justify-center" aria-pressed={tab === "jobs"} onClick={() => setTab("jobs")}><Briefcase size={14} /> {jobs.length.toLocaleString()} jobs</button>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={hiringOnly} onChange={(e) => set({ hiringOnly: e.target.checked })} className="accent-[var(--accent)]" />
            Only companies with open jobs
          </label>
        </div>
        {tab === "companies" ? <CompanyList companies={companies} jobsHere={jobsHere} /> : <JobList jobs={jobs} />}
        <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Pan or zoom the map to change this list. Use search (⌘K) to filter by role, level or keyword.</p>
      </aside>
    </>
  );
}

function CompanyList({ companies, jobsHere }: { companies: Company[]; jobsHere: Map<Company, number> }) {
  const set = useStore((s) => s.set);
  const hover = useStore((s) => s.hover);
  const bounds = useStore((s) => s.bounds);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: companies.length, getScrollElement: () => ref.current, estimateSize: () => 64, overscan: 8 });
  if (!companies.length) return <Empty />;
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => {
          const c = companies[it.index];
          const n = jobsHere.get(c) ?? 0;
          const here = c.offices.filter((o) => inBounds(o.lat, o.lng, bounds));
          const office = here.find((o) => o.hq) ?? here[0];
          return (
            <button
              key={c.id}
              onClick={() => set({ drawer: c.id })}
              onMouseEnter={() => set({ hover: c.id })}
              onMouseLeave={() => set({ hover: null })}
              className={`absolute inset-x-0 flex items-center gap-3 border-b border-line/70 px-3 text-left transition ${hover === c.id ? "bg-accent/10" : "hover:bg-surface-2"}`}
              style={{ top: it.start, height: it.size }}
            >
              <Logo c={c} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{c.name}</div>
                <div className="truncate text-xs text-muted">
                  {c.sector} · {office ? (office.hq ? office.place.name : `${office.place.name} office`) : c.hq.name}
                  {office?.precise && <span title={office.label}> · 📍</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{c.tracked ? n : "—"}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted">{c.tracked ? "jobs here" : "untracked"}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JobList({ jobs }: { jobs: Job[] }) {
  const set = useStore((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: jobs.length, getScrollElement: () => ref.current, estimateSize: () => 68, overscan: 10 });
  if (!jobs.length) return <Empty />;
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => {
          const j = jobs[it.index];
          return (
            <div
              key={j.id}
              onMouseEnter={() => set({ hover: j.company.id })}
              onMouseLeave={() => set({ hover: null })}
              className="absolute inset-x-0 flex items-center gap-3 border-b border-line/70 px-3 hover:bg-surface-2"
              style={{ top: it.start, height: it.size }}
            >
              <button onClick={() => set({ drawer: j.company.id })} aria-label={`Open ${j.company.name}`}><Logo c={j.company} size={28} /></button>
              <div className="min-w-0 flex-1">
                <a href={j.url} target="_blank" rel="noopener" className="block truncate text-sm font-medium hover:text-accent">{j.title}</a>
                <div className="truncate text-xs text-muted">
                  {j.company.name} · {j.location || j.company.hq.name}{j.mode === "Remote" ? " · Remote" : ""}
                </div>
                {(pay(j) || j.skills?.length) && (
                  <div className="truncate text-[11px] text-muted/80">
                    {pay(j) && <span className="font-medium text-emerald-600 dark:text-emerald-400">{pay(j)} </span>}
                    {j.skills?.slice(0, 4).join(" · ")}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted">{j.ageDays == null ? "" : j.ageDays === 0 ? "today" : `${j.ageDays}d`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Empty() {
  return <p className="flex-1 p-8 text-center text-sm text-muted">Nothing here. Zoom out or move the map.</p>;
}
