// economy.js — Cálculos económicos puros (Fase 7B). Sin DOM, sin Three.js y sin Appwrite.
//
// - Valor de venta: unidades × precio de su bosque de origen × bonificación del aserradero.
// - Siguiente mejora: la más barata que aún no se tiene, con los precios aprobados (config.js).
// - Tienda (Fase 8): ofertas de cada mejora (nivel actual, siguiente, precio y efecto).
// - Producción de los trabajadores según el nivel del aserradero (ritmo y lotes).
// Regla: los niveles solo cambian con una compra explícita confirmada (progressSync.buy).
import { BACKPACK, CHESTS, ECONOMY, FORESTS, SHOP, UPGRADES, WORKERS } from '../config.js';
import { RESOURCE } from './backpack.js';
import { AXE_LEVELS } from './axes.js';

/** Multiplicador de venta del aserradero: 1 + 0,25 × nivel (nivel 0..10 → ×1 .. ×3,5). */
export function sawmillMultiplier(level = 0) {
  const lvl = Math.min(10, Math.max(0, Math.floor(Number(level) || 0)));
  return 1 + ECONOMY.sawmillBonusPerLevel * lvl;
}

/**
 * Producción de los trabajadores según el nivel del aserradero (variante moderada).
 * - Ritmo por trabajador: (1 + 0,1·nivel) / intervalo unidades por segundo (12 → 24 por minuto).
 * - Lote: 1 unidad (niveles 0-3), 2 (4-8) o 3 (9-10) por ciclo.
 * - Ciclo de UN trabajador = lote / ritmo (5 s en el nivel 0; 7,5 s y 3 unidades en el 10).
 */
export function productionStats(level = 0, interval = WORKERS.interval) {
  const L = Math.max(0, Math.floor(Number(level)) || 0);
  const rate = (1 + (WORKERS.productionBonusPerLevel ?? 0) * L) / interval; // Unidades/s por trabajador
  const batch = (WORKERS.batches ?? []).find((b) => L >= b.fromLevel)?.size ?? 1;
  return { level: L, rate, batch, cycle: batch / rate, perMinute: rate * 60 };
}

// ---------- Cofres (Fase 11C) ----------

/** Número pseudoaleatorio 0..1 a partir de enteros (determinista: mismo cofre, mismo valor). */
export function hash01(...ints) {
  let h = 0x811c9dc5;
  for (const n of ints) {
    h ^= (n | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Tipo del cofre de un hueco (0-1 comunes, 2 raro, 3 especial: legendario el 25 % de los días). */
export function chestKind(forestId, day, slot) {
  if (slot < 2) return 'comun';
  if (slot === 2) return 'raro';
  return hash01(forestId, day, 3, 7) < CHESTS.legendaryChance ? 'legendario' : 'raro';
}

/**
 * Monedas de un cofre: base = precio de la madera del bosque × 15; común ×1 (±20 %), raro ×3,
 * legendario ×8. Entero y siempre el mismo para el mismo bosque, día y hueco (recargar o
 * reintentar no cambia nada). El aserradero NO se aplica: es una fuente de ingreso aparte.
 */
export function chestReward(forestId, day, slot) {
  const forest = FORESTS.find((f) => f.id === Number(forestId));
  if (!forest || !Number.isInteger(day) || day < 1 || !Number.isInteger(slot) || slot < 0 || slot >= CHESTS.perDay) return null;
  const kind = chestKind(forest.id, day, slot);
  const base = forest.valuePerUnit * CHESTS.baseFactor;
  const variation = kind === 'comun' ? 1 + (hash01(forest.id, day, slot, 11) * 2 - 1) * CHESTS.commonVariation : 1;
  return { kind, coins: Math.round(base * CHESTS.multipliers[kind] * variation) };
}

/** Monedas esperadas al día en un bosque si se encuentran sus 4 cofres. */
export function expectedChestCoinsPerDay(forestId) {
  const forest = FORESTS.find((f) => f.id === Number(forestId));
  const B = forest.valuePerUnit * CHESTS.baseFactor, m = CHESTS.multipliers, p = CHESTS.legendaryChance;
  return 2 * B * m.comun + B * m.raro + B * (p * m.legendario + (1 - p) * m.raro);
}

// ---------- Bosques (Fase 11A) ----------

/**
 * Bosques desbloqueados (1..5) con unas monedas HISTÓRICAS (totalCoinsEarned). Como el histórico
 * nunca baja al gastar, un desbloqueo es permanente. Viajar es gratis.
 */
export function unlockedForestCount(totalCoinsEarned = 0) {
  const total = Math.max(0, Number(totalCoinsEarned) || 0);
  return FORESTS.filter((f) => total >= f.unlockAt).length;
}

/**
 * Estado de cada bosque para el panel de viaje.
 * @returns [{ id, name, valuePerUnit, unlockAt, unlocked, current, missing }]
 */
export function forestList(totalCoinsEarned = 0, unlocked = 1, current = 1) {
  const total = Math.max(0, Number(totalCoinsEarned) || 0);
  return FORESTS.map((f) => {
    const isUnlocked = f.id <= unlocked || total >= f.unlockAt;
    return { id: f.id, name: f.name, valuePerUnit: f.valuePerUnit, unlockAt: f.unlockAt, unlocked: isUnlocked, current: f.id === current, missing: isUnlocked ? 0 : f.unlockAt - total };
  });
}

/**
 * Qué se puede vender de un contenido { wood: { idBosque: unidades } } y cuánto vale.
 * Solo se vende la madera de bosques con precio conocido; el resto no se toca.
 * @returns { sold, units, coins } — sold tiene el mismo formato que el contenido
 */
export function saleValue(contents, sawmillLevel = 0) {
  const sold = {};
  let units = 0;
  let base = 0;
  for (const [forestId, n] of Object.entries(contents?.[RESOURCE.WOOD] ?? {})) {
    const forest = FORESTS.find((f) => String(f.id) === String(forestId));
    if (!forest || !Number.isInteger(n) || n <= 0) continue;
    (sold[RESOURCE.WOOD] ??= {})[forestId] = n;
    units += n;
    base += n * forest.valuePerUnit;
  }
  // Monedas enteras: se redondea hacia abajo (con el aserradero a nivel 0 el valor ya es exacto)
  return { sold, units, coins: Math.floor(base * sawmillMultiplier(sawmillLevel)) };
}

/**
 * La mejora más barata que todavía no se tiene, según los niveles del perfil.
 * @param levels { axeLevel, backpackLevel, workers, sawmillLevel }
 * @returns { key, name, level, cost } o null si ya se tiene todo
 */
/** Mejoras con efecto en el juego (la vivienda es cosmética: no cuenta como «siguiente mejora»). */
export const FUNCTIONAL_UPGRADES = SHOP.purchasable.filter((k) => !UPGRADES[k].cosmetic);

export function nextUpgrade(levels = {}, keys = FUNCTIONAL_UPGRADES) {
  const current = {
    axe: levels.axeLevel ?? 1,
    backpack: levels.backpackLevel ?? 1,
    workers: levels.workers ?? 0,
    sawmill: levels.sawmillLevel ?? 0,
  };
  let best = null;
  for (const [key, upgrade] of Object.entries(UPGRADES)) {
    if (!keys.includes(key)) continue; // Solo lo que ya se puede comprar en la tienda
    const level = current[key] + 1;
    const cost = upgrade.costs[level];
    if (cost === undefined) continue; // Nivel máximo alcanzado
    if (!best || cost < best.cost) best = { key, name: key === 'workers' ? `${upgrade.name} ${level}` : `${upgrade.name} nivel ${level}`, level, cost };
  }
  return best;
}

// ---------- Tienda (Fase 8) ----------

const levelOf = (key, levels) => levels[SHOP.columns[key]] ?? (key === 'axe' || key === 'backpack' ? 1 : 0);

/** Efecto de una mejora en un nivel, en texto para la tienda. */
/** Número con un decimal como mucho y coma decimal (13,2 · 5 · 7,1). */
const decimal = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

export function upgradeEffect(key, level, levels = {}) {
  if (key === 'axe') return `${AXE_LEVELS[level - 1]?.name ?? 'Hacha'} · daño ${AXE_LEVELS[level - 1]?.damage ?? '?'} por golpe`;
  if (key === 'backpack') return `${BACKPACK.capacities[level - 1] ?? '?'} unidades`;
  if (key === 'sawmill') return `+${Math.round(ECONOMY.sawmillBonusPerLevel * level * 100)} % al vender · ${decimal(productionStats(level).perMinute)} maderas/min por trabajador`;
  if (key === 'home') return UPGRADES.home.stages[level] ?? ''; // Solo el aspecto: ningún efecto
  if (key === 'workers') {
    if (level === 0) return 'Sin trabajadores';
    // Con el nivel actual del aserradero: lote de cada trabajador y su ciclo
    const { batch, cycle } = productionStats(levels.sawmillLevel ?? 0);
    return `${level} trabajador${level === 1 ? '' : 'es'} · ${level * batch} madera${level * batch === 1 ? '' : 's'} cada ${decimal(cycle)} s`;
  }
  return '';
}

/**
 * Lo que la tienda permite comprar ahora de una mejora (para progressSync.buy).
 * @returns { column, level, cost } · { maxed: true } si ya está al máximo · null si no se vende
 */
export function purchaseOffer(key, levels = {}) {
  if (!SHOP.purchasable.includes(key) || !UPGRADES[key]) return null;
  const level = levelOf(key, levels) + 1;
  const cost = UPGRADES[key].costs[level];
  if (cost === undefined) return { maxed: true };
  return { column: SHOP.columns[key], level, cost };
}

/**
 * Tarjetas de la tienda: estado de cada mejora con los niveles y el saldo CONFIRMADOS.
 * Solo información: comprar es progressSync.buy(clave).
 */
export function shopItems(levels = {}, coins = 0) {
  return Object.entries(UPGRADES).map(([key, upgrade]) => {
    const current = levelOf(key, levels);
    const next = current + 1;
    const cost = upgrade.costs[next];
    const available = SHOP.purchasable.includes(key);
    const maxed = cost === undefined;
    return {
      key,
      name: upgrade.name,
      level: current,
      nextLevel: maxed ? null : next,
      cost: maxed ? null : cost,
      effect: upgradeEffect(key, current, levels),
      nextEffect: maxed ? null : upgradeEffect(key, next, levels),
      available, // Los trabajadores aún no (Fase 9)
      cosmetic: Boolean(upgrade.cosmetic), // Vivienda: «Solo decorativo»
      maxed,
      affordable: available && !maxed && coins >= cost,
      missing: available && !maxed ? Math.max(0, cost - coins) : 0,
    };
  });
}
