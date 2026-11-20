import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import { EChart } from "../components/EChart";
import { colorMap, MUTED, useChrome } from "../lib/colors";
import { DIMS, sortValues, type DimKey } from "../lib/dims";
import { MODES, SENIORITIES } from "../lib/enrich";
import { countBy, useFiltered } from "../lib/filter";
import { useStore } from "../lib/store";
import { ChartCard } from "./SourcesView";

const DAY = 86_400_000;
const STOP = new Set("de da do das dos e em para com a o the and of for to in at y la el en del los las con por sr jr senior junior pleno mid ii iii i - – | / & ( ) remote remoto hybrid brazil brasil mexico colombia são paulo sao bogota bogotá ciudad vaga afirmativa pcd".split(" "));
const STACKS: DimKey[] = ["family", "seniority", "hiringIn", "sector", "source", "mode"];

export default function TrendsView() {
  const ds = useStore((s) => s.data)!;
  const only = useStore((s) => s.only);
  const set = useStore((s) => s.set);
  const chrome = useChrome();
  const { jobs } = useFiltered();
  const [stack, setStack] = useState<DimKey>("family");
  const [weeks, setWeeks] = useState(16);

  const axis = { axisLabel: { color: chrome.sub }, axisLine: { lineStyle: { color: chrome.grid } }, splitLine: { lineStyle: { color: chrome.grid } } };
  const legend = { bottom: 0, type: "scroll" as const, textStyle: { color: chrome.sub }, itemWidth: 10, itemHeight: 10, pageTextStyle: { color: chrome.sub } };

  const timeline = useMemo<EChartsOption>(() => {
    const end = +ds.generatedAt;
    const start = end - weeks * 7 * DAY;
    const buckets = Array.from({ length: weeks }, (_, i) => new Date(start + i * 7 * DAY));
    const dated = jobs.filter((j) => j.posted && +new Date(j.posted) >= start);
    const vals = sortValues(stack, countBy(dated, DIMS[stack].ofJob)).slice(0, 10);
    const cm = colorMap(ds, stack);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend,
      grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
      xAxis: { type: "category", data: buckets.map((d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" })), ...axis, splitLine: { show: false } },
      yAxis: { type: "value", ...axis },
      series: vals.map((v) => ({
        name: v, type: "bar", stack: "t", barMaxWidth: 36, itemStyle: { color: cm.get(v) ?? MUTED },
        emphasis: { focus: "series" },
        data: buckets.map((_, i) => dated.filter((j) => DIMS[stack].ofJob(j).includes(v) && Math.floor((+new Date(j.posted!) - start) / (7 * DAY)) === i).length),
      })),
    };
  }, [jobs, stack, weeks, ds, chrome]);

  const calendar = useMemo<EChartsOption>(() => {
    const per = countBy(jobs.filter((j) => j.posted), (j) => j.posted!);
    const end = ds.generatedAt.toISOString().slice(0, 10);
    const start = new Date(+ds.generatedAt - 182 * DAY).toISOString().slice(0, 10);
    return {
      tooltip: { formatter: (p: unknown) => { const d = (p as { data: [string, number] }).data; return `${d[0]}<br><b>${d[1]}</b> jobs posted`; } },
      visualMap: { min: 0, max: Math.max(5, ...per.values()), show: false, inRange: { color: [chrome.grid, "#065f46", "#10b981", "#6ee7b7", "#fde047"] } },
      calendar: { range: [start, end], top: 30, left: 30, right: 10, cellSize: ["auto", 16], itemStyle: { color: "transparent", borderColor: chrome.bg, borderWidth: 3 }, splitLine: { show: false }, yearLabel: { show: false }, dayLabel: { color: chrome.sub, firstDay: 1, nameMap: "en" }, monthLabel: { color: chrome.sub } },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data: [...per].filter(([d]) => d >= start), itemStyle: { borderRadius: 3 } }],
    };
  }, [jobs, ds, chrome]);

  const ladder = useMemo<EChartsOption>(() => {
    const cm = colorMap(ds, "mode");
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend,
      grid: { left: 8, right: 16, top: 8, bottom: 40, containLabel: true },
      xAxis: { type: "value", ...axis },
      yAxis: { type: "category", data: SENIORITIES, ...axis, splitLine: { show: false } },
      series: MODES.map((m) => ({ name: m, type: "bar", stack: "s", barWidth: 16, itemStyle: { color: cm.get(m) }, data: SENIORITIES.map((s) => jobs.filter((j) => j.seniority === s && j.mode === m).length) })),
    };
  }, [jobs, ds, chrome]);

  const langs = useMemo<EChartsOption>(() => {
    const countries = sortValues("hiringIn", countBy(jobs, (j) => j.countries)).slice(0, 8);
    const cm = colorMap(ds, "lang");
    const ls = ["English", "Portuguese", "Spanish"];
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => `${v}%` },
      legend,
      grid: { left: 8, right: 16, top: 8, bottom: 40, containLabel: true },
      xAxis: { type: "value", max: 100, ...axis, axisLabel: { color: chrome.sub, formatter: "{value}%" } },
      yAxis: { type: "category", data: countries, inverse: true, ...axis, splitLine: { show: false } },
      series: ls.map((l) => ({
        name: l, type: "bar", stack: "l", barWidth: 16, itemStyle: { color: cm.get(l) },
        data: countries.map((c) => { const js = jobs.filter((j) => j.countries.includes(c)); return js.length ? +((js.filter((j) => j.lang === l).length / js.length) * 100).toFixed(0) : 0; }),
      })),
    };
  }, [jobs, ds, chrome]);

  const words = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      const seen = new Set<string>();
      for (const w of j.title.toLowerCase().split(/[^\p{L}\p{N}+#]+/u)) if (w.length > 2 && !STOP.has(w) && !seen.has(w)) { seen.add(w); m.set(w, (m.get(w) ?? 0) + 1); }
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [jobs]);

  const velocity = useMemo<EChartsOption>(() => {
    const recent = countBy(jobs.filter((j) => j.ageDays != null && j.ageDays <= 14), (j) => j.company.name);
    const top = [...recent].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const sector = colorMap(ds, "sector");
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 30, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", ...axis },
      yAxis: { type: "category", data: top.map(([n]) => n), inverse: true, ...axis, axisLabel: { color: chrome.text }, splitLine: { show: false } },
      series: [{ type: "bar", barWidth: 14, data: top.map(([n, v]) => ({ value: v, itemStyle: { color: sector.get(ds.companies.find((c) => c.name === n)!.sector) ?? MUTED, borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: "right", color: chrome.sub } }],
    };
  }, [jobs, ds, chrome]);

  const maxW = words[0]?.[1] ?? 1;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-2">
        <section className="card flex h-[400px] flex-col p-4 lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div>
              <h3 className="text-sm font-semibold">New postings per week</h3>
              <p className="text-xs text-muted">Dated jobs only. Click a series to filter by it.</p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <select value={stack} onChange={(e) => setStack(e.target.value as DimKey)} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm">
                {STACKS.map((k) => <option key={k} value={k}>Stack: {DIMS[k].label}</option>)}
              </select>
              <div className="seg">{[8, 16, 26].map((w) => <button key={w} aria-pressed={weeks === w} onClick={() => setWeeks(w)}>{w}w</button>)}</div>
            </div>
          </div>
          <div className="min-h-0 flex-1"><EChart option={timeline} onClick={(p) => p.seriesName && only(stack, p.seriesName)} /></div>
        </section>

        <ChartCard title="Posting calendar" sub="Jobs posted per day over the last six months.">
          <EChart option={calendar} />
        </ChartCard>
        <ChartCard title="Hiring velocity" sub="Companies with the most jobs posted in the last 14 days. Click to open.">
          <EChart option={velocity} onClick={(p) => { const c = ds.companies.find((x) => x.name === p.name); if (c) set({ drawer: c.id }); }} />
        </ChartCard>
        <ChartCard title="Seniority ladder" sub="How remote-friendly each level is.">
          <EChart option={ladder} onClick={(p) => { only("seniority", String(p.name)); if (p.seriesName) only("mode", p.seriesName); }} />
        </ChartCard>
        <ChartCard title="Posting language by country" sub="Which language job titles are written in, per hiring country.">
          <EChart option={langs} onClick={(p) => { only("hiringIn", String(p.name)); if (p.seriesName) only("lang", p.seriesName); }} />
        </ChartCard>

        <section className="card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold">What's in the titles</h3>
          <p className="mb-3 text-xs text-muted">Most frequent words in job titles. Click one to search for it.</p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {words.map(([w, n]) => (
              <button key={w} onClick={() => set({ q: w })} className="text-muted transition hover:text-accent" style={{ fontSize: `${12 + (n / maxW) * 22}px`, opacity: 0.55 + (n / maxW) * 0.45, color: n / maxW > 0.5 ? chrome.accent : undefined }} title={`${n} jobs`}>
                {w}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
