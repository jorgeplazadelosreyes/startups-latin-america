import { Link2, X } from "lucide-react";
import { useState } from "react";
import { DIM_KEYS, DIMS } from "../lib/dims";
import { useStore } from "../lib/store";

export function ActiveFilters() {
  const f = useStore((s) => s.f);
  const q = useStore((s) => s.q);
  const hiringOnly = useStore((s) => s.hiringOnly);
  const toggle = useStore((s) => s.toggle);
  const set = useStore((s) => s.set);
  const clear = useStore((s) => s.clear);
  const [copied, setCopied] = useState(false);

  const chips = DIM_KEYS.flatMap((k) => f[k].map((v) => ({ k, v })));
  if (!chips.length && !q && !hiringOnly) return null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface/60 px-4 py-2 text-xs">
      {q && <Chip label={`“${q}”`} onRemove={() => set({ q: "" })} />}
      {hiringOnly && <Chip label="Hiring now" onRemove={() => set({ hiringOnly: false })} />}
      {chips.map(({ k, v }) => <Chip key={k + v} label={<><span className="text-muted">{DIMS[k].label}:</span> {v}</>} onRemove={() => toggle(k, v)} />)}
      <button className="ml-1 text-muted hover:text-accent" onClick={() => clear()}>Clear all</button>
      <button className="ml-auto flex items-center gap-1 text-muted hover:text-accent" onClick={copy}>
        <Link2 size={13} /> {copied ? "Link copied" : "Copy link to this view"}
      </button>
    </div>
  );
}

function Chip({ label, onRemove }: { label: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 py-0.5 pl-2.5 pr-1 text-ink">
      {label}
      <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-accent/20" aria-label="Remove filter"><X size={12} /></button>
    </span>
  );
}
