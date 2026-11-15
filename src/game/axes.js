// axes.js — Hachas Low Poly construidas con geometría propia de Three.js.
// Hay diez niveles (Fase 11E; los tres primeros, de la Fase 8). Todos comparten el MISMO sistema de coordenadas, así que se
// colocan en el mismo soporte de la mano sin ajustes:
//   - Origen (0, 0, 0): punto de agarre (donde la mano rodea el mango).
//   - Eje +Y: a lo largo del mango, hacia la cabeza del hacha.
//   - Eje +X: hacia el filo de la hoja.
// Mejorar el hacha solo cambia este modelo; el personaje y sus animaciones no cambian.
import * as THREE from 'three';

export const AXE_LEVELS = [
  {
    level: 1,
    name: 'Hacha básica',
    damage: 1,
    handleLength: 0.72, // m
    bladeWidth: 0.13,
    bladeHeight: 0.15,
    handleColor: 0x8a5a33,
    steel: { color: 0x8c9196, roughness: 0.5, metalness: 0.6 },
    band: false, // Anillo metálico de refuerzo bajo la cabeza
    doubleBit: false, // Hoja doble
    gripColor: null, // Empuñadura forrada
  },
  {
    level: 2,
    name: 'Hacha reforzada',
    damage: 2,
    handleLength: 0.78,
    bladeWidth: 0.16,
    bladeHeight: 0.19,
    handleColor: 0x6b4423,
    steel: { color: 0xb8c0c8, roughness: 0.35, metalness: 0.8 },
    band: true,
    doubleBit: false,
    gripColor: null,
  },
  {
    level: 3,
    name: 'Hacha profesional',
    damage: 4,
    handleLength: 0.84,
    bladeWidth: 0.17,
    bladeHeight: 0.21,
    handleColor: 0x3a2a1e,
    steel: { color: 0xdfe4e8, roughness: 0.2, metalness: 0.9 },
    band: true,
    doubleBit: true,
    gripColor: 0xb3432f,
  },
  // ---------- Fase 11E: niveles 4 a 10 (cada una con forma, materiales y detalles propios) ----------
  {
    level: 4,
    name: 'Hacha del norte',
    damage: 6,
    handleLength: 0.82,
    bladeWidth: 0.17,
    bladeHeight: 0.2,
    shape: 'bearded', // Hoja «barbada»: cae hacia abajo, como las hachas nórdicas
    handleColor: 0x7a4a2a,
    steel: { color: 0x6f8796, roughness: 0.4, metalness: 0.45 }, // Acero pavonado (azulado)
    edge: { color: 0xd5dde3, roughness: 0.3, metalness: 0.45 }, // Filo afilado más claro
    band: true,
    wraps: { color: 0x4a2c18, at: [0.06, 0.24, 0.42] }, // Tiras de cuero en el mango
  },
  {
    level: 5,
    name: 'Hacha de bronce',
    damage: 9,
    handleLength: 0.84,
    bladeWidth: 0.19,
    bladeHeight: 0.22,
    shape: 'broad', // Hoja ancha en abanico
    handleColor: 0x4e3020,
    steel: { color: 0xb07a3a, roughness: 0.35, metalness: 0.45 }, // Bronce
    edge: { color: 0xe6e9ec, roughness: 0.3, metalness: 0.45 },
    band: true,
    rivets: 0x6e4a22, // Remaches en la cabeza
    pommel: 0xb07a3a,
    gripColor: 0x6b3a1f,
  },
  {
    level: 6,
    name: 'Hacha de escarcha',
    damage: 13,
    handleLength: 0.86,
    bladeWidth: 0.18,
    bladeHeight: 0.23,
    shape: 'bearded',
    handleColor: 0x5b4636,
    steel: { color: 0xbfe3f2, roughness: 0.3, metalness: 0.45 }, // Acero helado
    edge: { color: 0xffffff, roughness: 0.3, metalness: 0.45 },
    band: true,
    spike: true, // Pico trasero
    gripColor: 0xf1efe9, // Empuñadura de piel blanca
    wraps: { color: 0xc8ccd0, at: [0.3, 0.5] },
  },
  {
    level: 7,
    name: 'Hacha dorada',
    damage: 18,
    handleLength: 0.86,
    bladeWidth: 0.19,
    bladeHeight: 0.24,
    shape: 'broad',
    handleColor: 0x2e1d14,
    steel: { color: 0xe0b43a, roughness: 0.3, metalness: 0.45 }, // Oro
    edge: { color: 0xfff1b8, roughness: 0.3, metalness: 0.45 },
    band: true,
    doubleBit: true,
    gripColor: 0x8c1f1f,
    pommel: 0xe0b43a,
    wraps: { color: 0xe0b43a, at: [0.36, 0.52] }, // Anillos de oro
  },
  {
    level: 8,
    name: 'Hacha de obsidiana',
    damage: 24,
    handleLength: 0.86,
    bladeWidth: 0.2,
    bladeHeight: 0.26,
    shape: 'crescent', // Media luna
    handleColor: 0xe8dcc0, // Mango de hueso
    steel: { color: 0x1c1a24, roughness: 0.3, metalness: 0.4 }, // Obsidiana
    edge: { color: 0x9b5cff, glow: true }, // Filo violeta que brilla
    band: true,
    spike: true,
    wraps: { color: 0x2a2433, at: [0.08, 0.2, 0.32, 0.44] },
    pommel: 0x1c1a24,
  },
  {
    level: 9,
    name: 'Hacha rúnica',
    damage: 32,
    handleLength: 0.88,
    bladeWidth: 0.2,
    bladeHeight: 0.26,
    shape: 'crescent',
    handleColor: 0x5a3d26,
    steel: { color: 0xc9cfd6, roughness: 0.3, metalness: 0.45 }, // Plata
    edge: { color: 0xeef2f5, roughness: 0.3, metalness: 0.45 },
    band: true,
    doubleBit: true,
    runes: 0x6dff9e, // Runas verdes que brillan en las dos caras
    gripColor: 0x2f4a3a,
    wraps: { color: 0xc9cfd6, at: [0.4, 0.56] },
    pommel: 0xc9cfd6,
  },
  {
    level: 10,
    name: 'Hacha ancestral',
    damage: 40,
    handleLength: 0.9,
    bladeWidth: 0.21,
    bladeHeight: 0.28,
    shape: 'crescent',
    handleColor: 0x7a3b22, // Madera de secuoya
    steel: { color: 0x3a3f46, roughness: 0.3, metalness: 0.45 }, // Acero oscuro
    edge: { color: 0xe0b43a, roughness: 0.3, metalness: 0.45 }, // Filo de oro
    band: true,
    doubleBit: true,
    gem: 0xffa53a, // Corazón de ámbar que brilla en la cabeza
    runes: 0xffc85a,
    gripColor: 0x3b2416,
    wraps: { color: 0xe0b43a, at: [0.1, 0.3, 0.46, 0.6] },
    pommel: 0xe0b43a,
  },
];

const GRIP_FROM_BOTTOM = 0.12; // El agarre está a 12 cm del extremo inferior del mango
const BLADE_THICKNESS = 0.028;

// Caché: cada nivel se construye una sola vez y se reutilizan geometrías y materiales
const cache = new Map();

/** Hoja Low Poly: trapecio extruido (estrecho junto al mango, ancho en el filo). */
function bladeGeometry(width, height) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -height * 0.28);
  shape.lineTo(width, -height * 0.5);
  shape.lineTo(width, height * 0.5);
  shape.lineTo(0, height * 0.28);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: BLADE_THICKNESS, bevelEnabled: false });
  geo.translate(0, 0, -BLADE_THICKNESS / 2); // Centrada en el plano del mango
  return geo;
}

/**
 * Contornos de las hojas de los niveles 4-10 (Fase 11E), en unidades de ancho (w) y alto (h).
 * outline: contorno completo (antihorario); edge: la línea del filo (se dibuja con otro material).
 */
const BLADE_SHAPES = {
  // Hoja nórdica «barbada»: el filo baja mucho por debajo del mango
  bearded: { outline: [[0, -0.2], [0.42, -0.3], [0.78, -0.95], [1, -0.82], [1, 0.45], [0.55, 0.36], [0, 0.28]], edge: [[0.78, -0.95], [1, -0.82], [1, 0.45]] },
  // Abanico: estrecha junto al ojo y muy ancha en el filo, con el filo algo curvo
  broad: { outline: [[0, -0.22], [0.6, -0.42], [0.92, -0.62], [1.02, -0.3], [1.05, 0], [1.02, 0.3], [0.92, 0.62], [0.6, 0.42], [0, 0.22]], edge: [[0.92, -0.62], [1.02, -0.3], [1.05, 0], [1.02, 0.3], [0.92, 0.62]] },
  // Media luna: los extremos del filo se curvan hacia el mango
  crescent: { outline: [[0, -0.2], [0.42, -0.3], [0.62, -0.62], [0.82, -0.7], [0.98, -0.42], [1.06, 0], [0.98, 0.42], [0.82, 0.7], [0.62, 0.62], [0.42, 0.3], [0, 0.2]], edge: [[0.62, -0.62], [0.82, -0.7], [0.98, -0.42], [1.06, 0], [0.98, 0.42], [0.82, 0.7], [0.62, 0.62]] },
};
const EDGE_WIDTH = 0.03; // Ancho de la franja del filo (m)

function extrude(points, depth) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Hoja con contorno propio + franja del filo, algo más gruesa para que asome por las dos caras. */
function shapedBlade(kind, width, height) {
  const def = BLADE_SHAPES[kind];
  const pts = def.outline.map(([x, y]) => [x * width, y * height]);
  const edge = def.edge.map(([x, y]) => [x * width, y * height]);
  // La franja va del filo hacia dentro (hacia el ojo) EDGE_WIDTH metros
  const inner = edge.map(([x, y]) => {
    const len = Math.hypot(x, y * 0.35) || 1;
    return [x - (EDGE_WIDTH * x) / len, y - (EDGE_WIDTH * y * 0.35) / len];
  }).reverse();
  return { blade: extrude(pts, BLADE_THICKNESS), edge: extrude([...edge, ...inner], BLADE_THICKNESS + 0.006) };
}

function buildParts(spec) {
  const pbr = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const glow = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, roughness: 0.4, flatShading: true });
  const materials = {
    wood: pbr(spec.handleColor, 0.8),
    // Material PBR metálico: roughness bajo y metalness alto en los niveles superiores
    steel: pbr(spec.steel.color, spec.steel.roughness, spec.steel.metalness),
    grip: spec.gripColor ? pbr(spec.gripColor, 0.9) : null,
    edge: spec.edge ? (spec.edge.glow ? glow(spec.edge.color) : pbr(spec.edge.color, spec.edge.roughness, spec.edge.metalness)) : null,
    wrap: spec.wraps ? pbr(spec.wraps.color, 0.6, spec.wraps.color === spec.steel.color || spec.wraps.color === 0xe0b43a || spec.wraps.color === 0xc9cfd6 ? 0.45 : 0) : null,
    pommel: spec.pommel ? pbr(spec.pommel, 0.35, 0.45) : null,
    rivet: spec.rivets ? pbr(spec.rivets, 0.4, 0.45) : null,
    runes: spec.runes ? glow(spec.runes) : null,
    gem: spec.gem ? glow(spec.gem) : null,
  };

  const top = spec.handleLength - GRIP_FROM_BOTTOM; // Altura del extremo superior respecto al agarre
  const headY = top - spec.bladeHeight * 0.45;
  const parts = [];

  // Mango: cilindro de 6 lados, algo más grueso abajo
  const handle = new THREE.CylinderGeometry(0.018, 0.022, spec.handleLength, 6);
  handle.translate(0, spec.handleLength / 2 - GRIP_FROM_BOTTOM, 0);
  parts.push([handle, materials.wood]);

  // Ojo del hacha (donde entra el mango) y hoja
  parts.push([new THREE.BoxGeometry(0.06, spec.bladeHeight * 0.6, 0.045).translate(0, headY, 0), materials.steel]);
  if (!spec.shape) {
    // Niveles 1-3: hoja trapezoidal (sin cambios respecto a la Fase 8)
    parts.push([bladeGeometry(spec.bladeWidth, spec.bladeHeight).translate(0.02, headY, 0), materials.steel]);
    if (spec.doubleBit) {
      // Segunda hoja hacia el lado contrario (girada 180° en Y para conservar la orientación de las caras)
      parts.push([bladeGeometry(spec.bladeWidth * 0.85, spec.bladeHeight * 0.9).rotateY(Math.PI).translate(-0.02, headY, 0), materials.steel]);
    }
  } else {
    const main = shapedBlade(spec.shape, spec.bladeWidth, spec.bladeHeight);
    parts.push([main.blade.translate(0.02, headY, 0), materials.steel]);
    if (materials.edge) parts.push([main.edge.translate(0.02, headY, 0), materials.edge]);
    if (spec.doubleBit) {
      const back = shapedBlade(spec.shape, spec.bladeWidth * 0.85, spec.bladeHeight * 0.9);
      parts.push([back.blade.rotateY(Math.PI).translate(-0.02, headY, 0), materials.steel]);
      if (materials.edge) parts.push([back.edge.rotateY(Math.PI).translate(-0.02, headY, 0), materials.edge]);
    }
  }
  if (spec.spike && !spec.doubleBit) {
    // Pico trasero de cuatro caras (apunta a -X)
    parts.push([new THREE.ConeGeometry(0.024, 0.11, 4).rotateZ(Math.PI / 2).translate(-0.085, headY, 0), materials.steel]);
  }
  if (spec.band) {
    parts.push([new THREE.CylinderGeometry(0.026, 0.026, 0.04, 6).translate(0, headY - spec.bladeHeight * 0.45, 0), materials.steel]);
  }
  if (materials.grip) {
    parts.push([new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6).translate(0, 0, 0), materials.grip]);
  }
  if (materials.wrap) {
    for (const y of spec.wraps.at) parts.push([new THREE.CylinderGeometry(0.0235, 0.0235, 0.022, 6).translate(0, y, 0), materials.wrap]);
  }
  if (materials.pommel) {
    parts.push([new THREE.CylinderGeometry(0.02, 0.03, 0.04, 6).translate(0, -GRIP_FROM_BOTTOM - 0.01, 0), materials.pommel]);
  }
  const face = BLADE_THICKNESS / 2 + 0.002;
  if (materials.rivet) {
    for (const [x, y] of [[0.045, 0.05], [0.045, -0.05], [0.09, 0]]) {
      for (const z of [face, -face]) parts.push([new THREE.IcosahedronGeometry(0.01, 0).translate(x, headY + y * spec.bladeHeight * 2, z), materials.rivet]);
    }
  }
  if (materials.runes) {
    // Tres runas en cada cara de la hoja principal: trazos verticales e inclinados
    const runes = [[0.07, 0.03, 0], [0.1, -0.02, 0.5], [0.13, 0.025, -0.5]];
    for (const [x, y, tilt] of runes) {
      for (const z of [face, -face]) parts.push([new THREE.BoxGeometry(0.011, 0.055, 0.004).rotateZ(tilt).translate(x * spec.bladeWidth / 0.2, headY + y, z), materials.runes]);
    }
  }
  if (materials.gem) {
    parts.push([new THREE.OctahedronGeometry(0.032, 0).scale(1, 1.25, 1.2).translate(0, headY, 0), materials.gem]);
  }
  return parts;
}

/**
 * Devuelve un hacha nueva (Group) del nivel indicado. Varias copias del mismo nivel
 * comparten geometrías y materiales.
 */
export function createAxe(level) {
  const spec = AXE_LEVELS.find((a) => a.level === level);
  if (!spec) throw new Error(`nivel de hacha desconocido: ${level}`);
  if (!cache.has(level)) cache.set(level, buildParts(spec));

  const axe = new THREE.Group();
  axe.name = `hacha-nivel-${level}`;
  for (const [geometry, material] of cache.get(level)) {
    const part = new THREE.Mesh(geometry, material);
    part.castShadow = true;
    axe.add(part);
  }
  axe.userData = { level, damage: spec.damage, name: spec.name };
  return axe;
}
