/**
 * La base del proyector sobre la que se arma el holograma: anillos con marcas, dos anillos de
 * trazos que giran despacio, una rejilla que se pierde en lo oscuro, una cortina de luz que sube
 * del anillo y unas motas que flotan. Todo es luz sumada sobre el fondo: no tapa al robot.
 */
import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Mesh, PlaneGeometry, Points } from "three";
import { HOLO_TEAL, coneMaterial, moteMaterial, stageMaterial } from "./holoMaterials";
import type { StageUniforms } from "./holoMaterials";

export interface HoloStage {
  group: Group;
  /** Ajusta la base al tamaño del robot: `radius` es el radio del anillo principal, m. */
  fit(radius: number, height: number): void;
  /** Avanza el giro de los anillos y las motas. */
  step(time: number): void;
  /** Tamaño de las motas según el alto de la pantalla, px. */
  resize(heightPx: number): void;
  dispose(): void;
}

const MOTES = 110;

export function createStage(calm: boolean): HoloStage {
  const group = new Group();
  const color = { value: new Color(HOLO_TEAL) };
  const time = { value: 0 };
  const uniforms: StageUniforms = { uColor: color, uRadius: { value: 2 }, uSpin: { value: 0 }, uCell: { value: 0.5 } };

  // El suelo: un plano grande; el dibujo lo hace el material según la distancia al centro.
  const floorGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const floorMaterial = stageMaterial(uniforms);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.renderOrder = 0;
  group.add(floor);

  // La cortina de luz: un cilindro abierto que nace en el anillo principal.
  const coneGeometry = new CylinderGeometry(1.03, 1, 1, 96, 1, true).translate(0, 0.5, 0);
  const coneMat = coneMaterial(color, time);
  const cone = new Mesh(coneGeometry, coneMat);
  cone.renderOrder = 0;
  group.add(cone);

  // Motas: repartidas en el disco, cada una con su desfase.
  const moteGeometry = new BufferGeometry();
  const positions = new Float32Array(MOTES * 3);
  const phases = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    // Reparto fijo (sin azar): la escena es igual cada vez que se abre.
    const turn = i * 2.39996;
    const reach = Math.sqrt((i + 0.5) / MOTES);
    positions.set([Math.cos(turn) * reach, 0, Math.sin(turn) * reach], i * 3);
    phases[i] = (i * 0.6180339) % 1;
  }
  moteGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  moteGeometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
  const moteHeight = { value: 2 };
  const moteScale = { value: 6 };
  const moteMat = moteMaterial(color, time, moteHeight, moteScale);
  const motes = new Points(moteGeometry, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 5;
  // Con movimiento reducido no hay nada flotando.
  motes.visible = !calm;
  group.add(motes);

  return {
    group,
    fit(radius, height) {
      uniforms.uRadius.value = radius;
      // Unas cuatro celdas de rejilla por radio, en medidas redondas.
      uniforms.uCell.value = radius > 2.2 ? 0.5 : 0.25;
      floor.scale.setScalar(radius * 11);
      cone.scale.set(radius, Math.max(0.6, height * 0.55), radius);
      motes.scale.set(radius * 0.98, 1, radius * 0.98);
      moteHeight.value = height * 1.25;
    },
    step(seconds) {
      time.value = seconds;
      uniforms.uSpin.value = seconds * 0.07;
    },
    resize(heightPx) {
      moteScale.value = heightPx * 0.012;
    },
    dispose() {
      floorGeometry.dispose();
      floorMaterial.dispose();
      coneGeometry.dispose();
      coneMat.dispose();
      moteGeometry.dispose();
      moteMat.dispose();
    },
  };
}
