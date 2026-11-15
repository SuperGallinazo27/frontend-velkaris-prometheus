import { describe, expect, test } from "bun:test";
import { chaseOffsetDeg, chasePitchDeg, chasePoints, chaseRig, clampLook, LOOK_LIMITS } from "../src/features/mission/cameraRig";
import { FIELD_RADIUS_M, PRACTICE_FIELD, SOLID_ROCK_M, activeObstacles, layoutCamp, rockField, seededRandom } from "../src/features/mission/camp";
import {
  arcRadius,
  collisionRadius,
  distanceTo,
  easyHeading,
  heightSampler,
  meshSampler,
  startDrive,
  steerToward,
  stepManual,
} from "../src/features/mission/drive";
import type { DriveState, ManualVehicle } from "../src/features/mission/drive";
import { GROUND_TEXTURES, surfaceFor } from "../src/features/mission/groundTextures";
import { MINI_ROBOT_Y, scaleBar, toEdge, toMini } from "../src/features/mission/minimap";
import { ROBOTS, ROBOT_GROUPS, robotOfVehicle } from "../src/features/mission/robots";
import { satelliteZoom } from "../src/features/mission/satellite";
import { CLEAR_SKY, lightLabel, skyPalette, weatherSky } from "../src/features/mission/sky";
import { atSolarHour, clock, sceneLight, solarHour, sunPosition } from "../src/features/mission/sun";
import type { TerrainGrid } from "../src/features/mission/twin";
import { LUNAR_VEHICLES, VEHICLES, vehicleById } from "../src/features/mission/wheelData";
import { slipTables, tableLimits } from "../src/features/mission/wheelLab";
import type { CurrentWeather } from "../src/services/weather";

/** Malla de `cells` celdas de `cell` metros con la altura que da `z(este, norte)` en metros. */
function grid(cells: number, cell: number, z: (east: number, north: number) => number): TerrainGrid {
  const points = cells + 1;
  const sizeM = cells * cell;
  const heights = new Float32Array(points * points);
  for (let r = 0; r < points; r++) {
    for (let c = 0; c < points; c++) heights[r * points + c] = z(c * cell - sizeM / 2, r * cell - sizeM / 2);
  }
  return { cells, sizeM, heights, zoom: 14, sourcePixelM: 10 };
}

const flat = heightSampler(grid(40, 30, () => 100));
const viperPreset = vehicleById("viper");
const viper: ManualVehicle = {
  wheels: 4,
  wheelRadius: 0.25,
  wheelSpeed: 0.1,
  radius: collisionRadius(1.7, 1.7),
  turnRadius: 0,
  wheelbase: 1.2,
  track: 1.45,
};
const lrv: ManualVehicle = { wheels: 4, wheelRadius: 0.409, wheelSpeed: 1.8, radius: collisionRadius(3.1, 1.8), turnRadius: 3.1, wheelbase: 2.3, track: 1.8 };
const tables = slipTables("viper", "franco-arenoso");
const lrvTables = slipTables("lrv", "franco-arenoso");

/** Repite un paso de conducción con los mismos mandos. */
function drive(state: DriveState, steps: number, step: (state: DriveState) => DriveState): DriveState {
  let next = state;
  for (let k = 0; k < steps; k++) next = step(next);
  return next;
}

describe("conducción con mandos", () => {
  const start = startDrive(0, 0, 0, 1);

  test("sin tocar nada, el robot no se mueve ni pasa el tiempo", () => {
    const still = stepManual(start, 1, flat, tables.earth, viper, { throttle: 0, steer: 0 });
    expect(still.motion).toBe("parado");
    expect(still.time).toBe(0);
    expect(still.distance).toBe(0);
  });

  test("acelerando avanza hacia donde mira, más lento que la rueda por el patinaje", () => {
    const state = drive(start, 100, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 1, steer: 0 }));
    const slip = tables.earth.climbs[0].slip!;
    expect(state.status).toBe("avanzando");
    expect(state.motion).toBe("adelante");
    expect(state.north).toBeCloseTo(50 * 0.1 * (1 - slip), 5);
    expect(state.east).toBeCloseTo(0, 6);
    expect(state.time).toBeCloseTo(50, 6);
    expect(state.energy).toBeGreaterThan(0);
  });

  test("a medio gas la rueda gira a la mitad", () => {
    const full = drive(start, 20, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 1, steer: 0 }));
    const half = drive(start, 20, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 0.5, steer: 0 }));
    expect(half.distance).toBeCloseTo(full.distance / 2, 6);
  });

  test("marcha atrás retrocede y las ruedas giran al revés", () => {
    const state = drive(start, 20, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: -1, steer: 0 }));
    expect(state.motion).toBe("atras");
    expect(state.north).toBeLessThan(0);
    expect(state.wheelAngle).toBeLessThan(0);
    expect(state.distance).toBeGreaterThan(0);
  });

  test("el volante a la izquierda gira hacia el oeste al avanzar, y al revés en marcha atrás", () => {
    const left = drive(start, 40, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 1, steer: 1 }));
    expect(left.dx).toBeLessThan(0);
    expect(left.east).toBeLessThan(0);
    // La curva tiene el radio previsto: el rumbo cambia recorrido / radio.
    expect(Math.atan2(left.dy, left.dx) - Math.PI / 2).toBeCloseTo(left.distance / arcRadius(viper), 5);
    const back = drive(start, 40, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: -1, steer: 1 }));
    expect(back.dx).toBeGreaterThan(0);
  });

  test("VIPER gira sobre sí mismo sin acelerar; el carro lunar, no", () => {
    const pivot = drive(start, 20, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 0, steer: 1 }));
    expect(pivot.motion).toBe("girando");
    expect(pivot.distance).toBe(0);
    expect(pivot.dx).toBeLessThan(0);
    expect(pivot.time).toBeCloseTo(10, 6);
    const car = drive(start, 20, (s) => stepManual(s, 0.5, flat, lrvTables.earth, lrv, { throttle: 0, steer: 1 }));
    expect(car.motion).toBe("parado");
    expect(car.dx).toBeCloseTo(0, 9);
    expect(car.time).toBe(0);
  });

  test("una cuesta que no puede subir lo deja atascado, y retrocediendo sale", () => {
    const stuckFrom = tableLimits(tables.earth, 0.4).stuck;
    const rise = Math.tan(((stuckFrom + 5) * Math.PI) / 180);
    const ramp = heightSampler(grid(80, 5, (_east, north) => (north > 20 ? (north - 20) * rise : 0)));
    let state = drive(start, 2000, (s) => stepManual(s, 0.5, ramp, tables.earth, viper, { throttle: 1, steer: 0 }));
    expect(state.status).toBe("atascado");
    expect(state.slip).toBe(1);
    expect(state.stuckTimes).toBe(1);
    const stuckAt = state.north;
    // Seguir acelerando no lo mueve ni cuenta otro atasco.
    state = drive(state, 20, (s) => stepManual(s, 0.5, ramp, tables.earth, viper, { throttle: 1, steer: 0 }));
    expect(state.north).toBe(stuckAt);
    expect(state.stuckTimes).toBe(1);
    state = drive(state, 60, (s) => stepManual(s, 0.5, ramp, tables.earth, viper, { throttle: -1, steer: 0 }));
    expect(state.status).toBe("avanzando");
    expect(state.north).toBeLessThan(stuckAt);
  });

  test("no atraviesa un obstáculo: se detiene, cuenta un tope y puede alejarse", () => {
    const rock = { east: 0, north: 6, radius: 0.5 };
    let state = drive(start, 400, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 1, steer: 0 }, [rock]));
    expect(state.touching).toBe(true);
    expect(state.collisions).toBe(1);
    expect(distanceTo(state, rock.east, rock.north)).toBeGreaterThanOrEqual(viper.radius + rock.radius - 0.06);
    expect(distanceTo(state, rock.east, rock.north)).toBeLessThan(viper.radius + rock.radius + 0.06);
    // Insistir no lo cuenta dos veces; retroceder lo separa.
    state = drive(state, 10, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 1, steer: 0 }, [rock]));
    expect(state.collisions).toBe(1);
    state = drive(state, 40, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: -1, steer: 0 }, [rock]));
    expect(state.touching).toBe(false);
    expect(distanceTo(state, rock.east, rock.north)).toBeGreaterThan(viper.radius + rock.radius);
  });

  test("no sale del área", () => {
    const state = drive(startDrive(0, 9.5, 0, 10.5), 600, (s) => stepManual(s, 0.5, flat, tables.earth, viper, { throttle: 1, steer: 0 }, [], 10));
    expect(state.north).toBeLessThanOrEqual(10.06);
    expect(state.touching).toBe(true);
    expect(state.collisions).toBe(0);
  });
});

describe("rumbo de arranque", () => {
  test("en llano mira al norte; en una ladera, de través: ni sube ni baja", () => {
    expect(easyHeading(flat, 0, 0)).toBeCloseTo(Math.PI / 2, 9);
    // Ladera que sube hacia el norte: los rumbos llanos son el este y el oeste.
    const hill = heightSampler(grid(40, 30, (_east, north) => 100 + north * 0.2));
    const facing = easyHeading(hill, 0, 0);
    expect(Math.abs(Math.sin(facing))).toBeLessThan(1e-6);
    // La base se coloca respecto a ese rumbo: delante y a un lado.
    const layout = layoutCamp({ east: 0, north: 0 }, hill, 5, facing);
    expect(layout.base.east * Math.cos(facing)).toBeGreaterThan(10);
  });
});

describe("piloto automático", () => {
  test("VIPER gira primero hacia el destino y después llega", () => {
    // Empieza mirando al norte; el destino queda al sureste.
    let state = startDrive(0, 0, 0, 1);
    const target = { east: 12, north: -9 };
    expect(steerToward(state, viper, target.east, target.north)).toEqual({ throttle: 0, steer: -1 });
    for (let k = 0; k < 20000 && distanceTo(state, target.east, target.north) > 1.5; k++) {
      state = stepManual(state, 0.5, flat, tables.earth, viper, steerToward(state, viper, target.east, target.north));
    }
    expect(distanceTo(state, target.east, target.north)).toBeLessThanOrEqual(1.5);
    // Poco más que la línea recta: 15 m.
    expect(state.distance).toBeLessThan(15);
  });

  test("el carro lunar, que no gira sobre sí mismo, maniobra y también llega", () => {
    let state = startDrive(0, 0, 0, 1);
    const target = { east: 2, north: -30 };
    expect(steerToward(state, lrv, target.east, target.north).throttle).toBeLessThan(0);
    for (let k = 0; k < 20000 && distanceTo(state, target.east, target.north) > 1.5; k++) {
      state = stepManual(state, 0.1, flat, lrvTables.earth, lrv, steerToward(state, lrv, target.east, target.north));
    }
    expect(distanceTo(state, target.east, target.north)).toBeLessThanOrEqual(1.5);
  });
});

describe("el suelo que pisan las ruedas", () => {
  test("la altura sigue los mismos triángulos que la malla 3D", () => {
    // Una celda con una esquina levantada: los dos triángulos no forman un plano.
    const cell = grid(1, 30, (east, north) => (east > 0 && north > 0 ? 6 : 0));
    const height = meshSampler(cell);
    // En las esquinas, la altura del dato.
    expect(height(-15, -15)).toBe(0);
    expect(height(15, 15)).toBe(6);
    // Sobre la diagonal sureste-noroeste, las dos mitades coinciden: altura 0.
    expect(height(0, 0)).toBeCloseTo(0, 9);
    // En el triángulo noreste sube de forma lineal hacia la esquina levantada.
    expect(height(7.5, 7.5)).toBeCloseTo(3, 6);
    // En el triángulo suroeste es llano.
    expect(height(-7.5, -7.5)).toBe(0);
  });

  test("en un plano inclinado coincide con la interpolación bilineal", () => {
    const tilted = grid(20, 30, (east, north) => 100 + east * 0.1 - north * 0.05);
    const a = meshSampler(tilted);
    const b = heightSampler(tilted);
    for (const [east, north] of [[3, 4], [-120.5, 88], [299, -299], [0, 0]]) expect(a(east, north)).toBeCloseTo(b(east, north), 3);
  });
});

describe("campo de práctica", () => {
  const start = { east: 120, north: -80 };
  const layout = layoutCamp(start, flat, 42);

  test("el mismo punto da siempre el mismo campo", () => {
    expect(layoutCamp(start, flat, 42)).toEqual(layout);
    expect(layoutCamp(start, flat, 43).rocks[0]).not.toEqual(layout.rocks[0]);
    const random = seededRandom(7);
    const again = seededRandom(7);
    expect([random(), random(), random()]).toEqual([again(), again(), again()]);
  });

  test("deja libre el punto de partida; la base queda delante y a un lado del robot, que mira al norte", () => {
    expect(layout.base.north).toBeGreaterThan(start.north);
    // El camino recto hacia el norte queda libre de módulos de la base.
    for (const item of layout.items.filter((part) => part.radius > 0)) {
      expect(Math.abs(item.east - start.east) - item.radius).toBeGreaterThan(viper.radius + 1);
    }
    for (const obstacle of layout.obstacles) {
      expect(Math.hypot(obstacle.east - start.east, obstacle.north - start.north) - obstacle.radius).toBeGreaterThan(viper.radius + 1);
    }
  });

  test("las rocas grandes detienen al robot y la grava no", () => {
    const solid = layout.rocks.filter((rock) => rock.solid);
    expect(solid.length).toBeGreaterThan(60);
    for (const rock of layout.rocks) {
      expect(rock.solid).toBe(rock.size >= SOLID_ROCK_M);
      expect(Math.hypot(rock.east - start.east, rock.north - start.north)).toBeLessThanOrEqual(FIELD_RADIUS_M);
    }
    const modules = layout.items.filter((item) => item.radius > 0).length;
    expect(layout.obstacles).toHaveLength(modules + solid.length);
    // Con las rocas apagadas solo estorban los módulos de la base.
    expect(activeObstacles(layout, false)).toHaveLength(modules);
    expect(activeObstacles(layout, true)).toHaveLength(layout.obstacles.length);
  });
});

describe("catálogo de robots", () => {
  test("trae los seis robots del Excel del equipo y el carro lunar, cada uno en su grupo", () => {
    expect(ROBOTS.map((robot) => robot.id).sort()).toEqual(["cadre", "curiosity", "duaxel", "eels", "lrv", "perseverance", "viper"]);
    for (const robot of ROBOTS) {
      expect(ROBOT_GROUPS.some((group) => group.id === robot.group)).toBe(true);
      expect(robot.source.url).toStartWith("https://");
    }
    expect(ROBOTS.filter((robot) => robot.group === "Operativo").map((robot) => robot.name)).toEqual(["Perseverance", "Curiosity"]);
  });

  test("solo se simulan los que tienen masa y ruedas publicadas; los demás dicen por qué no", () => {
    for (const robot of ROBOTS) {
      if (robot.vehicle) {
        expect(robot.blocked).toBeNull();
        expect(robot.model).not.toBeNull();
        expect(vehicleById(robot.vehicle).id).toBe(robot.vehicle);
      } else {
        expect(robot.blocked).toStartWith("No se puede simular");
        expect(robot.model).toBeNull();
      }
    }
    expect(ROBOTS.filter((robot) => !robot.vehicle).map((robot) => robot.id).sort()).toEqual(["cadre", "duaxel", "eels"]);
    // Cada vehículo del modelo rueda-suelo está en el catálogo.
    for (const vehicle of VEHICLES) expect(robotOfVehicle(vehicle.id).vehicle).toBe(vehicle.id);
  });

  test("Perseverance y Curiosity usan los datos publicados por NASA y el modelo 3D oficial", () => {
    expect(vehicleById("perseverance")).toMatchObject({ mass: 1025, wheels: 6, wheel: { radius: 0.2625, width: 0.336 }, world: "marte", turnRadius: 0 });
    expect(vehicleById("perseverance").wheelSpeed).toBeCloseTo(152 / 3600, 9);
    expect(vehicleById("curiosity")).toMatchObject({ mass: 899, wheels: 6, wheel: { radius: 0.25, width: 0.4 }, wheelSpeed: 0.04, world: "marte" });
    for (const id of ["perseverance", "curiosity"] as const) {
      expect(robotOfVehicle(id).model).toMatchObject({ kind: "nasa", credit: "Modelo 3D oficial. Cortesía de NASA/JPL-Caltech" });
      expect(vehicleById(id).sources.length).toBeGreaterThanOrEqual(2);
    }
    expect(robotOfVehicle("viper").model?.kind).toBe("simplificado");
  });

  test("la comparación con la Luna se queda con los vehículos lunares", () => {
    expect(LUNAR_VEHICLES.map((vehicle) => vehicle.id)).toEqual(["viper", "lrv"]);
    expect(viperPreset.turnRadius).toBe(0);
    expect(vehicleById("lrv").turnRadius).toBe(3.1);
  });

  test("los robots de Marte, con su masa real, también tienen tabla de patinaje en el suelo de aquí", () => {
    for (const id of ["perseverance", "curiosity"] as const) {
      const table = slipTables(id, "franco-arenoso").earth;
      expect(table.climbs[0].outcome).toBe("avanza");
      expect(tableLimits(table, 0.4).stuck).toBeGreaterThan(0);
    }
  });
});

describe("el Sol del lugar", () => {
  test("en el equinoccio, a mediodía y en el ecuador, el Sol está casi en el cenit", () => {
    const noon = sunPosition(new Date("2026-03-20T12:00:00Z"), 0, 0);
    expect(noon.elevation).toBeGreaterThan(87);
  });

  test("en el solsticio de junio culmina a 23,4° al norte del ecuador y sale por el noreste", () => {
    const zenith = sunPosition(new Date("2026-06-21T12:00:00Z"), 23.44, 0);
    expect(zenith.elevation).toBeGreaterThan(89);
    // En Quito, a las seis de la mañana (hora solar): amanece, hacia el este-noreste.
    const sunrise = sunPosition(atSolarHour(new Date("2026-06-21T12:00:00Z"), -78.5, 6), -0.2, -78.5);
    expect(Math.abs(sunrise.elevation)).toBeLessThan(2);
    expect(sunrise.azimuth).toBeGreaterThan(60);
    expect(sunrise.azimuth).toBeLessThan(72);
  });

  test("por la tarde el Sol está al oeste y de noche, bajo el horizonte", () => {
    const afternoon = sunPosition(new Date("2026-11-15T21:00:00Z"), -0.83, -91.17);
    expect(afternoon.elevation).toBeGreaterThan(20);
    expect(afternoon.azimuth).toBeGreaterThan(180);
    expect(sunPosition(new Date("2026-11-15T07:00:00Z"), -0.83, -91.17).elevation).toBeLessThan(-30);
  });

  test("la hora solar sigue a la longitud", () => {
    const date = new Date("2026-11-15T12:00:00Z");
    expect(solarHour(date, 0)).toBeCloseTo(12, 6);
    expect(solarHour(date, -90)).toBeCloseTo(6, 6);
    expect(solarHour(atSolarHour(date, -90, 9.5), -90)).toBeCloseTo(9.5, 6);
    expect(clock(9.5)).toBe("9:30");
    expect(clock(17.25)).toBe("17:15");
  });

  test("de día se ilumina con el Sol real; de noche, con la luz de la mañana y diciéndolo", () => {
    const day = sceneLight(new Date("2026-11-15T18:00:00Z"), -0.83, -91.17);
    expect(day.mode).toBe("real");
    const night = sceneLight(new Date("2026-11-15T07:00:00Z"), -0.83, -91.17);
    expect(night.mode).toBe("manana");
    expect(night.hour).toBe(9.5);
    expect(night.elevation).toBeGreaterThan(30);
    expect(lightLabel(night, false, "1:00")).toContain("de noche");
    expect(lightLabel(day, false, "12:00")).toBe("Sol real de ahora (12:00 allí)");
  });

  test("en la noche polar no hay Sol a ninguna hora: luz de referencia", () => {
    // Bockfjorden (79° N) en diciembre.
    const polar = sceneLight(new Date("2026-12-15T12:00:00Z"), 79.4, 13.4);
    expect(polar.mode).toBe("referencia");
    expect(polar.hour).toBeNull();
    expect(lightLabel(polar, false, null)).toContain("no es la real");
  });
});

describe("el cielo y el tiempo de ahora", () => {
  const weather = (code: number, cloudCover: number, windDirection = 90): CurrentWeather => ({
    time: "2026-11-15T10:00",
    timezone: "Pacific/Galapagos",
    elevation: 900,
    temperature: 21,
    apparentTemperature: 22,
    humidity: 80,
    precipitation: 1.2,
    cloudCover,
    pressure: 910,
    windSpeed: 18,
    windDirection,
    isDay: true,
    code,
    description: "",
  });

  test("sin dato del tiempo, cielo despejado de referencia", () => {
    expect(weatherSky(null)).toEqual(CLEAR_SKY);
  });

  test("la lluvia y la nieve salen del código del tiempo, y cubren el cielo", () => {
    const rain = weatherSky(weather(65, 40));
    expect(rain.precipitation).toBe("lluvia");
    expect(rain.intensity).toBe(1);
    expect(rain.cloud).toBeGreaterThanOrEqual(0.85);
    expect(weatherSky(weather(71, 100)).precipitation).toBe("nieve");
    expect(weatherSky(weather(2, 40))).toMatchObject({ precipitation: "ninguna", intensity: 0, cloud: 0.4, fog: 0 });
    expect(weatherSky(weather(45, 10)).fog).toBe(1);
  });

  test("el viento sopla hacia el lado contrario del que viene", () => {
    // Viento del este: sopla hacia el oeste.
    const sky = weatherSky(weather(0, 0, 90));
    expect(sky.windEast).toBeCloseTo(-1, 6);
    expect(sky.windNorth).toBeCloseTo(0, 6);
    expect(sky.windSpeed).toBeCloseTo(5, 6);
  });

  test("con nubes baja la luz directa y sube la difusa; de noche casi no hay luz", () => {
    const clear = skyPalette({ ...CLEAR_SKY, cloud: 0, elevation: 50, azimuth: 120 });
    const overcast = skyPalette({ ...CLEAR_SKY, cloud: 1, elevation: 50, azimuth: 120 });
    expect(overcast.sunIntensity).toBeLessThan(clear.sunIntensity * 0.3);
    expect(overcast.skyIntensity).toBeGreaterThan(clear.skyIntensity);
    expect(overcast.sunDisc).toBe(0);
    const night = skyPalette({ ...CLEAR_SKY, cloud: 0, elevation: -30, azimuth: 0 });
    expect(night.sunIntensity).toBe(0);
    expect(night.day).toBe(0);
    expect(night.stars).toBe(1);
    // La niebla y la lluvia acortan la vista.
    expect(skyPalette({ ...CLEAR_SKY, fog: 1, elevation: 40, azimuth: 0 }).fogDensity).toBeGreaterThan(clear.fogDensity * 50);
    expect(skyPalette({ ...CLEAR_SKY, precipitation: "lluvia", intensity: 1, elevation: 40, azimuth: 0 }).fogDensity).toBeGreaterThan(clear.fogDensity * 5);
  });
});

describe("imagen satelital", () => {
  test("usa el zoom más fino que cabe en pocas teselas, y menos cerca de los polos", () => {
    expect(satelliteZoom(0, 18_000)).toBe(14);
    expect(satelliteZoom(65, 18_000)).toBeLessThan(14);
    expect(satelliteZoom(79.4, 18_000)).toBeLessThan(satelliteZoom(65, 18_000));
    // Nunca más de nueve teselas por lado.
    for (const latitude of [0, 30, 65, 79.4]) {
      const zoom = satelliteZoom(latitude, 18_000);
      const tileM = (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
      expect(18_000 / tileM + 1).toBeLessThanOrEqual(9);
    }
  });
});

describe("rocas, matas y suelo según la lectura de fotos", () => {
  const flat = () => 0;
  const start = { east: 0, north: 0 };

  test("sin lectura, o si ninguna foto muestra el suelo de cerca, las rocas son las de práctica", () => {
    expect(rockField(null)).toEqual(PRACTICE_FIELD);
    const far = rockField({ rockCover: null, rockSize: null, vegetation: "moderada", surface: "suelo" });
    expect(far.fromReading).toBe(false);
    expect(far.solid).toBe(PRACTICE_FIELD.solid);
    // De la vegetación sí se sabe: hay matas.
    expect(far.tufts).toBeGreaterThan(1000);
  });

  test("más cobertura y bloques mayores dan más rocas que detienen al robot", () => {
    const few = rockField({ rockCover: "poca", rockSize: "piedras", vegetation: "ninguna", surface: "grava" });
    const some = rockField({ rockCover: "moderada", rockSize: "piedras", vegetation: "ninguna", surface: "ceniza" });
    const many = rockField({ rockCover: "mucha", rockSize: "grandes", vegetation: "ninguna", surface: "lava" });
    expect(some.fromReading).toBe(true);
    expect(few.solid).toBeLessThan(some.solid);
    expect(some.solid).toBeLessThan(many.solid);
    expect(few.pebbles).toBeLessThan(some.pebbles);
    expect(many.solidSize[1]).toBeGreaterThan(some.solidSize[1]);
    // Con guijarros casi nada detiene al robot, aunque haya muchos.
    const gravel = rockField({ rockCover: "mucha", rockSize: "guijarros", vegetation: "ninguna", surface: "grava" });
    expect(gravel.solid).toBeLessThan(some.solid);
    expect(gravel.pebbleSize[1]).toBeLessThan(SOLID_ROCK_M);
    expect(rockField({ rockCover: "ninguna", rockSize: null, vegetation: "ninguna", surface: "sal" }).solid).toBeLessThan(10);
  });

  test("la vegetación da matas, y donde el suelo es vegetación nunca faltan", () => {
    const none = rockField({ rockCover: "poca", rockSize: "piedras", vegetation: "ninguna", surface: "arena" });
    const dense = rockField({ rockCover: "poca", rockSize: "piedras", vegetation: "densa", surface: "suelo" });
    const meadow = rockField({ rockCover: "poca", rockSize: "piedras", vegetation: "escasa", surface: "vegetacion" });
    expect(none.tufts).toBe(0);
    expect(dense.tufts).toBeGreaterThan(meadow.tufts);
    expect(meadow.tufts).toBeGreaterThan(1000);
  });

  test("la calidad media quita piedras pequeñas y matas, pero ninguna roca que detenga al robot", () => {
    const reading = { rockCover: "moderada", rockSize: "bloques", vegetation: "moderada", surface: "suelo" } as const;
    const high = rockField(reading, 1);
    const medium = rockField(reading, 0.45);
    expect(medium.solid).toBe(high.solid);
    expect(medium.pebbles).toBeLessThan(high.pebbles);
    expect(medium.tufts).toBeLessThan(high.tufts);
    // Mismo campo: los obstáculos quedan en el mismo sitio.
    const a = layoutCamp(start, flat, 77, Math.PI / 2, high);
    const b = layoutCamp(start, flat, 77, Math.PI / 2, medium);
    expect(b.obstacles).toEqual(a.obstacles);
    expect(b.rocks.length).toBeLessThan(a.rocks.length);
    expect(a.tufts.length).toBeGreaterThan(b.tufts.length);
    expect(b.tufts.length).toBeGreaterThan(0);
    // Las matas no estorban y dejan libre el sitio del robot.
    expect(a.obstacles.length).toBe(a.items.filter((item) => item.radius > 0).length + a.rocks.filter((rock) => rock.solid).length);
    for (const tuft of a.tufts) expect(Math.hypot(tuft.east, tuft.north)).toBeGreaterThan(1.5);
  });

  test("el suelo que se dibuja sale de las fotos y, sin ellas, del suelo elegido", () => {
    expect(surfaceFor({ surface: "ceniza", secondary: "grava" }, "arena-seca")).toEqual({ surface: "ceniza", secondary: "grava", fromReading: true });
    expect(surfaceFor(null, "arena-seca")).toEqual({ surface: "arena", secondary: null, fromReading: false });
    expect(surfaceFor(null, "grc-3").surface).toBe("arena");
    expect(surfaceFor(null, "nieve").surface).toBe("nieve");
    expect(surfaceFor(null, "franco-arenoso").surface).toBe("suelo");
    expect(surfaceFor(null, "arcilloso-55").surface).toBe("suelo");
    // Cada superficie tiene su fotografía, con un tamaño y un color medio con sentido.
    for (const texture of Object.values(GROUND_TEXTURES)) {
      expect(texture.tileM).toBeGreaterThan(1);
      expect(texture.tileM).toBeLessThan(5);
      for (const channel of texture.mean) {
        expect(channel).toBeGreaterThan(0);
        expect(channel).toBeLessThan(1);
      }
    }
  });
});

describe("cámaras del simulador", () => {
  /** Mitad del ángulo de visión vertical del simulador, en grados. */
  const HALF_FOV = 24;

  test("«Seguir» mira por delante del robot: el robot queda abajo y no tapa el camino", () => {
    for (const length of [1.5, 3.1]) {
      const rig = chaseRig(length);
      expect(rig.ahead).toBeGreaterThan(5);
      // La vista baja poco: el horizonte entra en la imagen.
      expect(chasePitchDeg(rig)).toBeGreaterThan(8);
      expect(chasePitchDeg(rig)).toBeLessThan(HALF_FOV - 4);
      // Lo más alto del robot (unos 2 m) queda bajo el centro de la imagen.
      expect(chaseOffsetDeg(rig, 2.2)).toBeGreaterThan(0);
      // Y sus ruedas traseras, dentro de la imagen con margen.
      expect(chaseOffsetDeg(rig, 0, length / 2)).toBeLessThan(HALF_FOV - 5);
    }
  });

  test("la cámara va detrás y el punto al que mira, delante, sea cual sea el rumbo", () => {
    const rig = chaseRig(1.5);
    for (const heading of [0, Math.PI / 2, 2.3, -1.1]) {
      const { camera, target } = chasePoints({ x: 10, y: 3, z: -20 }, heading, rig);
      // En la escena, z = −norte.
      const forward = { x: Math.cos(heading), z: -Math.sin(heading) };
      expect((target.x - 10) * forward.x + (target.z + 20) * forward.z).toBeCloseTo(rig.ahead, 6);
      expect((camera.x - 10) * forward.x + (camera.z + 20) * forward.z).toBeCloseTo(-rig.back, 6);
      expect(camera.y).toBeCloseTo(3 + rig.up, 6);
      expect(target.y).toBeCloseTo(3 + rig.lift, 6);
    }
  });

  test("la cámara del robot gira como una cabeza con cámaras, no más", () => {
    expect(clampLook(0.3, -0.1)).toEqual({ yaw: 0.3, pitch: -0.1 });
    expect(clampLook(9, 9)).toEqual({ yaw: LOOK_LIMITS.yaw, pitch: LOOK_LIMITS.up });
    expect(clampLook(-9, -9)).toEqual({ yaw: -LOOK_LIMITS.yaw, pitch: -LOOK_LIMITS.down });
  });
});

describe("minimapa", () => {
  const view = (heading: number) => ({ east: 100, north: -50, heading, rangeM: 40, sizePx: 200 });

  test("el robot queda bajo el centro y lo que tiene delante, arriba", () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -2]) {
      const v = view(heading);
      const here = toMini(v, 100, -50);
      expect(here.x).toBeCloseTo(100, 6);
      expect(here.y).toBeCloseTo(200 * MINI_ROBOT_Y, 6);
      // 20 m por delante: 50 px más arriba (200 px son 80 m).
      const ahead = toMini(v, 100 + Math.cos(heading) * 20, -50 + Math.sin(heading) * 20);
      expect(ahead.x).toBeCloseTo(100, 6);
      expect(ahead.y).toBeCloseTo(200 * MINI_ROBOT_Y - 50, 6);
      // 10 m a su derecha: 25 px a la derecha.
      const right = toMini(v, 100 + Math.sin(heading) * 10, -50 - Math.cos(heading) * 10);
      expect(right.x).toBeCloseTo(125, 6);
      expect(right.y).toBeCloseTo(200 * MINI_ROBOT_Y, 6);
    }
  });

  test("la barra de escala es una distancia redonda que cabe en media anchura", () => {
    expect(scaleBar(40, 184).meters).toBe(20);
    expect(scaleBar(150, 184).meters).toBe(100);
    expect(scaleBar(600, 184).meters).toBe(500);
    for (const range of [40, 150, 600]) {
      const bar = scaleBar(range, 184);
      expect(bar.px).toBeCloseTo((bar.meters * 184) / (2 * range), 6);
      expect(bar.px).toBeLessThan(92);
      expect(bar.px).toBeGreaterThan(30);
    }
  });

  test("un destino fuera del minimapa se marca en su borde, hacia donde queda", () => {
    const v = view(Math.PI / 2);
    const inside = toEdge(v, toMini(v, 110, -40), 12);
    expect(inside.outside).toBe(false);
    // 500 m al norte (delante): arriba, en el borde.
    const far = toEdge(v, toMini(v, 100, 450), 12);
    expect(far.outside).toBe(true);
    expect(far.x).toBeCloseTo(100, 6);
    expect(far.y).toBeCloseTo(12, 6);
    // 500 m al este (a la derecha): en el borde derecho, a la altura del robot.
    const east = toEdge(v, toMini(v, 600, -50), 12);
    expect(east.x).toBeCloseTo(188, 6);
    expect(east.y).toBeCloseTo(200 * MINI_ROBOT_Y, 6);
    expect(east.angle).toBeCloseTo(0, 6);
  });
});
