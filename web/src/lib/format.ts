import type { Job } from "./types";

const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${n}`);
const SYM: Record<string, string> = { BRL: "R$", USD: "US$", EUR: "€", MXN: "MX$", COP: "COP ", CLP: "CLP ", ARS: "ARS ", PEN: "S/ " };

/** "R$ 8k–12k/mo" from the pay range a posting states. */
export function pay(j: Job) {
  const s = j.salary;
  if (!s) return null;
  const cur = s.currency ? SYM[s.currency] ?? s.currency : "";
  const range = s.max > s.min ? `${short(s.min)}–${short(s.max)}` : short(s.min);
  return `${cur}${range}${s.period === "month" ? "/mo" : s.period === "year" ? "/yr" : ""}`;
}

/** Short facts for chips: pay, English, experience, contract. */
export function facts(j: Job) {
  return [
    pay(j) && { k: "pay", v: pay(j)! },
    j.english && { k: "english", v: `English: ${j.english.toLowerCase()}` },
    j.years && { k: "years", v: `${j.years}+ yrs` },
    j.employment && { k: "employment", v: j.employment },
  ].filter(Boolean) as { k: string; v: string }[];
}
