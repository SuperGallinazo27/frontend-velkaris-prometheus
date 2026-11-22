/**
 * Componentes de cada robot del hangar: los mismos nombres para el holograma (qué piezas se
 * separan) y para los datos (qué es cada una y en qué misiones voló).
 *
 * Solo tienen holograma los robots con forma 3D: Perseverance y Curiosity (modelos oficiales de
 * NASA) y VIPER y el carro lunar (formas simplificadas con sus medidas publicadas).
 */

export type HoloRobotId = "perseverance" | "curiosity" | "viper" | "lrv";

export const HOLO_ROBOTS: readonly HoloRobotId[] = ["perseverance", "curiosity", "viper", "lrv"];

export const isHoloRobot = (id: string): id is HoloRobotId => (HOLO_ROBOTS as readonly string[]).includes(id);

/** Orden en que se listan los componentes de cada robot. */
export const ROBOT_PARTS: Record<HoloRobotId, readonly string[]> = {
  perseverance: ["ruedas", "suspension", "cuerpo", "mastil", "brazo", "torreta", "rtg", "antenas", "hazcams", "rimfax"],
  curiosity: ["ruedas", "suspension", "cuerpo", "mastil", "brazo", "torreta", "rtg", "antenas", "hazcams"],
  viper: ["ruedas", "suspension", "cuerpo", "radiador", "paneles", "mastil", "antena", "taladro", "instrumentos"],
  lrv: ["ruedas", "suspension", "bastidor", "asientos", "consola", "baterias", "antena", "camara", "herramientas", "guardabarros"],
};
