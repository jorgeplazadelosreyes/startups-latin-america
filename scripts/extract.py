"""Turn a job description (English, Portuguese or Spanish) into compact, filterable facts.

    extract(job) -> {"skills", "salary", "english", "years", "benefits", "employment", "snippet"}

Everything here is pattern matching on the posting text: a fact is only reported when the text states it.
"""
import re
import unicodedata


def _norm(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn").lower()


# Display name -> pattern over normalized (accent-free, lowercase) text.
SKILLS = {
    "Python": r"\bpython\b", "Java": r"\bjava\b(?!script)", "Kotlin": r"\bkotlin\b", "Go": r"\bgolang\b|\bgo\b(?= ?(?:lang|,|/| e | y | and ))",
    "Scala": r"\bscala\b", "Elixir": r"\belixir\b", "Clojure": r"\bclojure\b", "Ruby": r"\bruby\b", "Rails": r"\brails\b",
    "PHP": r"\bphp\b", "C#/.NET": r"\bc#|\.net\b", "C++": r"\bc\+\+", "Rust": r"\brust\b", "Swift": r"\bswift\b",
    "TypeScript": r"\btypescript\b", "JavaScript": r"\bjavascript\b", "Node.js": r"\bnode(?:\.?js)?\b", "React": r"\breact\b(?! native)",
    "React Native": r"\breact native\b", "Flutter": r"\bflutter\b", "Vue": r"\bvue(?:\.?js)?\b", "Angular": r"\bangular\b",
    "AWS": r"\baws\b|amazon web services", "GCP": r"\bgcp\b|google cloud", "Azure": r"\bazure\b",
    "Kubernetes": r"\bkubernetes\b|\bk8s\b", "Docker": r"\bdocker\b", "Terraform": r"\bterraform\b",
    "SQL": r"\bsql\b", "PostgreSQL": r"\bpostgres(?:ql)?\b", "MongoDB": r"\bmongo(?:db)?\b", "Redis": r"\bredis\b",
    "Kafka": r"\bkafka\b", "Spark": r"\bspark\b", "Airflow": r"\bairflow\b", "dbt": r"\bdbt\b", "Databricks": r"\bdatabricks\b",
    "Snowflake": r"\bsnowflake\b", "BigQuery": r"\bbigquery\b", "Machine learning": r"machine learning|aprendizado de maquina|aprendizaje automatico",
    "LLMs / GenAI": r"\bllms?\b|generative ai|genai|ia generativa|\bgpt\b", "Power BI": r"power ?bi\b", "Tableau": r"\btableau\b",
    "Looker": r"\blooker\b", "Excel": r"\bexcel\b", "Salesforce": r"\bsalesforce\b", "HubSpot": r"\bhubspot\b", "SAP": r"\bsap\b",
    "Figma": r"\bfigma\b", "Jira": r"\bjira\b", "Git": r"\bgit\b|github|gitlab",
}
_SKILL_RE = {k: re.compile(v) for k, v in SKILLS.items()}

BENEFITS = {
    "Equity": r"stock options?|\bequity\b|\besop\b|opcoes de acoes|participacao acionaria|acciones de la empresa",
    "Health insurance": r"health (?:insurance|plan)|plano de saude|seguro (?:de )?(?:gastos )?medico|seguro de salud|medicina prepaga|eps\b",
    "Meal allowance": r"vale[- ]refeicao|vale[- ]alimentacao|meal (?:voucher|allowance)|\bvr ?/ ?va\b|vales de despensa|tarjeta de alimentacion",
    "Remote allowance": r"home ?office (?:allowance|stipend|aux)|auxilio home office|remote (?:allowance|stipend)|apoyo para (?:home office|trabajo remoto)",
    "Learning budget": r"(?:education|learning|training) (?:budget|allowance)|auxilio educacao|bolsa de estudos|presupuesto (?:de|para) (?:formacion|educacion)",
    "Wellhub/Gympass": r"wellhub|gympass|totalpass",
    "Flexible hours": r"flexible (?:hours|schedule)|horario flexivel|horario flexible",
    "Extra vacation": r"day off|dia de folga|birthday off|vacaciones adicionales|extra (?:vacation|pto)",
    "Profit sharing": r"\bplr\b|profit sharing|participacao nos lucros|reparto de utilidades|\bptu\b",
}
_BEN_RE = {k: re.compile(v) for k, v in BENEFITS.items()}

_ENGLISH = [
    ("Fluent", r"(?:fluent|fluency|fluente|fluencia|nativ[eo])[^.\n]{0,25}(?:english|ingles)|(?:english|ingles)[^.\n]{0,25}(?:fluent|fluente|fluido|fluencia|nativo)"),
    ("Advanced", r"(?:advanced|avancad[oa]|avanzad[oa]|c1|c2)[^.\n]{0,25}(?:english|ingles)|(?:english|ingles)[^.\n]{0,25}(?:advanced|avancad[oa]|avanzad[oa]|\bc1\b|\bc2\b)"),
    ("Intermediate", r"(?:intermediate|intermediario|intermedio|b1|b2)[^.\n]{0,25}(?:english|ingles)|(?:english|ingles)[^.\n]{0,25}(?:intermediate|intermediario|intermedio|\bb1\b|\bb2\b)"),
    ("Required", r"(?:english|ingles) (?:is )?(?:required|obrigatorio|requerido|necesario|indispensable)"),
]
_ENGLISH_RE = [(k, re.compile(v)) for k, v in _ENGLISH]

_YEARS_RE = re.compile(r"(\d{1,2})\s*\+?\s*(?:years?|anos|anos?|años)\s+(?:of\s+|de\s+)?(?:\w+\s+){0,3}?(?:experience|experiencia)")

# Pay: "R$ 8.000 - R$ 12.000", "$40,000 – $55,000 USD", "MXN 30,000 a 45,000", "USD 3k-5k / month"
_CUR = r"(R\$|US\$|USD|MXN|COP|CLP|ARS|PEN|BRL|\$|€|EUR)"
_NUM = r"(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?\s*[kK]?)"
_SAL_RE = re.compile(_CUR + r"\s?" + _NUM + r"\s*(?:-|–|—|a|to|até|hasta)\s*" + _CUR + r"?\s?" + _NUM + r"(?:\s*" + _CUR + r")?([^\n]{0,30})")

EMPLOYMENT = [
    ("Internship", r"intern|estagi|pasant|practicante|internship"),
    ("Contractor (PJ)", r"\bpj\b|contractor|contract|freelance|prestacao de servicos|honorarios"),
    ("Full-time (CLT)", r"\bclt\b"),
    ("Part-time", r"part[- ]?time|meio periodo|medio tiempo"),
    ("Temporary", r"temporar"),
    ("Full-time", r"full[- ]?time|fulltime|tempo integral|tiempo completo|permanent|effective|efetivo"),
]


def _num(s):
    s = s.strip().lower()
    mult = 1000 if s.endswith("k") else 1
    s = s.rstrip("k").strip()
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", s):
        s = re.sub(r"[.,]", "", s)
    else:
        s = s.replace(",", ".")
    try:
        return float(s) * mult
    except ValueError:
        return None


def salary(raw, desc):
    if raw and raw.get("min"):
        per = _norm(raw.get("period"))
        return {"min": raw["min"], "max": raw.get("max") or raw["min"], "currency": raw.get("currency"),
                "period": "month" if "month" in per else "year" if "year" in per else None}
    if raw and raw.get("text"):
        desc = raw["text"] + "\n" + (desc or "")
    m = _SAL_RE.search(desc or "")
    if not m:
        return None
    cur = m.group(1) or m.group(3) or m.group(5)
    lo, hi = _num(m.group(2)), _num(m.group(4))
    if not lo or not hi or hi < lo or hi > 50 * lo:
        return None
    tail = _norm(m.group(6) or "")
    period = "month" if re.search(r"mes|month|mensal|mensual", tail) else "year" if re.search(r"year|ano|anual|annual|yr", tail) else None
    cur = {"R$": "BRL", "US$": "USD", "$": "USD" if "usd" in _norm(m.group(0)) else "$", "€": "EUR"}.get(cur, cur)
    return {"min": lo, "max": hi, "currency": cur, "period": period}


def lines_of(desc):
    return [l.strip(" -•\t") for l in (desc or "").split("\n") if len(l.strip()) > 40]


def snippet(desc, title, boiler=frozenset()):
    """First line about the role itself: skips the company's boilerplate (lines repeated across its
    postings) and "About us" openers."""
    if not desc:
        return None
    lines = [l for l in lines_of(desc) if l not in boiler]
    about = re.compile(r"^(about|sobre|acerca|quienes somos|quem somos|who we are|somos|we are|nu serves|at )", re.I)
    role = [l for l in lines if not about.match(l)]
    pick = (role or lines or [desc])[0]
    return (pick[:277] + "…") if len(pick) > 280 else pick


def extract(job, boiler=frozenset()):
    desc = job.get("description") or ""
    t = _norm(desc)
    # The feed's own field decides; titles only reveal internships and part-time roles.
    employment = next((k for k, r in EMPLOYMENT if re.search(r, _norm(job.get("employment")))), None) if job.get("employment") else None
    if not employment:
        employment = next((k for k, r in EMPLOYMENT[:1] + EMPLOYMENT[3:4] if re.search(r, _norm(job.get("title")))), None)
    years = [int(y) for y in _YEARS_RE.findall(t) if 0 < int(y) < 25]
    return {
        "skills": [k for k, r in _SKILL_RE.items() if r.search(t)],
        "salary": salary(job.get("salary"), desc),
        "english": next((k for k, r in _ENGLISH_RE if r.search(t)), None),
        "years": min(years) if years else None,
        "benefits": [k for k, r in _BEN_RE.items() if r.search(t)],
        "employment": employment,
        "snippet": snippet(desc, job.get("title"), boiler),
    }
