// Game.js — Escena, renderer, cámara, luces y bucle principal.
// FASE 4: carga los modelos GLB y construye el Bosque Verde (forest.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FORESTS } from '../config.js';
import { createForest, loadForestModels, WORLD } from './forest.js';

// Sombras: el área cubre solo los alrededores del punto que mira la cámara
// (en la Fase 5, el personaje). Así un mapa de 2048 px da sombras nítidas
// y el pase de sombras solo dibuja los objetos cercanos.
const SHADOW_HALF = 32; // Área de sombras: 64 × 64 m
const SHADOW_MAP = 2048;
const SUN_OFFSET = new THREE.Vector3(20, 30, 12).normalize().multiplyScalar(60);

export class Game {
  constructor(container) {
    this.container = container;
    const forestConfig = FORESTS[0]; // Bosque Verde

    // ---------- Escena ----------
    // THREE.Scene es el contenedor de todos los objetos, luces y cámara.
    this.scene = new THREE.Scene();
    const sky = forestConfig.colors.sky;
    this.scene.background = new THREE.Color(sky);
    // THREE.Fog muy sutil: empieza a 110 m (los árboles cercanos se ven nítidos)
    // y solo funde el horizonte con el cielo, disimulando el final del terreno.
    this.scene.fog = new THREE.Fog(sky, forestConfig.fog.near, forestConfig.fog.far);

    // ---------- Cámara ----------
    // PerspectiveCamera(fov, aspecto, near, far). "far" algo mayor que el final
    // de la niebla: lo que está más lejos no se vería y no se dibuja.
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, forestConfig.fog.far + 20);
    this.camera.position.set(WORLD.spawn.x + 10, 12, WORLD.spawn.z + 18);

    // ---------- Renderer ----------
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Optimización: limitamos el pixelRatio a 2 para que en pantallas
    // de alta densidad no se rendericen millones de píxeles extra.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // ---------- OrbitControls ----------
    // Clic izquierdo: girar · rueda: zoom · clic derecho: desplazarse por el bosque.
    // En la Fase 5 el objetivo pasará a ser el personaje.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; // Movimiento suave
    this.controls.screenSpacePanning = false; // El desplazamiento se hace sobre el suelo
    this.controls.target.set(WORLD.spawn.x, 1, WORLD.spawn.z - 4);
    this.controls.maxPolarAngle = Math.PI / 2.15; // Evita mirar por debajo del suelo
    this.controls.minDistance = 4;
    this.controls.maxDistance = 45;
    // Límites del punto de mira: nunca sale de la zona jugable (120 × 120)
    this.targetMin = new THREE.Vector3(-WORLD.playHalf, 1, -WORLD.playHalf);
    this.targetMax = new THREE.Vector3(WORLD.playHalf, 1, WORLD.playHalf);
    this.clampOffset = new THREE.Vector3(); // Vector reutilizable (sin crear objetos por fotograma)

    this.createLights();

    // ---------- Bosque ----------
    // La carga de los GLB es asíncrona: "ready" es una promesa que se resuelve
    // cuando el bosque está en la escena (o se rechaza si falla algún modelo).
    this.forest = null;
    this.ready = this.loadForest(forestConfig);

    // Reloj para calcular el tiempo entre fotogramas (delta)
    this.clock = new THREE.Clock();

    // Ajustar cámara y renderer cuando cambia el tamaño de la ventana
    window.addEventListener('resize', () => this.onResize());

    // Guardamos el bucle enlazado una sola vez (evita crear funciones en cada frame)
    this.loop = this.loop.bind(this);
  }

  createLights() {
    // AmbientLight: luz base uniforme para que las caras en sombra no queden negras.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));

    // DirectionalLight: simula el sol. Es la ÚNICA luz que proyecta sombras (optimización).
    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = 140;
    // Pequeños ajustes para evitar "acné de sombras" (rayas sobre las superficies)
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.shadowCenter = new THREE.Vector2(Infinity, Infinity);
  }

  /**
   * Mueve el sol (y su área de sombras) para centrarla en el punto indicado.
   * Se ajusta a múltiplos del tamaño de un píxel de sombra para evitar que los
   * bordes de las sombras "tiemblen", y solo se recalcula si el punto cambia.
   */
  updateShadowArea(point) {
    const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
    const x = Math.round(point.x / texel) * texel;
    const z = Math.round(point.z / texel) * texel;
    if (x === this.shadowCenter.x && z === this.shadowCenter.y) return;
    this.shadowCenter.set(x, z);
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
    this.sun.target.updateMatrixWorld();
  }

  async loadForest(forestConfig) {
    const geometries = await loadForestModels(forestConfig);
    this.forest = createForest(forestConfig, geometries);
    this.scene.add(this.forest.group);

    // Medición: tras unos fotogramas mostramos en consola el coste real de un fotograma
    // desde la vista actual (incluye el pase de sombras). Solo informativo.
    setTimeout(() => {
      const { calls, triangles } = this.renderer.info.render;
      console.info(`[Timber Rush] Draw calls: ${calls} · Triángulos: ${triangles}`);
    }, 1000);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    requestAnimationFrame(this.loop);
  }

  // Bucle principal con requestAnimationFrame (se sincroniza con el refresco de pantalla)
  loop() {
    requestAnimationFrame(this.loop);
    // delta se usará desde la Fase 5 (movimiento, físicas y animaciones)
    this.clock.getDelta();

    this.controls.update(); // Necesario cuando enableDamping está activo

    // El punto de mira no puede salir de la zona jugable: si se pasa, se devuelve
    // al límite y la cámara se desplaza lo mismo (mantiene la distancia y el ángulo).
    const target = this.controls.target;
    this.clampOffset.copy(target);
    target.clamp(this.targetMin, this.targetMax);
    this.clampOffset.sub(target);
    if (this.clampOffset.lengthSq() > 0) this.camera.position.sub(this.clampOffset);

    this.updateShadowArea(target);
    this.renderer.render(this.scene, this.camera);
  }
}
