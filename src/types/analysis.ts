/** Mundo al que pertenece una región: la Luna y Marte son referencias; la Tierra aporta los candidatos. */
export type World = "Luna" | "Marte" | "Tierra";
export interface Terrain {
  id: string;
  name: string;
  context: string;
  world: World;
  relief: number;
  slope: number;
  roughness: number;
  latitude: number;
  longitude: number;
}
export type View = "explore" | "ranking" | "risks" | "economy";
export interface RankedSite {
  site: Terrain;
  distance: number;
  rank: number;
}
