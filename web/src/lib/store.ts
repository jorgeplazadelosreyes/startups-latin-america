import { create } from "zustand";
import { DIM_KEYS, type DimKey } from "./dims";
import type { Dataset } from "./types";

export const VIEWS = ["map", "jobs", "companies", "sources", "explore", "trends"] as const;
export type View = (typeof VIEWS)[number];
export type MapMode = "cities" | "companies" | "heat" | "hex" | "arcs";
export type ExploreMode = "pivot" | "sankey" | "sunburst" | "treemap" | "network";

export type Filters = Record<DimKey, string[]>;
const emptyFilters = (): Filters => Object.fromEntries(DIM_KEYS.map((k) => [k, []])) as unknown as Filters;

type State = {
  data: Dataset | null;
  error: string | null;
  view: View;
  q: string;
  f: Filters;
  hiringOnly: boolean;
  mapMode: MapMode;
  explore: ExploreMode;
  drawer: string | null;
  palette: boolean;
  theme: "dark" | "light";
  saved: string[];
  /** Visible map area [west, south, east, north]; the sidebar lists what falls inside it. */
  bounds: [number, number, number, number] | null;
  /** Company hovered in the sidebar or on the map, highlighted in both. */
  hover: string | null;
  setData: (d: Dataset) => void;
  setError: (e: string) => void;
  set: (p: Partial<State>) => void;
  toggle: (dim: DimKey, value: string) => void;
  /** Replace a dimension's selection with one value (or clear it when already the only one). */
  only: (dim: DimKey, value: string) => void;
  clear: (dim?: DimKey) => void;
  toggleSaved: (jobUrl: string) => void;
};

const loadSaved = (): string[] => {
  try { return JSON.parse(localStorage.getItem("saved-jobs") || "[]"); } catch { return []; }
};
const loadTheme = (): "dark" | "light" => {
  try { return (localStorage.getItem("theme") as "dark" | "light") || "light"; } catch { return "light"; }
};

export const useStore = create<State>((set, get) => ({
  data: null,
  error: null,
  view: "map",
  q: "",
  f: emptyFilters(),
  hiringOnly: false,
  mapMode: "companies",
  explore: "pivot",
  drawer: null,
  palette: false,
  theme: loadTheme(),
  saved: loadSaved(),
  bounds: null,
  hover: null,
  setData: (data) => set({ data }),
  setError: (error) => set({ error }),
  set: (p) => set(p),
  toggle: (dim, value) => {
    const cur = get().f[dim];
    set({ f: { ...get().f, [dim]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } });
  },
  only: (dim, value) => {
    const cur = get().f[dim];
    set({ f: { ...get().f, [dim]: cur.length === 1 && cur[0] === value ? [] : [value] } });
  },
  clear: (dim) => set(dim ? { f: { ...get().f, [dim]: [] } } : { f: emptyFilters(), q: "", hiringOnly: false }),
  toggleSaved: (url) => {
    const s = get().saved;
    const saved = s.includes(url) ? s.filter((u) => u !== url) : [...s, url];
    try { localStorage.setItem("saved-jobs", JSON.stringify(saved)); } catch { /* storage unavailable */ }
    set({ saved });
  },
}));

/* ---------- URL <-> state, so every view and filter combination is a shareable link ---------- */

export function readUrl() {
  const p = new URLSearchParams(location.search);
  const f = emptyFilters();
  for (const k of DIM_KEYS) f[k] = p.getAll(k);
  const view = p.get("view") as View;
  const mapMode = p.get("map") as MapMode;
  const explore = p.get("explore") as ExploreMode;
  useStore.setState({
    f,
    q: p.get("q") ?? "",
    hiringOnly: p.get("hiring") === "1",
    view: VIEWS.includes(view) ? view : "map",
    ...(mapMode ? { mapMode } : {}),
    ...(explore ? { explore } : {}),
    drawer: p.get("co"),
  });
}

export function startUrlSync() {
  return useStore.subscribe((s) => {
    const p = new URLSearchParams();
    if (s.view !== "map") p.set("view", s.view);
    if (s.q) p.set("q", s.q);
    for (const k of DIM_KEYS) for (const v of s.f[k]) p.append(k, v);
    if (s.hiringOnly) p.set("hiring", "1");
    if (s.view === "map" && s.mapMode !== "companies") p.set("map", s.mapMode);
    if (s.view === "explore" && s.explore !== "pivot") p.set("explore", s.explore);
    if (s.drawer) p.set("co", s.drawer);
    const qs = p.toString();
    const next = qs ? "?" + qs : location.pathname;
    if (next !== location.search && !(next === location.pathname && !location.search)) history.replaceState(null, "", next);
  });
}
