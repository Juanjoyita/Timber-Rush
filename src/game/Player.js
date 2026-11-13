// Player.js — Personaje del leñador: modelo GLB, animaciones, controles WASD
// y sincronización con su cuerpo físico de cannon-es.
// FASE 5: caminar (Idle / Walk). La animación de tala (Slash) se añade en la Fase 6.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER_RADIUS } from './physics.js';

const MODEL_URL = '/assets/models/lumberjack.glb';
const ANIMATIONS = {
  idle: 'CharacterArmature|Idle',
  walk: 'CharacterArmature|Walk',
};

export const PLAYER_SETTINGS = {
  walkSpeed: 2.6, // Velocidad al caminar (m/s)
  // Velocidad a la que avanza la animación Walk a ritmo normal (medida en el modelo:
  // el pie apoyado retrocede ~1,23 m/s). Sirve para acelerar la animación lo justo
  // y que los pies no "patinen" sobre el suelo.
  walkAnimSpeed: 1.23,
  acceleration: 10, // Rapidez para alcanzar la velocidad deseada (mayor = más brusco)
  turnSpeed: 12, // Rapidez de giro hacia la dirección del movimiento
  fadeTime: 0.2, // Transición entre animaciones (s)
};

// Teclas por posición física (event.code): funcionan igual en teclados QWERTY y AZERTY
const KEY_BINDINGS = { KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right' };

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

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.model = null;
    this.body = null; // Cuerpo físico (cannon-es)
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.enabled = false; // Solo responde al teclado en la pantalla de juego
    this.input = { forward: false, backward: false, left: false, right: false };
    this.yaw = 0; // Orientación visual (el modelo mira hacia +Z con yaw = 0)

    // Vectores reutilizables (evita crear objetos en cada fotograma)
    this.cameraForward = new THREE.Vector3();
    this.moveDir = new THREE.Vector3();

    window.addEventListener('keydown', (e) => this.handleKey(e, true));
    window.addEventListener('keyup', (e) => this.handleKey(e, false));
    // Si la ventana pierde el foco con una tecla pulsada, no debe quedarse "atascada"
    window.addEventListener('blur', () => this.resetInput());
  }

  /** Carga el modelo GLB y prepara sus animaciones. */
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

    // AnimationMixer: reproduce los clips de animación sobre el esqueleto del modelo
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [key, clipName] of Object.entries(ANIMATIONS)) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
      if (!clip) throw new Error(`falta la animación "${clipName}" en lumberjack.glb`);
      this.actions[key] = this.mixer.clipAction(clip);
    }
    console.info(`[Timber Rush] Animaciones disponibles: ${gltf.animations.map((c) => c.name).join(', ')}`);

    this.play('idle', 0);
    this.scene.add(this.model);
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
      v.x += (this.moveDir.x * s.walkSpeed - v.x) * k;
      v.z += (this.moveDir.z * s.walkSpeed - v.z) * k;
    }

    // Gira suavemente hacia donde camina
    if (wantsToMove) this.yaw = dampAngle(this.yaw, Math.atan2(this.moveDir.x, this.moveDir.z), s.turnSpeed, dt);

    // Animación según la velocidad real: contra un tronco no "camina en el sitio"
    if (wantsToMove && actualSpeed > 0.3) {
      this.play('walk');
      this.actions.walk.timeScale = actualSpeed / s.walkAnimSpeed; // Pasos acordes a la velocidad
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
