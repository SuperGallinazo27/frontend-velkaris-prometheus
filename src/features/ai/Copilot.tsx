import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MAX_QUESTION, askAssistant, assistantAvailable } from "../../services/assistant";
import type { AssistantKind } from "../../services/assistant";
import { fetchEnso } from "../../services/enso";
import { fetchRecentRain } from "../../services/recentRain";
import type { RecentRain } from "../../services/recentRain";
import { turnos } from "../../services/turnos";
import { STATE_NAMES, rangeText } from "../../services/turnosRules";
import type { MissionPlan, RobotTestResult } from "../mission/campaign";
import { download, fileSlug } from "../mission/twin";
import type { Season } from "../world/climate";
import type { EnsoData } from "../world/enso";
import type { Match } from "../world/hierarchy";
import { surveyOf } from "../world/lunar";
import { SUGGESTED_QUESTIONS, placeContext } from "./context";
import type { BookingFacts } from "./context";
import "./copilot.css";

interface Exchange {
  id: number;
  kind: AssistantKind;
  /** Lo que se pidió, tal como se muestra. */
  title: string;
  status: "pensando" | "listo" | "error";
  text: string;
  model: string;
}

/** Intercambios que se conservan en pantalla. */
const KEEP = 6;

/** Lo máximo que se espera a los datos en vivo (lluvia, El Niño, turnos) antes de preguntar. */
const WAIT_FACTS_MS = 6000;

interface Props {
  match: Match;
  real: boolean;
  season: Season | null;
  robotTest: RobotTestResult | null;
  plan: MissionPlan | null;
}

interface Live {
  rain: RecentRain | null;
  enso: EnsoData | null;
  booking: BookingFacts | null;
}

/**
 * Copiloto del centro de misión: explica el lugar, responde preguntas y redacta el resumen del
 * plan. La IA solo recibe los datos que ya están en pantalla (`placeContext`) y el servidor le
 * ordena no añadir cifras: explica y redacta, no calcula.
 */
export function Copilot({ match, real, season, robotTest, plan }: Props) {
  const { zone } = match;
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  // La lluvia real, El Niño y el estado de los turnos entran en los datos si llegan a tiempo; si no,
  // la IA no los menciona.
  const live = useRef<Live>({ rain: null, enso: null, booking: null });
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = exchanges.some((exchange) => exchange.status === "pensando");

  // Se resuelve cuando las tres consultas terminaron, bien o mal.
  const ready = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const rain = fetchRecentRain(zone.latitude, zone.longitude)
      .then((value) => !cancelled && (live.current.rain = value))
      .catch(() => undefined);
    const enso = fetchEnso().then((value) => !cancelled && (live.current.enso = value));
    const booking = turnos
      .availability(zone.id)
      .then(({ place, busy }) => {
        if (cancelled) return;
        const state = STATE_NAMES[place.status].toLowerCase();
        live.current.booking = {
          status: !place.bookable ? `no reservable (${state})` : place.permitRequired ? `reservable solo declarando un permiso (${state})` : "reservable",
          reason: place.reason,
          busy: busy.map((range) => rangeText(range.startDate, range.endDate)),
        };
      })
      .catch(() => undefined);
    ready.current = Promise.all([rain, enso, booking]);
    return () => {
      cancelled = true;
    };
  }, [zone.id, zone.latitude, zone.longitude]);

  function ask(kind: AssistantKind, title: string, text?: string) {
    if (busy || !assistantAvailable) return;
    const id = nextId.current++;
    setExchanges((list) => [...list, { id, kind, title, status: "pensando" as const, text: "", model: "" }].slice(-KEEP));
    const settle = (patch: Partial<Exchange>) =>
      setExchanges((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    // Si alguien pregunta nada más abrir, se espera un momento a la lluvia real y a los turnos:
    // sin ellos la respuesta sale incompleta.
    Promise.race([ready.current, new Promise((resolve) => setTimeout(resolve, WAIT_FACTS_MS))])
      .then(() =>
        askAssistant(
          kind,
          placeContext({
            match,
            real,
            elevation: surveyOf(zone.id)?.elevation ?? null,
            season,
            month: new Date().getMonth(),
            rain: live.current.rain,
            enso: live.current.enso,
            booking: live.current.booking,
            robotTest,
            plan: kind === "plan" ? plan : null,
          }),
          text,
        ),
      )
      .then((result) => settle({ status: "listo", text: result.answer, model: result.model }))
      .catch((error: unknown) =>
        settle({ status: "error", text: error instanceof Error ? error.message : "El copiloto no pudo responder." }),
      )
      .finally(() => endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    setQuestion("");
    ask("pregunta", text, text);
  }

  async function copy(exchange: Exchange) {
    try {
      await navigator.clipboard.writeText(exchange.text);
      setCopied(exchange.id);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="copiloto">
      <div className="copiloto-intro">
        <p className="nc-texto-2">
          Pregunta en tus palabras. El copiloto responde con los datos de <strong>{zone.name}</strong> que ya ves en el
          portal: terreno, clima de ahora, suelo, temperatura, turnos y tu prueba del robot.
        </p>
        <div className="copiloto-acciones">
          <button type="button" className="nc-btn primario compacto" disabled={busy || !assistantAvailable} onClick={() => ask("explicar", "Explícame este lugar")}>
            Explícame este lugar
          </button>
          <button
            type="button"
            className="nc-btn secundario compacto"
            disabled={busy || !assistantAvailable || !plan}
            title={plan ? undefined : "Primero genera el plan en «Ventana y plan»"}
            onClick={() => ask("plan", "Redacta el resumen ejecutivo del plan")}
          >
            Redactar el resumen del plan
          </button>
        </div>
        {!plan && <p className="nc-nota">Para el resumen, genera antes el plan en «Ventana y plan».</p>}
        <ul className="copiloto-sugerencias" aria-label="Preguntas sugeridas">
          {SUGGESTED_QUESTIONS.map((text) => (
            <li key={text}>
              <button type="button" disabled={busy || !assistantAvailable} onClick={() => ask("pregunta", text, text)}>
                {text}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {!assistantAvailable && (
        <p className="nc-aviso">
          <b>OJO</b>
          <span>
            El copiloto necesita el servidor de PROMETHEUS: la clave de la IA se guarda ahí y nunca en el navegador. En
            esta demostración sin servidor no está disponible.
          </span>
        </p>
      )}

      <div className="copiloto-charla" aria-live="polite" aria-busy={busy}>
        {exchanges.map((exchange) => (
          <article key={exchange.id} className={`copiloto-turno ${exchange.status}`}>
            <h3>{exchange.title}</h3>
            {exchange.status === "pensando" && <p className="copiloto-espera">Leyendo los datos del lugar…</p>}
            {exchange.status === "error" && <p role="alert">{exchange.text}</p>}
            {exchange.status === "listo" && (
              <>
                <p className="copiloto-respuesta">{exchange.text}</p>
                <footer>
                  <small>
                    Texto de IA{exchange.model && ` (${exchange.model})`} con los datos de esta pantalla. Puede equivocarse:
                    las cifras de las pestañas mandan.
                  </small>
                  <span>
                    <button type="button" onClick={() => copy(exchange)}>
                      {copied === exchange.id ? "Copiado" : "Copiar"}
                    </button>
                    {exchange.kind === "plan" && plan && (
                      <button
                        type="button"
                        onClick={() =>
                          download(
                            `${plan.code}-resumen.txt`,
                            `${plan.mission} · ${zone.name}\nResumen redactado con IA a partir del plan ${plan.code}. Revísalo antes de enviarlo.\n\n${exchange.text}\n`,
                            "text/plain",
                          )
                        }
                      >
                        Descargar (.txt)
                      </button>
                    )}
                    {exchange.kind === "explicar" && (
                      <button
                        type="button"
                        onClick={() =>
                          download(`${fileSlug(zone.name)}-explicacion.txt`, `${zone.name}\nExplicación redactada con IA. Revísala antes de usarla.\n\n${exchange.text}\n`, "text/plain")
                        }
                      >
                        Descargar (.txt)
                      </button>
                    )}
                  </span>
                </footer>
              </>
            )}
          </article>
        ))}
        <div ref={endRef} />
      </div>

      <form className="copiloto-pregunta" onSubmit={submit}>
        <label className="nc-campo">
          <span>Tu pregunta</span>
          <input
            id="copiloto-pregunta"
            value={question}
            maxLength={MAX_QUESTION}
            placeholder="Por ejemplo: ¿aguanta VIPER la pendiente de este lugar?"
            disabled={!assistantAvailable}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <button type="submit" className="nc-btn primario compacto" disabled={busy || !assistantAvailable || !question.trim()}>
          {busy ? "Respondiendo…" : "Preguntar"}
        </button>
      </form>

      <p className="nc-nota">
        Las respuestas las redacta un modelo de IA de Google (Gemini) a través del servidor de PROMETHEUS. Solo recibe
        datos del lugar y del plan; no se envían tu correo, tu nombre ni el de tu institución. La IA explica y redacta:
        no calcula la coincidencia, el clima ni las ruedas, y no decide si un lugar está protegido.
      </p>
    </div>
  );
}
