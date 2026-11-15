// chests.js — Cofres y tesoros (Fase 11C).
//
// - chestsForDay: qué 4 cofres hay hoy en un bosque (determinista: mismo bosque y día = mismos
//   cofres; al recargar no cambian; al día siguiente cambian de sitio).
// - ChestField: los cofres visibles del bosque actual. Modelos Low Poly propios (geometría de
//   Three.js), tapa articulada que se abre, destellos al acercarse.
//
// RENDIMIENTO: una InstancedMesh por tipo de cofre para el cuerpo y otra para la tapa (más una
// para las gemas y runas que brillan, si el tipo las tiene) y un THREE.Points para los destellos.
// Solo se dibujan los tipos que hay hoy (≤ 3). Nada se crea por fotograma.
import * as THREE from 'three';
import { CHESTS } from '../config.js';
import { chestKind, chestReward, hash01 } from './economy.js';
import { coloredParts } from './forestThemes.js';

export const CHEST_KINDS = ['comun', 'raro', 'legendario'];
const W = 0.92, D = 0.62, H = 0.5, R = 0.31; // Anchura, fondo, altura del cuerpo y radio de la tapa
export const CHEST_SIZE = { hx: W / 2 + 0.04, hy: (H + R) / 2, hz: D / 2 + 0.04 };

/**
 * Cofres de un día en un bosque.
 * @param spots puntos posibles del bosque (forest.chestSpots)
 * @returns [{ slot, spot, kind, coins }] (hueco 0-1 comunes, 2 raro, 3 especial)
 */
export function chestsForDay(spots, forestId, day) {
  if (!spots?.length) return [];
  const order = spots.map((s, i) => ({ s, k: hash01(forestId, day, i, 23) })).sort((a, b) => a.k - b.k).map((o) => o.s);
  const chosen = [];
  const far = (s) => chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) >= CHESTS.daySpacing);
  // El especial (hueco 3) prefiere los alrededores del elemento emblemático
  const special = order.find((s) => s.nearLandmark) ?? order[0];
  for (const s of order) {
    if (chosen.length >= CHESTS.perDay - 1) break;
    if (s !== special && far(s) && Math.hypot(s.x - special.x, s.z - special.z) >= CHESTS.daySpacing) chosen.push(s);
  }
  chosen.push(special);
  return chosen.map((spot, slot) => ({ slot, spot, ...chestReward(forestId, day, slot), kind: chestKind(forestId, day, slot) }));
}

// ---------- Modelos ----------

const PALETTES = {
  comun: { wood: 0x9a6a3a, plank: 0x7a4f2a, band: 0x4a4d55, lock: 0x6b6e75, gem: null },
  raro: { wood: 0x5a3a26, plank: 0x47301f, band: 0xc9ced6, lock: 0xdfe3ea, gem: 0x5fb6ff },
  legendario: { wood: 0x6e2a1f, plank: 0x5a2118, band: 0xe0b43a, lock: 0xf2cf5b, gem: 0xffe27a },
};

/** Detalle propio del bosque sobre la tapa (nieve, hojas, musgo) o runas que brillan. */
function forestDetail(theme) {
  if (theme === 'snow') return { lid: [[new THREE.BoxGeometry(W * 0.96, 0.07, D * 0.7).translate(0, R + 0.02, D / 2), 0xf3f7fb]] };
  if (theme === 'leaves') return { lid: [[new THREE.CircleGeometry(0.12, 5).rotateX(-Math.PI / 2).translate(-0.22, R + 0.012, D / 2 - 0.05), 0xd9661f], [new THREE.CircleGeometry(0.1, 5).rotateX(-Math.PI / 2).translate(0.18, R + 0.012, D / 2 + 0.08), 0xc23b22], [new THREE.CircleGeometry(0.09, 5).rotateX(-Math.PI / 2).translate(0.02, R + 0.012, D / 2 - 0.12), 0xf0c13c]] };
  if (theme === 'moss') return { lid: [[new THREE.BoxGeometry(W * 0.6, 0.05, D * 0.45).translate(-0.12, R + 0.01, D / 2 + 0.05), 0x4f7d34]], body: [[new THREE.BoxGeometry(0.3, 0.12, D + 0.02).translate(0.32, 0.06, 0), 0x3f6b2c]] };
  if (theme === 'runes') return { glow: [[new THREE.BoxGeometry(0.04, 0.22, 0.14).translate(-W / 2 - 0.02, H * 0.55, 0), 0x7af7ff], [new THREE.BoxGeometry(0.04, 0.22, 0.14).translate(W / 2 + 0.02, H * 0.55, 0), 0x7af7ff]] };
  return {};
}

/** Geometrías de un tipo de cofre: cuerpo, tapa (con el eje de la bisagra en el origen) y brillo. */
export function chestGeometries(kind, theme = null) {
  const p = PALETTES[kind];
  const detail = forestDetail(theme);
  const body = [
    [new THREE.BoxGeometry(W, H, D).translate(0, H / 2, 0), p.wood],
    [new THREE.BoxGeometry(W + 0.01, 0.03, D + 0.01).translate(0, H * 0.33, 0), p.plank], // Juntas de tablones
    [new THREE.BoxGeometry(W + 0.01, 0.03, D + 0.01).translate(0, H * 0.66, 0), p.plank],
    [new THREE.BoxGeometry(0.07, H + 0.02, D + 0.03).translate(-W * 0.32, H / 2, 0), p.band], // Bandas
    [new THREE.BoxGeometry(0.07, H + 0.02, D + 0.03).translate(W * 0.32, H / 2, 0), p.band],
    [new THREE.BoxGeometry(0.16, 0.18, 0.04).translate(0, H * 0.72, D / 2 + 0.02), p.lock], // Cerradura
    [new THREE.BoxGeometry(W - 0.1, 0.012, D - 0.1).translate(0, H + 0.004, 0), 0x24160c], // Interior oscuro (vacío al abrirlo)
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => [new THREE.BoxGeometry(0.1, 0.05, 0.1).translate(sx * (W / 2 - 0.06), 0.02, sz * (D / 2 - 0.06)), p.band])),
    ...(detail.body ?? []),
  ];
  // Tapa semicilíndrica: la bisagra (eje X) en el origen, el resto hacia +z
  const half = (r, len) => new THREE.CylinderGeometry(r, r, len, 7, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, D / 2);
  const lid = [
    [half(R, W), p.wood],
    [new THREE.BoxGeometry(W * 0.98, 0.03, D * 0.98).translate(0, 0.016, D / 2), p.plank], // Cara interior de la tapa (se ve al abrirla)
    [half(R + 0.015, 0.07).translate(-W * 0.32, 0, 0), p.band],
    [half(R + 0.015, 0.07).translate(W * 0.32, 0, 0), p.band],
    [new THREE.BoxGeometry(0.14, 0.12, 0.04).translate(0, 0.02, D + 0.01), p.lock],
    ...(detail.lid ?? []),
  ];
  const glow = [...(p.gem ? [[new THREE.OctahedronGeometry(0.07, 0).scale(1, 1.3, 0.6).translate(0, H * 0.4, D / 2 + 0.04), p.gem]] : []), ...(detail.glow ?? [])];
  const out = { body: coloredParts(body), lid: coloredParts(lid), glow: glow.length ? coloredParts(glow) : null };
  for (const [g] of [...body, ...lid, ...glow]) g.dispose();
  return out;
}

const THEME_OF_FOREST = { 2: 'leaves', 3: 'snow', 4: 'runes', 5: 'moss' };
const OPEN_ANGLE = 1.95; // rad: la tapa abierta queda echada hacia atrás
const OPEN_TIME = 0.7; // s
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);

export class ChestField {
  /**
   * @param forestId  bosque (detalle visual y recompensas)
   * @param spots     forest.chestSpots
   * @param material  material con colores de vértice (el de la naturaleza)
   * @param physics   { createStaticGroup() } (colisiones de los cofres de hoy)
   */
  constructor({ forestId, spots, material, physics = null }) {
    this.forestId = forestId;
    this.spots = spots;
    this.group = new THREE.Group();
    this.group.name = 'cofres';
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    this.meshes = {};
    this.geometries = [];
    const theme = THEME_OF_FOREST[forestId] ?? null;
    for (const kind of CHEST_KINDS) {
      const g = chestGeometries(kind, theme);
      const make = (geometry, mat, name) => {
        if (!geometry) return null;
        const im = new THREE.InstancedMesh(geometry, mat, CHESTS.perDay);
        im.count = 0;
        im.name = name;
        im.castShadow = mat === material;
        im.receiveShadow = true;
        im.frustumCulled = false; // Pocas instancias repartidas: más barato no calcular su esfera
        this.group.add(im);
        this.geometries.push(geometry);
        return im;
      };
      this.meshes[kind] = { body: make(g.body, material, `cofre-${kind}`), lid: make(g.lid, material, `tapa-${kind}`), glow: make(g.glow, this.glowMaterial, `brillo-${kind}`) };
    }
    // Destellos: 10 por cofre, solo cerca (se ocultan a más de sparkleDistance)
    this.sparkleCount = 10;
    const positions = new Float32Array(CHESTS.perDay * this.sparkleCount * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.sparkles = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffe9a0, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparkles.name = 'destellos-cofres';
    this.sparkles.frustumCulled = false;
    this.group.add(this.sparkles);
    this.geometries.push(sg);
    this.colliders = physics?.createStaticGroup?.() ?? null;
    this.today = []; // [{ slot, spot, kind, coins, opened, hidden, open: 0..1, shake }]
    this.day = 0;
    this.time = 0;
  }

  /**
   * Cofres del día (al construir el bosque, al cambiar de día o al dormir). opened: máscara de
   * huecos ya abiertos hoy. Un cofre que aparecería encima del Worker espera a que se aleje.
   */
  setDay(day, openedMask = 0, player = null) {
    const changed = day !== this.day;
    this.day = day;
    const previous = new Map(this.today.map((c) => [c.slot, c]));
    this.today = chestsForDay(this.spots, this.forestId, day).map((c) => {
      const opened = Boolean(openedMask & (1 << c.slot));
      const before = !changed ? previous.get(c.slot) : null;
      const near = player && Math.hypot(player.x - c.spot.x, player.z - c.spot.z) < CHESTS.spawnGuard;
      return { ...c, opened, open: opened ? 1 : 0, hidden: changed && Boolean(near) && !opened ? true : before?.hidden ?? false, pending: false };
    });
    this.colliders?.set(this.today.filter((c) => !c.hidden).map((c) => this.colliderOf(c)));
    this.refresh();
  }

  /** Máscara de huecos abiertos confirmada (tras abrir un cofre): la tapa se anima. */
  setOpened(mask) {
    for (const c of this.today) {
      const opened = Boolean(mask & (1 << c.slot));
      if (opened && !c.opened) c.opened = true;
    }
  }

  colliderOf(c) {
    return { x: c.spot.x, y: c.spot.y + CHEST_SIZE.hy, z: c.spot.z, hx: CHEST_SIZE.hx, hy: CHEST_SIZE.hy, hz: CHEST_SIZE.hz, rotY: c.spot.yaw };
  }

  /** Cofre de hoy más cercano al Worker (visible), con su distancia. */
  nearest(player) {
    let best = null;
    for (const c of this.today) {
      if (c.hidden) continue;
      const d = Math.hypot(player.x - c.spot.x, player.z - c.spot.z) - 0.5;
      if (!best || d < best.distance) best = { chest: c, distance: d };
    }
    return best;
  }

  /**
   * Al pulsar E la tapa se abre YA (respuesta inmediata), mientras Appwrite confirma. Las monedas
   * y el anuncio solo llegan con la confirmación. Si no se confirma (revert), la tapa se cierra
   * y el cofre sigue disponible.
   */
  setPending(slot, pending) {
    const c = this.today.find((x) => x.slot === slot);
    if (c) c.pending = pending;
  }

  /** El guardado falló: la tapa vuelve a cerrarse (el cofre no se ha reclamado). */
  revert(slot) {
    const c = this.today.find((x) => x.slot === slot);
    if (c && !c.opened) c.pending = false;
  }

  /** ¿La tapa debe estar abierta? (confirmado o esperando la confirmación) */
  isOpenVisual(c) {
    return c.opened || c.pending;
  }

  refresh() {
    const counts = { comun: 0, raro: 0, legendario: 0 };
    for (const c of this.today) {
      if (c.hidden) continue;
      const set = this.meshes[c.kind];
      const i = counts[c.kind]++;
      c.index = i;
      _q.setFromAxisAngle(_up, c.spot.yaw);
      set.body.setMatrixAt(i, _m.compose(_p.set(c.spot.x, c.spot.y, c.spot.z), _q, _one));
      set.glow?.setMatrixAt(i, _m);
      this.placeLid(c);
    }
    for (const kind of CHEST_KINDS) {
      const set = this.meshes[kind];
      for (const im of [set.body, set.lid, set.glow]) {
        if (!im) continue;
        im.count = counts[kind];
        im.visible = counts[kind] > 0; // Los tipos que no hay hoy no se dibujan
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  placeLid(c) {
    const lid = this.meshes[c.kind].lid;
    const k = Math.max(0, Math.min(1, c.open));
    const angle = OPEN_ANGLE * (this.isOpenVisual(c) ? easeOutBack(k) : k * k * (3 - 2 * k)); // Al cerrarse, sin rebote
    // Bisagra en la arista trasera superior del cuerpo
    _q.setFromAxisAngle(_up, c.spot.yaw);
    _p.set(0, H, -D / 2).applyQuaternion(_q).add(_v.set(c.spot.x, c.spot.y, c.spot.z));
    _qx.setFromAxisAngle(_x, -angle);
    lid.setMatrixAt(c.index, _m.compose(_p, _q.multiply(_qx), _one));
    lid.instanceMatrix.needsUpdate = true;
  }

  /** Animaciones (tapa, temblor, destellos) y cofres que esperaban a que el Worker se alejara. */
  update(dt, player, night = 0) {
    this.time += dt;
    let reveal = false;
    for (const c of this.today) {
      if (c.hidden && player && Math.hypot(player.x - c.spot.x, player.z - c.spot.z) > CHESTS.revealDistance) {
        c.hidden = false;
        reveal = true;
      }
      if (c.hidden || c.index === undefined) continue;
      const target = this.isOpenVisual(c) ? 1 : 0;
      if (c.open !== target) {
        c.open = target ? Math.min(1, c.open + dt / OPEN_TIME) : Math.max(0, c.open - dt / (OPEN_TIME * 0.6));
        this.placeLid(c);
      }
    }
    if (reveal) {
      this.colliders?.set(this.today.filter((c) => !c.hidden).map((c) => this.colliderOf(c)));
      this.refresh();
    }
    // Destellos alrededor de los cofres cerrados y cercanos (más visibles de noche)
    const pos = this.sparkles.geometry.attributes.position;
    let n = 0;
    for (const c of this.today) {
      const show = !c.hidden && !this.isOpenVisual(c) && player && Math.hypot(player.x - c.spot.x, player.z - c.spot.z) < CHESTS.sparkleDistance;
      for (let k = 0; k < this.sparkleCount; k++, n++) {
        if (!show) {
          pos.setXYZ(n, 0, -1000, 0);
          continue;
        }
        const ph = k * 1.7 + c.slot;
        const t = (this.time * 0.35 + k / this.sparkleCount) % 1;
        pos.setXYZ(n, c.spot.x + Math.cos(ph + this.time * 0.6) * (0.45 + 0.15 * Math.sin(ph)), c.spot.y + 0.2 + t * 1.1, c.spot.z + Math.sin(ph + this.time * 0.6) * (0.45 + 0.15 * Math.cos(ph)));
      }
    }
    pos.needsUpdate = true;
    this.sparkles.material.opacity = 0.55 + 0.4 * night;
  }

  dispose() {
    for (const set of Object.values(this.meshes)) for (const im of Object.values(set)) im?.dispose();
    for (const g of this.geometries) g.dispose();
    this.glowMaterial.dispose();
    this.sparkles.material.dispose();
    this.colliders?.set([]);
    this.group.removeFromParent();
  }
}
const _v = new THREE.Vector3();
