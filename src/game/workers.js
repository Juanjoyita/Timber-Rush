// workers.js — Trabajadores del aserradero (Fase 9).
//
// - WorkerProduction: lógica temporal sencilla (sin Three.js). Cada trabajador produce una
//   unidad de madera cada WORKERS.interval segundos; con el almacén lleno no producen.
//   Solo avanza cuando el juego la actualiza: Game.js lo hace únicamente mientras se juega.
// - WorkerCrew: los trabajadores visibles. Por cada uno contratado aparece un Worker en su puesto
//   del cobertizo, talando sobre un tocón (la misma animación y hacha que el jugador). No recorren
//   el bosque: la producción no depende de lo que hacen en pantalla.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ATTACK, WORKERS } from '../config.js';
import { createAxe } from './axes.js';
import { createAxeSocket } from './Player.js';

export class WorkerProduction {
  constructor(interval = WORKERS.interval) {
    this.interval = interval;
    this.progress = 0; // Segundos-trabajador acumulados hacia la siguiente unidad
  }

  /**
   * @param workers Trabajadores contratados (0..2)
   * @param free    Espacio libre en el almacén
   * @returns unidades producidas en este intervalo de tiempo
   */
  update(dt, workers, free) {
    if (workers <= 0) return 0;
    if (free <= 0) {
      this.progress = 0; // Almacén lleno: esperan (no acumulan producción)
      return 0;
    }
    this.progress += dt * workers;
    let units = 0;
    // Tolerancia: sumar 1/60 muchas veces da 59,99999… y la unidad llegaría un fotograma tarde
    while (this.progress >= this.interval - 1e-6 && units < free) {
      this.progress = Math.max(0, this.progress - this.interval);
      units++;
    }
    if (units === free) this.progress = Math.min(this.progress, this.interval * 0.999);
    return units;
  }

  /** Progreso hacia la siguiente unidad (0..1). */
  get fraction() {
    return Math.min(1, this.progress / this.interval);
  }
}

export class WorkerCrew {
  /**
   * @param scene   Escena
   * @param player  Player ya cargado (de él se toman el modelo, la tala y el puño)
   * @param spots   Puestos [{ x, y, z, yaw }] (forest.workerSpots)
   * @param onChop  (posición) => void en cada hachazo (sonido)
   */
  constructor(scene, player, spots, onChop = () => {}) {
    this.scene = scene;
    this.player = player;
    this.spots = spots;
    this.onChop = onChop;
    this.workers = []; // Se crean al contratarlos y se reutilizan
    this.count = 0;
  }

  /** Muestra tantos trabajadores como contratados (0..puestos). */
  setCount(n) {
    this.count = Math.max(0, Math.min(this.spots.length, Math.floor(n) || 0));
    while (this.workers.length < this.count) this.workers.push(this.createWorker(this.spots[this.workers.length], this.workers.length));
    this.workers.forEach((w, i) => {
      w.model.visible = i < this.count;
    });
  }

  createWorker(spot, index) {
    const model = cloneSkinned(this.player.gltf.scene); // Esqueleto propio (anima por separado)
    // El modelo de origen es el del jugador: el clon trae su hacha. Se quita y se pone la suya.
    const inherited = [];
    model.traverse((o) => {
      if (o.name === 'soporte-hacha') inherited.push(o);
    });
    for (const o of inherited) o.parent.remove(o);
    model.name = `trabajador-${index + 1}`;
    model.position.set(spot.x, spot.y, spot.z);
    model.rotation.y = spot.yaw;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
    });
    createAxeSocket(model).add(createAxe(1));
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(this.player.gripClip).play(); // Puño cerrado sobre el mango
    const chop = mixer.clipAction(this.player.chopClip);
    chop.play();
    // Cada uno empieza en un momento distinto del golpe: no van sincronizados
    chop.time = (index * 0.43 + 0.2) % this.player.chopClip.duration;
    this.scene.add(model);
    return { model, mixer, chop, prev: chop.time, position: new THREE.Vector3(spot.x + Math.sin(spot.yaw) * 0.8, spot.y + 0.4, spot.z + Math.cos(spot.yaw) * 0.8) };
  }

  /** Anima a los trabajadores visibles y avisa de cada hachazo (instante del golpe). */
  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const w = this.workers[i];
      w.mixer.update(dt);
      const t = w.chop.time;
      const hit = ATTACK.impactTime;
      const crossed = w.prev <= t ? w.prev < hit && t >= hit : w.prev < hit || t >= hit;
      w.prev = t;
      if (crossed) this.onChop(w.position);
    }
  }
}
