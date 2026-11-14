// economy.js — Cálculos económicos puros (Fase 7B). Sin DOM, sin Three.js y sin Appwrite.
//
// - Valor de venta: unidades × precio de su bosque de origen × bonificación del aserradero.
// - Siguiente mejora: la más barata que aún no se tiene, con los precios aprobados (config.js).
// - Tienda (Fase 8): ofertas de cada mejora (nivel actual, siguiente, precio y efecto).
// Regla: los niveles solo cambian con una compra explícita confirmada (progressSync.buy).
import { BACKPACK, ECONOMY, FORESTS, SHOP, UPGRADES, WORKERS } from '../config.js';
import { RESOURCE } from './backpack.js';
import { AXE_LEVELS } from './axes.js';

/** Multiplicador de venta del aserradero: 1 + 0,25 × nivel (nivel 0..10 → ×1 .. ×3,5). */
export function sawmillMultiplier(level = 0) {
  const lvl = Math.min(10, Math.max(0, Math.floor(Number(level) || 0)));
  return 1 + ECONOMY.sawmillBonusPerLevel * lvl;
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
export function nextUpgrade(levels = {}, keys = SHOP.purchasable) {
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
export function upgradeEffect(key, level) {
  if (key === 'axe') return `Daño ${AXE_LEVELS[level - 1]?.damage ?? '?'} por golpe`;
  if (key === 'backpack') return `${BACKPACK.capacities[level - 1] ?? '?'} unidades`;
  if (key === 'sawmill') return `+${Math.round(ECONOMY.sawmillBonusPerLevel * level * 100)} % al vender`;
  if (key === 'workers') return level === 0 ? 'Sin trabajadores' : `${level} trabajador${level === 1 ? '' : 'es'} · ${level} madera${level === 1 ? '' : 's'} cada ${WORKERS.interval} s`;
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
      effect: upgradeEffect(key, current),
      nextEffect: maxed ? null : upgradeEffect(key, next),
      available, // Los trabajadores aún no (Fase 9)
      maxed,
      affordable: available && !maxed && coins >= cost,
      missing: available && !maxed ? Math.max(0, cost - coins) : 0,
    };
  });
}
