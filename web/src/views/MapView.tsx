import { FlyToInterpolator, LinearInterpolator, WebMercatorViewport, type PickingInfo } from "@deck.gl/core";
import { HeatmapLayer, HexagonLayer } from "@deck.gl/aggregation-layers";
import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { Box, Building2, Flame, Pause, Play, Route, Circle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Map as BaseMap } from "react-map-gl/maplibre";
import { hexToRgb, useChrome } from "../lib/colors";
import { useFiltered } from "../lib/filter";
import { COUNTRY_FLAGS } from "../lib/geo";
import { useStore, type MapMode } from "../lib/store";
import type { Company, Job, Office, Place } from "../lib/types";
import Markers, { CITY_ZOOM, COUNTRY_AT, REGION_ZOOM, regionOf } from "../components/MapMarkers";

// MapLibre finds its worker relative to its own module, which bundling breaks; point it at the emitted asset.
setWorkerUrl(workerUrl);

const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

const INITIAL = { longitude: -72, latitude: -12, zoom: window.innerWidth < 640 ? 1.7 : 2.6, pitch: 0, bearing: 0 };
const TILT: Partial<Record<MapMode, { pitch: number; bearing: number; zoom?: number }>> = {
  hex: { pitch: 50, bearing: -12, zoom: 3 },
  arcs: { pitch: 40, bearing: 8 },
};

const MODES: [MapMode, string, typeof Circle, string][] = [
  ["cities", "Cities", Circle, "Startup hubs sized by number of companies, shaded by open jobs. Click a hub to fly in and see its companies."],
  ["companies", "Companies", Building2, "Regions, then countries, then cities, then each company's logo at its office. Click to zoom in."],
  ["heat", "Heat", Flame, "Density of open jobs by where they are located (not where the company is based)."],
  ["hex", "3D", Box, "Open jobs binned into 3D hexagons. Drag with right-click / two fingers to tilt."],
  ["arcs", "Flows", Route, "Cross-border hiring: arcs go from a company's HQ to the cities where it is hiring."],
];

const HEAT = [[13, 59, 102], [16, 120, 140], [52, 211, 153], [190, 242, 100], [250, 204, 21], [244, 63, 94]] as [number, number, number][];

type CityAgg = { place: Place; companies: Company[]; jobs: number };
type Arc = { from: Place; to: Place; n: number; companies: Map<string, number> };

/** Deterministic golden-angle spiral, so companies sharing a city fan out around it. */
const spiral = (i: number) => {
  const r = Math.sqrt(i + 0.5);
  const a = i * 2.39996;
  return [Math.cos(a) * r, Math.sin(a) * r];
};

export default function MapView() {
  const ds = useStore((s) => s.data)!;
  const theme = useStore((s) => s.theme);
  const mode = useStore((s) => s.mapMode);
  const set = useStore((s) => s.set);
  const citySel = useStore((s) => s.f.city);
  const hover = useStore((s) => s.hover);
  const chrome = useChrome();
  const { jobs, companies } = useFiltered();
  const [view, setView] = useState<Record<string, unknown>>(() => ({ ...INITIAL, ...TILT[mode] }));
  const zoom = (view.zoom as number) ?? INITIAL.zoom;

  /* ---- time scrubber: replay postings day by day ---- */
  const timeline = mode === "heat" || mode === "hex" || mode === "arcs";
  const span = 120;
  const [until, setUntil] = useState<number | null>(null); // days before generation date; null = all
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setUntil((u) => {
        const next = (u ?? span) - 2;
        if (next <= 0) { setPlaying(false); return 0; }
        return next;
      });
    }, 70);
    return () => clearInterval(timer.current);
  }, [playing]);
  useEffect(() => { if (!timeline) { setPlaying(false); setUntil(null); } }, [timeline]);

  const shownJobs = useMemo(
    () => (until == null ? jobs : jobs.filter((j) => j.ageDays != null && j.ageDays >= until)),
    [jobs, until],
  );
  const untilDate = until == null ? null : new Date(+ds.generatedAt - until * 86_400_000);

  /* ---- aggregates ---- */
  const cityAgg = useMemo(() => {
    const m = new Map<string, CityAgg>();
    const jobsBy = new Map<Company, number>();
    for (const j of jobs) jobsBy.set(j.company, (jobsBy.get(j.company) ?? 0) + 1);
    for (const c of companies) {
      const a = m.get(c.hq.id) ?? { place: c.hq, companies: [], jobs: 0 };
      a.companies.push(c);
      a.jobs += jobsBy.get(c) ?? 0;
      m.set(c.hq.id, a);
    }
    return [...m.values()].sort((a, b) => b.jobs - a.jobs || b.companies.length - a.companies.length);
  }, [jobs, companies]);

  const jobPoints = useMemo(
    () => shownJobs.flatMap((j) => j.places.map((p) => ({ j, p, w: 1 / j.places.length }))),
    [shownJobs],
  );

  const arcs = useMemo(() => {
    const m = new Map<string, Arc>();
    for (const j of shownJobs)
      for (const p of j.places) {
        if (p.id === j.company.hq.id) continue;
        const k = j.company.hq.id + ">" + p.id;
        const a = m.get(k) ?? { from: j.company.hq, to: p, n: 0, companies: new Map() };
        a.n += 1 / j.places.length;
        a.companies.set(j.company.name, (a.companies.get(j.company.name) ?? 0) + 1);
        m.set(k, a);
      }
    return [...m.values()];
  }, [shownJobs]);

  /* Precise offices sit at their pinned address; the rest fan out around their city center as hollow rings. */
  const coPoints = useMemo(() => {
    // Logos are ~30px wide: keep neighbours that far apart at any zoom.
    const px = 34;
    const scale = (px * 360) / (512 * Math.pow(2, zoom));
    type Pt = { c: Company; o: Office; pos: [number, number] };
    const out: Pt[] = [];
    const approx = new Map<string, { c: Company; o: Office }[]>();
    for (const c of companies)
      for (const o of c.offices) {
        if (o.precise) out.push({ c, o, pos: [o.lng, o.lat] });
        else approx.set(o.place.id, [...(approx.get(o.place.id) ?? []), { c, o }]);
      }
    for (const group of approx.values())
      group
        .sort((a, b) => Number(b.o.hq) - Number(a.o.hq) || b.c.jobs.length - a.c.jobs.length)
        .forEach(({ c, o }, i) => {
          const [dx, dy] = spiral(i + 1);
          out.push({ c, o, pos: [o.lng + dx * scale, o.lat + dy * scale * 0.9] });
        });
    return out;
  }, [companies, zoom]);

  /* ---- layers ---- */
  const accent = hexToRgb(chrome.accent);
  const ink = theme === "dark" ? [226, 232, 240] : [15, 23, 42];
  const maxJobs = Math.max(1, ...cityAgg.map((a) => a.jobs));

  const layers = [];
  if (mode === "cities") {
    layers.push(
      new ScatterplotLayer<CityAgg>({
        id: "cities",
        data: cityAgg,
        getPosition: (a) => [a.place.lng, a.place.lat],
        getRadius: 12,
        radiusUnits: "pixels",
        getFillColor: (a) => [...accent, 60 + Math.round((a.jobs / maxJobs) * 170)] as [number, number, number, number],
        getLineColor: (a) => (citySel.includes(a.place.name) ? [251, 191, 36, 255] : [...accent, 255]) as [number, number, number, number],
        getLineWidth: (a) => (citySel.includes(a.place.name) ? 3 : 1.5),
        lineWidthUnits: "pixels",
        stroked: true,
        pickable: true,
        onClick: ({ object }) => object && enterCity(object.place),
        updateTriggers: { getLineColor: citySel, getLineWidth: citySel, getFillColor: [maxJobs, accent] },
        transitions: { getFillColor: 400 },
      }),
      new TextLayer<CityAgg>({
        id: "city-n",
        data: cityAgg,
        getPosition: (a) => [a.place.lng, a.place.lat],
        getText: (a) => String(a.companies.length),
        getSize: 12,
        getColor: ink as [number, number, number],
        fontWeight: 700,
        fontFamily: "Inter, system-ui, sans-serif",
        characterSet: "auto",
        updateTriggers: { getColor: theme },
      }),
      new TextLayer<CityAgg>({
        id: "city-label",
        data: zoom > 3.6 ? cityAgg : cityAgg.slice(0, 6),
        getPosition: (a) => [a.place.lng, a.place.lat],
        getText: (a) => a.place.name,
        getSize: 11,
        getPixelOffset: [0, 22],
        getColor: [...ink, 200] as [number, number, number, number],
        fontFamily: "Inter, system-ui, sans-serif",
        characterSet: "auto",
        updateTriggers: { getColor: theme },
      }),
    );
  }
  if (mode === "heat") {
    layers.push(
      new HeatmapLayer<(typeof jobPoints)[number]>({
        id: "heat",
        data: jobPoints,
        getPosition: (d) => [d.p.lng, d.p.lat],
        getWeight: (d) => d.w,
        radiusPixels: 55,
        intensity: 1.4,
        threshold: 0.03,
        colorRange: HEAT,
      }),
    );
  }
  if (mode === "hex") {
    layers.push(
      new HexagonLayer<(typeof jobPoints)[number]>({
        id: "hex",
        data: jobPoints,
        getPosition: (d) => [d.p.lng + ((hash(d.j.id) % 100) - 50) / 900, d.p.lat + ((hash(d.j.id + "y") % 100) - 50) / 900],
        radius: 110_000,
        extruded: true,
        elevationScale: 600,
        coverage: 0.9,
        colorRange: HEAT,
        pickable: true,
        material: { ambient: 0.6, diffuse: 0.6, shininess: 40 },
        transitions: { elevationScale: 500 },
        gpuAggregation: false,
      }),
    );
  }
  if (mode === "arcs") {
    const maxN = Math.max(1, ...arcs.map((a) => a.n));
    layers.push(
      new ArcLayer<Arc>({
        id: "arcs",
        data: arcs,
        getSourcePosition: (a) => [a.from.lng, a.from.lat],
        getTargetPosition: (a) => [a.to.lng, a.to.lat],
        getSourceColor: [...accent, 220] as [number, number, number, number],
        getTargetColor: [244, 114, 182, 230],
        getWidth: (a) => 1 + (a.n / maxN) * 9,
        getHeight: 0.6,
        greatCircle: false,
        pickable: true,
        autoHighlight: true,
        highlightColor: [251, 191, 36, 255],
      }),
      new ScatterplotLayer<Place>({
        id: "arc-ends",
        data: [...new Map(arcs.flatMap((a) => [[a.from.id, a.from], [a.to.id, a.to]] as [string, Place][])).values()],
        getPosition: (p) => [p.lng, p.lat],
        getRadius: 4,
        radiusUnits: "pixels",
        getFillColor: [...ink, 200] as [number, number, number, number],
        updateTriggers: { getFillColor: theme },
      }),
    );
  }

  const tooltip = (info: PickingInfo) => {
    const o = info.object as unknown;
    if (!o) return null;
    let html = "";
    if (info.layer?.id === "cities") {
      const a = o as CityAgg;
      const top = [...a.companies].sort((x, y) => y.jobs.length - x.jobs.length).slice(0, 5).map((c) => c.name).join(", ");
      html = `<b>${COUNTRY_FLAGS[a.place.country] ?? ""} ${a.place.name}</b><br>${a.companies.length} startups · ${a.jobs.toLocaleString()} open jobs<br><span style="opacity:.7">${top}</span>`;
    } else if (info.layer?.id === "companies") {
      const { c, o: off } = o as (typeof coPoints)[number];
      const where = off.hq ? (off.precise ? `📍 ${off.label.split(",").slice(0, 3).join(",")}` : `HQ in ${off.place.name} · exact address unknown`) : `${off.place.name} office · ${off.jobs} jobs listed here`;
      html = `<b>${c.name}</b><br>${c.sector} · ${c.stage}<br><span style="opacity:.75">${where}</span><br>${c.tracked ? `${c.jobs.length} open jobs via ${c.ats}` : "jobs not tracked"}`;
    } else if (info.layer?.id === "hex") {
      const h = o as { count: number; points?: { j: Job }[] };
      const names = [...new Set((h.points ?? []).map((p) => p.j.company.name))].slice(0, 6).join(", ");
      html = `<b>${h.count} jobs</b>${names ? `<br><span style="opacity:.7">${names}</span>` : ""}`;
    } else if (info.layer?.id === "arcs") {
      const a = o as Arc;
      const cs = [...a.companies].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([n, k]) => `${n} (${k})`).join("<br>");
      html = `<b>${a.from.name} → ${a.to.name}</b><br>${Math.round(a.n)} jobs<br><span style="opacity:.7">${cs}</span>`;
    }
    return html ? { html, style: { background: chrome.panel, color: chrome.text, border: `1px solid ${chrome.grid}`, borderRadius: "10px", padding: "8px 10px", fontSize: "12px", lineHeight: "1.45", maxWidth: "260px" } } : null;
  };

  const boundsTimer = useRef<number>(0);
  const publishBounds = (v: Record<string, unknown>) => {
    clearTimeout(boundsTimer.current);
    boundsTimer.current = window.setTimeout(() => {
      if (!v.width || !v.height) return;
      const b = new WebMercatorViewport(v as never).getBounds() as [number, number, number, number];
      useStore.setState({ bounds: b });
    }, 120);
  };
  useEffect(() => publishBounds(view), [view]);

  /** Fly into a city and show its companies: frames every office pinned there (zoom 10–13). */
  const enterCity = (p: Place) => {
    const pts = ds.companies.flatMap((c) => c.offices.filter((o) => o.place.id === p.id && o.precise).map((o) => [o.lng, o.lat]));
    let target = { longitude: p.lng, latitude: p.lat, zoom: 11.5 };
    if (pts.length > 1 && view.width && view.height) {
      const lng = pts.map((q) => q[0]), lat = pts.map((q) => q[1]);
      const fit = new WebMercatorViewport(view as never).fitBounds(
        [[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]],
        { padding: Math.min(80, (view.width as number) / 6) },
      );
      target = { longitude: fit.longitude, latitude: fit.latitude, zoom: Math.max(10, Math.min(13, fit.zoom)) };
    }
    set({ mapMode: "companies" });
    setView({ ...view, ...target, pitch: 0, bearing: 0, transitionDuration: 1400, transitionInterpolator: new FlyToInterpolator() });
  };

  useEffect(() => {
    const tilt = TILT[mode];
    const lerp = new LinearInterpolator(["pitch", "bearing", "zoom"]);
    if (tilt) setView((v) => ({ ...v, ...tilt, transitionDuration: 900, transitionInterpolator: lerp }));
    else setView((v) => (v.pitch ? { ...v, pitch: 0, bearing: 0, transitionDuration: 600, transitionInterpolator: lerp } : v));
  }, [mode]);

  /** Fly to a region, framing its country labels, at a zoom that shows countries (not yet cities). */
  const enterRegion = (region: string) => {
    const pts = [...new Set(companies.map((c) => c.hq.country))].filter((k) => regionOf(k) === region && COUNTRY_AT[k]).map((k) => COUNTRY_AT[k]);
    if (!pts.length || !view.width || !view.height) return;
    const lng = pts.map((q) => q[0]), lat = pts.map((q) => q[1]);
    const fit = new WebMercatorViewport(view as never).fitBounds(
      [[Math.min(...lng) - 3, Math.min(...lat) - 3], [Math.max(...lng) + 3, Math.max(...lat) + 3]],
      { padding: Math.min(60, (view.width as number) / 8) },
    );
    const zoom = Math.max(REGION_ZOOM + 0.3, Math.min(CITY_ZOOM - 0.2, fit.zoom));
    setView({ ...view, longitude: fit.longitude, latitude: fit.latitude, zoom, pitch: 0, bearing: 0, transitionDuration: 1200, transitionInterpolator: new FlyToInterpolator() });
  };

  /** Fly to a country, framing the cities its startups are in. */
  const enterCountry = (country: string) => {
    const pts = cityAgg.filter((a) => a.place.country === country).map((a) => [a.place.lng, a.place.lat]);
    if (!pts.length || !view.width || !view.height) return;
    const lng = pts.map((q) => q[0]), lat = pts.map((q) => q[1]);
    const pad = 1.5;
    const fit = new WebMercatorViewport(view as never).fitBounds(
      [[Math.min(...lng) - pad, Math.min(...lat) - pad], [Math.max(...lng) + pad, Math.max(...lat) + pad]],
      { padding: Math.min(80, (view.width as number) / 6) },
    );
    const zoom = Math.max(CITY_ZOOM + 0.2, Math.min(7, fit.zoom));
    setView({ ...view, longitude: fit.longitude, latitude: fit.latitude, zoom, pitch: 0, bearing: 0, transitionDuration: 1200, transitionInterpolator: new FlyToInterpolator() });
  };

  return (
    <div className="absolute inset-0">
      <DeckGL
        viewState={view as never}
        onViewStateChange={({ viewState }) => setView(viewState as Record<string, unknown>)}
        onResize={() => publishBounds(view)}
        controller={{ dragRotate: true, touchRotate: true }}
        layers={layers}
        getTooltip={tooltip}
        getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
      >
        <BaseMap mapStyle={STYLES[theme]} attributionControl={{ compact: true }} />
      </DeckGL>

      {/* mode switcher */}
      <div className="absolute left-3 top-3 flex flex-wrap gap-2">
        <div className="seg shadow-lg">
          {MODES.map(([m, label, Icon]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => set({ mapMode: m })} title={label}>
              <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {mode === "companies" && (
        <Markers view={view} companies={companies} points={coPoints} cityAgg={cityAgg}
          onCountry={enterCountry} onRegion={enterRegion} onCity={enterCity} onCompany={(id) => set({ drawer: id })}
          hover={hover} setHover={(id) => set({ hover: id })} />
      )}

      {/* time scrubber */}
      {timeline && (
        <div className="card absolute bottom-8 right-3 flex w-[min(380px,calc(100%-24px))] items-center gap-3 p-3 shadow-xl max-md:bottom-auto max-md:top-16">
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"
            onClick={() => { if (!playing && (until == null || until <= 0)) setUntil(span); setPlaying(!playing); }}
            aria-label={playing ? "Pause" : "Replay postings"}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <div className="min-w-0 flex-1">
            <input type="range" min={0} max={span} value={span - (until ?? 0)} onChange={(e) => { setPlaying(false); setUntil(span - +e.target.value); }} className="w-full accent-[var(--accent)]" aria-label="Posted up to" />
            <div className="flex justify-between text-[11px] text-muted">
              <span>{untilDate ? `Posted by ${untilDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "All jobs (incl. undated)"}</span>
              <span className="tabular-nums">{shownJobs.length} jobs</span>
              {until != null && <button className="hover:text-accent" onClick={() => { setPlaying(false); setUntil(null); }}>reset</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
