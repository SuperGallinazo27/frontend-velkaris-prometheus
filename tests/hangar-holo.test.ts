import { describe, expect, test } from "bun:test";
import { EXPLODE_RULES, approach, ease, explodeOffset, fitDistance, representative, robotScale } from "../src/features/hangar/holoMath";
import type { Box } from "../src/features/hangar/holoMath";
import { HOLO_ROBOTS, ROBOT_PARTS } from "../src/features/hangar/parts";
import { curiosityPiece, perseverancePiece, suspensionSide } from "../src/features/mission/robotModels";

/** Un robot de 3 × 2 × 2,6 m apoyado en el suelo, centrado. */
const ROBOT: Box = { min: [-1.5, 0, -1.3], max: [1.5, 2, 1.3] };

describe("despiece del holograma", () => {
  test("una pieza se aleja del centro, más cuanto más lejos está", () => {
    const near = explodeOffset({ min: [0.3, 1, -0.1], max: [0.5, 1.2, 0.1] }, ROBOT, undefined);
    const far = explodeOffset({ min: [1.2, 1, -0.1], max: [1.4, 1.2, 0.1] }, ROBOT, undefined);
    expect(near[0]).toBeGreaterThan(0);
    expect(far[0]).toBeGreaterThan(near[0]);
    // Lo que está por encima del centro del despiece (un tercio de la altura) sube.
    expect(near[1]).toBeGreaterThan(0);
    expect(Math.abs(near[2])).toBeLessThan(1e-9);
  });

  test("lo que toca el suelo se abre hacia fuera, pero no se entierra", () => {
    const wheel = explodeOffset({ min: [0.9, 0, 1.0], max: [1.4, 0.5, 1.3] }, ROBOT, { radial: 1.25 });
    expect(wheel[1]).toBe(0);
    expect(wheel[0]).toBeGreaterThan(0.4);
    expect(wheel[2]).toBeGreaterThan(0.4);
    // Una pieza baja que no toca el suelo puede bajar, pero solo hasta apoyarse.
    const low = explodeOffset({ min: [-0.2, 0.1, -0.2], max: [0.2, 0.3, 0.2] }, ROBOT, { bias: [0, -1, 0] });
    expect(low[1]).toBeCloseTo(-0.1, 9);
  });

  test("el empujón propio se escala con el tamaño del robot", () => {
    const piece: Box = { min: [-0.2, 0.9, -0.2], max: [0.2, 1.1, 0.2] };
    const small: Box = { min: [-0.75, 0, -0.65], max: [0.75, 1, 0.65] };
    expect(robotScale(ROBOT)).toBeCloseTo(1, 9);
    expect(robotScale(small)).toBeCloseTo(0.5, 9);
    const big = explodeOffset(piece, ROBOT, { radial: 0, bias: [0, 1, 0] });
    const half = explodeOffset({ min: [-0.1, 0.45, -0.1], max: [0.1, 0.55, 0.1] }, small, { radial: 0, bias: [0, 1, 0] });
    expect(big[1]).toBeCloseTo(1, 9);
    expect(half[1]).toBeCloseTo(0.5, 9);
  });

  test("las reglas solo nombran componentes que existen", () => {
    for (const robot of HOLO_ROBOTS) {
      for (const part of Object.keys(EXPLODE_RULES[robot])) expect(ROBOT_PARTS[robot], `${robot}: ${part}`).toContain(part);
    }
  });

  test("la etiqueta va siempre en la misma pieza: la de la derecha, delante y arriba", () => {
    const wheels = [
      [1.1, 0.26, 1.06],
      [1.1, 0.26, -1.06],
      [-1.1, 0.26, 1.06],
      [-1.1, 0.26, -1.06],
    ] as const;
    expect(representative(wheels)).toBe(0);
    expect(representative([wheels[3], wheels[2], wheels[1], wheels[0]])).toBe(3);
    expect(representative([[0, 0, 0]])).toBe(0);
  });

  test("la cámara se aleja lo justo para que el robot quepa, también en vertical", () => {
    const wide = fitDistance(2, 34, 16 / 9);
    const tall = fitDistance(2, 34, 9 / 16);
    expect(wide).toBeCloseTo(2 / Math.sin((17 * Math.PI) / 180), 6);
    expect(tall).toBeGreaterThan(wide);
  });

  test("las animaciones llegan a su destino sin pasarse", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 9);
    expect(ease(2)).toBe(1);
    let value = 0;
    for (let i = 0; i < 120; i++) value = approach(value, 1, 6, 1 / 60);
    expect(value).toBeGreaterThan(0.999);
    expect(value).toBeLessThanOrEqual(1);
    // Con cuadros más lentos avanza lo mismo en el mismo tiempo.
    expect(approach(approach(0, 1, 6, 0.05), 1, 6, 0.05)).toBeCloseTo(approach(0, 1, 6, 0.1), 9);
  });
});

describe("piezas del modelo oficial del Perseverance", () => {
  const part = (name: string) => perseverancePiece(name).part;

  test("cada nodo va a su componente, con el nombre original o con el que deja el cargador", () => {
    expect(part("suspension")).toBe("suspension");
    expect(part("rtg")).toBe("rtg");
    expect(part("RIMFAX")).toBe("rimfax");
    expect(part("turret_obj")).toBe("torreta");
    for (const name of ["arm", "arm.001", "arm.003", "arm001", "arm003", "arm_cable_etc"]) expect(part(name), name).toBe("brazo");
    for (const name of ["antenna_hg", "antenna_lg", "antenna_uhf"]) expect(part(name), name).toBe("antenas");
    for (const name of ["hazcams_front", "hazcams_front_cover", "hazcams_rear_cover_l", "hazcams_rear_wiring"]) expect(part(name), name).toBe("hazcams");
    for (const name of ["head", "bottom", "base"]) expect(part(name), name).toBe("mastil");
  });

  test("las tres antenas y las cámaras de delante y de detrás son piezas distintas", () => {
    const pieces = new Set(["antenna_hg", "antenna_lg", "antenna_uhf"].map((name) => perseverancePiece(name).piece));
    expect(pieces.size).toBe(3);
    expect(perseverancePiece("hazcams_front").piece).not.toBe(perseverancePiece("hazcams_rear").piece);
    expect(perseverancePiece("hazcams_rear").piece).toBe(perseverancePiece("hazcams_rear_cover_r").piece);
  });

  test("lo que no es claramente de otro componente se queda en el cuerpo", () => {
    // Los brazos de la panza («arm_01», «arm_02») no son el brazo robótico.
    for (const name of ["Body", "Body_Parts", "lab", "box", "bottom.001", "bottom001", "arm_01_joint", "arm_02_joint", "Name_Chips", "Up_Look_Camera", "nombre_nuevo"]) {
      expect(part(name), name).toBe("cuerpo");
    }
  });

  test("la suspensión se reparte por lados; lo que cruza se queda en el centro", () => {
    expect(suspensionSide([1.0, 0.6, 0.2], [0.3, 0.8, 2.2]).piece).toBe("suspension-izquierda");
    expect(suspensionSide([-1.0, 0.6, 0.2], [0.3, 0.8, 2.2]).piece).toBe("suspension-derecha");
    expect(suspensionSide([0, 1.1, 0], [2.0, 0.1, 0.1]).piece).toBe("suspension-centro");
    expect(suspensionSide([0.3, 1.1, 0], [1.0, 0.1, 0.1]).piece).toBe("suspension-centro");
    expect(suspensionSide([1, 0, 0], [0.1, 0.1, 0.1]).part).toBe("suspension");
  });
});

describe("zonas del modelo oficial del Curiosity", () => {
  const SMALL = [0.15, 0.15, 0.15] as const;
  const part = (x: number, y: number, z: number, size: readonly [number, number, number] = SMALL) => curiosityPiece([x, y, z], size).part;

  test("mástil, brazo, torreta y generador, por su zona", () => {
    // Columna y cabeza del mástil.
    expect(part(-0.55, 1.45, 0.72)).toBe("mastil");
    expect(part(-0.39, 1.98, 0.77)).toBe("mastil");
    // El pie del mástil, al ras de la cubierta, se queda con el cuerpo.
    expect(part(-0.55, 1.12, 0.72)).toBe("cuerpo");
    // Tramos del brazo y su hombro.
    expect(part(0.46, 1.24, 2.1)).toBe("brazo");
    expect(part(0.25, 0.84, 1.69)).toBe("brazo");
    expect(part(0.46, 0.88, 1.12)).toBe("brazo");
    // El racimo de instrumentos, arriba y delante.
    expect(part(0.44, 1.91, 1.93)).toBe("torreta");
    expect(part(0.0, 1.16, -1.2)).toBe("rtg");
  });

  test("las tres antenas son piezas distintas", () => {
    const uhf = curiosityPiece([-0.5, 1.7, -1.08], SMALL);
    const low = curiosityPiece([0.53, 1.43, -1.09], SMALL);
    const high = curiosityPiece([0.42, 1.39, -0.26], SMALL);
    for (const antenna of [uhf, low, high]) expect(antenna.part).toBe("antenas");
    expect(new Set([uhf.piece, low.piece, high.piece]).size).toBe(3);
  });

  test("la suspensión va por lados; lo ancho que cruza el cuerpo no es suspensión", () => {
    expect(curiosityPiece([1.04, 0.67, 1.1], SMALL).piece).toBe("suspension-izquierda");
    expect(curiosityPiece([-0.92, 0.65, -0.54], SMALL).piece).toBe("suspension-derecha");
    expect(part(0.73, 0.89, 0.22)).toBe("suspension");
    // Un actuador junto a la rueda delantera izquierda no es el hombro del brazo.
    expect(part(0.7, 0.52, 1.09)).toBe("suspension");
    // Las grandes carcasas del cuerpo, centradas.
    expect(part(0, 1.05, -0.17, [1.52, 0.76, 2.01])).toBe("cuerpo");
    expect(part(0, 1.28, -0.17, [1.33, 0.3, 2.01])).toBe("cuerpo");
  });

  test("lo dudoso se queda en el cuerpo", () => {
    // Cajas del frente, bajo la cubierta, a la derecha: no se sabe si son cámaras.
    expect(part(-0.15, 0.8, 1.11)).toBe("cuerpo");
    expect(part(-0.48, 0.71, 1.13)).toBe("cuerpo");
    // Piezas sueltas sobre la cubierta que no son antena ni mástil.
    expect(part(0.15, 1.13, 0.67)).toBe("cuerpo");
    expect(part(-0.16, 1.15, -0.61)).toBe("cuerpo");
  });
});
