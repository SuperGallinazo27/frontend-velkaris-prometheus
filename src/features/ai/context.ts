/**
 * Los datos que recibe el copiloto: lo que la pantalla ya muestra de un lugar, en un objeto pequeño
 * y con nombres en español, para que el modelo lo lea sin ambigüedad. Función pura.
 *
 * Aquí se decide qué sale del navegador: solo datos del lugar y del plan. No se incluyen el correo,
 * el nombre de la persona ni el de su institución.
 */
import suelos from "../../data/sueloReal.json";
import rugosidad from "../../data/rugosidadLola.json";
import terreno from "../../data/terrenoReal.json";
import { robotOutcome } from "../mission/campaign";
import type { MissionPlan, RobotTestResult } from "../mission/campaign";
import { soilById, suggestSoil } from "../mission/wheelData";
import type { Texture } from "../mission/wheelData";
import { accessOf, accessRows } from "../world/access";
import { MONTHS, RATINGS, compareRain, describeMonth, rateNow, typicalRain } from "../world/climate";
import type { RainCheck, Season } from "../world/climate";
import { ensoSentence, ensoStatus } from "../world/enso";
import type { EnsoData } from "../world/enso";
import { QUARTER_NAMES, groundOf, moonGroundOf } from "../world/ground";
import { similarity } from "../world/hierarchy";
import type { Match } from "../world/hierarchy";
import { ROCK_COVER, ROCK_SIZE, SURFACES, VEGETATION, readingOf } from "../world/terrainReading";
import type { TerrainReading } from "../world/terrainReading";
import type { RecentRain } from "../../services/recentRain";

/** Estado del lugar en el portal de turnos, ya en palabras. */
export interface BookingFacts {
  /** «libre», «requiere permiso», «no reservable»… */
  status: string;
  /** Por qué no se puede reservar o qué permiso hace falta. */
  reason?: string;
  /** Fechas ya ocupadas («del 2027-01-10 al 2027-01-20»). */
  busy?: string[];
}

export interface CopilotFacts {
  match: Match;
  /** true cuando la comparación usa terreno real (Luna); con Marte es una demostración. */
  real: boolean;
  elevation: number | null;
  season: Season | null;
  /** Mes de ahora, de 0 a 11. */
  month: number;
  rain: RecentRain | null;
  enso: EnsoData | null;
  booking: BookingFacts | null;
  robotTest: RobotTestResult | null;
  plan: MissionPlan | null;
}

const RAIN_WORDS: Record<RainCheck, string> = {
  "mucho-mas": "llueve mucho más de lo típico",
  mas: "llueve más de lo típico",
  normal: "dentro de lo típico",
  menos: "más seco de lo típico",
};

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

const regionIds = new Map(terreno.regions.map((region) => [region.name, region.id]));
const fineRoughness = rugosidad.regions as Record<string, { median: number } | null>;
const textures = suelos.sites as Record<string, Texture | null>;

function climateFacts({ season, month, rain, enso, match }: CopilotFacts) {
  if (!season) return null;
  const now = season.year[month];
  const facts: Record<string, unknown> = {
    mes_actual: MONTHS[month],
    tipico_del_mes: {
      descripcion: describeMonth(now, match.zone.latitude),
      lluvia_mm: round(now.precipitation, 0),
      temperatura_c: `${round(now.temperatureMin, 0)} a ${round(now.temperatureMax, 0)}`,
      viento_kmh: round(now.wind, 0),
      valoracion_para_trabajo_de_campo: RATINGS[now.rating].name.toLowerCase(),
    },
    mejor_epoca_tipica: season.window
      ? season.window.length === 12
        ? "todo el año"
        : `de ${MONTHS[season.window.start]} a ${MONTHS[season.window.end]}`
      : "ningún mes es bueno",
    fuente: "NASA POWER, promedio 2001-2025",
  };
  if (rain) {
    const typical = typicalRain(season.year, rain.from, rain.to);
    const real = rateNow(now, rain.totalMm);
    facts.ultimos_30_dias = {
      lluvia_mm: round(rain.totalMm, 0),
      lluvia_tipica_de_esas_fechas_mm: round(typical, 0),
      estado: RAIN_WORDS[compareRain(rain.totalMm, typical)],
      valoracion_ahora: RATINGS[real.rating].name.toLowerCase(),
      motivos: real.reasons,
      fuente: "Open-Meteo, modelo para estas coordenadas",
    };
  }
  const status = enso ? ensoStatus(enso) : null;
  const sentence = status ? ensoSentence(status) : null;
  if (sentence) facts.el_nino = `${sentence} Fuente: NOAA.`;
  return facts;
}

function groundFacts(zoneId: string, regionId: string | undefined) {
  const here = groundOf(zoneId);
  const there = regionId ? moonGroundOf(regionId) : null;
  if (!here && !there) return null;
  return {
    aqui_c: here && {
      trimestres: QUARTER_NAMES,
      de_dia: here.quarters.map((q) => q.day),
      de_noche: here.quarters.map((q) => q.night),
      fuente: "MODIS, satélite, 1 km",
    },
    en_la_region_lunar_c: there && { maxima: there.max, minima: there.min, fuente: "Diviner, LRO, NASA" },
  };
}

function soilFacts(zoneId: string) {
  const texture = textures[zoneId];
  if (!texture) return { dato: "el mapa de suelos no tiene dato aquí (roca, hielo o agua)" };
  return {
    arena_pct: round(texture.sand, 0),
    limo_pct: round(texture.silt, 0),
    arcilla_pct: round(texture.clay, 0),
    tipo_para_la_simulacion_de_ruedas: soilById(suggestSoil(texture).id).name.toLowerCase(),
    fuente: "SoilGrids 2.0, predicción a 250 m, no un ensayo de campo",
  };
}

function readingFacts(reading: TerrainReading) {
  return {
    superficie: SURFACES[reading.surface] + (reading.secondary ? `, con ${SURFACES[reading.secondary]}` : ""),
    rocas_sueltas: reading.rockCover ? ROCK_COVER[reading.rockCover].name : "no se distinguen en las fotos",
    ...(reading.rockSize && { tamano_tipico: ROCK_SIZE[reading.rockSize].name }),
    vegetacion: VEGETATION[reading.vegetation],
    agua_barro_o_nieve_en_las_fotos: reading.wet,
    confianza: reading.confidence,
    fotos_utiles: `${reading.usefulPhotos} de ${reading.totalPhotos}`,
    nota: "estimación de una IA a partir de fotos de Wikimedia Commons tomadas a menos de 10 km; no es una medición",
  };
}

function robotFacts(test: RobotTestResult) {
  return {
    robot: test.vehicle,
    suelo: test.soil,
    resultado: robotOutcome(test),
    ...(test.collisions !== undefined && { topes_con_obstaculos_de_practica: test.collisions }),
    ...(test.stuckTimes !== undefined && { veces_atascado: test.stuckTimes }),
    recorrido_m: round(test.distanceM, 0),
    tiempo_min: round(test.timeS / 60, 0),
    energia_wh: round(test.energyWh, 0),
    pendiente_maxima_grados: round(test.maxSlopeDeg),
    patinaje_maximo_pct: round(test.maxSlipPercent, 0),
    nota: "simulación con un modelo de rueda y suelo, no un ensayo",
  };
}

function planFacts(plan: MissionPlan) {
  return {
    mision: plan.mission,
    ventana: plan.window
      ? { trimestre: plan.window.quarter, anio: plan.window.year, estado: plan.window.status, inconvenientes: plan.window.reasons }
      : "sin ventana elegida",
    equipo: {
      personas: plan.team.people,
      carga_kg: plan.team.cargoKg,
      dias: plan.team.days,
      sale_de: plan.team.origin,
      distancia_km: round(plan.team.distanceKm, 0),
    },
    costo_estimado_usd: {
      total: round(plan.cost.total, 0),
      por_dia: round(plan.cost.perDay, 0),
      nota: "con tarifas de ejemplo, no es una cotización",
    },
    notas_del_plan: plan.notes,
  };
}

/** Todo lo que el copiloto puede saber de un lugar. Lo que falta, no se envía. */
export function placeContext(facts: CopilotFacts): Record<string, unknown> {
  const { match, real, elevation, booking, robotTest, plan } = facts;
  const { zone, scenario } = match;
  const likeness = similarity(match.distance);
  const regionId = real ? regionIds.get(scenario.name) : undefined;
  const fine = regionId ? fineRoughness[regionId] : null;
  const context: Record<string, unknown> = {
    lugar: {
      nombre: zone.name,
      provincia: zone.province,
      pais: zone.country,
      latitud: round(zone.latitude, 2),
      longitud: round(zone.longitude, 2),
      ...(elevation !== null && { altitud_m: Math.round(elevation) }),
    },
    comparacion_de_terreno: {
      con: `${scenario.name} (${scenario.world})`,
      similitud: likeness.name.toLowerCase(),
      coincidencia_pct: likeness.percent,
      datos: real ? "reales: Copernicus en la Tierra, LOLA en la Luna" : "sintéticos de demostración, no son mediciones",
      aqui: { relieve_m: round(zone.relief, 0), pendiente_grados: round(zone.slope), rugosidad_m: round(zone.roughness) },
      alla: {
        relieve_m: round(scenario.relief, 0),
        pendiente_grados: round(scenario.slope),
        rugosidad_m: round(scenario.roughness),
        ...(fine && { rugosidad_fina_a_25_m: fine.median }),
      },
    },
  };
  const climate = climateFacts(facts);
  if (climate) context.clima = climate;
  const ground = groundFacts(zone.id, regionId);
  if (ground) context.temperatura_del_suelo = ground;
  context.suelo = soilFacts(zone.id);
  const reading = readingOf(zone.id);
  if (reading) context.lectura_de_fotos = readingFacts(reading);
  const access = accessOf(zone.id);
  if (access) {
    context.como_se_llega = {
      ...Object.fromEntries(accessRows(access).map((row) => [row.label.toLowerCase(), row.text])),
      nota: "distancias en línea recta, de OpenStreetMap",
    };
  }
  if (booking) {
    context.turnos = {
      estado: booking.status,
      ...(booking.reason && { motivo: booking.reason }),
      ...(booking.busy?.length && { fechas_ocupadas: booking.busy }),
      nota: "el turno coordina a las agencias del portal; no reemplaza permisos",
    };
  }
  if (robotTest) context.prueba_del_robot = robotFacts(robotTest);
  if (plan) context.plan_de_campana = planFacts(plan);
  return context;
}

/** Preguntas de un toque para el copiloto. */
export const SUGGESTED_QUESTIONS = [
  "¿Conviene ir ahora o es mejor esperar?",
  "¿Qué tan parecido es este lugar a la región lunar y en qué se diferencia?",
  "¿Qué riesgos tiene una campaña aquí?",
  "¿Qué permisos necesito antes de viajar?",
] as const;
