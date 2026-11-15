/**
 * Traducción de la interfaz del español al inglés, texto por texto.
 *
 * La aplicación está escrita en español. En vez de tocar cada pantalla, el modo inglés traduce lo que
 * ya se ve: cada texto de la pantalla se busca en el diccionario `en.json`, que tiene dos partes:
 * - `exact`: textos fijos ("Iniciar sesión" → "Sign in").
 * - `templates`: textos con valores ("Se atascó a los {0} m" → "Got stuck after {0} m"), que se
 *   reconocen ya rellenos ("Se atascó a los 12 m") y conservan los valores.
 * - `phrases`: trozos que se cambian dentro de textos que vienen armados del servidor (por ejemplo
 *   «categoría UICN» en los motivos de protección).
 * Lo que no está en el diccionario se queda en español: nunca se inventa una traducción.
 */

export interface Dictionary {
  exact: Record<string, string>;
  templates: [string, string][];
  phrases?: [string, string][];
}

export interface Translator {
  /** El texto en inglés, o `null` si no hay traducción (o no hace falta). */
  translate(text: string): string | null;
}

interface Template {
  pattern: RegExp;
  /** Un trozo fijo que tiene que aparecer: descarta rápido las plantillas que no aplican. */
  needle: string;
  en: string;
  slots: number;
}

const LETTER = /[A-Za-zÁÉÍÓÚÜáéíóúüñÑ]/;
const PLACEHOLDER = /\{(\d+)\}/g;
const MAX_CACHE = 5000;
const MAX_DEPTH = 3;

const MONTHS: Record<string, string> = {
  enero: "January",
  febrero: "February",
  marzo: "March",
  abril: "April",
  mayo: "May",
  junio: "June",
  julio: "July",
  agosto: "August",
  septiembre: "September",
  setiembre: "September",
  octubre: "October",
  noviembre: "November",
  diciembre: "December",
};
const MONTH = Object.keys(MONTHS).join("|");
const DATE_DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2}) de (${MONTH}) de (\\d{4})\\b`, "gi");
const DATE_MONTH_YEAR = new RegExp(`\\b(${MONTH}) de (\\d{4})\\b`, "gi");
const DATE_DAY_MONTH = new RegExp(`\\b(\\d{1,2}) de (${MONTH})\\b`, "gi");
const DATE_RANGE_SAME_MONTH = new RegExp(`\\bdel (\\d{1,2}) al (\\d{1,2}) de (${MONTH}) de (\\d{4})\\b`, "gi");
const MONTH_RANGE_YEAR = new RegExp(`\\b(${MONTH}) a (${MONTH}) de (\\d{4})\\b`, "gi");
const MONTH_RANGE = new RegExp(`\\b[Dd]e (${MONTH}) a (${MONTH})\\b`, "gi");
const WEEKDAYS: Record<string, string> = { lun: "Mon", mar: "Tue", mié: "Wed", jue: "Thu", vie: "Fri", sáb: "Sat", dom: "Sun" };
const WEEKDAY_DAY = /^(lun|mar|mié|jue|vie|sáb|dom)\.? (\d{1,2})$/i;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const lettersIn = (s: string) => (s.match(new RegExp(LETTER.source, "g")) ?? []).length;

/** Fechas en español escritas por `toLocaleDateString("es")` y similares. */
export function translateDates(text: string): string {
  const month = (m: string) => MONTHS[m.toLowerCase()];
  const weekday = WEEKDAY_DAY.exec(text.trim());
  if (weekday) return text.replace(weekday[0], `${WEEKDAYS[weekday[1].toLowerCase()]} ${weekday[2]}`);
  return text
    .replace(DATE_RANGE_SAME_MONTH, (_, a, b, m, y) => `from ${month(m)} ${a} to ${b}, ${y}`)
    .replace(MONTH_RANGE_YEAR, (_, a, b, y) => `${month(a)} to ${month(b)} ${y}`)
    .replace(MONTH_RANGE, (_, a, b) => `from ${month(a)} to ${month(b)}`)
    .replace(DATE_DAY_MONTH_YEAR, (_, d, m, y) => `${month(m)} ${d}, ${y}`)
    .replace(DATE_MONTH_YEAR, (_, m, y) => `${month(m)} ${y}`)
    .replace(DATE_DAY_MONTH, (_, d, m) => `${month(m)} ${d}`)
    // Rangos de números: «15 a 27 °C» → «15 to 27 °C»; «, a 53 km» → «, 53 km away».
    .replace(/(\d) a (-?\d)/g, "$1 to $2")
    .replace(/(\d) y (-?\d)/g, "$1 and $2")
    // Coordenadas: «71,9° O» (oeste) → «71,9° W».
    .replace(/(\d°) O\b/g, "$1 W")
    .replace(/, a (\d[\d,.]*) (k?m)\b/g, ", $1 $2 away")
    .replace(/\bdel (?=[A-Z][a-z]+ \d)/g, "from ")
    .replace(/(\d) al (?=[A-Z][a-z]+ \d)/g, "$1 to ");
}

function compileTemplate(es: string, en: string): Template | null {
  const parts = es.split(PLACEHOLDER);
  // split con grupo deja [fijo, n, fijo, n, fijo...]
  const fixed = parts.filter((_, i) => i % 2 === 0);
  const order = parts.filter((_, i) => i % 2 === 1).map(Number);
  // Plantillas casi sin texto fijo ("{0} de {1}") se aplicarían a nombres propios: no se usan.
  if (order.length === 0 || lettersIn(fixed.join("")) < 5) return null;
  const used = new Set<number>();
  for (const m of en.matchAll(PLACEHOLDER)) used.add(Number(m[1]));
  if (used.size !== new Set(order).size || [...used].some((n) => !order.includes(n))) return null;
  let source = "^";
  parts.forEach((part, i) => {
    source += i % 2 === 0 ? escapeRegExp(part).replace(/ /g, "\\s+") : "(.+?)";
  });
  source += "$";
  const needle = fixed.map((f) => f.trim()).sort((a, b) => b.length - a.length)[0];
  return { pattern: new RegExp(source, "s"), needle, en, slots: order.length };
}

export function createTranslator(dictionary: Dictionary): Translator {
  const exact = new Map<string, string>();
  for (const [es, en] of Object.entries(dictionary.exact)) {
    if (typeof en === "string" && en.trim() && es !== en) exact.set(normalize(es), en);
  }
  const templates = dictionary.templates
    .map(([es, en]) => compileTemplate(normalize(es), en))
    .filter((t): t is Template => t !== null)
    // Primero las más específicas: más texto fijo.
    .sort((a, b) => b.needle.length - a.needle.length);
  const cache = new Map<string, string | null>();
  const phrases = (dictionary.phrases ?? []).filter(([es, en]) => es && en && es !== en);
  const withPhrases = (text: string) => phrases.reduce((acc, [es, en]) => (acc.includes(es) ? acc.split(es).join(en) : acc), text);
  /** Si el original empieza en mayúscula, la traducción también («alta similitud» → «High…»). */
  const capitalized = (source: string, result: string) =>
    /^[A-ZÁÉÍÓÚÑ]/.test(source) && /^[a-z]/.test(result) ? result[0].toUpperCase() + result.slice(1) : result;

  function core(text: string, depth: number): string | null {
    const found = exact.get(text);
    if (found !== undefined) return found;
    // El mismo texto con la primera letra cambiada («arena suelta…» frente a «Arena suelta…»).
    const first = text[0];
    const flipped = first === first.toLowerCase() ? first.toUpperCase() : first.toLowerCase();
    const other = exact.get(flipped + text.slice(1));
    if (other) {
      return first === first.toLowerCase() ? other[0].toLowerCase() + other.slice(1) : other[0].toUpperCase() + other.slice(1);
    }
    if (depth >= MAX_DEPTH) return null;

    for (const t of templates) {
      if (!text.includes(t.needle)) continue;
      const m = t.pattern.exec(text);
      if (!m) continue;
      return t.en.replace(PLACEHOLDER, (_, n: string) => {
        const value = m[Number(n) + 1] ?? "";
        return translateValue(value, depth + 1);
      });
    }

    // Textos armados con « · »: cada trozo por separado.
    if (text.includes(" · ")) {
      const pieces = text.split(" · ");
      const done = pieces.map((p) => translateValue(p, depth + 1));
      if (done.some((d, i) => d !== pieces[i])) return done.join(" · ");
    }
    // Varias frases seguidas: frase por frase.
    const sentences = text.split(/(?<=[.!?])\s+(?=[¿¡A-ZÁÉÍÓÚÑ0-9])/);
    if (sentences.length > 1) {
      const done = sentences.map((s) => translateValue(s, depth + 1));
      if (done.some((d, i) => d !== sentences[i])) return done.join(" ");
    }
    return null;
  }

  /** Un trozo (valor de plantilla, parte de una lista): traducido si se puede, si no tal cual. */
  function translateValue(value: string, depth: number): string {
    const trimmed = normalize(value);
    if (!trimmed || !LETTER.test(trimmed)) return value;
    const done = core(trimmed, depth);
    const dated = translateDates(done ?? trimmed);
    if (dated === trimmed) return value;
    return value.replace(trimmed, dated);
  }

  return {
    translate(text: string) {
      if (!LETTER.test(text)) return null;
      const cached = cache.get(text);
      if (cached !== undefined) return cached;
      const trimmed = normalize(text);
      let result: string | null = null;
      if (trimmed) {
        const done = core(trimmed, 0);
        const dated = capitalized(trimmed, withPhrases(translateDates(done ?? trimmed)));
        if (dated !== trimmed) {
          // Conserva los espacios de los bordes: separan el texto de los valores vecinos.
          const lead = text.match(/^\s*/)![0];
          const trail = text.match(/\s*$/)![0];
          result = lead + dated + trail;
        }
      }
      if (cache.size >= MAX_CACHE) cache.clear();
      cache.set(text, result);
      return result;
    },
  };
}
