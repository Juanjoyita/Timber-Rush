// village.js — Vivienda y aldea forestal (Fase 11D). 100 % COSMÉTICA.
//
// Siete estados (nivel 0..6) que se compran en la tienda. NINGÚN nivel cambia nada del juego:
// producción, ventas, hacha, mochila, almacén, velocidad, descanso, día/noche, cofres ni
// desbloqueos. Dormir funciona igual en todos (la E está en la puerta de la vivienda).
//
// Ubicación: al este del punto de inicio, a lo largo de una calle de piedra (la zona libre de
// caminos en los cinco bosques). La disposición son DATOS (VILLAGE_ITEMS): así el bosque puede
// despejar su sitio y las pruebas comprobarla sin construir geometría.
//
// RENDIMIENTO: las piezas estáticas del nivel se fusionan en UNA malla (colores de vértice, el
// material de la naturaleza) + una malla para lo que brilla de noche (ventanas y farolas; su
// color se aviva de noche, sin luces nuevas) + las aspas del molino (giran) + el humo de la
// chimenea. Las geometrías de cada pieza se crean una vez y se reutilizan en los cinco bosques.
import * as THREE from 'three';
import { coloredParts } from './forestThemes.js';
import { UPGRADES } from '../config.js';

export const MAX_HOME_LEVEL = 6;
export const HOME_STAGES = UPGRADES.home.stages; // Nombre de cada nivel (0..6)
export const VILLAGE_HOME = { x: 15, z: 2.6 }; // Centro de la vivienda del jugador (todos los niveles)
export const clampHome = (n) => Math.max(0, Math.min(MAX_HOME_LEVEL, Math.floor(Number(n)) || 0));

// Hoguera del campamento (siempre) y su luz (la única luz de la aldea, como en la Fase 11B)
export const FIRE = { x: 11.4, z: 4.2 };
const STREET_Z = 6.4;

/**
 * Piezas de la aldea en coordenadas del MUNDO. from/to: niveles en los que se ve (incluidos).
 * size: [ancho x, fondo z, alto] de su huella sin girar; yaw en grados (múltiplos de 90).
 * door: la pieza es la vivienda (la E para dormir está delante de su puerta).
 */
export const VILLAGE_ITEMS = [
  // --- La vivienda (cambia de forma) ---
  { kind: 'tent', from: 0, to: 1, x: 15, z: 2.6, yaw: 0, size: [2.9, 2.6, 1.6], door: true },
  { kind: 'cabin', from: 2, to: 2, x: 15, z: 2.6, yaw: 0, size: [4.0, 3.4, 3.6], door: true },
  { kind: 'cabinPorch', from: 3, to: 3, x: 15, z: 2.6, yaw: 0, size: [4.0, 3.4, 3.9], door: true },
  { kind: 'house', from: 4, to: 6, x: 15, z: 2.6, yaw: 0, size: [4.8, 4.0, 6.2], door: true },
  // --- Campamento (siempre) ---
  { kind: 'fireRing', from: 0, to: 6, x: FIRE.x, z: FIRE.z, yaw: 0, size: [1.3, 1.3, 0.4] },
  // --- Nivel 1: campamento acogedor ---
  { kind: 'bench', from: 1, to: 6, x: 11.4, z: 2.5, yaw: 0, size: [1.6, 0.5, 0.5] },
  { kind: 'lantern', from: 1, to: 4, x: 13.0, z: 5.0, yaw: 0, size: [0.3, 0.3, 1.4] },
  { kind: 'lantern', from: 1, to: 4, x: 17.0, z: 5.0, yaw: 0, size: [0.3, 0.3, 1.4] },
  { kind: 'woodpile', from: 1, to: 6, x: 18.5, z: 3.6, yaw: 90, size: [1.6, 0.8, 0.9] },
  { kind: 'clothesline', from: 1, to: 6, x: 16.7, z: -1.3, yaw: 0, size: [2.8, 0.3, 1.8] },
  // --- Nivel 2: cabaña, huerto y buzón ---
  { kind: 'garden', from: 2, to: 6, x: 21.2, z: 2.6, yaw: 0, size: [3.2, 3.6, 0.6] },
  { kind: 'mailbox', from: 2, to: 6, x: 17.6, z: 5.0, yaw: 0, size: [0.4, 0.4, 1.2] },
  // --- Nivel 3: calle de piedra (primer tramo) y camino a la puerta ---
  { kind: 'street', from: 3, to: 6, x: 16, z: STREET_Z, yaw: 0, size: [14, 2, 0.06], walk: true },
  { kind: 'doorPath', from: 3, to: 6, x: 15, z: 5.0, yaw: 0, size: [1.2, 1.0, 0.06], walk: true },
  // --- Nivel 4: casa de dos plantas, cobertizo, pozo y cercas ---
  { kind: 'shed', from: 4, to: 6, x: 20.6, z: -2.2, yaw: 0, size: [2.4, 2.0, 2.4] },
  { kind: 'well', from: 4, to: 6, x: 27, z: 2.0, yaw: 0, size: [1.5, 1.5, 2.4] },
  { kind: 'fenceX', from: 4, to: 6, x: 15.4, z: 0.0, yaw: 0, size: [6.2, 0.2, 0.9] },
  { kind: 'fenceZ', from: 4, to: 6, x: 12.3, z: 1.8, yaw: 0, size: [0.2, 3.4, 0.9] },
  // --- Nivel 5: pequeña aldea: calle completa, plaza, farolas, banderines y dos casas vecinas ---
  { kind: 'street', from: 5, to: 6, x: 31.5, z: STREET_Z, yaw: 0, size: [17, 2, 0.06], walk: true },
  { kind: 'plaza', from: 5, to: 6, x: 27, z: 2.0, yaw: 0, size: [6, 6, 0.05], walk: true },
  { kind: 'streetLamp', from: 5, to: 6, x: 12.4, z: 7.9, yaw: 0, size: [0.4, 0.4, 3.2] },
  { kind: 'streetLamp', from: 5, to: 6, x: 19.5, z: 7.9, yaw: 0, size: [0.4, 0.4, 3.2] },
  { kind: 'streetLamp', from: 5, to: 6, x: 23.6, z: 4.8, yaw: 0, size: [0.4, 0.4, 3.2] },
  { kind: 'streetLamp', from: 5, to: 6, x: 30.4, z: 4.8, yaw: 0, size: [0.4, 0.4, 3.2] },
  { kind: 'streetLamp', from: 5, to: 6, x: 35.5, z: 7.9, yaw: 0, size: [0.4, 0.4, 3.2] },
  { kind: 'banners', from: 5, to: 6, x: 27, z: 4.8, yaw: 0, size: [6.8, 0.1, 0.4], walk: true },
  { kind: 'cottageA', from: 5, to: 6, x: 25.0, z: -3.8, yaw: 0, size: [3.6, 3.4, 4.2] },
  { kind: 'cottageB', from: 5, to: 6, x: 33.5, z: 2.2, yaw: -90, size: [3.6, 3.4, 4.2] },
  // --- Nivel 6: aldea completa: cuarta casa, molino, puestos y camino hasta el aserradero ---
  { kind: 'cottageC', from: 6, to: 6, x: 31.0, z: -4.6, yaw: 0, size: [3.6, 3.4, 4.2] },
  { kind: 'windmill', from: 6, to: 6, x: 39.0, z: -3.0, yaw: 0, size: [3.2, 3.2, 7.6] },
  { kind: 'stall', from: 6, to: 6, x: 25.3, z: 4.1, yaw: 0, size: [1.8, 1.2, 2.2] },
  { kind: 'stall', from: 6, to: 6, x: 28.7, z: 4.1, yaw: 0, size: [1.8, 1.2, 2.2] },
  { kind: 'street', from: 6, to: 6, x: 5.6, z: 6.3, yaw: 0, size: [7.0, 1.8, 0.06], walk: true }, // Hasta el camino del aserradero
];

/** Piezas visibles en un nivel. */
export const villageItemsAt = (level) => VILLAGE_ITEMS.filter((it) => it.from <= clampHome(level) && clampHome(level) <= it.to);

/** Huella (rectángulo alineado) de una pieza en el mundo. */
export function itemFootprint(it) {
  const swap = Math.abs(Math.round(it.yaw / 90)) % 2 === 1;
  const [w, d, h] = it.size;
  const hx = (swap ? d : w) / 2, hz = (swap ? w : d) / 2;
  return { minX: it.x - hx, maxX: it.x + hx, minZ: it.z - hz, maxZ: it.z + hz, height: h, kind: it.kind };
}

/** Huellas de TODAS las piezas (todos los niveles): zona que el bosque despeja y aplana. */
export const VILLAGE_FOOTPRINTS = VILLAGE_ITEMS.map(itemFootprint);

/** Colisiones (cajas alineadas en el mundo) de un nivel. Los suelos (calle, plaza) no chocan. */
export function villageColliders(level, ground = () => 0) {
  return villageItemsAt(level).filter((it) => !it.walk).map((it) => {
    const f = itemFootprint(it);
    const hy = Math.max(f.height, 0.6) / 2;
    const x = (f.minX + f.maxX) / 2, z = (f.minZ + f.maxZ) / 2;
    return { x, y: ground(x, z) + hy, z, hx: (f.maxX - f.minX) / 2, hy, hz: (f.maxZ - f.minZ) / 2, kind: it.kind };
  });
}

/** Punto de la E para dormir: delante de la puerta de la vivienda del nivel. */
export function doorPoint(level) {
  const home = villageItemsAt(level).find((it) => it.door);
  const f = itemFootprint(home);
  return { x: home.x, z: f.maxZ + 0.9 };
}

// ---------- Modelos (geometrías propias, Low Poly) ----------

const C = {
  log: 0x8a5a33, logDark: 0x6b4423, logEnd: 0xd8b07a, plank: 0xa8743f, plankLight: 0xc49660,
  roof: 0x9c3b2a, roofDark: 0x7e2e20, roofBlue: 0x3f5f86, roofGreen: 0x4d6f3a, shingle: 0x6e3226,
  stone: 0x9a958c, stoneDark: 0x77736b, plaster: 0xeadfc8, beam: 0x5a3a22,
  door: 0x5a3a1c, frame: 0x3e2a17, metal: 0x4a4d55, soil: 0x5a3f28, leaf: 0x5c9a3f, leafDark: 0x3f7a2f,
  canvas: 0xc9a66b, canvasDark: 0xa8834f, cloth: [0xd9534f, 0x4f86d9, 0xf0c13c, 0xf4f1e8],
};
const box = (w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) => [new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z), color];
const cyl = (rt, rb, h, x, y, z, color, seg = 7) => [new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), color];
/** Cilindro tumbado: primero se gira (eje 'x' o 'z') y después se coloca. */
const log = (r, len, x, y, z, color, axis = 'x', seg = 7) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else g.rotateX(Math.PI / 2);
  return [g.translate(x, y, z), color];
};

/** Tejado a dos aguas sobre una caja w×d con la cumbrera a lo largo de x. */
function gableRoof(w, d, baseY, rise, color, colorDark, overhang = 0.35) {
  const half = d / 2 + overhang;
  const slope = Math.hypot(half, rise), angle = Math.atan2(rise, half);
  return [
    box(w + overhang * 2, 0.14, slope, 0, baseY + rise / 2 + 0.07, half / 2, color, angle),
    box(w + overhang * 2, 0.14, slope, 0, baseY + rise / 2 + 0.07, -half / 2, colorDark, -angle),
    box(w + overhang * 2 + 0.05, 0.16, 0.18, 0, baseY + rise + 0.02, 0, C.beam), // Cumbrera
  ];
}
/** Hastiales (triángulos de las fachadas laterales) para cerrar el tejado. */
function gables(w, d, baseY, rise, color) {
  const tri = (sx) => {
    const g = new THREE.BufferGeometry();
    const x = sx * w / 2;
    const pts = sx > 0 ? [x, baseY, -d / 2, x, baseY + rise, 0, x, baseY, d / 2] : [x, baseY, d / 2, x, baseY + rise, 0, x, baseY, -d / 2];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return [g, color];
  };
  return [tri(1), tri(-1)];
}
/** Puerta con marco y pomo en la fachada +z. */
const door = (x, w, h, zFace) => [box(w + 0.16, h + 0.08, 0.06, x, h / 2 + 0.04, zFace + 0.02, C.frame), box(w, h, 0.07, x, h / 2, zFace + 0.04, C.door), box(0.06, 0.06, 0.05, x + w * 0.32, h * 0.5, zFace + 0.09, 0xe0b43a)];
/** Ventana: marco + travesaños (madera) y cristal (brilla de noche) en la fachada indicada. */
function window(parts, glow, x, y, zFace, w = 0.7, h = 0.6, axis = 'z') {
  const put = (gw, gh, gd, px, py, pz, color, list) => {
    const g = axis === 'z' ? box(gw, gh, gd, px, py, pz, color) : box(gd, gh, gw, pz, py, px, color);
    list.push(g);
  };
  put(w + 0.12, h + 0.12, 0.05, x, y, zFace + 0.02, C.frame, parts);
  put(w, h, 0.03, x, y, zFace + 0.045, 0xffd27a, glow); // Cristal
  put(0.05, h, 0.04, x, y, zFace + 0.07, C.frame, parts);
  put(w, 0.05, 0.04, x, y, zFace + 0.07, C.frame, parts);
}

/** Cabaña de troncos (con porche y chimenea en la variante del nivel 3). */
function cabin(porch) {
  const W = 4.0, D = 3.4, Hw = 2.3, parts = [], glow = [];
  parts.push(box(W, 0.3, D, 0, 0.15, 0, C.stoneDark)); // Zócalo de piedra
  for (let i = 0; i < 7; i++) {
    const y = 0.42 + i * 0.3;
    parts.push(log(0.16, W + 0.25, 0, y, D / 2 - 0.08, i % 2 ? C.log : C.logDark, 'x'));
    parts.push(log(0.16, W + 0.25, 0, y, -D / 2 + 0.08, i % 2 ? C.logDark : C.log, 'x'));
    parts.push(log(0.15, D, W / 2 - 0.08, y + 0.15, 0, i % 2 ? C.logDark : C.log, 'z'));
    parts.push(log(0.15, D, -W / 2 + 0.08, y + 0.15, 0, i % 2 ? C.log : C.logDark, 'z'));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < 7; i += 2) parts.push(log(0.165, 0.04, sx * (W / 2 + 0.125), 0.42 + i * 0.3, sz * (D / 2 - 0.08), C.logEnd, 'x')); // Testas de los troncos
  parts.push(box(W - 0.1, Hw - 0.3, D - 0.1, 0, 0.3 + (Hw - 0.3) / 2, 0, C.log)); // Relleno interior
  parts.push(...gables(W - 0.05, D - 0.05, Hw, 1.25, C.log));
  parts.push(...gableRoof(W, D, Hw, 1.25, C.roof, C.roofDark));
  parts.push(...door(0, 0.85, 1.75, D / 2));
  window(parts, glow, -1.25, 1.45, D / 2);
  window(parts, glow, 1.25, 1.45, D / 2);
  window(parts, glow, 0, 1.45, W / 2, 0.6, 0.55, 'x');
  if (porch) {
    parts.push(box(2.4, 0.12, 1.0, 0, 0.32, D / 2 + 0.5, C.plank)); // Suelo del porche
    for (const sx of [-1, 1]) parts.push(cyl(0.07, 0.07, 1.9, sx * 1.1, 1.25, D / 2 + 0.92, C.beam));
    parts.push(box(2.7, 0.1, 1.25, 0, 2.25, D / 2 + 0.55, C.roofDark, -0.25)); // Tejadillo
    parts.push(box(0.55, 2.2, 0.55, W / 2 - 0.7, Hw + 0.6, -0.6, C.stone)); // Chimenea de piedra
    parts.push(box(0.65, 0.12, 0.65, W / 2 - 0.7, Hw + 1.75, -0.6, C.stoneDark));
  }
  return { parts, glow, chimney: porch ? { x: W / 2 - 0.7, y: Hw + 1.85, z: -0.6 } : null };
}

/** Casa de dos plantas: planta baja de piedra, alta con entramado de madera. */
function house() {
  const W = 4.8, D = 4.0, parts = [], glow = [];
  parts.push(box(W, 2.4, D, 0, 1.2, 0, C.stone));
  for (let i = 0; i < 5; i++) parts.push(box(W + 0.02, 0.05, D + 0.02, 0, 0.45 + i * 0.45, 0, C.stoneDark)); // Juntas
  parts.push(box(W + 0.3, 0.18, D + 0.3, 0, 2.48, 0, C.beam)); // Forjado
  parts.push(box(W, 1.9, D, 0, 3.52, 0, C.plaster));
  for (const x of [-W / 2 + 0.05, -0.8, 0.8, W / 2 - 0.05]) for (const z of [D / 2 + 0.01, -D / 2 - 0.01]) parts.push(box(0.14, 1.9, 0.04, x, 3.52, z, C.beam));
  parts.push(box(W + 0.02, 0.12, D + 0.04, 0, 4.42, 0, C.beam));
  parts.push(box(W + 0.02, 0.1, D + 0.04, 0, 3.5, 0, C.beam));
  parts.push(...gables(W - 0.02, D - 0.02, 4.47, 1.6, C.plaster));
  parts.push(...gableRoof(W, D, 4.47, 1.6, C.shingle, C.roofDark, 0.4));
  parts.push(...door(0, 0.95, 1.95, D / 2));
  parts.push(box(1.4, 0.08, 0.6, 0, 2.2, D / 2 + 0.3, C.roofDark, -0.2)); // Tejadillo de la puerta
  window(parts, glow, -1.5, 1.35, D / 2);
  window(parts, glow, 1.5, 1.35, D / 2);
  window(parts, glow, -1.5, 3.5, D / 2, 0.6, 0.6);
  window(parts, glow, 1.5, 3.5, D / 2, 0.6, 0.6);
  window(parts, glow, 0, 3.5, W / 2, 0.6, 0.6, 'x');
  for (const x of [-1.5, 1.5]) {
    parts.push(box(0.8, 0.14, 0.2, x, 3.08, D / 2 + 0.12, C.plank)); // Jardineras
    for (let k = 0; k < 3; k++) parts.push([new THREE.IcosahedronGeometry(0.09, 0).translate(x - 0.25 + k * 0.25, 3.2, D / 2 + 0.12), [0xd9534f, 0xf0c13c, 0xf4f1e8][k]]);
  }
  parts.push(box(0.6, 3.0, 0.6, -W / 2 + 0.8, 5.0, -0.7, C.stoneDark)); // Chimenea
  parts.push(box(0.72, 0.14, 0.72, -W / 2 + 0.8, 6.55, -0.7, C.stone));
  return { parts, glow, chimney: { x: -W / 2 + 0.8, y: 6.65, z: -0.7 } };
}

/** Casita vecina (tres combinaciones de colores). */
function cottage(roofColor, wallColor) {
  const W = 3.6, D = 3.4, parts = [], glow = [];
  parts.push(box(W, 0.3, D, 0, 0.15, 0, C.stoneDark));
  parts.push(box(W, 2.1, D, 0, 1.35, 0, wallColor));
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [D / 2 + 0.01, -D / 2 - 0.01]) parts.push(box(0.14, 2.1, 0.04, x, 1.35, z, C.beam));
  parts.push(...gables(W - 0.02, D - 0.02, 2.4, 1.3, wallColor));
  parts.push(...gableRoof(W, D, 2.4, 1.3, roofColor, roofColor === C.roofBlue ? 0x2f4a6a : roofColor === C.roofGreen ? 0x3a5a2c : C.roofDark));
  parts.push(...door(-0.7, 0.8, 1.7, D / 2));
  window(parts, glow, 0.8, 1.45, D / 2, 0.65, 0.55);
  window(parts, glow, 0, 1.45, W / 2, 0.6, 0.5, 'x');
  parts.push(box(0.45, 1.6, 0.45, W / 2 - 0.6, 3.2, -0.6, C.stone));
  return { parts, glow, chimney: { x: W / 2 - 0.6, y: 4.05, z: -0.6 } };
}

function tent() {
  const W = 1.25, H = 1.5, L = 2.4, parts = [];
  const tri = (a, b, c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    return g;
  };
  // Faldones: cada uno sale de su borde en el suelo y se inclina hacia la cumbrera (x = 0)
  parts.push([new THREE.BoxGeometry(0.08, Math.hypot(W, H), L).translate(0, Math.hypot(W, H) / 2, 0).rotateZ(-Math.atan2(W, H)).translate(-W, 0, 0), C.canvas]);
  parts.push([new THREE.BoxGeometry(0.08, Math.hypot(W, H), L).translate(0, Math.hypot(W, H) / 2, 0).rotateZ(Math.atan2(W, H)).translate(W, 0, 0), C.canvasDark]);
  parts.push([tri([-W, 0, -L / 2], [W, 0, -L / 2], [0, H, -L / 2]), C.canvasDark], [tri([W, 0, -L / 2], [-W, 0, -L / 2], [0, H, -L / 2]), C.canvasDark]);
  parts.push(log(0.04, L + 0.5, 0, H + 0.02, 0, C.logDark, 'z'));
  parts.push(box(2.7, 0.03, L + 0.2, 0, 0.015, 0, 0x7a6a48));
  parts.push(box(0.7, 0.18, 1.9, 0.15, 0.1, 0.35, 0x3f6d8f), box(0.55, 0.14, 0.4, 0.15, 0.22, -0.4, 0xe8e0cc));
  return { parts, glow: [] };
}

function fireRing() {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push([new THREE.IcosahedronGeometry(0.17, 0).scale(1.2, 0.8, 1).translate(Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55), i % 2 ? C.stoneDark : C.stone]);
  }
  for (let i = 0; i < 3; i++) parts.push([new THREE.CylinderGeometry(0.06, 0.07, 0.8, 5).rotateZ(Math.PI / 2 - 0.35).rotateY((i / 3) * Math.PI).translate(0, 0.18, 0), C.beam]);
  return { parts, glow: [] };
}

function lantern(tall) {
  const h = tall ? 3.0 : 1.3, parts = [], glow = [];
  parts.push(cyl(tall ? 0.08 : 0.05, tall ? 0.11 : 0.06, h, 0, h / 2, 0, tall ? C.metal : C.logDark, 6));
  if (tall) parts.push(box(0.7, 0.06, 0.06, 0.3, h - 0.05, 0, C.metal), cyl(0.18, 0.12, 0.08, 0.6, h - 0.12, 0, C.metal, 6));
  const lx = tall ? 0.6 : 0;
  parts.push(box(0.26, 0.05, 0.26, lx, h - (tall ? 0.18 : -0.06), 0, C.metal));
  glow.push(box(0.2, 0.28, 0.2, lx, h - (tall ? 0.36 : -0.22), 0, 0xffd27a));
  parts.push(box(0.26, 0.05, 0.26, lx, h - (tall ? 0.52 : -0.38), 0, C.metal));
  return { parts, glow };
}

function bench() {
  const parts = [box(1.6, 0.08, 0.42, 0, 0.45, 0, C.plank), box(1.6, 0.36, 0.06, 0, 0.72, -0.2, C.plankLight)];
  for (const x of [-0.65, 0.65]) parts.push(box(0.08, 0.45, 0.4, x, 0.22, 0, C.logDark));
  return { parts, glow: [] };
}

function woodpile() {
  const parts = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) parts.push(log(0.13, 0.8, -0.45 + i * 0.28 + row * 0.14, 0.13 + row * 0.24, 0, i % 2 ? C.log : C.logDark, 'z'));
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) parts.push(log(0.12, 0.02, -0.45 + i * 0.28 + row * 0.14, 0.13 + row * 0.24, 0.41, C.logEnd, 'z'));
  return { parts, glow: [] };
}

function clothesline() {
  const parts = [];
  for (const x of [-1.4, 1.4]) parts.push(cyl(0.05, 0.06, 1.8, x, 0.9, 0, C.logDark, 5));
  parts.push(box(2.8, 0.02, 0.02, 0, 1.7, 0, 0xe8e0cc));
  [-0.9, -0.2, 0.5, 1.0].forEach((x, i) => parts.push(box(i % 2 ? 0.45 : 0.55, i % 2 ? 0.55 : 0.7, 0.02, x, 1.7 - (i % 2 ? 0.3 : 0.38), 0, C.cloth[i % 4])));
  return { parts, glow: [] };
}

function garden() {
  const parts = [box(3.0, 0.12, 3.4, 0, 0.06, 0, C.soil)];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) parts.push([new THREE.ConeGeometry(0.12, 0.3, 5).translate(-1.15 + k * 0.55, 0.26, -1.2 + r * 0.8), r % 2 ? C.leaf : C.leafDark]);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) if ((r + k) % 3 === 0) parts.push([new THREE.IcosahedronGeometry(0.07, 0).translate(-1.15 + k * 0.55, 0.4, -1.2 + r * 0.8), 0xd9534f]);
  parts.push(...fenceLine(-1.6, -1.8, 1.6, -1.8, 0.6), ...fenceLine(-1.6, 1.8, 1.6, 1.8, 0.6), ...fenceLine(1.6, -1.8, 1.6, 1.8, 0.6));
  return { parts, glow: [] };
}

/** Valla de postes y dos travesaños entre dos puntos (locales). */
function fenceLine(ax, az, bx, bz, h = 0.9) {
  const parts = [], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.1));
  const ang = Math.atan2(bz - az, bx - ax);
  for (let i = 0; i <= n; i++) parts.push(box(0.1, h, 0.1, ax + (bx - ax) * (i / n), h / 2, az + (bz - az) * (i / n), C.logDark));
  for (const y of [h * 0.45, h * 0.85]) parts.push(box(len, 0.07, 0.05, (ax + bx) / 2, y, (az + bz) / 2, C.plank, 0, -ang));
  return parts;
}

function mailbox() {
  return { parts: [box(0.08, 1.0, 0.08, 0, 0.5, 0, C.logDark), box(0.34, 0.24, 0.4, 0, 1.12, 0, C.roofBlue), box(0.04, 0.18, 0.1, 0.19, 1.2, 0.05, 0xd9534f)], glow: [] };
}

/** Losas de piedra irregulares en un rectángulo (calle, plaza, caminos). */
function slabs(w, d, seed) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const parts = [], step = 0.62;
  for (let x = -w / 2 + step / 2; x < w / 2; x += step) for (let z = -d / 2 + step / 2; z < d / 2; z += step) {
    const r = 0.26 + rand() * 0.06;
    parts.push([new THREE.CylinderGeometry(r, r, 0.05, 6).rotateY(rand()).translate(x + (rand() - 0.5) * 0.08, 0.03, z + (rand() - 0.5) * 0.08), rand() < 0.5 ? C.stone : C.stoneDark]);
  }
  return { parts, glow: [] };
}

function plaza() {
  const parts = [];
  for (let ring = 0; ring < 4; ring++) {
    const n = 6 + ring * 7, r = 0.4 + ring * 0.72;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.3;
      parts.push([new THREE.CylinderGeometry(0.3, 0.3, 0.05, 6).translate(Math.cos(a) * r, 0.03, Math.sin(a) * r), (i + ring) % 2 ? C.stone : C.stoneDark]);
    }
  }
  return { parts, glow: [] };
}

function shed() {
  const parts = [box(2.4, 1.9, 2.0, 0, 0.95, 0, C.plank)];
  for (let i = 0; i < 6; i++) parts.push(box(0.04, 1.9, 2.02, -1.0 + i * 0.4, 0.95, 0, C.plankLight));
  parts.push(box(2.8, 0.12, 2.5, 0, 2.15, 0, C.roofDark, 0.2), ...door(0, 0.9, 1.6, 1.0));
  return { parts, glow: [] };
}

function well() {
  const parts = [cyl(0.72, 0.78, 0.8, 0, 0.4, 0, C.stone, 8), cyl(0.56, 0.56, 0.82, 0, 0.42, 0, 0x2a3a4a, 8)];
  for (const x of [-0.62, 0.62]) parts.push(box(0.12, 1.7, 0.12, x, 1.25, 0, C.logDark));
  parts.push(box(0.12, 0.12, 0.12, 0, 1.75, 0, C.logDark), box(1.5, 0.08, 0.04, 0, 1.75, 0, C.logDark));
  parts.push(box(1.7, 0.08, 1.0, 0, 2.2, 0.32, C.roof, 0.6), box(1.7, 0.08, 1.0, 0, 2.2, -0.32, C.roofDark, -0.6));
  parts.push(cyl(0.12, 0.1, 0.2, 0.25, 1.15, 0, C.plank, 6));
  return { parts, glow: [] };
}

function streetLamp() {
  return lantern(true);
}

function banners() {
  const parts = [box(6.8, 0.02, 0.02, 0, 2.9, 0, 0x3e2a17)];
  for (let i = 0; i < 12; i++) parts.push([new THREE.ConeGeometry(0.15, 0.32, 3).rotateZ(Math.PI).translate(-3.1 + i * 0.56, 2.72, 0), C.cloth[i % 4]]);
  return { parts, glow: [] };
}

function stall(i) {
  const parts = [], colors = i ? [0x4f86d9, 0xf4f1e8] : [0xd9534f, 0xf4f1e8];
  for (const x of [-0.82, 0.82]) for (const z of [-0.52, 0.52]) parts.push(box(0.08, 2.0, 0.08, x, 1.0, z, C.logDark));
  parts.push(box(1.8, 0.1, 1.1, 0, 0.9, 0, C.plank), box(1.8, 0.8, 0.06, 0, 0.5, 0.52, C.plankLight));
  for (let k = 0; k < 6; k++) parts.push(box(0.3, 0.06, 1.3, -0.75 + k * 0.3, 2.05 + (k % 2) * 0.01, 0.05, colors[k % 2], 0.25));
  for (let k = 0; k < 3; k++) parts.push(box(0.35, 0.25, 0.3, -0.5 + k * 0.5, 1.08, -0.1, [C.plank, 0xd9534f, 0xf0c13c][k]));
  return { parts, glow: [] };
}

function windmill() {
  const parts = [], glow = [];
  parts.push(cyl(1.2, 1.6, 5.6, 0, 2.8, 0, C.plaster, 8));
  for (let i = 0; i < 4; i++) parts.push(cyl(1.25 - i * 0.1, 1.27 - i * 0.1, 0.1, 0, 1.2 + i * 1.3, 0, C.beam, 8));
  parts.push([new THREE.ConeGeometry(1.5, 1.6, 8).translate(0, 6.4, 0), C.roof]);
  parts.push(...door(0, 0.8, 1.6, 1.55));
  window(parts, glow, 0, 3.6, 1.38, 0.45, 0.5);
  parts.push(log(0.18, 0.9, 0, 5.5, 1.3, C.beam, 'z', 6)); // Eje de las aspas
  return { parts, glow, hub: { x: 0, y: 5.5, z: 1.8 } };
}

/** Aspas del molino (se dibujan aparte: giran). Centro en el origen, en el plano XY. */
function windmillSails() {
  const parts = [log(0.22, 0.3, 0, 0, 0, C.beam, 'z', 6)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const blade = [box(0.12, 3.3, 0.08, 0, 1.8, 0, C.beam), box(0.62, 2.8, 0.03, 0.36, 2.0, 0.03, 0xf4f1e8)];
    for (let k = 0; k < 4; k++) blade.push(box(0.7, 0.04, 0.05, 0.36, 0.9 + k * 0.7, 0.05, C.beam));
    for (const [g, c] of blade) parts.push([g.rotateZ(a), c]);
  }
  return coloredParts(parts);
}

const BUILDERS = {
  tent, cabin: () => cabin(false), cabinPorch: () => cabin(true), house, fireRing,
  lantern: () => lantern(false), streetLamp, bench, woodpile, clothesline, garden, mailbox,
  street: (it) => slabs(it.size[0], it.size[1], Math.round(it.x * 13 + it.z * 7)), doorPath: (it) => slabs(it.size[0], it.size[1], 77),
  plaza, shed, well, banners, stall: (it) => stall(it.x > 27 ? 1 : 0), windmill,
  fenceX: (it) => ({ parts: fenceLine(-it.size[0] / 2, 0, it.size[0] / 2, 0), glow: [] }),
  fenceZ: (it) => ({ parts: fenceLine(0, -it.size[1] / 2, 0, it.size[1] / 2), glow: [] }),
  cottageA: () => cottage(C.roofBlue, C.plaster), cottageB: () => cottage(C.roofGreen, 0xd8c6a0), cottageC: () => cottage(C.roof, 0xe6d3b0),
};

// Geometrías de cada pieza (en su origen, sin girar): se crean una vez y se comparten
const pieceCache = new Map();
function pieceOf(it) {
  const key = `${it.kind}:${it.x}:${it.z}`;
  if (!pieceCache.has(key)) {
    const built = BUILDERS[it.kind](it);
    pieceCache.set(key, { body: built.parts.length ? coloredParts(built.parts) : null, glow: built.glow.length ? coloredParts(built.glow) : null, chimney: built.chimney ?? null, hub: built.hub ?? null });
    for (const [g] of [...built.parts, ...built.glow]) g.dispose();
  }
  return pieceCache.get(key);
}
let sailsGeometry = null;

const WINDOW_DAY = new THREE.Color(0.62, 0.48, 0.24);
const WINDOW_NIGHT = new THREE.Color(1.0, 0.86, 0.52);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

export class Village {
  /**
   * @param material material con colores de vértice (el de la naturaleza del bosque)
   * @param ground   (x, z) → altura del terreno
   * @param physics  { createStaticGroup() } (colisiones del nivel)
   * @param cameraBoxes lista de cajas de la cámara del bosque (se añaden/quitan las de la aldea)
   */
  constructor({ material, ground, physics = null, cameraBoxes = null }) {
    this.material = material;
    this.ground = ground;
    this.cameraBoxes = cameraBoxes;
    this.colliders = physics?.createStaticGroup?.() ?? null;
    this.group = new THREE.Group();
    this.group.name = 'aldea';
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: WINDOW_DAY.clone(), fog: true });
    this.level = -1;
    this.mesh = null;
    this.glowMesh = null;
    this.time = 0;
    // Aspas del molino (giran) y humo de las chimeneas
    sailsGeometry ??= windmillSails();
    this.sails = new THREE.Mesh(sailsGeometry, material);
    this.sails.name = 'aspas-molino';
    this.sails.castShadow = true;
    this.group.add(this.sails);
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 1, flatShading: true, transparent: true, opacity: 0.5, depthWrite: false }), 4 * 5);
    this.smoke.name = 'humo-chimeneas';
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
    // Hoguera: llama (no depende de la luz) y la luz cálida de la Fase 11B (siempre presente)
    const flameGeometry = coloredParts([
      [new THREE.ConeGeometry(0.28, 0.75, 6).translate(0, 0.45, 0), 0xff9a2e],
      [new THREE.ConeGeometry(0.16, 0.5, 6).translate(0.05, 0.4, 0.04), 0xffe07a],
      [new THREE.CylinderGeometry(0.3, 0.34, 0.06, 7).translate(0, 0.06, 0), 0xc2401f],
    ]);
    this.flameMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    this.flame = new THREE.Mesh(flameGeometry, this.flameMaterial);
    this.flame.name = 'hoguera';
    this.flame.position.set(FIRE.x, ground(FIRE.x, FIRE.z), FIRE.z);
    this.light = new THREE.PointLight(0xff9a4a, 0, 11, 2);
    this.light.position.set(FIRE.x, ground(FIRE.x, FIRE.z) + 1, FIRE.z);
    this.group.add(this.flame, this.light);
    this.ownGeometries = [flameGeometry, this.smoke.geometry];
    this.setLevel(0);
  }

  /** Nivel de la vivienda (confirmado en Appwrite o al cargar). Solo visual. */
  setLevel(level) {
    const L = clampHome(level);
    if (L === this.level) return false;
    this.level = L;
    const items = villageItemsAt(L);
    const body = [], glow = [];
    this.chimneys = [];
    this.windmillItem = null;
    for (const it of items) {
      const piece = pieceOf(it);
      _q.setFromAxisAngle(_up, THREE.MathUtils.degToRad(it.yaw));
      const y = it.walk ? this.ground(it.x, it.z) + 0.01 : this.ground(it.x, it.z);
      _m.compose(_v.set(it.x, y, it.z), _q, _s);
      if (piece.body) body.push(piece.body.clone().applyMatrix4(_m));
      if (piece.glow) glow.push(piece.glow.clone().applyMatrix4(_m));
      if (piece.chimney) this.chimneys.push(new THREE.Vector3(piece.chimney.x, piece.chimney.y, piece.chimney.z).applyMatrix4(_m));
      if (piece.hub) {
        this.windmillItem = it;
        this.sails.position.copy(new THREE.Vector3(piece.hub.x, piece.hub.y, piece.hub.z).applyMatrix4(_m));
        this.sails.rotation.set(0, THREE.MathUtils.degToRad(it.yaw), 0);
      }
    }
    for (const [key, list, mat] of [['mesh', body, this.material], ['glowMesh', glow, this.glowMaterial]]) {
      if (this[key]) {
        this.group.remove(this[key]);
        this[key].geometry.dispose();
        this[key] = null;
      }
      if (!list.length) continue;
      const merged = mergeParts(list);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = key === 'mesh' ? `aldea-nivel-${L}` : 'aldea-luces';
      mesh.castShadow = key === 'mesh';
      mesh.receiveShadow = key === 'mesh';
      this.group.add(mesh);
      this[key] = mesh;
    }
    this.sails.visible = Boolean(this.windmillItem);
    this.smoke.count = this.chimneys.length * 5;
    // Colisiones y obstáculos de la cámara del nivel
    const boxes = villageColliders(L, this.ground);
    this.colliders?.set(boxes);
    if (this.cameraBoxes) {
      for (let i = this.cameraBoxes.length - 1; i >= 0; i--) if (this.cameraBoxes[i].village) this.cameraBoxes.splice(i, 1);
      for (const b of boxes) if (b.hy * 2 >= 1.2) this.cameraBoxes.push({ ...b, village: true });
    }
    this.door = doorPoint(L);
    this.homeBox = boxes.find((b) => ['tent', 'cabin', 'cabinPorch', 'house'].includes(b.kind));
    return true;
  }

  /** Molino, humo, hoguera y ventanas (solo visual). night: 0 de día, 1 de noche. */
  update(dt, night = 0, fireIntensity = 14) {
    this.time += dt;
    if (this.sails.visible) this.sails.rotation.z -= dt * 0.6;
    this.glowMaterial.color.copy(WINDOW_DAY).lerp(WINDOW_NIGHT, night);
    // Hoguera
    const flicker = 0.88 + 0.12 * Math.sin(this.time * 13.1) * Math.sin(this.time * 7.3 + 1.1);
    const on = 0.35 + 0.65 * night;
    this.flame.scale.set(on, on * flicker, on);
    this.light.intensity = fireIntensity * night * flicker;
    // Humo suave de las chimeneas
    let n = 0;
    for (const c of this.chimneys) {
      for (let k = 0; k < 5; k++) {
        const age = (this.time * 0.45 + k / 5) % 1;
        _v.set(c.x + age * 0.6, c.y + age * 2.2, c.z);
        _s.setScalar(0.12 + age * 0.35);
        _m.compose(_v, _q.identity(), _s);
        this.smoke.setMatrixAt(n++, _m);
      }
    }
    _s.set(1, 1, 1);
    if (n) this.smoke.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.glowMesh?.geometry.dispose();
    for (const g of this.ownGeometries) g.dispose();
    this.glowMaterial.dispose();
    this.flameMaterial.dispose();
    this.smoke.material.dispose();
    this.smoke.dispose();
    this.colliders?.set([]);
    if (this.cameraBoxes) for (let i = this.cameraBoxes.length - 1; i >= 0; i--) if (this.cameraBoxes[i].village) this.cameraBoxes.splice(i, 1);
    this.group.removeFromParent();
  }
}

/** Fusiona geometrías ya coloreadas (posición + color + normal). */
function mergeParts(list) {
  const count = list.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o);
    col.set(g.attributes.color.array, o);
    o += g.attributes.position.array.length;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
