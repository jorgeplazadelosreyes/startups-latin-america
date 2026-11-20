import { knownPlace, norm, resolveLocation } from "./geo";
import type { Company, Dataset, Job, Office, Pin, Place, RawData } from "./types";

/* Title classifiers. Titles come in English, Portuguese and Spanish, so each rule covers all three.
   Order matters: the first matching rule wins ("Data Engineer" is Data, not Engineering). */

const FAMILY_RULES: [string, RegExp][] = [
  ["Data & AI", /\bdata\b|dados|datos|analytics|machine learning|\bml\b|\bai\b|\bia\b|\bllm|scientist|cientista|cientifico|business intelligence|\bbi\b|analytic/],
  ["Design", /design|\bux\b|\bui\b|disenador|researcher/],
  ["Product", /product|produto|producto|\bpm\b|\bpo\b/],
  ["Engineering", /engineer|engenheir|ingenier|developer|desenvolvedor|desarrollador|devops|\bsre\b|software|backend|back-end|front ?-?end|full ?-?stack|mobile|\bios\b|android|\bqa\b|tester|quality assurance|architect|arquitet|tech lead|programador|infra|platform|security|seguranca|seguridad|cloud|\bdev\b|tecnologia|\bdba\b|\berp\b|netsuite/],
  ["Sales", /sales|vendas|ventas|vendedor|account executive|account manager|\bsdr\b|\bbdr\b|business development|comercial|executivo de contas|ejecutivo|key account|partnership|parcerias|alianzas|closer|commercial/],
  ["Marketing", /marketing|growth|brand|marca|content|conteudo|contenido|\bseo\b|comunicac|\bpr\b|social media|\bcrm\b|copywriter|paid media|creative|communications/],
  ["Customer", /customer|cliente|support|suporte|soporte|success|atendimento|atencion|\bcx\b|experience|onboarding/],
  ["Finance & Risk", /financ|accounting|contab|contador|\btax\b|fiscal|treasury|tesour|tesoreria|risk|risco|riesgo|credit|credito|fraud|fraude|audit|controller|fp&a|compliance|\baml\b|\bpld\b|collections|cobranc|cobranza|payments|pagos|pagamentos|controlad|pricing|revenue|planning|planejamento|performance|portfolio|corporate development|governance|reporting|\bsox\b|\balm\b|regulat|regulac|sinistro|seguro/],
  ["Legal", /legal|lawyer|advogad|abogad|juridic|counsel/],
  ["People", /people|talent|recruit|recrutador|reclutador|\brh\b|\bhr\b|human|gente|pessoas|personas|culture|cultura|payroll|nomina|departamento pessoal|benefic|hrops/],
  ["Operations", /operation|operac|\bops\b|logistic|supply|fulfillment|warehouse|bodega|armazem|driver|motorista|repartidor|field|procurement|compras|facilities|frota|lojas|store/],
  ["Strategy & BizOps", /strategy|estrategi|bizops|business operations|business analyst|analista de negocio|project manager|program manager|\bpmo\b|chief of staff|consultant|consultor/],
];

const SENIORITY_RULES: [string, RegExp][] = [
  ["Intern", /intern\b|internship|estagi|pasant|practicante|trainee|aprendiz|becari/],
  ["Director+", /director|diretor|\bvp\b|vice ?president|chief|head of|\bc[etfopm]o\b|country manager|general manager|managing director/],
  ["Lead / Manager", /\blead\b|\blider\b|leader|manager|gerente|coordinat|coordenador|coordinador|supervisor|\bhead\b|jefe|chefe/],
  ["Staff+", /staff|principal|distinguished|fellow/],
  ["Senior", /senior|\bsr\b|\bsr\.|\biii\b|especialista|specialist/],
  ["Junior", /junior|\bjr\b|\bjr\.|entry|assistente|asistente|auxiliar|\bi\b$/],
];

export const FAMILIES = [...FAMILY_RULES.map(([f]) => f), "Other"];
export const SENIORITIES = ["Intern", "Junior", "Mid", "Senior", "Staff+", "Lead / Manager", "Director+"];
export const MODES = ["Remote", "Hybrid", "On-site"];
export const LANGS = ["English", "Portuguese", "Spanish"];
export const STAGES = ["Early", "Growth", "Late", "Public", "Unknown"];
export const AGES = ["≤ 7 days", "8–30 days", "31–90 days", "> 90 days", "Undated"];

const classify = (rules: [string, RegExp][], t: string, fallback: string) => rules.find(([, re]) => re.test(t))?.[0] ?? fallback;

const PT = /[ãõç]|\b(de dados|pessoa|vaga|desenvolvedor|engenheir|estagi|pleno|analista de|atendimento|gerente de contas|coordenador|especialista em)\b|ção\b/;
const ES = /ñ|\b(ingenier|desarrollador|ejecutivo|jefe|lider|practicante|analista de|gerente de|especialista en|coordinador|senior de)|ción\b/;
const EN = /\b(engineer|manager|senior|analyst|lead|developer|specialist|head|associate|director|intern|of|and|the)\b/i;

function language(title: string, country: string) {
  const t = title.toLowerCase();
  if (PT.test(t) && !/ción\b/.test(t)) return "Portuguese";
  if (ES.test(t)) return "Spanish";
  if (EN.test(t)) return "English";
  return country === "Brazil" ? "Portuguese" : "Spanish";
}

function workMode(remote: boolean, location: string, title: string) {
  if (/hybrid|hibrid/i.test(norm(location + " " + title))) return "Hybrid";
  if (remote) return "Remote";
  return "On-site";
}

function ageBucket(days: number | null) {
  if (days == null) return AGES[4];
  if (days <= 7) return AGES[0];
  if (days <= 30) return AGES[1];
  if (days <= 90) return AGES[2];
  return AGES[3];
}

const DAY = 86_400_000;

/** HQ and extra offices street-pinned by data/offices.json, plus other cities with 2+ city-level jobs
 * (approximate: somewhere in that city). A street pin replaces the job-derived guess for its city. */
function offices(c: Company, cities: Record<string, Place>): Office[] {
  const perCity = new Map<string, { place: Place; n: number }>();
  for (const j of c.jobs)
    if (j.precision === "city")
      for (const p of j.places) {
        const e = perCity.get(p.id) ?? { place: p, n: 0 };
        e.n++;
        perCity.set(p.id, e);
      }
  const pinned = (place: Place, hq: boolean, pin: Pin): Office => ({
    place, hq, precise: true, lat: pin.lat, lng: pin.lng, label: pin.address ?? pin.label,
    jobs: perCity.get(place.id)?.n ?? 0, source: pin.source, sourceUrl: pin.source_url, address: pin.address,
  });
  const hqPin = c.office?.hq;
  const out: Office[] = [hqPin ? pinned(c.hq, true, hqPin) : {
    place: c.hq, hq: true, precise: false, lat: c.hq.lat, lng: c.hq.lng,
    label: `${c.hq.name} (exact address unknown)`, jobs: perCity.get(c.hq.id)?.n ?? 0,
  }];
  const done = new Set([c.hq.id]);
  for (const pin of c.office?.extra ?? []) {
    const place = pin.city ? cities[pin.city] : undefined;
    if (place && !done.has(place.id)) {
      out.push(pinned(place, false, pin));
      done.add(place.id);
    }
  }
  for (const { place, n } of perCity.values())
    if (!done.has(place.id) && n >= 2)
      out.push({ place, hq: false, precise: false, lat: place.lat, lng: place.lng, label: `${place.name} (from job locations)`, jobs: n });
  return out;
}

export function enrich(raw: RawData): Dataset {
  const generatedAt = new Date(raw.generated_at);
  const cities: Record<string, Place> = {};
  for (const [id, c] of Object.entries(raw.cities)) cities[id] = { id, ...c };

  const companies: Company[] = [];
  const jobs: Job[] = [];
  for (const rc of raw.companies) {
    const hq = cities[rc.city] ?? knownPlace(rc.city)!;
    const company: Company = {
      ...rc,
      jobs: [],
      offices: [],
      hq,
      country: hq.country,
      source: rc.ats ?? (rc.ats_configured ? `${rc.ats_configured} (failing)` : "untracked"),
      text: norm([rc.name, rc.sector, rc.website, hq.name, hq.country].join(" ")),
      newest: null,
    };
    rc.jobs.forEach((rj, i) => {
      const t = norm(rj.title);
      const resolved = rj.location ? resolveLocation(rj.location) : { places: [], precision: "hq" as const };
      const places = resolved.places.length ? resolved.places : [hq];
      const ageDays = rj.posted ? Math.max(0, Math.round((+generatedAt - +new Date(rj.posted)) / DAY)) : null;
      const job: Job = {
        ...rj,
        id: `${rc.id}:${i}`,
        company,
        family: classify(FAMILY_RULES, t, "Other"),
        seniority: classify(SENIORITY_RULES, t, "Mid"),
        mode: workMode(rj.remote, rj.location, rj.title),
        lang: language(rj.title, hq.country),
        places,
        precision: resolved.precision,
        countries: [...new Set(resolved.places.length ? resolved.places.map((p) => p.country) : resolved.precision === "remote" ? ["Remote"] : [hq.country])],
        ageDays,
        age: ageBucket(ageDays),
        text: norm([rj.title, rj.location, rj.department, ...(rj.skills ?? [])].join(" ")),
      };
      company.jobs.push(job);
      jobs.push(job);
    });
    company.offices = offices(company, cities);
    company.newest = company.jobs.reduce<string | null>((m, j) => (j.posted && (!m || j.posted > m) ? j.posted : m), null);
    companies.push(company);
  }

  return {
    generatedAt,
    companies,
    jobs,
    cities,
    discovery: raw.discovery ?? [],
    byId: new Map(companies.map((c) => [c.id, c])),
  };
}
