// dayNight.js — Iluminación y ambiente según la hora (Fase 11B).
//
// Cada bosque tiene su luz de día (config.light, colors.sky, fog) y su noche (config.night).
// Aquí se mezclan según la hora con los tonos del amanecer y del atardecer: cielo, niebla, luz
// ambiental y sol/luna. Todo cambia de forma continua (sin saltos).
//
// RENDIMIENTO:
// - El sol y la luna son LA MISMA DirectionalLight (una sola sombra). A las 20:00 y a las 06:00
//   su intensidad es casi 0, así que el cambio de dirección no se nota.
// - Las luces nunca se añaden ni se quitan (eso recompila los materiales y da tirones): solo
//   cambia su intensidad.
// - Estrellas: un THREE.Points (1 llamada de dibujo). Luna: un disco (1 llamada). Visibles solo
//   de noche; siguen a la cámara.
// La noche nunca es negra: la luz ambiental nocturna de cada bosque es suficiente para jugar.
import * as THREE from 'three';
import { DAY_NIGHT, FORESTS } from '../config.js';

const { dawn: DAWN, duskStart: DUSK, nightStart: NIGHT, cycle: CYCLE } = DAY_NIGHT;
const smooth = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const MIN_ELEVATION = 0.22; // Altura mínima de la luz para las sombras (sin sombras eternas)

/** Cuánto es de noche (0 = día pleno, 1 = noche) para t segundos desde las 06:00. */
export function nightFactor(t) {
  if (t < DAWN) return 1 - smooth(t / DAWN);
  if (t < DUSK) return 0;
  if (t < NIGHT) return smooth((t - DUSK) / (NIGHT - DUSK));
  return 1;
}

/** Tono cálido del amanecer (dawn) o del atardecer (dusk): 0..1 en mitad de cada uno. */
export function warmFactor(t) {
  if (t < DAWN) return { k: Math.sin((Math.PI * t) / DAWN), tint: DAY_NIGHT.dawnTint };
  if (t >= DUSK && t < NIGHT) return { k: Math.sin((Math.PI * (t - DUSK)) / (NIGHT - DUSK)), tint: DAY_NIGHT.duskTint };
  return { k: 0, tint: DAY_NIGHT.duskTint };
}

const _a = new THREE.Color();
const _b = new THREE.Color();

/**
 * Valores de luz de un bosque a una hora (sin tocar la escena).
 * @returns { sky, sunColor, sunIntensity, ambientColor, ambientIntensity, fogNear, fogFar, direction, night, moon }
 */
export function lightingAt(config, t, out = null) {
  const o = out ?? { sky: new THREE.Color(), sunColor: new THREE.Color(), ambientColor: new THREE.Color(), direction: new THREE.Vector3() };
  const day = config.light ?? FORESTS[0].light;
  const night = config.night ?? FORESTS[0].night;
  const n = nightFactor(t);
  const { k: w, tint } = warmFactor(((t % CYCLE) + CYCLE) % CYCLE);
  o.night = n;
  o.warm = w;

  o.sky.set(config.colors.sky).lerp(_a.set(night.sky), n).lerp(_b.set(tint.sky), w * 0.55);
  o.ambientColor.set(day.ambient).lerp(_a.set(night.ambient), n).lerp(_b.set(tint.sun), w * 0.25);
  o.ambientIntensity = day.ambientIntensity + (night.ambientIntensity - day.ambientIntensity) * n;
  const fogK = 1 + (DAY_NIGHT.fogNight - 1) * n;
  o.fogNear = config.fog.near * fogK;
  o.fogFar = config.fog.far * fogK;

  if (t < NIGHT) {
    // Sol: sale por el este a las 06:00, mediodía a las 13:00, se pone a las 20:00
    const a = (t / NIGHT) * Math.PI;
    const elevation = Math.sin(a);
    o.direction.set(Math.cos(a) * 0.85, Math.max(elevation, MIN_ELEVATION), 0.42).normalize();
    o.sunColor.set(day.sun).lerp(_a.set(tint.sun), w * 0.75);
    o.sunIntensity = day.sunIntensity * smooth(elevation / 0.3);
    o.moon = false;
  } else {
    // Luna: cruza el cielo durante la noche (luz fría y suave)
    const b = ((t - NIGHT) / (CYCLE - NIGHT)) * Math.PI;
    const elevation = Math.sin(b);
    o.direction.set(-Math.cos(b) * 0.7, Math.max(elevation, MIN_ELEVATION), -0.4).normalize();
    o.sunColor.set(night.moon);
    o.sunIntensity = night.moonIntensity * smooth(elevation / 0.3);
    o.moon = true;
  }
  return o;
}

/** Estrellas y luna (solo se ven de noche y siguen a la cámara). */
export class NightSky {
  constructor(scene, count = 900) {
    const positions = new Float32Array(count * 3);
    let s = 7;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      // Hemisferio superior (más estrellas cerca del cenit)
      const u = rand() * Math.PI * 2, v = 0.08 + rand() * 0.92;
      const y = Math.sqrt(v), r = Math.sqrt(1 - y * y);
      positions.set([Math.cos(u) * r, y, Math.sin(u) * r], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.name = 'estrellas';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -2;
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: 0xf6f1d8, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.moon.name = 'luna';
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -1;
    this.stars.visible = this.moon.visible = false;
    scene.add(this.stars, this.moon);
  }

  /** Coloca el cielo nocturno alrededor de la cámara (radio dentro del alcance de la cámara). */
  update(camera, light) {
    const n = light.night;
    const visible = n > 0.01;
    this.stars.visible = this.moon.visible = visible;
    if (!visible) return;
    const radius = Math.min(170, camera.far * 0.72);
    this.stars.position.copy(camera.position);
    this.stars.scale.setScalar(radius);
    this.stars.material.opacity = 0.9 * n;
    // La luna sigue la luz nocturna: al anochecer aparece donde sale y al amanecer se queda
    // donde se pone (el sol, por la mañana, apunta hacia +x)
    const dir = light.moon ? light.direction : light.direction.x > 0 ? _moonSet : _moonRise;
    this.moon.position.copy(camera.position).addScaledVector(dir, radius * 0.95);
    this.moon.scale.setScalar(radius * 0.032);
    this.moon.lookAt(camera.position);
    const k = Math.max(0, (n - 0.35) / 0.65); // Solo cuando ya oscurece de verdad
    this.moon.material.opacity = k * k * (3 - 2 * k);
    this.moon.visible = this.moon.material.opacity > 0.01;
  }

  dispose() {
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    this.stars.removeFromParent();
    this.moon.removeFromParent();
  }
}
const _moonRise = new THREE.Vector3(-0.7, MIN_ELEVATION, -0.4).normalize(); // Donde empieza la luna a las 20:00
const _moonSet = new THREE.Vector3(0.7, MIN_ELEVATION, -0.4).normalize(); // Donde termina a las 06:00
