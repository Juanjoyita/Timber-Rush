// menuCamera.js — Cámara cinematográfica del menú principal (Fase 10).
//
// - Órbita lenta y elevada alrededor de un centro entre el aserradero y el bosque, mirando
//   siempre al aserradero (que queda en cuadro) con un ligero balanceo de altura.
// - Transiciones suaves (aceleración y frenada) entre la órbita y la cámara en tercera persona:
//   se interpolan la posición y el punto de mira. El destino se pide en cada fotograma (la
//   cámara del juego también puede moverse), así no hay saltos al empezar ni al terminar.
// Solo mueve la cámara: no sabe nada del gameplay (no hay controles ni simulación en el menú).
import * as THREE from 'three';

export const MENU_CAMERA = {
  height: 42, // Altura media sobre el suelo (m)
  heightSwing: 4, // Balanceo de la altura (m)
  radius: 58, // Radio de la órbita (m)
  speed: 0.045, // rad/s (≈ 2,6°/s: una vuelta cada ~2 min 20 s)
  centerOffset: { x: 10, z: 10 }, // Centro de la órbita respecto al aserradero (hacia el bosque)
  lookHeight: 2, // Altura del punto de mira (aserradero)
  transitionDuration: 1.6, // s
};

/** Suavizado con aceleración y frenada (derivada 0 al principio y al final). */
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class MenuCamera {
  /**
   * @param camera THREE.PerspectiveCamera
   * @param focus  { x, z } punto que se mantiene en cuadro (el aserradero)
   */
  constructor(camera, focus, settings = MENU_CAMERA) {
    this.camera = camera;
    this.s = settings;
    this.focus = new THREE.Vector3(focus.x, settings.lookHeight, focus.z);
    this.center = new THREE.Vector3(focus.x + settings.centerOffset.x, 0, focus.z + settings.centerOffset.z);
    this.angle = 0.6; // Ángulo inicial: vista desde el lado del camino de llegada
    this.transition = null; // { from: {position, target}, to: () => {position, target}, t, onDone }
    this.lookTarget = this.focus.clone();
    this._pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    this._to = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  }

  /** Pose de la órbita para un ángulo dado (sin modificar la cámara). */
  orbitPose(angle = this.angle, out = this._pose) {
    const s = this.s;
    out.position.set(
      this.center.x + Math.cos(angle) * s.radius,
      s.height + Math.sin(angle * 2.3) * s.heightSwing,
      this.center.z + Math.sin(angle) * s.radius
    );
    out.target.copy(this.focus);
    return out;
  }

  /** Avanza la órbita y coloca la cámara (o la transición en curso). */
  update(dt) {
    if (this.transition) {
      this.updateTransition(dt);
      return;
    }
    this.angle += this.s.speed * dt;
    const pose = this.orbitPose();
    this.apply(pose.position, pose.target);
  }

  apply(position, target) {
    this.camera.position.copy(position);
    this.lookTarget.copy(target);
    this.camera.lookAt(target);
  }

  /**
   * Transición desde la pose actual de la cámara hasta otra.
   * @param to     () => { position, target } (se evalúa en cada fotograma)
   * @param onDone se llama una vez al terminar
   */
  startTransition(to, onDone = () => {}) {
    this.transition = {
      from: { position: this.camera.position.clone(), target: this.lookTarget.clone() },
      to,
      t: 0,
      onDone,
    };
  }

  /** Transición de vuelta a la órbita (desde donde esté la cámara del juego). */
  returnToOrbit(gameTarget, onDone = () => {}) {
    this.lookTarget.copy(gameTarget);
    // La órbita continúa desde el ángulo más cercano a la posición actual (recorrido corto)
    const p = this.camera.position;
    this.angle = Math.atan2(p.z - this.center.z, p.x - this.center.x);
    this.startTransition(() => {
      const pose = this.orbitPose(this.angle, this._to);
      return pose;
    }, onDone);
  }

  updateTransition(dt) {
    const tr = this.transition;
    tr.t = Math.min(1, tr.t + dt / this.s.transitionDuration);
    const k = smootherstep(tr.t);
    const to = tr.to();
    const pos = this._pose.position.copy(tr.from.position).lerp(to.position, k);
    const target = this._pose.target.copy(tr.from.target).lerp(to.target, k);
    this.apply(pos, target);
    if (tr.t >= 1) {
      this.transition = null;
      tr.onDone();
    }
  }

  get transitioning() {
    return this.transition !== null;
  }
}
