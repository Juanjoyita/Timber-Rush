// economy.js — Cálculos económicos puros (Fase 7B). Sin DOM, sin Three.js y sin Appwrite.
//
// - Valor de venta: unidades × precio de su bosque de origen × bonificación del aserradero.
// - Siguiente mejora: la más barata que aún no se tiene, con los precios aprobados (config.js).
//   Solo sirve para MOSTRAR el progreso: las compras llegan en la Fase 8.
import { ECONOMY, FORESTS, UPGRADES } from '../config.js';
import { RESOURCE } from './backpack.js';

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
export function nextUpgrade(levels = {}) {
  const current = {
    axe: levels.axeLevel ?? 1,
    backpack: levels.backpackLevel ?? 1,
    workers: levels.workers ?? 0,
    sawmill: levels.sawmillLevel ?? 0,
  };
  let best = null;
  for (const [key, upgrade] of Object.entries(UPGRADES)) {
    const level = current[key] + 1;
    const cost = upgrade.costs[level];
    if (cost === undefined) continue; // Nivel máximo alcanzado
    if (!best || cost < best.cost) best = { key, name: key === 'workers' ? `${upgrade.name} ${level}` : `${upgrade.name} nivel ${level}`, level, cost };
  }
  return best;
}
