// chopping.js — Tala y regeneración de árboles (Fase 6).
//
// El golpe lo inicia el personaje (Player.js, ataque genérico con el hacha); aquí solo se
// decide si el impacto alcanza a un árbol (alcance + arco frontal) y qué le ocurre.
//
// Ciclo de un árbol:
//   disponible → (golpes del hacha hasta agotar su resistencia) → cayendo → talado (tocón)
//   → a los 25 s del último golpe: regenerándose (crece) → disponible
//
// Rendimiento:
// - Los árboles son instancias (forest.js): talar uno solo oculta su instancia.
// - La caída y el crecimiento usan un pequeño grupo de mallas temporales reutilizables.
// - Tocones y troncos de madera: InstancedMesh (pocas llamadas de dibujo aunque haya cientos).
// - El árbol cercano se busca con una rejilla espacial (solo las celdas vecinas).
// - Sin interfaces HTML ni barras de vida: la resistencia es un dato interno.
//
// Los eventos (golpe, inicio de la caída, impacto contra el suelo, regeneración) se notifican
// con onEvent(evento): el audio (audio.js) los traduce a sonidos.
import * as THREE from 'three';
import { HIDE_REASON, heightAt } from './forest.js';
import { PLAYER_RADIUS } from './physics.js';
import { ATTACK, BACKPACK, CHOPPING } from '../config.js';
import { RESOURCE } from './backpack.js';

export const TREE_STATE = {
  AVAILABLE: 'disponible',
  FALLING: 'cayendo',
  FELLED: 'talado',
  GROWING: 'regenerándose',
};

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const STUMP_MODEL_RADIUS = 0.4; // Radio del modelo GLB del tocón (m)
const HIT_HEIGHT = 1.2; // Altura del golpe en el tronco (m)

// Objetos reutilizables (sin crear objetos en cada fotograma)
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function compose(x, y, z, rotY, sx, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, rotY), _s.set(sx, sy, sz));
}

/** Rejilla espacial: busca árboles cercanos mirando solo las celdas vecinas (no los 300). */
class TreeGrid {
  constructor(trees, cell = 4) {
    this.cell = cell;
    this.cells = new Map();
    for (const tree of trees) {
      const key = `${Math.floor(tree.position.x / cell)},${Math.floor(tree.position.z / cell)}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(tree);
    }
  }

  *near(x, z, radius) {
    const i0 = Math.floor((x - radius) / this.cell), i1 = Math.floor((x + radius) / this.cell);
    const j0 = Math.floor((z - radius) / this.cell), j1 = Math.floor((z + radius) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(`${i},${j}`);
        if (list) yield* list;
      }
    }
  }
}

/**
 * Troncos de madera en el suelo, preparados para la recolección (Fase 7).
 * Cada pieza es un registro { units, x, y, z, ... } + una instancia de un InstancedMesh.
 * Límite de seguridad (maxVisible): si se alcanza, la madera NO se pierde: los troncos de un
 * árbol se agrupan en una sola pieza con varias unidades, o se suman a la pieza más cercana.
 */
export class WoodField {
  /**
   * @param forestId Bosque al que pertenece la madera (cada bosque tendrá su precio de venta)
   */
  constructor(group, geometries, models, material, maxVisible, scale, forestId = 1) {
    this.group = group;
    this.material = material;
    this.forestId = forestId;
    this.maxVisible = maxVisible;
    this.scale = scale;
    this.records = [];
    this.models = models;
    this.geometries = geometries;
    this.mergedUnits = 0; // Unidades sumadas a piezas existentes por el límite
    this.collectedUnits = 0; // Unidades recogidas por el jugador (para totalWoodCollected)
    this.flights = []; // Troncos volando hacia el personaje (solo visual)
    this.freeFlyers = []; // Mallas temporales reutilizables para el vuelo
    this.fullNoticeAt = -Infinity;
    this.time = 0;
    this.meshes = models.map((name) => {
      const mesh = new THREE.InstancedMesh(geometries[name], material, maxVisible);
      mesh.count = 0;
      mesh.name = `madera-${name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // Las piezas aparecen por todo el bosque
      mesh.userData.owners = []; // índice de instancia → registro
      group.add(mesh);
      return mesh;
    });
  }

  get visibleCount() {
    return this.meshes.reduce((sum, m) => sum + m.count, 0);
  }

  totalUnits() {
    return this.records.reduce((sum, r) => sum + r.units, 0);
  }

  /** Coloca la madera de un árbol: una pieza por posición si caben; si no, se agrupa. */
  addFromTree(positions, direction, sourceTree) {
    const free = this.maxVisible - this.visibleCount;
    if (free >= positions.length) {
      return positions.map((p) => this.addRecord(1, p, direction, sourceTree));
    }
    if (free >= 1) {
      const middle = positions[Math.floor(positions.length / 2)];
      return [this.addRecord(positions.length, middle, direction, sourceTree)];
    }
    // Sin espacio: se suma a la pieza más cercana (nunca se elimina madera)
    const p = positions[0];
    let nearest = null;
    let best = Infinity;
    for (const r of this.records) {
      const d = (r.x - p.x) ** 2 + (r.z - p.z) ** 2;
      if (d < best) [best, nearest] = [d, r];
    }
    if (nearest) {
      nearest.units += positions.length;
      this.mergedUnits += positions.length;
      if (!this.warned) {
        console.warn(`[Timber Rush] Límite de ${this.maxVisible} troncos visibles: la madera nueva se suma a las piezas cercanas`);
        this.warned = true;
      }
    }
    return nearest ? [nearest] : [];
  }

  addRecord(units, p, direction, sourceTree) {
    const k = this.records.length % this.models.length;
    const mesh = this.meshes[k];
    const bb = this.geometries[this.models[k]].boundingBox;
    // Alinear el eje largo del modelo con la dirección de la caída (con un poco de variación)
    const alongX = bb.max.x - bb.min.x >= bb.max.z - bb.min.z;
    const base = alongX ? Math.atan2(-direction.z, direction.x) : Math.atan2(direction.x, direction.z);
    const rotY = base + (Math.random() - 0.5) * 0.5;
    const y = heightAt(p.x, p.z);
    const record = {
      units,
      x: p.x, y, z: p.z,
      source: sourceTree?.name ?? null,
      forestId: this.forestId,
      mesh,
      index: mesh.count,
      matrix: compose(p.x, y, p.z, rotY, this.scale),
    };
    mesh.setMatrixAt(record.index, record.matrix);
    mesh.userData.owners[record.index] = record;
    mesh.count += 1;
    mesh.instanceMatrix.needsUpdate = true;
    this.records.push(record);
    return record;
  }

  /** Quita una pieza (para la recolección de la Fase 7): la última instancia ocupa su hueco. */
  remove(record) {
    const { mesh, index } = record;
    const last = mesh.count - 1;
    if (index !== last) {
      const moved = mesh.userData.owners[last];
      mesh.setMatrixAt(index, moved.matrix);
      mesh.userData.owners[index] = moved;
      moved.index = index;
    }
    mesh.userData.owners.length = last;
    mesh.count = last;
    mesh.instanceMatrix.needsUpdate = true;
    this.records.splice(this.records.indexOf(record), 1);
  }

  /**
   * Retira "units" unidades de una pieza. Si son todas, la pieza desaparece del suelo; si no,
   * se queda con las restantes (recogida parcial de un montón).
   */
  take(record, units) {
    const n = Math.min(units, record.units);
    if (n >= record.units) this.remove(record);
    else record.units -= n;
    return n;
  }

  /** Quita toda la madera del suelo y los vuelos en curso (al cerrar sesión). */
  clear() {
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.userData.owners.length = 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.records.length = 0;
    for (const f of this.flights) {
      f.mesh.visible = false;
      this.freeFlyers.push(f.mesh);
    }
    this.flights.length = 0;
  }

  // ---------- Recolección automática (Fase 7A) ----------

  /**
   * Cada fotograma (solo jugando y sin pausa): recoge los troncos cercanos al personaje.
   * Las unidades pasan a la mochila en el MISMO instante en que se retiran del suelo; el vuelo
   * posterior es solo visual. Así no se puede perder ni duplicar madera aunque se pause o se
   * salga durante la animación.
   * @param position Posición de los pies del personaje
   * @param backpack Mochila (backpack.js)
   * @param onFull   Aviso de "mochila llena" (limitado a uno cada fullNoticeCooldown s)
   * @returns unidades recogidas en este fotograma
   */
  collect(dt, position, backpack, onFull = null) {
    this.time += dt;
    this.updateFlights(dt, position);
    const r2 = BACKPACK.pickupRadius * BACKPACK.pickupRadius;
    let collected = 0;
    let blocked = false;
    // Recorrido hacia atrás: remove() quita el registro de la lista sin saltarse ninguno
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if ((r.x - position.x) ** 2 + (r.z - position.z) ** 2 > r2) continue;
      const accepted = backpack.add(RESOURCE.WOOD, r.forestId, r.units);
      if (accepted === 0) {
        blocked = true; // Llena: la madera se queda en el suelo
        continue;
      }
      this.startFlight(r);
      this.take(r, accepted);
      collected += accepted;
    }
    this.collectedUnits += collected;
    if (blocked && this.time - this.fullNoticeAt >= BACKPACK.fullNoticeCooldown) {
      this.fullNoticeAt = this.time;
      onFull?.();
    }
    return collected;
  }

  /** Copia temporal del tronco que vuela hacia el personaje y se encoge. */
  startFlight(record) {
    let mesh = this.freeFlyers.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(record.mesh.geometry, this.material);
      mesh.castShadow = true;
      mesh.name = 'madera-recogida';
      this.group.add(mesh);
    }
    mesh.geometry = record.mesh.geometry;
    record.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.visible = true;
    this.flights.push({ mesh, t: 0, from: mesh.position.clone(), scale: mesh.scale.x });
  }

  updateFlights(dt, target) {
    const tx = target.x, ty = target.y + BACKPACK.pickupHeight, tz = target.z;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const p = Math.min(1, f.t / BACKPACK.pickupDuration);
      const e = p * p * (3 - 2 * p); // Suave al empezar y al llegar
      // Hacia el personaje (que puede moverse), con un pequeño arco hacia arriba
      f.mesh.position.set(f.from.x + (tx - f.from.x) * e, f.from.y + (ty - f.from.y) * e + Math.sin(Math.PI * p) * 0.35, f.from.z + (tz - f.from.z) * e);
      f.mesh.scale.setScalar(f.scale * (1 - 0.85 * e)); // Se encoge hasta casi desaparecer
      if (p >= 1 - 1e-6) { // Tolerancia: sumar 1/60 quince veces da 0,2499999…
        f.mesh.visible = false;
        this.freeFlyers.push(f.mesh);
        this.flights[i] = this.flights[this.flights.length - 1];
        this.flights.pop();
      }
    }
  }
}

export class ChoppingSystem {
  /**
   * @param forest        Resultado de createForest()
   * @param forestConfig  Configuración del bosque (resistencia, madera por árbol, modelos)
   * @param scene         Escena donde se añaden tocones, caídas y madera
   * @param onEvent       Recibe { type: 'hit' | 'fallStart' | 'fallImpact' | 'regrow', tree, position, final }
   */
  constructor({ forest, forestConfig, scene, onEvent = () => {} }) {
    this.forest = forest;
    this.onEvent = onEvent;
    this.time = 0;
    this.maxResistance = forestConfig.resistance;
    this.woodPerTree = forestConfig.woodPerTree;
    this.animations = []; // Caídas y crecimientos en curso
    this.felled = new Set(); // Árboles talados esperando a regenerarse
    this.freeVisuals = [];

    this.group = new THREE.Group();
    this.group.name = 'tala';
    scene.add(this.group);
    this.material = forest.materials.nature;

    for (const tree of forest.trees) {
      tree.state = TREE_STATE.AVAILABLE;
      tree.resistance = this.maxResistance;
      tree.felledAt = null;
    }
    this.grid = new TreeGrid(forest.trees);
    this.createStumps(forestConfig.models.stumps);
    this.wood = new WoodField(this.group, forest.geometries, forestConfig.models.logs, this.material, CHOPPING.maxVisibleLogs, CHOPPING.logScale, forestConfig.id);
  }

  // ---------- Tocones ----------

  /** Un tocón preparado (oculto) por árbol, en un InstancedMesh por modelo de tocón. */
  createStumps(models) {
    const byModel = new Map(models.map((name) => [name, []]));
    this.forest.trees.forEach((tree, i) => {
      const name = models[i % models.length];
      // Algo más ancho que el tronco visible (radio ≈ 0,2 m × anchura del árbol)
      const s = (0.2 * tree.scale.x) / STUMP_MODEL_RADIUS;
      const list = byModel.get(name);
      tree.stump = { model: name, index: list.length, matrix: compose(tree.position.x, tree.position.y, tree.position.z, tree.rotationY, s), mesh: null };
      list.push(tree);
    });
    for (const [name, trees] of byModel) {
      const mesh = new THREE.InstancedMesh(this.forest.geometries[name], this.material, trees.length);
      mesh.name = `tocones-${name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (const tree of trees) {
        tree.stump.mesh = mesh;
        mesh.setMatrixAt(tree.stump.index, HIDDEN);
      }
      this.group.add(mesh);
    }
  }

  showStump(tree, visible) {
    tree.stump.mesh.setMatrixAt(tree.stump.index, visible ? tree.stump.matrix : HIDDEN);
    tree.stump.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- Objetivo y golpes ----------
  // El ataque lo decide el personaje (Player.js): golpea aunque no haya ningún árbol. Este
  // sistema solo recibe el impacto y comprueba si alcanza a un árbol válido.

  /** ¿Está el tronco al alcance del hacha desde origin? (distancia hasta su superficie) */
  inRange(tree, origin, reach = ATTACK.reach) {
    const d = Math.hypot(tree.position.x - origin.x, tree.position.z - origin.z);
    return d - tree.userData.radius <= reach;
  }

  /** ¿Está el tronco delante, dentro del arco ±halfAngle alrededor de direction (plano XZ)? */
  inFront(tree, origin, direction, halfAngle = ATTACK.halfAngle) {
    const dx = tree.position.x - origin.x, dz = tree.position.z - origin.z;
    const d = Math.hypot(dx, dz), len = Math.hypot(direction.x, direction.z);
    if (d < 1e-6 || len < 1e-6) return true;
    return (dx * direction.x + dz * direction.z) / (d * len) >= Math.cos(halfAngle);
  }

  /** Árbol disponible más cercano, al alcance y delante de direction (o null). */
  findTarget(origin, direction, reach = ATTACK.reach, halfAngle = ATTACK.halfAngle) {
    let best = null;
    let bestDist = Infinity;
    for (const tree of this.grid.near(origin.x, origin.z, reach + 1)) {
      if (tree.state !== TREE_STATE.AVAILABLE || !this.inRange(tree, origin, reach) || !this.inFront(tree, origin, direction, halfAngle)) continue;
      const d = Math.hypot(tree.position.x - origin.x, tree.position.z - origin.z);
      if (d < bestDist) [bestDist, best] = [d, tree];
    }
    return best;
  }

  /**
   * Impacto de un ataque { origin, direction, reach, halfAngle, damage } (lo emite el personaje
   * una vez por golpe). Solo afecta al árbol más cercano al alcance y dentro del arco frontal.
   * Golpe al aire: no hay evento, ni daño, ni madera, ni sonidos de madera.
   * @returns true si ha golpeado un árbol
   */
  receiveAttack(attack) {
    const tree = this.findTarget(attack.origin, attack.direction, attack.reach, attack.halfAngle);
    if (!tree) return false;
    const damage = attack.damage;
    tree.resistance = Math.max(0, tree.resistance - damage);
    const final = tree.resistance === 0;
    this.onEvent({ type: 'hit', tree, final, damage, position: new THREE.Vector3(tree.position.x, tree.position.y + HIT_HEIGHT, tree.position.z) });
    if (final) this.fell(tree, attack.origin);
    return true;
  }

  // ---------- Caída ----------

  /** Mallas temporales reutilizables para animar caídas y crecimientos. */
  acquireVisual(tree) {
    let pivot = this.freeVisuals.pop();
    if (!pivot) {
      pivot = new THREE.Object3D();
      const mesh = new THREE.Mesh(tree.instance.mesh.geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      pivot.add(mesh);
      this.group.add(pivot);
    }
    const mesh = pivot.children[0];
    mesh.geometry = this.forest.geometries[tree.userData.model];
    mesh.rotation.set(0, tree.rotationY, 0);
    mesh.scale.copy(tree.scale);
    pivot.position.copy(tree.position);
    pivot.quaternion.identity();
    pivot.scale.set(1, 1, 1);
    pivot.visible = true;
    return pivot;
  }

  releaseVisual(pivot) {
    pivot.visible = false;
    this.freeVisuals.push(pivot);
  }

  fell(tree, playerPosition) {
    tree.state = TREE_STATE.FALLING;
    tree.felledAt = this.time; // La regeneración cuenta desde el último golpe
    this.felled.add(tree);
    this.forest.setTreeHidden(tree, HIDE_REASON.FELLED, true);
    this.showStump(tree, true);

    // Cae alejándose del jugador, girando desde la base del tronco
    const dir = new THREE.Vector3(tree.position.x - playerPosition.x, 0, tree.position.z - playerPosition.z);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const axis = new THREE.Vector3().crossVectors(UP, dir).normalize(); // Girar sobre este eje lleva la copa hacia dir
    const pivot = this.acquireVisual(tree);
    this.animations.push({ type: 'fall', tree, pivot, dir, axis, t: 0, landed: false });
    this.onEvent({ type: 'fallStart', tree, position: new THREE.Vector3(tree.position.x, tree.position.y + tree.userData.height * 0.5, tree.position.z) });
  }

  /** Posiciones de los troncos de madera a lo largo del árbol caído. */
  woodPositions(tree, dir) {
    const n = this.woodPerTree;
    const length = tree.userData.height * 0.85;
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const positions = [];
    for (let k = 0; k < n; k++) {
      const along = 1.0 + (k / Math.max(1, n - 1)) * (length - 1.0);
      const lateral = (Math.random() - 0.5) * 0.6;
      positions.push(new THREE.Vector3(tree.position.x + dir.x * along + side.x * lateral, 0, tree.position.z + dir.z * along + side.z * lateral));
    }
    return positions;
  }

  // ---------- Regeneración ----------

  /** ¿Ocupa el personaje el sitio del árbol? Entonces se espera a que se aparte. */
  occupied(tree, playerPosition) {
    if (!playerPosition) return false;
    const d = Math.hypot(tree.position.x - playerPosition.x, tree.position.z - playerPosition.z);
    return d < tree.userData.radius + PLAYER_RADIUS + CHOPPING.regrowClearance;
  }

  startRegrow(tree) {
    this.felled.delete(tree);
    tree.state = TREE_STATE.GROWING;
    this.showStump(tree, false);
    const pivot = this.acquireVisual(tree);
    pivot.scale.setScalar(0.15);
    this.animations.push({ type: 'grow', tree, pivot, t: 0 });
    this.onEvent({ type: 'regrow', tree, position: tree.position.clone() });
  }

  // ---------- Reinicio (Fase 10) ----------

  /**
   * Bosque como al empezar: todos los árboles en pie con su resistencia completa, sin tocones,
   * sin caídas ni crecimientos en curso y sin madera en el suelo. Para "Nueva partida" y al
   * cambiar de cuenta (los árboles talados por una cuenta no deben verse en la de otra).
   */
  resetAll() {
    for (const a of this.animations) this.releaseVisual(a.pivot);
    this.animations.length = 0;
    for (const tree of this.forest.trees) {
      if (tree.state !== TREE_STATE.AVAILABLE) {
        this.forest.setTreeHidden(tree, HIDE_REASON.FELLED, false);
        this.showStump(tree, false);
      }
      tree.state = TREE_STATE.AVAILABLE;
      tree.resistance = this.maxResistance;
      tree.felledAt = null;
    }
    this.felled.clear();
    this.wood.clear();
  }

  // ---------- Bucle ----------

  update(dt, playerPosition) {
    this.time += dt;

    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i];
      a.t += dt;
      if (a.type === 'fall') {
        // Caída acelerada (como por gravedad) y un pequeño rebote al tocar el suelo
        const p = Math.min(1, a.t / CHOPPING.fallDuration);
        let angle = CHOPPING.fallAngle * p * p;
        if (a.t > CHOPPING.fallDuration) {
          const s = a.t - CHOPPING.fallDuration;
          angle = CHOPPING.fallAngle - 0.06 * Math.abs(Math.sin(s * 14)) * Math.exp(-s * 7);
        }
        a.pivot.quaternion.setFromAxisAngle(a.axis, angle);
        if (!a.landed && a.t >= CHOPPING.fallDuration) {
          a.landed = true;
          const reach = a.tree.userData.height * 0.7;
          const x = a.tree.position.x + a.dir.x * reach, z = a.tree.position.z + a.dir.z * reach;
          this.onEvent({ type: 'fallImpact', tree: a.tree, position: new THREE.Vector3(x, heightAt(x, z) + 0.5, z) });
        }
        if (a.t >= CHOPPING.fallDuration + CHOPPING.settleTime) {
          // El árbol tumbado se convierte en troncos de madera que se quedan en el suelo
          this.wood.addFromTree(this.woodPositions(a.tree, a.dir), a.dir, a.tree);
          this.releaseVisual(a.pivot);
          a.tree.state = TREE_STATE.FELLED;
          this.animations.splice(i, 1);
        }
      } else if (a.type === 'grow') {
        const p = Math.min(1, a.t / CHOPPING.growDuration);
        a.pivot.scale.setScalar(0.15 + 0.85 * (1 - (1 - p) ** 3));
        if (p >= 1) {
          // Recupera su modelo, posición y escala originales (su instancia) y toda su resistencia
          this.releaseVisual(a.pivot);
          this.forest.setTreeHidden(a.tree, HIDE_REASON.FELLED, false);
          a.tree.resistance = this.maxResistance;
          a.tree.felledAt = null;
          a.tree.state = TREE_STATE.AVAILABLE;
          this.animations.splice(i, 1);
        }
      }
    }

    // Regeneración: 25 s después del último golpe, si el personaje no ocupa el sitio
    for (const tree of this.felled) {
      if (tree.state !== TREE_STATE.FELLED) continue; // Aún cayendo
      if (this.time - tree.felledAt >= CHOPPING.regrowTime && !this.occupied(tree, playerPosition)) this.startRegrow(tree);
    }
  }
}
