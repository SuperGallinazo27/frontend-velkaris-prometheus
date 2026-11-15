import { useSyncExternalStore } from "react";
import { getLanguage, setLanguage, subscribeLanguage } from "../i18n/language";

/** Interruptor ES / EN. Cambia el idioma de la interfaz sin recargar ni tocar lo demás. */
export function LanguageSwitch() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  return (
    <div className="idioma" role="group" aria-label="Idioma · Language" data-sin-traducir>
      <button type="button" lang="es" aria-pressed={language === "es"} onClick={() => setLanguage("es")} title="Español">
        ES
      </button>
      <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")} title="English">
        EN
      </button>
    </div>
  );
}
