/**
 * Materiales del holograma del hangar: luz verde azulada con el borde encendido, líneas finas que
 * suben y un leve parpadeo, como una proyección. Cada pieza se dibuja en cuatro pasadas:
 *
 * 1. Profundidad (sin color): solo se ve la cara más cercana y la forma se lee limpia.
 * 2. Fantasma: un resplandor tenue de todo lo que hay detrás, para que parezca luz y no chapa.
 * 3. Relleno: la superficie, más brillante en el contorno (donde se mira de canto).
 * 4. Aristas: las líneas de los bordes, como en un plano técnico.
 *
 * Las pasadas de una pieza comparten su tinte y su nivel: así se enciende, se apaga o cambia de
 * color entera. El tiempo y la altura hasta la que ya se «proyectó» el robot son comunes a todas.
 */
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from "three";
import type { IUniform } from "three";

/** Verde azulado de la interfaz (`--nc-tierra`) y naranja de acento (`--nc-acento`). */
export const HOLO_TEAL = "#7fd6c4";
export const HOLO_ACCENT = "#ec9b72";

/** Lo que comparten todas las piezas. */
export interface HoloShared {
  uTime: IUniform<number>;
  /** Altura, m, hasta la que el robot ya está proyectado; por encima no se dibuja. */
  uReveal: IUniform<number>;
  /** Cuánto parpadea: 0 con movimiento reducido. */
  uFlicker: IUniform<number>;
}

/** Lo que es propio de cada pieza. */
export interface HoloLook {
  uTint: IUniform<Color>;
  uLevel: IUniform<number>;
  /** De 0 a 1: cuánto relleno tiene. A 0 la pieza queda solo en sus aristas. */
  uSolid: IUniform<number>;
}

export const createShared = (): HoloShared => ({
  uTime: { value: 0 },
  uReveal: { value: 1e6 },
  uFlicker: { value: 1 },
});

export const createLook = (): HoloLook => ({
  uTint: { value: new Color(HOLO_TEAL) },
  uLevel: { value: 1 },
  uSolid: { value: 1 },
});

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = mat3(modelMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const DEPTH_FRAGMENT = /* glsl */ `
  uniform float uReveal;
  varying vec3 vWorld;
  void main() {
    if (vWorld.y > uReveal) discard;
    gl_FragColor = vec4(0.0);
  }
`;

const FILL_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uLevel;
  uniform float uSolid;
  uniform float uTime;
  uniform float uReveal;
  uniform float uFlicker;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    if (vWorld.y > uReveal) discard;
    vec3 normal = normalize(vNormal);
    vec3 view = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normal, view));
    // De canto la superficie se enciende: es lo que dibuja el contorno.
    float rim = pow(1.0 - facing, 2.2);
    // Un poco de volumen, como si la luz viniera de arriba y de un lado.
    float shade = 0.5 + 0.5 * dot(normal * sign(dot(normal, view)), normalize(vec3(0.35, 0.8, 0.45)));
    // Líneas finas que suben, y un barrido ancho y lento, como el haz del proyector.
    float lines = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin((vWorld.y * 34.0 - uTime * 0.7) * 6.28318));
    float sweep = pow(0.5 + 0.5 * sin(vWorld.y * 1.6 - uTime * 0.9), 10.0);
    float glow = 0.03 + 0.07 * shade + 0.5 * rim + 0.045 * lines + 0.09 * sweep;
    float flicker = 1.0 - uFlicker * (0.035 * sin(uTime * 41.0) + 0.03 * sin(uTime * 97.0 + vWorld.y * 2.0));
    // El frente del escaneo de entrada: una franja clara justo donde se está proyectando.
    float front = smoothstep(0.08, 0.0, uReveal - vWorld.y);
    vec3 color = uTint * glow * uLevel * flicker + vec3(0.62, 1.0, 0.92) * front * 0.9;
    gl_FragColor = vec4(color * uSolid, 1.0);
    #include <colorspace_fragment>
  }
`;

const GHOST_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uLevel;
  uniform float uSolid;
  uniform float uReveal;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    if (vWorld.y > uReveal) discard;
    float facing = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
    float rim = pow(1.0 - facing, 3.0);
    gl_FragColor = vec4(uTint * (0.004 + 0.03 * rim) * uLevel * uSolid, 1.0);
    #include <colorspace_fragment>
  }
`;

const EDGE_VERTEX = /* glsl */ `
  varying float vHeight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EDGE_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uLevel;
  uniform float uReveal;
  uniform float uStrength;
  varying float vHeight;
  void main() {
    if (vHeight > uReveal) discard;
    // Tinta y no luz sumada: donde se juntan muchas líneas el color se queda, no se quema en blanco.
    gl_FragColor = vec4(uTint * 1.12, clamp(uStrength * uLevel, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

/** Pasada de profundidad: no pinta, solo deja escrito qué queda delante. Vale para todas las piezas. */
export function depthMaterial(shared: HoloShared): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uReveal: shared.uReveal },
    vertexShader: VERTEX,
    fragmentShader: DEPTH_FRAGMENT,
    side: DoubleSide,
    colorWrite: false,
    // Un poco hacia atrás: el relleno y las aristas, que van en el mismo sitio, pasan la prueba.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function fillMaterial(shared: HoloShared, look: HoloLook): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...shared, ...look },
    vertexShader: VERTEX,
    fragmentShader: FILL_FRAGMENT,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

export function ghostMaterial(shared: HoloShared, look: HoloLook): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uReveal: shared.uReveal, ...look },
    vertexShader: VERTEX,
    fragmentShader: GHOST_FRAGMENT,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
}

export function edgeMaterial(shared: HoloShared, look: HoloLook, strength: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uReveal: shared.uReveal, uStrength: { value: strength }, ...look },
    vertexShader: EDGE_VERTEX,
    fragmentShader: EDGE_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
}

// ---------- La base del proyector ----------

const STAGE_VERTEX = /* glsl */ `
  varying vec2 vPlane;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPlane = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const STAGE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uSpin;
  uniform float uCell;
  varying vec2 vPlane;

  float ring(float r, float at, float width, float soft) {
    return 1.0 - smoothstep(width, width + soft, abs(r - at));
  }
  // 1 dentro de [from, to], con los bordes suavizados.
  float band(float r, float from, float to, float soft) {
    return smoothstep(from - soft, from, r) * (1.0 - smoothstep(to, to + soft, r));
  }

  void main() {
    float metres = length(vPlane);
    float r = metres / uRadius;
    float angle = atan(vPlane.y, vPlane.x);
    // Cuánto mide un píxel aquí, en radios y en grados: para suavizar los bordes sin que bailen.
    float pixel = (fwidth(vPlane.x) + fwidth(vPlane.y)) * 0.75;
    float soft = pixel / uRadius + 1e-4;
    float softDeg = degrees(pixel / max(metres, 1e-3)) + 1e-3;
    float deg = degrees(angle);

    float glow = 0.0;
    // Luz suave bajo el robot.
    glow += 0.085 * pow(max(0.0, 1.0 - r), 1.5);
    // Anillo principal y dos finos, por dentro y por fuera.
    glow += 0.95 * ring(r, 1.0, 0.005, soft);
    glow += 0.30 * ring(r, 0.92, 0.0015, soft);
    glow += 0.22 * ring(r, 1.17, 0.0015, soft);
    // Marcas cada 5°, más largas cada 30°.
    float near5 = abs(fract(deg / 5.0 + 0.5) - 0.5) * 5.0;
    float near30 = abs(fract(deg / 30.0 + 0.5) - 0.5) * 30.0;
    float tick = (1.0 - smoothstep(0.22, 0.22 + softDeg, near5)) * band(r, 1.025, 1.06, soft);
    float longTick = (1.0 - smoothstep(0.38, 0.38 + softDeg, near30)) * band(r, 1.025, 1.115, soft);
    glow += 0.55 * max(tick, longTick);
    // Dos anillos de trazos que giran despacio, uno en cada sentido.
    float turning = degrees(angle + uSpin);
    float dash = smoothstep(0.0, softDeg, 9.0 - abs(fract(turning / 30.0) - 0.5) * 30.0);
    glow += 0.50 * ring(r, 1.30, 0.004, soft) * dash;
    float counter = degrees(angle - uSpin * 1.6);
    float arc = smoothstep(0.0, softDeg, 16.0 - abs(fract(counter / 120.0) - 0.5) * 120.0);
    glow += 0.65 * ring(r, 1.40, 0.009, soft) * arc;
    // Rejilla del suelo, que se pierde en lo oscuro.
    vec2 cell = vPlane / uCell;
    vec2 line = abs(fract(cell - 0.5) - 0.5) / (fwidth(cell) * 1.1);
    float grid = 1.0 - min(min(line.x, line.y), 1.0);
    glow += grid * 0.07 * pow(1.0 - smoothstep(0.9, 3.1, r), 1.4);

    gl_FragColor = vec4(uColor * glow, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface StageUniforms {
  uColor: IUniform<Color>;
  uRadius: IUniform<number>;
  uSpin: IUniform<number>;
  uCell: IUniform<number>;
}

export function stageMaterial(uniforms: StageUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: STAGE_VERTEX,
    fragmentShader: STAGE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

const CONE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    // Más luz abajo, junto al anillo, y rayas verticales muy tenues.
    float fall = pow(1.0 - vUv.y, 2.6);
    float streaks = 0.78 + 0.22 * sin(vUv.x * 6.28318 * 48.0 + sin(uTime * 0.4 + vUv.x * 20.0));
    gl_FragColor = vec4(uColor * fall * streaks * 0.13, 1.0);
    #include <colorspace_fragment>
  }
`;

export function coneMaterial(uColor: IUniform<Color>, uTime: IUniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor, uTime },
    vertexShader: CONE_VERTEX,
    fragmentShader: CONE_FRAGMENT,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

const MOTE_VERTEX = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uHeight;
  uniform float uScale;
  varying float vFade;
  void main() {
    // Cada mota sube despacio y vuelve a empezar; aparece y se apaga sin saltos.
    float rise = fract(aPhase + uTime * (0.018 + 0.02 * fract(aPhase * 7.0)));
    vec3 at = vec3(position.x, rise * uHeight, position.z);
    vFade = sin(rise * 3.14159);
    vec4 view = modelViewMatrix * vec4(at, 1.0);
    gl_PointSize = uScale * (0.6 + fract(aPhase * 13.0)) / -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float spot = 1.0 - smoothstep(0.0, 1.0, d);
    gl_FragColor = vec4(uColor * spot * vFade * 0.5, 1.0);
    #include <colorspace_fragment>
  }
`;

export function moteMaterial(uColor: IUniform<Color>, uTime: IUniform<number>, uHeight: IUniform<number>, uScale: IUniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor, uTime, uHeight, uScale },
    vertexShader: MOTE_VERTEX,
    fragmentShader: MOTE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

const LEADER_VERTEX = /* glsl */ `
  attribute float aEnd;
  varying float vEnd;
  void main() {
    vEnd = aEnd;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LEADER_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vEnd;
  void main() {
    // Más clara junto a la pieza y casi nada en el sitio del que salió.
    gl_FragColor = vec4(uColor * uOpacity * (0.12 + 0.5 * vEnd), 1.0);
    #include <colorspace_fragment>
  }
`;

/** Líneas que unen el sitio de cada pieza con donde está al desarmar el robot. */
export function leaderMaterial(uColor: IUniform<Color>, uOpacity: IUniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor, uOpacity },
    vertexShader: LEADER_VERTEX,
    fragmentShader: LEADER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
}
