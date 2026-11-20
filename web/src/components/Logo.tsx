import { useState } from "react";
import { colorMap } from "../lib/colors";
import { useStore } from "../lib/store";
import type { Company } from "../lib/types";

/** Company favicon, falling back to a sector-colored monogram. */
export function Logo({ c, size = 32 }: { c: Company; size?: number }) {
  const ds = useStore((s) => s.data)!;
  const [failed, setFailed] = useState(false);
  const color = colorMap(ds, "sector").get(c.sector) ?? "#64748b";
  const style = { width: size, height: size };
  if (!c.website || failed)
    return (
      <span className="grid shrink-0 place-items-center rounded-lg font-semibold text-[#0b1120]" style={{ ...style, background: color, fontSize: size * 0.42 }}>
        {c.name[0]}
      </span>
    );
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.website)}&sz=64`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-lg bg-white p-0.5"
      style={style}
    />
  );
}
