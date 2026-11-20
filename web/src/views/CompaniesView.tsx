import { useMemo, useState } from "react";
import { Logo } from "../components/Logo";
import { useColors } from "../lib/colors";
import { DIMS, sortValues, type DimKey } from "../lib/dims";
import { FAMILIES } from "../lib/enrich";
import { countBy, useFiltered } from "../lib/filter";
import { COUNTRY_FLAGS } from "../lib/geo";
import { useStore } from "../lib/store";
import type { Company, Job } from "../lib/types";

const SORTS: Record<string, [string, (a: Company, b: Company, m: Map<Company, Job[]>) => number]> = {
  jobs: ["Most jobs", (a, b, m) => (m.get(b)?.length ?? 0) - (m.get(a)?.length ?? 0)],
  fresh: ["Recently posted", (a, b) => (b.newest ?? "").localeCompare(a.newest ?? "")],
  remote: ["Most remote", (a, b, m) => remoteShare(m.get(b)) - remoteShare(m.get(a))],
  name: ["A → Z", (a, b) => a.name.localeCompare(b.name)],
};
const remoteShare = (js?: Job[]) => (js?.length ? js.filter((j) => j.mode === "Remote").length / js.length : -1);
const GROUPS: (DimKey | "none")[] = ["none", "sector", "city", "country", "stage", "source"];

export default function CompaniesView() {
  const { jobs, companies } = useFiltered();
  const [sort, setSort] = useState("jobs");
  const [group, setGroup] = useState<DimKey | "none">("none");

  const jobsOf = useMemo(() => {
    const m = new Map<Company, Job[]>();
    for (const j of jobs) m.set(j.company, [...(m.get(j.company) ?? []), j]);
    return m;
  }, [jobs]);

  const sections = useMemo(() => {
    const list = [...companies].sort((a, b) => SORTS[sort][1](a, b, jobsOf) || a.name.localeCompare(b.name));
    if (group === "none") return [["", list] as const];
    const by = new Map<string, Company[]>();
    for (const c of list) { const k = DIMS[group].ofCompany!(c)[0]; by.set(k, [...(by.get(k) ?? []), c]); }
    return sortValues(group, countBy(list, DIMS[group].ofCompany!)).map((k) => [k, by.get(k)!] as const);
  }, [companies, sort, group, jobsOf]);

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-bg/90 px-4 py-2 text-sm backdrop-blur">
        <span className="text-muted"><b className="text-ink">{companies.length}</b> companies</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="seg">
            {Object.entries(SORTS).map(([k, [label]]) => <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>)}
          </div>
          <select value={group} onChange={(e) => setGroup(e.target.value as DimKey)} className="rounded-lg border border-line bg-surface px-2 py-1.5">
            {GROUPS.map((g) => <option key={g} value={g}>{g === "none" ? "No grouping" : `Group: ${DIMS[g].label}`}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-6 p-4">
        {!companies.length && <p className="p-10 text-center text-muted">No companies match these filters.</p>}
        {sections.map(([title, list]) => (
          <section key={title}>
            {title && <h2 className="mb-2 text-sm font-semibold">{COUNTRY_FLAGS[title] ?? ""} {title} <span className="font-normal text-muted">· {list.length}</span></h2>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {list.map((c) => <Card key={c.id} c={c} jobs={jobsOf.get(c) ?? []} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({ c, jobs }: { c: Company; jobs: Job[] }) {
  const set = useStore((s) => s.set);
  const famColor = useColors("family");
  const fams = countBy(jobs, (j) => j.family);
  const remote = jobs.filter((j) => j.mode === "Remote").length;
  return (
    <button onClick={() => set({ drawer: c.id })} className={`card group flex flex-col gap-3 p-3 text-left transition hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg ${c.tracked ? "" : "opacity-70"}`}>
      <div className="flex items-start gap-3">
        <Logo c={c} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold group-hover:text-accent">{c.name}</div>
          <div className="truncate text-xs text-muted">{c.sector} · {c.stage} · {COUNTRY_FLAGS[c.country]} {c.hq.name}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums leading-none">{c.tracked ? `${jobs.length}${c.truncated ? "+" : ""}` : "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted">jobs</div>
        </div>
      </div>
      {jobs.length > 0 ? (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
          {FAMILIES.filter((f) => fams.get(f)).map((f) => <span key={f} title={`${f}: ${fams.get(f)}`} style={{ flex: fams.get(f), background: famColor(f) }} />)}
        </div>
      ) : <div className="h-1.5 rounded-full bg-surface-2" />}
      <div className="flex flex-wrap gap-1">
        <span className="chip capitalize">{c.source}</span>
        {remote > 0 && <span className="chip">{Math.round((remote / jobs.length) * 100)}% remote</span>}
        {c.newest && <span className="chip">newest {c.newest.slice(5)}</span>}
      </div>
    </button>
  );
}
