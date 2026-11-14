import { useEffect, useState } from "react";
import type { View } from "../types/analysis";
import { Landing } from "../features/landing/Landing";
import App from "./App";

/** Cada vista del explorador tiene su dirección; cualquier otra muestra la portada. */
const hashByView: Record<View, string> = {
  explore: "#explorador",
  ranking: "#ranking",
  risks: "#riesgos",
  economy: "#economia",
};

function viewFromHash(): View | null {
  const entry = Object.entries(hashByView).find(([, hash]) => hash === window.location.hash);
  return entry ? (entry[0] as View) : null;
}

/** Mantiene la dirección al día al navegar dentro del explorador, sin añadir pasos al historial. */
function rememberView(view: View) {
  if (window.location.hash !== hashByView[view]) {
    window.history.replaceState(null, "", hashByView[view]);
  }
}

export default function Root() {
  const [view, setView] = useState<View | null>(viewFromHash);
  // La Luna es el primer alcance: la portada abre con un escenario lunar como referencia.
  const [regionId, setRegionId] = useState("tranquillitatis");
  const inApp = view !== null;

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (inApp) window.scrollTo(0, 0);
  }, [inApp]);

  if (view === null) {
    return <Landing regionId={regionId} onRegionChange={setRegionId} />;
  }
  return (
    <App
      key={view}
      initialView={view}
      initialRegionId={regionId}
      onViewChange={rememberView}
      onRegionChange={setRegionId}
    />
  );
}
