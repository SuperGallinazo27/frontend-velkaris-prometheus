/**
 * Todo lo que la pestaña «Clima» sabe de ahora mismo, con datos reales: el tiempo, la lluvia de los
 * últimos 30 días y la de esas mismas fechas en años anteriores, el estado del suelo y El Niño. De
 * ahí sale una sola valoración de hoy para trabajo de campo.
 *
 * Cada dato llega por su cuenta y puede fallar sin tumbar a los demás. Se usa en un componente
 * montado con `key` por lugar: cambiar de lugar empieza de cero.
 */
import { useEffect, useState } from "react";
import { fetchEnso } from "../../services/enso";
import { fetchRainBaseline } from "../../services/rainBaseline";
import type { RainBaseline } from "../../services/rainBaseline";
import { fetchRecentRain } from "../../services/recentRain";
import type { RecentRain } from "../../services/recentRain";
import { fetchCurrentWeather } from "../../services/weather";
import type { CurrentWeather } from "../../services/weather";
import { compareRain, daylightHours, rateToday } from "./climate";
import type { MonthProfile, RainCheck, Rating, Season } from "./climate";
import type { EnsoData } from "./enso";
import { useGroundNow } from "./useGroundNow";
import type { GroundNow } from "./useGroundNow";

export type Loaded<T> = { status: "cargando" } | { status: "error" } | { status: "ok"; value: T };

export interface TodayRating {
  rating: Rating;
  reasons: string[];
}

export interface ClimateNow {
  /** Mes de ahora, de 0 a 11. */
  month: number;
  weather: Loaded<CurrentWeather>;
  rain: Loaded<RecentRain>;
  ground: GroundNow;
  enso: EnsoData | null;
  /** Lluvia de las mismas fechas que `rain` en años anteriores, según el mismo modelo. */
  baseline: Loaded<RainBaseline>;
  /** Cómo queda `rain` frente a la media de esos años; null mientras falte alguno de los dos. */
  rainCheck: RainCheck | null;
  /** Valoración de hoy con datos reales; null mientras no haya llegado ninguno. */
  today: TodayRating | null;
  retry: () => void;
}

export function useClimateNow(placeId: string, latitude: number, longitude: number, season: Season | null): ClimateNow {
  const [month] = useState(() => new Date().getMonth());
  const [weather, setWeather] = useState<Loaded<CurrentWeather>>({ status: "cargando" });
  const [rain, setRain] = useState<Loaded<RecentRain>>({ status: "cargando" });
  const [baseline, setBaseline] = useState<Loaded<RainBaseline>>({ status: "cargando" });
  const [enso, setEnso] = useState<EnsoData | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ground = useGroundNow(placeId, latitude, longitude);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentWeather(latitude, longitude)
      .then((value) => !cancelled && setWeather({ status: "ok", value }))
      .catch(() => !cancelled && setWeather({ status: "error" }));
    fetchRecentRain(latitude, longitude)
      .then((value) => {
        if (cancelled) return;
        setRain({ status: "ok", value });
        // Las mismas fechas en años anteriores: solo se sabe cuáles son cuando llega la lluvia.
        fetchRainBaseline(latitude, longitude, value.from, value.to)
          .then((found) => !cancelled && setBaseline({ status: "ok", value: found }))
          .catch(() => !cancelled && setBaseline({ status: "error" }));
      })
      .catch(() => {
        if (cancelled) return;
        setRain({ status: "error" });
        setBaseline({ status: "error" });
      });
    fetchEnso().then((value) => !cancelled && setEnso(value));
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, attempt]);

  function retry() {
    setWeather({ status: "cargando" });
    setRain({ status: "cargando" });
    setBaseline({ status: "cargando" });
    setAttempt((n) => n + 1);
    ground.retry();
  }

  const recent = rain.status === "ok" ? rain.value : null;
  const rainCheck = recent && baseline.status === "ok" ? compareRain(recent.totalMm, baseline.value.meanMm) : null;

  const day = ground.status === "listo" ? (ground.result.days[0]?.day ?? null) : null;
  const typical = season?.year[month] ?? null;
  // Sin clima típico del lugar, la valoración se arma solo con lo de hoy, si alcanza.
  const profile: MonthProfile | null =
    typical ??
    (day && day.temperatureMin !== null && day.temperatureMax !== null
      ? {
          index: month,
          temperature: (day.temperatureMin + day.temperatureMax) / 2,
          temperatureMin: day.temperatureMin,
          temperatureMax: day.temperatureMax,
          precipitation: recent?.totalMm ?? 0,
          wind: day.windMean ?? 0,
          cloud: 0,
          daylight: daylightHours(latitude, month),
          rating: "favorable",
          reasons: [],
        }
      : null);
  const anyReal = recent !== null || ground.status === "listo";
  const today =
    profile && anyReal
      ? rateToday(profile, {
          rain30dMm: recent?.totalMm ?? null,
          temperatureMin: day?.temperatureMin ?? null,
          temperatureMax: day?.temperatureMax ?? null,
          wind: day?.windMean ?? null,
          ground: ground.summary?.state ?? null,
        })
      : null;

  return { month, weather, rain, ground, enso, baseline, rainCheck, today, retry };
}
