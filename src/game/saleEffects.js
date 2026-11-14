// saleEffects.js — Celebración visual de una venta confirmada (Fase 7B).
//
// Monedas Low Poly doradas que saltan desde la plataforma de venta, suben girando y se encogen
// hasta desaparecer. Ligero a propósito:
// - Una sola geometría, un solo material y un solo InstancedMesh (1 llamada de dibujo).
// - Partículas preasignadas y reutilizadas: no se crean objetos al celebrar ni en cada fotograma.
// - Sin partículas activas, update() no hace nada.
// Este archivo solo dibuja: no sabe nada de monedas reales ni de Appwrite. Game.js lo llama
// únicamente cuando la venta ya está confirmada.
import * as THREE from 'three';
import { SALE } from '../config.js';

const GRAVITY = -4.2; // m/s²: suben rápido y se frenan con suavidad
const POP_IN = 0.08; // s que tarda cada moneda en aparecer
const FADE_FROM = 0.55; // Fracción de su vida a partir de la cual empieza a encogerse

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class SaleCelebration {
  constructor(scene, { count = SALE.particleCount, life = SALE.particleLife } = {}) {
    this.count = count;
    this.life = life;
    this.capacity = count * 2; // Dos ventas seguidas pueden solaparse
    // Moneda Low Poly: cilindro de 8 lados, sombreado plano
    this.geometry = new THREE.CylinderGeometry(0.11, 0.11, 0.03, 8);
    this.geometry.rotateX(Math.PI / 2); // De canto, como una moneda que salta
    this.material = new THREE.MeshStandardMaterial({ color: 0xf2c440, emissive: 0x6b4a00, emissiveIntensity: 0.45, metalness: 0.55, roughness: 0.35, flatShading: true });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.name = 'celebracion-venta';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.particles = Array.from({ length: this.capacity }, () => ({
      active: false, t: 0, life: 1,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), spin: 0, angle: 0, size: 1,
    }));
    this.activeCount = 0;
  }

  /** Lanza una ráfaga de monedas desde "origin" (centro de la plataforma). */
  burst(origin, random = Math.random) {
    let spawned = 0;
    for (const p of this.particles) {
      if (spawned >= this.count) break;
      if (p.active) continue;
      const ang = random() * Math.PI * 2;
      const r = random() * 0.9;
      p.pos.set(origin.x + Math.cos(ang) * r, origin.y + random() * 0.2, origin.z + Math.sin(ang) * r);
      const out = 0.3 + random() * 0.5;
      p.vel.set(Math.cos(ang) * out, 2.4 + random() * 1.4, Math.sin(ang) * out);
      p.axis.set(random() - 0.5, 1, random() - 0.5).normalize();
      p.spin = 6 + random() * 8;
      p.angle = random() * Math.PI * 2;
      p.size = 0.8 + random() * 0.5;
      p.life = this.life[0] + random() * (this.life[1] - this.life[0]);
      p.t = 0;
      p.active = true;
      spawned++;
    }
    this.activeCount += spawned;
    this.mesh.visible = this.activeCount > 0;
    return spawned;
  }

  get active() {
    return this.activeCount > 0;
  }

  update(dt) {
    if (this.activeCount === 0) return; // Sin celebración: coste nulo
    let n = 0;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.active = false;
        this.activeCount--;
        continue;
      }
      p.vel.y += GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.angle += p.spin * dt;
      // Aparece rápido y, en la última parte de su vida, se encoge hasta desaparecer
      const k = p.t / p.life;
      const appear = Math.min(1, p.t / POP_IN);
      const fade = k < FADE_FROM ? 1 : 1 - (k - FADE_FROM) / (1 - FADE_FROM);
      const scale = p.size * appear * fade * fade;
      _m.compose(p.pos, _q.setFromAxisAngle(p.axis, p.angle), _s.setScalar(scale));
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}
