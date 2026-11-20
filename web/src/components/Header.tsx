import { BarChart3, Building2, Briefcase, Database, List, Map, Moon, Network, Search, Sun } from "lucide-react";
import { useFiltered } from "../lib/filter";
import { useStore, type View } from "../lib/store";

const NAV: [View, string, typeof Map][] = [
  ["map", "Map", Map],
  ["jobs", "Jobs", Briefcase],
  ["companies", "Companies", Building2],
  ["explore", "Explore", Network],
  ["trends", "Trends", BarChart3],
  ["sources", "Sources", Database],
];

export function Header({ onList }: { onList: () => void }) {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const set = useStore((s) => s.set);
  const data = useStore((s) => s.data)!;
  const { jobs, companies } = useFiltered();
  const hiring = new Set(jobs.map((j) => j.company.id)).size;
  const cities = new Set(companies.map((c) => c.hq.id)).size;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="none" stroke="var(--accent)" strokeWidth="3" />
          <circle cx="16" cy="16" r="5" fill="var(--accent)" />
        </svg>
        <div className="leading-tight">
          <h1 className="text-[15px] font-semibold tracking-tight">LatAm Startup Map</h1>
          <p className="text-xs text-muted tabular-nums">
            {companies.length} startups · {hiring} hiring · {jobs.length.toLocaleString()} jobs · {cities} cities
            <span className="hidden sm:inline"> · updated {data.generatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          </p>
        </div>
      </div>

      <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto" aria-label="Views">
        {NAV.map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => set({ view: v })}
            aria-current={view === v ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${view === v ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {view === "map" && <button className="btn lg:hidden" onClick={onList} aria-label="Companies and jobs in view"><List size={15} /></button>}
        <button className="btn min-w-0 whitespace-nowrap text-muted sm:w-60" onClick={() => set({ palette: true })}>
          <Search size={15} /> <span className="hidden flex-1 text-left sm:inline">Search roles, companies…</span>
          <kbd className="hidden rounded border border-line px-1 text-[10px] sm:inline">⌘K</kbd>
        </button>
        <button className="btn" onClick={() => set({ theme: theme === "dark" ? "light" : "dark" })} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
