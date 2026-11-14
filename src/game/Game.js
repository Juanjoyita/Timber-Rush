// Game.js — Escena, renderer, cámara, luces y bucle principal.
// FASE 5: personaje con física (cannon-es) y cámara en tercera persona.
// FASE 6: ataque con el hacha (clic izquierdo mantenido) que tala los árboles alcanzados,
//         sonidos posicionales y regeneración.
// FASE 7A: recolección automática de la madera del suelo y mochila.
// FASE 7B: venta con F en la plataforma del aserradero y celebración (solo tras confirmarla).
//         Cámara en tercera persona con el ratón (Pointer Lock) y pausa con ESC.
import * as THREE from 'three';
import { FORESTS, SALE } from '../config.js';
import { createForest, heightAt, loadForestModels, SAWMILL_AREAS, surfaceAt, WORLD } from './forest.js';
import { createPhysics, FIXED_STEP } from './physics.js';
import { Player } from './Player.js';
import { ChoppingSystem } from './chopping.js';
import { AudioManager } from './audio.js';
import { CameraObstacles, ThirdPersonCamera } from './ThirdPersonCamera.js';
import { PlaySession } from './session.js';
import { Backpack } from './backpack.js';
import { SaleCelebration } from './saleEffects.js';

// Sombras: el área cubre solo los alrededores del personaje. Así un mapa de
// 2048 px da sombras nítidas y el pase de sombras solo dibuja los objetos cercanos.
const SHADOW_HALF = 32; // Área de sombras: 64 × 64 m
const SHADOW_MAP = 2048;
const SUN_OFFSET = new THREE.Vector3(20, 30, 12).normalize().multiplyScalar(60);

// Cámara en tercera persona: ver ThirdPersonCamera.js (encuadre, sensibilidad, zoom y límites)
const CAMERA_FOV = 65;
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

    // ---------- Cámara en tercera persona (ratón con Pointer Lock + rueda) ----------
    this.cameraRig = new ThirdPersonCamera(this.camera, this.renderer.domElement, { heightAt });

    this.createLights();

    // ---------- Carga: bosque + personaje en paralelo ----------
    // "ready" es una promesa que se resuelve cuando todo está en la escena
    // (o se rechaza si falla algún modelo; main.js muestra el error).
    this.forest = null;
    this.physics = null;
    this.player = new Player(this.scene);
    this.chopping = null;
    this.aimDirection = new THREE.Vector3(); // Reutilizable (ayuda de puntería)
    this.footPosition = new THREE.Vector3(); // Reutilizable (sonido de pasos)

    // ---------- Mochila (Fase 7A) ----------
    // main.js asigna onBackpackChange / onBackpackFull para el indicador de la interfaz.
    this.onBackpackChange = () => {};
    this.onBackpackFull = () => {};
    this.onWoodCollected = () => {}; // (unidades) => void — para totalWoodCollected
    this.backpack = new Backpack(1);
    this.backpack.onChange = (backpack) => this.onBackpackChange(backpack);

    // ---------- Venta (Fase 7B) ----------
    // Game solo detecta la plataforma y la tecla F, y celebra ventas YA confirmadas:
    // el cálculo y la escritura segura los hace progressSync.js (main.js los conecta).
    this.onSellRequest = () => {};
    this.onSellZoneChange = () => {};
    this.inSellZone = false;
    this.saleCelebration = new SaleCelebration(this.scene);
    const zone = SAWMILL_AREAS.sellZone;
    this.sellCenter = new THREE.Vector3((zone.minX + zone.maxX) / 2, 0, (zone.minZ + zone.maxZ) / 2);
    this.sellCenter.y = heightAt(this.sellCenter.x, this.sellCenter.z) + 0.35;
    window.addEventListener('keydown', (e) => {
      if (e.code !== SALE.key || e.repeat || !this.session.active || !this.inSellZone) return;
      this.onSellRequest();
    });

    // ---------- Audio ----------
    // Un único AudioListener en la cámara. El AudioContext se reanuda con la primera
    // interacción del usuario; si falta algún archivo, el juego sigue sin ese sonido.
    this.audio = new AudioManager(this.camera, this.scene);
    this.audio.installUnlock(window);
    this.audio.load();

    // ---------- Partida: jugar, pausa (ESC) y cursor capturado ----------
    // main.js asigna onPauseChange / onLockHint para mostrar la pausa y la indicación.
    this.onPauseChange = () => {};
    this.onLockHint = () => {};
    this.onShopChange = () => {}; // Tienda abierta/cerrada (Fase 8): main.js muestra el panel
    this.session = new PlaySession(this.cameraRig, this.player, {
      onPauseChange: (paused) => this.onPauseChange(paused),
      onLockHint: (show) => this.onLockHint(show),
      onShopChange: (open) => this.onShopChange(open),
    });
    this.cameraRig.onLockChange = (locked) => this.session.lockChange(locked);
    this.cameraRig.onLockError = () => this.session.lockError();
    this.renderer.domElement.addEventListener('mousedown', (e) => this.session.pointerDown(e.button));
    window.addEventListener('mouseup', (e) => this.session.pointerUp(e.button));
    window.addEventListener('keydown', (e) => {
      if (e.repeat && e.code === 'KeyB') return; // Mantener B no abre y cierra la tienda sin parar
      this.session.keyDown(e.code);
    });
    window.addEventListener('blur', () => this.session.blur());

    this.ready = this.load(forestConfig);

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

  async load(forestConfig) {
    const [geometries] = await Promise.all([loadForestModels(forestConfig), this.player.load()]);
    this.player.equipAxe(this.axeLevel ?? 1); // Por si el perfil se cargó antes que el modelo
    this.forest = createForest(forestConfig, geometries);
    this.scene.add(this.forest.group);

    // Física: mundo con el terreno y los obstáculos del bosque + cuerpo del personaje
    this.physics = createPhysics(this.forest);
    const { x, z } = WORLD.spawn;
    // El personaje aparece mirando hacia la plataforma de venta
    const sell = SAWMILL_AREAS.sellZone;
    const yaw = Math.atan2((sell.minX + sell.maxX) / 2 - x, (sell.minZ + sell.maxZ) / 2 - z);
    this.player.attachBody(this.physics.createPlayerBody(x, z), yaw);

    // Ataque y tala separados: el personaje golpea (haya o no un árbol) y avisa de cada impacto;
    // el sistema de tala comprueba si alcanza a un árbol (alcance + arco frontal) y le aplica
    // el daño. Sus eventos (golpe, caída, impacto contra el suelo) se convierten en sonidos.
    // Un golpe al aire no genera eventos: ni daño ni sonidos de madera.
    this.chopping = new ChoppingSystem({
      forest: this.forest,
      forestConfig,
      scene: this.scene,
      onEvent: (event) => this.audio.handleChopEvent(event),
    });
    this.player.onAttackImpact = (attack) => this.chopping.receiveAttack(attack);

    // Pasos: sonido posicional en los pies, según el suelo (hierba o madera del aserradero)
    // y más fuerte al correr. El ritmo lo marcan las animaciones Walk / Run.
    this.player.onFootstep = (step) => this.playFootstep(step);

    // Cámara: obstáculos (terreno, troncos y aserradero; no las hojas) y posición inicial detrás
    this.cameraRig.obstacles = new CameraObstacles({ trees: this.forest.trees, boxes: this.forest.cameraBoxes, heightAt });
    this.cameraRig.placeBehind(this.player.position, yaw);

    // Medición: tras unos fotogramas mostramos en consola el coste real de un fotograma
    // desde la vista actual (incluye el pase de sombras). Solo informativo.
    setTimeout(() => {
      const { calls, triangles } = this.renderer.info.render;
      console.info(`[Timber Rush] Draw calls: ${calls} · Triángulos: ${triangles}`);
    }, 1000);
  }

  /**
   * Entrar a jugar (llamar desde el clic en "Jugar": el navegador exige una interacción para
   * capturar el cursor) o volver al menú (libera el cursor).
   */
  setPlaying(playing) {
    if (playing) this.session.start();
    else this.session.stop();
  }

  /** Hacha del nivel guardado o recién comprado (1..3): cambia el modelo y el daño. */
  setAxeLevel(level) {
    this.axeLevel = Math.min(3, Math.max(1, Math.floor(level) || 1));
    if (this.player.axeSocket) this.player.equipAxe(this.axeLevel);
  }

  /** Nivel de la mochila del perfil del jugador (1..3). */
  setBackpackLevel(level) {
    this.backpack.setLevel(level);
  }

  playFootstep({ running }) {
    const p = this.player.position;
    this.footPosition.set(p.x, p.y + 0.05, p.z);
    this.audio.play(`step_${surfaceAt(p.x, p.z)}${running ? '_run' : ''}`, this.footPosition);
  }

  /** ¿Está el personaje sobre la plataforma de venta? Avisa solo cuando cambia. */
  updateSellZone() {
    const p = this.player.position, z = SAWMILL_AREAS.sellZone;
    const inside = p.x >= z.minX && p.x <= z.maxX && p.z >= z.minZ && p.z <= z.maxZ;
    if (inside === this.inSellZone) return;
    this.inSellZone = inside;
    this.onSellZoneChange(inside);
  }

  /**
   * Monedas 3D que saltan desde la plataforma de venta. Solo visual: lo llama la secuencia de
   * celebración (saleSequence.js) cuando la venta ya está confirmada.
   */
  burstSaleCoins() {
    this.saleCelebration.burst(this.sellCenter);
  }

  /**
   * Al cerrar sesión: la siguiente cuenta empieza con la mochila vacía y sin la madera que
   * quedó en el suelo (si no, otra cuenta podría recogerla). No borra nada en Appwrite.
   */
  resetPlayerData() {
    this.backpack.clear();
    this.chopping?.wood.clear();
  }

  /** Botón "Cerrar" de la tienda (Fase 8). */
  closeShop() {
    this.session.closeShop();
  }

  /** Botón "Continuar" de la pausa (interacción del usuario: vuelve a capturar el cursor). */
  resume() {
    this.session.resume();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    requestAnimationFrame(this.loop);
  }

  /**
   * Ayuda de puntería: si hay un árbol al alcance dentro del arco frontal de hacia donde mira la
   * cámara, el personaje se gira exactamente hacia él. Devuelve su posición o null.
   */
  aimAssist() {
    this.camera.getWorldDirection(this.aimDirection);
    return this.chopping.findTarget(this.player.position, this.aimDirection)?.position ?? null;
  }

  // Bucle principal con requestAnimationFrame (se sincroniza con el refresco de pantalla)
  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), MAX_DELTA);

    // En pausa la simulación se congela: sin movimiento, sin tala ni daño, y los tiempos de
    // caída y regeneración se detienen. La escena se sigue dibujando.
    if (this.physics && !this.session.paused) {
      // 1. Entrada → velocidad del cuerpo  2. Física en pasos fijos  3. Cuerpo → modelo
      const held = this.session.attacking;
      this.player.setAttack(held, held ? this.aimAssist() : null);
      this.player.update(dt, this.camera);
      this.physics.world.step(FIXED_STEP, dt, 5);
      this.player.syncVisual(dt); // Aquí se detecta el impacto del hacha (onAttackImpact)
      this.chopping.update(dt, this.player.position); // Caídas, madera y regeneración
      // Recolección automática: los troncos cercanos pasan a la mochila (en pausa no se recoge)
      const collected = this.chopping.wood.collect(dt, this.player.position, this.backpack, () => this.onBackpackFull());
      if (collected > 0) this.onWoodCollected(collected);
      this.updateSellZone();
      this.saleCelebration.update(dt);
    }

    // Cámara: sigue al personaje, gira con el ratón y evita terreno, troncos y estructuras
    if (this.player.model) this.cameraRig.update(dt, this.player.position);

    // Los árboles con la cámara dentro de su copa se ocultan (si no, se ven "cortados")
    if (this.forest) this.forest.updateCameraOcclusion(this.camera.position);

    this.updateShadowArea(this.cameraRig.pivot);
    this.renderer.render(this.scene, this.camera);
  }
}
