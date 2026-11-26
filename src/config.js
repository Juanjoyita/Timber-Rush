// config.js — Datos del juego (solo datos, sin lógica).
// FASE 4: configuración del Bosque Verde. FASE 11A: los otros cuatro bosques.

// Modelos GLB compartidos por todos los bosques (se cargan una sola vez). Cada bosque los
// adapta con su tema (colores, nieve, tamaño) al construirse: ver forest.js (applyForestTheme).
const MODELS = {
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
};
const PROCEDURAL_TREES = {
  pines: ['proc_abeto', 'proc_pino_joven'],
  round: ['proc_alamo', 'proc_roble', 'proc_abedul'],
};

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
    models: MODELS,

    // Árboles Low Poly propios (geometría de Three.js, ver forest.js): más variedad de formas
    proceduralTrees: PROCEDURAL_TREES,

    colors: {
      sky: 0x9fd7f0, // Fondo y niebla del mismo color: el horizonte se funde con el cielo
      grass: 0x6dbb4b, // Hierba general
      meadow: 0x93cc5c, // Praderas más claras (manchas)
      forestFloor: 0x4f8f3a, // Suelo más oscuro bajo las arboledas
      hill: 0x5a9a48, // Elevaciones lejanas
      dirt: 0xb08850, // Caminos y campamento
    },
    // Luz del bosque (Fase 11A). El Verde conserva la de siempre.
    light: { sun: 0xfff0d0, sunIntensity: 2.4, ambient: 0xffffff, ambientIntensity: 0.75 },
    // Noche (Fase 11B): azul profundo
    night: { sky: 0x1c2b4b, ambient: 0x7d93d6, ambientIntensity: 0.5, moon: 0xc4d5ff, moonIntensity: 0.6 },
    theme: {}, // Sin cambios: los modelos con sus colores originales
  },

  // ---------- Fase 11A: cuatro bosques más ----------
  // Resistencia, madera, valor y desbloqueo: valores aprobados en la especificación inicial.
  // Misma lógica de juego; cambian la distribución, la vegetación, los colores, la luz, la niebla
  // y los elementos propios de cada bosque (theme.extras y theme.particles).
  {
    id: 2,
    name: 'Bosque Otoñal',
    resistance: 12,
    woodPerTree: 8,
    valuePerUnit: 4,
    unlockAt: 500,
    seed: 2024,
    treeCount: 1250,
    treeSpacing: 2.5,
    treeHeight: [0.8, 1.35],
    treeWidth: [0.95, 1.35], // Copas anchas y redondeadas
    groveCount: 26,
    baseDensity: 0.34,
    pineRatio: 0.22, // Sobre todo caducifolios
    rockCount: 26,
    decorativeTreeCount: 800,
    deadTreeRatio: 0.1,
    bushCount: 360,
    smallPlantCount: 1300,
    flowerRatio: 0.35, // Menos flores que en verano
    fallenLogCount: 26,
    fog: { near: 95, far: 320 },
    models: MODELS,
    proceduralTrees: { pines: PROCEDURAL_TREES.pines, round: [...PROCEDURAL_TREES.round, 'proc_arce', 'proc_arce'] }, // Arces
    terrain: { waves: 1.6, hills: { count: 16, height: [1.2, 2.4], radius: [8, 13] } }, // Lomas suaves
    // Elemento emblemático y sendas propias (Fase 11A, paso 2)
    landmark: { kind: 'leafLake', name: 'Lago de las hojas', x: 32, z: -28, radius: 7, clear: 12, plantClear: 8 },
    paths: [
      { points: [[3, 4], [12, -6], [21, -15], [26, -21]] }, // Al lago
      { points: [[3, 9], [18, 15], [32, 28], [48, 34]] },
      { points: [[1, 13], [-5, 28], [-18, 42], [-30, 50]] },
    ],
    colors: { sky: 0xf2cfa0, grass: 0xa59a45, meadow: 0xc7a24a, forestFloor: 0x87552c, hill: 0x9a8645, dirt: 0x9b6a3c },
    light: { sun: 0xffd29a, sunIntensity: 2.3, ambient: 0xffe4c4, ambientIntensity: 0.72 },
    night: { sky: 0x2e2244, ambient: 0xa286c4, ambientIntensity: 0.5, moon: 0xdcc8ff, moonIntensity: 0.55 }, // Violeta cálido
    theme: {
      foliage: [0xd9661f, 0xe8a531, 0xc23b22, 0xf0c13c, 0xb5501c, 0xe07a26], // Naranja, amarillo y rojo
      bushes: [0xb8471f, 0xd98a2b, 0x9c3a1d],
      grass: [0xb6a04a, 0xa88c3e, 0xc4ad55],
      extras: [{ kind: 'leafLitter', count: 900 }], // Manchas de hojas caídas
      particles: { kind: 'leaves', count: 260 }, // Hojas que caen
    },
  },
  {
    id: 3,
    name: 'Bosque Nevado',
    resistance: 25,
    woodPerTree: 12,
    valuePerUnit: 8,
    unlockAt: 2500,
    seed: 4242,
    treeCount: 1100,
    treeSpacing: 2.6,
    treeHeight: [0.95, 1.6], // Pinos altos y estrechos
    treeWidth: [0.8, 1.1],
    groveCount: 22,
    baseDensity: 0.32,
    pineRatio: 0.9,
    rockCount: 32,
    decorativeTreeCount: 800,
    deadTreeRatio: 0.14,
    bushCount: 120,
    smallPlantCount: 450, // Solo matas de hierba helada
    flowerRatio: 0, // Sin flores en invierno
    fallenLogCount: 18,
    fog: { near: 70, far: 380 }, // Aire frío; se adivinan las montañas nevadas
    models: MODELS,
    proceduralTrees: { pines: [...PROCEDURAL_TREES.pines, 'proc_abeto_nevado', 'proc_abeto_nevado'], round: PROCEDURAL_TREES.round }, // Abetos nevados
    // Colinas más altas y montañas nevadas en el horizonte
    terrain: { waves: 1.3, hills: { count: 12, height: [1.8, 3.2], radius: [9, 14] }, horizon: { count: 9, height: [45, 75], radius: [35, 50], distance: [240, 320] } },
    landmark: { kind: 'frozenLake', name: 'Lago helado', x: -34, z: 34, radius: 9, clear: 13, plantClear: 9.5 },
    paths: [
      { points: [[1, 13], [-8, 22], [-17, 27], [-23, 29]] }, // Al lago helado
      { points: [[3, 4], [16, -12], [28, -30], [34, -48]] },
      { points: [[3, 9], [22, 18], [40, 20], [52, 12]] },
    ],
    colors: { sky: 0xdce7f1, grass: 0xedf2f7, meadow: 0xfbfdff, forestFloor: 0xc6d3e0, hill: 0xe2eaf1, dirt: 0x9a9289 },
    light: { sun: 0xe9f1ff, sunIntensity: 2.0, ambient: 0xd8e6ff, ambientIntensity: 0.85 },
    night: { sky: 0x2c4064, ambient: 0xb4cbf2, ambientIntensity: 0.68, moon: 0xe2ecff, moonIntensity: 0.8 }, // La nieve refleja la luna
    theme: {
      foliage: [0x2f5d4a, 0x355f55, 0x2a5243], // Verde oscuro frío bajo la nieve
      bushes: [0x3d6656],
      grass: [0xb9c7c4, 0xa9bcb6],
      rock: 0x8d97a6, // Piedra fría
      snow: 0xf3f7fb, // Caras que miran hacia arriba: nieve
      extras: [{ kind: 'snowMounds', count: 170 }],
      particles: { kind: 'snow', count: 1400 },
    },
  },
  {
    id: 4,
    name: 'Bosque Místico',
    resistance: 50,
    woodPerTree: 18,
    valuePerUnit: 15,
    unlockAt: 10000,
    seed: 7777,
    treeCount: 1150,
    treeSpacing: 2.5,
    treeHeight: [0.9, 1.7],
    treeWidth: [0.85, 1.35],
    groveCount: 30,
    baseDensity: 0.36,
    pineRatio: 0.45,
    rockCount: 28,
    decorativeTreeCount: 800,
    deadTreeRatio: 0.16,
    bushCount: 300,
    smallPlantCount: 1400,
    flowerRatio: 1,
    fallenLogCount: 22,
    fog: { near: 45, far: 220 }, // Niebla de color lavanda
    models: MODELS,
    proceduralTrees: { pines: PROCEDURAL_TREES.pines, round: [...PROCEDURAL_TREES.round, 'proc_retorcido', 'proc_retorcido'] }, // Árboles retorcidos
    // Hondonadas donde se acumula la niebla y algún montículo
    terrain: { waves: 1.3, hollows: { count: 14, height: [-2.4, -1.3], radius: [7.5, 11] }, hills: { count: 6, height: [1, 2], radius: [5, 8] } },
    landmark: { kind: 'spiritTree', name: 'Árbol del alma', x: 36, z: 26, radius: 9, clear: 13, plantClear: 1.6 },
    paths: [
      { points: [[3, 9], [12, 14], [20, 19], [25, 21]] }, // Al árbol del alma
      { points: [[1, 13], [-6, 30], [-2, 50]] },
      { points: [[3, 4], [20, -8], [38, -12], [50, -24]] },
    ],
    colors: { sky: 0x7d6cb5, grass: 0x3f7a6c, meadow: 0x5b6ea3, forestFloor: 0x2b3d5b, hill: 0x4b5a8c, dirt: 0x6e5a7d },
    light: { sun: 0xd9c8ff, sunIntensity: 1.7, ambient: 0xb7a6ff, ambientIntensity: 0.8 },
    night: { sky: 0x170f31, ambient: 0x7562c4, ambientIntensity: 0.48, moon: 0xbcaaff, moonIntensity: 0.5 }, // Lo luminoso destaca
    theme: {
      foliage: [0x7b4fd1, 0x2fb6a6, 0xb04fc6, 0x3f8fd8, 0x5f3fb0, 0x27a39a],
      bushes: [0x6a44b8, 0x2a9c95, 0x9a49b8],
      grass: [0x3a9488, 0x4c7fb8, 0x5a63b0],
      bark: 0x4e3d58, // Corteza oscura violácea
      rock: 0x6a6f9e,
      flowers: [0xfff07a, 0x7af7ff, 0xff8ae8],
      extras: [{ kind: 'glowMushrooms', count: 260 }, { kind: 'crystals', count: 55 }],
      particles: { kind: 'fireflies', count: 320 },
    },
  },
  {
    id: 5,
    name: 'Bosque Ancestral',
    resistance: 100,
    woodPerTree: 25,
    valuePerUnit: 30,
    unlockAt: 50000,
    seed: 9001,
    treeCount: 500, // Árboles gigantes: menos, más separados y mucho más grandes
    treeSpacing: 3.8,
    treeHeight: [1.8, 2.7],
    treeWidth: [1.7, 2.4],
    groveCount: 22,
    baseDensity: 0.45,
    pineRatio: 0.5,
    rockCount: 38,
    rockScale: [1.1, 1.7], // Grandes peñascos cubiertos de musgo
    decorativeTreeCount: 650,
    decorativeScale: 1.8,
    deadTreeRatio: 0.08,
    bushCount: 380,
    bushScale: [0.9, 1.5],
    smallPlantCount: 1900,
    plantScale: [1.3, 2.1], // Helechos grandes
    flowerRatio: 0.2,
    fallenLogCount: 30,
    fallenLogScale: [1.3, 1.7], // Troncos caídos enormes
    fog: { near: 65, far: 320 },
    models: MODELS,
    proceduralTrees: { pines: [...PROCEDURAL_TREES.pines, 'proc_secuoya', 'proc_secuoya', 'proc_secuoya'], round: PROCEDURAL_TREES.round }, // Secuoyas
    // Terreno muy ondulado con grandes desniveles y colinas en el horizonte
    terrain: { waves: 1.6, hills: { count: 18, height: [1.8, 3.0], radius: [10, 16] }, horizon: { count: 7, height: [28, 45], radius: [40, 55], distance: [240, 310] } },
    landmark: { kind: 'elderTree', name: 'Árbol milenario', x: -30, z: 36, radius: 10, clear: 15, plantClear: 3.4 },
    paths: [
      { points: [[1, 13], [-8, 20], [-16, 25], [-19, 27]] }, // Al árbol milenario
      { points: [[3, 4], [14, -18], [18, -40], [10, -52]] },
      { points: [[3, 9], [26, 12], [42, 26], [50, 44]] },
    ],
    colors: { sky: 0xa8c49c, grass: 0x4c7a33, meadow: 0x5c8a3a, forestFloor: 0x2c4d24, hill: 0x47693a, dirt: 0x7a5a36 },
    light: { sun: 0xfff2c8, sunIntensity: 2.0, ambient: 0xcfe5b8, ambientIntensity: 0.7 },
    night: { sky: 0x0f2617, ambient: 0x6b9a6e, ambientIntensity: 0.48, moon: 0xd2ecc9, moonIntensity: 0.55 }, // Verdes profundos
    theme: {
      foliage: [0x2f6b2a, 0x3d7d2c, 0x2a5e30, 0x4a8433, 0x34703a],
      bushes: [0x3b7a2e, 0x2f6a34],
      grass: [0x3f7d34, 0x4f8e3a, 0x2f6a2c],
      bark: 0x6b3b26, // Corteza rojiza de los árboles antiguos
      rock: 0x7c8a6a, // Piedra con musgo
      extras: [{ kind: 'mushrooms', count: 220 }],
      particles: { kind: 'pollen', count: 300 },
    },
  },
];

/** Bosque por id (el Verde si el id no existe). */
export const forestById = (id) => FORESTS.find((f) => f.id === Number(id)) ?? FORESTS[0];

// ---------- Día y noche (Fase 11B) ----------
// Ciclo de 20 minutos de gameplay activo. t = segundos desde las 06:00 (ver gameClock.js).
export const DAY_NIGHT = {
  cycle: 1200, // s: ciclo completo
  dawn: 60, // Amanecer 06:00–07:00 (1 min)
  duskStart: 780, // Atardecer 19:00–20:00 (1 min) — el día dura 07:00–19:00 (12 min)
  nightStart: 840, // Noche 20:00–06:00 (6 min)
  lightHourSeconds: 60, // 1 h del juego = 60 s entre las 06:00 y las 20:00 (de noche, 36 s)
  startHour: 8, // Nueva partida: Día 1 a las 08:00
  saveDelay: 30000, // ms: el reloj se guarda como mucho cada 30 s (y con cualquier otra escritura)
  // Tonos del amanecer y del atardecer (se mezclan con los colores de cada bosque)
  dawnTint: { sky: 0xf4b48a, sun: 0xffb27a },
  duskTint: { sky: 0xe98a5f, sun: 0xff8f5a },
  fogNight: 0.82, // La niebla se acerca un poco de noche (más ambiente, nada de negro)
  campLights: { lantern: [6, 16], fire: 14 }, // Intensidad del farol (día, noche) y de la hoguera de noche
};

// Lugar para dormir: la vivienda de la aldea (Fase 11D, village.js). La E está en su puerta.

// ---------- Cofres y tesoros (Fase 11C) ----------
// 4 cofres por bosque y día del juego (se renuevan a las 06:00). Solo dan monedas de oro: suman
// a coins y a totalCoinsEarned (cuentan para desbloquear bosques). El aserradero NO multiplica.
export const CHESTS = {
  perDay: 4, // Huecos 0-1 comunes, 2 raro, 3 especial (legendario o raro)
  baseFactor: 15, // Base = precio de la madera del bosque × 15
  multipliers: { comun: 1, raro: 3, legendario: 8 },
  commonVariation: 0.2, // Común: ±20 % (determinista)
  legendaryChance: 0.25, // El especial es legendario el 25 % de los días
  candidates: 16, // Puntos posibles por bosque (cada día se eligen 4)
  candidateSpacing: 11, // m entre puntos posibles
  daySpacing: 15, // m mínimos entre los 4 cofres de un mismo día
  minFromSpawn: 20, // m al punto de inicio
  minFromCamp: 8, // m a la zona del aserradero y la tienda
  minFromPath: 3, // m al borde de los caminos
  reach: 1.7, // m al cofre para poder abrirlo (E)
  spawnGuard: 3.5, // Un cofre nuevo no aparece a menos de esto del Worker…
  revealDistance: 6, // …y aparece cuando se aleja más que esto
  sparkleDistance: 25, // m: los destellos solo se ven al acercarse
};

// Viajar entre bosques (Fase 11A): poste indicador del campamento (E). Viajar es gratis.
export const TRAVEL = {
  key: 'KeyE',
  post: { x: -4.5, z: 6.5 }, // Junto al punto de inicio, entre el camino y el aserradero
  radius: 2.4, // Distancia (m) para poder usarlo
};

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

// Apariencias del paquete Ultimate Modular Men; el Worker es la apariencia inicial gratuita.
export const CHARACTER_SKINS = [
  { id: 'adventurer', name: 'Aventurero', file: 'Adventurer.gltf', cost: 1500 },
  { id: 'beach', name: 'Playero', file: 'Beach.gltf', cost: 1000 },
  { id: 'casual', name: 'Casual', file: 'Casual_2.gltf', cost: 750 },
  { id: 'hoodie', name: 'Sudadera', file: 'Casual_Hoodie.gltf', cost: 900 },
  { id: 'farmer', name: 'Granjero', file: 'Farmer.gltf', cost: 500 },
  { id: 'king', name: 'Rey', file: 'King.gltf', cost: 4000 },
  { id: 'punk', name: 'Punk', file: 'Punk.gltf', cost: 2000 },
  { id: 'spacesuit', name: 'Traje espacial', file: 'Spacesuit.gltf', cost: 5000 },
  { id: 'suit', name: 'Traje formal', file: 'Suit.gltf', cost: 2500 },
  { id: 'swat', name: 'Táctico', file: 'Swat.gltf', cost: 3000 },
];

// ---------- Economía (Fase 7B: venta) ----------
// Precios de las mejoras (clave = nivel que se compra). Hacha y mochila: ×3 respecto a los
// iniciales (50/150 y 100/300) para que comprar sea más difícil (decisión del director,
// 14-11-2026). Aserradero y trabajadores: precios originales aprobados.
export const UPGRADES = {
  // Niveles 1..10 (Fase 11E): daño 1 / 2 / 4 / 6 / 9 / 13 / 18 / 24 / 32 / 40 (ver axes.js)
  axe: { name: 'Hacha', costs: { 2: 150, 3: 450, 4: 1500, 5: 4000, 6: 10000, 7: 25000, 8: 60000, 9: 140000, 10: 300000 } },
  backpack: { name: 'Mochila', costs: { 2: 300, 3: 900 } }, // Capacidad 20 → 40 → 80
  workers: { name: 'Trabajador', costs: { 1: 500, 2: 1000 } }, // 0..2 trabajadores
  sawmill: {
    name: 'Aserradero',
    costs: { 1: 2000, 2: 5000, 3: 10000, 4: 20000, 5: 40000, 6: 75000, 7: 125000, 8: 200000, 9: 350000, 10: 500000 },
  },
  // Vivienda y aldea (Fase 11D): 100 % COSMÉTICA. No da ninguna ventaja (ver village.js).
  home: {
    name: 'Vivienda',
    cosmetic: true,
    costs: { 1: 1500, 2: 5000, 3: 15000, 4: 40000, 5: 100000, 6: 250000 },
    stages: ['Tienda de campaña', 'Campamento acogedor', 'Cabaña con huerto', 'Cabaña con porche', 'Casa de dos plantas', 'Pequeña aldea', 'Aldea forestal'],
  },
};

// Tienda (Fase 8): se abre con B en cualquier lugar. Qué se puede comprar y en qué columna
// de la fila de progreso se guarda cada mejora. Trabajadores desde la Fase 9.
export const SHOP = {
  key: 'KeyB',
  purchasable: ['axe', 'backpack', 'workers', 'sawmill', 'home', ...CHARACTER_SKINS.map(({ id }) => `skin_${id}`)],
  // home se guarda dentro de resources (sin columna nueva en Appwrite)
  columns: {
    axe: 'axeLevel', backpack: 'backpackLevel', sawmill: 'sawmillLevel', workers: 'workers', home: 'home',
    ...Object.fromEntries(CHARACTER_SKINS.map(({ id }) => [`skin_${id}`, `skin_${id}`])),
  },
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
  woodForestId: 1, // Los trabajadores producen SIEMPRE madera del Bosque Verde (2 monedas), estés donde estés
  saveDelay: 30000, // ms: la producción se guarda como mucho cada 30 s (no en cada unidad)
  // Aserradero (variante moderada): cada nivel +10 % de ritmo por trabajador y, desde ciertos
  // niveles, cada ciclo entrega un LOTE de varias unidades (ritmo medio = 12 × (1 + 0,1·nivel)/min)
  productionBonusPerLevel: 0.1,
  batches: [
    { fromLevel: 9, size: 3 },
    { fromLevel: 4, size: 2 },
  ],
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
    // Golpe de trabajadores: se desvanece con la distancia y queda en silencio a 28 m.
    worker_chop: { files: ['axe_body_0.wav', 'axe_body_1.wav', 'axe_body_2.wav', 'axe_body_3.wav', 'axe_body_4.wav'], volume: 0.07, distanceModel: 'linear', refDistance: 4, maxDistance: 28, rolloffFactor: 1, cooldown: 0.08, maxConcurrent: 2, pitchVariation: 0.1 },
    ground_thud: { files: ['ground_thud_0.wav', 'ground_thud_1.wav', 'ground_thud_2.wav', 'ground_thud_3.wav', 'ground_thud_4.wav'], volume: 0.85, cooldown: 0.3, maxConcurrent: 2, pitchVariation: 0.08 },
    // Pasos del Worker (posicionales, en sus pies): una variante al azar por paso y ligera
    // variación de tono y de volumen (±15 %) para que no suenen repetitivos. Suaves: se oyen
    // sin destacar sobre el resto. Al correr suenan algo más fuertes.
    // Archivos recortados y nivelados con herramientas/procesar_pasos.mjs (Kenney, CC0).
    step_grass: { files: ['step_grass_0.wav', 'step_grass_1.wav', 'step_grass_2.wav', 'step_grass_3.wav', 'step_grass_4.wav'], volume: 0.05, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.08 },
    step_grass_run: { files: ['step_grass_0.wav', 'step_grass_1.wav', 'step_grass_2.wav', 'step_grass_3.wav', 'step_grass_4.wav'], volume: 0.2, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.08 },
    step_wood: { files: ['step_wood_0.wav', 'step_wood_1.wav', 'step_wood_2.wav', 'step_wood_3.wav', 'step_wood_4.wav'], volume: 0.06, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.06 },
    step_wood_run: { files: ['step_wood_0.wav', 'step_wood_1.wav', 'step_wood_2.wav', 'step_wood_3.wav', 'step_wood_4.wav'], volume: 0.21, volumeVariation: 0.15, cooldown: 0.12, maxConcurrent: 2, pitchVariation: 0.06 },
    // Venta confirmada (Fase 7B): sonidos de INTERFAZ (sin atenuación por distancia), ya
    // recortados y con la misma sonoridad (herramientas/procesar_audio_venta.mjs). Volúmenes
    // algo por debajo del hacha percibida a la distancia habitual de la cámara.
    sale_bonus: { file: 'sale_bonus.wav', ui: true, volume: 0.45 }, // Bonus Points (Liecio)
    sale_chime: { file: 'sale_chime.wav', ui: true, volume: 0.38 }, // Reward Chime (Universfield)
    sale_levelup: { file: 'sale_levelup.wav', ui: true, volume: 0.42 }, // Level Up 06 (Universfield)
    // Cofres (Fase 11C): compuestos con Kenney Impact Sounds (CC0) por herramientas/procesar_sonidos_cofre.mjs.
    // La apertura suena en el cofre (posicional); las monedas, como interfaz (siempre se oyen igual).
    chest_open: { file: 'chest_open.wav', volume: 0.9, cooldown: 0.2, maxConcurrent: 1, pitchVariation: 0.04 },
    chest_coins_small: { file: 'chest_coins_small.wav', ui: true, volume: 0.45 }, // Común
    chest_coins: { file: 'chest_coins.wav', ui: true, volume: 0.5 }, // Raro
    chest_treasure: { file: 'chest_treasure.wav', ui: true, volume: 0.55 }, // Legendario
    village_build: { file: 'village_build.wav', ui: true, volume: 0.5 }, // La aldea ha crecido (Fase 11D)
  },
};
