// restSpot.js — Lugar para dormir del campamento (Fase 11B): tienda de lona, saco y hoguera.
//
// RENDIMIENTO: tienda, saco, piedras y leña son UNA malla fusionada (colores de vértice, el
// material de la naturaleza); la llama es otra (no depende de la luz). La luz de la hoguera es
// una PointLight que SIEMPRE existe (de día con intensidad 0): así el número de luces no cambia
// y no se recompilan los materiales. Una sola caja de colisión.
import * as THREE from 'three';
import { coloredParts } from './forestThemes.js';

/**
 * @param at   { x, z, yaw, radius } (config.REST)
 * @param materials materiales del bosque (nature)
 * @param ground (x, z) → altura del terreno
 * @returns { group, collider, interaction: { x, z, radius }, update(dt, night), owned }
 */
export function createRestSpot(at, materials, ground) {
  const group = new THREE.Group();
  group.name = 'lugar-descanso';
  const y0 = ground(at.x, at.z);
  group.position.set(at.x, y0, at.z);
  group.rotation.y = at.yaw;

  const canvas = 0xc9a66b, canvasDark = 0xa8834f, pole = 0x6b4423;
  const tri = (a, b, c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    return g;
  };
  // Tienda "canadiense": dos faldones inclinados, fondo cerrado y entrada abierta hacia +z
  const W = 1.25, H = 1.5, L = 2.4; // Media anchura, altura y largo
  const parts = [
    [new THREE.BoxGeometry(0.08, Math.hypot(W, H), L).translate(0, Math.hypot(W, H) / 2, 0).rotateZ(Math.atan2(W, H)).translate(-W, 0, 0), canvas],
    [new THREE.BoxGeometry(0.08, Math.hypot(W, H), L).translate(0, Math.hypot(W, H) / 2, 0).rotateZ(-Math.atan2(W, H)).translate(W, 0, 0), canvasDark],
    [tri([-W, 0, -L / 2], [W, 0, -L / 2], [0, H, -L / 2]), canvasDark], // Fondo
    [tri([W, 0, -L / 2], [-W, 0, -L / 2], [0, H, -L / 2]), canvasDark], // (doble cara)
    [new THREE.CylinderGeometry(0.04, 0.04, L + 0.5, 5).rotateX(Math.PI / 2).translate(0, H + 0.02, 0), pole], // Cumbrera
    [new THREE.CylinderGeometry(0.04, 0.04, H + 0.1, 5).translate(0, (H + 0.1) / 2, L / 2 + 0.2), pole], // Palo de la entrada
    [new THREE.BoxGeometry(2.7, 0.03, L + 0.2).translate(0, 0.015, 0), 0x7a6a48], // Suelo de la tienda
    // Saco de dormir saliendo un poco por la entrada
    [new THREE.BoxGeometry(0.7, 0.18, 1.9).translate(0.15, 0.1, 0.35), 0x3f6d8f],
    [new THREE.BoxGeometry(0.55, 0.14, 0.4).translate(0.15, 0.22, -0.4), 0xe8e0cc], // Almohada
    // Tronco para sentarse
    [new THREE.CylinderGeometry(0.22, 0.24, 1.1, 7).rotateZ(Math.PI / 2).translate(-1.6, 0.22, 2.4), 0x7a4a2a],
  ];
  // Hoguera delante de la entrada: anillo de piedras y leña cruzada
  const fire = { x: 0.4, z: 2.6 };
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push([new THREE.IcosahedronGeometry(0.17, 0).scale(1.2, 0.8, 1).translate(fire.x + Math.cos(a) * 0.55, 0.1, fire.z + Math.sin(a) * 0.55), i % 2 ? 0x8b8478 : 0x9d978a]);
  }
  for (let i = 0; i < 3; i++) parts.push([new THREE.CylinderGeometry(0.06, 0.07, 0.8, 5).rotateZ(Math.PI / 2 - 0.35).rotateY((i / 3) * Math.PI).translate(fire.x, 0.18, fire.z), 0x5a3a1c]);

  const geometry = coloredParts(parts);
  for (const [g] of parts) g.dispose();
  const mesh = new THREE.Mesh(geometry, materials.nature);
  mesh.name = 'tienda';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Llama (dos conos que tiemblan) y brasas: material que no depende de la luz
  const flameMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const flameGeometry = coloredParts([
    [new THREE.ConeGeometry(0.28, 0.75, 6).translate(0, 0.45, 0), 0xff9a2e],
    [new THREE.ConeGeometry(0.16, 0.5, 6).translate(0.05, 0.4, 0.04), 0xffe07a],
    [new THREE.CylinderGeometry(0.3, 0.34, 0.06, 7).translate(0, 0.06, 0), 0xc2401f],
  ]);
  const flame = new THREE.Mesh(flameGeometry, flameMaterial);
  flame.name = 'hoguera';
  flame.position.set(fire.x, 0, fire.z);

  // Luz de la hoguera: siempre presente (intensidad 0 de día), sin sombras y de alcance corto
  const light = new THREE.PointLight(0xff9a4a, 0, 11, 2);
  light.position.set(fire.x, 1.0, fire.z);
  group.add(mesh, flame, light);

  // Colisión: la tienda y la hoguera (una caja en coordenadas del mundo, alineada con los ejes)
  const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0, 0.7), new THREE.Vector3(2.9, 2, L + 2.4));
  group.updateMatrixWorld(true);
  box.applyMatrix4(group.matrixWorld);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const collider = { x: c.x, y: y0 + 1, z: c.z, hx: s.x / 2, hy: 1, hz: s.z / 2 };

  let time = 0;
  return {
    group,
    collider,
    light,
    interaction: { x: at.x, z: at.z, radius: at.radius },
    /** Llama encendida y luz según la noche (0..1); parpadeo suave. Solo visual. */
    update(dt, night, maxIntensity) {
      time += dt;
      const on = 0.35 + 0.65 * night; // De día, rescoldos pequeños
      const flicker = 0.88 + 0.12 * Math.sin(time * 13.1) * Math.sin(time * 7.3 + 1.1);
      flame.scale.set(on, on * flicker, on);
      light.intensity = maxIntensity * night * flicker;
    },
    owned: { geometries: [geometry, flameGeometry], materials: [flameMaterial] },
  };
}
