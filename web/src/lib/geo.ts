import type { Place } from "./types";

export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

type Entry = Place & { re: RegExp };

const c = (id: string, name: string, country: string, lat: number, lng: number, re: RegExp): Entry => ({ id, name, country, lat, lng, re });

/** Cities that show up in job location strings (matched against accent-stripped lowercase text). */
const CITIES: Entry[] = [
  c("sao-paulo", "São Paulo", "Brazil", -23.5505, -46.6333, /sao paulo|\bosasco\b|\bbarueri\b|\/ sp \//),
  c("rio-de-janeiro", "Rio de Janeiro", "Brazil", -22.9068, -43.1729, /rio de janeiro/),
  c("belo-horizonte", "Belo Horizonte", "Brazil", -19.9167, -43.9345, /belo horizonte/),
  c("curitiba", "Curitiba", "Brazil", -25.4284, -49.2733, /curitiba/),
  c("florianopolis", "Florianópolis", "Brazil", -27.5954, -48.548, /florianopolis/),
  c("joinville", "Joinville", "Brazil", -26.3045, -48.8487, /joinville/),
  c("campinas", "Campinas", "Brazil", -22.9099, -47.0626, /campinas/),
  c("porto-alegre", "Porto Alegre", "Brazil", -30.0346, -51.2177, /porto alegre/),
  c("recife", "Recife", "Brazil", -8.0476, -34.877, /recife/),
  c("brasilia", "Brasília", "Brazil", -15.7975, -47.8919, /brasilia/),
  c("mexico-city", "Mexico City", "Mexico", 19.4326, -99.1332, /mexico city|ciudad de mexico|\bcdmx\b|mexico, d\.?f/),
  c("guadalajara", "Guadalajara", "Mexico", 20.6597, -103.3496, /guadalajara|zapopan/),
  c("monterrey", "Monterrey", "Mexico", 25.6866, -100.3161, /monterrey|san pedro garza/),
  c("queretaro", "Querétaro", "Mexico", 20.5888, -100.3899, /queretaro/),
  c("bogota", "Bogotá", "Colombia", 4.711, -74.0721, /bogota/),
  c("medellin", "Medellín", "Colombia", 6.2442, -75.5812, /medellin/),
  c("cali", "Cali", "Colombia", 3.4516, -76.532, /\bcali\b/),
  c("barranquilla", "Barranquilla", "Colombia", 10.9685, -74.7813, /barranquilla/),
  c("buenaventura", "Buenaventura", "Colombia", 3.8801, -77.0312, /buenaventura/),
  c("buenos-aires", "Buenos Aires", "Argentina", -34.6037, -58.3816, /buenos aires|\bcaba\b/),
  c("cordoba", "Córdoba", "Argentina", -31.4201, -64.1888, /cordoba/),
  c("rosario", "Rosario", "Argentina", -32.9442, -60.6505, /rosario/),
  c("mendoza", "Mendoza", "Argentina", -32.8895, -68.8458, /mendoza/),
  c("santiago", "Santiago", "Chile", -33.4489, -70.6693, /santiago|las condes|providencia|vitacura/),
  c("montevideo", "Montevideo", "Uruguay", -34.9011, -56.1645, /montevideo/),
  c("lima", "Lima", "Peru", -12.0464, -77.0428, /\blima\b|miraflores|san isidro/),
  c("quito", "Quito", "Ecuador", -0.1807, -78.4678, /quito/),
  c("guayaquil", "Guayaquil", "Ecuador", -2.1709, -79.9224, /guayaquil/),
  c("san-salvador", "San Salvador", "El Salvador", 13.6929, -89.2182, /san salvador/),
  c("san-jose", "San José", "Costa Rica", 9.9281, -84.0907, /san jose(?! dos)/),
  c("panama-city", "Panama City", "Panama", 8.9824, -79.5199, /panama city|ciudad de panama/),
  c("guatemala-city", "Guatemala City", "Guatemala", 14.6349, -90.5069, /guatemala city|ciudad de guatemala/),
  c("asuncion", "Asunción", "Paraguay", -25.2637, -57.5759, /asuncion/),
  c("santo-domingo", "Santo Domingo", "Dominican Republic", 18.4861, -69.9312, /santo domingo/),
  c("la-paz", "La Paz", "Bolivia", -16.4897, -68.1193, /\bla paz\b|el alto/),
  c("santa-cruz-de-la-sierra", "Santa Cruz de la Sierra", "Bolivia", -17.7833, -63.1821, /santa cruz de la sierra|santa cruz, bolivia/),
  c("cochabamba", "Cochabamba", "Bolivia", -17.3895, -66.1568, /cochabamba/),
  c("caracas", "Caracas", "Venezuela", 10.4806, -66.9036, /caracas/),
  c("tegucigalpa", "Tegucigalpa", "Honduras", 14.0723, -87.1921, /tegucigalpa/),
  c("managua", "Managua", "Nicaragua", 12.1364, -86.2514, /managua/),
];

/** Country names → main hub, used when a job only names the country. */
const COUNTRIES: { country: string; re: RegExp; hub: string; lat?: number; lng?: number }[] = [
  { country: "Brazil", re: /brazil|brasil/, hub: "sao-paulo" },
  { country: "Mexico", re: /mexico/, hub: "mexico-city" },
  { country: "Colombia", re: /colombia/, hub: "bogota" },
  { country: "Argentina", re: /argentina/, hub: "buenos-aires" },
  { country: "Chile", re: /chile/, hub: "santiago" },
  { country: "Uruguay", re: /uruguay/, hub: "montevideo" },
  { country: "Peru", re: /peru\b/, hub: "lima" },
  { country: "Ecuador", re: /ecuador/, hub: "quito" },
  { country: "El Salvador", re: /el salvador/, hub: "san-salvador" },
  { country: "Costa Rica", re: /costa rica/, hub: "san-jose" },
  { country: "Panama", re: /panama/, hub: "panama-city" },
  { country: "Guatemala", re: /guatemala/, hub: "guatemala-city" },
  { country: "Paraguay", re: /paraguay/, hub: "asuncion" },
  { country: "Dominican Republic", re: /dominican/, hub: "santo-domingo" },
  { country: "Bolivia", re: /bolivia/, hub: "la-paz" },
  { country: "Venezuela", re: /venezuela/, hub: "caracas" },
  { country: "Honduras", re: /honduras/, hub: "tegucigalpa" },
  { country: "Nicaragua", re: /nicaragua/, hub: "managua" },
];

const byId = new Map(CITIES.map((e) => [e.id, e]));

const strip = ({ re: _re, ...p }: Entry): Place => p;

export const COUNTRY_FLAGS: Record<string, string> = {
  Brazil: "🇧🇷", Mexico: "🇲🇽", Colombia: "🇨🇴", Argentina: "🇦🇷", Chile: "🇨🇱", Uruguay: "🇺🇾", Peru: "🇵🇪",
  Ecuador: "🇪🇨", "El Salvador": "🇸🇻", "Costa Rica": "🇨🇷", Panama: "🇵🇦", Guatemala: "🇬🇹", Paraguay: "🇵🇾",
  "Dominican Republic": "🇩🇴", Bolivia: "🇧🇴", Venezuela: "🇻🇪", Honduras: "🇭🇳", Nicaragua: "🇳🇮", Remote: "🌐",
};

/**
 * Resolve a free-text job location ("Bogota D.C. / DC / Colombia; Mexico City / CDMX / Mexico") to places.
 * Cities win; a country is added at its hub only when none of its cities matched.
 */
export function resolveLocation(location: string): { places: Place[]; precision: "city" | "country" | "remote" } {
  const t = norm(location);
  const cities = CITIES.filter((e) => e.re.test(t));
  const covered = new Set(cities.map((e) => e.country));
  const countryHubs = COUNTRIES.filter((k) => !covered.has(k.country) && k.re.test(t)).map((k) => byId.get(k.hub)!);
  const places = [...cities, ...countryHubs].map(strip);
  if (cities.length) return { places, precision: "city" };
  if (countryHubs.length) return { places, precision: "country" };
  return { places: [], precision: "remote" };
}

export const knownPlace = (id: string) => (byId.has(id) ? strip(byId.get(id)!) : undefined);
