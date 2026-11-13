// Player.js — Personaje (Worker de Quaternius): modelo GLB, animaciones, controles,
// hacha equipada y sincronización con su cuerpo físico de cannon-es.
// FASE 5: caminar (WASD), correr (Shift + WASD) e Idle. La tala llega en la Fase 6.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER_RADIUS } from './physics.js';
import { createAxe } from './axes.js';

// worker.glb se genera con herramientas/retarget_worker.py (Blender): contiene el Worker
// con sus animaciones originales Idle/Walk/Run + TreeChopping_Loop adaptada de UAL2.
const MODEL_URL = '/assets/models/worker.glb';
const ANIMATIONS = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  chop: 'TreeChopping_Loop', // Se carga ya, pero se usará en la Fase 6
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
    for (const [key, clip] of Object.entries(clips)) this.actions[key] = this.mixer.clipAction(clip);
    console.info(`[Timber Rush] Animaciones del personaje: ${gltf.animations.map((c) => c.name).join(', ')}`);

    this.attachAxeSocket();
    this.equipAxe(1); // Hacha básica (las mejoras llegan en la Fase 8)

    this.play('idle', 0);
    this.scene.add(this.model);
  }

  /** Crea el soporte del hacha como hijo del hueso de la mano: sigue todas las animaciones. */
  attachAxeSocket() {
    const bone = this.model.getObjectByName(AXE_SOCKET.bone);
    if (!bone) throw new Error(`falta el hueso ${AXE_SOCKET.bone} en worker.glb`);
    const y = AXE_SOCKET.handleDir.clone().normalize();
    const x = AXE_SOCKET.bladeDir.clone().sub(y.clone().multiplyScalar(AXE_SOCKET.bladeDir.dot(y))).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    this.axeSocket = new THREE.Object3D();
    this.axeSocket.name = 'soporte-hacha';
    this.axeSocket.position.copy(AXE_SOCKET.gripPoint);
    this.axeSocket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    bone.add(this.axeSocket);
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
    if (!enabled) this.resetInput();
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
  }

  get position() {
    return this.model.position;
  }
}
