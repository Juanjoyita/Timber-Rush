// sawmillStages.js — Evolución visual del aserradero según su nivel (0..10).
//
// Modelos: "Low Poly Lumber Mill Pack" de reodesuxz, adaptados con
// herramientas/preparar_aserradero.py en UN solo GLB (aserradero.glb): cada modelo es una malla
// con sus colores en los vértices (el mismo estilo que la naturaleza del juego).
//
// Cinco etapas ACUMULATIVAS (cada nivel comprado añade estructuras y nunca quita las anteriores):
//   1 · Taller (niveles 0-1)            3 · Maquinaria (4-5)            5 · Complejo maderero (9-10)
//   2 · Taller artesanal (2-3)          4 · Aserradero industrial (6-8)
//
// Coordenadas LOCALES del aserradero (como forest.js): x hacia la plataforma de venta (este),
// z hacia el almacén (sur). Giros en múltiplos de 90°: las colisiones son cajas alineadas.
//
// Rendimiento:
// - Todas las piezas estáticas del nivel se fusionan en UNA geometría (1 llamada de dibujo +
//   sombras). Solo se reconstruye al cambiar de nivel (al cargar o al comprar).
// - Animaciones ligeras y puramente visuales (no producen madera ni tocan la economía): disco de
//   la sierra, troncos en las cintas, humo de la caldera y carretilla que lleva troncos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const SAWMILL_MODEL_URL = '/assets/models/aserradero.glb';
export const MAX_SAWMILL_LEVEL = 10;

export const SAWMILL_STAGES = [
  { stage: 1, name: 'Taller', from: 0, to: 1 },
  { stage: 2, name: 'Taller artesanal', from: 2, to: 3 },
  { stage: 3, name: 'Maquinaria', from: 4, to: 5 },
  { stage: 4, name: 'Aserradero industrial', from: 6, to: 8 },
  { stage: 5, name: 'Complejo maderero', from: 9, to: 10 },
];

/** Etapa (1..5) de un nivel del aserradero. */
export function stageOf(level) {
  const L = clampLevel(level);
  return SAWMILL_STAGES.find((s) => L >= s.from && L <= s.to).stage;
}

export const clampLevel = (level) => Math.max(0, Math.min(MAX_SAWMILL_LEVEL, Math.floor(Number(level)) || 0));

// Medidas de cada modelo del GLB: [minX, maxX, minZ, maxZ, alto] (m, sin girar).
// Una prueba comprueba que coinciden con aserradero.glb. Se usan sin cargar el GLB para
// despejar el bosque y calcular las colisiones al construir el mundo.
export const MODEL_BOUNDS = {
  band_saw: [-0.45, 0.45, -0.35, 0.45, 2.4],
  circular_saw_table: [-1.3, 1.3, -0.65, 0.65, 1.45],
  drying_shed: [-2.8, 2.8, -1.7, 1.7, 3.4],
  firewood_stack: [-0.89, 0.89, -0.5, 0.5, 0.9],
  forklift_log_loader: [-0.85, 0.85, -1.2, 2.6, 2.43],
  fuel_barrel: [-0.29, 0.29, -0.31, 0.31, 0.9],
  log_cabin_office: [-1.8, 1.8, -1.5, 1.5, 3.9],
  log_cart: [-0.7, 1, -1.5, 1.5, 1.18],
  log_conveyor: [-0.5, 0.5, -2.5, 2.5, 1.08],
  log_pile: [-0.92, 0.9, -1.5, 1.5, 1.2],
  log_splitter: [-0.3, 0.3, -1.25, 1.2, 1.24],
  lumber_bundle: [-1.2, 1.2, -0.35, 0.35, 0.16],
  mill_sign: [-0.85, 0.85, -0.05, 0.14, 1.8],
  plank_stack_big: [-1.3, 1.3, -0.2, 0.2, 0.84],
  sawdust_blower: [-0.6, 1.1, -0.4, 0.4, 3.38],
  sawdust_pile: [-0.89, 1.06, -0.9, 0.85, 0.6],
  sawhorse: [-0.5, 0.5, -0.45, 0.45, 0.9],
  sawmill_boiler: [-0.92, 0.92, -1.2, 1.3, 4],
  sawmill_building: [-3.7, 3.7, -2.7, 2.7, 5.3],
  single_log: [-0.3, 0.3, -1.6, 1.6, 0.6],
  stump_chopping_block: [-0.39, 0.39, -0.4, 0.38, 0.66],
  watchtower: [-1.13, 1.13, -1.13, 1.13, 7.21],
};

const SHED_FLOOR = 0.15; // Altura del suelo del cobertizo (las máquinas de dentro se apoyan en él)

// Carretilla: va y viene por el carril del sur entre la pila de troncos y el almacén
export const FORKLIFT = { z: 11.6, fromX: -1.0, toX: 3.0, speed: 1.1, pause: 1.6, yaw: 90, keepOut: 1.4 };

/**
 * Piezas de cada nivel (se muestran todas las de nivel <= nivel actual).
 * anim: 'saw' (mesa con disco giratorio), 'conveyor' (troncos en marcha), 'smoke' (caldera),
 *       'forklift' (pieza móvil: su colisión se mueve con ella).
 * replacesTable: sustituye a la mesa provisional del cobertizo (su colisión se conserva).
 */
export const STAGE_ITEMS = [
  // --- Etapa 1 · Taller ---
  { level: 0, model: 'mill_sign', x: 12.4, z: -2.6, yaw: -90 }, // Cartel junto al final del camino
  { level: 0, model: 'sawhorse', x: -2.6, z: -5.0, yaw: 0 },
  { level: 0, model: 'firewood_stack', x: -5.0, z: 2.8, yaw: 90 }, // Tras el murete del cobertizo
  { level: 1, model: 'log_cart', x: 6.0, z: 8.6, yaw: 0 }, // Carro de troncos junto al almacén
  { level: 1, model: 'stump_chopping_block', x: -5.2, z: 5.4, yaw: 0 },
  // --- Etapa 2 · Taller artesanal ---
  { level: 2, model: 'log_cabin_office', x: 5.8, z: -7.4, yaw: 0 }, // Oficina con la puerta hacia la plataforma
  { level: 2, model: 'plank_stack_big', x: -7.2, z: 3.0, yaw: 90 },
  { level: 2, model: 'lumber_bundle', x: -8.2, z: 3.0, yaw: 90 },
  { level: 3, model: 'drying_shed', x: -8.4, z: 8.0, yaw: 90 }, // Secadero de tablones
  // --- Etapa 3 · Maquinaria ---
  { level: 4, model: 'circular_saw_table', x: 0.8, z: 0, yaw: 90, y: SHED_FLOOR, anim: 'saw', replacesTable: true },
  { level: 4, model: 'band_saw', x: 2.9, z: 2.0, yaw: -90, y: SHED_FLOOR },
  { level: 4, model: 'sawdust_pile', x: 2.6, z: -4.8, yaw: 0 },
  { level: 5, model: 'log_conveyor', x: -6.9, z: 0, yaw: 90, anim: 'conveyor' }, // Lleva troncos al cobertizo
  { level: 5, model: 'log_splitter', x: -6.9, z: -3.0, yaw: 0 },
  // --- Etapa 4 · Aserradero industrial ---
  { level: 6, model: 'sawmill_building', x: -1.0, z: -10.2, yaw: 0 }, // Nave con la puerta hacia el cobertizo
  { level: 7, model: 'sawmill_boiler', x: -6.8, z: -10.4, yaw: 0, anim: 'smoke' },
  { level: 7, model: 'sawdust_blower', x: 4.2, z: -10.4, yaw: 0 },
  { level: 8, model: 'forklift_log_loader', x: FORKLIFT.fromX, z: FORKLIFT.z, yaw: FORKLIFT.yaw, anim: 'forklift' },
  { level: 8, model: 'log_pile', x: -1.6, z: 14.0, yaw: 90 },
  { level: 8, model: 'log_pile', x: 1.6, z: 14.0, yaw: 90 },
  // --- Etapa 5 · Complejo maderero ---
  { level: 9, model: 'watchtower', x: -11.2, z: -5.2, yaw: 0 },
  { level: 9, model: 'log_conveyor', x: -1.0, z: -5.5, yaw: 0, anim: 'conveyor' }, // De la nave al cobertizo
  { level: 10, model: 'drying_shed', x: -12.4, z: 8.0, yaw: 90 },
  { level: 10, model: 'plank_stack_big', x: 9.6, z: -7.0, yaw: 0 },
  { level: 10, model: 'lumber_bundle', x: 9.6, z: -8.4, yaw: 0 },
  { level: 10, model: 'fuel_barrel', x: -8.9, z: -8.2, yaw: 0 },
  { level: 10, model: 'fuel_barrel', x: -8.2, z: -7.5, yaw: 0 },
];

/** Piezas visibles en un nivel (acumulativas). */
export const itemsUpTo = (level) => STAGE_ITEMS.filter((it) => it.level <= clampLevel(level));

/**
 * Huella (rectángulo alineado) de una pieza en coordenadas locales, ya girada.
 * three.js gira en Y así: x' = x·cos + z·sin, z' = −x·sin + z·cos.
 */
export function footprint(item, x = item.x, z = item.z) {
  const [minX, maxX, minZ, maxZ, height] = MODEL_BOUNDS[item.model];
  const a = THREE.MathUtils.degToRad(item.yaw);
  const c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  const xs = [], zs = [];
  for (const px of [minX, maxX]) {
    for (const pz of [minZ, maxZ]) {
      xs.push(px * c + pz * s);
      zs.push(-px * s + pz * c);
    }
  }
  return { minX: x + Math.min(...xs), maxX: x + Math.max(...xs), minZ: z + Math.min(...zs), maxZ: z + Math.max(...zs), height, y: item.y ?? 0 };
}

/** Huella que ocupa una pieza en todo su recorrido (la carretilla se mueve por su carril). */
export function reservedFootprint(item) {
  const f = footprint(item);
  if (item.anim !== 'forklift') return f;
  const g = footprint(item, FORKLIFT.toX);
  return { ...f, minX: Math.min(f.minX, g.minX), maxX: Math.max(f.maxX, g.maxX) };
}

/**
 * Cajas de colisión de las piezas estáticas de un nivel, en coordenadas del MUNDO
 * ({ x, y, z, hx, hy, hz }, como las del aserradero). Las piezas bajas y anchas (paquete de
 * tablones) también son sólidas: así el personaje no las atraviesa ni se sube a ellas.
 */
export function stageColliders(level, origin) {
  const boxes = [];
  for (const item of itemsUpTo(level)) {
    if (item.anim === 'forklift') continue; // Su colisión se mueve con ella
    const f = footprint(item);
    const height = Math.max(f.height, 0.5);
    boxes.push({
      x: origin.x + (f.minX + f.maxX) / 2, y: f.y + height / 2, z: origin.z + (f.minZ + f.maxZ) / 2,
      hx: (f.maxX - f.minX) / 2, hy: height / 2, hz: (f.maxZ - f.minZ) / 2,
      model: item.model, level: item.level,
    });
  }
  return boxes;
}

/** Huellas de TODAS las piezas (nivel máximo) en el mundo: zona que se despeja en el bosque. */
export function allFootprints(origin) {
  return STAGE_ITEMS.map((item) => {
    const f = reservedFootprint(item);
    return { minX: origin.x + f.minX, maxX: origin.x + f.maxX, minZ: origin.z + f.minZ, maxZ: origin.z + f.maxZ, model: item.model };
  });
}

// ---------- Carga del GLB ----------

/**
 * Prepara las geometrías del GLB: colores de vértice con 3 componentes (ya están en lineal:
 * el exportador de Blender los guarda así) y sin normales (flatShading las calcula en el shader).
 */
export function prepareSawmillGeometries(gltf) {
  const geometries = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const g = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
    const color = g.getAttribute('color');
    if (color) {
      const rgb = new Float32Array(color.count * 3);
      for (let i = 0; i < color.count; i++) {
        rgb[i * 3] = color.getX(i);
        rgb[i * 3 + 1] = color.getY(i);
        rgb[i * 3 + 2] = color.getZ(i);
      }
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    }
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'color') g.deleteAttribute(name);
    const flat = g.index ? g.toNonIndexed() : g; // Mismo formato en todas: se pueden fusionar
    flat.computeVertexNormals();
    flat.computeBoundingBox();
    flat.computeBoundingSphere();
    geometries[obj.name] = flat;
  });
  return geometries;
}

export async function loadSawmillModels(url = SAWMILL_MODEL_URL) {
  try {
    return prepareSawmillGeometries(await new GLTFLoader().loadAsync(url));
  } catch (error) {
    throw new Error(`No se pudo cargar el modelo "aserradero.glb" (${error.message})`);
  }
}

// ---------- Escena ----------

const SAW_DISC_HEIGHT = 1.25; // Eje del disco sobre la base de la mesa
const CONVEYOR = { top: 1.02, speed: 0.55, logScale: 0.42, spacing: 2.4, fade: 0.5 };
const SMOKE = { puffs: 7, life: 4.2, rise: 0.55, drift: 0.18, size: 0.32 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

function itemMatrix(item, x = item.x, z = item.z) {
  _q.setFromAxisAngle(_up, THREE.MathUtils.degToRad(item.yaw));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, item.y ?? 0, z), _q, new THREE.Vector3(1, 1, 1));
}

export class SawmillStages {
  /**
   * @param options.geometries  Geometrías de aserradero.glb (loadSawmillModels)
   * @param options.origin      { x, z } del aserradero (WORLD.sawmill)
   * @param options.material    Material con colores de vértice (el de la naturaleza)
   * @param options.legacyTable Mesa provisional del cobertizo (se oculta con la sierra del nivel 4)
   * @param options.physics     { setStageBoxes(boxes), createMovingBox(hx, hy, hz) } (opcional)
   * @param options.cameraBoxes Lista de cajas de la cámara (se le añaden/quitan las de las etapas)
   */
  constructor({ geometries, origin, material, legacyTable = null, physics = null, cameraBoxes = null }) {
    this.geometries = geometries;
    this.origin = origin;
    this.material = material;
    this.legacyTable = legacyTable;
    this.physics = physics;
    this.cameraBoxes = cameraBoxes;
    this.level = -1;
    this.colliders = [];
    this.group = new THREE.Group();
    this.group.name = 'aserradero-etapas';
    this.group.position.set(origin.x, 0, origin.z);
    this.staticMesh = null;
    this.time = 0;

    // Disco de la sierra (gira) — uno por cada mesa con anim 'saw'
    this.discs = STAGE_ITEMS.filter((it) => it.anim === 'saw').map((item) => {
      const disc = new THREE.Mesh(geometries.saw_disc, material);
      disc.name = 'disco-sierra';
      disc.castShadow = true;
      disc.position.set(item.x, (item.y ?? 0) + SAW_DISC_HEIGHT, item.z);
      disc.rotation.set(0, THREE.MathUtils.degToRad(item.yaw), 0);
      disc.userData.item = item;
      this.group.add(disc);
      return disc;
    });

    // Troncos de las cintas: un InstancedMesh para todas
    this.conveyors = STAGE_ITEMS.filter((it) => it.anim === 'conveyor');
    const length = MODEL_BOUNDS.log_conveyor[3] - MODEL_BOUNDS.log_conveyor[2];
    this.logsPerConveyor = Math.ceil(length / CONVEYOR.spacing);
    this.conveyorLogs = new THREE.InstancedMesh(geometries.single_log, material, this.conveyors.length * this.logsPerConveyor);
    this.conveyorLogs.name = 'troncos-cinta';
    this.conveyorLogs.castShadow = true;
    this.conveyorLogs.frustumCulled = false; // Se mueven: la esfera envolvente no es fija
    this.group.add(this.conveyorLogs);

    // Humo de la caldera: bocanadas (icosaedros) semitransparentes que suben y se deshacen
    this.smokeSources = STAGE_ITEMS.filter((it) => it.anim === 'smoke');
    this.smoke = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 1, metalness: 0, flatShading: true, transparent: true, opacity: 0.55, depthWrite: false }),
      this.smokeSources.length * SMOKE.puffs
    );
    this.smoke.name = 'humo-caldera';
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);

    // Carretilla con un tronco en las horquillas (solo la pieza móvil: el resto se fusiona)
    this.forkliftItem = STAGE_ITEMS.find((it) => it.anim === 'forklift') ?? null;
    if (this.forkliftItem) {
      const f = this.forkliftItem;
      this.forklift = new THREE.Group();
      this.forklift.name = 'carretilla';
      const body = new THREE.Mesh(geometries.forklift_log_loader, material);
      body.castShadow = true;
      body.receiveShadow = true;
      const log = new THREE.Mesh(geometries.single_log, material);
      log.name = 'carga';
      log.castShadow = true;
      log.rotation.y = Math.PI / 2; // Atravesado sobre las horquillas
      log.scale.setScalar(0.55);
      log.position.set(0, 0.45, 1.9);
      this.forkliftLoad = log;
      this.forklift.add(body, log);
      this.forklift.rotation.y = THREE.MathUtils.degToRad(f.yaw);
      this.forklift.position.set(f.x, 0, f.z);
      this.group.add(this.forklift);
      const fp = footprint(f, 0, 0);
      this.forkliftBox = { // Caja de la cámara (se mueve con ella)
        x: 0, y: fp.height / 2, z: origin.z + f.z,
        hx: (fp.maxX - fp.minX) / 2, hy: fp.height / 2, hz: (fp.maxZ - fp.minZ) / 2,
        offsetX: (fp.minX + fp.maxX) / 2, offsetZ: (fp.minZ + fp.maxZ) / 2, model: f.model,
      };
      this.forkliftBody = physics?.createMovingBox?.(this.forkliftBox.hx, this.forkliftBox.hy, this.forkliftBox.hz) ?? null;
      // Estado: va (cargada) → pausa → vuelve (vacía) → pausa…
      this.forkliftState = { x: f.x, dir: 1, wait: FORKLIFT.pause };
    }
    this.setLevel(0);
  }

  /** Cambia el nivel: reconstruye las piezas estáticas, colisiones y obstáculos de la cámara. */
  setLevel(level) {
    const L = clampLevel(level);
    if (L === this.level) return false;
    this.level = L;
    const items = itemsUpTo(L);

    // 1. Malla estática fusionada (1 llamada de dibujo)
    if (this.staticMesh) {
      this.group.remove(this.staticMesh);
      this.staticMesh.geometry.dispose();
      this.staticMesh = null;
    }
    const parts = items.filter((it) => it.anim !== 'forklift').map((it) => this.geometries[it.model].clone().applyMatrix4(itemMatrix(it)));
    if (parts.length) {
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      this.staticMesh = new THREE.Mesh(merged, this.material);
      this.staticMesh.name = `aserradero-nivel-${L}`;
      this.staticMesh.castShadow = true;
      this.staticMesh.receiveShadow = true;
      this.group.add(this.staticMesh);
    }

    // 2. Piezas animadas visibles
    for (const disc of this.discs) disc.visible = disc.userData.item.level <= L;
    this.activeConveyors = this.conveyors.filter((it) => it.level <= L);
    this.conveyorLogs.count = this.activeConveyors.length * this.logsPerConveyor;
    this.activeSmoke = this.smokeSources.filter((it) => it.level <= L);
    this.smoke.count = this.activeSmoke.length * SMOKE.puffs;
    const forkliftOn = this.forkliftItem ? this.forkliftItem.level <= L : false;
    if (this.forklift) this.forklift.visible = forkliftOn;
    // La mesa provisional desaparece cuando llega la sierra de verdad (misma colisión)
    if (this.legacyTable) this.legacyTable.visible = !items.some((it) => it.replacesTable);

    // 3. Colisiones (física) y obstáculos de la cámara
    this.colliders = stageColliders(L, this.origin);
    this.physics?.setStageBoxes?.(this.colliders);
    if (this.cameraBoxes) {
      for (let i = this.cameraBoxes.length - 1; i >= 0; i--) if (this.cameraBoxes[i].stage) this.cameraBoxes.splice(i, 1);
      for (const b of this.colliders) this.cameraBoxes.push({ ...b, stage: true });
      if (forkliftOn) this.cameraBoxes.push(Object.assign(this.forkliftBox, { stage: true }));
    }
    if (this.forkliftBody) this.forkliftBody.setEnabled(forkliftOn);
    this.placeForklift();
    this.update(0);
    return true;
  }

  /** Libera lo creado por las etapas al salir del bosque (los modelos del GLB se conservan). */
  dispose() {
    if (this.staticMesh) this.staticMesh.geometry.dispose();
    this.conveyorLogs.dispose();
    this.smoke.dispose();
    this.smoke.geometry.dispose();
    this.smoke.material.dispose();
    this.physics?.setStageBoxes?.([]);
    this.forkliftBody?.setEnabled(false);
    if (this.cameraBoxes) for (let i = this.cameraBoxes.length - 1; i >= 0; i--) if (this.cameraBoxes[i].stage) this.cameraBoxes.splice(i, 1);
    this.group.removeFromParent();
  }

  get stage() {
    return stageOf(this.level);
  }

  /**
   * Animaciones (solo visuales). playerPosition: la carretilla espera si el jugador está en su
   * camino (nunca le empuja ni le encierra).
   */
  update(dt, playerPosition = null) {
    this.time += dt;
    const t = this.time;

    for (const disc of this.discs) if (disc.visible) disc.rotation.z = -t * 9; // ~1,4 vueltas/s

    // Troncos en las cintas: avanzan hacia el cobertizo; aparecen y desaparecen creciendo/encogiendo
    const [, , minZ, maxZ] = MODEL_BOUNDS.log_conveyor;
    const length = maxZ - minZ;
    let n = 0;
    for (const item of this.activeConveyors) {
      for (let k = 0; k < this.logsPerConveyor; k++) {
        const along = (t * CONVEYOR.speed + k * CONVEYOR.spacing) % (this.logsPerConveyor * CONVEYOR.spacing);
        const visible = along <= length;
        const edge = Math.min(along, length - along);
        const grow = visible ? Math.min(1, Math.max(0, edge / CONVEYOR.fade)) : 0;
        const local = minZ + along; // Posición a lo largo de la cinta (eje z del modelo)
        const a = THREE.MathUtils.degToRad(item.yaw);
        _p.set(item.x + Math.sin(a) * local, (item.y ?? 0) + CONVEYOR.top, item.z + Math.cos(a) * local);
        _q.setFromAxisAngle(_up, a);
        _s.setScalar(CONVEYOR.logScale * Math.max(grow, 0.001));
        this.conveyorLogs.setMatrixAt(n++, _m.compose(_p, _q, _s));
      }
    }
    if (n) this.conveyorLogs.instanceMatrix.needsUpdate = true;

    // Humo: bocanadas escalonadas que suben, se desplazan con el viento y se deshacen
    n = 0;
    const [, , , , boilerHeight] = MODEL_BOUNDS.sawmill_boiler;
    for (const item of this.activeSmoke) {
      for (let k = 0; k < SMOKE.puffs; k++) {
        const age = (t + (k * SMOKE.life) / SMOKE.puffs) % SMOKE.life;
        const life = age / SMOKE.life;
        const size = SMOKE.size * (0.5 + life * 1.6) * Math.sin(Math.PI * Math.min(1, life * 1.15));
        _p.set(item.x + age * SMOKE.drift + Math.sin(age * 1.7 + k) * 0.08, boilerHeight + 0.1 + age * SMOKE.rise, item.z - 0.7);
        _q.setFromEuler(_e.set(k, age * 0.4, 0));
        _s.setScalar(Math.max(size, 0.001));
        this.smoke.setMatrixAt(n++, _m.compose(_p, _q, _s));
      }
    }
    if (n) this.smoke.instanceMatrix.needsUpdate = true;

    if (this.forklift?.visible && dt > 0) this.updateForklift(dt, playerPosition);
  }

  updateForklift(dt, player) {
    const s = this.forkliftState;
    if (s.wait > 0) {
      s.wait -= dt;
      return;
    }
    const target = s.dir > 0 ? FORKLIFT.toX : FORKLIFT.fromX;
    const step = Math.sign(target - s.x) * Math.min(Math.abs(target - s.x), FORKLIFT.speed * dt);
    // Si el jugador está delante (o muy cerca), espera: nunca le empuja
    if (player && this.blocksPlayer(s.x + step, player)) return;
    s.x += step;
    if (Math.abs(target - s.x) < 1e-6) {
      s.dir = -s.dir; // Ida cargada, vuelta vacía
      s.wait = FORKLIFT.pause;
    }
    this.placeForklift();
  }

  /** ¿La carretilla en x tocaría al jugador (con margen)? */
  blocksPlayer(x, player) {
    const b = this.forkliftBox;
    const cx = this.origin.x + x + b.offsetX;
    const cz = this.origin.z + this.forkliftItem.z + b.offsetZ;
    return Math.abs(player.x - cx) < b.hx + FORKLIFT.keepOut && Math.abs(player.z - cz) < b.hz + FORKLIFT.keepOut;
  }

  placeForklift() {
    if (!this.forklift) return;
    const s = this.forkliftState;
    this.forklift.position.x = s.x;
    this.forkliftLoad.visible = s.dir > 0; // Va cargada hacia el almacén y vuelve vacía
    const b = this.forkliftBox;
    b.x = this.origin.x + s.x + b.offsetX;
    b.z = this.origin.z + this.forkliftItem.z + b.offsetZ;
    this.forkliftBody?.moveTo(b.x, b.y, b.z);
  }
}
