import { AlertTriangle, ExternalLink, Link2, MapPin, Rss, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useColors } from "../lib/colors";
import { FAMILIES } from "../lib/enrich";
import { facts } from "../lib/format";
import { countBy } from "../lib/filter";
import { COUNTRY_FLAGS } from "../lib/geo";
import { useStore } from "../lib/store";
import type { Company, Job } from "../lib/types";
import { Logo } from "./Logo";

const SRC: Record<string, string> = { "web-search": "found by web search", website: "company website", "job-feed": "job posting", "osm-match": "OpenStreetMap", openstreetmap: "OpenStreetMap", registry: "company registry (CNPJ)", "website-map": "map on company website", manual: "added by hand" };

const mix = (c: Company) => FAMILIES.map((f) => c.jobs.filter((j) => j.family === f).length);
const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const n = Math.hypot(...a) * Math.hypot(...b);
  return n ? dot / n : 0;
};

export function CompanyDrawer() {
  const id = useStore((s) => s.drawer);
  const ds = useStore((s) => s.data)!;
  const set = useStore((s) => s.set);
  const c = id ? ds.byId.get(id) : undefined;

  useEffect(() => {
    if (!c) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ drawer: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c, set]);

  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${c ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => set({ drawer: null })} />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-300 ${c ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!c}
      >
        {c && <Body c={c} />}
      </aside>
    </>
  );
}

function Body({ c }: { c: Company }) {
  const ds = useStore((s) => s.data)!;
  const set = useStore((s) => s.set);
  const famColor = useColors("family");
  const [fam, setFam] = useState<string | null>(null);
  useEffect(() => setFam(null), [c]);

  const fams = countBy(c.jobs, (j) => j.family);
  const where = [...countBy(c.jobs, (j) => j.countries)].sort((a, b) => b[1] - a[1]);
  const remote = c.jobs.filter((j) => j.mode === "Remote").length;
  const similar = useMemo(() => {
    const m = mix(c);
    return ds.companies
      .filter((o) => o !== c && o.sector === c.sector)
      .map((o) => ({ o, s: cosine(m, mix(o)) + (o.hq.country === c.hq.country ? 0.15 : 0) + (o.stage === c.stage ? 0.1 : 0) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
  }, [c, ds]);
  const jobs = [...c.jobs].filter((j) => !fam || j.family === fam).sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""));

  return (
    <>
      <div className="flex items-start gap-3 border-b border-line p-4">
        <Logo c={c} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">{c.name}</h2>
          <p className="text-sm text-muted">
            {c.sector} · {c.stage} · {COUNTRY_FLAGS[c.country]} {c.hq.name}
          </p>
          {c.website && (
            <a href={`https://${c.website}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              {c.website} <ExternalLink size={12} />
            </a>
          )}
        </div>
        <button onClick={() => set({ drawer: null })} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X size={18} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Open jobs" value={c.tracked ? `${c.jobs.length}${c.truncated ? "+" : ""}` : "—"} />
          <Stat label="Remote" value={c.jobs.length ? `${Math.round((remote / c.jobs.length) * 100)}%` : "—"} />
          <Stat label="Newest post" value={c.newest ? new Date(c.newest).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} />
        </div>

        {c.info && (
          <section className="text-sm">
            {c.info.description && <p className="leading-relaxed text-ink/90">{c.info.description}</p>}
            {c.info.founders?.length ? <p className="mt-1.5 text-xs text-muted">Founded by {c.info.founders.join(", ")}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.info.founded && <span className="chip">Founded {c.info.founded}</span>}
              {c.info.employees && <span className="chip">{c.info.employees} employees</span>}
              {c.info.linkedin && <a className="chip hover:text-accent" href={c.info.linkedin} target="_blank" rel="noopener"><Link2 size={11} /> LinkedIn</a>}
              {c.info.twitter && <a className="chip hover:text-accent" href={c.info.twitter} target="_blank" rel="noopener"><Link2 size={11} /> X</a>}
              {c.info.wikidata && <a className="chip hover:text-accent" href={c.info.wikidata} target="_blank" rel="noopener"><Link2 size={11} /> Wikidata</a>}
            </div>
          </section>
        )}

        <section className="card p-3 text-sm">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted"><MapPin size={13} /> Offices</h3>
          <ul className="space-y-1.5">
            {c.offices.map((o) => (
              <li key={o.place.id} className="flex gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${o.precise ? "bg-accent" : "border border-muted"}`} />
                <span className="min-w-0">
                  <span className="font-medium">{o.place.name}</span>{o.hq && <span className="text-muted"> · HQ</span>}{o.jobs > 0 && <span className="text-muted"> · {o.jobs} jobs</span>}
                  <span className="block text-xs text-muted">
                    {o.precise ? o.address ?? o.label : o.hq ? "Street address not found yet" : "From job locations, address unknown"}
                    {o.source && <> · {o.sourceUrl ? <a className="text-accent hover:underline" href={o.sourceUrl} target="_blank" rel="noopener">{SRC[o.source] ?? o.source}</a> : SRC[o.source] ?? o.source}</>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-3 text-sm">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted"><Rss size={13} /> Data source</h3>
          {c.tracked ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">ATS</dt><dd className="font-medium capitalize">{c.ats}</dd>
              <dt className="text-muted">Careers page</dt><dd className="truncate"><a className="text-accent hover:underline" href={c.careers_url!} target="_blank" rel="noopener">{c.careers_url}</a></dd>
              {c.feed_url && (<><dt className="text-muted">Raw feed</dt><dd className="truncate"><a className="font-mono text-xs text-accent hover:underline" href={c.feed_url} target="_blank" rel="noopener">{c.feed_url}</a></dd></>)}
            </dl>
          ) : c.feed_error ? (
            <p className="flex gap-2 text-amber-500"><AlertTriangle size={16} className="shrink-0" /> The {c.ats_configured} feed failed on the last refresh: <span className="font-mono text-xs">{c.feed_error}</span></p>
          ) : (
            <p className="text-muted">Not tracked yet: this company doesn't use a supported public ATS feed. Check their site for openings.</p>
          )}
        </section>

        {c.jobs.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Role mix</h3>
            <div className="flex h-3 overflow-hidden rounded-full">
              {FAMILIES.filter((f) => fams.get(f)).map((f) => (
                <button key={f} title={`${f}: ${fams.get(f)}`} onClick={() => setFam(fam === f ? null : f)} style={{ flex: fams.get(f), background: famColor(f), opacity: !fam || fam === f ? 1 : 0.25 }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FAMILIES.filter((f) => fams.get(f)).map((f) => (
                <button key={f} onClick={() => setFam(fam === f ? null : f)} className={`chip ${fam === f ? "border-accent text-ink" : ""}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: famColor(f) }} /> {f} <b className="text-ink">{fams.get(f)}</b>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {where.map(([k, n]) => <span key={k} className="chip">{COUNTRY_FLAGS[k] ?? "📍"} {k} <b className="text-ink">{n}</b></span>)}
            </div>
          </section>
        )}

        {c.jobs.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Jobs {fam && <span className="normal-case">· {fam}</span>}</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {jobs.map((j) => <JobLine key={j.id} j={j} />)}
            </ul>
          </section>
        )}

        {similar.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Similar companies</h3>
            <div className="grid grid-cols-2 gap-2">
              {similar.map(({ o }) => (
                <button key={o.id} onClick={() => set({ drawer: o.id })} className="card flex items-center gap-2 p-2 text-left hover:border-accent/60">
                  <Logo c={o} size={26} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{o.name}</span>
                    <span className="block truncate text-xs text-muted">{o.hq.name} · {o.jobs.length} jobs</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export function JobLine({ j }: { j: Job }) {
  const saved = useStore((s) => s.saved.includes(j.url));
  const toggleSaved = useStore((s) => s.toggleSaved);
  const famColor = useColors("family");
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: famColor(j.family) }} title={j.family} />
      <div className="min-w-0 flex-1">
        <a href={j.url} target="_blank" rel="noopener" className="text-sm font-medium hover:text-accent">{j.title}</a>
        <div className="text-xs text-muted">
          {[j.seniority, j.location || j.company.hq.name, j.mode, j.posted].filter(Boolean).join(" · ")}
        </div>
        {j.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted/90">{j.snippet}</p>}
        {(facts(j).length > 0 || (j.skills?.length ?? 0) > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {facts(j).map((f) => <span key={f.k} className={`chip ${f.k === "pay" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : ""}`}>{f.v}</span>)}
            {j.skills?.slice(0, 6).map((s) => <span key={s} className="chip">{s}</span>)}
            {(j.benefits?.length ?? 0) > 0 && <span className="chip" title={j.benefits!.join(", ")}>+{j.benefits!.length} benefits</span>}
          </div>
        )}
      </div>
      <button onClick={() => toggleSaved(j.url)} className={saved ? "text-amber-400" : "text-muted hover:text-amber-400"} aria-label={saved ? "Unsave job" : "Save job"}>
        <Star size={15} fill={saved ? "currentColor" : "none"} />
      </button>
    </li>
  );
}
