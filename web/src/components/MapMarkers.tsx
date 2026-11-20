import { WebMercatorViewport } from "@deck.gl/core";
import { useMemo, useState } from "react";
import { COUNTRY_FLAGS } from "../lib/geo";
import type { Company, Office, Place } from "../lib/types";

/** Below REGION_ZOOM the map shows two regions; then countries; from CITY_ZOOM cities; from LOGO_ZOOM each logo. */
export const REGION_ZOOM = 3;
export const CITY_ZOOM = 4.3;
export const LOGO_ZOOM = 9;

/** Where to put a country's label (roughly its centroid; Chile sits on its populated center). */
export const COUNTRY_AT: Record<string, [number, number]> = {
  Brazil: [-51, -11], Mexico: [-102, 23.5], Colombia: [-73.5, 4.5], Argentina: [-64.5, -35], Chile: [-71, -31],
  Peru: [-75, -9.5], Uruguay: [-56, -32.8], Ecuador: [-78.4, -1.6], "El Salvador": [-88.9, 13.8],
  "Costa Rica": [-84, 9.9], Panama: [-80, 8.6], Guatemala: [-90.3, 15.6], Paraguay: [-58, -23.4],
  Bolivia: [-64.7, -16.7], Venezuela: [-66.2, 7.5], Honduras: [-86.6, 14.8], Nicaragua: [-85.2, 12.9],
  "Dominican Republic": [-70.4, 18.8],
};

/** Countries north of Colombia (Mexico, Central America, the Caribbean) vs South America. */
const NORTH = new Set(["Mexico", "Guatemala", "El Salvador", "Honduras", "Nicaragua", "Costa Rica", "Panama", "Dominican Republic", "Belize", "Cuba", "Puerto Rico", "Jamaica"]);
export const regionOf = (country: string) => (NORTH.has(country) ? "Mexico & Central America" : "South America");
const REGION_AT: Record<string, [number, number]> = { "South America": [-60, -16], "Mexico & Central America": [-94, 19] };
const REGION_ICON: Record<string, string> = { "South America": "🌎", "Mexico & Central America": "🌎" };

type CityAgg = { place: Place; companies: Company[]; jobs: number };
type Pt = { c: Company; o: Office; pos: [number, number] };

type Props = {
  view: Record<string, unknown>;
  companies: Company[];
  points: Pt[];
  cityAgg: CityAgg[];
  onCountry: (country: string) => void;
  onRegion: (region: string) => void;
  onCity: (p: Place) => void;
  onCompany: (id: string) => void;
  hover: string | null;
  setHover: (id: string | null) => void;
};

/** HTML markers drawn over the map, so flags, names and logos render crisply and stay the same size at any zoom. */
export default function Markers({ view, companies, points, cityAgg, onCountry, onRegion, onCity, onCompany, hover, setHover }: Props) {
  const zoom = (view.zoom as number) ?? 3;
  const vp = useMemo(() => (view.width && view.height ? new WebMercatorViewport(view as never) : null), [view]);

  const countries = useMemo(() => {
    const m = new Map<string, { country: string; companies: number; pos: [number, number] }>();
    for (const c of companies) {
      const k = c.hq.country;
      const e = m.get(k) ?? { country: k, companies: 0, pos: COUNTRY_AT[k] ?? [c.hq.lng, c.hq.lat] };
      e.companies++;
      m.set(k, e);
    }
    return [...m.values()];
  }, [companies]);

  const regions = useMemo(() => {
    const m = new Map<string, { region: string; companies: number; countries: Set<string> }>();
    for (const k of countries) {
      const r = regionOf(k.country);
      const e = m.get(r) ?? { region: r, companies: 0, countries: new Set<string>() };
      e.companies += k.companies;
      e.countries.add(k.country);
      m.set(r, e);
    }
    return [...m.values()];
  }, [countries]);

  if (!vp) return null;
  const W = view.width as number, H = view.height as number;
  const at = (lng: number, lat: number) => {
    const [x, y] = vp.project([lng, lat]);
    return x < -60 || y < -60 || x > W + 60 || y > H + 60 ? null : { left: x, top: y };
  };

  // Pills are wide labels: biggest first keep their spot, others slide vertically/sideways until they don't overlap.
  const boxes: { x: number; y: number; w: number }[] = [];
  const pill = (lng: number, lat: number, label: string) => {
    const p = at(lng, lat);
    if (!p) return null;
    const w = label.length * 7 + 64, h = 28;
    // Candidate spots: the true point, then rings around it (vertical steps of one pill height, sideways half-widths).
    const tries: [number, number][] = [[0, 0]];
    for (let r = 1; r <= 4; r++)
      for (const [dx, dy] of [[0, r], [0, -r], [r / 2, 0], [-r / 2, 0], [r / 2, r], [-r / 2, r], [r / 2, -r], [-r / 2, -r]])
        tries.push([dx * w, dy * h]);
    for (const [dx, dy] of tries) {
      const x = p.left + dx, y = p.top + dy;
      if (!boxes.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 4 && Math.abs(b.y - y) < h)) {
        boxes.push({ x, y, w });
        return { left: x, top: y };
      }
    }
    boxes.push({ x: p.left, y: p.top, w });
    return p;
  };

  if (zoom < REGION_ZOOM)
    return (
      <Layer>
        {regions.map((r) => {
          const p = pill(...REGION_AT[r.region], r.region);
          return p && (
            <button key={r.region} style={p} className="marker-pill !px-3.5 !py-1.5 !text-sm" onClick={() => onRegion(r.region)}
              title={`${r.region}: ${r.companies} startups in ${r.countries.size} countries`}>
              <span className="text-lg leading-none">{REGION_ICON[r.region]}</span>
              <span className="font-semibold">{r.region}</span>
              <span className="text-muted tabular-nums">{r.companies}</span>
              <span className="text-xs text-muted">· {r.countries.size} countries</span>
            </button>
          );
        })}
      </Layer>
    );

  if (zoom < CITY_ZOOM)
    return (
      <Layer>
        {[...countries].sort((a, b) => b.companies - a.companies).map((k) => {
          const p = pill(...k.pos, k.country);
          return p && (
            <button key={k.country} style={p} className="marker-pill" onClick={() => onCountry(k.country)}
              title={`${k.country}: ${k.companies} startups`}>
              <span className="text-base leading-none">{COUNTRY_FLAGS[k.country] ?? "🏳️"}</span>
              <span className="font-semibold">{k.country}</span>
              <span className="text-muted tabular-nums">{k.companies}</span>
            </button>
          );
        })}
      </Layer>
    );

  if (zoom < LOGO_ZOOM)
    return (
      <Layer>
        {[...cityAgg].sort((a, b) => b.companies.length - a.companies.length).map((a) => {
          const p = pill(a.place.lng, a.place.lat, a.place.name);
          return p && (
            <button key={a.place.id} style={p} className="marker-pill" onClick={() => onCity(a.place)}
              title={`${a.place.name}: ${a.companies.length} startups · ${a.jobs} open jobs`}>
              <span className="text-sm leading-none">{COUNTRY_FLAGS[a.place.country] ?? "🏳️"}</span>
              <span className="font-medium">{a.place.name}</span>
              <span className="text-muted tabular-nums">{a.companies.length}</span>
            </button>
          );
        })}
      </Layer>
    );

  // Declutter in screen space: biggest employers keep their spot, others step out along a spiral until free.
  const GAP = 36;
  const placed: { x: number; y: number }[] = [];
  const names: { x: number; y: number; w: number }[] = [];
  // Spatial grid (cell = GAP) so each collision test only looks at nearby logos.
  const grid = new Map<string, { x: number; y: number }[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / GAP)},${Math.floor(y / GAP)}`;
  const near = (x: number, y: number, d: number) => {
    const cx = Math.floor(x / GAP), cy = Math.floor(y / GAP), out: { x: number; y: number }[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${cx + i},${cy + j}`) ?? []));
    return out.filter((q) => Math.hypot(q.x - x, q.y - y) < d);
  };
  const laid = [...points]
    .sort((a, b) => Number(b.o.precise) - Number(a.o.precise) || b.c.jobs.length - a.c.jobs.length)
    .map((pt) => {
      const p = at(...pt.pos);
      if (!p) return null;
      let { left: x, top: y } = p;
      for (let i = 1; near(x, y, GAP).length && i < 200; i++) {
        const r = GAP * 0.55 * Math.sqrt(i), a = i * 2.39996;
        x = p.left + Math.cos(a) * r;
        y = p.top + Math.sin(a) * r;
      }
      placed.push({ x, y });
      const k = cell(x, y);
      grid.set(k, [...(grid.get(k) ?? []), { x, y }]);
      const w = pt.c.name.length * 6.5 + 10;
      const showName = zoom > 10.5 && !names.some((n) => Math.abs(n.x - x) < (n.w + w) / 2 && Math.abs(n.y - y) < 18)
        && !near(x, y + 28, 22).some((q) => q.x !== x || q.y !== y);
      if (showName) names.push({ x, y: y + 26, w });
      return { ...pt, style: { left: x, top: y }, showName };
    })
    .filter(Boolean) as (Pt & { style: { left: number; top: number }; showName: boolean })[];

  return (
    <Layer>
      {laid.map(({ c, o, style, showName }) => {
        const p = style;
        return (
          <button key={c.id + o.place.id + o.hq} style={p}
            className={`marker-logo ${o.precise ? "" : "opacity-80 border-dashed"} ${hover === c.id ? "ring-2 ring-amber-400 z-10" : ""}`}
            onClick={() => onCompany(c.id)} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)}
            title={`${c.name}${o.hq ? "" : ` · ${o.place.name} office`}${o.precise ? "" : " · exact address unknown"}`}>
            <Logo c={c} />
            {showName && <span className="marker-name">{c.name}</span>}
          </button>
        );
      })}
    </Layer>
  );
}

const Layer = ({ children }: { children: React.ReactNode }) => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">{children}</div>
);

/** Company logo: scraped site icon / Wikidata logo, then a favicon service, then initials. */
export function Logo({ c, size = 26 }: { c: Company; size?: number }) {
  const sources = useMemo(() => {
    const s = [c.info?.logo, c.website && `https://www.google.com/s2/favicons?domain=${c.website}&sz=128`];
    return s.filter(Boolean) as string[];
  }, [c]);
  const [i, setI] = useState(0);
  if (i >= sources.length)
    return (
      <span className="grid place-items-center rounded bg-accent/15 text-[10px] font-bold text-accent" style={{ width: size, height: size }}>
        {c.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
      </span>
    );
  return <img src={sources[i]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setI(i + 1)}
    className="rounded object-contain" style={{ width: size, height: size }} />;
}
