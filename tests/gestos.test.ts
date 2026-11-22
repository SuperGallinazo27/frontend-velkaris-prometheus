import { describe, expect, test } from "bun:test";
import {
  HOLO_HANDS_CLOSED,
  HOLO_HANDS_OPEN,
  HOLO_POINT_HOLD_MS,
  HOLO_YAW_GAIN,
  STEER_DEAD,
  STEER_FULL,
  Steady,
  driveDelay,
  driveFromHand,
  emptyHoloTrack,
  fingersUp,
  holoFromHands,
  mainHand,
  poseFromFingers,
  poseOf,
  readHand,
  steerFromTilt,
} from "../src/features/gestos/gestures";
import type { HandPose, HandReading, Pt } from "../src/features/gestos/gestures";

const DEG = Math.PI / 180;
const ASPECT = 4 / 3;

/**
 * Una mano dibujada con números: la muñeca en el origen, los nudillos una «palma» más arriba y cada
 * dedo recto o doblado hacia la palma. Devuelve los puntos «del mundo» y los de la imagen de la
 * cámara (sin espejar), con la mano inclinada `tilt` hacia la izquierda de quien la mueve.
 */
function hand(fingers: [boolean, boolean, boolean, boolean], options: { tilt?: number; x?: number; y?: number; scale?: number } = {}) {
  const { tilt = 0, x = 0.5, y = 0.6, scale = 0.12 } = options;
  const model: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  // Pulgar, hacia un lado.
  [1, 2, 3, 4].forEach((k, i) => (model[k] = { x: -0.5 - i * 0.22, y: 0.35 + i * 0.12, z: 0 }));
  // El nudillo del dedo medio queda justo sobre la muñeca: esa línea es el eje de la mano.
  [-0.3, 0, 0.3, 0.6].forEach((knuckle, finger) => {
    const base = 5 + finger * 4;
    model[base] = { x: knuckle, y: 1, z: 0 };
    if (fingers[finger]) {
      model[base + 1] = { x: knuckle, y: 1.45, z: 0 };
      model[base + 2] = { x: knuckle, y: 1.8, z: 0 };
      model[base + 3] = { x: knuckle, y: 2.1, z: 0 };
    } else {
      // Doblado: sale del nudillo y vuelve hacia la palma.
      model[base + 1] = { x: knuckle, y: 1.3, z: 0.25 };
      model[base + 2] = { x: knuckle, y: 1.05, z: 0.4 };
      model[base + 3] = { x: knuckle, y: 0.8, z: 0.3 };
    }
  });
  const world = model.map((p) => ({ x: p.x * 0.08, y: p.y * 0.08, z: (p.z ?? 0) * 0.08 }));
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const image = model.map((p) => ({
    x: x + ((p.x * cos + p.y * sin) * scale) / ASPECT,
    y: y - (-p.x * sin + p.y * cos) * scale,
  }));
  return { world, image };
}

const OPEN: [boolean, boolean, boolean, boolean] = [true, true, true, true];
const FIST: [boolean, boolean, boolean, boolean] = [false, false, false, false];
const PEACE: [boolean, boolean, boolean, boolean] = [true, true, false, false];
const POINT: [boolean, boolean, boolean, boolean] = [true, false, false, false];

const reading = (pose: HandPose, extra: Partial<HandReading> = {}): HandReading => ({ pose, tilt: 0, x: 0.5, y: 0.5, size: 0.15, ...extra });

describe("forma de la mano", () => {
  test("cuenta los dedos estirados sin importar el pulgar", () => {
    expect(fingersUp(hand(OPEN).world)).toEqual([true, true, true, true]);
    expect(fingersUp(hand(PEACE).world)).toEqual([true, true, false, false]);
    expect(fingersUp([])).toEqual([false, false, false, false]);
  });

  test("reconoce mano abierta, puño, dos dedos y señalar", () => {
    expect(poseFromFingers(hand(OPEN).world)).toBe("abierta");
    expect(poseFromFingers(hand(FIST).world)).toBe("puno");
    expect(poseFromFingers(hand(PEACE).world)).toBe("paz");
    expect(poseFromFingers(hand(POINT).world)).toBe("senalar");
    expect(poseFromFingers(hand([true, false, false, true]).world)).toBe("otra");
  });

  test("le cree al clasificador solo cuando está seguro y conoce el gesto", () => {
    const open = hand(OPEN).world;
    expect(poseOf(open, { name: "Closed_Fist", score: 0.9 })).toBe("puno");
    expect(poseOf(open, { name: "Closed_Fist", score: 0.3 })).toBe("abierta");
    expect(poseOf(open, { name: "None", score: 0.95 })).toBe("abierta");
    expect(poseOf(open, { name: "Thumb_Up", score: 0.95 })).toBe("abierta");
    expect(poseOf(open, null)).toBe("abierta");
  });
});

describe("lectura de una mano", () => {
  test("la inclinación es positiva hacia la izquierda de quien conduce y mide el ángulo real", () => {
    for (const degrees of [-40, -15, 0, 20, 35]) {
      const { image, world } = hand(OPEN, { tilt: degrees * DEG });
      expect(readHand(image, world, ASPECT)!.tilt / DEG).toBeCloseTo(degrees, 4);
    }
  });

  test("la posición sale como en un espejo y el tamaño crece al acercar la mano", () => {
    // En la imagen sin espejar, x = 0,8 es la izquierda de quien mira: en el espejo queda a la izquierda.
    const left = hand(OPEN, { x: 0.8 });
    const read = readHand(left.image, left.world, ASPECT)!;
    expect(read.x).toBeLessThan(0.3);
    const near = hand(OPEN, { scale: 0.24 });
    expect(readHand(near.image, near.world, ASPECT)!.size).toBeCloseTo(read.size * 2, 5);
    expect(readHand([], [], ASPECT)).toBeNull();
  });

  test("de varias manos manda la más cercana", () => {
    expect(mainHand([])).toBeNull();
    expect(mainHand([reading("puno", { size: 0.1 }), reading("abierta", { size: 0.2 })])!.pose).toBe("abierta");
  });
});

describe("conducir con la mano", () => {
  test("el volante tiene zona muerta, tope y signo", () => {
    expect(steerFromTilt(0)).toBe(0);
    expect(steerFromTilt(STEER_DEAD * 0.9)).toBe(0);
    expect(steerFromTilt(STEER_FULL)).toBe(1);
    expect(steerFromTilt(-STEER_FULL * 2)).toBe(-1);
    const half = steerFromTilt((STEER_DEAD + STEER_FULL) / 2);
    expect(half).toBeCloseTo(0.5, 6);
    expect(steerFromTilt(-(STEER_DEAD + STEER_FULL) / 2)).toBeCloseTo(-0.5, 6);
  });

  test("mano abierta avanza, dos dedos retroceden, puño frena y sin mano se detiene", () => {
    expect(driveFromHand(reading("abierta"))).toEqual({ throttle: 1, steer: 0, state: "avanza" });
    expect(driveFromHand(reading("abierta", { tilt: STEER_FULL }))).toMatchObject({ throttle: 1, steer: 1 });
    expect(driveFromHand(reading("paz", { tilt: -STEER_FULL }))).toEqual({ throttle: -1, steer: -1, state: "atras" });
    expect(driveFromHand(reading("puno", { tilt: STEER_FULL }))).toEqual({ throttle: 0, steer: 0, state: "frena" });
    expect(driveFromHand(reading("otra"))).toMatchObject({ throttle: 0, state: "espera" });
    expect(driveFromHand(null)).toEqual({ throttle: 0, steer: 0, state: "sin-mano" });
  });

  test("un gesto de paso no cuenta; frenar es casi inmediato", () => {
    const filter = new Steady<HandPose | null>(null, driveDelay);
    expect(filter.update("abierta", 0)).toBeNull();
    expect(filter.update("abierta", 100)).toBeNull();
    expect(filter.update("abierta", 150)).toBe("abierta");
    // Una lectura suelta sin reconocer no detiene el robot.
    expect(filter.update("otra", 200)).toBe("abierta");
    expect(filter.update("abierta", 240)).toBe("abierta");
    // El puño sí, en un instante.
    expect(filter.update("puno", 300)).toBe("abierta");
    expect(filter.update("puno", 365)).toBe("puno");
    // Perder la mano tarda algo más que frenar, pero detiene.
    filter.update("abierta", 400);
    filter.update("abierta", 560);
    expect(filter.update(null, 600)).toBe("abierta");
    expect(filter.update(null, 900)).toBeNull();
    expect(driveDelay("puno")).toBeLessThan(driveDelay("abierta"));
  });
});

describe("mover el holograma con las manos", () => {
  test("una mano abierta lo gira lo que se desplaza, sin saltos al aparecer", () => {
    let track = emptyHoloTrack();
    let yaw = 0;
    // Aparece en 0,3: todavía no gira.
    let step = holoFromHands([reading("abierta", { x: 0.3 })], track, 0);
    expect(step.command.yaw).toBe(0);
    track = step.track;
    // Se mueve hasta 0,5 y se queda: el giro total tiende a 0,2 × la ganancia.
    for (let frame = 1; frame <= 40; frame++) {
      step = holoFromHands([reading("abierta", { x: 0.5 })], track, frame * 40);
      yaw += step.command.yaw;
      track = step.track;
      expect(step.command.state).toBe("girar");
    }
    // Lo que falta es menos que el umbral de ruido, que corta el final del acercamiento.
    expect(yaw).toBeGreaterThan(0.2 * HOLO_YAW_GAIN * 0.97);
    expect(yaw).toBeLessThanOrEqual(0.2 * HOLO_YAW_GAIN + 1e-9);
  });

  test("el puño lo suelta: al volver a abrir la mano en otro sitio no gira de golpe", () => {
    let step = holoFromHands([reading("abierta", { x: 0.2 })], emptyHoloTrack(), 0);
    step = holoFromHands([reading("puno", { x: 0.8 })], step.track, 40);
    expect(step.command.state).toBe("pausa");
    expect(step.track.last).toBeNull();
    step = holoFromHands([reading("abierta", { x: 0.8 })], step.track, 80);
    expect(step.command.yaw).toBe(0);
  });

  test("dos manos: separarlas desarma y juntarlas arma", () => {
    const at = (gap: number) =>
      holoFromHands([reading("abierta", { x: 0.5 - gap / 2 }), reading("abierta", { x: 0.5 + gap / 2 })], emptyHoloTrack(), 0).command;
    expect(at(HOLO_HANDS_CLOSED - 0.05).explode).toBe(0);
    expect(at(HOLO_HANDS_OPEN + 0.1).explode).toBe(1);
    expect(at((HOLO_HANDS_CLOSED + HOLO_HANDS_OPEN) / 2).explode).toBeCloseTo(0.5, 6);
    expect(at(0.4).state).toBe("desarmar");
    // Con una sola mano no se toca cuánto está desarmado.
    expect(holoFromHands([reading("abierta")], emptyHoloTrack(), 0).command.explode).toBeNull();
  });

  test("señalar un instante pasa de componente una sola vez por gesto", () => {
    let track = emptyHoloTrack();
    let fired = 0;
    for (let now = 0; now <= HOLO_POINT_HOLD_MS * 3; now += 50) {
      const step = holoFromHands([reading("senalar")], track, now);
      if (step.command.next) fired++;
      track = step.track;
    }
    expect(fired).toBe(1);
    // Soltar el gesto y repetirlo vuelve a contar.
    track = holoFromHands([reading("abierta")], track, 5000).track;
    let again = 0;
    for (let now = 5100; now <= 5100 + HOLO_POINT_HOLD_MS + 100; now += 50) {
      const step = holoFromHands([reading("senalar")], track, now);
      if (step.command.next) again++;
      track = step.track;
    }
    expect(again).toBe(1);
  });

  test("sin manos no hay orden y se olvida la posición", () => {
    const step = holoFromHands([], { last: { x: 0.4, y: 0.4 }, pointSince: 10, pointFired: true }, 100);
    expect(step.command).toMatchObject({ yaw: 0, pitch: 0, explode: null, next: false, state: "sin-mano" });
    expect(step.track).toEqual(emptyHoloTrack());
  });
});
