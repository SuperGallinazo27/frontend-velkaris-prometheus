import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./styles/nocturno.css";
import Root from "./app/Root";
import { initLanguage } from "./i18n/language";
// Después de las pantallas: el tema claro de las cuentas reemplaza los colores del nocturno.
import "./styles/claro.css";
initLanguage();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
