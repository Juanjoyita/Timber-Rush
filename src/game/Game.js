// Game.js — Escena, renderer, cámara, luces y bucle principal.
// FASE 5: personaje con física (cannon-es) y cámara en tercera persona.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FORESTS } from '../config.js';
import { createForest, heightAt, loadForestModels, SAWMILL_AREAS, WORLD } from './forest.js';
import { createPhysics, FIXED_STEP } from './physics.js';
import { Player } from './Player.js';

// Sombras: el área cubre solo los alrededores del personaje. Así un mapa de
// 2048 px da sombras nítidas y el pase de sombras solo dibuja los objetos cercanos.
const SHADOW_HALF = 32; // Área de sombras: 64 × 64 m
const SHADOW_MAP = 2048;
const SUN_OFFSET = new THREE.Vector3(20, 30, 12).normalize().multiplyScalar(60);

// Cámara en tercera persona
// Encuadre (medido en 200 posiciones del bosque): con el punto de mira a la altura de los
// hombros y la cámara inclinada hacia el suelo, las copas de los árboles cercanos (hasta 7 m)
// quedaban fuera del plano y se veían troncos "cortados" (8 %, y 33 % con zoom). Mirando por
// encima de la cabeza, con una vista más horizontal y algo más de campo de visión: 0 % (2 % con
// zoom), y el personaje sigue viéndose entero.
const CAMERA_HEIGHT = 2.5; // Punto de mira: por encima de la cabeza del personaje (1,83 m)
const CAMERA_FOV = 65;
const CAMERA_START = { distance: 9, rise: 1.2 }; // Posición inicial: detrás y algo por encima del punto de mira
const CAMERA_FOLLOW = 8; // Rapidez con que la cámara alcanza al personaje (mayor = más rígida)
const CAMERA_MIN_GROUND = 0.5; // La cámara nunca baja de 0,5 m sobre el terreno
const MAX_DELTA = 0.1; // Si la pestaña estuvo oculta, no se simula un salto de tiempo enorme

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
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, forestConfig.fog.far + 20);

    // ---------- Renderer ----------
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Optimización: limitamos el pixelRatio a 2 para que en pantallas
    // de alta densidad no se rendericen millones de píxeles extra.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // ---------- OrbitControls en tercera persona ----------
    // El punto de mira (target) sigue al personaje; el jugador gira la cámara
    // alrededor de él con el ratón (clic izquierdo + arrastrar) y acerca con la rueda.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; // Giro suave
    this.controls.enablePan = false; // El desplazamiento lo hace el personaje, no la cámara
    this.controls.minDistance = 4; // Más cerca, las copas de los árboles cercanos no caben en el plano
    this.controls.maxDistance = 15;
    this.controls.minPolarAngle = 0.2; // Ni completamente cenital…
    this.controls.maxPolarAngle = Math.PI / 2.05; // …ni por debajo del horizonte

    this.createLights();

    // ---------- Carga: bosque + personaje en paralelo ----------
    // "ready" es una promesa que se resuelve cuando todo está en la escena
    // (o se rechaza si falla algún modelo; main.js muestra el error).
    this.forest = null;
    this.physics = null;
    this.player = new Player(this.scene);
    this.ready = this.load(forestConfig);

    // Reloj para calcular el tiempo entre fotogramas (delta)
    this.clock = new THREE.Clock();
    this.followDelta = new THREE.Vector3(); // Vector reutilizable (sin crear objetos por fotograma)
    this.followTarget = new THREE.Vector3();

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

  async load(forestConfig) {
    const [geometries] = await Promise.all([loadForestModels(forestConfig), this.player.load()]);
    this.forest = createForest(forestConfig, geometries);
    this.scene.add(this.forest.group);

    // Física: mundo con el terreno y los obstáculos del bosque + cuerpo del personaje
    this.physics = createPhysics(this.forest);
    const { x, z } = WORLD.spawn;
    // El personaje aparece mirando hacia la plataforma de venta
    const sell = SAWMILL_AREAS.sellZone;
    const yaw = Math.atan2((sell.minX + sell.maxX) / 2 - x, (sell.minZ + sell.maxZ) / 2 - z);
    this.player.attachBody(this.physics.createPlayerBody(x, z), yaw);

    // Cámara inicial: detrás del personaje y algo elevada
    const target = this.controls.target.set(x, this.player.position.y + CAMERA_HEIGHT, z);
    const { distance, rise } = CAMERA_START;
    this.camera.position.set(target.x - Math.sin(yaw) * distance, target.y + rise, target.z - Math.cos(yaw) * distance);

    // Medición: tras unos fotogramas mostramos en consola el coste real de un fotograma
    // desde la vista actual (incluye el pase de sombras). Solo informativo.
    setTimeout(() => {
      const { calls, triangles } = this.renderer.info.render;
      console.info(`[Timber Rush] Draw calls: ${calls} · Triángulos: ${triangles}`);
    }, 1000);
  }

  /** Activa los controles del personaje solo cuando se está jugando (pantalla de juego). */
  setPlaying(playing) {
    this.player.setEnabled(playing);
  }

  /**
   * La cámara acompaña al personaje: el punto de mira se acerca suavemente a él y la
   * cámara se desplaza lo mismo, de modo que se conserva el ángulo y la distancia
   * que haya elegido el jugador con el ratón.
   */
  followPlayer(dt) {
    const p = this.player.position;
    this.followTarget.set(p.x, p.y + CAMERA_HEIGHT, p.z);
    const target = this.controls.target;
    this.followDelta.copy(target);
    target.lerp(this.followTarget, 1 - Math.exp(-CAMERA_FOLLOW * dt));
    this.followDelta.subVectors(target, this.followDelta);
    this.camera.position.add(this.followDelta);
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
    const dt = Math.min(this.clock.getDelta(), MAX_DELTA);

    if (this.physics) {
      // 1. Entrada → velocidad del cuerpo  2. Física en pasos fijos  3. Cuerpo → modelo
      this.player.update(dt, this.camera);
      this.physics.world.step(FIXED_STEP, dt, 5);
      this.player.syncVisual(dt);
      this.followPlayer(dt);
    }

    this.controls.update(); // Necesario cuando enableDamping está activo

    // La cámara no atraviesa el suelo (el terreno es ondulado)
    const minY = heightAt(this.camera.position.x, this.camera.position.z) + CAMERA_MIN_GROUND;
    if (this.camera.position.y < minY) this.camera.position.y = minY;

    // Los árboles con la cámara dentro de su copa se ocultan (si no, se ven "cortados")
    if (this.forest) this.forest.updateCameraOcclusion(this.camera.position);

    this.updateShadowArea(this.controls.target);
    this.renderer.render(this.scene, this.camera);
  }
}
