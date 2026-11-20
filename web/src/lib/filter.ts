import { useMemo } from "react";
import { COMPANY_DIMS, DIMS, JOB_DIMS, type DimKey } from "./dims";
import { norm } from "./geo";
import { useStore, type Filters } from "./store";
import type { Company, Dataset, Job } from "./types";

type Query = { f: Filters; q: string; hiringOnly: boolean };

const hit = (vals: string[], sel: string[]) => !sel.length || vals.some((v) => sel.includes(v));

/**
 * Company dims (source, sector, …) filter companies and their jobs. Job dims (role, seniority, …) filter jobs;
 * when any is active, only companies with a matching job remain. Search matches company or job text.
 * `except` leaves one dimension out, which gives facet counts that ignore their own selection.
 */
export function compute(ds: Dataset, { f, q, hiringOnly }: Query, except?: DimKey) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  const cdims = COMPANY_DIMS.filter((k) => k !== except && f[k].length);
  const jdims = JOB_DIMS.filter((k) => k !== except && f[k].length);

  const companyOk = (c: Company) => cdims.every((k) => hit(DIMS[k].ofCompany!(c), f[k]));
  const jobOk = (j: Job) =>
    jdims.every((k) => hit(DIMS[k].ofJob(j), f[k])) && tokens.every((t) => j.text.includes(t) || j.company.text.includes(t));

  const passCo = new Set(ds.companies.filter(companyOk));
  const jobs = ds.jobs.filter((j) => passCo.has(j.company) && jobOk(j));
  const withJobs = new Set(jobs.map((j) => j.company));
  const jobScoped = jdims.length > 0 || hiringOnly;
  const companies = [...passCo].filter((c) =>
    jobScoped ? withJobs.has(c) : !tokens.length || withJobs.has(c) || tokens.every((t) => c.text.includes(t)),
  );
  return { jobs, companies };
}

export function useQuery(): Query {
  const f = useStore((s) => s.f);
  const q = useStore((s) => s.q);
  const hiringOnly = useStore((s) => s.hiringOnly);
  return useMemo(() => ({ f, q, hiringOnly }), [f, q, hiringOnly]);
}

export function useFiltered() {
  const ds = useStore((s) => s.data)!;
  const query = useQuery();
  return useMemo(() => compute(ds, query), [ds, query]);
}

/** Counts per value for one dimension, ignoring that dimension's own selection. */
export function useFacet(dim: DimKey) {
  const ds = useStore((s) => s.data)!;
  const query = useQuery();
  return useMemo(() => {
    const { jobs, companies } = compute(ds, query, dim);
    const d = DIMS[dim];
    const counts = new Map<string, number>();
    if (d.level === "company") for (const c of companies) for (const v of d.ofCompany!(c)) counts.set(v, (counts.get(v) ?? 0) + 1);
    else for (const j of jobs) for (const v of d.ofJob(j)) counts.set(v, (counts.get(v) ?? 0) + 1);
    // Keep selected values visible even when the other filters zero them out.
    for (const v of query.f[dim]) if (!counts.has(v)) counts.set(v, 0);
    return counts;
  }, [ds, query, dim]);
}

export function countBy<T>(items: T[], key: (t: T) => string[] | string) {
  const m = new Map<string, number>();
  for (const it of items) for (const k of ([] as string[]).concat(key(it))) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}
