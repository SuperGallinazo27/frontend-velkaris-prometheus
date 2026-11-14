export interface Terrain {
  id: string;
  name: string;
  context: string;
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
