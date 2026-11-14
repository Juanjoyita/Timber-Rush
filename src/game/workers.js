// workers.js — Trabajadores del aserradero (Fase 9).
//
// - WorkerProduction: lógica temporal sencilla (sin Three.js). Cada trabajador produce una
//   unidad de madera cada WORKERS.interval segundos en el nivel 0 del aserradero; cada nivel
//   acelera el ritmo y entrega lotes mayores (productionStats); con el almacén lleno no producen.
//   Solo avanza cuando el juego la actualiza: Game.js lo hace únicamente mientras se juega.
// - WorkerCrew: los trabajadores visibles. Por cada uno contratado aparece un Worker en su puesto
//   del cobertizo, talando sobre un tocón (la misma animación y hacha que el jugador). No recorren
//   el bosque: la producción no depende de lo que hacen en pantalla.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ATTACK, WORKERS } from '../config.js';
import { createAxe } from './axes.js';
import { createAxeSocket } from './Player.js';
import { productionStats } from './economy.js';

export class WorkerProduction {
  constructor(interval = WORKERS.interval) {
    this.interval = interval;
    this.progress = 0; // Unidades acumuladas hacia el siguiente lote (fracción de madera)
    this.batch = 1;
  }

  /**
   * @param workers Trabajadores contratados (0..2)
   * @param free    Espacio libre en el almacén
   * @param level   Nivel del aserradero (0..10): ritmo y tamaño del lote
   * @returns unidades producidas en este intervalo de tiempo
   *
   * Cambiar de nivel a mitad de ciclo conserva el progreso acumulado (en unidades): no se
   * pierde ni se duplica nada; solo cambia lo que falta para el siguiente lote.
   */
  update(dt, workers, free, level = 0) {
    const { rate, batch } = productionStats(level, this.interval);
    this.batch = batch;
    if (workers <= 0) return 0;
    if (free <= 0) {
      this.progress = 0; // Almacén lleno: esperan (no acumulan producción)
      return 0;
    }
    this.progress += dt * workers * rate;
    let units = 0;
    // Tolerancia: sumar 1/60 muchas veces da 0,99999… y el lote llegaría un fotograma tarde
    while (this.progress >= batch - 1e-6 && units < free) {
      this.progress = Math.max(0, this.progress - batch);
      units += Math.min(batch, free - units); // Si no cabe el lote entero, se llena hasta 100 exactos
    }
    if (units >= free) this.progress = Math.min(this.progress, batch * 0.999);
    return units;
  }

  /** Progreso hacia el siguiente lote (0..1). */
  get fraction() {
    return Math.min(1, this.progress / this.batch);
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

  /**
   * Anima a los trabajadores visibles y avisa de cada hachazo (instante del golpe).
   * silent: en el menú se animan como decoración, sin sonido.
   */
  update(dt, { silent = false } = {}) {
    for (let i = 0; i < this.count; i++) {
      const w = this.workers[i];
      w.mixer.update(dt);
      const t = w.chop.time;
      const hit = ATTACK.impactTime;
      const crossed = w.prev <= t ? w.prev < hit && t >= hit : w.prev < hit || t >= hit;
      w.prev = t;
      if (crossed && !silent) this.onChop(w.position);
    }
  }
}
