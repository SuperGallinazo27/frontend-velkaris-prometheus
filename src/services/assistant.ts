/**
 * Copiloto de PROMETHEUS: preguntas en lenguaje llano sobre un lugar o un plan, respondidas por
 * un modelo de IA (Gemini) con los datos que ya muestra la pantalla.
 *
 * - La consulta va al backend (`POST /api/v1/assistant/ask`), que guarda la clave de IA. La clave
 *   nunca llega al navegador, así que sin servidor (`VITE_API_BASE_URL`) no hay copiloto.
 * - Solo se envían datos del lugar y del plan. No viajan el correo ni el nombre de quien pregunta.
 * - La IA explica y redacta; no calcula. Los números salen siempre de los datos.
 */
import { getLanguage } from "../i18n/language";
import { TOKEN_KEY } from "./authHttp";

export type AssistantKind = "explicar" | "pregunta" | "plan";

export interface AssistantAnswer {
  answer: string;
  /** Modelo que escribió la respuesta. */
  model: string;
}

/** Lo que cabe en una pregunta; el servidor aplica el mismo límite. */
export const MAX_QUESTION = 600;

export type AssistantErrorCode = "sin-servidor" | "sin-sesion" | "sin-configurar" | "limite" | "servidor";

export class AssistantError extends Error {
  code: AssistantErrorCode;
  constructor(code: AssistantErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const CODES: Record<string, AssistantErrorCode> = {
  not_authenticated: "sin-sesion",
  session_expired: "sin-sesion",
  assistant_not_configured: "sin-configurar",
  assistant_limit: "limite",
  assistant_quota: "limite",
};

const apiBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim();

/** false en la demostración sin servidor: ahí el copiloto explica por qué no está. */
export const assistantAvailable = Boolean(apiBase);

function storedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function askAssistant(
  kind: AssistantKind,
  context: Record<string, unknown>,
  question?: string,
  options: { fetcher?: typeof fetch; base?: string; token?: string | null } = {},
): Promise<AssistantAnswer> {
  const base = options.base ?? apiBase;
  if (!base) {
    throw new AssistantError("sin-servidor", "El copiloto necesita el servidor de PROMETHEUS: ahí vive la clave de IA.");
  }
  const token = options.token === undefined ? storedToken() : options.token;
  if (!token) throw new AssistantError("sin-sesion", "Inicia sesión de nuevo para usar el copiloto.");

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${base.replace(/\/+$/, "")}/api/v1/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // Con la interfaz en inglés, el copiloto responde en inglés (el servidor lo lee del contexto).
      body: JSON.stringify({
        kind,
        question: question?.trim() || null,
        context: getLanguage() === "en" ? { ...context, idioma_de_respuesta: "inglés" } : context,
      }),
    });
  } catch {
    throw new AssistantError("servidor", "No se pudo conectar con el servidor. Revisa que esté encendido e inténtalo de nuevo.");
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Respuesta vacía o que no es JSON: se trata abajo según el estado.
  }
  if (!response.ok) {
    const detail = (data as { detail?: { code?: string; message?: string } } | null)?.detail;
    const code = CODES[detail?.code ?? ""] ?? "servidor";
    // Un servidor antiguo, sin copiloto, responde 404 sin mensaje propio.
    const fallback =
      response.status === 404
        ? "Este servidor aún no tiene el copiloto: hay que reiniciar la API con la versión nueva."
        : "El copiloto no pudo responder. Inténtalo de nuevo.";
    throw new AssistantError(code, detail?.message ?? fallback);
  }
  const answer = (data as Partial<AssistantAnswer> | null)?.answer;
  const model = (data as Partial<AssistantAnswer> | null)?.model;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new AssistantError("servidor", "El copiloto devolvió una respuesta vacía. Inténtalo de nuevo.");
  }
  return { answer: answer.trim(), model: typeof model === "string" ? model : "" };
}
