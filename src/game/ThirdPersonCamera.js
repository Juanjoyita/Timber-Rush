// ThirdPersonCamera.js — Cámara en tercera persona controlada con el ratón (Pointer Lock).
//
// - El ratón gira la cámara SIN pulsar ningún botón: con Pointer Lock el cursor se oculta
//   y el navegador entrega el desplazamiento relativo del ratón (movementX / movementY).
// - La posición se describe con coordenadas esféricas (THREE.Spherical) alrededor de un
//   punto de mira (pivote) situado sobre el personaje:
//     · theta: giro horizontal alrededor del personaje
//     · phi:   inclinación (ángulo desde la vertical), limitada para no voltearse
//     · radius: distancia (rueda del ratón)
// - Suavizado exponencial (independiente de los FPS) para el giro, el zoom y el seguimiento.
// - La cámara gira solo con el ratón: no gira sola cuando el personaje cambia de dirección.
// - Si hay un obstáculo entre el personaje y la cámara, se acerca al instante; cuando
//   desaparece, recupera la distancia normal poco a poco.
import * as THREE from 'three';

export const CAMERA_SETTINGS = {
  sensitivity: 0.0022, // Radianes por píxel de desplazamiento del ratón
  pivotHeight: 2.5, // Punto de mira: por encima de la cabeza del personaje (1,83 m)
  distance: 9, // Distancia inicial (m)
  minDistance: 4,
  maxDistance: 14,
  zoomStep: 1, // Metros por paso de la rueda
  startPolar: 1.44, // Inclinación inicial (rad desde la vertical): vista casi horizontal
  minPolar: 0.5, // Lo más cenital que puede mirar (≈29° desde arriba)
  maxPolar: 1.52, // Lo más baja (≈87°): no pasa por debajo del horizonte
  rotationSmoothing: 25, // Rapidez con que el giro alcanza al ratón (alto = casi inmediato)
  followSmoothing: 12, // Rapidez con que el pivote sigue al personaje
  zoomSmoothing: 10,
  recoverSmoothing: 4, // Rapidez con que se recupera la distancia tras un obstáculo
  collisionMargin: 0.3, // Separación de la cámara respecto al obstáculo (m)
  minCollisionDistance: 1.2, // Nunca más cerca del pivote que esto
  groundClearance: 0.4, // Altura mínima sobre el terreno (m)
};

const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

export class ThirdPersonCamera {
  /**
   * @param camera     THREE.PerspectiveCamera que se controla
   * @param domElement Elemento del juego (canvas): recibe el Pointer Lock y la rueda
   * @param options    { heightAt, obstacles, settings, doc } (doc se sustituye en las pruebas)
   */
  constructor(camera, domElement, { heightAt, obstacles = null, settings = CAMERA_SETTINGS, doc = document } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.doc = doc;
    this.heightAt = heightAt;
    this.obstacles = obstacles;
    this.s = settings;

    // Ángulos y distancia deseados (los cambia el ratón) y actuales (suavizados)
    this.target = new THREE.Spherical(settings.distance, settings.startPolar, 0);
    this.current = this.target.clone();
    this.collisionDistance = settings.distance; // Distancia real tras comprobar obstáculos
    this.pivot = new THREE.Vector3();
    this.initialized = false;
    this.enabled = false; // Solo acepta ratón y rueda mientras se juega
    this.sensitivityScale = 1; // Configuración (Fase 10): multiplica la sensibilidad del ratón

    this.locked = false;
    this.onLockChange = null; // (bloqueado) => void
    this.onLockError = null; // () => void

    // Objetos reutilizables
    this.desiredPivot = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.onMouseMove = this.onMouseMove.bind(this);
    this.onWheel = this.onWheel.bind(this);
    doc.addEventListener('mousemove', this.onMouseMove);
    doc.addEventListener('pointerlockchange', () => {
      this.locked = this.doc.pointerLockElement === this.dom;
      this.onLockChange?.(this.locked);
    });
    doc.addEventListener('pointerlockerror', () => this.onLockError?.());
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    // Sin menú contextual del navegador sobre el juego
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- Pointer Lock ----------

  /** Pide capturar el cursor. Debe llamarse desde una interacción del usuario (clic). */
  requestLock() {
    if (this.doc.pointerLockElement === this.dom) return;
    try {
      const result = this.dom.requestPointerLock();
      // En los navegadores modernos devuelve una promesa que se rechaza si no se permite
      if (result && typeof result.catch === 'function') result.catch(() => this.onLockError?.());
    } catch {
      this.onLockError?.();
    }
  }

  releaseLock() {
    if (this.doc.pointerLockElement === this.dom) this.doc.exitPointerLock();
  }

  // ---------- Entrada ----------

  onMouseMove(event) {
    if (!this.locked || !this.enabled) return; // El ratón solo mueve la cámara con el cursor capturado
    const s = this.s;
    const k = s.sensitivity * this.sensitivityScale;
    this.target.theta -= event.movementX * k;
    // Ratón hacia arriba → la cámara baja y mira hacia arriba
    this.target.phi = THREE.MathUtils.clamp(this.target.phi - event.movementY * k, s.minPolar, s.maxPolar);
  }

  onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    const s = this.s;
    this.target.radius = THREE.MathUtils.clamp(this.target.radius + Math.sign(event.deltaY) * s.zoomStep, s.minDistance, s.maxDistance);
  }

  /** Coloca la cámara detrás de un personaje que mira hacia "yaw" (sin animación). */
  placeBehind(focus, yaw) {
    this.target.theta = yaw + Math.PI;
    this.current.theta = this.target.theta;
    this.desiredPivot.set(focus.x, focus.y + this.s.pivotHeight, focus.z);
    this.pivot.copy(this.desiredPivot);
    this.initialized = true;
  }

  // ---------- Transiciones del menú (Fase 10) ----------

  /**
   * Pose que tendrá la cámara detrás del personaje (con obstáculos y terreno), sin suavizado.
   * Es el destino de la transición desde el menú.
   */
  targetPose(focus, out = { position: new THREE.Vector3(), target: new THREE.Vector3() }) {
    const s = this.s;
    out.target.set(focus.x, focus.y + s.pivotHeight, focus.z);
    this.direction.setFromSphericalCoords(1, this.target.phi, this.target.theta);
    let distance = this.target.radius;
    if (this.obstacles) {
      const hit = this.obstacles.raycast(out.target, this.direction, distance + s.collisionMargin);
      if (hit < Infinity) distance = Math.max(s.minCollisionDistance, Math.min(distance, hit - s.collisionMargin));
    }
    out.position.copy(out.target).addScaledVector(this.direction, distance);
    const minY = this.heightAt(out.position.x, out.position.z) + s.groundClearance;
    if (out.position.y < minY) out.position.y = minY;
    out.distance = distance;
    return out;
  }

  /** Deja la cámara exactamente en su pose de juego (al terminar la transición: sin saltos). */
  snapTo(focus) {
    const pose = this.targetPose(focus);
    this.pivot.copy(pose.target);
    this.desiredPivot.copy(pose.target);
    this.current.copy(this.target);
    this.collisionDistance = pose.distance;
    this.initialized = true;
    this.camera.position.copy(pose.position);
    this.camera.lookAt(this.pivot);
  }

  // ---------- Actualización (cada fotograma) ----------

  update(dt, focus) {
    const s = this.s;
    this.desiredPivot.set(focus.x, focus.y + s.pivotHeight, focus.z);
    if (!this.initialized) {
      this.pivot.copy(this.desiredPivot);
      this.initialized = true;
    } else {
      this.pivot.lerp(this.desiredPivot, 1 - Math.exp(-s.followSmoothing * dt));
    }

    // Giro, inclinación y zoom suavizados
    this.current.theta = damp(this.current.theta, this.target.theta, s.rotationSmoothing, dt);
    this.current.phi = damp(this.current.phi, this.target.phi, s.rotationSmoothing, dt);
    this.current.radius = damp(this.current.radius, this.target.radius, s.zoomSmoothing, dt);

    // Dirección del pivote hacia la cámara (vector unitario de las coordenadas esféricas)
    this.direction.setFromSphericalCoords(1, this.current.phi, this.current.theta);

    // Obstáculos: acercarse al instante; alejarse poco a poco
    let allowed = this.current.radius;
    if (this.obstacles) {
      const hit = this.obstacles.raycast(this.pivot, this.direction, this.current.radius + s.collisionMargin);
      if (hit < Infinity) allowed = Math.max(s.minCollisionDistance, Math.min(allowed, hit - s.collisionMargin));
    }
    this.collisionDistance = allowed < this.collisionDistance ? allowed : damp(this.collisionDistance, allowed, s.recoverSmoothing, dt);

    const cam = this.camera.position;
    cam.copy(this.pivot).addScaledVector(this.direction, this.collisionDistance);
    // Nunca por debajo del terreno
    const minY = this.heightAt(cam.x, cam.z) + s.groundClearance;
    if (cam.y < minY) cam.y = minY;
    this.camera.lookAt(this.pivot);
  }
}

/**
 * Obstáculos para la cámara: rayo desde el pivote contra el terreno, los troncos (cilindros
 * hasta la altura del tronco visible, sin las hojas) y las cajas sólidas del aserradero.
 * Sin física: solo geometría simple. Los árboles se buscan en una rejilla espacial.
 */
export class CameraObstacles {
  constructor({ trees, boxes, heightAt, cell = 4 }) {
    this.trees = trees;
    this.boxes = boxes;
    this.heightAt = heightAt;
    this.cell = cell;
    this.grid = new Map();
    for (const tree of trees) {
      const key = `${Math.floor(tree.position.x / cell)},${Math.floor(tree.position.z / cell)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(tree);
    }
  }

  /** Distancia hasta el primer obstáculo a lo largo del rayo (Infinity si no hay ninguno). */
  raycast(origin, dir, maxDist) {
    return Math.min(this.raycastTerrain(origin, dir, maxDist), this.raycastTrunks(origin, dir, maxDist), this.raycastBoxes(origin, dir, maxDist));
  }

  raycastTerrain(o, d, maxDist) {
    const step = 0.5;
    for (let t = step; t <= maxDist; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < this.heightAt(x, z) + 0.2) return t;
    }
    return Infinity;
  }

  raycastTrunks(o, d, maxDist) {
    let best = Infinity;
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    const i0 = Math.floor(Math.min(o.x, ex) / this.cell) - 1, i1 = Math.floor(Math.max(o.x, ex) / this.cell) + 1;
    const j0 = Math.floor(Math.min(o.z, ez) / this.cell) - 1, j1 = Math.floor(Math.max(o.z, ez) / this.cell) + 1;
    const dh = Math.hypot(d.x, d.z);
    if (dh < 1e-6) return best;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.grid.get(`${i},${j}`);
        if (!list) continue;
        for (const tree of list) {
          if (tree.state && tree.state !== 'disponible' && tree.state !== 'regenerándose') continue; // Talado: solo tocón
          // Intersección rayo-círculo en el plano XZ
          const r = tree.userData.radius + 0.1;
          const fx = o.x - tree.position.x, fz = o.z - tree.position.z;
          const a = d.x * d.x + d.z * d.z, b = 2 * (fx * d.x + fz * d.z), c = fx * fx + fz * fz - r * r;
          const disc = b * b - 4 * a * c;
          if (disc < 0) continue;
          const t = (-b - Math.sqrt(disc)) / (2 * a);
          if (t < 0 || t > maxDist || t >= best) continue;
          const y = o.y + d.y * t;
          if (y >= tree.position.y && y <= tree.position.y + tree.userData.trunkHeight) best = t; // Solo el tronco, no las hojas
        }
      }
    }
    return best;
  }

  raycastBoxes(o, d, maxDist) {
    let best = Infinity;
    for (const b of this.boxes) {
      // Método de las "losas" (slab) para cajas alineadas con los ejes, eje por eje
      // (sin crear objetos temporales: se llama en cada fotograma)
      this.tmin = 0;
      this.tmax = maxDist;
      if (this.slab(o.x, d.x, b.x, b.hx) && this.slab(o.y, d.y, b.y, b.hy) && this.slab(o.z, d.z, b.z, b.hz) && this.tmin < best) {
        best = this.tmin;
      }
    }
    return best;
  }

  /** Recorta el intervalo [tmin, tmax] con la losa de un eje. Devuelve false si no hay cruce. */
  slab(origin, dir, center, half) {
    if (Math.abs(dir) < 1e-9) return origin >= center - half && origin <= center + half;
    let t1 = (center - half - origin) / dir;
    let t2 = (center + half - origin) / dir;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > this.tmin) this.tmin = t1;
    if (t2 < this.tmax) this.tmax = t2;
    return this.tmin <= this.tmax;
  }
}
