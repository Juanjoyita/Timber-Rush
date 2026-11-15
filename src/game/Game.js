// Game.js — Escena, renderer, cámara, luces y bucle principal.
// FASE 5: personaje con física (cannon-es) y cámara en tercera persona.
// FASE 6: ataque con el hacha (clic izquierdo mantenido) que tala los árboles alcanzados,
//         sonidos posicionales y regeneración.
// FASE 7A: recolección automática de la madera del suelo y mochila.
// FASE 7B: venta con F en la plataforma del aserradero y celebración (solo tras confirmarla).
// FASE 9: trabajadores del aserradero: producen madera en el almacén mientras se juega.
// EVOLUCIÓN DEL ASERRADERO: cinco etapas visuales según el nivel comprado (sawmillStages.js) y
//          producción de los trabajadores según ese nivel (ritmo y lotes).
// FASE 11A: cinco bosques. Solo el bosque actual está construido; al viajar se guarda en memoria
//          el estado de su tala (árboles, tocones, temporizadores y madera del suelo) y se
//          reconstruye el destino (misma semilla = mismo bosque) restaurando el suyo.
// FASE 11B: ciclo de día y noche (20 min de juego activo), reloj global, luna, estrellas, luces
//          cálidas en el campamento y dormir en la tienda (E, solo de noche).
// FASE 10: menú principal cinematográfico (órbita sobre el bosque) y transiciones con la
//          cámara en tercera persona. En el menú NO se simula nada del gameplay.
//         Cámara en tercera persona con el ratón (Pointer Lock) y pausa con ESC.
import * as THREE from 'three';
import { CHESTS, DAY_NIGHT, forestById, FORESTS, SALE } from '../config.js';
import { createForest, heightAt, loadForestModels, SAWMILL_AREAS, surfaceAt, WORLD } from './forest.js';
import { createPhysics, FIXED_STEP, PLAYER_RADIUS } from './physics.js';
import { Player } from './Player.js';
import { ChoppingSystem } from './chopping.js';
import { AudioManager } from './audio.js';
import { CameraObstacles, ThirdPersonCamera } from './ThirdPersonCamera.js';
import { PlaySession } from './session.js';
import { Backpack } from './backpack.js';
import { SaleCelebration } from './saleEffects.js';
import { WorkerCrew, WorkerProduction } from './workers.js';
import { MenuCamera } from './menuCamera.js';
import { clampLevel, loadSawmillModels, SawmillStages } from './sawmillStages.js';
import { ForestAmbience } from './forestAmbience.js';
import { GameClock, START_CLOCK } from './gameClock.js';
import { lightingAt, NightSky } from './dayNight.js';
import { ChestField } from './chests.js';

// Sombras: el área cubre solo los alrededores del personaje. Así un mapa de
// 2048 px da sombras nítidas y el pase de sombras solo dibuja los objetos cercanos.
const SHADOW_HALF = 32; // Área de sombras: 64 × 64 m
const SHADOW_MAP = 2048;
const SUN_DISTANCE = 60; // Distancia del sol/luna al centro de las sombras (m)
const REST_REACH = 1.2; // Distancia (m) a la tienda para poder dormir

// Cámara en tercera persona: ver ThirdPersonCamera.js (encuadre, sensibilidad, zoom y límites)
const CAMERA_FOV = 65;
const MAX_DELTA = 0.1; // Si la pestaña estuvo oculta, no se simula un salto de tiempo enorme

// Viaje entre bosques (Fase 11A): la cámara sube entre nubes (niebla densa del color del cielo),
// el bosque cambia oculto por ellas y la cámara baja hasta el Worker en el bosque nuevo.
export const TRAVEL_FX = {
  up: 1.2, // s subiendo mientras se cierran las nubes
  hold: 0.9, // s mínimos entre nubes (el color pasa al del bosque destino; aquí se construye)
  down: 1.6, // s bajando mientras se abren
  rise: 24, // m que sube la cámara
  cloud: { near: 0.5, far: 11 }, // Niebla "dentro de las nubes"
};
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10); // Aceleración y frenada suaves

export class Game {
  constructor(container) {
    this.container = container;
    const forestConfig = FORESTS[0]; // Bosque Verde (el del perfil se aplica con setForest)
    this.forestConfig = forestConfig;
    this.forestId = forestConfig.id;
    this.targetForestId = forestConfig.id; // Bosque pedido (puede llegar antes que los modelos)
    this.forestStates = new Map(); // id → estado de la tala de los bosques NO construidos (memoria)
    this.forestTask = Promise.resolve(); // Cambios de bosque, uno detrás de otro
    this.ambience = null; // Partículas del bosque actual

    // ---------- Día y noche (Fase 11B) ----------
    // El reloj es global (los cinco bosques) y solo avanza con la partida activa. main.js lo
    // coloca con el progreso guardado (setClock) y recibe la hora para guardarla (onClockChange).
    this.clock = new GameClock(START_CLOCK);
    this.lighting = null; // Valores de luz de la hora actual (lightingAt)
    this.onClockChange = () => {}; // (estado { d, t }) => void — como mucho una vez por segundo
    this.onClockDisplay = () => {}; // (texto "Día 7 — 21:30", esDeNoche) => void — al cambiar
    this.onRestPromptChange = () => {}; // (null | 'night' | 'day') junto a la tienda
    this.onSleepRequest = () => {}; // E junto a la tienda de noche: main.js guarda y amanece
    this.onRestDenied = () => {}; // E junto a la tienda de día
    this.nearRest = false;
    this.restPrompt = null;
    this.clockSyncTime = 0;
    this.clockText = '';

    // ---------- Cofres (Fase 11C) ----------
    // main.js indica qué cofres están abiertos hoy (chestsOpened, de lo guardado en Appwrite) y
    // abre/cobra con onChestRequest. Aquí solo se dibujan, se animan y se detectan con E.
    this.chestField = null;
    this.chestsOpened = () => 0; // (bosque, día) => máscara de huecos abiertos
    this.onChestPromptChange = () => {}; // (null | 'closed' | 'opened')
    this.onChestRequest = () => {}; // ({ forestId, slot, day, kind, position }) => void
    this.chestPrompt = null;
    this.clock.onNewDay(() => this.refreshChests()); // A las 06:00: los cofres del nuevo día

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
    // Cámara del menú principal: órbita alrededor del aserradero (Fase 10)
    this.menuCamera = new MenuCamera(this.camera, WORLD.sawmill);
    this.enterPose = { position: new THREE.Vector3(), target: new THREE.Vector3() }; // Reutilizable

    this.createLights();
    this.nightSky = new NightSky(this.scene); // Luna y estrellas (solo de noche)

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

    // ---------- Trabajadores (Fase 9) ----------
    // main.js indica cuántos hay (setWorkerCount) y cuánto cabe en el almacén (storageFree), y
    // recibe lo producido con onWorkersProduce(unidades). Solo producen jugando (sin pausa).
    this.production = new WorkerProduction();
    this.workerCount = 0;
    this.sawmillLevel = 0; // Nivel CONFIRMADO del aserradero (main.js lo fija con setSawmillLevel)
    this.sawmillStages = null; // Construcciones de cada etapa (se crean al cargar los modelos)
    this.storageFree = () => 0;
    this.onWorkersProduce = () => {};
    this.crew = null; // Se crea cuando el modelo del Worker está cargado
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
    // Viajar (Fase 11A): aviso junto al poste, panel abierto/cerrado
    this.onTravelPostChange = () => {};
    this.onTravelChange = () => {};
    this.nearTravelPost = false;
    this.session = new PlaySession(this.cameraRig, this.player, {
      onPauseChange: (paused) => this.onPauseChange(paused),
      onLockHint: (show) => this.onLockHint(show),
      onShopChange: (open) => this.onShopChange(open),
      onTravelChange: (open) => this.onTravelChange(open),
      onInteract: () => this.interact(),
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

    this.ready = this.load();

    // Reloj para calcular el tiempo entre fotogramas (delta)
    this.frameClock = new THREE.Clock(); // Tiempo entre fotogramas (el reloj del juego es this.clock)

    // Ajustar cámara y renderer cuando cambia el tamaño de la ventana
    window.addEventListener('resize', () => this.onResize());

    // Guardamos el bucle enlazado una sola vez (evita crear funciones en cada frame)
    this.loop = this.loop.bind(this);
  }

  createLights() {
    // AmbientLight: luz base uniforme para que las caras en sombra no queden negras.
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.75); // Color e intensidad: los del bosque
    this.scene.add(this.ambientLight);

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
    this.sunDirection = new THREE.Vector3(20, 30, 12).normalize(); // La de siempre hasta que se aplique la hora
  }

  /**
   * Mueve el sol (y su área de sombras) para centrarla en el punto indicado.
   * Se ajusta a múltiplos del tamaño de un píxel de sombra para evitar que los
   * bordes de las sombras "tiemblen", y solo se recalcula si el punto cambia.
   */
  updateShadowArea(point) {
    const texel = (SHADOW_HALF * 2) / this.sun.shadow.mapSize.x;
    const x = Math.round(point.x / texel) * texel;
    const z = Math.round(point.z / texel) * texel;
    if (x === this.shadowCenter.x && z === this.shadowCenter.y) return;
    this.shadowCenter.set(x, z);
    this.sun.target.position.set(x, 0, z);
    this.placeSun();
  }

  /** Sol o luna en la dirección de la hora actual (Fase 11B), alrededor del centro de sombras. */
  placeSun() {
    if (!Number.isFinite(this.shadowCenter.x)) return; // Aún sin centro de sombras (primer fotograma)
    const d = this.sunDirection;
    this.sun.position.set(this.shadowCenter.x + d.x * SUN_DISTANCE, d.y * SUN_DISTANCE, this.shadowCenter.y + d.z * SUN_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }

  async load() {
    const [geometries, sawmillGeometries] = await Promise.all([loadForestModels(this.forestConfig), loadSawmillModels(), this.player.load()]);
    // Modelos compartidos por los cinco bosques: se cargan una sola vez
    this.baseGeometries = geometries;
    this.sawmillGeometries = sawmillGeometries;
    this.player.equipAxe(this.axeLevel ?? 1); // Por si el perfil se cargó antes que el modelo

    // Ataque y tala separados: el personaje golpea (haya o no un árbol) y avisa de cada impacto;
    // el sistema de tala del bosque actual comprueba si alcanza a un árbol y le aplica el daño.
    this.player.onAttackImpact = (attack) => this.chopping?.receiveAttack(attack) ?? false;
    // Pasos: sonido posicional en los pies, según el suelo (hierba o madera del aserradero)
    // y más fuerte al correr. El ritmo lo marcan las animaciones Walk / Run.
    this.player.onFootstep = (step) => this.playFootstep(step);

    this.buildForest(forestById(this.targetForestId)); // El del perfil, si ya se conoce

    // Trabajadores visibles en sus puestos del cobertizo (mismos puestos en todos los bosques)
    this.crew = new WorkerCrew(this.scene, this.player, this.forest.workerSpots, (pos) => this.audio.play('worker_chop', pos));
    this.crew.setCount(this.workerCount);

    // Medición: tras unos fotogramas mostramos en consola el coste real de un fotograma
    // desde la vista actual (incluye el pase de sombras). Solo informativo.
    setTimeout(() => {
      const { calls, triangles } = this.renderer.info.render;
      console.info(`[Timber Rush] Draw calls: ${calls} · Triángulos: ${triangles}`);
    }, 1000);
  }

  // ---------- Bosques (Fase 11A) ----------

  /**
   * Construye un bosque: escenario, física, aserradero según su nivel, tala (con el estado que
   * tenía al salir de él, si ya se visitó), ambiente y luz. El personaje aparece en el inicio.
   */
  buildForest(config) {
    this.forestConfig = config;
    this.forestId = config.id;
    this.forest = createForest(config, this.baseGeometries);
    this.scene.add(this.forest.group);

    // Física: mundo con el terreno y los obstáculos del bosque + cuerpo del personaje
    this.physics = createPhysics(this.forest);
    const { x, z } = WORLD.spawn;
    // El personaje aparece mirando hacia la plataforma de venta
    const sell = SAWMILL_AREAS.sellZone;
    const yaw = Math.atan2((sell.minX + sell.maxX) / 2 - x, (sell.minZ + sell.maxZ) / 2 - z);
    this.player.attachBody(this.physics.createPlayerBody(x, z), yaw);
    this.spawnYaw = yaw; // Para volver al inicio en una partida nueva

    // Aserradero según su nivel: construcciones, colisiones y obstáculos de la cámara
    this.sawmillStages = new SawmillStages({
      geometries: this.sawmillGeometries,
      origin: WORLD.sawmill,
      material: this.forest.materials.nature,
      legacyTable: this.forest.sawmillLegacyTable,
      physics: this.physics,
      cameraBoxes: this.forest.cameraBoxes,
    });
    this.sawmillStages.setLevel(this.sawmillLevel);
    this.scene.add(this.sawmillStages.group);

    // Tala del bosque (resistencia, madera por árbol y precio de su madera: los de este bosque)
    this.chopping = new ChoppingSystem({
      forest: this.forest,
      forestConfig: config,
      scene: this.scene,
      onEvent: (event) => this.audio.handleChopEvent(event),
    });
    const saved = this.forestStates.get(config.id);
    if (saved) {
      this.chopping.restore(saved); // Árboles talados, tocones, temporizadores y madera del suelo
      this.forestStates.delete(config.id);
    }

    // Cámara: obstáculos (terreno, troncos y aserradero; no las hojas) y posición inicial detrás
    this.cameraRig.obstacles = new CameraObstacles({ trees: this.forest.trees, boxes: this.forest.cameraBoxes, heightAt });
    this.cameraRig.placeBehind(this.player.position, yaw);

    // Cofres del día en este bosque
    this.chestField = new ChestField({ forestId: config.id, spots: this.forest.chestSpots ?? [], material: this.forest.materials.nature, physics: this.physics });
    this.scene.add(this.chestField.group);
    this.refreshChests();

    this.applyForestLook(config, { lightsOnly: Boolean(this.travelFx) }); // Viajando: las nubes siguen tapando
    this.ambience = new ForestAmbience(config.theme?.particles ?? null, config.seed);
    if (this.ambience.points) this.scene.add(this.ambience.points);
    this.forest.setLogPile(this.storagePile ?? 0);
    this.inSellZone = false;
    this.nearTravelPost = false;
    this.shadowCenter.set(Infinity, Infinity);
  }

  /** Cielo, niebla y luces del bosque (sombras: las mismas, solo del sol). */
  applyForestLook(config, { lightsOnly = false } = {}) {
    // Fase 11B: la luz depende también de la hora (sin reloj, la de día de siempre)
    const L = this.clock ? (this.lighting = lightingAt(config, this.clock.time, this.lighting ?? undefined)) : null;
    const light = config.light ?? FORESTS[0].light;
    this.sun.color.set(L ? L.sunColor : light.sun);
    this.sun.intensity = L ? L.sunIntensity : light.sunIntensity;
    this.ambientLight.color.set(L ? L.ambientColor : light.ambient);
    this.ambientLight.intensity = L ? L.ambientIntensity : light.ambientIntensity;
    if (L && this.sunDirection) this.sunDirection.copy(L.direction);
    if (lightsOnly) return;
    const sky = L ? L.sky : new THREE.Color(config.colors.sky);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = L ? L.fogNear : config.fog.near;
    this.scene.fog.far = L ? L.fogFar : config.fog.far;
    this.camera.far = config.fog.far + 20; // Lo que la niebla oculta no se dibuja
    this.camera.updateProjectionMatrix();
  }

  // ---------- Día y noche (Fase 11B) ----------

  /** Reloj guardado (al cargar, restaurar, reiniciar o tras dormir). No genera nada. */
  setClock(state) {
    const day = this.clock.day;
    this.clock.set(state);
    this.clockText = '';
    if (this.clock.day !== day || !this.chestField?.day) this.refreshChests(); // Otro día: otros cofres
    this.updateDayNight(0);
  }

  // ---------- Cofres (Fase 11C) ----------

  /** Cofres del día actual en el bosque actual (con los ya abiertos hoy, según lo guardado). */
  refreshChests() {
    if (!this.chestField || !this.clock) return;
    const day = this.clock.day;
    this.chestField.setDay(day, this.chestsOpened?.(this.forestId, day) ?? 0, this.player.body ? this.player.position : null);
  }

  /** E en un cofre: la tapa se abre ya (con su sonido); el saldo espera a la confirmación. */
  setChestPending(slot, pending) {
    this.chestField?.setPending(slot, pending);
    const c = pending ? this.chestField?.today.find((x) => x.slot === slot) : null;
    if (c) this.audio?.play('chest_open', new THREE.Vector3(c.spot.x, c.spot.y + 0.5, c.spot.z));
  }

  /** Monedas 3D saltando del cofre (solo visual): más ráfagas cuanto más raro. */
  chestBurst(slot, kind) {
    const c = this.chestField?.today.find((x) => x.slot === slot);
    if (!c) return;
    const origin = new THREE.Vector3(c.spot.x, c.spot.y + 0.6, c.spot.z);
    const bursts = { comun: 1, raro: 2, legendario: 4 }[kind] ?? 1;
    for (let i = 0; i < bursts; i++) setTimeout(() => this.saleCelebration.burst(origin), i * 180);
  }

  /** No se pudo guardar: la tapa se cierra y el cofre sigue disponible. */
  chestFailed(slot) {
    this.chestField?.revert(slot);
  }

  /**
   * Cofre abierto y cobrado (confirmado): se abre la tapa y saltan monedas. Solo visual.
   * @param chest { forestId, day, slot, kind, opened (máscara) }
   */
  chestOpened(chest, { celebrate = true } = {}) {
    const field = this.chestField;
    if (!field || chest.forestId !== this.forestId || chest.day !== field.day) return;
    field.setOpened(chest.opened);
    if (celebrate) this.chestBurst(chest.slot, chest.kind); // Si ya se celebró al abrir, no se repite
  }

  /**
   * Luz de la hora actual en el bosque actual: cielo, niebla, sol/luna, ambiente, estrellas,
   * farol, hoguera y ventanas. Cada fotograma (también en el menú, con el reloj parado). Barato:
   * solo mezclas de colores; nunca se añaden ni quitan luces.
   */
  updateDayNight(dt) {
    if (!this.forest || !this.clock) return;
    const L = (this.lighting = lightingAt(this.forestConfig, this.clock.time, this.lighting ?? undefined));
    if (!this.travelFx) {
      this.scene.background.copy(L.sky);
      this.scene.fog.color.copy(L.sky);
      this.scene.fog.near = L.fogNear;
      this.scene.fog.far = L.fogFar;
    }
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sunIntensity;
    this.ambientLight.color.copy(L.ambientColor);
    this.ambientLight.intensity = L.ambientIntensity;
    this.sunDirection.copy(L.direction);
    this.placeSun();
    this.nightSky?.update(this.camera, L);
    const [lanternDay, lanternNight] = DAY_NIGHT.campLights.lantern;
    if (this.forest.lanternLight) this.forest.lanternLight.intensity = lanternDay + (lanternNight - lanternDay) * L.night;
    this.forest.restSpot?.update(dt, L.night, DAY_NIGHT.campLights.fire);
    this.sawmillStages?.setWindowGlow(L.night);
    const text = this.clock.format();
    const night = this.clock.isNight;
    if (text !== this.clockText || night !== this.clockNight) {
      this.clockText = text;
      this.clockNight = night;
      this.onClockDisplay(text, night);
    }
  }

  /** Distancia (XZ) del Worker a la tienda (a su caja). */
  restDistance() {
    const r = this.forest?.restSpot?.collider;
    if (!r) return Infinity;
    const p = this.player.position;
    return Math.hypot(Math.max(Math.abs(p.x - r.x) - r.hx, 0), Math.max(Math.abs(p.z - r.z) - r.hz, 0));
  }

  /**
   * Interacciones con E (poste de viaje y tienda): se muestra UN solo aviso, el del más cercano,
   * y E usa exactamente ese. Junto a la tienda: de noche se puede dormir; de día, solo se informa.
   */
  updateInteractions() {
    const p = this.player.position;
    const post = this.forest?.travelPost;
    const dPost = post ? Math.hypot(p.x - post.x, p.z - post.z) - post.radius : Infinity;
    const dRest = this.clock ? this.restDistance() - REST_REACH : Infinity;
    const near = this.chestField?.nearest(p);
    const dChest = near ? near.distance - CHESTS.reach : Infinity;
    this.nearTravelPost = dPost <= 0;
    this.nearRest = dRest <= 0;
    this.nearChest = dChest <= 0 ? near.chest : null;
    // La interacción disponible más cercana
    const options = [['travel', dPost], ['rest', dRest], ['chest', dChest]].filter(([, d]) => d <= 0).sort((a, b) => a[1] - b[1]);
    const target = options[0]?.[0] ?? null;
    this.interactionTarget = target;
    const chestState = target === 'chest' ? (this.nearChest.opened ? 'opened' : 'closed') : null;
    if (chestState !== this.chestPrompt) {
      this.chestPrompt = chestState;
      this.onChestPromptChange?.(chestState);
    }
    const travelOn = target === 'travel';
    if (travelOn !== Boolean(this.travelPromptOn)) {
      this.travelPromptOn = travelOn;
      this.onTravelPostChange(travelOn);
    }
    const rest = target === 'rest' ? (this.clock.isNight ? 'night' : 'day') : null;
    if (rest !== this.restPrompt) {
      this.restPrompt = rest;
      this.onRestPromptChange(rest);
    }
  }

  updateRestSpot() {
    this.updateInteractions();
  }

  /** E junto a un cofre cerrado: main.js lo abre y lo cobra con Appwrite. */
  requestChest() {
    const c = this.nearChest;
    if (!this.session.active || !c || c.opened || c.pending) return false;
    this.onChestRequest({ forestId: this.forestId, slot: c.slot, day: this.chestField.day, kind: c.kind, position: { x: c.spot.x, y: c.spot.y, z: c.spot.z } });
    return true;
  }

  /** E junto a la tienda: de noche pide dormir (main.js lo guarda); de día se informa. */
  requestSleep() {
    if (!this.session.active || !this.nearRest) return false;
    if (!this.clock.isNight) {
      this.onRestDenied();
      return false;
    }
    this.onSleepRequest();
    return true;
  }

  /**
   * Sale del bosque actual: guarda en memoria el estado de su tala y libera su escenario,
   * física y partículas (los modelos compartidos se conservan).
   */
  teardownForest() {
    if (!this.forest) return;
    this.forestStates.set(this.forestId, this.chopping.snapshot());
    this.chopping.dispose();
    this.sawmillStages.dispose();
    this.chestField?.dispose();
    this.chestField = null;
    if (this.chestPrompt) this.onChestPromptChange?.(null);
    this.chestPrompt = null;
    this.ambience?.dispose();
    this.scene.remove(this.forest.group);
    this.forest.dispose();
    this.forest = this.physics = this.chopping = this.sawmillStages = this.ambience = null;
    if (this.travelPromptOn) this.onTravelPostChange(false);
    this.travelPromptOn = false;
    this.nearTravelPost = false;
    if (this.inSellZone) this.onSellZoneChange(false);
    if (this.restPrompt) this.onRestPromptChange(null);
    this.nearRest = false;
    this.restPrompt = null;
  }

  /**
   * Bosque CONFIRMADO (perfil cargado o viaje guardado en Appwrite). Los cambios se hacen de uno
   * en uno; si llegan varios seguidos, solo se construye el último. Devuelve una promesa que se
   * resuelve cuando el bosque está listo.
   */
  setForest(id) {
    const target = forestById(id).id;
    this.targetForestId = target;
    const task = this.forestTask.then(async () => {
      await this.ready;
      if (this.targetForestId !== target || (this.forest && this.forestId === target)) return;
      this.teardownForest();
      this.buildForest(forestById(target));
    });
    this.forestTask = task.catch((error) => console.error('[Timber Rush] No se pudo cambiar de bosque', error));
    return task;
  }

  /**
   * Viaje cinematográfico a otro bosque YA confirmado en Appwrite. La partida sigue congelada
   * (panel de viaje abierto) hasta que termina. onPeak: el bosque ya está oculto por las nubes
   * (main.js muestra el nombre del destino).
   * @returns promesa que se resuelve con la cámara de nuevo detrás del Worker
   */
  travelTo(id, { onPeak = () => {}, onClear = () => {} } = {}) {
    if (this.travelFx) return this.travelFx.promise;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const k = reduced ? 0.3 : 1;
    const start = { position: this.camera.position.clone(), target: this.cameraRig.pivot.clone() };
    const fx = {
      phase: 'up', t: 0, id, onPeak, onClear, cleared: false, built: false, error: null,
      up: TRAVEL_FX.up * k, hold: TRAVEL_FX.hold * k, down: TRAVEL_FX.down * k,
      from: start,
      to: { position: start.position.clone().add(new THREE.Vector3(0, TRAVEL_FX.rise, 0)), target: start.target.clone().add(new THREE.Vector3(0, TRAVEL_FX.rise * 0.6, 0)) },
      fog: { near: this.scene.fog.near, far: this.scene.fog.far },
      color0: this.scene.fog.color.clone(),
      end: lightingAt(forestById(id), this.clock?.time ?? 120), // Cielo y niebla del destino a esta hora
      color1: null,
      color: new THREE.Color(),
    };
    fx.color1 = fx.end.sky.clone();
    fx.promise = new Promise((resolve, reject) => {
      fx.resolve = resolve;
      fx.reject = reject;
    });
    this.travelFx = fx;
    this.placeCloudPuffs(fx.from, fx.to);
    return fx.promise;
  }

  /**
   * Nubes que la cámara atraviesa al viajar: bocanadas blancas (1 InstancedMesh) repartidas a lo
   * largo del recorrido. No les afecta la niebla: se ven sobre el color del cielo.
   */
  placeCloudPuffs(from, to) {
    if (!this.cloudPuffs) {
      const count = 46;
      this.cloudPuffs = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }),
        count
      );
      this.cloudPuffs.name = 'nubes-viaje';
      this.cloudPuffs.frustumCulled = false;
      this.cloudPuffs.renderOrder = 2;
      this.cloudPuffs.userData.seeds = Array.from({ length: count }, (_, i) => [Math.sin(i * 12.9898) * 0.5 + 0.5, Math.sin(i * 78.233) * 0.5 + 0.5, Math.sin(i * 39.425) * 0.5 + 0.5]);
      this.scene.add(this.cloudPuffs);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    this.cloudPuffs.userData.seeds.forEach(([a, b, c], i) => {
      const along = 0.25 + 0.75 * b; // Sobre todo en la parte alta del recorrido
      p.lerpVectors(from.position, to.position, along);
      const angle = a * Math.PI * 2, radius = 2.5 + c * 11;
      p.x += Math.cos(angle) * radius;
      p.z += Math.sin(angle) * radius;
      p.y += (c - 0.5) * 4;
      const size = 1.6 + 3.2 * ((a + c) % 1);
      this.cloudPuffs.setMatrixAt(i, m.compose(p, q, sc.set(size * 1.4, size * 0.7, size)));
    });
    this.cloudPuffs.instanceMatrix.needsUpdate = true;
    this.cloudPuffs.visible = true;
  }

  /** Opacidad de las nubes del viaje (0 = ocultas). */
  setCloudOpacity(value) {
    if (!this.cloudPuffs) return;
    this.cloudPuffs.material.opacity = value;
    this.cloudPuffs.visible = value > 0.001;
  }

  /** Coloca la cámara entre dos poses y la niebla entre dos densidades (k = 0..1). */
  travelPose(from, to, k, fogFrom, fogTo, color) {
    this.camera.position.lerpVectors(from.position, to.position, k);
    this._travelTarget = (this._travelTarget ?? new THREE.Vector3()).lerpVectors(from.target, to.target, k);
    this.camera.lookAt(this._travelTarget);
    this.scene.fog.near = fogFrom.near + (fogTo.near - fogFrom.near) * k;
    this.scene.fog.far = fogFrom.far + (fogTo.far - fogFrom.far) * k;
    this.scene.fog.color.copy(color);
    this.scene.background.copy(color);
  }

  updateTravelFx(dt) {
    const fx = this.travelFx;
    fx.t += dt;
    if (fx.phase === 'up') {
      const k = ease(Math.min(1, fx.t / fx.up));
      this.travelPose(fx.from, fx.to, k, fx.fog, TRAVEL_FX.cloud, fx.color0);
      this.setCloudOpacity(0.9 * Math.min(1, (fx.t / fx.up) * 1.6));
      if (fx.t >= fx.up) {
        fx.phase = 'clouds';
        fx.t = 0;
        // Oculto por las nubes: se cambia de bosque (se construye en segundo plano)
        this.setForest(fx.id).then(
          () => (fx.built = true),
          (error) => {
            fx.error = error;
            fx.built = true;
          }
        );
        fx.onPeak();
      }
    } else if (fx.phase === 'clouds') {
      const k = ease(Math.min(1, fx.t / fx.hold));
      this.travelPose(fx.to, fx.to, 1, TRAVEL_FX.cloud, TRAVEL_FX.cloud, fx.color.lerpColors(fx.color0, fx.color1, k));
      if (fx.built && fx.t >= fx.hold) {
        if (fx.error) {
          this.setCloudOpacity(0);
          this.travelFx = null;
          this.applyForestLook(this.forestConfig);
          fx.reject(fx.error);
          return;
        }
        // Bajada: desde lo alto del campamento nuevo hasta detrás del Worker
        const end = this.cameraRig.targetPose(this.player.position, { position: new THREE.Vector3(), target: new THREE.Vector3() });
        fx.downFrom = { position: end.position.clone().add(new THREE.Vector3(0, TRAVEL_FX.rise, 0)), target: end.target.clone().add(new THREE.Vector3(0, TRAVEL_FX.rise * 0.6, 0)) };
        fx.downTo = { position: end.position, target: end.target };
        this.placeCloudPuffs(fx.downTo, fx.downFrom); // Nubes también al bajar
        fx.phase = 'down';
        fx.t = 0;
      }
    } else {
      const k = ease(Math.min(1, fx.t / fx.down));
      this.travelPose(fx.downFrom, fx.downTo, k, TRAVEL_FX.cloud, { near: fx.end.fogNear, far: fx.end.fogFar }, fx.color1);
      this.setCloudOpacity(0.9 * Math.max(0, 1 - (fx.t / fx.down) * 1.4));
      if (!fx.cleared && fx.t >= fx.down * 0.4) {
        fx.cleared = true;
        fx.onClear(); // Las nubes se abren: el rótulo se retira y se ve el bosque
      }
      if (fx.t >= fx.down) {
        this.setCloudOpacity(0);
        this.travelFx = null;
        this.applyForestLook(this.forestConfig); // Valores exactos del bosque nuevo
        this.cameraRig.snapTo(this.player.position);
        fx.resolve();
      }
    }
  }

  /** E durante la partida: junto al poste abre el panel de bosques. */
  interact() {
    if (!this.session.active) return false;
    this.updateInteractions(); // Poste y tienda comparten la E: se usa el del aviso visible
    if (this.interactionTarget === 'rest') return this.requestSleep();
    if (this.interactionTarget === 'chest') return this.requestChest();
    if (this.interactionTarget === 'travel') return this.session.openTravel();
    return false;
  }

  /** Aviso "E · Viajar" al acercarse al poste del campamento. */
  updateTravelPost() {
    if (!this.forest?.travelPost) return;
    this.updateInteractions();
  }

  // ---------- Menú ↔ partida (Fase 10) ----------

  /**
   * "Continuar": empieza la entrada. Llamar DENTRO del clic (pide el cursor ahora). La cámara
   * sigue en el menú hasta que se llame a startEnterTransition (tras comprobar el progreso).
   */
  beginEnter() {
    return this.session.beginEnter();
  }

  /** La comprobación del progreso falló: se queda en el menú. */
  cancelEnter() {
    this.session.cancelEnter();
  }

  /** Transición de la órbita a la cámara en tercera persona; al terminar, control del Worker. */
  startEnterTransition(onDone = () => {}) {
    this.cameraRig.placeBehind(this.player.position, this.player.yaw);
    this.menuCamera.startTransition(
      () => this.cameraRig.targetPose(this.player.position, this.enterPose),
      () => {
        this.cameraRig.snapTo(this.player.position); // Sin salto en el primer fotograma de juego
        this.session.finishEnter();
        onDone();
      }
    );
  }

  /** Volver al menú: se detiene la partida, se libera el cursor y la cámara vuelve a la órbita. */
  leaveToMenu(onDone = () => {}) {
    if (!this.session.beginLeave()) return false;
    this.menuCamera.returnToOrbit(this.cameraRig.pivot, () => {
      this.session.finishLeave();
      onDone();
    });
    return true;
  }

  /**
   * Mundo como al empezar (nueva partida o cambio de cuenta): bosque intacto, sin madera en el
   * suelo y el Worker en el punto de inicio. No toca Appwrite.
   */
  resetWorld() {
    this.chopping?.resetAll();
    this.forestStates.clear(); // Los demás bosques también vuelven a estar intactos
    this.production = new WorkerProduction();
    if (this.player.body) {
      const { x, z } = WORLD.spawn;
      const body = this.player.body;
      body.position.set(x, heightAt(x, z) + PLAYER_RADIUS + 0.02, z);
      body.velocity.set(0, 0, 0);
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      this.player.yaw = this.spawnYaw ?? 0;
      this.player.syncVisual(0);
      this.cameraRig.placeBehind(this.player.position, this.player.yaw);
    }
  }

  /** Configuración del navegador (settings.js): audio, ratón y calidad gráfica. */
  applySettings({ masterVolume, effectsVolume, sensitivity, quality }) {
    this.audio.setMasterVolume(masterVolume);
    this.audio.setEffectsVolume(effectsVolume);
    this.cameraRig.sensitivityScale = sensitivity;
    // Calidad: resolución (pixelRatio) y tamaño del mapa de sombras. Sin objetos nuevos.
    const ratio = quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    const size = quality === 'low' ? SHADOW_MAP / 2 : SHADOW_MAP;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); // Se vuelve a crear con el tamaño nuevo
      this.sun.shadow.map = null;
      this.shadowCenter.set(Infinity, Infinity);
    }
  }

  /** Hacha del nivel guardado o recién comprado (1..3): cambia el modelo y el daño. */
  setAxeLevel(level) {
    this.axeLevel = Math.min(3, Math.max(1, Math.floor(level) || 1));
    if (this.player.axeSocket) this.player.equipAxe(this.axeLevel);
  }

  /** Trabajadores contratados (0..2): los muestra en el aserradero y producen madera. */
  setWorkerCount(n) {
    this.workerCount = Math.max(0, Math.min(2, Math.floor(n) || 0));
    this.crew?.setCount(this.workerCount);
  }

  /**
   * Nivel del aserradero CONFIRMADO por Appwrite (al cargar el progreso o tras una compra):
   * muestra sus construcciones y ajusta el ritmo de los trabajadores. El progreso del ciclo en
   * curso se conserva (no se pierde ni se duplica madera).
   */
  setSawmillLevel(level) {
    this.sawmillLevel = clampLevel(level);
    this.sawmillStages?.setLevel(this.sawmillLevel);
  }

  /** Pila de troncos del almacén según lo almacenado (0..1). */
  setStoragePile(fraction) {
    this.storagePile = fraction; // Se vuelve a aplicar al construir otro bosque
    this.forest?.setLogPile(fraction);
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
    this.resetWorld(); // Bosque, madera del suelo y posición: nada de la cuenta anterior
    this.setWorkerCount(0);
    this.setSawmillLevel(0);
    this.setClock(START_CLOCK);
    this.setForest(1); // La siguiente cuenta empieza viendo el Bosque Verde hasta cargar el suyo
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
    const dt = Math.min(this.frameClock.getDelta(), MAX_DELTA);
    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Un fotograma sin dibujar (se prueba sin WebGL).
   * - Gameplay SOLO con la partida activa: ni en el menú, ni en las transiciones, ni en pausa,
   *   ni con la tienda abierta (sin movimiento, ataques, tala, recogida, producción ni
   *   regeneración).
   * - En el menú solo se mueven la cámara cinematográfica y, como decoración, la animación de
   *   los trabajadores (en silencio y sin producir).
   */
  tick(dt) {
    if (this.physics && this.session.active) this.updateGameplay(dt);
    else if (this.session.inMenu) {
      // Decoración del menú: trabajadores y máquinas en movimiento (sin producir ni sonar)
      this.crew?.update(dt, { silent: true });
      this.sawmillStages?.update(dt, this.player.body?.position ?? null);
      this.ambience?.update(dt, this.camera.position);
    }

    // Cámara: en la partida sigue al Worker; en el menú y en las transiciones, la del menú
    if (this.session.playing) {
      if (this.travelFx) this.updateTravelFx(dt); // Viaje entre bosques (cámara y nubes)
      else if (this.player.model) this.cameraRig.update(dt, this.player.position);
    } else {
      this.menuCamera.update(dt);
    }

    // Luz de la hora actual (Fase 11B)
    this.updateDayNight(dt);
    // Cofres: tapas, destellos y los que esperaban a que el Worker se alejara (Fase 11C)
    if (this.chestField && this.player.body) this.chestField.update(dt, this.player.position, this.lighting?.night ?? 0);

    // Los árboles con la cámara dentro de su copa se ocultan (si no, se ven "cortados")
    if (this.forest) this.forest.updateCameraOcclusion(this.camera.position);

    // Sombras alrededor del jugador en la partida; alrededor del aserradero en el menú
    this.updateShadowArea(this.session.playing ? this.cameraRig.pivot : this.menuCamera.focus);
  }

  /** Gameplay de un fotograma (solo con la partida activa). */
  updateGameplay(dt) {
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
    // Reloj (Fase 11B): solo avanza aquí, con la partida activa
    this.clock?.advance(dt);
    this.clockSyncTime += dt;
    if (this.clockSyncTime >= 1) {
      this.clockSyncTime = 0;
      this.onClockChange(this.clock.toJSON());
    }
    this.updateTravelPost(); // Avisos del poste y de la tienda (el más cercano)
    this.saleCelebration.update(dt);
    // Trabajadores: producen solo durante la partida activa
    const units = this.production.update(dt, this.workerCount, this.storageFree(), this.sawmillLevel);
    if (units > 0) this.onWorkersProduce(units);
    this.crew?.update(dt);
    // Máquinas del aserradero y partículas del bosque (solo visual)
    this.sawmillStages?.update(dt, this.player.body?.position ?? null);
    this.ambience?.update(dt, this.camera.position);
  }
}
