// config.js — Datos del juego (solo datos, sin lógica).
// FASE 4: configuración del Bosque Verde. Los otros cuatro bosques se añaden en la Fase 11.

export const FORESTS = [
  {
    id: 1,
    name: 'Bosque Verde',
    // Valores de juego (se usarán desde la Fase 6)
    resistance: 5,
    woodPerTree: 5,
    valuePerUnit: 2,
    unlockAt: 0, // Monedas históricas necesarias (el primero siempre está desbloqueado)

    // Distribución (determinista: misma semilla = mismo bosque)
    seed: 1337,
    treeCount: 1400, // Árboles talables (bosque muy frondoso; InstancedMesh por modelo)
    treeSpacing: 2.3, // Distancia mínima entre troncos (m): deja ≥ 1,5 m libres para caminar
    // Proporciones independientes: cada árbol tiene su propia altura y anchura
    treeHeight: [0.85, 1.5],
    treeWidth: [0.8, 1.2],
    groveCount: 30, // Núcleos de densidad (arboledas) dentro de la zona jugable
    baseDensity: 0.4, // Densidad fuera de las arboledas (0..1): casi no quedan zonas abiertas
    pineRatio: 0.6, // 60 % pinos, 40 % copa redonda
    rockCount: 24,
    decorativeTreeCount: 800, // Árboles decorativos fuera de la zona jugable (InstancedMesh)
    deadTreeRatio: 0.06, // Proporción de árboles secos en la franja exterior
    bushCount: 320,
    smallPlantCount: 1800, // Hierba + flores (InstancedMesh)
    fallenLogCount: 20, // Troncos caídos decorativos (con colisión)

    // Niebla muy sutil: empieza lejos y solo funde el horizonte con el cielo
    fog: { near: 110, far: 340 },

    // Modelos GLB (public/assets/models/<nombre>.glb) — Low-Poly Nature Starter Pack (CC0)
    models: {
      pines: ['nature_tree_pine_01', 'nature_tree_pine_02', 'nature_tree_pine_03'],
      roundTrees: ['nature_tree_deciduous_01', 'nature_tree_deciduous_02', 'nature_tree_deciduous_03'],
      rocks: [
        'nature_rock_01', 'nature_rock_02', 'nature_rock_03', 'nature_rock_04',
        'nature_rock_05', 'nature_rock_06', 'nature_rock_07', 'nature_rock_08',
      ],
      bushes: ['nature_bush_01', 'nature_bush_02', 'nature_bush_03', 'nature_bush_04', 'nature_bush_05', 'nature_bush_06'],
      grass: ['nature_grass_01', 'nature_grass_02', 'nature_grass_03', 'nature_grass_04', 'nature_grass_05', 'nature_grass_06'],
      flowers: ['nature_flower_01', 'nature_flower_02', 'nature_flower_03', 'nature_flower_04'],
      logs: ['nature_log_01', 'nature_log_02'],
      deadTrees: ['nature_tree_dead_01'],
      stumps: ['nature_stump_01', 'nature_stump_02'], // Tocón que queda al talar (Fase 6)
    },

    // Árboles Low Poly propios (geometría de Three.js, ver forest.js): más variedad de formas
    proceduralTrees: {
      pines: ['proc_abeto', 'proc_pino_joven'],
      round: ['proc_alamo', 'proc_roble', 'proc_abedul'],
    },

    colors: {
      sky: 0x9fd7f0, // Fondo y niebla del mismo color: el horizonte se funde con el cielo
      grass: 0x6dbb4b, // Hierba general
      meadow: 0x93cc5c, // Praderas más claras (manchas)
      forestFloor: 0x4f8f3a, // Suelo más oscuro bajo las arboledas
      hill: 0x5a9a48, // Elevaciones lejanas
      dirt: 0xb08850, // Caminos y campamento
    },
  },
];

// ---------- Tala (Fase 6) ----------
// Ataque con el hacha (del personaje): se puede golpear en cualquier momento, haya o no un
// objetivo. Quien recibe el golpe (por ahora solo los árboles) decide si le afecta.
export const ATTACK = {
  impactTime: 0.17, // Instante del golpe dentro de TreeChopping_Loop (s): la mano se frena en seco
  reach: 1.3, // Alcance (m) desde el centro del personaje hasta la superficie del objetivo
  halfAngle: Math.PI / 3, // Arco frontal: el objetivo debe estar a ±60° de hacia donde mira
};

// ---------- Mochila y recolección (Fase 7A) ----------
export const BACKPACK = {
  capacities: [20, 40, 80], // Unidades por nivel de mochila (1, 2, 3). Las mejoras: Fase 8
  pickupRadius: 1.2, // Distancia (m) entre el personaje y un tronco para recogerlo automáticamente
  pickupDuration: 0.25, // Duración (s) del vuelo del tronco hasta el personaje
  pickupHeight: 1.0, // Altura (m) sobre los pies a la que llegan los troncos
  fullNoticeCooldown: 2.5, // Tiempo mínimo (s) entre avisos de "mochila llena"
};

// ---------- Economía (Fase 7B: venta) ----------
// Precios de las mejoras (clave = nivel que se compra). Hacha y mochila: ×3 respecto a los
// iniciales (50/150 y 100/300) para que comprar sea más difícil (decisión del director,
// 14-11-2026). Aserradero y trabajadores: precios originales aprobados.
export const UPGRADES = {
  axe: { name: 'Hacha', costs: { 2: 150, 3: 450 } }, // Niveles 1..3 (daño 1 / 2 / 4)
  backpack: { name: 'Mochila', costs: { 2: 300, 3: 900 } }, // Capacidad 20 → 40 → 80
  workers: { name: 'Trabajador', costs: { 1: 500, 2: 1000 } }, // 0..2 trabajadores
  sawmill: {
    name: 'Aserradero',
    costs: { 1: 2000, 2: 5000, 3: 10000, 4: 20000, 5: 40000, 6: 75000, 7: 125000, 8: 200000, 9: 350000, 10: 500000 },
  },
};

// Tienda (Fase 8): se abre con B en cualquier lugar. Qué se puede comprar y en qué columna
// de la fila de progreso se guarda cada mejora. Trabajadores desde la Fase 9.
export const SHOP = {
  key: 'KeyB',
  purchasable: ['axe', 'backpack', 'workers', 'sawmill'],
  columns: { axe: 'axeLevel', backpack: 'backpackLevel', sawmill: 'sawmillLevel', workers: 'workers' },
};

export const ECONOMY = {
  sawmillBonusPerLevel: 0.25, // Cada nivel del aserradero: +25 % al valor de venta (máx. +250 %)
};

// Venta en la plataforma del aserradero (Fase 7B)
export const SALE = {
  key: 'KeyF',
  particleCount: 22, // Monedas doradas por venta (cantidad moderada)
  particleLife: [0.8, 1.4], // Duración de cada partícula (s)
  counterDuration: 0.9, // Animación del contador de monedas (s)
  // Secuencia de la celebración (segundos desde la confirmación de Appwrite):
  //   0,00 anuncio + monedas 3D + Bonus Points (Do mayor, 0,60 s) y conteo de "+N"
  //   0,45 Reward Chime (0,96 s) con los destellos, solapado solo con la cola de Bonus
  //   1,40 Level Up (Do menor) y brillo del nuevo saldo: entra cuando el Chime ya terminó
  //        (evita que su final en Re/Fa# choque con el Do menor de Level Up)
  //   2,60 salida del anuncio (0,4 s)
  timeline: { chime: 0.45, levelUp: 1.4, exit: 2.6, exitDuration: 0.4 },
  // Otra venta durante la celebración: el anuncio acumula el total; suenan Bonus Points y,
  // al terminar éste, Level Up (sin repetir el Chime) y la salida se retrasa.
  mergeTimeline: { levelUp: 0.6, exit: 1.8 },
};

// ---------- Trabajadores (Fase 9) ----------
// Producen madera del bosque actual en el almacén del aserradero, separado de la mochila, y
// SOLO mientras se juega (sin pausa ni tienda abierta). F en la plataforma vende también el almacén.
export const WORKERS = {
  interval: 5, // Segundos para que UN trabajador produzca una unidad de madera
  storageCapacity: 100, // Unidades máximas en el almacén (al llenarse, dejan de producir)
  saveDelay: 30000, // ms: la producción se guarda como mucho cada 30 s (no en cada unidad)
};

// Árboles: resistencia, caída, madera y regeneración
export const CHOPPING = {
  regrowTime: 25, // Segundos desde el último golpe hasta que el árbol vuelve a crecer
  growDuration: 0.8, // Animación de crecimiento (s)
  fallDuration: 1.6, // Caída del árbol hasta tocar el suelo (s)
  settleTime: 0.6, // Tiempo tumbado antes de convertirse en troncos (s)
  fallAngle: 1.48, // Ángulo final de la caída (rad, ≈85°: la copa queda apoyada en el suelo)
  regrowClearance: 0.6, // Distancia extra libre alrededor del tocón para poder regenerarse (m)
  maxVisibleLogs: 400, // Límite de seguridad de troncos dibujados (la madera nunca se pierde)
  logScale: 0.6, // Tamaño de los troncos de madera respecto al modelo (≈1,1 m de largo)
};

// ---------- Audio (Fase 6) ----------
// Archivos en public/assets/audio/ (WAV mono 22 kHz, ver CREDITOS.md). Cada sonido indica
// su archivo (file) o varias variantes (files, se elige una al azar en cada reproducción) y,
// si usa solo un tramo, el inicio (offset) y la duración en segundos.
export const AUDIO = {
  masterVolume: 0.8,
  poolSize: 8, // Fuentes de sonido reutilizables (no una por árbol)
  refDistance: 6, // A esta distancia el sonido se oye a volumen completo (m)
  rolloffFactor: 1.4, // Rapidez con la que se atenúa al alejarse
  maxDistance: 70,
  sounds: {
    // acha.mp3 tiene 0,40 s de silencio inicial: se empieza en el golpe
    axe_hit: { file: 'axe_hit.wav', offset: 0.4, volume: 0.7, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.06 },
    // Capa grave del hachazo (golpe de madera con cuerpo): suena junto a axe_hit
    axe_body: { files: ['axe_body_0.wav', 'axe_body_1.wav', 'axe_body_2.wav', 'axe_body_3.wav', 'axe_body_4.wav'], volume: 0.55, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.05 },
    wood_crack: { file: 'wood_crack.wav', volume: 0.9, cooldown: 0.5, maxConcurrent: 2 },
    // "arbol caido" contiene los crujidos de la caída y el choque final: se usan por separado
    tree_falling: { file: 'tree_fall.wav', offset: 0.12, duration: 1.4, volume: 0.9, cooldown: 0.5, maxConcurrent: 2 },
    tree_impact: { file: 'tree_fall.wav', offset: 1.58, duration: 1.05, volume: 1.0, cooldown: 0.3, maxConcurrent: 2 },
    // Capa grave del impacto (el tronco pesado golpea la tierra): suena junto a tree_impact
    // Hachazo de los trabajadores del aserradero: suave y posicional (se oye al acercarse)
    worker_chop: { files: ['axe_body_0.wav', 'axe_body_1.wav', 'axe_body_2.wav', 'axe_body_3.wav', 'axe_body_4.wav'], volume: 0.3, cooldown: 0.08, maxConcurrent: 2, pitchVariation: 0.1 },
    ground_thud: { files: ['ground_thud_0.wav', 'ground_thud_1.wav', 'ground_thud_2.wav', 'ground_thud_3.wav', 'ground_thud_4.wav'], volume: 0.85, cooldown: 0.3, maxConcurrent: 2, pitchVariation: 0.08 },
    // Pasos del Worker (posicionales, en sus pies): una variante al azar por paso y ligera
    // variación de tono y de volumen (±15 %) para que no suenen repetitivos. Suaves: se oyen
    // sin destacar sobre el resto. Al correr suenan algo más fuertes.
    // Archivos recortados y nivelados con herramientas/procesar_pasos.mjs (Kenney, CC0).
    step_grass: { files: ['step_grass_0.wav', 'step_grass_1.wav', 'step_grass_2.wav', 'step_grass_3.wav', 'step_grass_4.wav'], volume: 0.12, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.08 },
    step_grass_run: { files: ['step_grass_0.wav', 'step_grass_1.wav', 'step_grass_2.wav', 'step_grass_3.wav', 'step_grass_4.wav'], volume: 0.2, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.08 },
    step_wood: { files: ['step_wood_0.wav', 'step_wood_1.wav', 'step_wood_2.wav', 'step_wood_3.wav', 'step_wood_4.wav'], volume: 0.13, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.06 },
    step_wood_run: { files: ['step_wood_0.wav', 'step_wood_1.wav', 'step_wood_2.wav', 'step_wood_3.wav', 'step_wood_4.wav'], volume: 0.21, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.06 },
    // Venta confirmada (Fase 7B): sonidos de INTERFAZ (sin atenuación por distancia), ya
    // recortados y con la misma sonoridad (herramientas/procesar_audio_venta.mjs). Volúmenes
    // algo por debajo del hacha percibida a la distancia habitual de la cámara.
    sale_bonus: { file: 'sale_bonus.wav', ui: true, volume: 0.45 }, // Bonus Points (Liecio)
    sale_chime: { file: 'sale_chime.wav', ui: true, volume: 0.38 }, // Reward Chime (Universfield)
    sale_levelup: { file: 'sale_levelup.wav', ui: true, volume: 0.42 }, // Level Up 06 (Universfield)
  },
};
