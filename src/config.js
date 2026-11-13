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
    treeCount: 120, // Árboles talables (mallas individuales)
    treeSpacing: 2.8, // Distancia mínima entre troncos (m): deja ≥ 2 m libres para caminar
    groveCount: 12, // Núcleos de densidad (arboledas) dentro de la zona jugable
    pineRatio: 0.6, // 60 % pinos, 40 % copa redonda
    rockCount: 16,
    decorativeTreeCount: 140, // Árboles decorativos fuera de la zona jugable (InstancedMesh)
    bushCount: 28,
    smallPlantCount: 180, // Hierba + flores (InstancedMesh)

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
      bushes: ['nature_bush_01', 'nature_bush_02', 'nature_bush_03'],
      grass: ['nature_grass_01', 'nature_grass_02', 'nature_grass_03'],
      flowers: ['nature_flower_01', 'nature_flower_02', 'nature_flower_03', 'nature_flower_04'],
      logs: ['nature_log_01', 'nature_log_02'],
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
