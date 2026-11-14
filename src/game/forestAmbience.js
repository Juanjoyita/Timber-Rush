// forestAmbience.js — Partículas de ambiente de cada bosque (Fase 11A).
//
// Nieve que cae (Nevado), hojas que caen (Otoñal), luciérnagas (Místico) y polen (Ancestral).
// Un único THREE.Points por bosque (1 llamada de dibujo), sin texturas. Las partículas viven en
// una caja alrededor de la cámara y "dan la vuelta" al salir de ella: siempre hay ambiente cerca
// del jugador sin simular el bosque entero. Solo visual: no afecta a nada del juego.
import * as THREE from 'three';

const KINDS = {
  snow: { color: 0xffffff, size: 0.13, half: 30, minY: 0, maxY: 20, fall: 1.3, sway: 0.5, opacity: 0.9 },
  leaves: { color: 0xe07a26, size: 0.2, half: 28, minY: 0, maxY: 14, fall: 0.55, sway: 1.2, opacity: 0.95 },
  fireflies: { color: 0xd8ff7a, size: 0.2, half: 24, minY: 0.4, maxY: 3.5, fall: 0, sway: 0.6, opacity: 0.95, additive: true, pulse: true },
  pollen: { color: 0xffe9a8, size: 0.09, half: 26, minY: 0.5, maxY: 9, fall: -0.05, sway: 0.35, opacity: 0.8 },
};

/** Generador determinista simple (el ambiente no necesita Math.random). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class ForestAmbience {
  /** @param spec { kind, count } de config.theme.particles (o null: sin partículas) */
  constructor(spec, seed = 1) {
    this.spec = spec ? KINDS[spec.kind] : null;
    this.points = null;
    this.time = 0;
    if (!this.spec) return;
    const k = this.spec, n = spec.count, rand = seeded(seed);
    this.count = n;
    this.positions = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    this.center = new THREE.Vector3(Infinity, 0, Infinity);
    for (let i = 0; i < n; i++) {
      this.positions[i * 3] = (rand() * 2 - 1) * k.half;
      this.positions[i * 3 + 1] = k.minY + rand() * (k.maxY - k.minY);
      this.positions[i * 3 + 2] = (rand() * 2 - 1) * k.half;
      this.phase[i] = rand() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: k.color, size: k.size, sizeAttenuation: true, transparent: true, opacity: k.opacity, depthWrite: false,
      blending: k.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.name = `ambiente-${spec.kind}`;
    this.points.frustumCulled = false; // Siempre alrededor de la cámara
  }

  /** Avanza el ambiente y lo mantiene alrededor de center (normalmente la cámara). */
  update(dt, center) {
    if (!this.points) return;
    this.time += dt;
    const k = this.spec, p = this.positions, half = k.half, span = half * 2, t = this.time;
    // Al moverse la cámara, las partículas que quedan fuera aparecen por el lado contrario
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, ph = this.phase[i];
      p[j] += Math.sin(t * 0.7 + ph) * k.sway * dt;
      p[j + 2] += Math.cos(t * 0.5 + ph * 1.3) * k.sway * dt;
      p[j + 1] -= k.fall * dt * (0.7 + 0.6 * ((ph * 7) % 1));
      if (k.fall === 0) p[j + 1] += Math.sin(t * 1.3 + ph) * 0.25 * dt; // Luciérnagas: flotan
      if (p[j + 1] < k.minY) p[j + 1] = k.maxY;
      if (p[j + 1] > k.maxY) p[j + 1] = k.minY;
      p[j] = center.x + ((((p[j] - center.x + half) % span) + span) % span) - half;
      p[j + 2] = center.z + ((((p[j + 2] - center.z + half) % span) + span) % span) - half;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    if (k.pulse) this.material.opacity = k.opacity * (0.55 + 0.45 * Math.sin(t * 2.1) ** 2); // Parpadeo suave
  }

  dispose() {
    if (!this.points) return;
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
