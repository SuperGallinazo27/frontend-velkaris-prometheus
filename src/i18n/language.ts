/**
 * Idioma de la interfaz: español (el original) o inglés.
 *
 * La elección se guarda en el navegador y vale para todas las pestañas abiertas (el ingreso se abre
 * en otra). El diccionario de inglés solo se descarga cuando alguien elige inglés.
 */
import { COUNTRIES } from "../services/countries";
import { startTranslating, stopTranslating } from "./dom";
import { createTranslator } from "./translator";
import type { Dictionary, Translator } from "./translator";

export type Language = "es" | "en";

const KEY = "prometheus.idioma";
const listeners = new Set<() => void>();
let current: Language = "es";
let translator: Translator | null = null;

function saved(): Language {
  try {
    return localStorage.getItem(KEY) === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

/** Los países salen del propio navegador (CLDR), igual que sus nombres en español. */
function countryNames(): Record<string, string> {
  const names: Record<string, string> = {};
  try {
    const english = new Intl.DisplayNames(["en"], { type: "region" });
    for (const c of COUNTRIES) {
      const en = english.of(c.code);
      if (en && en !== c.name) names[c.name] = en;
    }
  } catch {
    // Sin Intl.DisplayNames los países quedan en español.
  }
  return names;
}

async function loadTranslator(): Promise<Translator> {
  if (translator) return translator;
  const dictionary = (await import("./en.json")).default as unknown as Dictionary;
  translator = createTranslator({
    exact: { ...countryNames(), ...dictionary.exact },
    templates: dictionary.templates,
    phrases: dictionary.phrases,
  });
  return translator;
}

export function getLanguage(): Language {
  return current;
}

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function apply(next: Language) {
  if (next === "en") {
    const t = await loadTranslator();
    // Si mientras tanto se volvió a elegir español, no se aplica.
    if (current !== "en") return;
    startTranslating(t);
  } else {
    stopTranslating();
  }
  document.documentElement.lang = next;
}

export function setLanguage(next: Language) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Sin almacenamiento, el idioma dura lo que la pestaña.
  }
  listeners.forEach((l) => l());
  void apply(next);
}

/** Al arrancar: aplica el idioma guardado y escucha los cambios hechos en otras pestañas. */
export function initLanguage() {
  const start = saved();
  if (start === "en") setLanguage("en");
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) setLanguage(e.newValue === "en" ? "en" : "es");
  });
}
