import { Command } from "cmdk";
import Fuse from "fuse.js";
import { Briefcase, Building2, Eraser, Filter, LayoutGrid, MapPin, Search, SunMoon } from "lucide-react";
import { useMemo, useState } from "react";
import { DIMS, type DimKey } from "../lib/dims";
import { useStore, VIEWS, type View } from "../lib/store";
import { Logo } from "./Logo";

type Item = { id: string; group: string; label: string; sub?: string; run: () => void; icon?: React.ReactNode; keys?: string };

const PALETTE_DIMS: DimKey[] = ["sector", "family", "seniority", "city", "country", "hiringIn", "source", "mode", "stage"];

export function CommandPalette() {
  const open = useStore((s) => s.palette);
  const ds = useStore((s) => s.data)!;
  const set = useStore((s) => s.set);
  const [q, setQ] = useState("");

  const items = useMemo<Item[]>(() => {
    const st = useStore.getState;
    const close = (p: object = {}) => { set({ palette: false, ...p }); setQ(""); };
    const out: Item[] = [];
    for (const v of VIEWS) out.push({ id: "v:" + v, group: "Go to", label: v[0].toUpperCase() + v.slice(1), icon: <LayoutGrid size={15} />, run: () => close({ view: v as View }) });
    out.push({ id: "a:clear", group: "Actions", label: "Clear all filters", icon: <Eraser size={15} />, run: () => { st().clear(); close(); } });
    out.push({ id: "a:theme", group: "Actions", label: "Toggle light / dark", icon: <SunMoon size={15} />, run: () => close({ theme: st().theme === "dark" ? "light" : "dark" }) });
    for (const c of ds.companies)
      out.push({ id: "c:" + c.id, group: "Companies", label: c.name, sub: `${c.sector} · ${c.hq.name} · ${c.jobs.length} jobs`, keys: c.website ?? "", icon: <Logo c={c} size={20} />, run: () => close({ drawer: c.id }) });
    for (const k of PALETTE_DIMS) {
      const vals = new Set(ds.jobs.flatMap(DIMS[k].ofJob).concat(DIMS[k].ofCompany ? ds.companies.flatMap(DIMS[k].ofCompany) : []));
      for (const v of vals)
        out.push({ id: `f:${k}:${v}`, group: "Filter by", label: v, sub: DIMS[k].label, icon: k === "city" || k === "country" || k === "hiringIn" ? <MapPin size={15} /> : <Filter size={15} />, run: () => { st().only(k, v); close(); } });
    }
    for (const j of ds.jobs)
      out.push({ id: "j:" + j.id, group: "Jobs", label: j.title, sub: `${j.company.name} · ${j.location || j.company.hq.name}`, keys: j.family, icon: <Briefcase size={15} />, run: () => { window.open(j.url, "_blank", "noopener"); close(); } });
    return out;
  }, [ds, set]);

  const fuse = useMemo(() => new Fuse(items, { keys: [{ name: "label", weight: 3 }, "sub", "keys"], threshold: 0.35, ignoreLocation: true }), [items]);

  const groups = useMemo(() => {
    const text = q.trim();
    const free: Item[] = text
      ? [{ id: "q:" + text, group: "Search", label: `Show jobs matching “${text}”`, sub: "keyword filter", icon: <Search size={15} />,
           run: () => { set({ q: text, palette: false }); setQ(""); } }]
      : [];
    const res = free.concat(q.trim() ? fuse.search(q.trim(), { limit: 80 }).map((r) => r.item) : items.filter((i) => i.group === "Go to" || i.group === "Actions" || (i.group === "Companies" && ds.byId.get(i.id.slice(2))!.jobs.length > 20)));
    const g = new Map<string, Item[]>();
    for (const it of res) {
      const arr = g.get(it.group) ?? [];
      if (arr.length < 8) arr.push(it);
      g.set(it.group, arr);
    }
    return g;
  }, [q, fuse, items, ds, set]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => { set({ palette: o }); if (!o) setQ(""); }}
      shouldFilter={false}
      label="Search"
      overlayClassName="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[12vh] z-[61] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
    >
      <Command.Input value={q} onValueChange={setQ} placeholder="Search roles, levels, companies, cities, sectors…" className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-muted" />
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="p-6 text-center text-sm text-muted">Nothing found.</Command.Empty>
        {[...groups].map(([group, its]) => (
          <Command.Group key={group} heading={group}>
            {its.map((it) => (
              <Command.Item key={it.id} value={it.id} onSelect={it.run}>
                <span className="grid w-5 shrink-0 place-items-center text-muted">{it.icon ?? <Building2 size={15} />}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.sub && <span className="max-w-[45%] truncate text-xs text-muted">{it.sub}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
