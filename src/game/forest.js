// forest.js — Construcción del escenario Low Poly de un bosque.
// FASE 4: terreno ondulado que se extiende al horizonte, bosque abundante con
// arboledas naturales, vegetación instanciada y campamento maderero.
// La tala y la regeneración se añadirán en la Fase 6.
//
// OPTIMIZACIÓN aplicada en este archivo:
// - Cada GLB se carga UNA vez y solo se reutiliza su geometría.
// - UN único material para toda la naturaleza (colores en los vértices).
// - InstancedMesh para lo decorativo y repetitivo: 1 draw call por modelo.
// - Los árboles talables son mallas individuales porque tendrán estado propio (Fase 6).
// - Rejilla espacial para comprobar distancias sin comparar todos contra todos.
// - Objetos estáticos con matrixAutoUpdate = false.
// - Terreno en dos mallas: detallada cerca y muy simple a lo lejos.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
};

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
  for (const p of PATHS) best = Math.min(best, distanceToSegment(x, z, p.ax, p.az, p.bx, p.bz) - p.width);
  return best;
}

/**
 * Altura del terreno:
 * - Ondulaciones suaves (< 1 m) en todo el bosque.
 * - Totalmente plano en el campamento y el spawn.
 * - Algunas elevaciones aisladas muy lejos, en el horizonte.
 */
export function heightAt(x, z) {
  let h =
    0.35 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06 - 0.4) +
    0.25 * Math.sin((x + z) * 0.045 + 2.1) +
    0.15 * Math.cos((x - z) * 0.11);
  // Aplanado progresivo: 0 dentro de los claros, ondulación completa a pocos metros
  const flat = Math.min(
    smoothstep(3, 10, distanceToRect(x, z, SAWMILL_AREAS.compound)),
    smoothstep(3, 9, Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z))
  );
  h *= flat;
  for (const hill of DISTANT_HILLS) {
    const d2 = (x - hill.x) ** 2 + (z - hill.z) ** 2;
    h += hill.h * Math.exp(-d2 / (2 * hill.r * hill.r));
  }
  return h;
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
    let d = 0.12;
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

function createSawmill(geometries, logNames, mats) {
  const group = new THREE.Group();
  group.name = 'aserradero';
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); // Una sola caja escalada para todas las piezas

  // Las piezas se agrupan por material y se dibujan con un InstancedMesh por grupo
  const batches = { dark: [], light: [], roof: [], gold: [] };
  const box = (batch, sx, sy, sz, x, y, z, rotX = 0) => batches[batch].push(makeMatrix(x, y, z, 0, sx, sy, sz, rotX));

  // --- Cobertizo abierto ---
  box('light', 8, 0.3, 6, 0, 0.15, 0); // Suelo
  for (const x of [-3.8, 0, 3.8]) {
    for (const z of [-2.8, 2.8]) box('dark', 0.3, 3.2, 0.3, x, 1.9, z); // Postes
  }
  box('dark', 8, 0.25, 0.3, 0, 3.55, 2.8); // Vigas
  box('dark', 8, 0.25, 0.3, 0, 3.55, -2.8);
  box('dark', 8.8, 0.25, 0.25, 0, 5.1, 0); // Cumbrera
  box('roof', 8.8, 0.2, 3.4, 0, 4.32, 1.49, 0.5); // Tejado rojo a dos aguas
  box('roof', 8.8, 0.2, 3.4, 0, 4.32, -1.49, -0.5);
  box('light', 0.25, 1.4, 5.6, -3.9, 1.0, 0); // Murete trasero (el resto queda abierto)

  // --- Zona de procesado: mesa con disco de sierra y un tronco preparado ---
  box('light', 1.4, 0.9, 3.4, 0.8, 0.75, 0);
  const blade = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 14).rotateZ(Math.PI / 2), mats.metal);
  blade.position.set(0.8, 1.3, -0.7);
  const tableLog = mesh(geometries[logNames[1]], mats.nature);
  tableLog.position.set(0.8, 1.2, 0.8);
  group.add(blade, tableLog);

  // --- Almacén delimitado por una valla (entrada libre en el lado +X, de z=4 a z=6.3) ---
  const fencePost = (x, z) => box('dark', 0.18, 1.1, 0.18, x, 0.55, z);
  // Contadores enteros: sumar decimales acumularía error de redondeo y podría saltarse un poste
  for (let i = 0; i <= 4; i++) fencePost(-3.5, 4 + i * 1.15);
  for (let i = 1; i <= 4; i++) fencePost(-3.5 + i * 1.75, 8.6);
  for (const z of [6.3, 7.45]) fencePost(3.5, z);
  for (const y of [0.45, 0.85]) {
    box('dark', 0.08, 0.1, 4.6, -3.5, y, 6.3); // Travesaños
    box('dark', 7.0, 0.1, 0.08, 0, y, 8.6);
    box('dark', 0.08, 0.1, 2.3, 3.5, y, 7.45);
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

  // --- Plataforma de venta (solo visual; el trigger AABB llega en la Fase 7) ---
  box('light', 3.6, 0.12, 3.6, 7, 0.06, -1.5);
  box('gold', 3.8, 0.16, 0.15, 7, 0.08, -3.35); // Ribete dorado
  box('gold', 3.8, 0.16, 0.15, 7, 0.08, 0.35);
  box('gold', 0.15, 0.16, 3.8, 5.15, 0.08, -1.5);
  box('gold', 0.15, 0.16, 3.8, 8.85, 0.08, -1.5);
  box('dark', 0.15, 2.4, 0.15, 8.95, 1.2, 0.45); // Poste del farol

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
   * Preparado para una fase posterior; de momento se muestra llena.
   */
  const setLogPile = (fraction) => {
    const n = Math.round(Math.max(0, Math.min(1, fraction)) * slots.length);
    logPiles[0].count = Math.ceil(n / 2); // Huecos pares
    logPiles[1].count = Math.floor(n / 2); // Huecos impares
  };

  return { group, setLogPile, logSlots: slots.length };
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

function isReserved(x, z, radius, kind, clearings) {
  const m = MARGINS[kind];
  return (
    distanceToPaths(x, z) < m.path + radius ||
    distanceToRect(x, z, SAWMILL_AREAS.compound) < m.camp + radius ||
    Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z) < m.spawn + radius ||
    clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r * m.clearing + radius)
  );
}

// ---------- API pública ----------

/**
 * Construye el bosque con las geometrías ya cargadas.
 * @returns {{ group, trees, rocks, bushes, clearings, setLogPile, logSlots, materials }}
 *   trees, rocks y bushes guardan los datos para colisiones (Fase 5) y tala (Fase 6).
 */
export function createForest(config, geometries) {
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

  // spacing: separación entre árboles/rocas · obstacles: huella física (troncos, rocas, arbustos)
  const spacing = new SpatialGrid(4);
  const obstacles = new SpatialGrid(4);

  // --- Árboles talables: muestreo por densidad con distancia mínima (Poisson disk) ---
  // Se lanzan posiciones al azar; cada una se acepta con probabilidad = densidad local
  // y solo si respeta la distancia mínima. Resultado: arboledas densas, zonas abiertas
  // y nunca una cuadrícula.
  const trees = [];
  const half = config.treeSpacing / 2;
  for (let attempt = 0; trees.length < config.treeCount && attempt < 60000; attempt++) {
    const x = range(rand, -H + 2, H - 2);
    const z = range(rand, -H + 2, H - 2);
    if (rand() > density(x, z)) continue;
    if (isReserved(x, z, 1.3, 'tree', clearings) || !spacing.isFree(x, z, half)) continue;

    const isPine = rand() < config.pineRatio;
    const modelName = pick(rand, isPine ? models.pines : models.roundTrees);
    const scale = range(rand, 0.85, 1.2);
    const radius = 0.3 * scale; // Radio de colisión del tronco (Fase 5)

    const tree = new THREE.Group();
    tree.name = `arbol-${trees.length}`;
    tree.add(mesh(geometries[modelName], mats.nature, { cast: true, receive: true }));
    tree.position.set(x, heightAt(x, z) - 0.05, z); // Base apoyada (ligeramente enterrada)
    tree.rotation.y = rand() * Math.PI * 2;
    tree.scale.setScalar(scale);
    tree.userData = { type: isPine ? 'pino' : 'redondo', model: modelName, radius, height: geometries[modelName].boundingBox.max.y * scale };

    spacing.add(x, z, half);
    obstacles.add(x, z, radius);
    trees.push(tree);
    group.add(tree);
  }

  // --- Rocas: mallas individuales (colisión en la Fase 5) ---
  const rocks = [];
  for (let attempt = 0; rocks.length < config.rockCount && attempt < 5000; attempt++) {
    const x = range(rand, -H + 3, H - 3);
    const z = range(rand, -H + 3, H - 3);
    const modelName = pick(rand, models.rocks);
    const bb = geometries[modelName].boundingBox;
    const scale = range(rand, 0.7, 1.1);
    const radius = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * scale;
    if (isReserved(x, z, radius, 'rock', clearings) || !spacing.isFree(x, z, radius, 0.8)) continue;

    const rock = mesh(geometries[modelName], mats.nature, { cast: true, receive: true });
    rock.name = `roca-${rocks.length}`;
    rock.position.set(x, heightAt(x, z) - 0.1, z);
    rock.rotation.y = rand() * Math.PI * 2;
    rock.scale.setScalar(scale);
    rock.userData = { model: modelName, radius, height: bb.max.y * scale };
    spacing.add(x, z, radius);
    obstacles.add(x, z, radius);
    rocks.push(rock);
    group.add(rock);
  }

  // --- Árboles decorativos: franja de bosque exterior + algunos dispersos más lejos ---
  // InstancedMesh y sin sombras. Disimulan el límite de la zona jugable sin montañas.
  const decoGrid = new SpatialGrid(5);
  const decorative = new Map([...models.pines, ...models.roundTrees].map((n) => [n, []]));
  let decoCount = 0;
  const beltTarget = Math.round(config.decorativeTreeCount * 0.82);
  const placeDecorative = (limit, minHalf, maxHalf, minDist) => {
    for (let attempt = 0; decoCount < limit && attempt < 20000; attempt++) {
      const x = range(decoRand, -maxHalf, maxHalf);
      const z = range(decoRand, -maxHalf, maxHalf);
      if (Math.max(Math.abs(x), Math.abs(z)) < minHalf) continue; // Solo fuera del cuadrado interior
      if (!decoGrid.isFree(x, z, minDist / 2)) continue;
      const scale = range(decoRand, 0.9, 1.35);
      decorative.get(pick(decoRand, [...decorative.keys()])).push(makeMatrix(x, heightAt(x, z) - 0.4, z, decoRand() * Math.PI * 2, scale));
      decoGrid.add(x, z, minDist / 2);
      decoCount++;
    }
  };
  placeDecorative(beltTarget, H + 1.5, WORLD.innerHalf - 5, 3.4); // Franja densa junto al límite
  placeDecorative(config.decorativeTreeCount, WORLD.innerHalf - 5, 170, 7); // Dispersos hacia el horizonte
  group.add(...instancedByModel(decorative, geometries, mats.nature, { cast: false, receive: false }));

  // --- Arbustos: InstancedMesh con sombra (son voluminosos); preferentemente en los bordes de las arboledas ---
  const bushMatrices = new Map(models.bushes.map((n) => [n, []]));
  const bushes = [];
  for (let attempt = 0; bushes.length < config.bushCount && attempt < 8000; attempt++) {
    const x = range(decoRand, -H + 2, H - 2);
    const z = range(decoRand, -H + 2, H - 2);
    const d = density(x, z);
    if (decoRand() > 0.3 + d * 0.6) continue;
    const scale = range(decoRand, 0.55, 0.9);
    const r = 1.1 * scale;
    if (isReserved(x, z, r, 'bush', clearings) || !obstacles.isFree(x, z, r, 0.6)) continue;
    bushMatrices.get(pick(decoRand, models.bushes)).push(makeMatrix(x, heightAt(x, z) - 0.05, z, decoRand() * Math.PI * 2, scale));
    obstacles.add(x, z, r);
    bushes.push({ x, z, r });
  }
  group.add(...instancedByModel(bushMatrices, geometries, mats.nature, { cast: true, receive: true }));

  // --- Hierba y flores: grupos irregulares, InstancedMesh y SIN sombras ---
  // Las flores abundan más en las praderas abiertas; la hierba en todas partes.
  const plants = new Map([...models.grass, ...models.flowers].map((n) => [n, []]));
  let placed = 0;
  for (let cluster = 0; placed < config.smallPlantCount && cluster < 200; cluster++) {
    const cx = range(decoRand, -H + 1, H - 1);
    const cz = range(decoRand, -H + 1, H - 1);
    const groupSize = 3 + Math.floor(decoRand() * 6); // 3-8 plantas por grupo
    const openness = 1 - density(cx, cz);
    for (let k = 0; k < groupSize && placed < config.smallPlantCount; k++) {
      const x = cx + (decoRand() - 0.5) * 3.5;
      const z = cz + (decoRand() - 0.5) * 3.5;
      if (Math.abs(x) > H || Math.abs(z) > H) continue;
      if (isReserved(x, z, 0.2, 'plant', clearings) || !obstacles.isFree(x, z, 0.2, 0.15)) continue;
      const isFlower = decoRand() < 0.2 + openness * 0.4;
      const name = pick(decoRand, isFlower ? models.flowers : models.grass);
      plants.get(name).push(makeMatrix(x, heightAt(x, z) - 0.03, z, decoRand() * Math.PI * 2, range(decoRand, 0.8, 1.3)));
      placed++;
    }
  }
  group.add(...instancedByModel(plants, geometries, mats.nature, { cast: false, receive: true }));

  // Todo es estático por ahora: matrices calculadas una vez y sin actualización por fotograma
  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    obj.matrixAutoUpdate = false;
  });

  return { group, trees, rocks, bushes, clearings, setLogPile: sawmill.setLogPile, logSlots: sawmill.logSlots, materials: mats };
}
