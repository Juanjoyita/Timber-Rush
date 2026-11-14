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
    treeCount: 300, // Árboles talables (mallas individuales)
    treeSpacing: 2.3, // Distancia mínima entre troncos (m): deja ≥ 1,5 m libres para caminar
    // Proporciones independientes: cada árbol tiene su propia altura y anchura
    treeHeight: [0.85, 1.5],
    treeWidth: [0.8, 1.2],
    groveCount: 16, // Núcleos de densidad (arboledas) dentro de la zona jugable
    pineRatio: 0.6, // 60 % pinos, 40 % copa redonda
    rockCount: 16,
    decorativeTreeCount: 360, // Árboles decorativos fuera de la zona jugable (InstancedMesh)
    deadTreeRatio: 0.06, // Proporción de árboles secos en la franja exterior
    bushCount: 90,
    smallPlantCount: 600, // Hierba + flores (InstancedMesh)
    fallenLogCount: 12, // Troncos caídos decorativos (con colisión)

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
    ground_thud: { files: ['ground_thud_0.wav', 'ground_thud_1.wav', 'ground_thud_2.wav', 'ground_thud_3.wav', 'ground_thud_4.wav'], volume: 0.85, cooldown: 0.3, maxConcurrent: 2, pitchVariation: 0.08 },
  },
};
