export type RawJob = {
  title: string;
  url: string;
  location: string;
  department: string;
  remote: boolean;
  posted: string | null;
  /** Facts extracted from the posting text by scripts/extract.py (absent when the text doesn't say). */
  skills?: string[];
  salary?: { min: number; max: number; currency: string | null; period: "month" | "year" | null };
  english?: string;
  years?: number;
  benefits?: string[];
  employment?: string;
  snippet?: string;
};

/** A street-level pin from scripts/offices.py. */
export type Pin = {
  lat: number; lng: number; label: string; address?: string;
  source: string; source_url?: string; city?: string;
};

export type RawCompany = {
  id: string;
  name: string;
  website: string | null;
  city: string;
  sector: string;
  stage: string;
  tracked: boolean;
  truncated: boolean;
  /** Where the company entry came from: hand-curated, Y Combinator directory, StartupBlink listing. */
  listed_by?: "curated" | "yc" | "startupblink";
  listed_url?: string | null;
  ats: string | null;
  ats_configured?: string | null;
  feed_error?: string | null;
  careers_url: string | null;
  feed_url?: string | null;
  office?: { hq: Pin | null; extra: Pin[] } | null;
  info?: {
    description?: string; linkedin?: string; founded?: number; employees?: number | string;
    twitter?: string; founders?: string[]; logo?: string; wikidata?: string;
  } | null;
  jobs: RawJob[];
};

export type RawCity = { name: string; country: string; lat: number; lng: number };

export type Probe = { name: string; ats: string; slug: string; jobs: number; latam_share: number | null };

export type RawData = {
  generated_at: string;
  cities: Record<string, RawCity>;
  companies: RawCompany[];
  discovery?: Probe[];
};

export type Place = { id: string; name: string; country: string; lat: number; lng: number };

/** How precisely a job's location string was resolved to a point. */
export type Precision = "city" | "country" | "remote" | "hq";

export type Job = RawJob & {
  id: string;
  company: Company;
  family: string;
  seniority: string;
  mode: string;
  lang: string;
  places: Place[];
  precision: Precision;
  countries: string[];
  ageDays: number | null;
  age: string;
  text: string;
};

/** A place a company works from: its HQ, or a city where it lists several jobs. */
export type Office = {
  place: Place;
  lat: number;
  lng: number;
  hq: boolean;
  /** True when pinned to a street location; false = somewhere in this city. */
  precise: boolean;
  label: string;
  jobs: number;
  /** Where the street address came from (web-search, website, job-feed, manual…). */
  source?: string;
  sourceUrl?: string;
  address?: string;
};

export type Company = Omit<RawCompany, "jobs"> & {
  jobs: Job[];
  offices: Office[];
  hq: Place;
  country: string;
  source: string;
  text: string;
  newest: string | null;
};

export type Dataset = {
  generatedAt: Date;
  companies: Company[];
  jobs: Job[];
  cities: Record<string, Place>;
  discovery: Probe[];
  byId: Map<string, Company>;
};
