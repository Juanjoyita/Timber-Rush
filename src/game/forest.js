// forest.js — Construcción del escenario Low Poly de un bosque.
// FASE 4: terreno ondulado que se extiende al horizonte, bosque abundante con
// arboledas naturales, vegetación instanciada y campamento maderero.
// La tala y la regeneración se añadirán en la Fase 6.
//
// OPTIMIZACIÓN aplicada en este archivo:
// - Cada GLB se carga UNA vez y solo se reutiliza su geometría.
// - UN único material para toda la naturaleza (colores en los vértices).
// - InstancedMesh para todos los árboles (talables y decorativos) y la vegetación:
//   1 draw call por modelo. Cada árbol talable conserva su propio registro de datos y
//   su instancia se puede ocultar por separado (cámara dentro de la copa, tala en la Fase 6).
// - Rejilla espacial para comprobar distancias sin comparar todos contra todos.
// - Objetos estáticos con matrixAutoUpdate = false.
// - Terreno en dos mallas: detallada cerca y muy simple a lo lejos.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { allFootprints, MAX_SAWMILL_LEVEL, stageColliders } from './sawmillStages.js';
import { applyForestTheme, createExtraKinds } from './forestThemes.js';
import { createLandmark, landmarkShape } from './landmarks.js';
import { CHESTS, TRAVEL } from '../config.js';
import { MAX_HOME_LEVEL, VILLAGE_FOOTPRINTS, villageColliders } from './village.js';

const MODEL_PATH = '/assets/models/';

// Distribución del mundo (unidades = metros)
export const WORLD = {
  playHalf: 60, // Zona jugable: cuadrado de 120 × 120 (límites físicos en la Fase 5)
  innerHalf: 100, // Terreno detallado: hasta ±100 (zona jugable + franja de bosque exterior)
  innerSegments: 80, // Celdas de 2,5 m
  outerHalf: 500, // Terreno lejano hasta el horizonte
  outerSegments: 50, // Celdas de 20 m (se ve de lejos y con niebla)
  spawn: { x: 0, z: 8 }, // Punto de aparición del jugador (Fase 5)
  sawmill: { x: -15, z: -6 }, // Origen del aserradero (sin rotación: zonas alineadas a los ejes)
};

// Zonas del aserradero en coordenadas del mundo (rectángulos alineados a los ejes → AABB)
const SM = WORLD.sawmill;
export const SAWMILL_AREAS = {
  // Recinto completo: cobertizo + almacén + plataforma de venta
  compound: { minX: SM.x - 4.2, maxX: SM.x + 9.1, minZ: SM.z - 3.4, maxZ: SM.z + 8.8 },
  // Plataforma de venta: aquí irá el trigger AABB de la Fase 7
  sellZone: { minX: SM.x + 5.2, maxX: SM.x + 8.8, minZ: SM.z - 3.3, maxZ: SM.z + 0.3 },
  // Suelos de madera (sonido de pasos): el del cobertizo (8 × 6 m) y la plataforma de venta
  woodenFloors: [
    { minX: SM.x - 4, maxX: SM.x + 4, minZ: SM.z - 3, maxZ: SM.z + 3 },
    { minX: SM.x + 5.1, maxX: SM.x + 8.9, minZ: SM.z - 3.4, maxZ: SM.z + 0.4 },
  ],
};

// Evolución del aserradero: huellas de TODAS las piezas de las etapas (nivel 10). El bosque se
// despeja alrededor de ellas desde el principio (así nunca aparece un edificio dentro de un
// árbol al comprar un nivel) y el terreno se aplana bajo todas.
export const SAWMILL_STAGE_FOOTPRINTS = allFootprints(SM);
const unionRect = (rects) => ({
  minX: Math.min(...rects.map((r) => r.minX)), maxX: Math.max(...rects.map((r) => r.maxX)),
  minZ: Math.min(...rects.map((r) => r.minZ)), maxZ: Math.max(...rects.map((r) => r.maxZ)),
});
// Rectángulo que envuelve el recinto actual y todas las etapas (zona plana)
export const SAWMILL_EXPANSION = unionRect([SAWMILL_AREAS.compound, ...SAWMILL_STAGE_FOOTPRINTS]);

// Aldea (Fase 11D): huellas de TODAS sus piezas (nivel máximo). Se despeja y se aplana desde el
// principio, en los cinco bosques, para que ninguna compra haga aparecer una casa dentro de un
// árbol. La vivienda (y el lugar para dormir) está aquí desde el nivel 0.
export const VILLAGE_AREA = unionRect(VILLAGE_FOOTPRINTS);
const VILLAGE_BLEND = [1.5, 13]; // m: plano hasta 1,5 m de cada pieza; relieve completo a 13 m

/** 0 junto a las piezas de la aldea, 1 lejos (subida gradual: el suelo físico la sigue bien). */
function villageFlat(x, z) {
  if (distanceToRect(x, z, VILLAGE_AREA) >= VILLAGE_BLEND[1]) return 1;
  let d = Infinity;
  for (const f of VILLAGE_FOOTPRINTS) d = Math.min(d, distanceToRect(x, z, f));
  return smoothstep(VILLAGE_BLEND[0], VILLAGE_BLEND[1], d);
}

/** Tipo de suelo bajo un punto: 'wood' sobre el cobertizo o la plataforma, 'grass' en el resto. */
export function surfaceAt(x, z) {
  return SAWMILL_AREAS.woodenFloors.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ? 'wood' : 'grass';
}

// Caminos de tierra (segmentos). El primero lleva del spawn a la plataforma de venta;
// los otros son sendas que se adentran en el bosque.
export const PATHS = [
  { ax: 0, az: 5, bx: SAWMILL_AREAS.sellZone.maxX, bz: SM.z - 1.5, width: 1.8 },
  { ax: 3, az: 9, bx: 42, bz: 22, width: 1.3 },
  { ax: 1, az: 13, bx: 14, bz: 48, width: 1.3 },
  { ax: 3, az: 4, bx: 30, bz: -38, width: 1.3 },
];

// Claro del campamento: distancia libre de árboles alrededor del recinto
const CAMP_CLEARING = 7;
const SPAWN_CLEARING = 6;

// Elevaciones aisladas MUY lejanas (no rodean al jugador): solo dan relieve al horizonte
const DISTANT_HILLS = [
  { x: 200, z: -230, h: 28, r: 55 },
  { x: -280, z: -140, h: 35, r: 65 },
  { x: -170, z: 260, h: 24, r: 50 },
  { x: 300, z: 150, h: 30, r: 60 },
  { x: 40, z: 330, h: 22, r: 55 },
];

// ---------- Utilidades ----------

/**
 * Generador pseudoaleatorio con semilla (algoritmo mulberry32).
 * Con la misma semilla produce siempre la misma secuencia: el bosque es idéntico en cada partida.
 */
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const range = (rand, min, max) => min + rand() * (max - min);
const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distancia de un punto (px, pz) al segmento A-B en el plano XZ. */
function distanceToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Distancia de un punto a un rectángulo (0 si está dentro). */
function distanceToRect(x, z, r) {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

/** Distancia al borde del camino más cercano (negativa = encima del camino). */
export function distanceToPaths(x, z) {
  let best = Infinity;
  for (const p of pathSegments) best = Math.min(best, distanceToSegment(x, z, p.ax, p.az, p.bx, p.bz) - p.width);
  return best;
}

// Caminos del bosque activo (Fase 11A): el principal (inicio → plataforma de venta) es el mismo
// en todos; las sendas secundarias son propias de cada bosque (config.paths: líneas quebradas).
let pathSegments = PATHS;
/** Segmentos de los caminos del bosque activo (para las pruebas y el terreno). */
export const activePaths = () => pathSegments;
function pathsFor(config) {
  if (!config?.paths) return PATHS;
  const segments = [PATHS[0]];
  for (const { points, width = 1.3 } of config.paths) {
    for (let i = 0; i + 1 < points.length; i++) segments.push({ ax: points[i][0], az: points[i][1], bx: points[i + 1][0], bz: points[i + 1][1], width });
  }
  return segments;
}

// Elemento emblemático del bosque activo (lago, árbol gigante…): ver landmarks.js
let landmark = null;
export const activeLandmark = () => landmark;

// ---------- Relieve de cada bosque (Fase 11A) ----------
// Cada bosque tiene su relieve (config.terrain): ondulación más o menos marcada, colinas u
// hondonadas propias y montañas en el horizonte. El campamento, el aserradero y el inicio
// siguen siendo planos en todos. Solo hay un bosque construido a la vez: createForest activa
// su relieve y heightAt (terreno visual, física, cámara, tala) lo usa.
// El Bosque Verde no define terrain: su relieve es exactamente el de antes.
const DEFAULT_TERRAIN = { waves: 1, features: [], horizon: DISTANT_HILLS, blend: 10 };
let terrain = DEFAULT_TERRAIN;

/** Activa el relieve de un bosque (determinista: misma semilla = mismo relieve). */
export function setTerrain(config) {
  pathSegments = pathsFor(config);
  landmark = config?.landmark ?? null;
  const t = config?.terrain;
  if (!t) {
    terrain = DEFAULT_TERRAIN;
    return terrain;
  }
  const rand = createRandom((config.seed ?? 1) + 11);
  const features = [];
  const H = WORLD.playHalf - 4;
  for (const spec of [t.hills, t.hollows].filter(Boolean)) {
    let placed = 0;
    for (let attempt = 0; placed < spec.count && attempt < spec.count * 60; attempt++) {
      const x = range(rand, -H, H), z = range(rand, -H, H);
      const h = range(rand, spec.height[0], spec.height[1]), r = range(rand, spec.radius[0], spec.radius[1]);
      // Lejos del campamento y del inicio (allí el suelo es plano)
      if (distanceToRect(x, z, SAWMILL_EXPANSION) < r * 1.5 + 10 || Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) < r * 1.5 + 12) continue;
      if (distanceToRect(x, z, VILLAGE_AREA) < r * 1.5 + VILLAGE_BLEND[1]) continue; // Ni junto a la aldea (Fase 11D)
      if (features.some((f) => Math.hypot(f.x - x, f.z - z) < (f.r + r) * 0.7)) continue; // Sin amontonarse
      if (landmark && Math.hypot(landmark.x - x, landmark.z - z) < landmark.clear + r * 1.5) continue; // Ni sobre el lago o el árbol
      features.push({ x, z, h, r });
      placed++;
    }
  }
  let horizon = DISTANT_HILLS;
  if (t.horizon) {
    horizon = [];
    for (let i = 0; i < t.horizon.count; i++) {
      const a = (i / t.horizon.count) * Math.PI * 2 + range(rand, -0.25, 0.25);
      const d = range(rand, t.horizon.distance[0], t.horizon.distance[1]);
      horizon.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h: range(rand, t.horizon.height[0], t.horizon.height[1]), r: range(rand, t.horizon.radius[0], t.horizon.radius[1]) });
    }
  }
  // blend: distancia (m) a la que el relieve alcanza su altura completa desde las zonas planas.
  // Más amplia que en el Verde: con más relieve, la subida desde el campamento es suave.
  terrain = { waves: t.waves ?? 1, features, horizon, blend: 10 + 2.5 * (t.waves ?? 1) + 4 };
  return terrain;
}

/** Relieve activo (para las pruebas). */
export const activeTerrain = () => terrain;

/**
 * Altura del terreno:
 * - Ondulaciones suaves en todo el bosque (más marcadas según el bosque) y colinas u
 *   hondonadas propias.
 * - Totalmente plano en el campamento y el spawn.
 * - Elevaciones muy lejos, en el horizonte (montañas en el Nevado).
 */
export function heightAt(x, z) {
  let h =
    terrain.waves *
    (0.35 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06 - 0.4) +
      0.25 * Math.sin((x + z) * 0.045 + 2.1) +
      0.15 * Math.cos((x - z) * 0.11));
  for (const f of terrain.features) {
    const d2 = (x - f.x) ** 2 + (z - f.z) ** 2;
    if (d2 < 9 * f.r * f.r) h += f.h * Math.exp(-d2 / (2 * f.r * f.r));
  }
  // Aplanado progresivo: 0 dentro de los claros, ondulación completa a pocos metros
  let flat = Math.min(
    smoothstep(3, terrain.blend, distanceToRect(x, z, SAWMILL_EXPANSION)),
    smoothstep(3, terrain.blend - 1, Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z)),
    villageFlat(x, z) // Aldea en suelo plano (solo alrededor de sus piezas, con una transición suave)
  );
  // Elemento emblemático: suelo plano a su alrededor + su propia forma (cuenco, loma…)
  let shape = 0;
  if (landmark) {
    const d = Math.hypot(x - landmark.x, z - landmark.z);
    if (d < landmark.clear + 8) {
      flat = Math.min(flat, smoothstep(landmark.clear - 2, landmark.clear + 8, d));
      shape = landmarkShape(landmark, d);
    }
  }
  h = h * flat + shape;
  let far = 0;
  for (const hill of terrain.horizon) {
    const d2 = (x - hill.x) ** 2 + (z - hill.z) ** 2;
    far += hill.h * Math.exp(-d2 / (2 * hill.r * hill.r));
  }
  // Montañas propias de un bosque: su falda no levanta el campamento ni el inicio (siempre planos)
  return h + (terrain === DEFAULT_TERRAIN ? far : far * flat);
}

/** Matriz de transformación (posición + giro + escala) para instancias. */
const _q = new THREE.Quaternion();
const _euler = new THREE.Euler();
function makeMatrix(x, y, z, rotY, sx, sy = sx, sz = sx, rotX = 0) {
  _q.setFromEuler(_euler.set(rotX, rotY, 0));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}

/**
 * Rejilla espacial: guarda círculos (x, z, r) en celdas para comprobar
 * rápidamente si una posición está libre mirando solo las celdas vecinas.
 */
class SpatialGrid {
  constructor(cellSize = 4) {
    this.cell = cellSize;
    this.cells = new Map();
    this.maxR = 0;
  }

  add(x, z, r) {
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push({ x, z, r });
    this.maxR = Math.max(this.maxR, r);
  }

  /** ¿Hay al menos "gap" metros entre el círculo (x, z, r) y todos los guardados? */
  isFree(x, z, r, gap = 0) {
    const reach = r + this.maxR + gap;
    const i0 = Math.floor((x - reach) / this.cell);
    const i1 = Math.floor((x + reach) / this.cell);
    const j0 = Math.floor((z - reach) / this.cell);
    const j1 = Math.floor((z + reach) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(`${i},${j}`);
        if (list && list.some((o) => Math.hypot(x - o.x, z - o.z) < r + o.r + gap)) return false;
      }
    }
    return true;
  }
}

// ---------- Carga de modelos GLB ----------

/**
 * Extrae la geometría de un GLB y la prepara para el juego:
 * - Convierte los colores de vértice de sRGB a lineal (Three.js trabaja en lineal;
 *   sin esta conversión los colores se verían más claros y "lavados").
 * - Calcula normales (los archivos no las incluyen) para iluminación y sombras.
 */
export function prepareGeometry(gltf) {
  let source = null;
  gltf.scene.traverse((obj) => {
    if (obj.isMesh && !source) source = obj;
  });
  if (!source) throw new Error('el GLB no contiene mallas');

  source.updateWorldMatrix(true, false);
  const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);

  const colorAttr = geometry.getAttribute('color');
  if (colorAttr) {
    const colors = new Float32Array(colorAttr.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < colorAttr.count; i++) {
      // getX/Y/Z ya devuelven valores 0-1 (el atributo está normalizado)
      c.setRGB(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i), THREE.SRGBColorSpace);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    // 3 componentes (sin alfa): evita que el material use la variante con transparencia
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Carga en paralelo todos los modelos del bosque. Devuelve { nombre: geometría }. */
export async function loadForestModels(config) {
  const loader = new GLTFLoader();
  const names = [...new Set(Object.values(config.models).flat())];
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`${MODEL_PATH}${name}.glb`);
        return [name, prepareGeometry(gltf)];
      } catch (error) {
        throw new Error(`No se pudo cargar el modelo "${name}.glb" (${error.message})`);
      }
    })
  );
  return Object.fromEntries(entries);
}

// ---------- Árboles Low Poly propios (geometría de Three.js) ----------
// Amplían la variedad de formas de los 6 modelos GLB. Cada árbol se construye con piezas
// simples (cilindros, conos, icosaedros) que se FUSIONAN en una sola geometría con colores
// de vértice: usa el mismo material de naturaleza y cuesta una sola llamada de dibujo.
// Base en y = 0, eje Y hacia arriba (igual que los GLB).

const TRUNK = 0x6b4c2d;

/** Fusiona piezas [geometría, color] en una geometría no indexada con colores de vértice. */
function mergeParts(parts) {
  const positions = [];
  const colors = [];
  const c = new THREE.Color();
  for (const [geo, hex] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    c.set(hex); // sRGB → espacio de trabajo lineal (igual que los colores de los GLB)
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
    geo.dispose();
    if (g !== geo) g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

const trunk = (rTop, rBottom, height) => new THREE.CylinderGeometry(rTop, rBottom, height, 6).translate(0, height / 2, 0);
const cone = (radius, height, centerY) => new THREE.ConeGeometry(radius, height, 7).translate(0, centerY, 0);
const blob = (radius, x, y, z, sy = 1) => new THREE.IcosahedronGeometry(radius, 0).scale(1, sy, 1).translate(x, y, z);

let proceduralCache = null;

/** Devuelve { nombre: geometría } de los árboles propios (se construyen una sola vez). */
export function createProceduralTreeGeometries() {
  if (proceduralCache) return proceduralCache;
  proceduralCache = {
    // Abeto alto: cuatro conos escalonados, verdes oscuros
    proc_abeto: mergeParts([
      [trunk(0.13, 0.2, 1.3), TRUNK],
      [cone(1.35, 1.6, 1.9), 0x2f6b34],
      [cone(1.1, 1.4, 2.55), 0x3b7f3c],
      [cone(0.82, 1.2, 3.15), 0x2f6b34],
      [cone(0.5, 1.0, 3.7), 0x3b7f3c],
    ]),
    // Pino joven: esbelto, tres conos estrechos
    proc_pino_joven: mergeParts([
      [trunk(0.09, 0.13, 1.0), TRUNK],
      [cone(0.8, 1.3, 1.6), 0x4f9a43],
      [cone(0.62, 1.1, 2.25), 0x5aa84a],
      [cone(0.4, 0.9, 2.85), 0x4f9a43],
    ]),
    // Álamo: copa columnar, alta y estrecha
    proc_alamo: mergeParts([
      [trunk(0.11, 0.16, 1.2), TRUNK],
      [blob(0.8, 0, 2.9, 0, 2.3), 0x6aa84f],
      [blob(0.45, 0.1, 4.3, 0, 1.6), 0x78b85a],
    ]),
    // Roble: tronco grueso y copa ancha formada por varias masas
    proc_roble: mergeParts([
      [trunk(0.2, 0.3, 1.7), TRUNK],
      [blob(1.15, 0, 2.9, 0), 0x3f8a3a],
      [blob(0.85, 0.9, 2.6, 0.3), 0x4d9a45],
      [blob(0.9, -0.8, 2.7, -0.4), 0x4d9a45],
      [blob(0.75, 0.1, 3.6, 0.5), 0x3f8a3a],
    ]),
    // Abedul: tronco blanco con marcas oscuras y copa ligera
    proc_abedul: mergeParts([
      [trunk(0.1, 0.14, 2.4), 0xe8e4d8],
      [new THREE.CylinderGeometry(0.118, 0.118, 0.06, 6).translate(0, 0.7, 0), 0x3a3a35],
      [new THREE.CylinderGeometry(0.11, 0.11, 0.05, 6).translate(0, 1.5, 0), 0x3a3a35],
      [blob(0.75, 0, 2.8, 0, 1.2), 0x8cc152],
      [blob(0.55, 0.35, 3.5, 0.1), 0x9bcf5e],
    ]),

    // ---- Fase 11A: una especie propia por bosque (colores base verdes: el tema los adapta) ----
    // Arce (Otoñal): copa muy ancha y aplanada, formada por varias masas
    proc_arce: mergeParts([
      [trunk(0.16, 0.24, 1.6), TRUNK],
      [blob(1.3, 0, 2.8, 0, 0.75), 0x5f9e3f],
      [blob(1.0, 1.05, 2.6, 0.4, 0.7), 0x6aab47],
      [blob(1.0, -0.95, 2.7, -0.5, 0.7), 0x6aab47],
      [blob(0.9, 0.2, 3.45, -0.6, 0.7), 0x5f9e3f],
      [blob(0.8, -0.3, 3.5, 0.7, 0.65), 0x74b550],
    ]),
    // Abeto nevado (Nevado): pisos de ramas con una capa de nieve encima de cada uno
    proc_abeto_nevado: mergeParts([
      [trunk(0.12, 0.2, 1.2), TRUNK],
      ...[[1.5, 1.3, 1.7], [1.2, 1.2, 2.5], [0.9, 1.1, 3.25], [0.62, 1.0, 3.9], [0.32, 0.8, 4.5]].flatMap(([r, h, y]) => [
        [cone(r, h, y), 0x2f6b4a],
        [cone(r * 0.78, h * 0.42, y + h * 0.32), 0xf3f7fb],
      ]),
    ]),
    // Árbol retorcido (Místico): tronco quebrado en tres tramos y frutos claros colgando
    proc_retorcido: mergeParts([
      [new THREE.CylinderGeometry(0.14, 0.2, 1.3, 6).rotateZ(0.25).translate(-0.12, 0.673, 0), TRUNK],
      [new THREE.CylinderGeometry(0.11, 0.14, 1.1, 6).rotateZ(-0.4).translate(0.05, 1.65, 0), TRUNK],
      [new THREE.CylinderGeometry(0.08, 0.11, 0.9, 6).rotateZ(0.45).translate(0.08, 2.5, 0), TRUNK],
      [blob(0.95, -0.1, 3.35, 0, 0.8), 0x4f9a5a],
      [blob(0.7, 0.7, 3.0, 0.35), 0x5aa864],
      [blob(0.62, -0.75, 3.1, -0.3), 0x5aa864],
      ...[[0.55, 2.45, 0.4], [-0.55, 2.55, -0.2], [0.1, 2.35, -0.65], [0.75, 2.7, -0.35], [-0.3, 2.4, 0.6]].map(([x, y, z]) => [new THREE.IcosahedronGeometry(0.12, 0).translate(x, y, z), 0xfff07a]),
    ]),
    // Secuoya (Ancestral): tronco grueso y rojizo con la base ensanchada y copa en lo alto
    proc_secuoya: mergeParts([
      [new THREE.CylinderGeometry(0.45, 0.7, 0.8, 7).translate(0, 0.4, 0), 0x7a4028],
      [trunk(0.26, 0.45, 4.6), 0x7a4028],
      [cone(1.5, 1.5, 4.9), 0x2f6a34],
      [cone(1.2, 1.4, 5.7), 0x3b7a3c],
      [cone(0.85, 1.25, 6.4), 0x2f6a34],
      [cone(0.45, 0.95, 7.0), 0x3b7a3c],
    ]),
  };
  return proceduralCache;
}

// ---------- Materiales y mallas ----------

function createMaterials() {
  const pbr = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });

  return {
    // Material ÚNICO para todos los modelos de naturaleza: el color viene de los vértices.
    // metalness 0 (madera, hojas y piedra no son metálicas); roughness alto = acabado mate.
    nature: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 }),
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
    woodLight: pbr(0xc08a52, 0.85),
    woodDark: pbr(0x8a5a33, 0.9),
    roof: pbr(0xb3432f, 0.75),
    gold: pbr(0xe0b43a, 0.45, 0.3), // Ribete de la plataforma de venta
    metal: pbr(0xd8dde2, 0.3, 0.85), // Disco de sierra: el único material realmente metálico
    lantern: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb347, emissiveIntensity: 1.5 }),
  };
}

/** Crea una malla con sus opciones de sombra. */
function mesh(geometry, material, { cast = true, receive = false } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Crea un InstancedMesh a partir de una lista de matrices (1 draw call para todas). */
function instanced(geometry, material, matrices, { cast = false, receive = true, name = '' } = {}) {
  const im = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.name = name;
  im.computeBoundingSphere(); // Necesario para que el frustum culling funcione bien
  return im;
}

/** Agrupa matrices por nombre de modelo y crea un InstancedMesh por modelo. */
function instancedByModel(byModel, geometries, material, options) {
  const meshes = [];
  for (const [name, matrices] of byModel) {
    if (matrices.length) meshes.push(instanced(geometries[name], material, matrices, { ...options, name }));
  }
  return meshes;
}

// ---------- Densidad del bosque (arboledas) ----------

/**
 * Crea la función de densidad: suma de "manchas" gaussianas (arboledas) sobre una
 * densidad base baja. Donde la densidad es alta hay más árboles y el suelo es más oscuro.
 */
function createDensity(config, rand) {
  const groves = [];
  const H = WORLD.playHalf;
  for (let i = 0; i < config.groveCount; i++) {
    groves.push({ x: range(rand, -H, H), z: range(rand, -H, H), s: range(rand, 7, 13), w: range(rand, 0.6, 1) });
  }
  // Tres arboledas pegadas al claro del campamento: el aserradero queda rodeado de bosque
  const c = SAWMILL_AREAS.compound;
  const cx = (c.minX + c.maxX) / 2;
  const cz = (c.minZ + c.maxZ) / 2;
  for (const angle of [0.6, 2.4, 4.2]) {
    groves.push({ x: cx + Math.cos(angle) * 17, z: cz + Math.sin(angle) * 17, s: 7, w: 1 });
  }

  return (x, z) => {
    if (Math.abs(x) > WORLD.playHalf || Math.abs(z) > WORLD.playHalf) return 0.7; // Franja exterior densa
    let d = config.baseDensity ?? 0.12; // Densidad fuera de las arboledas
    for (const g of groves) d += g.w * Math.exp(-((x - g.x) ** 2 + (z - g.z) ** 2) / (2 * g.s * g.s));
    return Math.min(1, d);
  };
}

// ---------- Terreno ----------

/**
 * Terreno en dos mallas que comparten material:
 * - Interior (±100 m, celdas de 2,5 m): zona jugable y franja de bosque.
 * - Exterior (±500 m, celdas de 20 m): llanura hasta el horizonte. Sus vértices
 *   que caen debajo del interior se hunden para que no se vean ni parpadeen.
 * Un color por cara (Low Poly), con praderas claras, suelo oscuro bajo las
 * arboledas, caminos de tierra y relieve lejano.
 */
function createTerrain(colors, density, rand, material) {
  const grass = new THREE.Color(colors.grass);
  const meadow = new THREE.Color(colors.meadow);
  const forestFloor = new THREE.Color(colors.forestFloor);
  const hill = new THREE.Color(colors.hill);
  const dirt = new THREE.Color(colors.dirt);
  const c = new THREE.Color();

  const build = (half, segments, sinkInside) => {
    const plane = new THREE.PlaneGeometry(half * 2, half * 2, segments, segments).rotateX(-Math.PI / 2);
    const pos = plane.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const hidden = sinkInside && Math.abs(x) < WORLD.innerHalf && Math.abs(z) < WORLD.innerHalf;
      pos.setY(i, heightAt(x, z) - (hidden ? 3 : 0));
    }
    const geo = plane.toNonIndexed();
    plane.dispose();
    geo.computeVertexNormals();

    const p = geo.attributes.position;
    const colorArray = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;

      if (distanceToPaths(x, z) < 0 || distanceToRect(x, z, SAWMILL_AREAS.compound) < 1) {
        c.copy(dirt);
      } else {
        // Manchas de pradera clara (ruido suave) + suelo oscuro bajo las arboledas
        const patch = 0.5 + 0.5 * Math.sin(x * 0.05 + z * 0.03) * Math.cos(z * 0.07 - x * 0.02);
        c.copy(grass).lerp(meadow, patch * 0.45).lerp(forestFloor, density(x, z) * 0.6);
        if (y > 1) c.lerp(hill, Math.min(1, y / 20));
      }
      c.offsetHSL(0, 0, (rand() - 0.5) * 0.05); // Ligera variación por cara
      for (let v = 0; v < 3; v++) c.toArray(colorArray, (i + v) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    return mesh(geo, material, { cast: false, receive: true });
  };

  const inner = build(WORLD.innerHalf, WORLD.innerSegments, false);
  inner.name = 'terreno-interior';
  const outer = build(WORLD.outerHalf, WORLD.outerSegments, true);
  outer.name = 'terreno-exterior';
  outer.receiveShadow = false; // Lejos de la zona de sombras
  return [inner, outer];
}

// ---------- Aserradero ----------
// Coordenadas locales: el cobertizo ocupa x[-4, 4] z[-3, 3]; el almacén z[4, 8.6];
// la plataforma de venta está delante (x ≈ 7). El frente abierto mira hacia +X (el camino).
// Las piezas marcadas como "solid" generan también una caja de colisión (Fase 5),
// así la parte visual y la física se definen en el mismo sitio y siempre coinciden.

function createSawmill(geometries, logNames, mats) {
  const group = new THREE.Group();
  group.name = 'aserradero';
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); // Una sola caja escalada para todas las piezas

  // Las piezas se agrupan por material y se dibujan con un InstancedMesh por grupo
  const batches = { dark: [], light: [], roof: [], gold: [] };
  // Cajas de colisión en coordenadas del MUNDO: { x, y, z } centro y { hx, hy, hz } semiejes
  const colliders = [];
  const addCollider = (sx, sy, sz, x, y, z) =>
    colliders.push({ x: SM.x + x, y, z: SM.z + z, hx: sx / 2, hy: sy / 2, hz: sz / 2 });
  const box = (batch, sx, sy, sz, x, y, z, { rotX = 0, solid = false } = {}) => {
    batches[batch].push(makeMatrix(x, y, z, 0, sx, sy, sz, rotX));
    if (solid) addCollider(sx, sy, sz, x, y, z);
  };
  const solid = { solid: true };

  // --- Cobertizo abierto ---
  // Suelo de 0,15 m: el personaje puede subir a él caminando (como a la plataforma de venta)
  box('light', 8, 0.15, 6, 0, 0.075, 0, solid);
  for (const x of [-3.8, 0, 3.8]) {
    for (const z of [-2.8, 2.8]) box('dark', 0.3, 3.35, 0.3, x, 1.825, z, solid); // Postes
  }
  box('dark', 8, 0.25, 0.3, 0, 3.55, 2.8); // Vigas
  box('dark', 8, 0.25, 0.3, 0, 3.55, -2.8);
  box('dark', 8.8, 0.25, 0.25, 0, 5.1, 0); // Cumbrera
  box('roof', 8.8, 0.2, 3.4, 0, 4.32, 1.49, { rotX: 0.5 }); // Tejado rojo a dos aguas
  box('roof', 8.8, 0.2, 3.4, 0, 4.32, -1.49, { rotX: -0.5 });
  box('light', 0.25, 1.4, 5.6, -3.9, 0.85, 0, solid); // Murete trasero (el resto queda abierto)

  // --- Zona de procesado: mesa con disco de sierra y un tronco preparado ---
  // Es la mesa provisional: desde el nivel 4 del aserradero la sustituye la sierra circular del
  // paquete (sawmillStages.js oculta este grupo; la colisión es la misma).
  const legacyTable = new THREE.Group();
  legacyTable.name = 'mesa-provisional';
  const tableTop = mesh(boxGeo, mats.woodLight, { cast: true, receive: true });
  tableTop.scale.set(1.4, 0.9, 3.4);
  tableTop.position.set(0.8, 0.6, 0);
  addCollider(1.4, 0.9, 3.4, 0.8, 0.6, 0);
  const blade = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 14).rotateZ(Math.PI / 2), mats.metal);
  blade.position.set(0.8, 1.15, -0.7);
  const tableLog = mesh(geometries[logNames[1]], mats.nature);
  tableLog.position.set(0.8, 1.05, 0.8);
  legacyTable.add(tableTop, blade, tableLog);
  group.add(legacyTable);

  // --- Almacén delimitado por una valla (entrada libre en el lado +X, de z=4 a z=6.3) ---
  const fencePost = (x, z) => box('dark', 0.18, 1.1, 0.18, x, 0.55, z, solid);
  // Contadores enteros: sumar decimales acumularía error de redondeo y podría saltarse un poste
  for (let i = 0; i <= 4; i++) fencePost(-3.5, 4 + i * 1.15);
  for (let i = 1; i <= 4; i++) fencePost(-3.5 + i * 1.75, 8.6);
  for (const z of [6.3, 7.45]) fencePost(3.5, z);
  for (const y of [0.45, 0.85]) {
    box('dark', 0.08, 0.1, 4.6, -3.5, y, 6.3, solid); // Travesaños
    box('dark', 7.0, 0.1, 0.08, 0, y, 8.6, solid);
    box('dark', 0.08, 0.1, 2.3, 3.5, y, 7.45, solid);
  }

  // --- Pila de troncos (log_01 y log_02) preparada para actualizarse ---
  // Dos pirámides de 4-3-2-1 troncos. Los huecos se ordenan de abajo arriba y se
  // alternan entre los dos modelos; así, mostrar los N primeros llena la pila con naturalidad.
  const slots = [];
  for (let layer = 0; layer < 4; layer++) {
    for (const pileX of [-1.75, 1.05]) {
      for (let i = 0; i < 4 - layer; i++) {
        slots.push({ x: pileX, y: layer * 0.46, z: 5.0 + layer * 0.3 + i * 0.6 });
      }
    }
  }
  const logMatrices = [[], []];
  slots.forEach((s, i) => {
    // log_02 viene orientado en Z: se gira 90° para alinearlo con log_01 (eje X)
    const rotY = i % 2 === 0 ? 0 : Math.PI / 2;
    logMatrices[i % 2].push(makeMatrix(s.x, s.y, s.z, rotY, 1));
  });
  const logPiles = logNames.map((name, k) =>
    instanced(geometries[name], mats.nature, logMatrices[k], { cast: true, receive: true, name: 'pila-troncos' })
  );
  // Una sola caja de colisión invisible envuelve las dos pilas
  addCollider(4.8, 1.9, 3.0, -0.35, 0.95, 5.9);

  // --- Plataforma de venta (solo visual; el trigger AABB llega en la Fase 7) ---
  box('light', 3.6, 0.12, 3.6, 7, 0.06, -1.5);
  addCollider(3.8, 0.12, 3.8, 7, 0.06, -1.5); // La colisión incluye el ribete: se sube caminando
  box('gold', 3.8, 0.16, 0.15, 7, 0.08, -3.35); // Ribete dorado
  box('gold', 3.8, 0.16, 0.15, 7, 0.08, 0.35);
  box('gold', 0.15, 0.16, 3.8, 5.15, 0.08, -1.5);
  box('gold', 0.15, 0.16, 3.8, 8.85, 0.08, -1.5);
  box('dark', 0.15, 2.4, 0.15, 8.95, 1.2, 0.45, solid); // Poste del farol

  // --- Puestos de los trabajadores (Fase 9): bajo el cobertizo, entre el murete y la mesa ---
  // Cada puesto: un tocón donde se corta la madera y el sitio del Worker, que mira hacia +X
  // (el frente abierto: se le ve trabajar al acercarse). Una caja sólida evita atravesarlos.
  const workerSpots = [];
  for (const z of [-1.5, 1.5]) {
    const block = new THREE.Mesh(geometries.nature_stump_01, mats.nature);
    block.name = 'tocon-de-trabajo';
    block.position.set(-1.45, 0.15, z);
    block.scale.setScalar(0.6);
    block.castShadow = true;
    block.receiveShadow = true;
    group.add(block);
    addCollider(1.7, 1.8, 1.0, -1.95, 0.9, z);
    workerSpots.push({ x: SM.x - 2.3, y: 0.15, z: SM.z + z, yaw: Math.PI / 2 });
  }

  // Farol: PointLight cálida que señala la zona de venta. Sin sombras y alcance corto.
  const lantern = mesh(boxGeo, mats.lantern, { cast: false });
  lantern.scale.set(0.25, 0.35, 0.25);
  lantern.position.set(8.95, 2.55, 0.45);
  const lanternLight = new THREE.PointLight(0xffc46b, 8, 9, 2);
  lanternLight.position.copy(lantern.position);
  group.add(lantern, lanternLight);

  group.add(
    instanced(boxGeo, mats.woodDark, batches.dark, { cast: true, receive: true, name: 'madera-oscura' }),
    instanced(boxGeo, mats.woodLight, batches.light, { cast: true, receive: true, name: 'madera-clara' }),
    instanced(boxGeo, mats.roof, batches.roof, { cast: true, receive: false, name: 'tejado' }),
    instanced(boxGeo, mats.gold, batches.gold, { cast: false, receive: true, name: 'ribete-venta' }),
    ...logPiles
  );
  group.position.set(SM.x, 0, SM.z); // El campamento es totalmente plano (y = 0)

  /**
   * Muestra la pila de troncos llena en la proporción indicada (0 = vacía, 1 = llena).
   * Fase 9: refleja lo que hay en el almacén (la madera de los trabajadores).
   */
  const setLogPile = (fraction) => {
    const n = Math.round(Math.max(0, Math.min(1, fraction)) * slots.length);
    logPiles[0].count = Math.ceil(n / 2); // Huecos pares
    logPiles[1].count = Math.floor(n / 2); // Huecos impares
  };

  // Obstáculos para la cámara: las piezas sólidas + el volumen del tejado
  const cameraBoxes = [...colliders, { x: SM.x, y: 4.3, z: SM.z, hx: 4.4, hy: 1.0, hz: 3.2 }];

  return { group, setLogPile, logSlots: slots.length, colliders, cameraBoxes, workerSpots, legacyTable, lanternLight };
}

// ---------- Zonas reservadas ----------

/**
 * Claros pequeños repartidos por el bosque (sin árboles), alejados del campamento y del spawn.
 */
function createClearings(rand) {
  const clearings = [];
  for (let attempt = 0; clearings.length < 4 && attempt < 200; attempt++) {
    const x = range(rand, -50, 50);
    const z = range(rand, -50, 50);
    const r = range(rand, 4, 6);
    if (distanceToRect(x, z, SAWMILL_AREAS.compound) < CAMP_CLEARING + r + 6) continue;
    if (Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) < SPAWN_CLEARING + r + 6) continue;
    if (clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r + 10)) continue;
    clearings.push({ x, z, r });
  }
  return clearings;
}

/**
 * Margen libre que necesita cada tipo de objeto respecto a camino, campamento, spawn y claros.
 * Los árboles necesitan más espacio; la hierba puede crecer casi hasta el borde del camino.
 */
const MARGINS = {
  tree: { path: 1.5, camp: CAMP_CLEARING, spawn: SPAWN_CLEARING, clearing: 1 },
  rock: { path: 1.2, camp: 4, spawn: 4, clearing: 0.6 },
  bush: { path: 0.9, camp: 3.5, spawn: 3.5, clearing: 0.5 },
  plant: { path: 0.15, camp: 1, spawn: 1.5, clearing: 0 },
};

// Distancia libre alrededor de cada pieza de las etapas del aserradero (además de su radio)
const STAGE_CLEARANCE = { tree: 2.5, rock: 1, bush: 1.2, plant: 0.4 };

/**
 * ¿Cae en el claro de las etapas del aserradero? Se comprueba DESPUÉS de colocar cada objeto
 * (con todos sus números aleatorios ya tomados) y el objeto sigue ocupando su sitio en las
 * rejillas: así el resto del bosque queda exactamente igual que antes; solo desaparece lo
 * que estaba junto a las nuevas construcciones.
 */
export function inStageClearing(x, z, radius, kind) {
  const margin = STAGE_CLEARANCE[kind] + radius;
  if (distanceToRect(x, z, VILLAGE_AREA) < margin + 2 && VILLAGE_FOOTPRINTS.some((f) => distanceToRect(x, z, f) < margin)) return true; // Aldea (Fase 11D)
  if (distanceToRect(x, z, SAWMILL_EXPANSION) >= margin) return false;
  return SAWMILL_STAGE_FOOTPRINTS.some((f) => distanceToRect(x, z, f) < margin);
}

// Zona del elemento emblemático que se deja libre según el tipo de objeto (las plantas pueden
// crecer alrededor, pero no en el agua ni dentro del árbol o las ruinas)
const LANDMARK_RESERVE = { tree: 1, rock: 1, bush: 0.9 };
function inLandmarkArea(x, z, radius, kind) {
  if (!landmark) return false;
  const reach = kind === 'plant' ? landmark.plantClear : landmark.clear * LANDMARK_RESERVE[kind];
  return Math.hypot(x - landmark.x, z - landmark.z) < reach + radius;
}

function isReserved(x, z, radius, kind, clearings) {
  const m = MARGINS[kind];
  return (
    inLandmarkArea(x, z, radius, kind) ||
    distanceToPaths(x, z) < m.path + radius ||
    distanceToRect(x, z, SAWMILL_AREAS.compound) < m.camp + radius ||
    Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) < m.spawn + radius ||
    clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r * m.clearing + radius)
  );
}

// ---------- Perfil del tronco visible ----------
// Radio de la base y altura del tronco de un modelo, medidos en sus vértices de corteza (el
// color del vértice más bajo). La colisión de cada árbol se ajusta a su tronco VISIBLE en vez
// de usar un radio común: cada árbol choca donde se ve su tronco.
const trunkProfiles = new WeakMap();
export function trunkProfile(geometry) {
  if (trunkProfiles.has(geometry)) return trunkProfiles.get(geometry);
  const p = geometry.attributes.position;
  const c = geometry.attributes.color;
  let lowest = 0;
  for (let i = 1; i < p.count; i++) if (p.getY(i) < p.getY(lowest)) lowest = i;
  const bark = [c.getX(lowest), c.getY(lowest), c.getZ(lowest)];
  let base = 0;
  let height = 0;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(c.getX(i) - bark[0]) + Math.abs(c.getY(i) - bark[1]) + Math.abs(c.getZ(i) - bark[2]) > 0.02) continue;
    height = Math.max(height, p.getY(i));
    if (p.getY(i) < 0.05) base = Math.max(base, Math.hypot(p.getX(i), p.getZ(i)));
  }
  const profile = { base, height };
  trunkProfiles.set(geometry, profile);
  return profile;
}
const TRUNK_MARGIN = 0.02; // Margen de la colisión sobre el tronco visible (m)

// ---------- Visibilidad de árboles instanciados ----------
// Cada árbol (talable o decorativo) es una instancia de un InstancedMesh. Para ocultar uno
// se sustituye su matriz por una de escala 0 y se marca el buffer para subirlo a la GPU.
// Un árbol puede estar oculto por varios motivos a la vez (bits): solo se ve si no hay ninguno.
export const HIDE_REASON = { CAMERA: 1, FELLED: 2 }; // FELLED se usará en la Fase 6
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const CAMERA_MARGIN = 0.6; // Distancia extra alrededor de la copa (m)

function createTreeVisibility(entries) {
  const dirty = new Set();
  const apply = (entry) => {
    entry.mesh.setMatrixAt(entry.index, entry.hidden ? HIDDEN_MATRIX : entry.matrix);
    dirty.add(entry.mesh);
  };
  const flush = () => {
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
    dirty.clear();
  };
  return {
    /** Oculta o muestra un árbol por un motivo concreto (HIDE_REASON). */
    setHidden(entry, reason, hidden) {
      const before = entry.hidden;
      entry.hidden = hidden ? entry.hidden | reason : entry.hidden & ~reason;
      if ((before === 0) !== (entry.hidden === 0)) apply(entry);
      flush();
    },
    /**
     * Oculta los árboles que tienen la cámara dentro de su copa o pegada a ella.
     * Sin esto, en un bosque denso la cámara en tercera persona atraviesa las copas y los
     * árboles se ven "cortados" (caras interiores invisibles y tronco recortado por el plano
     * cercano). Son ~660 comprobaciones de distancia por fotograma: un coste mínimo.
     */
    updateCameraOcclusion(camera) {
      const { x, y, z } = camera;
      for (const e of entries) {
        const dx = x - e.x, dz = z - e.z;
        const inside = dx * dx + dz * dz < e.reach * e.reach && y < e.top + CAMERA_MARGIN && y > e.base - 1;
        const wasHidden = (e.hidden & HIDE_REASON.CAMERA) !== 0;
        if (inside === wasHidden) continue;
        const before = e.hidden;
        e.hidden = inside ? e.hidden | HIDE_REASON.CAMERA : e.hidden & ~HIDE_REASON.CAMERA;
        if ((before === 0) !== (e.hidden === 0)) apply(e);
      }
      flush();
    },
  };
}

/** Datos de visibilidad de una instancia de árbol: posición, copa y altura. */
function treeEntry(geometry, matrix, x, base, z, width, height) {
  const bb = geometry.boundingBox;
  const canopy = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * width;
  return { matrix, x, z, base, top: base + bb.max.y * height, reach: canopy + CAMERA_MARGIN, mesh: null, index: -1, hidden: 0 };
}

// ---------- Accesibilidad a pie ----------

// Radio de la esfera física del personaje (m). Representa el volumen real del Worker: con
// 0,35 m sus pies y brazos (que sobresalen hasta 0,47 m parado) entraban en los troncos.
// (physics.js lo reexporta.)
export const PLAYER_RADIUS = 0.45;
const WALK_CELL = 0.25; // Resolución de la rejilla de accesibilidad (m)
const CHOP_REACH = 1.0; // Distancia máxima al tronco para considerarlo talable a pie (m)

/**
 * Rejilla de la zona jugable con las celdas por las que puede pasar el personaje (su radio
 * incluido) y relleno por inundación desde el punto de inicio.
 * @returns (x, z) => true si se puede llegar caminando a ese punto
 */
function createWalkability({ trees, rocks, decorColliders, boxes, circles = [] }) {
  const H = WORLD.playHalf;
  const N = Math.ceil((2 * H) / WALK_CELL);
  const blocked = new Uint8Array(N * N);
  const cell = (v) => Math.floor((v + H) / WALK_CELL);
  const center = (i) => -H + (i + 0.5) * WALK_CELL;
  const stamp = (minX, maxX, minZ, maxZ, test) => {
    for (let i = Math.max(0, cell(minX)); i <= Math.min(N - 1, cell(maxX)); i++) {
      for (let j = Math.max(0, cell(minZ)); j <= Math.min(N - 1, cell(maxZ)); j++) if (test(center(i), center(j))) blocked[i * N + j] = 1;
    }
  };
  const circle = (x, z, r) => {
    const R = r + PLAYER_RADIUS;
    stamp(x - R, x + R, z - R, z + R, (cx, cz) => (cx - x) ** 2 + (cz - z) ** 2 < R * R);
  };
  for (const t of trees) circle(t.position.x, t.position.z, t.userData.radius);
  for (const c of circles) circle(c.x, c.z, c.r); // Elemento emblemático (tronco, piedras…)
  // Rocas con su tamaño visual completo (más prudente que su colisión, que es el 80 %)
  for (const r of rocks) circle(r.position.x, r.position.z, r.userData.radius);
  for (const c of decorColliders) {
    const cos = Math.cos(c.rotY), sin = Math.sin(c.rotY), R = Math.hypot(c.hx, c.hz) + PLAYER_RADIUS;
    stamp(c.x - R, c.x + R, c.z - R, c.z + R, (cx, cz) => {
      const dx = cx - c.x, dz = cz - c.z;
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos; // Al sistema del tronco caído
      return Math.hypot(Math.max(Math.abs(lx) - c.hx, 0), Math.max(Math.abs(lz) - c.hz, 0)) < PLAYER_RADIUS;
    });
  }
  // Cajas del aserradero que no se pueden pisar (los suelos bajos, como la plataforma, sí)
  for (const b of boxes) {
    if (b.y + b.hy < 0.35) continue;
    const R = PLAYER_RADIUS;
    stamp(b.x - b.hx - R, b.x + b.hx + R, b.z - b.hz - R, b.z + b.hz + R, () => true);
  }
  // Relleno por inundación desde el punto de inicio
  const reach = new Uint8Array(N * N);
  const start = cell(WORLD.spawn.x) * N + cell(WORLD.spawn.z);
  const queue = new Int32Array(N * N);
  let head = 0, tail = 0;
  queue[tail++] = start;
  reach[start] = 1;
  while (head < tail) {
    const c = queue[head++], i = Math.floor(c / N), j = c % N;
    if (i > 0 && !blocked[c - N] && !reach[c - N]) { reach[c - N] = 1; queue[tail++] = c - N; }
    if (i < N - 1 && !blocked[c + N] && !reach[c + N]) { reach[c + N] = 1; queue[tail++] = c + N; }
    if (j > 0 && !blocked[c - 1] && !reach[c - 1]) { reach[c - 1] = 1; queue[tail++] = c - 1; }
    if (j < N - 1 && !blocked[c + 1] && !reach[c + 1]) { reach[c + 1] = 1; queue[tail++] = c + 1; }
  }
  return (x, z) => {
    const i = cell(x), j = cell(z);
    return i >= 0 && j >= 0 && i < N && j < N && reach[i * N + j] === 1;
  };
}

/** ¿Hay algún punto alcanzable a pie a menos de CHOP_REACH del tronco? */
function isChoppable(tree, canReach) {
  const R = tree.userData.radius + PLAYER_RADIUS + CHOP_REACH;
  for (let a = 0; a < 16; a++) {
    for (const r of [R * 0.6, R]) {
      const ang = (a / 16) * Math.PI * 2;
      if (canReach(tree.position.x + Math.cos(ang) * r, tree.position.z + Math.sin(ang) * r)) return true;
    }
  }
  return false;
}

// ---------- Cofres (Fase 11C) ----------

/**
 * 16 puntos posibles por bosque para los cofres: a más de 3 m de los caminos, lejos del
 * campamento, la tienda y el inicio, fuera del agua y del elemento emblemático, sin árboles,
 * rocas ni troncos cerca, separados entre sí y a los que se llega caminando. Si el bosque tiene
 * elemento emblemático, 3 de ellos están en sus alrededores (para el cofre especial).
 */
function createChestSpots(config, { obstacles, landmarkColliders, canReach }) {
  const rand = createRandom(config.seed + 31);
  const H = WORLD.playHalf - 5;
  const spots = [];
  const lm = landmark;
  // Árboles, rocas y troncos caídos: la rejilla espacial del bosque (solo las celdas vecinas)
  const free = (x, z) =>
    obstacles.isFree(x, z, 0, 1.3) &&
    landmarkColliders.spheres.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + 1.0) &&
    landmarkColliders.boxes.every((c) => Math.hypot(c.x - x, c.z - z) > Math.max(c.hx, c.hz) + 1.0);
  const valid = (x, z) =>
    Math.abs(x) < H && Math.abs(z) < H &&
    distanceToRect(x, z, SAWMILL_EXPANSION) >= CHESTS.minFromCamp &&
    distanceToRect(x, z, VILLAGE_AREA) >= CHESTS.minFromCamp &&
    Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) >= CHESTS.minFromSpawn &&
    Math.hypot(x - TRAVEL.post.x, z - TRAVEL.post.z) >= CHESTS.minFromCamp &&
    distanceToPaths(x, z) >= CHESTS.minFromPath &&
    (!lm || Math.hypot(x - lm.x, z - lm.z) >= lm.clear + 1.5) && // Ni en el agua ni dentro del árbol o las ruinas
    spots.every((s) => Math.hypot(s.x - x, s.z - z) >= CHESTS.candidateSpacing) &&
    free(x, z) &&
    canReach(x, z) && [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].some(([dx, dz]) => canReach(x + dx, z + dz));
  const add = (x, z, nearLandmark) => spots.push({ i: spots.length, x, z, y: heightAt(x, z), yaw: rand() * Math.PI * 2, nearLandmark });
  // Alrededores del elemento emblemático (lo justo fuera de su zona)
  if (lm) {
    for (let attempt = 0, n = 0; n < 3 && attempt < 400; attempt++) {
      const a = rand() * Math.PI * 2, d = lm.clear + 1.5 + rand() * 4.5;
      const x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d;
      if (valid(x, z)) {
        add(x, z, true);
        n++;
      }
    }
  }
  for (let attempt = 0; spots.length < CHESTS.candidates && attempt < 6000; attempt++) {
    const x = range(rand, -H, H), z = range(rand, -H, H);
    if (valid(x, z)) add(x, z, false);
  }
  return spots;
}

// ---------- Poste indicador (Fase 11A) ----------

/** Poste con flechas que señala los otros bosques. Devuelve { group, collider }. */
function createTravelPost(mats, at) {
  const group = new THREE.Group();
  group.name = 'poste-bosques';
  const piece = (material, sx, sy, sz, x, y, z, rotY = 0) => {
    const m = mesh(new THREE.BoxGeometry(sx, sy, sz), material, { cast: true, receive: true });
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    group.add(m);
  };
  piece(mats.woodDark, 0.2, 2.6, 0.2, 0, 1.3, 0); // Poste
  piece(mats.woodLight, 1.3, 0.32, 0.08, 0.35, 2.15, 0, 0.35); // Flechas en varias direcciones
  piece(mats.woodLight, 1.2, 0.3, 0.08, -0.3, 1.75, 0, -0.5);
  piece(mats.woodLight, 1.1, 0.28, 0.08, 0.25, 1.38, 0, 2.2);
  piece(mats.gold, 0.26, 0.12, 0.26, 0, 2.66, 0); // Remate dorado (se ve desde lejos)
  const y = heightAt(at.x, at.z);
  group.position.set(at.x, y, at.z);
  return { group, collider: { x: at.x, y: y + 1.3, z: at.z, hx: 0.15, hy: 1.3, hz: 0.15 } };
}

// ---------- API pública ----------

/**
 * Construye el bosque con las geometrías ya cargadas.
 * @returns {{ group, trees, rocks, bushes, clearings, updateCameraOcclusion, setTreeHidden, sawmillColliders, decorColliders, setLogPile, logSlots, materials }}
 *   trees, rocks y bushes guardan los datos para colisiones (Fase 5) y tala (Fase 6).
 */
export function createForest(config, geometries) {
  // Se añaden los árboles propios a las geometrías cargadas de los GLB y se aplica el tema del
  // bosque (Fase 11A). owned: geometrías creadas para este bosque (se liberan con dispose()).
  setTerrain(config); // Relieve de este bosque (heightAt lo usa a partir de aquí)
  const themedBase = { ...geometries, ...createProceduralTreeGeometries() }; // Compartidas: no se liberan
  const themed = applyForestTheme(themedBase, config);
  geometries = themed.geometries;
  const owned = themed.owned;
  // Semillas separadas: cambiar la decoración no mueve los árboles talables
  const rand = createRandom(config.seed);
  const decoRand = createRandom(config.seed + 1);
  const mats = createMaterials();
  const { models } = config;
  const H = WORLD.playHalf;
  const group = new THREE.Group();
  group.name = config.name;

  const density = createDensity(config, rand);
  const clearings = createClearings(rand);

  group.add(...createTerrain(config.colors, density, decoRand, mats.terrain));

  const sawmill = createSawmill(geometries, models.logs, mats);
  group.add(sawmill.group);

  // Elemento emblemático del bosque (Fase 11A): 1-2 mallas y pocas colisiones
  const emblem = config.landmark ? createLandmark(config.landmark, mats, heightAt) : null;
  if (emblem) {
    group.add(emblem.group);
    for (const g of emblem.owned.geometries) owned.add(g);
  }
  const landmarkColliders = emblem?.colliders ?? { spheres: [], boxes: [] };

  // spacing: separación entre árboles/rocas · obstacles: huella física (troncos, rocas, arbustos)
  const spacing = new SpatialGrid(4);
  const obstacles = new SpatialGrid(4);

  // Modelos de árbol: 6 GLB + 5 propios
  const pineModels = [...models.pines, ...config.proceduralTrees.pines];
  const roundModels = [...models.roundTrees, ...config.proceduralTrees.round];

  // --- Árboles talables: muestreo por densidad con distancia mínima (Poisson disk) ---
  // Se lanzan posiciones al azar; cada una se acepta con probabilidad = densidad local
  // y solo si respeta la distancia mínima. Resultado: arboledas densas, zonas abiertas
  // y nunca una cuadrícula.
  const trees = [];
  let treesPlaced = 0; // Incluye los que caen en el claro de las etapas (ver inStageClearing)
  const talableMatrices = new Map([...pineModels, ...roundModels].map((n) => [n, []]));
  const half = config.treeSpacing / 2;
  for (let attempt = 0; treesPlaced < config.treeCount && attempt < 100000; attempt++) {
    const x = range(rand, -H + 2, H - 2);
    const z = range(rand, -H + 2, H - 2);
    if (rand() > density(x, z)) continue;
    if (isReserved(x, z, 1.3, 'tree', clearings) || !spacing.isFree(x, z, half)) continue;

    const isPine = rand() < config.pineRatio;
    const modelName = pick(rand, isPine ? pineModels : roundModels);
    // Proporciones independientes: altura y anchura propias de cada árbol
    const height = range(rand, config.treeHeight[0], config.treeHeight[1]);
    const width = range(rand, config.treeWidth[0], config.treeWidth[1]);
    // Colisión del tronco = radio visible del modelo (escalado) + 2 cm
    const trunk = trunkProfile(geometries[modelName]);
    const radius = trunk.base * width + TRUNK_MARGIN;

    // Cada árbol es un registro de datos + una instancia del InstancedMesh de su modelo
    const y = heightAt(x, z) - 0.05; // Base apoyada (ligeramente enterrada)
    const rotationY = rand() * Math.PI * 2;
    treesPlaced++;
    spacing.add(x, z, half);
    obstacles.add(x, z, radius);
    if (inStageClearing(x, z, radius, 'tree')) continue; // Junto a las construcciones del aserradero
    const matrix = makeMatrix(x, y, z, rotationY, width, height, width);
    const tree = {
      name: `arbol-${trees.length}`,
      position: new THREE.Vector3(x, y, z),
      rotationY,
      scale: new THREE.Vector3(width, height, width),
      userData: {
        type: isPine ? 'pino' : 'redondo', model: modelName,
        radius, // Radio de colisión del tronco
        height: geometries[modelName].boundingBox.max.y * height,
        trunkHeight: trunk.height * height, // Altura del tronco visible (la cámara choca con él, no con las hojas)
      },
      instance: treeEntry(geometries[modelName], matrix, x, y, z, width, height),
    };
    talableMatrices.get(modelName).push(matrix);
    tree.instance.index = talableMatrices.get(modelName).length - 1;
    trees.push(tree);
  }

  // --- Rocas: mallas individuales (colisión en la Fase 5) ---
  const rocks = [];
  let rocksPlaced = 0;
  for (let attempt = 0; rocksPlaced < config.rockCount && attempt < 5000; attempt++) {
    const x = range(rand, -H + 3, H - 3);
    const z = range(rand, -H + 3, H - 3);
    const modelName = pick(rand, models.rocks);
    const bb = geometries[modelName].boundingBox;
    const scale = range(rand, ...(config.rockScale ?? [0.7, 1.1]));
    const radius = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * scale;
    if (isReserved(x, z, radius, 'rock', clearings) || !spacing.isFree(x, z, radius, 0.8)) continue;
    rocksPlaced++;
    spacing.add(x, z, radius);
    obstacles.add(x, z, radius);
    const rotationY = rand() * Math.PI * 2;
    if (inStageClearing(x, z, radius, 'rock')) continue;

    const rock = mesh(geometries[modelName], mats.nature, { cast: true, receive: true });
    rock.name = `roca-${rocks.length}`;
    rock.position.set(x, heightAt(x, z) - 0.1, z);
    rock.rotation.y = rotationY;
    rock.scale.setScalar(scale);
    rock.userData = { model: modelName, radius, height: bb.max.y * scale };
    rocks.push(rock);
    group.add(rock);
  }

  // --- Troncos caídos: decoración del suelo del bosque, con colisión ---
  // InstancedMesh por modelo. Cada tronco genera una caja de colisión orientada como él
  // (definida aquí, junto a la parte visual, para que siempre coincidan). Semilla propia:
  // no altera la posición de los árboles ni de las rocas.
  const logRand = createRandom(config.seed + 2);
  const logMatrices = new Map(models.logs.map((n) => [n, []]));
  const decorColliders = [];
  let logsPlaced = 0;
  for (let attempt = 0; logsPlaced < config.fallenLogCount && attempt < 20000; attempt++) {
    const x = range(logRand, -H + 4, H - 4);
    const z = range(logRand, -H + 4, H - 4);
    const name = pick(logRand, models.logs);
    const bb = geometries[name].boundingBox;
    const scale = range(logRand, ...(config.fallenLogScale ?? [0.9, 1.25]));
    const alongX = bb.max.x - bb.min.x >= bb.max.z - bb.min.z; // Eje principal del modelo
    const along = (alongX ? bb.max.x - bb.min.x : bb.max.z - bb.min.z) * scale; // Largo del tronco
    if (isReserved(x, z, along / 2, 'rock', clearings) || !spacing.isFree(x, z, along / 2, 0.6)) continue;

    const yaw = logRand() * Math.PI * 2;
    logsPlaced++;
    spacing.add(x, z, along / 2);
    obstacles.add(x, z, along / 2);
    if (inStageClearing(x, z, along / 2, 'rock')) continue;
    const y = heightAt(x, z) - 0.05;
    const height = bb.max.y * scale;
    logMatrices.get(name).push(makeMatrix(x, y, z, yaw, scale));
    // Caja: largo del tronco en su eje principal y ~0,6 m de grosor (sin contar las ramas)
    decorColliders.push({
      x, y: y + height / 2, z, rotY: yaw,
      hx: alongX ? along / 2 : 0.3 * scale,
      hy: height / 2,
      hz: alongX ? 0.3 * scale : along / 2,
    });
  }
  group.add(...instancedByModel(logMatrices, geometries, mats.nature, { cast: true, receive: true }));

  // --- Árboles talables inaccesibles: se descartan ---
  // Con un bosque tan denso, algún árbol puede quedar encerrado entre otros, rocas o troncos
  // caídos. Se calcula a dónde se puede llegar caminando desde el inicio y se quitan los árboles
  // sin ningún punto alcanzable cerca del tronco (nunca habría un árbol imposible de talar).
  // Cuenta con todas las construcciones futuras del aserradero (nivel máximo)
  const canReach = createWalkability({
    trees, rocks, boxes: [...sawmill.colliders, ...stageColliders(MAX_SAWMILL_LEVEL, SM), ...villageColliders(MAX_HOME_LEVEL, heightAt)],
    decorColliders: [...decorColliders, ...landmarkColliders.boxes.filter((b) => !b.walkable)],
    circles: landmarkColliders.spheres,
  });
  const reachableTrees = trees.filter((t) => isChoppable(t, canReach));
  trees.length = 0;
  trees.push(...reachableTrees);
  for (const list of talableMatrices.values()) list.length = 0;
  trees.forEach((tree, i) => {
    tree.name = `arbol-${i}`;
    const list = talableMatrices.get(tree.userData.model);
    list.push(tree.instance.matrix);
    tree.instance.index = list.length - 1;
  });

  // Un InstancedMesh por modelo (11): una llamada de dibujo por modelo aunque haya más de mil (+11 en sombras)
  const talableMeshes = new Map(
    instancedByModel(talableMatrices, geometries, mats.nature, { cast: true, receive: true }).map((m) => [m.name, m])
  );
  for (const tree of trees) tree.instance.mesh = talableMeshes.get(tree.userData.model);
  for (const m of talableMeshes.values()) m.name = `talables-${m.name}`; // Distinto de los decorativos
  group.add(...talableMeshes.values());

  // --- Árboles decorativos: franja de bosque exterior + algunos dispersos más lejos ---
  // InstancedMesh y sin sombras. Disimulan el límite de la zona jugable sin montañas.
  const decoGrid = new SpatialGrid(5);
  const livingTrees = [...pineModels, ...roundModels];
  const decorative = new Map([...livingTrees, ...models.deadTrees].map((n) => [n, []]));
  let decoCount = 0;
  const decoEntries = []; // Registro de cada instancia (para ocultarla si la cámara entra en su copa)
  const beltTarget = Math.round(config.decorativeTreeCount * 0.82);
  const placeDecorative = (limit, minHalf, maxHalf, minDist) => {
    for (let attempt = 0; decoCount < limit && attempt < 20000; attempt++) {
      const x = range(decoRand, -maxHalf, maxHalf);
      const z = range(decoRand, -maxHalf, maxHalf);
      if (Math.max(Math.abs(x), Math.abs(z)) < minHalf) continue; // Solo fuera del cuadrado interior
      if (!decoGrid.isFree(x, z, minDist / 2)) continue;
      const name = decoRand() < config.deadTreeRatio ? pick(decoRand, models.deadTrees) : pick(decoRand, livingTrees);
      const k = config.decorativeScale ?? 1; // Ancestral: árboles decorativos gigantes
      const h = range(decoRand, 0.9, 1.6) * k, w = range(decoRand, 0.85, 1.3) * k;
      const y = heightAt(x, z) - 0.4;
      const matrix = makeMatrix(x, y, z, decoRand() * Math.PI * 2, w, h, w);
      const entry = treeEntry(geometries[name], matrix, x, y, z, w, h);
      entry.model = name;
      entry.index = decorative.get(name).length;
      decorative.get(name).push(matrix);
      decoEntries.push(entry);
      decoGrid.add(x, z, minDist / 2);
      decoCount++;
    }
  };
  placeDecorative(beltTarget, H + 1.5, WORLD.innerHalf - 5, 2.9); // Franja densa junto al límite
  placeDecorative(config.decorativeTreeCount, WORLD.innerHalf - 5, 170, 5.5); // Dispersos hacia el horizonte
  const decoMeshes = new Map(instancedByModel(decorative, geometries, mats.nature, { cast: false, receive: false }).map((m) => [m.name, m]));
  for (const e of decoEntries) e.mesh = decoMeshes.get(e.model);
  group.add(...decoMeshes.values());

  // --- Arbustos: InstancedMesh con sombra (son voluminosos); preferentemente en los bordes de las arboledas ---
  const bushMatrices = new Map(models.bushes.map((n) => [n, []]));
  const bushes = [];
  let bushesPlaced = 0;
  for (let attempt = 0; bushesPlaced < config.bushCount && attempt < 20000; attempt++) {
    const x = range(decoRand, -H + 2, H - 2);
    const z = range(decoRand, -H + 2, H - 2);
    const d = density(x, z);
    if (decoRand() > 0.3 + d * 0.6) continue;
    const scale = range(decoRand, ...(config.bushScale ?? [0.55, 0.9]));
    const r = 1.1 * scale;
    if (isReserved(x, z, r, 'bush', clearings) || !obstacles.isFree(x, z, r, 0.6)) continue;
    const bushModel = pick(decoRand, models.bushes);
    const bushMatrix = makeMatrix(x, heightAt(x, z) - 0.05, z, decoRand() * Math.PI * 2, scale);
    bushesPlaced++;
    obstacles.add(x, z, r);
    if (inStageClearing(x, z, r, 'bush')) continue;
    bushMatrices.get(bushModel).push(bushMatrix);
    bushes.push({ x, z, r });
  }
  group.add(...instancedByModel(bushMatrices, geometries, mats.nature, { cast: true, receive: true }));

  // --- Hierba y flores: grupos irregulares, InstancedMesh y SIN sombras ---
  // Las flores abundan más en las praderas abiertas; la hierba en todas partes.
  const plants = new Map([...models.grass, ...models.flowers].map((n) => [n, []]));
  let placed = 0;
  for (let cluster = 0; placed < config.smallPlantCount && cluster < 800; cluster++) {
    const cx = range(decoRand, -H + 1, H - 1);
    const cz = range(decoRand, -H + 1, H - 1);
    const groupSize = 3 + Math.floor(decoRand() * 6); // 3-8 plantas por grupo
    const openness = 1 - density(cx, cz);
    for (let k = 0; k < groupSize && placed < config.smallPlantCount; k++) {
      const x = cx + (decoRand() - 0.5) * 3.5;
      const z = cz + (decoRand() - 0.5) * 3.5;
      if (Math.abs(x) > H || Math.abs(z) > H) continue;
      if (isReserved(x, z, 0.2, 'plant', clearings) || !obstacles.isFree(x, z, 0.2, 0.15)) continue;
      const isFlower = decoRand() < (0.2 + openness * 0.4) * (config.flowerRatio ?? 1); // Nevado: sin flores
      const name = pick(decoRand, isFlower ? models.flowers : models.grass);
      const plantMatrix = makeMatrix(x, heightAt(x, z) - 0.03, z, decoRand() * Math.PI * 2, range(decoRand, ...(config.plantScale ?? [0.8, 1.3])));
      placed++;
      if (!inStageClearing(x, z, 0.2, 'plant')) plants.get(name).push(plantMatrix); // Nada asoma por los suelos
    }
  }
  group.add(...instancedByModel(plants, geometries, mats.nature, { cast: false, receive: true }));

  // --- Puntos posibles para los cofres (Fase 11C): libres, alcanzables y lejos del campamento ---
  // Solo se LEE el bosque (no se mueve nada). Semilla propia.
  const chestSpots = createChestSpots(config, { obstacles, landmarkColliders, canReach });

  // --- Elementos propios del bosque (Fase 11A): hojas caídas, nieve, setas, cristales ---
  // Semilla propia: no cambia nada de lo anterior. Sin colisión (como la hierba).
  const extraRand = createRandom(config.seed + 3);
  const extraKinds = config.theme?.extras?.length ? createExtraKinds(mats) : {}; // El Verde no tiene
  for (const { kind, count } of config.theme?.extras ?? []) {
    const def = extraKinds[kind];
    const matrices = [];
    for (let attempt = 0; matrices.length < count && attempt < count * 30; attempt++) {
      const x = range(extraRand, -H + 1, H - 1), z = range(extraRand, -H + 1, H - 1);
      const scale = range(extraRand, def.scale[0], def.scale[1]);
      const yaw = extraRand() * Math.PI * 2;
      const r = def.radius * scale;
      if (isReserved(x, z, r, 'plant', clearings) || inStageClearing(x, z, r, 'plant') || !obstacles.isFree(x, z, r, 0.1)) continue;
      matrices.push(makeMatrix(x, heightAt(x, z) + 0.01, z, yaw, scale));
    }
    for (const part of def.parts) {
      const im = instanced(part.geometry, part.material, matrices, { cast: def.cast, receive: true, name: `extra-${kind}` });
      group.add(im);
      owned.add(part.geometry);
    }
  }
  // Materiales propios de los extras (los que brillan) para liberarlos con el bosque
  const extraMaterials = Object.values(extraKinds).flatMap((d) => d.parts.map((p) => p.material)).filter((m) => m !== mats.nature);
  for (const d of Object.values(extraKinds)) for (const p of d.parts) owned.add(p.geometry);

  // --- Poste indicador para viajar entre bosques (Fase 11A): junto al punto de inicio ---
  const travelPost = createTravelPost(mats, TRAVEL.post);
  group.add(travelPost.group);
  sawmill.colliders.push(travelPost.collider); // El personaje no lo atraviesa

  // Todo es estático por ahora: matrices calculadas una vez y sin actualización por fotograma
  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    obj.matrixAutoUpdate = false;
  });

  // Visibilidad de todos los árboles instanciados (talables + decorativos)
  const visibility = createTreeVisibility([...trees.map((t) => t.instance), ...decoEntries]);

  return {
    group, trees, rocks, bushes, clearings,
    updateCameraOcclusion: visibility.updateCameraOcclusion, // Llamar cada fotograma con la posición de la cámara
    setTreeHidden: (tree, reason, hidden) => visibility.setHidden(tree.instance, reason, hidden),
    sawmillColliders: sawmill.colliders, // Cajas de colisión del aserradero (Fase 5)
    cameraBoxes: [...sawmill.cameraBoxes, ...(emblem?.cameraBoxes ?? [])], // Cajas que la cámara no atraviesa (aserradero, tejado y árbol emblemático)
    landmark: config.landmark ?? null,
    chestSpots, // Puntos posibles de los cofres (Fase 11C): cada día se usan 4
    lanternLight: sawmill.lanternLight, // Farol de la plataforma (más intenso de noche)
    landmarkColliders, // Colisiones del elemento emblemático (esferas y cajas orientadas)
    decorColliders, // Cajas de colisión de los troncos caídos (orientadas)
    setLogPile: sawmill.setLogPile, logSlots: sawmill.logSlots, materials: mats,
    workerSpots: sawmill.workerSpots, // Puestos de los trabajadores del aserradero (Fase 9)
    sawmillLegacyTable: sawmill.legacyTable, // Mesa provisional (la sustituye la sierra del nivel 4)
    geometries, // Geometrías compartidas (la tala las reutiliza para tocones, caídas y troncos)
    config,
    travelPost: { x: TRAVEL.post.x, z: TRAVEL.post.z, radius: TRAVEL.radius }, // Viajar (E)
    /**
     * Libera la memoria del bosque al viajar a otro: geometrías propias (tema, terreno, extras),
     * materiales e instancias. Las geometrías de los GLB, compartidas por todos, se conservan.
     */
    dispose() {
      const shared = new Set(Object.values(themedBase));
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      });
      for (const g of owned) g.dispose();
      for (const m of [...Object.values(mats), ...extraMaterials, ...(emblem?.owned.materials ?? [])]) m.dispose();
    },
  };
}
