// backpack.js — Mochila del jugador (Fase 7A). Solo lógica: sin DOM, sin Three.js y sin Appwrite.
//
// - La capacidad depende del nivel de la mochila (1, 2 o 3 → 20, 40 u 80 unidades).
// - El contenido se guarda por TIPO de recurso y por BOSQUE de origen, porque cada madera se
//   venderá al precio de su bosque:  { wood: { '1': 12, '2': 3 } }
//   Así se podrán añadir otros recursos o bosques sin cambiar la estructura.
// - Todas las unidades, de cualquier recurso, cuentan para la misma capacidad.
// - Nunca se pierde ni se duplica nada: add() devuelve cuántas unidades caben de verdad y
//   quien recoge solo retira del suelo esas unidades.
import { BACKPACK } from '../config.js';

export const RESOURCE = { WOOD: 'wood' };

/** Capacidad de la mochila según su nivel (1..3). Un nivel fuera de rango se ajusta. */
export function backpackCapacity(level) {
  const levels = BACKPACK.capacities;
  const i = Math.min(levels.length, Math.max(1, Math.floor(Number(level) || 1))) - 1;
  return levels[i];
}

export class Backpack {
  constructor(level = 1) {
    this.level = 1;
    this.capacity = backpackCapacity(1);
    this.contents = {}; // { recurso: { idBosque: unidades } }
    this.onChange = null; // (mochila) => void — lo usa la interfaz (y el guardado en el futuro)
    this.setLevel(level);
  }

  /** Cambia el nivel (al cargar el perfil; las mejoras se comprarán en la Fase 8). */
  setLevel(level) {
    this.capacity = backpackCapacity(level);
    this.level = BACKPACK.capacities.indexOf(this.capacity) + 1;
    this.changed();
  }

  /** Unidades totales de todos los recursos y bosques. */
  get total() {
    let sum = 0;
    for (const byForest of Object.values(this.contents)) for (const n of Object.values(byForest)) sum += n;
    return sum;
  }

  /** Espacio libre (0 si está llena, también si por datos antiguos tuviera más de la capacidad). */
  get free() {
    return Math.max(0, this.capacity - this.total);
  }

  get isFull() {
    return this.free === 0;
  }

  /** Unidades de un recurso: de un bosque concreto o de todos. */
  amount(resource = RESOURCE.WOOD, forestId = null) {
    const byForest = this.contents[resource] ?? {};
    if (forestId != null) return byForest[forestId] ?? 0;
    return Object.values(byForest).reduce((a, b) => a + b, 0);
  }

  /**
   * Añade hasta "units" unidades. Devuelve cuántas se han añadido (0 si está llena).
   * Si no caben todas, se añaden solo las que caben.
   */
  add(resource, forestId, units) {
    const n = Math.min(Math.max(0, Math.floor(units)), this.free);
    if (n === 0) return 0;
    const byForest = (this.contents[resource] ??= {});
    byForest[forestId] = (byForest[forestId] ?? 0) + n;
    this.changed();
    return n;
  }

  /**
   * Retira todo el contenido (o solo un recurso) y lo devuelve. La mochila queda vacía.
   * Lo usará la venta (Fase 7B).
   */
  takeAll(resource = null) {
    let taken;
    if (resource) {
      taken = { [resource]: { ...(this.contents[resource] ?? {}) } };
      delete this.contents[resource];
    } else {
      taken = this.toJSON();
      this.contents = {};
    }
    this.changed();
    return taken;
  }

  // ---------- Copia de los datos (para guardarlos y restaurarlos) ----------

  /** Copia independiente del contenido: { wood: { '1': 12 } } (sin entradas vacías). */
  toJSON() {
    const out = {};
    for (const [resource, byForest] of Object.entries(this.contents)) {
      const entries = Object.entries(byForest).filter(([, n]) => n > 0);
      if (entries.length) out[resource] = Object.fromEntries(entries);
    }
    return out;
  }

  /**
   * Restaura el contenido desde datos guardados, validándolos: solo enteros positivos.
   * Los datos no válidos se ignoran (se avisa en consola). No se recorta nada aunque supere la
   * capacidad: la madera ya recogida nunca se pierde (simplemente no se puede recoger más).
   * @returns número de datos no válidos ignorados (0 = datos correctos). Quien restaura decide
   *          qué hacer si hay datos dañados (progressSync.js no los sobrescribe).
   */
  load(data) {
    const contents = {};
    let ignored = 0;
    if (data && typeof data === 'object') {
      for (const [resource, byForest] of Object.entries(data)) {
        if (!byForest || typeof byForest !== 'object') {
          ignored++;
          continue;
        }
        for (const [forestId, n] of Object.entries(byForest)) {
          if (Number.isInteger(n) && n > 0) (contents[resource] ??= {})[forestId] = n;
          else ignored++;
        }
      }
    }
    if (ignored) console.warn(`[Timber Rush] Mochila: se ignoraron ${ignored} datos guardados no válidos`);
    this.contents = contents;
    this.changed();
    return ignored;
  }

  /**
   * Retira exactamente las unidades indicadas { recurso: { idBosque: n } } (lo vendido).
   * Lo recogido después de calcular la venta no se toca. Nunca baja de 0.
   */
  remove(contents) {
    for (const [resource, byForest] of Object.entries(contents ?? {})) {
      const mine = this.contents[resource];
      if (!mine) continue;
      for (const [forestId, n] of Object.entries(byForest)) {
        const left = (mine[forestId] ?? 0) - n;
        if (left > 0) mine[forestId] = left;
        else delete mine[forestId];
      }
      if (Object.keys(mine).length === 0) delete this.contents[resource];
    }
    this.changed();
  }

  /** Vacía la mochila sin devolver nada (al cerrar sesión: la siguiente cuenta empieza limpia). */
  clear() {
    this.contents = {};
    this.changed();
  }

  changed() {
    this.onChange?.(this);
  }
}
