// forestThemes.js — Identidad visual de cada bosque (Fase 11A).
//
// Todos los bosques reutilizan los mismos modelos Low Poly (CC0 + árboles propios). Cada bosque
// los adapta UNA vez al construirse, sin texturas ni materiales nuevos (un solo material con
// colores de vértice, como siempre):
// - Recolorea por TIPO de pieza (hojas, corteza, piedra, flores), conservando el sombreado de
//   cada modelo: otoño naranja/rojo/amarillo, follaje violeta y turquesa del Místico…
// - Nieve: las caras que miran hacia arriba se vuelven blancas (copas, rocas, troncos).
// - Elementos propios (extras): hojas caídas, montículos de nieve, setas que brillan, cristales,
//   setas del bosque ancestral. Cada tipo es un InstancedMesh (1-2 llamadas de dibujo).
// El Bosque Verde no tiene tema: usa los modelos tal cual (idéntico a antes de la Fase 11A).
import * as THREE from 'three';

const _c = new THREE.Color();
const _t = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _thsl = { h: 0, s: 0, l: 0 };
const SRGB = THREE.SRGBColorSpace;

/** Tipo de color de un vértice (en sRGB, como lo ve una persona). */
export function colorClass(h, s, l) {
  if (s < 0.12) return 'gray'; // Piedra, ceniza, corteza blanca del abedul
  if (h >= 0.15 && h <= 0.5 && s >= 0.15) return 'leaf'; // Verdes y amarillos verdosos
  if ((h < 0.15 || h > 0.95) && l < 0.55) return 'bark'; // Marrones
  return 'other'; // Flores, madera clara…
}

/** Nuevo color: tono y saturación del objetivo, luminosidad proporcional a la original. */
function remap(target, l, refL, out) {
  _t.setHex(target);
  _t.getHSL(_thsl, SRGB);
  const lightness = Math.min(0.95, Math.max(0.03, _thsl.l * (refL > 0 ? l / refL : 1)));
  return out.setHSL(_thsl.h, _thsl.s, lightness, SRGB);
}

/**
 * Copia recoloreada de una geometría según el tema.
 * @param kind  'tree' | 'bush' | 'grass' | 'flower' | 'rock' | 'wood'
 * @param index posición del modelo en su lista (elige un color de la paleta: variedad)
 */
export function recolorGeometry(geometry, theme, kind, index = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const color = g.getAttribute('color');
  const pos = g.getAttribute('position');
  if (!color) return g;
  const palettes = { tree: theme.foliage, bush: theme.bushes ?? theme.foliage, grass: theme.grass ?? theme.foliage, flower: theme.grass ?? theme.foliage };
  const leafPalette = palettes[kind] ?? theme.foliage;
  const leafTarget = leafPalette?.length ? leafPalette[index % leafPalette.length] : null;
  const flowerTarget = theme.flowers?.length ? theme.flowers[index % theme.flowers.length] : null;

  // 1) Luminosidad media de cada tipo (referencia para conservar el sombreado del modelo)
  const sums = { leaf: [0, 0], bark: [0, 0], gray: [0, 0], other: [0, 0] };
  const classes = new Array(color.count);
  const lights = new Float32Array(color.count);
  for (let i = 0; i < color.count; i++) {
    _c.setRGB(color.getX(i), color.getY(i), color.getZ(i)); // Lineal (espacio de trabajo)
    _c.getHSL(_hsl, SRGB);
    const cls = colorClass(_hsl.h, _hsl.s, _hsl.l);
    classes[i] = cls;
    lights[i] = _hsl.l;
    sums[cls][0] += _hsl.l;
    sums[cls][1]++;
  }
  const ref = (cls) => (sums[cls][1] ? sums[cls][0] / sums[cls][1] : 0.5);

  // 2) Recolorear
  const out = new Float32Array(color.count * 3);
  for (let i = 0; i < color.count; i++) {
    _c.setRGB(color.getX(i), color.getY(i), color.getZ(i));
    const cls = classes[i];
    if (cls === 'leaf' && leafTarget !== null) remap(leafTarget, lights[i], ref('leaf'), _c);
    else if (cls === 'bark' && theme.bark !== undefined) remap(theme.bark, lights[i], ref('bark'), _c);
    else if (cls === 'gray' && kind === 'rock' && theme.rock !== undefined) remap(theme.rock, lights[i], ref('gray'), _c);
    else if (cls === 'other' && kind === 'flower' && flowerTarget !== null) remap(flowerTarget, lights[i], ref('other'), _c);
    out[i * 3] = _c.r;
    out[i * 3 + 1] = _c.g;
    out[i * 3 + 2] = _c.b;
  }

  // 3) Nieve: cada triángulo que mira hacia arriba (sin tocar hierba ni flores)
  if (theme.snow !== undefined && kind !== 'grass' && kind !== 'flower') {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      n.subVectors(c, b).cross(a.sub(b)).normalize();
      if (n.y < 0.55) continue;
      _c.setHex(theme.snow);
      const shade = 0.92 + 0.08 * n.y; // Un poco más gris en las pendientes
      for (let v = i; v < i + 3; v++) {
        out[v * 3] = _c.r * shade;
        out[v * 3 + 1] = _c.g * shade;
        out[v * 3 + 2] = _c.b * shade;
      }
    }
  }

  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Geometrías del bosque con su tema aplicado.
 * @returns { geometries, owned } owned: geometrías creadas para este bosque (se liberan al salir)
 */
export function applyForestTheme(geometries, config) {
  const theme = config.theme ?? {};
  const owned = new Set();
  if (!theme.foliage && !theme.snow && !theme.bark && !theme.rock) return { geometries, owned };
  const m = config.models, p = config.proceduralTrees;
  const out = { ...geometries };
  const groups = [
    [[...m.pines, ...m.roundTrees, ...p.pines, ...p.round, ...m.deadTrees], 'tree'],
    [m.bushes, 'bush'],
    [m.grass, 'grass'],
    [m.flowers, 'flower'],
    [m.rocks, 'rock'],
    [[...m.logs, ...m.stumps], 'wood'],
  ];
  for (const [names, kind] of groups) {
    names.forEach((name, i) => {
      if (!geometries[name]) return;
      out[name] = recolorGeometry(geometries[name], theme, kind, i);
      owned.add(out[name]);
    });
  }
  return { geometries: out, owned };
}

// ---------- Elementos propios de cada bosque ----------

/** Fusiona piezas [geometría, color] en una geometría no indexada con colores de vértice. */
export function coloredParts(parts) {
  const geos = parts.map(([geo, hex]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _c.set(hex);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) _c.toArray(colors, i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    return g;
  });
  const count = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const position = new Float32Array(count * 3), color = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    position.set(g.attributes.position.array, o);
    color.set(g.attributes.color.array, o);
    o += g.attributes.position.array.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

const disc = (r, x, z, y = 0.02) => new THREE.CircleGeometry(r, 6).rotateX(-Math.PI / 2).translate(x, y, z);

/**
 * Tipos de elementos propios. Cada uno: piezas (geometría + material), escala, radio ocupado
 * y si proyecta sombra. material: 'nature' (colores de vértice) o un material propio que brilla.
 */
export function createExtraKinds(materials) {
  const glow = (color) => new THREE.MeshBasicMaterial({ color, fog: true }); // No depende de la luz: "brilla"
  const crystal = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, fog: true });
  return {
    // Otoñal: manchas de hojas caídas sobre la hierba (planas, sin colisión)
    leafLitter: {
      parts: [
        { geometry: coloredParts([[disc(0.55, 0, 0), 0xd9661f], [disc(0.35, 0.45, 0.2, 0.03), 0xc23b22], [disc(0.3, -0.35, -0.3, 0.03), 0xf0c13c]]), material: materials.nature },
      ],
      scale: [0.7, 1.7], radius: 0.6, cast: false,
    },
    // Nevado: montículos de nieve
    snowMounds: {
      parts: [{ geometry: coloredParts([[new THREE.IcosahedronGeometry(1, 0).scale(1, 0.33, 1), 0xf3f7fb]]), material: materials.nature }],
      scale: [0.45, 1.3], radius: 1.0, cast: false,
    },
    // Místico: setas con sombrero luminoso (pie con colores de vértice + sombrero que brilla)
    glowMushrooms: {
      parts: [
        { geometry: coloredParts([[new THREE.CylinderGeometry(0.04, 0.06, 0.3, 5).translate(0, 0.15, 0), 0xe8e0f0], [new THREE.CylinderGeometry(0.03, 0.05, 0.2, 5).translate(0.18, 0.1, 0.1), 0xe8e0f0]]), material: materials.nature },
        { geometry: new THREE.ConeGeometry(0.17, 0.12, 6).translate(0, 0.34, 0), material: glow(0x7af7ff) },
        { geometry: new THREE.ConeGeometry(0.12, 0.09, 6).translate(0.18, 0.22, 0.1), material: glow(0xff8ae8) },
      ],
      scale: [0.8, 1.6], radius: 0.3, cast: false,
    },
    // Místico: grupos de cristales translúcidos
    crystals: {
      parts: [
        {
          geometry: (() => {
            const g = (sx, sy, x, z, tilt) => new THREE.OctahedronGeometry(1, 0).scale(sx, sy, sx).rotateZ(tilt).translate(x, sy * 0.7, z);
            const merged = coloredParts([[g(0.18, 0.7, 0, 0, 0.1), 0xffffff], [g(0.13, 0.5, 0.25, 0.1, -0.35), 0xffffff], [g(0.11, 0.42, -0.2, 0.15, 0.4), 0xffffff]]);
            merged.deleteAttribute('color');
            return merged;
          })(),
          material: crystal(0x8f7bff),
        },
      ],
      scale: [0.8, 1.6], radius: 0.5, cast: false,
    },
    // Ancestral: setas grandes de sombrero rojo con motas
    mushrooms: {
      parts: [
        {
          geometry: coloredParts([
            [new THREE.CylinderGeometry(0.07, 0.1, 0.4, 6).translate(0, 0.2, 0), 0xefe6d2],
            [new THREE.SphereGeometry(0.26, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.36, 0), 0xb2402c],
            [new THREE.CylinderGeometry(0.05, 0.07, 0.24, 6).translate(0.25, 0.12, 0.12), 0xefe6d2],
            [new THREE.SphereGeometry(0.15, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.25, 0.22, 0.12), 0xc0703a],
          ]),
          material: materials.nature,
        },
      ],
      scale: [0.8, 1.7], radius: 0.4, cast: true,
    },
  };
}
