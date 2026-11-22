import { Suspense, lazy, useEffect, useState } from "react";
import { Admin } from "../features/admin/Admin";
import { Login } from "../features/auth/Login";
import type { LoginNotice } from "../features/auth/Login";
import { Registro } from "../features/auth/Registro";
import { Landing } from "../features/landing/Landing";
import { MisTurnos } from "../features/turnos/MisTurnos";
import { useSession, useSessionPending } from "../services/session";
import { guard, hashOf, parseHash } from "./routes";

// El mundo interactivo trae Three.js y el mapa de países: se descarga solo al abrirlo.
const World = lazy(() => import("../features/world/World"));
// El hangar trae Three.js y los modelos 3D de los robots: también se descarga solo al abrirlo.
const Hangar = lazy(() => import("../features/hangar/Hangar"));

export default function Root() {
  const [requested, setRequested] = useState(() => parseHash(window.location.hash));
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const user = useSession();
  // Con una sesión guardada, hasta que el servidor responde no se sabe si hay que pedir el ingreso.
  const restoring = useSessionPending();
  // La pantalla que corresponde a la dirección pedida y a la sesión: sin permiso, se redirige.
  const route = restoring ? requested : guard(requested, user);
  const hash = hashOf(route);
  const screen = route.screen;

  useEffect(() => {
    const onHashChange = () => setRequested(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // La dirección refleja la pantalla que de verdad se muestra.
  useEffect(() => {
    if (route !== requested) window.location.replace(hash);
  }, [route, requested, hash]);

  useEffect(() => {
    // Las pantallas de cuentas y de turnos usan el tema claro; la portada y el mundo, el nocturno (el espacio).
    const light = screen === "login" || screen === "registro" || screen === "admin" || screen === "turnos";
    document.documentElement.classList.toggle("modo-claro", light);
    document.documentElement.classList.toggle("modo-nocturno", !light);
    if (screen !== "landing") window.scrollTo(0, 0);
  }, [screen]);

  if (restoring && screen !== "landing" && screen !== "login") {
    return <div className="nocturno pantalla-carga">Recuperando tu sesión…</div>;
  }

  switch (route.screen) {
    case "landing":
      return <Landing />;
    case "login":
      return <Login key={notice?.email ?? "ingreso"} notice={notice} />;
    case "registro":
      return (
        <Registro
          user={user!}
          onDone={(email) =>
            setNotice({ email, message: "Registro completo. Ingresa con tu nueva clave para abrir el mundo interactivo." })
          }
        />
      );
    case "admin":
      return <Admin user={user!} />;
    case "turnos":
      return <MisTurnos user={user!} />;
    case "mundo":
      return (
        <Suspense fallback={<div className="nocturno pantalla-carga">Cargando el mundo interactivo…</div>}>
          <World user={user!} />
        </Suspense>
      );
    case "hangar":
      return (
        <Suspense fallback={<div className="nocturno pantalla-carga">Abriendo el hangar…</div>}>
          <Hangar user={user!} />
        </Suspense>
      );
  }
}
