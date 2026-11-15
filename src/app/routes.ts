import type { User } from "../services/auth";

/** Pantallas de la aplicación. Cada una tiene su dirección; cualquier otra muestra la portada. */
export type Route =
  | { screen: "landing" }
  | { screen: "login" }
  | { screen: "registro" }
  | { screen: "admin" }
  | { screen: "mundo" }
  | { screen: "turnos" };

const hashByScreen = {
  login: "#ingresar",
  registro: "#registro",
  admin: "#admin",
  mundo: "#mundo",
  turnos: "#turnos",
} as const;

export function parseHash(hash: string): Route {
  const screen = (Object.keys(hashByScreen) as (keyof typeof hashByScreen)[]).find(
    (s) => hashByScreen[s] === hash,
  );
  return screen ? { screen } : { screen: "landing" };
}

export function hashOf(route: Route): string {
  if (route.screen === "landing") return "#inicio";
  return hashByScreen[route.screen];
}

/** Pantalla propia de cada cuenta al entrar. */
export function homeFor(user: User): Route {
  if (user.status === "pendiente") return { screen: "registro" };
  return { screen: user.role === "admin" ? "admin" : "mundo" };
}

/**
 * Pantalla que realmente se muestra para una dirección y una sesión.
 * Devuelve la misma ruta si está permitida, o aquella a la que hay que redirigir.
 */
export function guard(route: Route, user: User | null): Route {
  switch (route.screen) {
    case "landing":
      return route;
    case "login":
      return user ? homeFor(user) : route;
    case "registro":
      if (!user) return { screen: "login" };
      return user.status === "pendiente" ? route : homeFor(user);
    case "admin":
      if (!user) return { screen: "login" };
      return user.role === "admin" ? route : homeFor(user);
    case "mundo":
      if (!user) return { screen: "login" };
      return user.status === "pendiente" ? homeFor(user) : route;
    case "turnos":
      // «Mis turnos» es de las agencias; el administrador gestiona los de todas en su panel.
      if (!user) return { screen: "login" };
      return user.status === "pendiente" || user.role === "admin" ? homeFor(user) : route;
  }
}
