// Player.js — Personaje (Worker de Quaternius): modelo GLB, animaciones, controles,
// hacha equipada y sincronización con su cuerpo físico de cannon-es.
// FASE 5: caminar (WASD), correr (Shift + WASD) e Idle.
// FASE 6: ataque con el hacha (TreeChopping_Loop) mientras se mantiene el clic izquierdo.
//         El ataque es del personaje y no depende de que haya un árbol: golpea al aire si no
//         hay nada. En cada impacto avisa con onAttackImpact(ataque) y quien lo recibe (la tala,
//         en chopping.js) decide si alcanza a algo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER_RADIUS } from './physics.js';
import { createAxe } from './axes.js';
import { ATTACK } from '../config.js';

// worker.glb se genera con herramientas/retarget_worker.py (Blender): contiene el Worker
// con sus animaciones originales Idle/Walk/Run + TreeChopping_Loop adaptada de UAL2.
const MODEL_URL = '/assets/models/worker.glb';
const ANIMATIONS = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  chop: 'TreeChopping_Loop', // Golpe de hacha (Fase 6)
};

export const PLAYER_SETTINGS = {
  walkSpeed: 1.5, // m/s (WASD)
  runSpeed: 3.5, // m/s (Shift + WASD)
  // Velocidad a la que avanzan las animaciones a ritmo normal (medida en el modelo:
  // velocidad del pie apoyado). Se usan para ajustar el ritmo y que los pies no patinen.
  walkAnimSpeed: 0.9,
  runAnimSpeed: 1.79,
  acceleration: 10, // Rapidez para alcanzar la velocidad deseada (mayor = más brusco)
  turnSpeed: 12, // Rapidez de giro hacia la dirección del movimiento
  fadeTime: 0.2, // Transición entre animaciones (s)
  chopFadeTime: 0.15, // Transición al empezar a golpear (s); al soltar se usa fadeTime
};

// Soporte del hacha en el hueso de la mano derecha (medido en el espacio local de WristR):
// - GRIP_POINT: centro del puño cerrado (por donde pasa el mango).
// - HANDLE_DIR: el mango cruza la palma en diagonal (entre el eje de los nudillos
//   y la dirección muñeca→nudillos). En el impacto de la tala apunta hacia el tronco.
// - BLADE_DIR: el filo mira en la dirección del golpe de TreeChopping_Loop.
const AXE_SOCKET = {
  bone: 'WristR',
  gripPoint: new THREE.Vector3(0.016, 0.151, -0.015),
  handleDir: new THREE.Vector3(-0.593, 0.805, -0.028),
  bladeDir: new THREE.Vector3(0.786, 0.571, -0.236),
};
// Dedos de la mano derecha: en Idle y Walk la mano está abierta; para sujetar el hacha
// se aplica siempre el puño cerrado de la pose de tala (instante del golpe).
const RIGHT_HAND_BONES = /^(Index|Middle|Ring|Pinky|Thumb)\dR\./;
const GRIP_POSE_TIME = 0.17;

// Pasos: huesos de los pies (controles del pie del Worker) y altura sobre su punto más bajo a
// partir de la cual se considera que el pie toca el suelo (al bajar).
const FOOT_BONES = { L: 'FootL', R: 'FootR' };
const FOOT_CONTACT_HEIGHT = 0.05; // m: el talón llega al suelo
const FOOT_REARM_HEIGHT = 0.03; // m extra que el pie debe subir antes de contar otro apoyo

// Piezas de ropa intercambiables (todos los personajes del paquete comparten el esqueleto)
const OUTFIT_PART_NAME = /_(Head|Body|Legs|Pants|Feet)$/i;
const OUTFIT_SLOTS = { head: 'head', body: 'body', legs: 'legs', pants: 'legs', feet: 'feet' };

// Teclas por posición física (event.code): funcionan igual en teclados QWERTY y AZERTY
const KEY_BINDINGS = {
  KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

/**
 * Dirección de movimiento relativa a la cámara (en el plano XZ, normalizada).
 * @param input   Teclas pulsadas { forward, backward, left, right }
 * @param forward Dirección horizontal hacia la que mira la cámara (normalizada)
 * @param out     Vector donde se escribe el resultado (se reutiliza para no crear objetos)
 */
export function computeMoveDirection(input, forward, out) {
  const ahead = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  const side = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // Derecha de la cámara = adelante × arriba = (-forward.z, 0, forward.x)
  out.set(forward.x * ahead - forward.z * side, 0, forward.z * ahead + forward.x * side);
  if (out.lengthSq() > 0) out.normalize(); // En diagonal no va más rápido
  return out;
}

/** Acerca un ángulo a otro por el camino más corto, de forma suave e independiente de los FPS. */
function dampAngle(current, target, lambda, dt) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-lambda * dt));
}

/**
 * Crea un clip estático con el puño cerrado (valores de los dedos en un instante de la tala)
 * y elimina esas pistas de los demás clips, para que solo el puño controle los dedos.
 */
function buildGripClip(chopClip, clips) {
  const tracks = [];
  for (const track of chopClip.tracks) {
    if (!RIGHT_HAND_BONES.test(track.name)) continue;
    const value = track.createInterpolant().evaluate(GRIP_POSE_TIME).slice();
    tracks.push(new track.constructor(track.name, [0], value));
  }
  for (const clip of clips) clip.tracks = clip.tracks.filter((t) => !RIGHT_HAND_BONES.test(t.name));
  // Duración 1 s (no 0): un clip de duración 0 en bucle provocaría divisiones por cero
  return new THREE.AnimationClip('Grip_R', 1, tracks);
}

/**
 * Soporte del hacha en la mano derecha (hueso WristR) de un modelo del Worker. Lo usan el
 * jugador y los trabajadores del aserradero.
 */
export function createAxeSocket(model) {
  const bone = model.getObjectByName(AXE_SOCKET.bone);
  if (!bone) throw new Error(`falta el hueso ${AXE_SOCKET.bone} en worker.glb`);
  const y = AXE_SOCKET.handleDir.clone().normalize();
  const x = AXE_SOCKET.bladeDir.clone().sub(y.clone().multiplyScalar(AXE_SOCKET.bladeDir.dot(y))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const socket = new THREE.Object3D();
  socket.name = 'soporte-hacha';
  socket.position.copy(AXE_SOCKET.gripPoint);
  socket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  bone.add(socket);
  return socket;
}

/**
 * Instantes de un ciclo en los que cada pie toca el suelo: el hueso del pie, al bajar, cruza
 * FOOT_CONTACT_HEIGHT sobre su punto más bajo. Se calcula una vez muestreando la animación.
 * @returns [{ time, foot: 'L' | 'R' }] ordenados por tiempo
 */
export function computeFootstepTimes(model, clip, samples = 120) {
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  const p = new THREE.Vector3();
  const heights = { L: [], R: [] };
  for (let i = 0; i <= samples; i++) {
    mixer.setTime((i / samples) * clip.duration);
    model.updateMatrixWorld(true);
    for (const [foot, bone] of Object.entries(FOOT_BONES)) heights[foot].push(model.getObjectByName(bone).getWorldPosition(p).y);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  const steps = [];
  for (const [foot, h] of Object.entries(heights)) {
    const limit = Math.min(...h) + FOOT_CONTACT_HEIGHT;
    // Histéresis: tras un apoyo, el pie debe levantarse de verdad antes de contar el siguiente
    // (el talón y luego la planta rozan el umbral y no deben sonar como dos pasos)
    const rearm = limit + FOOT_REARM_HEIGHT;
    // El ciclo es circular: se recorre empezando en un instante con el pie en el aire
    const start = Math.max(0, h.findIndex((y) => y > rearm));
    let armed = false;
    for (let k = 1; k <= samples; k++) {
      const i = ((start + k - 1) % samples) + 1; // Recorre el ciclo desde que el pie está arriba
      if (h[i - 1] > rearm) armed = true;
      if (armed && h[i - 1] > limit && h[i] <= limit) {
        armed = false;
        // Interpolación entre las dos muestras para un instante más preciso
        const f = (h[i - 1] - limit) / (h[i - 1] - h[i]);
        steps.push({ time: ((i - 1 + f) / samples) * clip.duration, foot });
      }
    }
  }
  return steps.sort((a, b) => a.time - b.time);
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.model = null;
    this.body = null; // Cuerpo físico (cannon-es)
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.enabled = false; // Solo responde al teclado en la pantalla de juego
    this.input = { forward: false, backward: false, left: false, right: false, run: false };
    this.yaw = 0; // Orientación visual (el modelo mira hacia +Z con yaw = 0)

    // Ropa: piezas intercambiables que comparten el mismo esqueleto (preparado para una
    // futura tienda; cambiar una pieza no afecta al hacha, que cuelga de un hueso).
    this.outfit = { head: null, body: null, legs: null, feet: null };
    // Hacha: soporte unido a la mano + modelo actual
    this.axeSocket = null;
    this.axe = null;

    // Ataque con el hacha
    this.attackHeld = false; // Clic izquierdo mantenido (lo indica el juego cada fotograma)
    this.attackAim = null; // Punto opcional hacia el que girarse (ayuda de puntería) o null
    this.attacking = false; // Golpeando en este momento
    this.onAttackImpact = null; // (ataque) => void. Lo asigna el juego
    this.attackPrevTime = 0;
    // Datos del golpe (se reutiliza el mismo objeto en cada impacto)
    this.attackInfo = { origin: new THREE.Vector3(), direction: new THREE.Vector3(), reach: ATTACK.reach, halfAngle: ATTACK.halfAngle, damage: 1 };

    // Pasos: instantes de apoyo de cada pie en Walk y Run (se calculan al cargar el modelo)
    this.footstepTimes = { walk: [], run: [] }; // [{ time, foot }]
    this.footstepPrev = { walk: null, run: null };
    this.onFootstep = null; // ({ running, foot }) => void. Lo asigna el juego (sonido)

    // Vectores reutilizables (evita crear objetos en cada fotograma)
    this.cameraForward = new THREE.Vector3();
    this.moveDir = new THREE.Vector3();

    window.addEventListener('keydown', (e) => this.handleKey(e, true));
    window.addEventListener('keyup', (e) => this.handleKey(e, false));
    // Si la ventana pierde el foco con una tecla pulsada, no debe quedarse "atascada"
    window.addEventListener('blur', () => this.resetInput());
  }

  /** Carga el modelo GLB y prepara animaciones, ropa y hacha. */
  async load() {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    this.model = gltf.scene;
    this.model.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      // La caja envolvente de una malla con esqueleto es la de la pose de reposo; al
      // animarse podría recortarse por error. Es un solo personaje: se desactiva el recorte.
      if (obj.isSkinnedMesh) obj.frustumCulled = false;
    });
    // Piezas de ropa por su nombre (Worker_Head, Worker_Body, Worker_Legs, Worker_Feet).
    // Una pieza con varios materiales se carga como un Group con hijos Worker_Body_1, _2…;
    // se guarda el nodo completo de la pieza. "Pants" es el nombre que usa el Farmer.
    this.model.traverse((obj) => {
      const match = obj.name.match(OUTFIT_PART_NAME);
      if (!match) return;
      const part = OUTFIT_SLOTS[match[1].toLowerCase()];
      if (!this.outfit[part]) this.outfit[part] = obj;
    });

    // AnimationMixer: reproduce los clips de animación sobre el esqueleto del modelo
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = {};
    for (const [key, clipName] of Object.entries(ANIMATIONS)) {
      clips[key] = THREE.AnimationClip.findByName(gltf.animations, clipName);
      if (!clips[key]) throw new Error(`falta la animación "${clipName}" en worker.glb`);
    }
    // Puño cerrado permanente en la mano del hacha (capa independiente de las demás animaciones)
    const grip = buildGripClip(clips.chop, Object.values(clips));
    this.mixer.clipAction(grip).play();
    // Para los trabajadores del aserradero (Fase 9): mismo modelo, animación de tala y puño
    this.gltf = gltf;
    this.gripClip = grip;
    this.chopClip = clips.chop;
    for (const [key, clip] of Object.entries(clips)) this.actions[key] = this.mixer.clipAction(clip);
    this.footstepTimes.walk = computeFootstepTimes(this.model, clips.walk);
    this.footstepTimes.run = computeFootstepTimes(this.model, clips.run);
    console.info(`[Timber Rush] Animaciones del personaje: ${gltf.animations.map((c) => c.name).join(', ')}`);

    this.attachAxeSocket();
    this.equipAxe(1); // Hacha básica (las mejoras llegan en la Fase 8)

    this.play('idle', 0);
    this.scene.add(this.model);
  }

  /** Crea el soporte del hacha como hijo del hueso de la mano: sigue todas las animaciones. */
  attachAxeSocket() {
    this.axeSocket = createAxeSocket(this.model);
  }

  /** Coloca en la mano el hacha del nivel indicado (todas comparten el mismo agarre). */
  equipAxe(level) {
    if (this.axe) this.axeSocket.remove(this.axe);
    this.axe = createAxe(level);
    this.axeSocket.add(this.axe);
  }

  /** Asocia el cuerpo físico y coloca el modelo en su posición. */
  attachBody(body, yaw = 0) {
    this.body = body;
    this.yaw = yaw;
    this.body.interpolatedPosition.copy(this.body.position);
    this.syncVisual(0);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.resetInput();
      this.setAttack(false);
      this.attacking = false;
    }
  }

  // ---------- Ataque ----------

  get isAttacking() {
    return this.attacking;
  }

  /**
   * El juego indica cada fotograma si el clic izquierdo está mantenido y, opcionalmente, un
   * punto hacia el que girarse (p. ej. el árbol al que se apunta). Sin punto, el personaje
   * golpea hacia donde mira la cámara.
   */
  setAttack(held, aimPoint = null) {
    this.attackHeld = held;
    this.attackAim = held ? aimPoint : null;
  }

  handleKey(event, pressed) {
    const action = KEY_BINDINGS[event.code];
    if (!action || !this.enabled) return;
    this.input[action] = pressed;
  }

  resetInput() {
    for (const key of Object.keys(this.input)) this.input[key] = false;
  }

  /** Cambia de animación con una transición suave (crossfade). */
  play(name, fadeTime = PLAYER_SETTINGS.fadeTime) {
    const next = this.actions[name];
    if (next === this.currentAction) return;
    next.reset().play();
    if (this.currentAction) this.currentAction.crossFadeTo(next, fadeTime, false);
    this.currentAction = next;
  }

  /**
   * Antes del paso de física: decide la velocidad del cuerpo según las teclas y la cámara.
   * Solo se modifica la velocidad horizontal; la vertical la gobierna la gravedad.
   */
  update(dt, camera) {
    if (!this.body) return;
    const s = PLAYER_SETTINGS;

    camera.getWorldDirection(this.cameraForward);
    this.cameraForward.y = 0;
    this.cameraForward.normalize();
    computeMoveDirection(this.input, this.cameraForward, this.moveDir);
    const wantsToMove = this.moveDir.lengthSq() > 0;

    // Ataque: mientras se mantiene el clic y no se pulsa ninguna tecla de movimiento
    // (moverse lo cancela). Al soltar, la animación vuelve a Idle con una transición suave.
    const attacking = this.attackHeld && !wantsToMove;
    if (attacking && !this.attacking) this.attackPrevTime = 0;
    this.attacking = attacking;
    if (attacking) {
      // Quieto, girado hacia el objetivo (si lo hay) o hacia donde mira la cámara
      const v = this.body.velocity;
      v.x = 0;
      v.z = 0;
      this.body.linearFactor.set(0, 1, 0);
      const aim = this.attackAim;
      const face = aim ? Math.atan2(aim.x - this.body.position.x, aim.z - this.body.position.z) : Math.atan2(this.cameraForward.x, this.cameraForward.z);
      this.yaw = dampAngle(this.yaw, face, s.turnSpeed, dt);
      this.play('chop', s.chopFadeTime);
      return;
    }
    const running = wantsToMove && this.input.run;
    const targetSpeed = running ? s.runSpeed : s.walkSpeed;
    const v = this.body.velocity;

    // Velocidad REAL que dejó el paso de física anterior (si un tronco lo bloquea, ≈ 0)
    const actualSpeed = Math.hypot(v.x, v.z);

    // "Freno de estacionamiento": sin teclas y casi parado (< 0,3 m/s), se bloquea el
    // movimiento horizontal del cuerpo (linearFactor). Como el contacto con el suelo no
    // tiene fricción, sin esto la gravedad lo deslizaría lentamente por las pendientes.
    const parked = !wantsToMove && actualSpeed < 0.3;
    this.body.linearFactor.set(parked ? 0 : 1, 1, parked ? 0 : 1);
    if (parked) {
      v.x = 0;
      v.z = 0;
    } else {
      // Aceleración suave (exponencial): no arranca ni frena en seco
      const k = 1 - Math.exp(-s.acceleration * dt);
      v.x += (this.moveDir.x * targetSpeed - v.x) * k;
      v.z += (this.moveDir.z * targetSpeed - v.z) * k;
    }

    // Gira suavemente hacia donde se mueve
    if (wantsToMove) this.yaw = dampAngle(this.yaw, Math.atan2(this.moveDir.x, this.moveDir.z), s.turnSpeed, dt);

    // Animación según la velocidad real: contra un tronco no "camina en el sitio"
    if (wantsToMove && actualSpeed > 0.3) {
      const name = running ? 'run' : 'walk';
      this.play(name);
      // Ritmo de los pasos acorde a la velocidad real
      this.actions[name].timeScale = actualSpeed / (running ? s.runAnimSpeed : s.walkAnimSpeed);
    } else {
      this.play('idle');
    }
  }

  /**
   * Después del paso de física: copia la posición del cuerpo al modelo.
   * Se usa la posición INTERPOLADA de cannon-es: la física avanza en pasos fijos de
   * 1/60 s y la pantalla puede ir a otro ritmo (p. ej. 144 Hz); interpolar evita tirones.
   * La esfera está centrada a PLAYER_RADIUS del suelo; los pies del modelo están en y = 0.
   */
  syncVisual(dt) {
    const p = this.body.interpolatedPosition;
    this.model.position.set(p.x, p.y - PLAYER_RADIUS, p.z);
    this.model.rotation.y = this.yaw;
    this.mixer.update(dt);
    this.detectAttackImpact();
    this.detectFootsteps();
  }

  /**
   * Pasos: cuando la animación de caminar o correr cruza el instante en que un pie toca el
   * suelo, avisa (una vez por pie y ciclo). Sigue el ritmo real de la animación (timeScale).
   * Quieto, golpeando o en una transición poco visible, no hay pasos.
   */
  detectFootsteps() {
    for (const name of ['walk', 'run']) {
      const action = this.actions[name];
      if (this.currentAction !== action || action.getEffectiveWeight() <= 0.5) {
        this.footstepPrev[name] = null;
        continue;
      }
      const t = action.time;
      const prev = this.footstepPrev[name];
      this.footstepPrev[name] = t;
      if (prev === null) continue; // Primer fotograma: solo se toma la referencia
      for (const step of this.footstepTimes[name]) {
        const crossed = prev <= t ? prev < step.time && t >= step.time : prev < step.time || t >= step.time;
        if (crossed) this.onFootstep?.({ running: name === 'run', foot: step.foot });
      }
    }
  }

  /**
   * Impacto del hacha: una sola vez por ciclo de TreeChopping_Loop, cuando el tiempo de la
   * animación cruza el instante del golpe (la mano se frena en seco). Ocurre aunque no haya
   * nada delante: el ataque informa de dónde, hacia dónde, con qué alcance y con qué daño.
   * Mantener el clic no aplica daño continuo; soltar antes del golpe no aplica nada.
   */
  detectAttackImpact() {
    const chop = this.actions.chop;
    if (!this.attacking || this.currentAction !== chop) return;
    const t = chop.time;
    const prev = this.attackPrevTime;
    const hitAt = ATTACK.impactTime;
    // Cruce normal (prev < golpe ≤ t) o, si el bucle volvió a empezar, cruce a través del final
    const crossed = prev <= t ? prev < hitAt && t >= hitAt : prev < hitAt || t >= hitAt;
    this.attackPrevTime = t;
    if (!crossed || chop.getEffectiveWeight() <= 0.5) return;
    const a = this.attackInfo;
    a.origin.copy(this.model.position);
    a.direction.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); // Hacia donde mira el personaje
    a.damage = this.axe?.userData.damage ?? 1; // Según el nivel del hacha equipada
    this.onAttackImpact?.(a);
  }

  get position() {
    return this.model.position;
  }
}
