// landmarks.js — Elemento emblemático de cada bosque (Fase 11A, paso 2).
//
//   Otoñal    · Lago de las hojas: agua poco profunda (se puede vadear), hojas flotando, juncos
//               y un embarcadero de madera.
//   Nevado    · Lago helado: placa de hielo con grietas (se camina sobre ella), peñascos nevados
//               y cristales de hielo en la orilla.
//   Místico   · Árbol del alma: árbol gigante retorcido con orbes luminosos y un círculo de
//               piedras con runas que brillan.
//   Ancestral · Árbol milenario: un árbol colosal (más de 20 m) rodeado de ruinas de piedra.
//
// OPTIMIZACIÓN: cada elemento es UNA malla fusionada con colores de vértice (el material de la
// naturaleza) + como mucho una malla propia (agua, hielo o luz): 1-2 llamadas de dibujo. Las
// colisiones son pocas esferas (como rocas y troncos) y cajas orientadas. Se construye con el
// bosque y se libera con él. Los árboles, rocas y plantas se apartan de su zona (forest.js).
import * as THREE from 'three';
import { coloredParts } from './forestThemes.js';

/** Altura del agua del lago (respecto al suelo plano de alrededor). */
export const LAKE_WATER_LEVEL = -0.28;

/** Forma del terreno bajo cada elemento (se suma al suelo, que allí es plano). */
export function landmarkShape(landmark, d) {
  const s = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const R = landmark.radius;
  switch (landmark.kind) {
    case 'leafLake': return -1.0 * (1 - s(0.55 * R, R + 1.5, d)); // Cuenco poco profundo
    case 'spiritTree': return 0.7 * (1 - s(0, 6, d)); // Pequeña loma
    case 'elderTree': return 0.9 * (1 - s(1, 8, d)); // Loma de raíces
    default: return 0; // Lago helado: plano
  }
}

/** Generador determinista (el elemento es igual en cada partida). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Construye el elemento del bosque.
 * @param landmark config.landmark { kind, x, z, radius }
 * @param materials materiales del bosque (nature)
 * @param ground (x, z) → altura del terreno (heightAt)
 * @returns { group, colliders: { spheres, boxes }, cameraBoxes, owned: { geometries, materials } }
 */
export function createLandmark(landmark, materials, ground) {
  const { kind, x: cx, z: cz, radius: R } = landmark;
  const rand = seeded(Math.round(cx * 73 + cz * 151) + 7);
  const parts = []; // [geometría en coordenadas del mundo, color] → una malla fusionada
  const glowParts = []; // Piezas que brillan (con su color) → otra malla
  const spheres = []; // { x, z, r } colisiones verticales (como las rocas)
  const boxes = []; // { x, y, z, hx, hy, hz, rotY, walkable } cajas orientadas
  const cameraBoxes = [];
  const group = new THREE.Group();
  group.name = `emblema-${kind}`;
  const at = (geo, lx, lz, dy = 0, rotY = 0) => {
    const wx = cx + lx, wz = cz + lz;
    return geo.rotateY(rotY).translate(wx, ground(wx, wz) + dy, wz);
  };
  const add = (geo, color, lx, lz, dy = 0, rotY = 0) => parts.push([at(geo, lx, lz, dy, rotY), color]);
  const glow = (geo, color, lx, lz, dy = 0) => glowParts.push([at(geo, lx, lz, dy), color]);
  const ring = (i, n, r, jitter = 0) => {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * jitter;
    return [Math.cos(a) * r, Math.sin(a) * r, a];
  };
  const own = { geometries: [], materials: [] };
  let special = null; // Malla propia (agua o hielo)

  if (kind === 'leafLake') {
    // Agua: disco sobre el cuenco (la orilla la recorta el propio terreno)
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(R + 1.2, 24).rotateX(-Math.PI / 2).translate(cx, LAKE_WATER_LEVEL, cz),
      new THREE.MeshStandardMaterial({ color: 0x4f8f9c, roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.86, flatShading: true })
    );
    water.receiveShadow = true;
    water.name = 'agua';
    special = water;
    // Hojas flotando
    for (let i = 0; i < 46; i++) {
      const [lx, lz] = ring(i, 46, rand() * R * 0.85, 6);
      const leaf = new THREE.CircleGeometry(0.12 + rand() * 0.12, 5).rotateX(-Math.PI / 2).translate(cx + lx, LAKE_WATER_LEVEL + 0.015, cz + lz);
      parts.push([leaf, [0xd9661f, 0xc23b22, 0xf0c13c][i % 3]]);
    }
    // Juncos en la orilla
    for (let i = 0; i < 34; i++) {
      const [lx, lz] = ring(i, 34, R - 0.4 + rand() * 1.6, 0.3);
      for (let k = 0; k < 3; k++) add(new THREE.ConeGeometry(0.045, 0.9 + rand() * 0.6, 4).translate((rand() - 0.5) * 0.3, 0.55, (rand() - 0.5) * 0.3), k ? 0x8a8a3a : 0x6b6a2e, lx, lz, -0.1);
    }
    // Embarcadero: desde la orilla hacia el centro (mirando al campamento)
    const dir = Math.atan2(-6 - cz, -15 - cx); // Hacia el aserradero
    const ux = Math.cos(dir), uz = Math.sin(dir);
    const start = R + 1.4, end = R - 4.2, len = start - end, mid = (start + end) / 2;
    const rotY = -dir + Math.PI / 2; // El eje largo (z) apunta al centro del lago
    const deckY = 0.0;
    const mx = cx + ux * mid, mz = cz + uz * mid;
    parts.push([new THREE.BoxGeometry(1.5, 0.12, len).rotateY(rotY).translate(mx, deckY - 0.06, mz), 0x8a5a33]);
    for (let k = 0; k < 5; k++) parts.push([new THREE.BoxGeometry(1.6, 0.04, 0.12).rotateY(rotY).translate(cx + ux * (end + 0.4 + k * (len - 0.8) / 4), deckY + 0.02, cz + uz * (end + 0.4 + k * (len - 0.8) / 4)), 0x6b4423]);
    for (const along of [end + 0.3, mid, start - 0.6]) {
      for (const side of [-0.7, 0.7]) {
        const px = cx + ux * along - uz * side, pz = cz + uz * along + ux * side;
        parts.push([new THREE.CylinderGeometry(0.09, 0.09, 1.5, 5).translate(px, deckY - 0.6, pz), 0x5a3a1c]);
      }
    }
    boxes.push({ x: mx, y: deckY - 0.06, z: mz, hx: 0.75, hy: 0.06, hz: len / 2, rotY, walkable: true });
    // Piedras en la orilla
    for (let i = 0; i < 7; i++) {
      const [lx, lz] = ring(i + 0.5, 7, R + 1.0 + rand() * 0.8, 0.4);
      const r = 0.4 + rand() * 0.35;
      add(new THREE.IcosahedronGeometry(r, 0).scale(1.2, 0.7, 1), 0x8b8478, lx, lz, 0.05);
      spheres.push({ x: cx + lx, z: cz + lz, r: r * 1.05 });
    }
  }

  if (kind === 'frozenLake') {
    const ice = new THREE.Mesh(
      new THREE.CircleGeometry(R, 26).rotateX(-Math.PI / 2).translate(cx, ground(cx, cz) + 0.03, cz),
      new THREE.MeshStandardMaterial({ color: 0xd3ecf7, roughness: 0.08, metalness: 0.15, flatShading: true })
    );
    ice.receiveShadow = true;
    ice.name = 'hielo';
    special = ice;
    // Grietas del hielo
    for (let i = 0; i < 12; i++) {
      const [lx, lz, a] = ring(i, 12, rand() * R * 0.6, 3);
      add(new THREE.BoxGeometry(0.05, 0.01, 1.2 + rand() * 2.6), 0x86a9bf, lx, lz, 0.045, a);
    }
    // Peñascos nevados alrededor
    for (let i = 0; i < 9; i++) {
      const [lx, lz] = ring(i, 9, R + 1.2 + rand() * 1.5, 0.5);
      const r = 0.6 + rand() * 0.6;
      add(new THREE.IcosahedronGeometry(r, 0).scale(1.1, 0.75, 1), 0x8d97a6, lx, lz, 0.1);
      add(new THREE.IcosahedronGeometry(r * 0.82, 0).scale(1.1, 0.4, 1), 0xf3f7fb, lx, lz, 0.1 + r * 0.42);
      spheres.push({ x: cx + lx, z: cz + lz, r: r * 1.1 });
    }
    // Cristales de hielo
    for (let i = 0; i < 6; i++) {
      const [lx, lz] = ring(i + 0.3, 6, R + 0.3, 0.6);
      for (let k = 0; k < 3; k++) add(new THREE.OctahedronGeometry(1, 0).scale(0.12, 0.45 + rand() * 0.3, 0.12).rotateZ((rand() - 0.5) * 0.7).translate((rand() - 0.5) * 0.5, 0.35, (rand() - 0.5) * 0.5), 0xbfe6f5, lx, lz);
    }
  }

  if (kind === 'spiritTree') {
    const bark = 0x3b2d48;
    // Tronco retorcido en tres tramos y raíces
    add(new THREE.CylinderGeometry(0.85, 1.25, 4, 8).rotateZ(0.12).translate(-0.2, 2, 0), bark, 0, 0);
    add(new THREE.CylinderGeometry(0.6, 0.85, 3.6, 8).rotateZ(-0.28).translate(0.45, 5.4, 0), bark, 0, 0);
    add(new THREE.CylinderGeometry(0.38, 0.6, 3, 7).rotateZ(0.32).translate(0.3, 8.4, 0.1), bark, 0, 0);
    for (let i = 0; i < 6; i++) add(new THREE.ConeGeometry(0.42, 3.4, 5).rotateZ(Math.PI / 2 + 0.35).translate(-1.6, 0.35, 0).rotateY((i / 6) * Math.PI * 2), bark, 0, 0);
    // Copa violeta y turquesa
    for (let i = 0; i < 8; i++) {
      const [lx, lz] = ring(i, 8, 1.4 + rand() * 1.6, 0.8);
      add(new THREE.IcosahedronGeometry(2 + rand() * 1.2, 0).scale(1, 0.75, 1).translate(lx, 9.6 + rand() * 1.8, lz), i % 2 ? 0x5f3fb0 : 0x2f9a8c, 0, 0);
    }
    // Orbes luminosos colgando de la copa
    for (let i = 0; i < 20; i++) {
      const [lx, lz] = ring(i, 20, 1.2 + rand() * 2.8, 0.6);
      glow(new THREE.IcosahedronGeometry(0.17 + rand() * 0.14, 0).translate(lx, 7.4 + rand() * 1.4, lz), 0x9ff7ff, 0, 0);
    }
    spheres.push({ x: cx, z: cz, r: 1.35 });
    cameraBoxes.push({ x: cx, y: ground(cx, cz) + 5, z: cz, hx: 1.3, hy: 5, hz: 1.3 });
    // Círculo de piedras con runas
    for (let i = 0; i < 8; i++) {
      const [lx, lz, a] = ring(i, 8, R - 2);
      const h = 2.2 + rand() * 0.7;
      add(new THREE.BoxGeometry(0.95, h, 0.5).rotateZ((rand() - 0.5) * 0.12).translate(0, h / 2 - 0.1, 0), 0x6a6f9e, lx, lz, 0, -a + Math.PI / 2);
      // Runa en la cara que mira al árbol
      glow(new THREE.BoxGeometry(0.3, 0.55, 0.04).translate(0, h * 0.55, 0.27).rotateY(-a - Math.PI / 2), 0xff8ae8, lx, lz);
      spheres.push({ x: cx + lx, z: cz + lz, r: 0.62 });
    }
  }

  if (kind === 'elderTree') {
    const bark = 0x5e3523, dark = 0x4a2a1c, moss = 0x4f7d34, stone = 0xb9b2a0;
    add(new THREE.CylinderGeometry(1.9, 2.8, 12, 10).translate(0, 6, 0), bark, 0, 0);
    add(new THREE.CylinderGeometry(1.3, 1.9, 6, 9).rotateZ(0.06).translate(0.2, 15, 0), bark, 0, 0);
    for (let i = 0; i < 8; i++) {
      add(new THREE.ConeGeometry(0.95, 5, 5).rotateZ(Math.PI / 2 + 0.28).translate(-2.6, 0.6, 0).rotateY((i / 8) * Math.PI * 2 + 0.2), i % 2 ? bark : dark, 0, 0);
      add(new THREE.BoxGeometry(0.9, 0.12, 0.9).translate(-3.2, 1.0, 0).rotateY((i / 8) * Math.PI * 2 + 0.2), moss, 0, 0);
    }
    // Ramas gruesas
    for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.35, 0.6, 6, 6).rotateZ(1.0).translate(-2.6, 17, 0).rotateY((i / 5) * Math.PI * 2), bark, 0, 0);
    // Copa enorme
    for (let i = 0; i < 10; i++) {
      const [lx, lz] = ring(i, 10, 2 + rand() * 4.5, 0.6);
      add(new THREE.IcosahedronGeometry(3.6 + rand() * 2.2, 1).scale(1, 0.7, 1).translate(lx, 19 + rand() * 4, lz), [0x2f6b2a, 0x3d7d2c, 0x2a5e30][i % 3], 0, 0);
    }
    spheres.push({ x: cx, z: cz, r: 3.3 });
    cameraBoxes.push({ x: cx, y: ground(cx, cz) + 9, z: cz, hx: 2.8, hy: 9, hz: 2.8 });
    // Ruinas: columnas, una columna caída, muros con musgo y escalones
    for (let i = 0; i < 7; i++) {
      const [lx, lz] = ring(i, 7, R - 1 + rand() * 2.4, 0.4);
      const h = 1 + rand() * 2.8;
      add(new THREE.CylinderGeometry(0.42, 0.48, h, 7).translate(0, h / 2, 0), stone, lx, lz);
      add(new THREE.CylinderGeometry(0.52, 0.52, 0.18, 7).translate(0, h, 0), 0x9f988a, lx, lz);
      if (rand() < 0.6) add(new THREE.CylinderGeometry(0.44, 0.44, 0.06, 7).translate(0, h + 0.12, 0), moss, lx, lz);
      spheres.push({ x: cx + lx, z: cz + lz, r: 0.55 });
    }
    const walls = [[3.2, 1.6], [2.2, 2.4], [2.8, 1.0]];
    walls.forEach(([w, h], i) => {
      const [lx, lz, a] = ring(i + 0.5, 3, R + 1.5, 0.3);
      const rotY = -a + Math.PI / 2;
      add(new THREE.BoxGeometry(w, h, 0.65).translate(0, h / 2, 0), stone, lx, lz, 0, rotY);
      add(new THREE.BoxGeometry(w * 0.7, 0.1, 0.66).translate(-w * 0.12, h + 0.05, 0), moss, lx, lz, 0, rotY);
      const wx = cx + lx, wz = cz + lz;
      boxes.push({ x: wx, y: ground(wx, wz) + h / 2, z: wz, hx: w / 2, hy: h / 2, hz: 0.33, rotY });
    });
    {
      // Columna caída
      const [lx, lz, a] = ring(4.4, 7, R + 0.5);
      add(new THREE.CylinderGeometry(0.45, 0.45, 4.2, 7).rotateZ(Math.PI / 2).translate(0, 0.42, 0), stone, lx, lz, 0, -a);
      const wx = cx + lx, wz = cz + lz;
      boxes.push({ x: wx, y: ground(wx, wz) + 0.45, z: wz, hx: 2.1, hy: 0.45, hz: 0.45, rotY: -a });
    }
  }

  // Malla fusionada (1 llamada de dibujo) y, si hay, la de las piezas que brillan (otra)
  if (parts.length) {
    const geometry = coloredParts(parts);
    const mesh = new THREE.Mesh(geometry, materials.nature);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `emblema-${kind}-piezas`;
    group.add(mesh);
    own.geometries.push(geometry);
  }
  if (glowParts.length) {
    const geometry = coloredParts(glowParts);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }); // No depende de la luz: brilla
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `emblema-${kind}-luz`;
    group.add(mesh);
    own.geometries.push(geometry);
    own.materials.push(material);
  }
  if (special) {
    group.add(special);
    own.geometries.push(special.geometry);
    own.materials.push(special.material);
  }
  for (const [g] of [...parts, ...glowParts]) g.dispose(); // Ya están copiadas en las fusionadas
  return { group, colliders: { spheres, boxes }, cameraBoxes, owned: own };
}
