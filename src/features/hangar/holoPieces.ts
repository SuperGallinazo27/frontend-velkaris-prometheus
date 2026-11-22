/**
 * Prepara un robot para el holograma: lo pide separado en piezas (`buildRobotParts`), junta las
 * mallas de cada pieza en una sola geometría para las pasadas de luz y calcula hacia dónde sale
 * cada una al desarmarlo.
 */
import { Box3, BufferAttribute, BufferGeometry, Color, EdgesGeometry, LineSegments, Matrix3, Matrix4, Mesh, Vector3 } from "three";
import type { Group, Material, MeshStandardMaterial, Object3D, ShaderMaterial } from "three";
import { buildRobotParts } from "../mission/robotModels";
import type { RobotShape } from "../mission/robotModels";
import { robotById } from "../mission/robots";
import { vehicleById } from "../mission/wheelData";
import { createLook, edgeMaterial, fillMaterial, ghostMaterial } from "./holoMaterials";
import type { HoloLook, HoloShared } from "./holoMaterials";
import { EXPLODE_RULES, explodeOffset, representative } from "./holoMath";
import type { Box } from "./holoMath";
import { ROBOT_PARTS } from "./parts";
import type { HoloRobotId } from "./parts";

/** Las mismas medidas con las que el simulador dibuja el robot. */
export function shapeOfRobot(id: HoloRobotId): RobotShape {
  const vehicle = vehicleById(id);
  const model = robotById(id).model;
  return {
    kind: id,
    wheelRadius: vehicle.wheel.radius,
    wheelWidth: vehicle.wheel.width,
    body: vehicle.body,
    modelUrl: model?.kind === "nasa" ? model.url : null,
  };
}

/** Un material del estilo «real», con lo que tenía antes de atenuarlo o resaltarlo. */
interface Paint {
  material: MeshStandardMaterial;
  color: Color;
  emissive: Color | null;
  env: number;
}

export interface HoloPiece {
  part: string;
  object: Object3D;
  /** Posición de la pieza con el robot armado, y cuánto se desplaza al desarmarlo del todo. */
  home: Vector3;
  offset: Vector3;
  /** Centro de su caja con el robot armado, en el sistema del robot. */
  center: Vector3;
  look: HoloLook;
  /** Nivel de luz actual (se acerca poco a poco al que le toca). */
  level: number;
  /** Cuánto tiene del color de acento, de 0 a 1. */
  warmth: number;
  /** Cuánto relleno tiene, de 0 (solo aristas) a 1. */
  solid: number;
  depth: Mesh;
  ghost: Mesh;
  fill: Mesh;
  edges: LineSegments;
  /** Las mallas con sus materiales de verdad, para el estilo «real». */
  originals: Mesh[];
  paints: Paint[] | null;
}

export interface HoloRobot {
  id: HoloRobotId;
  root: Group;
  pieces: HoloPiece[];
  /** Componentes que tienen piezas propias, en el orden de la lista. */
  parts: string[];
  official: boolean;
  box: Box3;
  /** La pieza que lleva la etiqueta de cada componente. */
  labelled: Map<string, HoloPiece>;
  /** Materiales que dejaron de usarse al dar a cada pieza los suyos; se liberan al final. */
  retired: Material[];
  dispose(): void;
}

const invisible = (material: Material | Material[]) => {
  const list = Array.isArray(material) ? material : [material];
  return list.every((item) => !item.visible || (item.transparent && item.opacity < 0.05));
};

/**
 * Todas las mallas de una pieza en una sola geometría, con posición y normal en coma flotante y
 * en el sistema de la pieza. Los modelos de NASA traen las posiciones comprimidas en enteros: se
 * leen vértice a vértice, que es la forma que las descomprime bien.
 */
export function mergedGeometry(piece: Object3D, meshes: readonly Mesh[]): BufferGeometry | null {
  piece.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(piece.matrixWorld).invert();
  let vertices = 0;
  let corners = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    vertices += position.count;
    corners += mesh.geometry.index ? mesh.geometry.index.count : position.count;
  }
  if (!vertices) return null;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const indices = vertices > 65535 ? new Uint32Array(corners) : new Uint16Array(corners);
  const matrix = new Matrix4();
  const normalMatrix = new Matrix3();
  const point = new Vector3();
  let vertexAt = 0;
  let cornerAt = 0;
  let missingNormals = false;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    const normal = mesh.geometry.getAttribute("normal");
    const index = mesh.geometry.index;
    matrix.multiplyMatrices(inverse, mesh.matrixWorld);
    normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions.set([point.x, point.y, point.z], (vertexAt + i) * 3);
      if (normal) {
        point.fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix);
        normals.set([point.x, point.y, point.z], (vertexAt + i) * 3);
      }
    }
    if (!normal) missingNormals = true;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++) indices[cornerAt + i] = vertexAt + (index ? index.getX(i) : i);
    vertexAt += position.count;
    cornerAt += count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  if (missingNormals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const tuple = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];
const boxOf = (box: Box3): Box => ({ min: tuple(box.min), max: tuple(box.max) });

/** Ángulo, en grados, a partir del cual dos caras vecinas dibujan una arista. */
const EDGE_ANGLE = 38;

/**
 * Construye el robot por piezas y le añade las pasadas del holograma. `depth` es el material de
 * profundidad, común a toda la escena. Falla si el modelo oficial no se puede cargar.
 */
export async function prepareRobot(id: HoloRobotId, shared: HoloShared, depth: ShaderMaterial): Promise<HoloRobot> {
  const built = await buildRobotParts(shapeOfRobot(id));
  const { root } = built;
  root.updateMatrixWorld(true);
  const inverseRoot = new Matrix4().copy(root.matrixWorld).invert();
  const owned: { dispose(): void }[] = [];

  const pieces: HoloPiece[] = [];
  const boxes: Box3[] = [];
  for (const { part, object } of built.pieces) {
    const originals: Mesh[] = [];
    object.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh && mesh.geometry.getAttribute("position") && !invisible(mesh.material)) originals.push(mesh);
    });
    const geometry = mergedGeometry(object, originals);
    if (!geometry) continue;
    const look = createLook();
    const materials = { ghost: ghostMaterial(shared, look), fill: fillMaterial(shared, look), edge: edgeMaterial(shared, look, 0.46) };
    const edgeGeometry = new EdgesGeometry(geometry, EDGE_ANGLE);
    owned.push(geometry, edgeGeometry, materials.ghost, materials.fill, materials.edge);

    const depthMesh = new Mesh(geometry, depth);
    const ghost = new Mesh(geometry, materials.ghost);
    const fill = new Mesh(geometry, materials.fill);
    const edges = new LineSegments(edgeGeometry, materials.edge);
    // El orden importa: primero la profundidad, después la luz.
    depthMesh.renderOrder = 1;
    ghost.renderOrder = 2;
    fill.renderOrder = 3;
    edges.renderOrder = 4;
    object.add(depthMesh, ghost, fill, edges);

    // Caja de la pieza en el sistema del robot.
    const box = new Box3().copy(geometry.boundingBox!).applyMatrix4(new Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld));
    boxes.push(box);
    pieces.push({
      part,
      object,
      home: object.position.clone(),
      offset: new Vector3(),
      center: box.getCenter(new Vector3()),
      look,
      level: 1,
      warmth: 0,
      solid: 1,
      depth: depthMesh,
      ghost,
      fill,
      edges,
      originals,
      paints: null,
    });
  }

  const box = new Box3();
  for (const pieceBox of boxes) box.union(pieceBox);
  const robotBox = boxOf(box);
  pieces.forEach((piece, index) => {
    piece.offset.fromArray(explodeOffset(boxOf(boxes[index]), robotBox, EXPLODE_RULES[id][piece.part]));
  });

  const present = new Set(pieces.map((piece) => piece.part));
  const parts = ROBOT_PARTS[id].filter((part) => present.has(part));
  const labelled = new Map<string, HoloPiece>();
  for (const part of parts) {
    const own = pieces.filter((piece) => piece.part === part);
    labelled.set(part, own[representative(own.map((piece) => tuple(piece.center)))]);
  }

  const retired: Material[] = [];
  return {
    id,
    root,
    pieces,
    parts,
    official: built.official,
    box,
    labelled,
    retired,
    dispose() {
      for (const material of retired) material.dispose();
      for (const item of owned) item.dispose();
      built.dispose();
    },
  };
}

/**
 * Para el estilo «real» cada pieza necesita sus propios materiales: así se puede oscurecer una
 * sin tocar las demás (en los modelos de NASA muchas piezas comparten material). Se hace una vez,
 * la primera vez que se pide ese estilo.
 */
export function ownPaints(robot: HoloRobot): void {
  for (const piece of robot.pieces) {
    if (piece.paints) continue;
    const clones = new Map<Material, Material>();
    const cloneOf = (material: Material) => {
      let clone = clones.get(material);
      if (!clone) {
        clone = material.clone();
        // Un poco hacia atrás: las aristas de la pieza elegida se dibujan encima sin temblar.
        clone.polygonOffset = true;
        clone.polygonOffsetFactor = 1;
        clone.polygonOffsetUnits = 1;
        clones.set(material, clone);
      }
      return clone;
    };
    for (const mesh of piece.originals) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneOf) : cloneOf(mesh.material);
    }
    robot.retired.push(...clones.keys());
    piece.paints = [...clones.values()]
      .filter((material) => "color" in material)
      .map((material) => {
        const standard = material as MeshStandardMaterial;
        return {
          material: standard,
          color: standard.color.clone(),
          emissive: standard.emissive ? standard.emissive.clone() : null,
          env: standard.envMapIntensity ?? 1,
        };
      });
  }
}
