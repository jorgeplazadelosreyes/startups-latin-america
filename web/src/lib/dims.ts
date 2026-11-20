import { AGES, FAMILIES, LANGS, MODES, SENIORITIES, STAGES } from "./enrich";
import type { Company, Job } from "./types";

/**
 * Every way of slicing the data, in one registry. Facets, the pivot heatmap, the Sankey, trend stacks and
 * cross-filter clicks all go through it, so a new dimension only needs adding here.
 */
export type DimKey =
  | "source" | "listed" | "sector" | "stage" | "country" | "city"
  | "family" | "seniority" | "mode" | "lang" | "hiringIn" | "age"
  | "skill" | "english" | "employment" | "pay";

export type Dim = {
  key: DimKey;
  label: string;
  level: "company" | "job";
  /** Values of a job along this dimension (company dims read the job's company). */
  ofJob: (j: Job) => string[];
  ofCompany?: (c: Company) => string[];
  order?: string[];
  hint?: string;
};

const LISTED: Record<string, string> = { yc: "Y Combinator", startupblink: "StartupBlink" };
const co = (f: (c: Company) => string) => ({ ofCompany: (c: Company) => [f(c)], ofJob: (j: Job) => [f(j.company)] });

export const DIMS: Record<DimKey, Dim> = {
  source: { key: "source", label: "Source", level: "company", hint: "ATS feed the jobs come from", ...co((c) => c.source) },
  listed: { key: "listed", label: "Listed by", level: "company", order: ["Curated", "Y Combinator", "StartupBlink"], hint: "Where the company entry came from", ...co((c) => LISTED[c.listed_by ?? ""] ?? "Curated") },
  sector: { key: "sector", label: "Sector", level: "company", ...co((c) => c.sector) },
  stage: { key: "stage", label: "Stage", level: "company", order: STAGES, ...co((c) => c.stage) },
  country: { key: "country", label: "HQ country", level: "company", ...co((c) => c.country) },
  city: { key: "city", label: "HQ city", level: "company", ...co((c) => c.hq.name) },
  family: { key: "family", label: "Role", level: "job", order: FAMILIES, ofJob: (j) => [j.family] },
  seniority: { key: "seniority", label: "Seniority", level: "job", order: SENIORITIES, ofJob: (j) => [j.seniority] },
  mode: { key: "mode", label: "Work mode", level: "job", order: MODES, ofJob: (j) => [j.mode] },
  lang: { key: "lang", label: "Posting language", level: "job", order: LANGS, ofJob: (j) => [j.lang] },
  hiringIn: { key: "hiringIn", label: "Hiring in", level: "job", hint: "Country in the job's location", ofJob: (j) => j.countries },
  age: { key: "age", label: "Posted", level: "job", order: AGES, ofJob: (j) => [j.age] },
  skill: { key: "skill", label: "Skill", level: "job", hint: "Named in the job description", ofJob: (j) => j.skills?.length ? j.skills : ["None named"] },
  english: { key: "english", label: "English", level: "job", order: ["Fluent", "Advanced", "Intermediate", "Required", "Not stated"], hint: "English level the posting asks for", ofJob: (j) => [j.english ?? "Not stated"] },
  employment: { key: "employment", label: "Contract", level: "job", hint: "Employment type from the ATS feed", ofJob: (j) => [j.employment ?? "Not stated"] },
  pay: { key: "pay", label: "Pay shown", level: "job", order: ["Shows pay", "No pay info"], ofJob: (j) => [j.salary ? "Shows pay" : "No pay info"] },
};

export const DIM_KEYS = Object.keys(DIMS) as DimKey[];
export const COMPANY_DIMS = DIM_KEYS.filter((k) => DIMS[k].level === "company");
export const JOB_DIMS = DIM_KEYS.filter((k) => DIMS[k].level === "job");

/** Sort values by the dimension's natural order, else by count. */
export function sortValues(dim: DimKey, counts: Map<string, number>) {
  const order = DIMS[dim].order;
  const vals = [...counts.keys()];
  if (order) return vals.sort((a, b) => idx(order, a) - idx(order, b));
  return vals.sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
}
const idx = (o: string[], v: string) => (o.includes(v) ? o.indexOf(v) : 999);
