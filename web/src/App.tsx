import { lazy, Suspense, useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { CompanyDrawer } from "./components/CompanyDrawer";
import { ActiveFilters } from "./components/ActiveFilters";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { useStore } from "./lib/store";

const views = {
  map: lazy(() => import("./views/MapView")),
  jobs: lazy(() => import("./views/JobsView")),
  companies: lazy(() => import("./views/CompaniesView")),
  sources: lazy(() => import("./views/SourcesView")),
  explore: lazy(() => import("./views/ExploreView")),
  trends: lazy(() => import("./views/TrendsView")),
};

export default function App() {
  const data = useStore((s) => s.data);
  const error = useStore((s) => s.error);
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("theme", theme); } catch { /* storage unavailable */ }
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStore.setState((s) => ({ palette: !s.palette }));
      }
      if (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea")) {
        e.preventDefault();
        useStore.setState({ palette: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) return <div className="grid h-full place-items-center p-6 text-center text-muted">Couldn't load the data ({error}).<br />Run <code className="text-ink">npm run data</code> to build it.</div>;
  if (!data) return <div className="grid h-full place-items-center text-muted"><span className="animate-pulse">Loading startups…</span></div>;

  const V = views[view];
  return (
    <div className="flex h-full flex-col">
      <Header onList={() => setFiltersOpen((o) => !o)} />
      <div className="flex min-h-0 flex-1">
        {view === "map" && <Sidebar open={filtersOpen} onClose={() => setFiltersOpen(false)} />}
        <main className="flex min-w-0 flex-1 flex-col">
          <ActiveFilters />
          <div className="relative min-h-0 flex-1">
            <Suspense fallback={<div className="grid h-full place-items-center text-muted">Loading view…</div>}>
              <V />
            </Suspense>
          </div>
        </main>
      </div>
      <CompanyDrawer />
      <CommandPalette />
    </div>
  );
}
