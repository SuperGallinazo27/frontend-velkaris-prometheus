/**
 * Reglas del portal de turnos: qué lugares se pueden reservar y qué fechas valen.
 *
 * Las áreas protegidas vienen de la World Database on Protected and Conserved Areas (UNEP-WCMC y
 * UICN), en `src/data/areasProtegidas.json` (lo genera `scripts/protegidas/calcular.py`). La regla
 * es un criterio de PROMETHEUS apoyado en las categorías de manejo de la UICN, no un dictamen legal:
 *
 * - protección estricta (categorías Ia, Ib, II, III y IV): no se reserva;
 * - uso múltiple (V y VI) o sin categoría informada: se reserva solo declarando el permiso;
 * - sin área protegida en el punto: se reserva.
 *
 * Solo deciden los polígonos que contienen el punto del lugar. Las áreas que apenas tocan el
 * recuadro de 18 km que se analiza se muestran como aviso. El servidor aplica la misma regla
 * (`api/services/places.py`); esta copia sirve a la demostración sin servidor y a las pantallas.
 *
 * Las fechas son texto `AAAA-MM-DD`; un turno incluye su primer y su último día.
 */
import protectedAreas from "../data/areasProtegidas.json";
import places from "../features/world/places.json";

/** Lo que dice la base de datos, sin decisiones del administrador. */
export type DatasetState = "libre" | "permiso" | "protegido" | "sin_dato";
/** Estado de un lugar para reservar; `cerrado` y `habilitado` son decisiones del administrador. */
export type PlaceState = DatasetState | "cerrado" | "habilitado";

export interface ProtectedArea {
  siteId: number | null;
  /** Nombre original, o el inglés si el original no usa el alfabeto latino. */
  name: string;
  designation: string | null;
  designationEng: string | null;
  /** «National», «International» o «Regional». */
  designationType: string | null;
  /** Categoría de manejo de la UICN tal como la da la base: «II», «Not Reported»… */
  iucn: string | null;
  status: string | null;
  statusYear: number | null;
  governance: string | null;
  authority: string | null;
  /** País, en código ISO de tres letras («ECU»); varios separados por «;» si el área cruza fronteras. */
  iso3: string | null;
  /** true si está vigente y su categoría es de protección estricta. */
  strict: boolean;
}

export interface PlaceOverride {
  mode: "habilitado" | "cerrado";
  reason: string;
  updatedAt: string;
}

export interface PlaceStatus {
  id: string;
  name: string;
  province: string;
  country: string;
  status: PlaceState;
  bookable: boolean;
  permitRequired: boolean;
  /** Por qué tiene ese estado, en una frase. */
  reason: string;
  datasetStatus: DatasetState;
  /** Áreas vigentes que contienen el punto del lugar. */
  areas: ProtectedArea[];
  /** Áreas de protección estricta que tocan el recuadro analizado sin contener el punto. */
  nearbyStrict: ProtectedArea[];
  override: PlaceOverride | null;
  occupiedToday: boolean;
  /** Turnos reservados que aún no terminan. */
  activeReservations: number;
}

/** Categorías I a IV: la lectura habitual de «protección estricta». */
export const STRICT_IUCN: readonly string[] = ["Ia", "Ib", "II", "III", "IV"];

export const IUCN_NAMES: Record<string, string> = {
  Ia: "reserva natural estricta",
  Ib: "área silvestre",
  II: "parque nacional",
  III: "monumento natural",
  IV: "área de manejo de hábitats o especies",
  V: "paisaje protegido",
  VI: "área protegida con uso sostenible de los recursos",
};

/** Designaciones de convenios internacionales y regionales, tal como las escribe la base, en español. */
const DESIGNATIONS_ES: Record<string, string> = {
  "World Heritage Site (natural or mixed)": "Sitio del Patrimonio Mundial natural o mixto",
  "UNESCO-MAB Biosphere Reserve": "Reserva de la Biosfera UNESCO-MAB",
  "Wetland of International Importance (Ramsar Site)": "Humedal de Importancia Internacional, sitio Ramsar",
  "UNESCO Global Geopark": "Geoparque Mundial de la UNESCO",
  "Special Protection Area (Birds Directive)": "Zona de Especial Protección para las Aves, Directiva Aves",
  "Special Areas of Conservation (Habitats Directive)": "Zona Especial de Conservación, Directiva Hábitats",
  "Site of Community Importance (Habitats Directive)": "Lugar de Importancia Comunitaria, Directiva Hábitats",
  "Emerald Network": "Red Esmeralda",
  "Marine Protected Area (OSPAR)": "Área Marina Protegida OSPAR",
};

/** Países cuyas designaciones nacionales ya vienen en español en la base. */
const SPANISH_ISO3 = new Set(
  "ARG BOL CHL COL CRI CUB DOM ECU ESP GNQ GTM HND MEX NIC PAN PER PRI PRY SLV URY VEN".split(" "),
);

/**
 * La designación de un área como se puede leer: el nombre en español si es un convenio, el texto
 * original donde ya está en español y el texto en inglés de la base en el resto.
 */
export function designationText(area: Pick<ProtectedArea, "designation" | "designationEng" | "iso3">): string | null {
  for (const wording of [area.designationEng, area.designation]) {
    if (wording && wording in DESIGNATIONS_ES) return DESIGNATIONS_ES[wording];
  }
  if (area.iso3 && SPANISH_ISO3.has(area.iso3)) return area.designation ?? area.designationEng;
  return area.designationEng ?? area.designation;
}

/** Límites de un turno; el servidor usa los mismos. */
export const LIMITS = { maxDays: 60, maxDaysAhead: 730, maxActivePerAgency: 5 } as const;
/** El servidor cuenta los días en UTC: un navegador al oeste puede seguir en el día anterior. */
export const PAST_TOLERANCE_DAYS = 1;

export const STATE_NAMES: Record<PlaceState, string> = {
  libre: "Disponible",
  permiso: "Requiere permiso",
  protegido: "Área protegida",
  sin_dato: "Sin consultar",
  cerrado: "Cerrado",
  habilitado: "Habilitado con permiso",
};

/** De dónde salen las áreas protegidas, con la cita que pide la fuente. */
export const protectedSource = protectedAreas.source;

interface RawArea {
  siteId: number | null;
  name: string | null;
  nameEng: string | null;
  designation: string | null;
  designationEng: string | null;
  designationType: string | null;
  iucn: string | null;
  status: string | null;
  statusYear: number | null;
  governance: string | null;
  authority: string | null;
  iso3: string | null;
  geometry: string;
}

/** Una propuesta aún no está vigente: se lista, pero no decide. */
const inForce = (area: RawArea) => area.status !== "Proposed";

/** Letras fuera del alfabeto latino (hebreo, cirílico…): se muestra el nombre en inglés. */
const isForeignScript = (text: string) => [...text].some((char) => char.codePointAt(0)! > 0x24f && /\p{L}/u.test(char));

export function toArea(raw: RawArea): ProtectedArea {
  const original = raw.name ?? raw.nameEng ?? "Área sin nombre";
  return {
    siteId: raw.siteId,
    name: isForeignScript(original) && raw.nameEng ? raw.nameEng : original,
    designation: raw.designation,
    designationEng: raw.designationEng,
    designationType: raw.designationType,
    iucn: raw.iucn,
    status: raw.status,
    statusYear: raw.statusYear,
    governance: raw.governance,
    authority: raw.authority,
    iso3: raw.iso3,
    strict: inForce(raw) && STRICT_IUCN.includes(raw.iucn ?? ""),
  };
}

/** «Galápagos (Parque Nacional, categoría UICN II)». */
export function areaLabel(area: ProtectedArea): string {
  const category = area.iucn && area.iucn in IUCN_NAMES ? `categoría UICN ${area.iucn}` : "sin categoría UICN informada";
  const designation = designationText(area);
  return designation ? `${area.name} (${designation}, ${category})` : `${area.name} (${category})`;
}

/** «A», «A y B», «A, B y C». */
export function joinNames(names: readonly string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function authorityNote(areas: readonly ProtectedArea[]): string {
  const known: string[] = [];
  for (const area of areas) {
    if (area.authority && area.authority !== "Not Reported" && !known.includes(area.authority)) known.push(area.authority);
  }
  return known.length ? ` Autoridad que la base informa: ${joinNames(known.slice(0, 2))}.` : "";
}

/** Las áreas en las que se apoya el estado: las estrictas si las hay; si no, todas las vigentes. */
export function decidingAreas(areas: readonly ProtectedArea[]): ProtectedArea[] {
  const strict = areas.filter((area) => area.strict);
  return strict.length ? strict : [...areas];
}

const insideText = (areas: readonly ProtectedArea[]) =>
  `Está dentro de ${joinNames(decidingAreas(areas).slice(0, 3).map(areaLabel))}`;

export function datasetStateOf(areas: readonly ProtectedArea[] | null): DatasetState {
  if (areas === null) return "sin_dato";
  if (areas.some((area) => area.strict)) return "protegido";
  return areas.length ? "permiso" : "libre";
}

/** Por qué la base de datos, por sí sola, da ese estado al lugar. */
export function datasetReason(areas: readonly ProtectedArea[] | null): string {
  const state = datasetStateOf(areas);
  if (state === "sin_dato" || areas === null) {
    return "Este lugar aún no se pudo consultar en la base de áreas protegidas, así que no se puede reservar.";
  }
  if (state === "libre") return "La base de áreas protegidas no registra ninguna en este punto.";
  const note = authorityNote(decidingAreas(areas));
  if (state === "protegido") {
    return `${insideText(areas)}: protección estricta. PROMETHEUS no asigna turnos en áreas de protección estricta (categorías UICN Ia a IV).${note}`;
  }
  return `${insideText(areas)}. Solo se puede reservar declarando el permiso de la autoridad del área.${note}`;
}

/** Lo que la base dice de un lugar de la lista. */
export interface DatasetPlace {
  id: string;
  name: string;
  province: string;
  country: string;
  /** null: el lugar aún no se consultó. */
  areas: ProtectedArea[] | null;
  nearbyStrict: ProtectedArea[];
  /** Cuántas áreas, de cualquier tipo, tocan el recuadro analizado sin contener el punto. */
  nearbyCount: number;
}

const surveys = protectedAreas.sites as unknown as Record<string, { atPoint: RawArea[]; nearby: RawArea[] } | undefined>;

export const datasetPlaces: DatasetPlace[] = places.map((place) => {
  const survey = surveys[place.id];
  return {
    id: place.id,
    name: place.name,
    province: place.province,
    country: place.country,
    areas: survey ? survey.atPoint.filter(inForce).map(toArea) : null,
    nearbyStrict: survey
      ? survey.nearby.filter((area) => area.geometry === "poligono").map(toArea).filter((area) => area.strict)
      : [],
    nearbyCount: survey ? survey.nearby.length : 0,
  };
});

const datasetById = new Map(datasetPlaces.map((place) => [place.id, place]));

export const datasetPlace = (placeId: string): DatasetPlace | null => datasetById.get(placeId) ?? null;

/** Estado de un lugar una vez aplicada la decisión del administrador, si la hay. */
export function placeStatus(
  place: DatasetPlace,
  override: PlaceOverride | null,
  activity: { occupiedToday: boolean; activeReservations: number } = { occupiedToday: false, activeReservations: 0 },
): PlaceStatus {
  const datasetStatus = datasetStateOf(place.areas);
  const shared = {
    id: place.id,
    name: place.name,
    province: place.province,
    country: place.country,
    datasetStatus,
    areas: place.areas ?? [],
    nearbyStrict: place.nearbyStrict,
    ...activity,
  };
  if (override?.mode === "cerrado") {
    return {
      ...shared,
      status: "cerrado",
      bookable: false,
      permitRequired: false,
      reason: `Cerrado por el administrador: ${override.reason}`,
      override,
    };
  }
  // Habilitar solo significa algo mientras la base bloquea el lugar.
  if (override?.mode === "habilitado" && (datasetStatus === "protegido" || datasetStatus === "sin_dato")) {
    const blocked =
      datasetStatus === "protegido" && place.areas
        ? `${insideText(place.areas)} (protección estricta)`
        : "No se pudo consultar en la base de áreas protegidas";
    return {
      ...shared,
      status: "habilitado",
      bookable: true,
      permitRequired: true,
      reason: `${blocked}, pero el administrador lo habilitó: ${override.reason} Para reservar hay que declarar el permiso.`,
      override,
    };
  }
  return {
    ...shared,
    status: datasetStatus,
    bookable: datasetStatus === "libre" || datasetStatus === "permiso",
    permitRequired: datasetStatus === "permiso",
    reason: datasetReason(place.areas),
    override: null,
  };
}

// ---------- Fechas ----------

const pad = (value: number) => String(value).padStart(2, "0");

/** La fecha local de un momento, como `AAAA-MM-DD`. */
export const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** true si el texto es una fecha real del calendario (no «2027-02-30»). */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const toUtc = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

export const addDays = (iso: string, days: number) => new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);

/** Días de un turno, contando el primero y el último. */
export const daysIn = (start: string, end: string) => Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;

/** Dos turnos se pisan si comparten al menos un día. */
export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart;

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** «del 3 al 12 de marzo de 2027», «del 28 de febrero al 4 de marzo de 2027», «el 3 de marzo de 2027». */
export function rangeText(start: string, end: string): string {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const last = `${endDay} de ${MONTHS[endMonth - 1]} de ${endYear}`;
  if (start === end) return `el ${last}`;
  if (startYear === endYear && startMonth === endMonth) return `del ${startDay} al ${last}`;
  const first = `${startDay} de ${MONTHS[startMonth - 1]}${startYear === endYear ? "" : ` de ${startYear}`}`;
  return `del ${first} al ${last}`;
}

/** Por qué unas fechas no valen para un turno, o null si valen. */
export function rangeProblem(start: string, end: string, today: string): string | null {
  if (!isIsoDate(start) || !isIsoDate(end)) return "Elige una fecha de inicio y una de fin válidas.";
  if (end < start) return "La fecha de fin no puede ser anterior a la de inicio.";
  if (start < addDays(today, -PAST_TOLERANCE_DAYS)) return "La fecha de inicio ya pasó.";
  if (daysIn(start, end) > LIMITS.maxDays) return `Un turno dura como máximo ${LIMITS.maxDays} días.`;
  if (start > addDays(today, LIMITS.maxDaysAhead)) return "Solo se reserva con hasta 24 meses de anticipación.";
  return null;
}

export type Phase = "proximo" | "en_curso" | "terminado" | "cancelado";

export const PHASE_NAMES: Record<Phase, string> = {
  proximo: "Próximo",
  en_curso: "En curso",
  terminado: "Terminado",
  cancelado: "Cancelado",
};

/** En qué momento está un turno respecto de hoy. */
export function phaseOf(status: "reservado" | "cancelado", start: string, end: string, today: string): Phase {
  if (status === "cancelado") return "cancelado";
  if (today < start) return "proximo";
  return today <= end ? "en_curso" : "terminado";
}

/**
 * Primer día, a partir de `start`, en el que caben `days` días seguidos sin pisar ningún turno.
 * Devuelve null si ese hueco queda más allá del plazo máximo para reservar.
 */
export function nextFreeStart(
  busy: readonly { startDate: string; endDate: string }[],
  start: string,
  days: number,
  today: string,
): string | null {
  let candidate = start;
  let moved = true;
  while (moved) {
    moved = false;
    for (const range of busy) {
      if (overlaps(candidate, addDays(candidate, days - 1), range.startDate, range.endDate)) {
        candidate = addDays(range.endDate, 1);
        moved = true;
      }
    }
  }
  return candidate > addDays(today, LIMITS.maxDaysAhead) ? null : candidate;
}

/**
 * Primer día que se propone para el turno de un plan de campaña: el primero del trimestre elegido
 * (0 = enero a marzo) o, si ya pasó o el plan no tiene ventana, dentro de una semana.
 */
export function quarterStart(year: number, quarter: number | null, today: string): string {
  const soonest = addDays(today, 7);
  if (quarter === null) return soonest;
  const first = `${year}-${pad(quarter * 3 + 1)}-01`;
  return first < soonest ? soonest : first;
}
