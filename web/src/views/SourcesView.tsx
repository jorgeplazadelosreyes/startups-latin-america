import type { EChartsOption } from "echarts";
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { EChart } from "../components/EChart";
import { Logo } from "../components/Logo";
import { colorMap, useChrome } from "../lib/colors";
import { AGES } from "../lib/enrich";
import { countBy, useFiltered } from "../lib/filter";
import { useStore } from "../lib/store";
import type { Company, Job } from "../lib/types";

/** How each ATS adapter reads its board (mirrors scripts/ats.py). */
const METHOD: Record<string, string> = {
  greenhouse: "Public JSON API", lever: "Public JSON API", ashby: "Posting API (JSON)", workable: "Widget API (JSON)",
  smartrecruiters: "Public JSON API", recruitee: "Offers API (JSON)", breezy: "Board JSON", gupy: "HTML scrape (__NEXT_DATA__)", teamtailor: "RSS feed",
  inhire: "Career page API (JSON)", bamboohr: "Careers JSON", workday: "CXS jobs API (JSON)", getonbrd: "Public API v0 (JSON)",
  jsonld: "Careers site, schema.org JobPosting", hiringroom: "Vacancy pages, schema.org JobPosting",
  buk: "Job portal pages, schema.org JobPosting", peopleforce: "HTML scrape (careers cards)", yc: "Company page props (Inertia JSON)",
};
const PRECISION = [["city", "City"], ["country", "Country only"], ["remote", "Remote / region"], ["hq", "Blank → HQ"]] as const;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export default function SourcesView() {
  const ds = useStore((s) => s.data)!;
  const only = useStore((s) => s.only);
  const set = useStore((s) => s.set);
  const chrome = useChrome();
  const { jobs, companies } = useFiltered();
  const srcColor = colorMap(ds, "source");

  const sources = useMemo(() => {
    const by = new Map<string, { companies: Company[]; jobs: Job[] }>();
    for (const c of companies) { const s = by.get(c.source) ?? { companies: [], jobs: [] }; s.companies.push(c); by.set(c.source, s); }
    for (const j of jobs) by.get(j.company.source)?.jobs.push(j);
    return [...by.entries()].sort((a, b) => b[1].jobs.length - a[1].jobs.length || b[1].companies.length - a[1].companies.length);
  }, [jobs, companies]);

  const tracked = companies.filter((c) => c.tracked).length;
  const failing = companies.filter((c) => c.feed_error);
  const dated = jobs.filter((j) => j.posted).length;
  const med = median(jobs.flatMap((j) => (j.ageDays == null ? [] : [j.ageDays])));
  const active = sources.filter(([s]) => s !== "untracked" && !s.includes("failing"));

  const stacked = (cats: readonly (readonly [string, string])[] | string[], key: (j: Job) => string, colors: string[]): EChartsOption => {
    const list = active.map(([s]) => s);
    const pairs = (cats as (string | readonly [string, string])[]).map((c) => (typeof c === "string" ? [c, c] : c)) as [string, string][];
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { bottom: 0, textStyle: { color: chrome.sub }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 8, bottom: 36, containLabel: true },
      xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%", color: chrome.sub }, splitLine: { lineStyle: { color: chrome.grid } } },
      yAxis: { type: "category", data: list, inverse: true, axisLabel: { color: chrome.text }, axisLine: { show: false }, axisTick: { show: false } },
      series: pairs.map(([v, label], i) => ({
        name: label, type: "bar", stack: "s", barWidth: 14, itemStyle: { color: colors[i] },
        data: active.map(([, s]) => +(((s.jobs.filter((j) => key(j) === v).length) / Math.max(1, s.jobs.length)) * 100).toFixed(1)),
      })),
    };
  };

  const freshness = useMemo(() => stacked(AGES, (j) => j.age, ["#34d399", "#60a5fa", "#a78bfa", "#f472b6", "#64748b"]), [active, chrome]);
  const precision = useMemo(() => stacked(PRECISION, (j) => j.precision, ["#34d399", "#fbbf24", "#60a5fa", "#64748b"]), [active, chrome]);

  const coverage = useMemo<EChartsOption>(() => {
    const sectors = [...countBy(companies, (c) => c.sector)].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([s]) => s);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { bottom: 0, textStyle: { color: chrome.sub }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 8, bottom: 36, containLabel: true },
      xAxis: { type: "value", axisLabel: { color: chrome.sub }, splitLine: { lineStyle: { color: chrome.grid } } },
      yAxis: { type: "category", data: sectors, inverse: true, axisLabel: { color: chrome.text }, axisTick: { show: false }, axisLine: { show: false } },
      series: [
        { name: "Tracked feed", type: "bar", stack: "c", barWidth: 12, itemStyle: { color: chrome.accent }, data: sectors.map((s) => companies.filter((c) => c.sector === s && c.tracked).length) },
        { name: "Not tracked", type: "bar", stack: "c", barWidth: 12, itemStyle: { color: "#475569" }, data: sectors.map((s) => companies.filter((c) => c.sector === s && !c.tracked).length) },
      ],
    };
  }, [companies, chrome]);

  const discovery = useMemo<EChartsOption>(() => {
    const hits = ds.discovery.filter((p) => p.jobs > 0);
    const names = [...new Set(hits.map((p) => p.name))].sort();
    const ats = [...new Set(hits.map((p) => p.ats))].sort();
    return {
      tooltip: {
        formatter: (p: unknown) => {
          const d = (p as { data: [number, number, number, number, string] }).data;
          return `<b>${names[d[1]]}</b> on ${ats[d[0]]}<br>slug <code>${d[4]}</code><br>${d[3]} jobs · ${Math.round(d[2] * 100)}% in LatAm${d[2] < 0.5 ? "<br><i>likely a different company with the same slug</i>" : ""}`;
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 60, containLabel: true },
      xAxis: { type: "category", data: ats, axisLabel: { color: chrome.text }, splitArea: { show: true, areaStyle: { color: ["transparent", chrome.grid + "55"] } } },
      yAxis: { type: "category", data: names, axisLabel: { color: chrome.text, fontSize: 10 }, inverse: true },
      visualMap: { min: 0, max: 1, dimension: 2, orient: "horizontal", left: "center", bottom: 0, itemHeight: 140, text: ["100% LatAm", "0%"], textStyle: { color: chrome.sub }, inRange: { color: ["#f43f5e", "#fbbf24", "#34d399"] } },
      series: [{
        type: "heatmap",
        data: hits.map((p) => [ats.indexOf(p.ats), names.indexOf(p.name), p.latam_share ?? 0, p.jobs, p.slug, p.name]),
        label: { show: true, formatter: (p: unknown) => String((p as { data: number[] }).data[3]), color: "#0b1120", fontSize: 10 },
        itemStyle: { borderColor: chrome.bg, borderWidth: 2, borderRadius: 4 },
      }],
    };
  }, [ds, chrome]);

  const [lineage, setLineage] = useState<"all" | "ok" | "failing" | "untracked">("all");
  const lineageRows = companies
    .filter((c) => lineage === "all" || (lineage === "ok" ? c.tracked : lineage === "failing" ? !!c.feed_error : !c.tracked && !c.feed_error))
    .sort((a, b) => Number(b.tracked) - Number(a.tracked) || b.jobs.length - a.jobs.length);

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Companies with a live feed" value={`${tracked}/${companies.length}`} sub={`${Math.round((tracked / Math.max(1, companies.length)) * 100)}% coverage`} />
          <Kpi label="ATS platforms in use" value={String(active.length)} sub="each with its own adapter" />
          <Kpi label="Jobs ingested" value={jobs.length.toLocaleString()} sub="after the LatAm location filter" />
          <Kpi label="Jobs with a post date" value={`${Math.round((dated / Math.max(1, jobs.length)) * 100)}%`} sub={`${jobs.length - dated} undated`} />
          <Kpi label="Median job age" value={med == null ? "—" : `${med} days`} sub="dated jobs only" />
          <Kpi label="Failing feeds" value={String(failing.length)} sub={failing.length ? failing.map((c) => c.name).join(", ") : "all feeds healthy"} warn={failing.length > 0} />
        </div>

        <section>
          <SectionTitle title="Sources" sub="Where the jobs come from. Click a source to filter every view by it." />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {sources.map(([s, v]) => {
              const share = v.jobs.length / Math.max(1, jobs.length);
              const m = median(v.jobs.flatMap((j) => (j.ageDays == null ? [] : [j.ageDays])));
              const remote = v.jobs.filter((j) => j.mode === "Remote").length;
              const base = s.replace(" (failing)", "");
              return (
                <button key={s} onClick={() => only("source", s)} className="card group p-3 text-left transition hover:border-accent/60">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: srcColor.get(s) ?? "#64748b" }} />
                    <span className="font-semibold capitalize group-hover:text-accent">{s}</span>
                    <span className="ml-auto text-xs text-muted">{s === "untracked" ? "no feed" : METHOD[base]}</span>
                  </div>
                  <div className="mt-3 flex items-end gap-4">
                    <div><div className="text-2xl font-semibold tabular-nums">{v.jobs.length}</div><div className="text-xs text-muted">jobs</div></div>
                    <div><div className="text-2xl font-semibold tabular-nums">{v.companies.length}</div><div className="text-xs text-muted">companies</div></div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: srcColor.get(s) ?? "#64748b" }} /></div>
                  <div className="mt-2 flex justify-between text-xs text-muted">
                    <span>{Math.round(share * 100)}% of jobs</span>
                    {v.jobs.length > 0 && <span>{m == null ? "undated" : `median ${m}d old`} · {Math.round((remote / v.jobs.length) * 100)}% remote</span>}
                  </div>
                  <div className="mt-2 flex -space-x-1.5">
                    {v.companies.slice(0, 9).map((c) => <span key={c.id} className="rounded-lg ring-2 ring-[var(--surface)]"><Logo c={c} size={20} /></span>)}
                    {v.companies.length > 9 && <span className="grid h-5 place-items-center pl-3 text-[11px] text-muted">+{v.companies.length - 9}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Freshness by source" sub="Share of each source's jobs by posting age. Lever and Gupy feeds don't publish dates.">
            <EChart option={freshness} />
          </ChartCard>
          <ChartCard title="Location quality by source" sub="How precisely each source's location strings resolve to a place.">
            <EChart option={precision} />
          </ChartCard>
          <ChartCard title="Coverage gaps by sector" sub="Companies we can read jobs for vs. ones without a supported public feed.">
            <EChart option={coverage} />
          </ChartCard>
          <ChartCard title="Discovery probes" sub="Which candidate slugs answered on which ATS (number = jobs found, color = share in LatAm). Red cells were rejected as name collisions." tall>
            <EChart option={discovery} onClick={(p) => { const n = (p.data as unknown[])?.[5]; const c = ds.companies.find((x) => x.name === n); if (c) set({ drawer: c.id }); }} />
          </ChartCard>
        </div>

        <section>
          <SectionTitle title="Data lineage" sub="Every company, the feed its jobs are read from, and the state of that feed on the last refresh." />
          <div className="mb-2 seg">
            {(["all", "ok", "failing", "untracked"] as const).map((k) => <button key={k} aria-pressed={lineage === k} onClick={() => setLineage(k)} className="capitalize">{k === "ok" ? "Live feed" : k}</button>)}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">Company</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Feed endpoint</th><th className="px-3 py-2 text-right">Jobs</th><th className="px-3 py-2">Newest</th>
                </tr>
              </thead>
              <tbody>
                {lineageRows.map((c) => (
                  <tr key={c.id} className="border-b border-line/60 hover:bg-surface-2/50">
                    <td className="px-3 py-1.5"><button className="flex items-center gap-2 hover:text-accent" onClick={() => set({ drawer: c.id })}><Logo c={c} size={20} />{c.name}</button></td>
                    <td className="px-3 py-1.5">
                      {c.tracked ? <span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 size={14} /> live</span>
                        : c.feed_error ? <span className="inline-flex items-center gap-1 text-amber-500" title={c.feed_error}><AlertTriangle size={14} /> failing</span>
                        : <span className="inline-flex items-center gap-1 text-muted"><CircleDashed size={14} /> untracked</span>}
                    </td>
                    <td className="px-3 py-1.5 capitalize">{c.ats_configured ?? "—"}<span className="block text-xs normal-case text-muted">{c.ats_configured ? METHOD[c.ats_configured] : ""}</span></td>
                    <td className="max-w-[340px] truncate px-3 py-1.5 font-mono text-xs">{c.feed_url ? <a href={c.feed_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-accent hover:underline">{c.feed_url.replace(/^https:\/\//, "")} <ExternalLink size={11} /></a> : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{c.tracked ? `${c.jobs.length}${c.truncated ? "+" : ""}` : "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums text-muted">{c.newest ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="card p-3">
      <div className={`text-2xl font-semibold tabular-nums ${warn ? "text-amber-500" : ""}`}>{value}</div>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-0.5 truncate text-xs text-muted" title={sub}>{sub}</div>
    </div>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function ChartCard({ title, sub, children, tall }: { title: string; sub?: string; children: React.ReactNode; tall?: boolean }) {
  return (
    <section className={`card flex flex-col p-4 ${tall ? "h-[560px]" : "h-[360px]"}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="mb-2 text-xs text-muted">{sub}</p>}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
