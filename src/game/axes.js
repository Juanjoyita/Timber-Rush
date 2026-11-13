// axes.js — Hachas Low Poly construidas con geometría propia de Three.js.
// Hay tres niveles. Todos comparten el MISMO sistema de coordenadas, así que se
// colocan en el mismo soporte de la mano sin ajustes:
//   - Origen (0, 0, 0): punto de agarre (donde la mano rodea el mango).
//   - Eje +Y: a lo largo del mango, hacia la cabeza del hacha.
//   - Eje +X: hacia el filo de la hoja.
// Mejorar el hacha solo cambia este modelo; el personaje y sus animaciones no cambian.
// (Las compras y mejoras funcionales llegan en la Fase 8; ahora solo se usa el nivel 1.)
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

function buildParts(spec) {
  const pbr = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const materials = {
    wood: pbr(spec.handleColor, 0.8),
    // Material PBR metálico: roughness bajo y metalness alto en los niveles superiores
    steel: pbr(spec.steel.color, spec.steel.roughness, spec.steel.metalness),
    grip: spec.gripColor ? pbr(spec.gripColor, 0.9) : null,
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
  parts.push([bladeGeometry(spec.bladeWidth, spec.bladeHeight).translate(0.02, headY, 0), materials.steel]);
  if (spec.doubleBit) {
    // Segunda hoja hacia el lado contrario (girada 180° en Y para conservar la orientación de las caras)
    parts.push([bladeGeometry(spec.bladeWidth * 0.85, spec.bladeHeight * 0.9).rotateY(Math.PI).translate(-0.02, headY, 0), materials.steel]);
  }
  if (spec.band) {
    parts.push([new THREE.CylinderGeometry(0.026, 0.026, 0.04, 6).translate(0, headY - spec.bladeHeight * 0.45, 0), materials.steel]);
  }
  if (materials.grip) {
    parts.push([new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6).translate(0, 0, 0), materials.grip]);
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
