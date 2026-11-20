import type { EChartsOption } from "echarts";
import { ArrowLeftRight, Grid3x3, Orbit, PieChart, Plus, SquareStack, Waypoints, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EChart } from "../components/EChart";
import { colorMap, MUTED, useChrome } from "../lib/colors";
import { DIM_KEYS, DIMS, sortValues, type DimKey } from "../lib/dims";
import { countBy, useFiltered } from "../lib/filter";
import { useStore, type ExploreMode } from "../lib/store";
import type { Company, Job } from "../lib/types";

const MODES: [ExploreMode, string, typeof Grid3x3, string][] = [
  ["pivot", "Pivot", Grid3x3, "Cross any two dimensions. Click a cell to filter by both."],
  ["sankey", "Flow", Waypoints, "Follow jobs from source to sector to role to country. Click a node to filter."],
  ["sunburst", "Sunburst", PieChart, "Drill down from country to city to sector to company. Click to zoom; click the center to go back."],
  ["treemap", "Treemap", SquareStack, "Every company as a tile sized by open jobs, grouped by the chosen dimension."],
  ["network", "Network", Orbit, "Companies linked to what they hire for. Drag nodes, scroll to zoom, hover to isolate."],
];

function Select({ value, onChange, options, label }: { value: string; onChange: (v: DimKey) => void; options: DimKey[]; label?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as DimKey)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-ink">
        {options.map((k) => <option key={k} value={k}>{DIMS[k].label}</option>)}
      </select>
    </label>
  );
}

export default function ExploreView() {
  const mode = useStore((s) => s.explore);
  const set = useStore((s) => s.set);
  const desc = MODES.find((m) => m[0] === mode)![3];
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        <div className="seg">
          {MODES.map(([m, label, Icon]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => set({ explore: m })}><Icon size={14} /> {label}</button>
          ))}
        </div>
        <p className="text-xs text-muted">{desc}</p>
      </div>
      <div className="relative min-h-0 flex-1">
        {mode === "pivot" && <Pivot />}
        {mode === "sankey" && <Sankey />}
        {mode === "sunburst" && <Sunburst />}
        {mode === "treemap" && <Treemap />}
        {mode === "network" && <Network />}
      </div>
    </div>
  );
}

/* ---------------- pivot heatmap ---------------- */

function Pivot() {
  const { jobs, companies } = useFiltered();
  const chrome = useChrome();
  const only = useStore((s) => s.only);
  const [row, setRow] = useState<DimKey>("sector");
  const [col, setCol] = useState<DimKey>("family");
  const [metric, setMetric] = useState<"jobs" | "companies" | "remote">("jobs");
  const companyOnly = metric === "companies";
  const options = companyOnly ? DIM_KEYS.filter((k) => DIMS[k].level === "company") : DIM_KEYS;
  const r = options.includes(row) ? row : "sector";
  const c = options.includes(col) ? col : "stage";

  const option = useMemo<EChartsOption>(() => {
    const items: (Job | Company)[] = companyOnly ? companies : jobs;
    const vals = (d: DimKey, it: Job | Company) => (companyOnly ? DIMS[d].ofCompany!(it as Company) : DIMS[d].ofJob(it as Job));
    const rows = sortValues(r, countBy(items, (it) => vals(r, it))).slice(0, 30);
    const cols = sortValues(c, countBy(items, (it) => vals(c, it))).slice(0, 24);
    const cell = new Map<string, { n: number; remote: number }>();
    for (const it of items)
      for (const a of vals(r, it)) for (const b of vals(c, it)) {
        const k = a + "\u0000" + b;
        const v = cell.get(k) ?? { n: 0, remote: 0 };
        v.n++;
        if (!companyOnly && (it as Job).mode === "Remote") v.remote++;
        cell.set(k, v);
      }
    const data = rows.flatMap((a, y) => cols.map((b, x) => {
      const v = cell.get(a + "\u0000" + b);
      if (!v) return null;
      return [x, y, metric === "remote" ? Math.round((v.remote / v.n) * 100) : v.n, v.n];
    }).filter(Boolean)) as number[][];
    const max = Math.max(1, ...data.map((d) => d[2]));
    return {
      tooltip: { formatter: (p: unknown) => { const d = (p as { data: number[] }).data; return `<b>${rows[d[1]]}</b> × <b>${cols[d[0]]}</b><br>${metric === "remote" ? `${d[2]}% remote of ${d[3]} jobs` : `${d[2]} ${metric}`}`; } },
      grid: { left: 8, right: 24, top: 70, bottom: 50, containLabel: true },
      xAxis: { type: "category", data: cols, position: "top", axisLabel: { color: chrome.text, rotate: cols.length > 8 ? 35 : 0, interval: 0 }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: "category", data: rows, inverse: true, axisLabel: { color: chrome.text }, axisLine: { show: false }, axisTick: { show: false } },
      visualMap: { min: 0, max: metric === "remote" ? 100 : max, calculable: true, orient: "horizontal", left: "center", bottom: 0, itemHeight: 200, textStyle: { color: chrome.sub }, inRange: { color: [chrome.grid, "#0e7490", "#34d399", "#fde047"] } },
      series: [{
        type: "heatmap", data,
        label: { show: true, color: "#0b1120", fontSize: 11, formatter: (p: unknown) => { const v = (p as { data: number[] }).data[2]; return metric === "remote" ? `${v}%` : String(v); } },
        itemStyle: { borderColor: chrome.bg, borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { borderColor: chrome.accent, borderWidth: 2 } },
      }],
      _rows: rows, _cols: cols,
    } as EChartsOption;
  }, [jobs, companies, r, c, metric, chrome, companyOnly]);

  const onClick = (p: { data?: unknown }) => {
    const d = p.data as number[] | undefined;
    if (!d) return;
    const o = option as unknown as { _rows: string[]; _cols: string[] };
    only(r, o._rows[d[1]]);
    only(c, o._cols[d[0]]);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <Select label="Rows" value={r} onChange={setRow} options={options} />
        <button className="btn" onClick={() => { setRow(c); setCol(r); }} aria-label="Swap axes"><ArrowLeftRight size={14} /></button>
        <Select label="Columns" value={c} onChange={setCol} options={options} />
        <div className="seg ml-auto">
          {(["jobs", "companies", "remote"] as const).map((m) => <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === "remote" ? "% remote" : m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 p-2"><EChart option={option} onClick={onClick} /></div>
    </div>
  );
}

/* ---------------- sankey ---------------- */

function Sankey() {
  const { jobs } = useFiltered();
  const ds = useStore((s) => s.data)!;
  const only = useStore((s) => s.only);
  const chrome = useChrome();
  const [chain, setChain] = useState<DimKey[]>(["source", "sector", "family", "hiringIn"]);

  const option = useMemo<EChartsOption>(() => {
    // Keep the top values per stage so the diagram stays legible; the rest fold into "Other …".
    const keep = chain.map((d) => new Set(sortValues(d, countBy(jobs, DIMS[d].ofJob)).slice(0, d === "sector" ? 10 : 12)));
    const label = (i: number, v: string) => (keep[i].has(v) ? v : `Other ${DIMS[chain[i]].label.toLowerCase()}`);
    const links = new Map<string, number>();
    const nodes = new Map<string, { name: string; depth: number; value: string; dim: DimKey }>();
    for (const j of jobs) {
      const steps = chain.map((d, i) => DIMS[d].ofJob(j).map((v) => label(i, v)));
      const w = 1 / steps.reduce((p, s) => p * s.length, 1);
      const walk = (i: number, prev: string | null) => {
        if (i === chain.length) return;
        for (const v of steps[i]) {
          const id = `${i}|${v}`;
          nodes.set(id, { name: id, depth: i, value: v, dim: chain[i] });
          if (prev) links.set(prev + "→" + id, (links.get(prev + "→" + id) ?? 0) + w);
          walk(i + 1, id);
        }
      };
      walk(0, null);
    }
    return {
      tooltip: { trigger: "item", formatter: (p: unknown) => {
        const q = p as { dataType: string; data: { source?: string; target?: string; value?: number; name?: string } ; value: number };
        const strip = (s = "") => s.split("|")[1];
        return q.dataType === "edge" ? `${strip(q.data.source)} → ${strip(q.data.target)}<br><b>${Math.round(q.data.value!)}</b> jobs` : `<b>${strip(q.data.name)}</b><br>${Math.round(q.value)} jobs`;
      } },
      series: [{
        type: "sankey",
        left: 8, right: 130, top: 16, bottom: 16,
        nodeGap: 6, nodeWidth: 12, draggable: true, layoutIterations: 64,
        emphasis: { focus: "adjacency" },
        data: [...nodes.values()].map((n) => ({ name: n.name, depth: n.depth, itemStyle: { color: colorMap(ds, n.dim).get(n.value) ?? MUTED, borderWidth: 0 } })),
        links: [...links].map(([k, value]) => { const [source, target] = k.split("→"); return { source, target, value }; }),
        label: { color: chrome.text, fontSize: 11, formatter: (p: { name: string }) => p.name.split("|")[1] },
        lineStyle: { color: "gradient", opacity: 0.35, curveness: 0.5 },
      }],
    };
  }, [jobs, chain, chrome, ds]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {chain.map((d, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted">→</span>}
            <Select value={d} onChange={(v) => setChain(chain.map((x, k) => (k === i ? v : x)))} options={DIM_KEYS} />
            {chain.length > 2 && <button className="text-muted hover:text-ink" onClick={() => setChain(chain.filter((_, k) => k !== i))} aria-label="Remove stage"><X size={14} /></button>}
          </span>
        ))}
        {chain.length < 5 && <button className="btn" onClick={() => setChain([...chain, DIM_KEYS.find((k) => !chain.includes(k))!])}><Plus size={14} /> Stage</button>}
      </div>
      <div className="min-h-0 flex-1 p-2">
        <EChart option={option} onClick={(p) => {
          if (p.dataType !== "node") return;
          const [i, v] = String(p.name).split("|");
          if (!v.startsWith("Other ")) only(chain[+i], v);
        }} />
      </div>
    </div>
  );
}

/* ---------------- sunburst / treemap ---------------- */

type Tree = { name: string; value?: number; children?: Tree[]; itemStyle?: { color: string }; id?: string };

function hierarchy(companies: Company[], jobsOf: Map<Company, number>, levels: DimKey[], metric: "jobs" | "companies", ds: ReturnType<typeof useStore.getState>["data"]): Tree[] {
  const build = (cs: Company[], depth: number, color?: string): Tree[] => {
    if (depth === levels.length)
      return cs.map((c) => ({ name: c.name, id: "co:" + c.id, value: metric === "jobs" ? jobsOf.get(c) ?? 0 : 1, itemStyle: color ? { color } : undefined })).filter((t) => t.value! > 0);
    const d = levels[depth];
    const by = new Map<string, Company[]>();
    for (const c of cs) { const k = DIMS[d].ofCompany!(c)[0]; by.set(k, [...(by.get(k) ?? []), c]); }
    return [...by].map(([k, group]) => {
      const col = depth === 0 ? colorMap(ds!, d).get(k) ?? MUTED : color;
      return { name: k, children: build(group, depth + 1, col), itemStyle: col ? { color: col } : undefined };
    }).filter((t) => t.children!.length);
  };
  return build(companies, 0);
}

function useHierarchy(levels: DimKey[], metric: "jobs" | "companies") {
  const { jobs, companies } = useFiltered();
  const ds = useStore((s) => s.data);
  return useMemo(() => {
    const jobsOf = countBy(jobs, (j) => j.company.id);
    const m = new Map(companies.map((c) => [c, jobsOf.get(c.id) ?? 0]));
    return hierarchy(companies, m, levels, metric, ds);
  }, [jobs, companies, levels, metric, ds]);
}

const COMPANY_LEVELS: DimKey[] = ["country", "city", "sector", "stage", "source"];

function LevelPicker({ levels, setLevels, metric, setMetric }: { levels: DimKey[]; setLevels: (l: DimKey[]) => void; metric: string; setMetric: (m: "jobs" | "companies") => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
      {levels.map((d, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted">›</span>}
          <Select value={d} onChange={(v) => setLevels(levels.map((x, k) => (k === i ? v : x)))} options={COMPANY_LEVELS} />
          {levels.length > 1 && <button className="text-muted hover:text-ink" onClick={() => setLevels(levels.filter((_, k) => k !== i))} aria-label="Remove level"><X size={14} /></button>}
        </span>
      ))}
      {levels.length < 4 && <button className="btn" onClick={() => setLevels([...levels, COMPANY_LEVELS.find((k) => !levels.includes(k))!])}><Plus size={14} /> Level</button>}
      <span className="text-muted">› company</span>
      <div className="seg ml-auto">
        {(["jobs", "companies"] as const).map((m) => <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>Size: {m}</button>)}
      </div>
    </div>
  );
}

function Sunburst() {
  const chrome = useChrome();
  const set = useStore((s) => s.set);
  const [levels, setLevels] = useState<DimKey[]>(["country", "city", "sector"]);
  const [metric, setMetric] = useState<"jobs" | "companies">("jobs");
  const data = useHierarchy(levels, metric);
  const option = useMemo<EChartsOption>(() => ({
    tooltip: { formatter: (p: unknown) => { const q = p as { name: string; value: number; treePathInfo: { name: string }[] }; return `${q.treePathInfo.map((t) => t.name).filter(Boolean).join(" › ")}<br><b>${q.value}</b> ${metric}`; } },
    series: [{
      type: "sunburst", data, radius: ["8%", "92%"], sort: "desc",
      itemStyle: { borderColor: chrome.bg, borderWidth: 1.5, borderRadius: 3 },
      label: { color: "#0b1120", fontSize: 10, minAngle: 6, rotate: "radial" },
      levels: [{}, { label: { fontSize: 12, fontWeight: "bold", rotate: 0 } }, {}, {}, { label: { show: false } }],
      emphasis: { focus: "ancestor" },
    }],
  }), [data, chrome, metric]);
  return (
    <div className="absolute inset-0 flex flex-col">
      <LevelPicker levels={levels} setLevels={setLevels} metric={metric} setMetric={setMetric} />
      <div className="min-h-0 flex-1 p-2"><EChart option={option} onClick={(p) => { const id = (p.data as Tree)?.id; if (id) set({ drawer: id.slice(3) }); }} /></div>
    </div>
  );
}

function Treemap() {
  const chrome = useChrome();
  const set = useStore((s) => s.set);
  const [levels, setLevels] = useState<DimKey[]>(["sector"]);
  const [metric, setMetric] = useState<"jobs" | "companies">("jobs");
  const data = useHierarchy(levels, metric);
  const option = useMemo<EChartsOption>(() => ({
    tooltip: { formatter: (p: unknown) => { const q = p as { value: number; treePathInfo: { name: string }[] }; return `${q.treePathInfo.map((t) => t.name).filter(Boolean).join(" › ")}<br><b>${q.value}</b> ${metric}`; } },
    series: [{
      type: "treemap", data, left: 8, right: 8, top: 8, bottom: 36, roam: false, leafDepth: levels.length + 1 > 2 ? 2 : undefined,
      breadcrumb: { bottom: 4, itemStyle: { color: chrome.panel, borderColor: chrome.grid, textStyle: { color: chrome.text } } },
      upperLabel: { show: true, height: 22, color: "#0b1120", fontWeight: "bold" },
      label: { color: "#0b1120", fontSize: 11, formatter: (p: { name: string; value?: unknown }) => `${p.name}\n${p.value}` },
      itemStyle: { borderColor: chrome.bg, borderWidth: 2, gapWidth: 2 },
      levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 } }, { itemStyle: { gapWidth: 2 }, colorSaturation: [0.35, 0.6] }, { colorSaturation: [0.35, 0.6], itemStyle: { gapWidth: 1, borderColorSaturation: 0.6 } }],
    }],
  }), [data, chrome, metric, levels.length]);
  return (
    <div className="absolute inset-0 flex flex-col">
      <LevelPicker levels={levels} setLevels={setLevels} metric={metric} setMetric={setMetric} />
      <div className="min-h-0 flex-1 p-2"><EChart option={option} onClick={(p) => { const id = (p.data as Tree)?.id; if (id) set({ drawer: id.slice(3) }); }} /></div>
    </div>
  );
}

/* ---------------- network ---------------- */

const LINK_DIMS = { place: "Job city", family: "Role", seniority: "Seniority", hiringIn: "Hiring country", mode: "Work mode" } as const;
type LinkDim = keyof typeof LINK_DIMS;

function Network() {
  const { jobs } = useFiltered();
  const ds = useStore((s) => s.data)!;
  const set = useStore((s) => s.set);
  const only = useStore((s) => s.only);
  const chrome = useChrome();
  const [by, setBy] = useState<LinkDim>("place");

  const option = useMemo<EChartsOption>(() => {
    const val = (j: Job) => (by === "place" ? j.places.map((p) => p.name) : DIMS[by].ofJob(j));
    const edges = new Map<string, number>();
    const coJobs = new Map<Company, number>();
    const hub = new Map<string, number>();
    for (const j of jobs) {
      coJobs.set(j.company, (coJobs.get(j.company) ?? 0) + 1);
      for (const v of val(j)) {
        edges.set(j.company.id + "\u0000" + v, (edges.get(j.company.id + "\u0000" + v) ?? 0) + 1);
        hub.set(v, (hub.get(v) ?? 0) + 1);
      }
    }
    const sector = colorMap(ds, "sector");
    const maxHub = Math.max(1, ...hub.values());
    const maxCo = Math.max(1, ...coJobs.values());
    const nodes = [
      ...[...hub].map(([v, n]) => ({ id: "h:" + v, name: v, symbolSize: 18 + Math.sqrt(n / maxHub) * 46, category: 0, value: n, itemStyle: { color: chrome.panel, borderColor: chrome.accent, borderWidth: 2 }, label: { show: true, color: chrome.text, fontWeight: "bold" as const } })),
      ...[...coJobs].map(([c, n]) => ({ id: "c:" + c.id, name: c.name, symbolSize: 6 + Math.sqrt(n / maxCo) * 26, category: 1, value: n, itemStyle: { color: sector.get(c.sector) ?? MUTED }, label: { show: n / maxCo > 0.15, color: chrome.sub, fontSize: 10 } })),
    ];
    const links = [...edges].map(([k, n]) => { const [c, v] = k.split("\u0000"); return { source: "c:" + c, target: "h:" + v, value: n, lineStyle: { width: 0.5 + Math.sqrt(n) * 0.6 } }; });
    return {
      tooltip: { formatter: (p: unknown) => { const q = p as { dataType: string; data: { name?: string; value: number; source?: string; target?: string } }; return q.dataType === "edge" ? `${q.data.value} jobs` : `<b>${q.data.name}</b><br>${q.data.value} jobs`; } },
      series: [{
        type: "graph", layout: "force", roam: true, draggable: true, data: nodes, links,
        categories: [{ name: LINK_DIMS[by] }, { name: "Company" }],
        force: { repulsion: 140, edgeLength: [30, 140], gravity: 0.08, friction: 0.15 },
        lineStyle: { color: "source", opacity: 0.35, curveness: 0.1 },
        emphasis: { focus: "adjacency", lineStyle: { opacity: 0.9 } },
        labelLayout: { hideOverlap: true },
      }],
    };
  }, [jobs, by, ds, chrome]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3 text-sm text-muted">
        Link companies to
        <div className="seg">
          {(Object.keys(LINK_DIMS) as LinkDim[]).map((k) => <button key={k} aria-pressed={by === k} onClick={() => setBy(k)}>{LINK_DIMS[k]}</button>)}
        </div>
        <span className="text-xs">Company dots are colored by sector.</span>
      </div>
      <div className="min-h-0 flex-1">
        <EChart option={option} onClick={(p) => {
          if (p.dataType !== "node") return;
          const id = String((p.data as { id: string }).id);
          if (id.startsWith("c:")) set({ drawer: id.slice(2) });
          else if (by !== "place") only(by, id.slice(2));
        }} />
      </div>
    </div>
  );
}
