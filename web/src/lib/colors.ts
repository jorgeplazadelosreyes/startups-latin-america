import { useMemo } from "react";
import { DIMS, sortValues, type DimKey } from "./dims";
import { countBy } from "./filter";
import { useStore } from "./store";
import type { Dataset } from "./types";

/** Categorical palette, readable on both the dark and light surfaces. */
export const PALETTE = [
  "#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171",
  "#22d3ee", "#fb923c", "#a3e635", "#e879f9", "#2dd4bf", "#818cf8",
];
export const MUTED = "#64748b";
const MUTED_VALUES = new Set(["Other", "untracked", "Undated", "Remote"]);

const cache = new WeakMap<Dataset, Map<DimKey, Map<string, string>>>();

/** Stable value→color map for a dimension, ranked over the full dataset so colors never shift with filters. */
export function colorMap(ds: Dataset, dim: DimKey) {
  let per = cache.get(ds);
  if (!per) cache.set(ds, (per = new Map()));
  let m = per.get(dim);
  if (!m) {
    const d = DIMS[dim];
    const counts = d.level === "company" ? countBy(ds.companies, d.ofCompany!) : countBy(ds.jobs, d.ofJob);
    m = new Map();
    let i = 0;
    for (const v of sortValues(dim, counts)) m.set(v, MUTED_VALUES.has(v) || i >= PALETTE.length ? MUTED : PALETTE[i++]);
    per.set(dim, m);
  }
  return m;
}

export function useColors(dim: DimKey) {
  const ds = useStore((s) => s.data)!;
  return useMemo(() => {
    const m = colorMap(ds, dim);
    return (v: string) => m.get(v) ?? MUTED;
  }, [ds, dim]);
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Chart chrome colors per theme (ECharts and deck.gl can't read CSS variables). */
export function useChrome() {
  const theme = useStore((s) => s.theme);
  return theme === "dark"
    ? { text: "#cbd5e1", sub: "#94a3b8", grid: "#1e293b", bg: "#0b1120", panel: "#0f172a", accent: "#34d399" }
    : { text: "#1e293b", sub: "#64748b", grid: "#e2e8f0", bg: "#ffffff", panel: "#f8fafc", accent: "#059669" };
}
