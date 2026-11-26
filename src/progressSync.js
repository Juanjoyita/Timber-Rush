// progressSync.js — Sincronización de la mochila con Appwrite (Fase 7A).
//
// Coordina el estado LOCAL (la mochila en memoria y la madera recogida) con el REMOTO (la fila
// "progress" del usuario). No conoce el DOM ni las mecánicas de tala: recibe las funciones de la
// API (appwrite.js) y avisa de su estado con onStatus(estado, detalle).
//
// Nueva partida (Fase 10): resetProgress() es otra operación de la misma maquinaria: una sola
// escritura condicional y atómica que deja TODAS las columnas de progreso con sus valores
// iniciales (saveVersion sigue subiendo). Antes se resuelve cualquier guardado incierto y, al
// confirmarse, se descartan los cambios locales de la partida anterior. Una pestaña con la
// partida antigua no puede sobrescribirla (su versión ya no coincide).
//
// Almacén (Fase 9): resources.storage recibe la madera de los trabajadores (capacidad
// storageCapacity). Esa producción se guarda de forma diferida (como mucho cada productionDelay
// ms): un cierre brusco puede perder unos segundos de producción, pero nunca madera ya guardada.
//
// Compra (Fase 8): misma maquinaria que la venta. Resta el precio de coins (valor absoluto) y
// sube la columna del nivel en una sola escritura atómica; nunca toca totalCoinsEarned.
// onPurchase(compra) se emite una única vez y solo con la compra confirmada.
//
// Venta (Fase 7B): una sola escritura atómica con la misma protección por versión que vacía lo
// vendido (mochila y almacén) y fija coins / totalCoinsEarned en valores ABSOLUTOS calculados
// desde el último estado confirmado. Una venta nunca se reenvía automáticamente: si no hay
// respuesta, solo se VERIFICA leyendo la fila. onSale(venta) se emite una única vez por venta y
// solo cuando está confirmada; onSaleFailed(venta) si se sabe que no se aplicó.
//
// Qué se guarda (sin cambiar el esquema):
//   resources          (texto JSON)  → { backpack: { wood: { '1': 12 } }, storage: {…} }
//                                       Solo se reemplaza "backpack"; "storage" y cualquier otra
//                                       clave se conservan tal cual se leyeron.
//   totalWoodCollected (entero)      → valor ABSOLUTO (leído + recogido desde entonces)
//   saveVersion        (entero)      → lo sube Appwrite en la escritura condicional
//
// Reglas de seguridad:
// - Nunca se escribe en cada fotograma: debounce de 4 s con un máximo de 10 s desde el primer
//   cambio pendiente (una recogida continua no pospone el guardado indefinidamente).
// - Una sola escritura a la vez por instancia del juego.
// - Cada escritura es condicional (saveVersion) y atómica (transacción, ver appwrite.js).
// - Antes del primer guardado de cada sesión se comprueba que el servidor aplica la condición
//   como se espera; si no, el guardado se desactiva y se muestra un error (no se ajusta nada).
// - Tras el primer guardado se lee la fila para comprobar que versión y datos se aplicaron juntos.
// - Se guarda el ESTADO COMPLETO (no incrementos): repetir un guardado no duplica madera.
// - Si no hay respuesta, no se sabe si se guardó: antes de reintentar se lee la fila.
// - "Guardado" solo se indica tras una confirmación fiable.
// - Ante cualquier error, la mochila en memoria se conserva.

export const SAVE_STATUS = {
  IDLE: 'idle', // Sin cambios pendientes
  PENDING: 'pending', // Hay cambios sin guardar (esperando el debounce)
  SAVING: 'saving',
  SAVED: 'saved', // Confirmado por Appwrite
  RETRYING: 'retrying', // Error de conexión: se reintentará automáticamente
  CONFLICT: 'conflict', // Conflicto real de versiones: otra sesión guardó antes
  PERMISSION: 'permission', // Error de permisos o sesión
  UNSUPPORTED: 'unsupported', // Transacciones no disponibles en este servidor o plan
  CONDITION: 'condition', // Fallo inesperado en la condición del incremento o en la atomicidad
  BLOCKED: 'blocked', // Los datos guardados están dañados: no se sobrescriben
  ERROR: 'error', // Datos rechazados por el servidor
};

// Estados en los que no se vuelve a escribir hasta recargar la página (requieren revisión)
const HALTED = new Set([SAVE_STATUS.CONFLICT, SAVE_STATUS.CONDITION, SAVE_STATUS.BLOCKED]);
// Estados sin reintento automático (pausar, volver al menú o el aviso de cerrar sesión sí reintentan)
const MANUAL_RETRY = new Set([SAVE_STATUS.PERMISSION, SAVE_STATUS.UNSUPPORTED, SAVE_STATUS.ERROR]);

export const SYNC_SETTINGS = {
  debounce: 4000, // ms sin cambios antes de guardar
  maxWait: 10000, // ms máximos desde el primer cambio pendiente
  retryDelays: [5000, 15000, 30000, 60000], // Esperas entre reintentos (la última se repite)
  maxResourcesLength: 1000, // Tamaño de la columna "resources" en Appwrite
};

import { CHARACTER_SKINS } from './config.js';
import { isNightAt, parseClock, START_CLOCK } from './game/gameClock.js';

const DEFAULT_RESOURCES = { backpack: {}, storage: {} };
const FOREST_COUNT = 5; // Bosques del juego (columnas currentForest y unlockedForests: 1..5)

/**
 * Cofres (Fase 11C) dentro de resources: { d: día, o: [máscara de huecos abiertos por bosque],
 * n: total histórico }. Si d no es el día actual, hoy no hay ninguno abierto.
 */
export function parseChests(raw) {
  if (!isPlainObject(raw)) return null;
  const { d, o, n } = raw;
  if (!Number.isInteger(d) || d < 0 || d > 1e6 || !Number.isInteger(n) || n < 0) return null;
  if (!Array.isArray(o) || o.length !== FOREST_COUNT || !o.every((m) => Number.isInteger(m) && m >= 0 && m <= 15)) return null;
  return { d, o: [...o], n };
}
const NO_CHESTS = Object.freeze({ d: 0, o: [0, 0, 0, 0, 0], n: 0 });

// Mejoras guardadas DENTRO de resources (sin columna en Appwrite): la vivienda (Fase 11D, 0..6)
const RESOURCE_LEVELS = {
  home: 6,
  ...Object.fromEntries(CHARACTER_SKINS.map(({ id }) => [`skin_${id}`, 1])),
};
const validResourceLevels = (resources) => Object.entries(RESOURCE_LEVELS).every(([key, max]) => {
  const value = resources[key];
  return value === undefined || (Number.isInteger(value) && value >= 0 && value <= max);
});
const validEquippedSkin = (resources) => resources.equippedSkin === undefined
  || resources.equippedSkin === 'worker'
  || CHARACTER_SKINS.some(({ id }) => id === resources.equippedSkin && resources[`skin_${id}`] === 1);
/** Progreso de una partida nueva (resources en el mismo formato que el valor por defecto). */
export const INITIAL_PROGRESS = { resources: { backpack: {}, storage: {} } };
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isCount = (x) => Number.isInteger(x) && x >= 0;
/** Contenido { recurso: { idBosque: n } } con solo enteros positivos (o vacío). */
function validContents(c) {
  if (c === undefined) return true;
  if (!isPlainObject(c)) return false;
  return Object.values(c).every((byForest) => isPlainObject(byForest) && Object.values(byForest).every((n) => Number.isInteger(n) && n > 0));
}
const pickSaved = (data) => ({ resources: data.resources, totalWoodCollected: data.totalWoodCollected });

/** Suma dos contenidos { recurso: { idBosque: n } }. */
function mergeContents(a, b) {
  const out = structuredClone(a ?? {});
  for (const [resource, byForest] of Object.entries(b ?? {})) {
    for (const [forestId, n] of Object.entries(byForest)) (out[resource] ??= {})[forestId] = (out[resource][forestId] ?? 0) + n;
  }
  return out;
}

/** Contenido "a" menos lo vendido "b" (sin entradas a cero). */
function subtractContents(a, b) {
  const out = {};
  for (const [resource, byForest] of Object.entries(a ?? {})) {
    if (!isPlainObject(byForest)) continue;
    for (const [forestId, n] of Object.entries(byForest)) {
      const left = n - (b?.[resource]?.[forestId] ?? 0);
      if (left > 0) (out[resource] ??= {})[forestId] = left;
    }
  }
  return out;
}

export class ProgressSync {
  /**
   * @param api   { getProfile(userId), save(userId, expectedVersion, data),
   *                probe(userId, currentVersion), classify(error) }
   * @param clock { now(), setTimeout(fn, ms), clearTimeout(id) } (se sustituye en las pruebas)
   */
  constructor({ api, saleValue = null, purchaseOffer = null, forestUnlocks = null, chestReward = null, storageCapacity = 100, productionDelay = 30000, clock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) }, settings = SYNC_SETTINGS }) {
    this.api = api;
    this.saleValue = saleValue; // (contenido, nivelAserradero) => { sold, units, coins } (economy.js)
    this.purchaseOffer = purchaseOffer; // (clave, niveles) => { column, level, cost } | { maxed } | null
    // (monedas históricas) => bosques desbloqueados 1..5 (economy.unlockedForestCount). Sin ella,
    // solo cuenta lo guardado en la columna unlockedForests.
    this.forestUnlocks = forestUnlocks;
    this.chestReward = chestReward; // (bosque, día, hueco) => { kind, coins } (economy.chestReward)
    this.storageCapacity = storageCapacity;
    this.productionDelay = productionDelay;
    this.onStorageChange = () => {}; // (total) => void — indicador del almacén y pila de troncos
    this.clock = clock;
    this.s = settings;
    this.onStatus = () => {}; // (estado, detalle) => void
    this.onSale = () => {}; // (venta confirmada) => void — una sola vez por venta
    this.onSaleFailed = () => {}; // (venta, motivo) => void
    this.onPurchase = () => {}; // (compra confirmada) => void — una sola vez por compra
    this.onSkinChange = () => {}; // (id) => void — apariencia equipada confirmada
    this.onSkinChangeFailed = () => {}; // (id, motivo) => void
    this.onPurchaseFailed = () => {}; // (compra, motivo) => void (solo resultados diferidos)
    this.onReset = () => {}; // () => void — nueva partida confirmada (una sola vez)
    this.onResetFailed = () => {}; // (motivo) => void (solo resultados diferidos)
    this.onTravel = () => {}; // ({ forestId }) => void — viaje confirmado en Appwrite (Fase 11A)
    this.onTravelFailed = () => {}; // ({ forestId, reason }) => void (solo resultados diferidos)
    this.onSleep = () => {}; // ({ clock }) => void — descanso confirmado en Appwrite (Fase 11B)
    this.onSleepFailed = () => {}; // ({ reason }) => void (solo resultados diferidos)
    this.onChest = () => {}; // (cofre abierto y cobrado en Appwrite) => void — una sola vez (Fase 11C)
    this.onChestFailed = () => {}; // ({ reason }) => void (solo resultados diferidos)
    this.saleSeq = 0; // Identificador de cada operación (no se reinicia al cambiar de cuenta)
    this.reset();
  }

  reset() {
    this.attached = false;
    this.userId = null;
    this.backpack = null;
    this.version = 0; // saveVersion confirmado en Appwrite
    this.base = { ...DEFAULT_RESOURCES }; // "resources" leído (se conserva todo menos backpack)
    this.confirmed = null; // { resources, totalWoodCollected } confirmados en Appwrite
    this.totalWood = 0;
    this.dirty = false;
    this.dirtySince = null;
    this.uncertain = null; // { snapshot, expected } si un intento terminó sin saber el resultado
    this.inFlight = null; // Promesa del guardado en curso (una sola a la vez)
    this.timer = null;
    this.retryTimer = null;
    this.retryIndex = 0;
    this.restoring = false;
    this.guardChecked = false; // Comprobación de la condición hecha en esta sesión
    this.firstSaveVerified = false; // Atomicidad comprobada tras el primer guardado
    this.lastError = null; // Diagnóstico del último error { kind, type, code, message, at }
    this.coins = 0; // Monedas disponibles CONFIRMADAS en Appwrite (fuente de verdad local)
    this.totalCoinsEarned = 0; // Monedas ganadas históricamente (confirmadas)
    this.levels = { axeLevel: 1, backpackLevel: 1, workers: 0, sawmillLevel: 0, home: 0 };
    this.forests = { currentForest: 1, unlockedForests: 1 }; // Bosque actual y desbloqueados (Fase 11A)
    this.savedForests = { currentForest: 1, unlockedForests: 1 }; // Lo que hay en Appwrite
    this.opInFlight = false; // Venta o compra en curso (nunca dos a la vez)
    this.lazyOnly = false; // Lo único pendiente es producción (guardado diferido)
    this.status = SAVE_STATUS.IDLE;
  }

  /** ¿Hay algo que todavía no está confirmado en Appwrite? */
  get hasUnsaved() {
    // La producción pendiente sola no cuenta (se acepta perder unos segundos al cerrar)
    return this.attached && ((this.dirty && !this.lazyOnly) || this.inFlight !== null || this.uncertain !== null);
  }

  get halted() {
    return HALTED.has(this.status);
  }

  setStatus(status, detail = null) {
    this.status = status;
    this.onStatus(status, detail);
  }

  /** Registra el error con datos para diagnosticarlo y cambia de estado. */
  fail(status, kind, error, message) {
    this.lastError = { kind, type: error?.type ?? null, code: error?.code ?? null, message: error?.message ?? String(error ?? ''), at: new Date(this.clock.now()).toISOString() };
    const tag = this.lastError.type || this.lastError.code ? ` [${[this.lastError.type, this.lastError.code].filter((x) => x !== null && x !== '').join(', ')}]` : '';
    console.error(`[Timber Rush] Guardado de la mochila — ${kind}: ${message}`, this.lastError);
    this.setStatus(status, `${message}${tag}`);
    return { ok: false, status, kind };
  }

  // ---------- Restaurar al iniciar sesión ----------

  /**
   * Conecta la mochila con la fila de progreso ya leída (getProfile) y restaura su contenido.
   * Solo se llama con una fila leída correctamente: un error de lectura no llega aquí (el inicio
   * de sesión falla y no se entra al juego), así que nunca se confunde con una mochila vacía.
   * @returns { damaged } true si los datos guardados no son válidos (no se sobrescribirán)
   */
  attach(userId, profile, backpack) {
    this.detach();
    this.userId = userId;
    this.backpack = backpack;
    this.attached = true;

    const resources = this.parseResources(profile.resources);
    const total = profile.totalWoodCollected ?? 0;
    const version = profile.saveVersion ?? 0;
    const coins = profile.coins ?? 0;
    const totalCoins = profile.totalCoinsEarned ?? 0;
    let damaged = resources === null || !isCount(total) || !isCount(version) || !isCount(coins) || !isCount(totalCoins) || (resources && !validContents(resources.storage));
    // Reloj (Fase 11B): si falta (perfil antiguo) se empieza en el Día 1 a las 08:00; si está
    // dañado, se protege como el resto de datos (no se sobrescribe)
    if (resources && resources.clock !== undefined && !parseClock(resources.clock)) damaged = true;
    if (resources && resources.chests !== undefined && !parseChests(resources.chests)) damaged = true; // Cofres (Fase 11C)
    if (resources && (!validResourceLevels(resources) || !validEquippedSkin(resources))) damaged = true;

    this.restoring = true; // Cargar no cuenta como un cambio que haya que guardar
    backpack.setLevel(profile.backpackLevel ?? 1); // Capacidad 20 / 40 / 80
    if (resources) {
      if (backpack.load(resources.backpack) > 0) damaged = true;
      this.base = resources;
    } else {
      backpack.clear();
    }
    this.restoring = false;

    this.totalWood = isCount(total) ? total : 0;
    this.version = isCount(version) ? version : 0;
    this.coins = isCount(coins) ? coins : 0;
    this.totalCoinsEarned = isCount(totalCoins) ? totalCoins : 0;
    this.levels = {
      axeLevel: profile.axeLevel ?? 1,
      backpackLevel: profile.backpackLevel ?? 1,
      workers: profile.workers ?? 0,
      sawmillLevel: profile.sawmillLevel ?? 0,
      home: resources?.home ?? 0, // Vivienda (cosmética)
      ...Object.fromEntries(CHARACTER_SKINS.map(({ id }) => [`skin_${id}`, resources?.[`skin_${id}`] ?? 0])),
      equippedSkin: resources?.equippedSkin ?? 'worker',
    };
    // Bosques: el desbloqueo depende de las monedas HISTÓRICAS (nunca baja). Si la columna se
    // quedó atrás (perfil anterior a la Fase 11A), cuenta lo que corresponda; se guardará con la
    // próxima venta o viaje. Un bosque actual imposible (dato dañado) vuelve al Verde.
    const stored = (v) => (Number.isInteger(v) && v >= 1 && v <= FOREST_COUNT ? v : 1);
    this.savedForests = { currentForest: profile.currentForest ?? 1, unlockedForests: profile.unlockedForests ?? 1 };
    const unlocked = Math.max(stored(profile.unlockedForests), this.unlocksFor(this.totalCoinsEarned));
    const current = stored(profile.currentForest);
    this.forests = { currentForest: current <= unlocked ? current : 1, unlockedForests: unlocked };
    this.confirmed = { resources: profile.resources ?? null, totalWoodCollected: profile.totalWoodCollected ?? null };
    this.onStorageChange(this.storageTotal);
    if (damaged) {
      this.fail(SAVE_STATUS.BLOCKED, 'datos-dañados', null, 'Los datos guardados de la mochila no son válidos: no se sobrescribirán.');
    } else {
      this.setStatus(SAVE_STATUS.IDLE);
    }
    return { damaged };
  }

  /**
   * "resources" válido → objeto; vacío o sin definir → valores por defecto (mochila vacía
   * legítima); dañado → null.
   */
  parseResources(raw) {
    if (raw === undefined || raw === null || raw === '') return { ...DEFAULT_RESOURCES };
    let value = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (!isPlainObject(value)) return null;
    if (value.backpack !== undefined && !isPlainObject(value.backpack)) return null;
    if (value.storage !== undefined && !isPlainObject(value.storage)) return null;
    return { ...DEFAULT_RESOURCES, ...value, backpack: value.backpack ?? {} };
  }

  /** Al cerrar sesión: deja de sincronizar (no borra nada en Appwrite). */
  detach() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer);
    this.reset();
  }

  // ---------- Cambios locales ----------

  /** La mochila cambió (recoger, vaciar, cambiar de nivel). */
  markDirty() {
    if (!this.attached || this.restoring) return;
    this.lazyOnly = false;
    this.dirty = true;
    this.dirtySince ??= this.clock.now();
    if (this.halted || MANUAL_RETRY.has(this.status)) return; // Se conserva en memoria
    if (this.status !== SAVE_STATUS.SAVING && this.status !== SAVE_STATUS.RETRYING) this.setStatus(SAVE_STATUS.PENDING);
    this.schedule();
  }

  // ---------- Almacén (Fase 9) ----------

  /** Unidades en el almacén (todas las maderas). */
  get storageTotal() {
    let sum = 0;
    for (const byForest of Object.values(isPlainObject(this.base.storage) ? this.base.storage : {})) {
      if (isPlainObject(byForest)) for (const n of Object.values(byForest)) if (isCount(n)) sum += n;
    }
    return sum;
  }

  get storageFree() {
    return Math.max(0, this.storageCapacity - this.storageTotal);
  }

  /**
   * Madera producida por los trabajadores. Solo entra lo que cabe. Se guarda de forma diferida.
   * @returns unidades añadidas
   */
  addToStorage(forestId, units) {
    if (!this.attached || this.halted) return 0;
    const n = Math.min(Math.max(0, Math.floor(units)), this.storageFree);
    if (n === 0) return 0;
    const storage = structuredClone(isPlainObject(this.base.storage) ? this.base.storage : {});
    const wood = (storage.wood ??= {});
    wood[forestId] = (wood[forestId] ?? 0) + n;
    this.base = { ...this.base, storage };
    this.onStorageChange(this.storageTotal);
    this.markDirtyLazy();
    return n;
  }

  /** Cambio que puede esperar (producción): un guardado como mucho cada productionDelay ms. */
  markDirtyLazy() {
    if (!this.attached || this.restoring) return;
    if (!this.dirty) this.lazyOnly = true;
    this.dirty = true;
    if (MANUAL_RETRY.has(this.status) || this.timer || this.retryTimer || this.inFlight) return; // Ya habrá un guardado
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.productionDelay);
  }

  /** Madera recogida (para totalWoodCollected). */
  recordCollected(units) {
    if (!this.attached || units <= 0) return;
    this.totalWood += units;
    this.markDirty();
  }

  /** Programa el guardado: 4 s sin cambios, o como mucho 10 s desde el primer cambio pendiente. */
  schedule() {
    if (this.retryTimer) return; // Hay un reintento programado: incluirá los últimos datos
    const now = this.clock.now();
    const due = Math.min(now + this.s.debounce, this.dirtySince + this.s.maxWait);
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, Math.max(0, due - now));
  }

  /** Datos que se escribirán (estado completo actual). */
  snapshot() {
    const resources = JSON.stringify({ ...this.base, backpack: this.backpack.toJSON() });
    return { resources, totalWoodCollected: this.totalWood };
  }

  // ---------- Guardar ----------

  /**
   * Guarda ahora los cambios pendientes (pausa, menú, cerrar sesión, cerrar pestaña).
   * Si ya hay un guardado en curso, espera a que termine y, si siguen quedando cambios, guarda
   * otra vez. Nunca hay dos escrituras en paralelo.
   * @returns { ok, status } ok = todo lo local está confirmado en Appwrite
   */
  /**
   * Prepara la sesión en segundo plano (al iniciar sesión): hace YA la comprobación de la
   * condición de saveVersion que, si no, pagaría la primera operación (abrir un cofre, vender…).
   * Va por la misma cola de escrituras (nunca en paralelo con otra) y no escribe datos.
   */
  warmUp() {
    if (!this.attached || this.guardChecked || this.inFlight || this.opInFlight || this.halted) return Promise.resolve({ ok: true, status: this.status });
    this.inFlight = this.write('save').finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async flush() {
    if (this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.attached) return { ok: true, status: this.status };
    if (this.halted) return { ok: !this.dirty && this.status !== SAVE_STATUS.CONDITION, status: this.status };
    if (this.inFlight) {
      await this.inFlight;
      if (!this.attached) return { ok: true, status: this.status };
      return (this.dirty || this.uncertain) && !this.halted ? this.flush() : { ok: !this.dirty && !this.uncertain, status: this.status };
    }
    if (!this.dirty && !this.uncertain) return { ok: true, status: this.status };
    if (this.retryTimer) {
      this.clock.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.inFlight = this.write('save').finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  // ---------- Vender (Fase 7B) ----------

  /**
   * Vende la madera de la mochila (y del almacén) en una escritura condicional y atómica.
   * Espera a que termine cualquier guardado en curso. Si ya hay una venta en curso, no hace nada.
   * @returns { ok, sale } si se confirmó; { ok: false, reason | pending } si no.
   */
  sell() {
    return this.runOperation('sale');
  }

  // ---------- Reloj del juego (Fase 11B) ----------

  /** Reloj guardado (o el inicial si el perfil aún no tiene). */
  get gameClock() {
    return parseClock(this.base.clock) ?? { ...START_CLOCK };
  }

  /**
   * Hora actual del juego (Game.js la envía mientras se juega). Va dentro de resources, así que
   * viaja en TODAS las escrituras (guardar, vender, comprar, viajar): nunca hay una escritura
   * aparte que pueda pisar otros datos. Se guarda sin prisa (como la producción): como mucho
   * cada 30 s, o antes si se guarda por otro motivo.
   */
  setClock(state) {
    const clock = parseClock(state);
    if (!this.attached || !clock || this.restoring) return;
    const current = this.base.clock;
    if (current && current.d === clock.d && current.t === clock.t) return;
    this.base = { ...this.base, clock };
    this.markDirtyLazy();
  }

  /**
   * Dormir (solo de noche): se guarda el reloj del día siguiente a las 06:00 con la misma
   * escritura versionada y atómica. El juego solo amanece al confirmarse (onSleep).
   */
  sleep() {
    return this.runOperation('sleep');
  }

  planSleep() {
    const now = this.gameClock;
    if (!isNightAt(now.t)) return { error: 'no-es-de-noche' };
    const next = { d: now.d + 1, t: 0 };
    const resources = JSON.stringify({ ...this.base, clock: next, backpack: this.backpack.toJSON() });
    return { data: { resources, totalWoodCollected: this.totalWood }, op: { kind: 'sleep', id: ++this.saleSeq, clock: next, done: false } };
  }

  applySleep(op) {
    this.base = { ...this.base, clock: op.clock };
    this.onSleep({ id: op.id, clock: { ...op.clock } });
  }

  // ---------- Cofres (Fase 11C) ----------

  /** Estado guardado de los cofres. */
  get chests() {
    return parseChests(this.base.chests) ?? { ...NO_CHESTS, o: [...NO_CHESTS.o] };
  }

  /** Huecos ya abiertos HOY en un bosque (máscara de 4 bits). */
  openedChests(forestId, day = this.gameClock.d) {
    const c = this.chests;
    return c.d === day ? c.o[forestId - 1] ?? 0 : 0;
  }

  /**
   * Abrir un cofre: monedas (coins y totalCoinsEarned, sin el aserradero), desbloqueos de
   * bosques y el cofre marcado como abierto, todo en UNA escritura versionada y atómica. Si
   * falla, el cofre no cuenta como abierto. Nunca se cobra dos veces el mismo hueco en un día.
   */
  openChest(forestId, slot) {
    return this.runOperation('chest', { forestId, slot });
  }

  planChest({ forestId, slot }) {
    const id = Number(forestId);
    if (id !== this.forests.currentForest) return { error: 'otro-bosque' };
    const day = this.gameClock.d;
    const reward = this.chestReward?.(id, day, slot);
    if (!reward) return { error: 'no-existe' };
    const now = this.chests;
    const masks = now.d === day ? [...now.o] : [0, 0, 0, 0, 0];
    if (masks[id - 1] & (1 << slot)) return { error: 'ya-abierto' };
    masks[id - 1] |= 1 << slot;
    const chests = { d: day, o: masks, n: now.n + 1 };
    const data = {
      resources: JSON.stringify({ ...this.base, chests, backpack: this.backpack.toJSON() }),
      totalWoodCollected: this.totalWood, // La madera no cambia
      coins: this.coins + reward.coins,
      totalCoinsEarned: this.totalCoinsEarned + reward.coins,
    };
    const unlockedAfter = Math.max(this.forests.unlockedForests, this.unlocksFor(data.totalCoinsEarned));
    if (unlockedAfter !== this.savedForests.unlockedForests) data.unlockedForests = unlockedAfter;
    return { data, op: { kind: 'chest', id: ++this.saleSeq, forestId: id, slot, day, reward, chests, unlockedBefore: this.forests.unlockedForests, done: false } };
  }

  applyChest(op, data) {
    const before = this.coins;
    this.coins = data.coins;
    this.totalCoinsEarned = data.totalCoinsEarned;
    this.base = { ...this.base, chests: op.chests };
    const unlockedNow = [];
    if (data.unlockedForests !== undefined) {
      this.savedForests = { ...this.savedForests, unlockedForests: data.unlockedForests };
      const from = Math.min(op.unlockedBefore, this.forests.unlockedForests);
      this.forests = { ...this.forests, unlockedForests: Math.max(this.forests.unlockedForests, data.unlockedForests) };
      for (let f = from + 1; f <= this.forests.unlockedForests; f++) unlockedNow.push(f);
    }
    this.onChest({ id: op.id, forestId: op.forestId, slot: op.slot, day: op.day, kind: op.reward.kind, earned: op.reward.coins, coinsBefore: before, coins: this.coins, totalCoinsEarned: this.totalCoinsEarned, opened: op.chests.o[op.forestId - 1], unlockedForests: unlockedNow });
  }

  // ---------- Bosques (Fase 11A) ----------

  /** Bosques desbloqueados con unas monedas históricas (sin función: los guardados). */
  unlocksFor(totalCoins) {
    return this.forestUnlocks ? Math.min(FOREST_COUNT, Math.max(1, this.forestUnlocks(totalCoins))) : 1;
  }

  /**
   * Viajar a otro bosque (gratis): se guarda currentForest con la misma escritura versionada y
   * atómica que el resto. El juego solo cambia de bosque al confirmarse (onTravel).
   * @returns { ok } · { ok: false, reason } ('bloqueado', 'mismo-bosque', 'no-existe', …)
   */
  travel(forestId) {
    return this.runOperation('travel', forestId);
  }

  planTravel(forestId) {
    const id = Number(forestId);
    if (!Number.isInteger(id) || id < 1 || id > FOREST_COUNT) return { error: 'no-existe' };
    if (id > this.forests.unlockedForests) return { error: 'bloqueado' };
    if (id === this.forests.currentForest) return { error: 'mismo-bosque' };
    const data = { ...this.snapshot(), currentForest: id };
    if (this.forests.unlockedForests !== this.savedForests.unlockedForests) data.unlockedForests = this.forests.unlockedForests;
    return { data, op: { kind: 'travel', id: ++this.saleSeq, forestId: id, done: false } };
  }

  applyTravel(op, data) {
    this.forests = { ...this.forests, currentForest: op.forestId };
    this.savedForests = { currentForest: op.forestId, unlockedForests: data.unlockedForests ?? this.savedForests.unlockedForests };
    this.onTravel({ id: op.id, forestId: op.forestId });
  }

  // ---------- Comprar (Fase 8) ----------

  /**
   * Compra el siguiente nivel de una mejora ('axe', 'backpack', 'sawmill') con el saldo
   * CONFIRMADO, en una escritura condicional y atómica.
   * @returns { ok, purchase } si se confirmó; { ok: false, reason | pending } si no
   *          (reason: 'saldo-insuficiente', 'nivel-máximo', 'no-disponible', 'en-curso'…)
   */
  buy(key) {
    return this.runOperation('purchase', key);
  }

  /** Equipa una apariencia comprada y guarda el cambio en la misma columna de recursos. */
  equipSkin(id) {
    return this.runOperation('skin', id);
  }

  // ---------- Nueva partida (Fase 10) ----------

  /**
   * Reinicia TODO el progreso de la partida en una escritura condicional y atómica.
   * Solo debe llamarse tras la confirmación explícita del jugador (escribir REINICIAR).
   * @returns { ok } si se confirmó; { ok: false, reason | pending } si no (nada cambia)
   */
  resetProgress() {
    return this.runOperation('reset');
  }

  /** Datos iniciales de la partida (identidad y saveVersion no se tocan). */
  planReset() {
    const data = {
      resources: JSON.stringify({ ...INITIAL_PROGRESS.resources, clock: { ...START_CLOCK } }), // Día 1, 08:00
      totalWoodCollected: 0,
      coins: 0,
      totalCoinsEarned: 0,
      axeLevel: 1,
      backpackLevel: 1,
      sawmillLevel: 0,
      workers: 0,
      currentForest: 1,
      unlockedForests: 1,
    };
    return { data, op: { kind: 'reset', id: ++this.saleSeq, done: false } };
  }

  /** Nueva partida confirmada: estado local inicial y se descarta lo pendiente de la anterior. */
  applyReset(data) {
    this.coins = 0;
    this.totalCoinsEarned = 0;
    this.totalWood = 0;
      this.levels = {
        axeLevel: 1, backpackLevel: 1, workers: 0, sawmillLevel: 0, home: 0, equippedSkin: 'worker',
        ...Object.fromEntries(CHARACTER_SKINS.map(({ id }) => [`skin_${id}`, 0])),
      };
    this.forests = { currentForest: 1, unlockedForests: 1 };
    this.savedForests = { currentForest: 1, unlockedForests: 1 };
    this.base = JSON.parse(data.resources);
    this.restoring = true; // No son cambios pendientes: ya están guardados
    this.backpack.clear();
    this.backpack.setLevel(1);
    this.restoring = false;
    this.dirty = false;
    this.dirtySince = null;
    this.lazyOnly = false;
    this.onStorageChange(this.storageTotal);
    this.onSkinChange('worker');
    this.onReset();
  }

  // ---------- Continuar (Fase 10) ----------

  /**
   * Antes de entrar a jugar: guarda lo pendiente y comprueba la fila en Appwrite. Si otra
   * sesión la cambió (otra pestaña o dispositivo), se restaura desde ahí.
   * @returns { ok, reloaded } · { ok: false, reason } si no se pudo comprobar
   */
  async refreshFromServer() {
    if (!this.attached) return { ok: false, reason: 'sin-sesión' };
    const flushed = await this.flush();
    if (!flushed.ok && !this.halted) return { ok: false, reason: flushed.status };
    const userId = this.userId;
    let row;
    try {
      row = await this.api.getProfile(userId);
    } catch (error) {
      return { ok: false, reason: this.api.classify(error) };
    }
    if (this.userId !== userId) return { ok: false, reason: 'sin-sesión' };
    if (!row) return { ok: false, reason: 'sin-fila' };
    if (row.saveVersion === this.version || this.halted) return { ok: true, reloaded: false };
    // Otra sesión guardó: se restaura todo desde Appwrite (aquí no queda nada pendiente)
    const backpack = this.backpack;
    this.attach(userId, row, backpack);
    return { ok: true, reloaded: true };
  }

  // ---------- Estadísticas (Fase 10) ----------

  /** Datos confirmados para el panel de estadísticas (sin inventar nada que no se guarde). */
  stats() {
    return {
      totalWoodCollected: this.totalWood,
      totalCoinsEarned: this.totalCoinsEarned,
      coins: this.coins,
      ...this.levels,
      backpack: this.backpack ? this.backpack.total : 0,
      backpackCapacity: this.backpack ? this.backpack.capacity : 0,
      storage: this.storageTotal,
      storageCapacity: this.storageCapacity,
      gameClock: this.gameClock, // Día y hora guardados (Fase 11B)
      chestsOpened: this.chests.n, // Cofres abiertos en total (Fase 11C)
      ...this.forests,
    };
  }

  /** Venta o compra: una a la vez, esperando a que termine cualquier guardado en curso. */
  async runOperation(mode, arg) {
    if (!this.attached) return { ok: false, reason: 'sin-sesión' };
    if (this.opInFlight) return { ok: false, reason: 'en-curso' };
    if (this.halted) return { ok: false, reason: this.status };
    this.opInFlight = true;
    try {
      while (this.inFlight) await this.inFlight; // Una sola escritura a la vez
      if (!this.attached) return { ok: false, reason: 'sin-sesión' };
      if (this.halted) return { ok: false, reason: this.status };
      if (this.timer) this.clock.clearTimeout(this.timer);
      if (this.retryTimer) this.clock.clearTimeout(this.retryTimer);
      this.timer = this.retryTimer = null; // La operación escribe el estado completo actual
      this.inFlight = this.write(mode, arg).finally(() => {
        this.inFlight = null;
      });
      return await this.inFlight;
    } finally {
      this.opInFlight = false;
    }
  }

  /** Prepara la compra: precio, nivel nuevo y datos que quedarán en Appwrite. */
  planPurchase(key) {
    const offer = this.purchaseOffer?.(key, this.levels);
    if (!offer) return { error: 'no-disponible' };
    if (offer.maxed) return { error: 'nivel-máximo' };
    if (this.coins < offer.cost) return { error: 'saldo-insuficiente' };
    // La vivienda se guarda dentro de resources; el resto de mejoras, en su columna
    const skinId = key.startsWith('skin_') ? key.slice(5) : null;
    const resourceData = { ...this.base, [offer.column]: offer.level, ...(skinId ? { equippedSkin: skinId } : {}), backpack: this.backpack.toJSON() };
    const data = offer.column in RESOURCE_LEVELS
      ? { resources: JSON.stringify(resourceData), totalWoodCollected: this.totalWood, coins: this.coins - offer.cost }
      : { ...this.snapshot(), coins: this.coins - offer.cost, [offer.column]: offer.level };
    const op = { kind: 'purchase', id: ++this.saleSeq, key, column: offer.column, level: offer.level, cost: offer.cost, skinId, done: false };
    return { data, op };
  }

  planSkin(id) {
    const owned = id === 'worker' || (CHARACTER_SKINS.some((skin) => skin.id === id) && this.levels[`skin_${id}`] === 1);
    if (!owned) return { error: 'apariencia-no-desbloqueada' };
    if (this.levels.equippedSkin === id) return { error: 'apariencia-ya-equipada' };
    const data = { ...this.snapshot(), resources: JSON.stringify({ ...this.base, equippedSkin: id, backpack: this.backpack.toJSON() }) };
    return { data, op: { kind: 'skin', id: ++this.saleSeq, skinId: id, done: false } };
  }

  /** La compra está confirmada: nuevo saldo y nivel en local, y aviso (una sola vez). */
  applyPurchase(op, data) {
    this.coins = data.coins; // totalCoinsEarned no cambia al gastar
    this.levels = { ...this.levels, [op.column]: op.level, ...(op.skinId ? { equippedSkin: op.skinId } : {}) };
    if (op.column in RESOURCE_LEVELS) this.base = { ...this.base, [op.column]: op.level, ...(op.skinId ? { equippedSkin: op.skinId } : {}) };
    if (op.column === 'backpackLevel') {
      this.restoring = true; // Ya está guardado: no es un cambio pendiente
      this.backpack.setLevel(op.level);
      this.restoring = false;
    }
    this.onPurchase({ id: op.id, key: op.key, level: op.level, cost: op.cost, coins: this.coins, levels: { ...this.levels } });
    if (op.skinId) this.onSkinChange(op.skinId);
  }

  applySkin(op) {
    this.base = { ...this.base, equippedSkin: op.skinId };
    this.levels = { ...this.levels, equippedSkin: op.skinId };
    this.onSkinChange(op.skinId);
  }

  /** Prepara la venta: qué se vende, cuánto vale y los datos que quedarán en Appwrite. */
  planSale() {
    const lvl = this.levels.sawmillLevel;
    const backpack = this.backpack.toJSON();
    const storage = isPlainObject(this.base.storage) ? this.base.storage : {};
    const fromBackpack = this.saleValue(backpack, lvl).sold;
    const fromStorage = this.saleValue(storage, lvl).sold;
    const { units, coins } = this.saleValue(mergeContents(fromBackpack, fromStorage), lvl);
    if (units === 0) return null;
    const storageAfter = subtractContents(storage, fromStorage);
    const data = {
      resources: JSON.stringify({ ...this.base, backpack: subtractContents(backpack, fromBackpack), storage: storageAfter }),
      totalWoodCollected: this.totalWood,
      coins: this.coins + coins,
      totalCoinsEarned: this.totalCoinsEarned + coins,
    };
    // Desbloqueo de bosques en la MISMA transacción que la venta que cruza el umbral
    const unlockedAfter = Math.max(this.forests.unlockedForests, this.unlocksFor(data.totalCoinsEarned));
    if (unlockedAfter !== this.savedForests.unlockedForests) data.unlockedForests = unlockedAfter;
    const sale = { kind: 'sale', id: ++this.saleSeq, fromBackpack, storageAfter, units, earned: coins, unlockedBefore: this.forests.unlockedForests, done: false };
    return { data, sale };
  }

  /** La operación (venta o compra) está confirmada: se aplica en local una sola vez. */
  applySale(op, data) {
    if (op.done) return;
    op.done = true;
    if (op.kind === 'reset') {
      this.applyReset(data);
      return;
    }
    if (op.kind === 'purchase') {
      this.applyPurchase(op, data);
      return;
    }
    if (op.kind === 'skin') {
      this.applySkin(op);
      return;
    }
    if (op.kind === 'travel') {
      this.applyTravel(op, data);
      return;
    }
    if (op.kind === 'sleep') {
      this.applySleep(op);
      return;
    }
    if (op.kind === 'chest') {
      this.applyChest(op, data);
      return;
    }
    const sale = op;
    // Bosques desbloqueados por esta venta (ya guardados): se avisa una sola vez
    let unlockedNow = [];
    if (data.unlockedForests !== undefined) {
      this.savedForests = { ...this.savedForests, unlockedForests: data.unlockedForests };
      const before = Math.min(sale.unlockedBefore, this.forests.unlockedForests);
      this.forests = { ...this.forests, unlockedForests: Math.max(this.forests.unlockedForests, data.unlockedForests) };
      for (let id = before + 1; id <= this.forests.unlockedForests; id++) unlockedNow.push(id);
    }
    const before = this.coins;
    this.coins = data.coins;
    this.totalCoinsEarned = data.totalCoinsEarned;
    this.base = { ...this.base, storage: sale.storageAfter };
    this.onStorageChange(this.storageTotal);
    this.restoring = true; // Retirar lo vendido no es un cambio pendiente de guardar
    this.backpack.remove(sale.fromBackpack); // Lo recogido durante la venta se conserva
    this.restoring = false;
    this.onSale({ id: sale.id, earned: sale.earned, units: sale.units, coinsBefore: before, coins: this.coins, totalCoinsEarned: this.totalCoinsEarned, unlockedForests: unlockedNow });
  }

  /**
   * Se sabe que la venta NO se aplicó: ni monedas ni celebración (una sola vez).
   * deferred = el resultado se conoce más tarde (la venta había quedado pendiente): se avisa con
   * onSaleFailed. Si se sabe en la misma llamada a sell(), el aviso lo da su resultado.
   */
  saleFailed(op, reason, deferred = false) {
    if (!op || op.done) return;
    op.done = true;
    if (!deferred) return;
    if (op.kind === 'reset') this.onResetFailed(reason);
    else if (op.kind === 'purchase') this.onPurchaseFailed({ id: op.id, key: op.key, reason });
    else if (op.kind === 'skin') this.onSkinChangeFailed({ id: op.id, skinId: op.skinId, reason });
    else if (op.kind === 'travel') this.onTravelFailed({ id: op.id, forestId: op.forestId, reason });
    else if (op.kind === 'sleep') this.onSleepFailed({ id: op.id, reason });
    else if (op.kind === 'chest') this.onChestFailed({ id: op.id, forestId: op.forestId, slot: op.slot, reason });
    else this.onSaleFailed({ id: op.id, reason });
  }

  // ---------- Escritura (guardar, vender o comprar) ----------

  async write(mode, arg) {
    const userId = this.userId;
    const stale = () => this.userId !== userId; // Se cerró sesión mientras se esperaba
    try {
      // 1. Un intento anterior terminó sin respuesta: averiguar si llegó a guardarse
      if (this.uncertain) {
        const { snapshot, expected, sale } = this.uncertain;
        const row = await this.api.getProfile(userId);
        if (stale()) return { ok: true, status: this.status };
        const outcome = this.compare(row, snapshot, expected);
        if (outcome === 'other') {
          this.saleFailed(sale, 'conflicto', true);
          return this.conflictFound(row, expected);
        }
        this.uncertain = null; // Ya se sabe si se aplicó
        if (outcome === 'applied') {
          this.version = expected + 1;
          this.confirmed = pickSaved(snapshot);
          this.firstSaveVerified = true; // Versión y datos aplicados juntos (comprobado en la fila)
          if (sale) this.applySale(sale, snapshot); // Venta sin respuesta que sí se aplicó
          if (this.snapshotEquals(snapshot)) {
            this.dirty = false; // Lo guardado coincide con lo local: no hace falta reescribir
            this.dirtySince = null;
            if (mode === 'save') return this.confirmSaved();
          }
        } else {
          this.saleFailed(sale, 'no-aplicada', true); // La venta sin respuesta no llegó a aplicarse
        }
      }

      // 2. Primera vez en la sesión: comprobar que el servidor aplica la condición como se espera
      if (!this.guardChecked) {
        const result = await this.api.probe(userId, this.version);
        if (stale()) return { ok: true, status: this.status };
        if (result !== 'strict') {
          this.version += 1; // La comprobación se aplicó: saveVersion subió (sin tocar datos)
          return this.fail(SAVE_STATUS.CONDITION, 'condición-no-fiable', null, 'Appwrite aceptó un incremento que debía rechazar: la protección por versión no es fiable en este servidor. El guardado se ha desactivado; tu mochila sigue en memoria.');
        }
        this.guardChecked = true;
      }

      // 3. Escritura condicional del estado completo actual (y, si es una venta, sus monedas)
      let snapshot = null;
      let sale = null;
      if (mode === 'sale') {
        const plan = this.planSale();
        if (!plan) {
          this.confirmSaved();
          return { ok: false, reason: 'vacía', status: this.status };
        }
        ({ data: snapshot, sale } = plan);
      } else if (mode === 'reset') {
        ({ data: snapshot, op: sale } = this.planReset());
      } else if (mode === 'chest') {
        const plan = this.planChest(arg);
        if (plan.error) {
          this.confirmSaved();
          return { ok: false, reason: plan.error, status: this.status };
        }
        ({ data: snapshot, op: sale } = plan);
      } else if (mode === 'sleep') {
        const plan = this.planSleep();
        if (plan.error) {
          this.confirmSaved();
          return { ok: false, reason: plan.error, status: this.status };
        }
        ({ data: snapshot, op: sale } = plan);
      } else if (mode === 'travel') {
        const plan = this.planTravel(arg);
        if (plan.error) {
          this.confirmSaved();
          return { ok: false, reason: plan.error, status: this.status };
        }
        ({ data: snapshot, op: sale } = plan);
      } else if (mode === 'purchase') {
        const plan = this.planPurchase(arg);
        if (plan.error) {
          this.confirmSaved();
          return { ok: false, reason: plan.error, status: this.status };
        }
        ({ data: snapshot, op: sale } = plan);
      } else if (mode === 'skin') {
        const plan = this.planSkin(arg);
        if (plan.error) {
          this.confirmSaved();
          return { ok: false, reason: plan.error, status: this.status };
        }
        ({ data: snapshot, op: sale } = plan);
      } else {
        if (!this.dirty) return this.confirmSaved(); // La verificación anterior ya lo dejó guardado
        snapshot = this.snapshot();
      }
      if (snapshot.resources.length > this.s.maxResourcesLength) {
        this.saleFailed(sale, 'datos-demasiado-grandes');
        return this.fail(SAVE_STATUS.ERROR, 'datos-demasiado-grandes', null, 'La mochila no cabe en la columna resources (1000 caracteres).');
      }
      const expected = this.version;
      this.dirty = false;
      this.dirtySince = null;
      this.lazyOnly = false;
      this.setStatus(SAVE_STATUS.SAVING, sale ? ({ purchase: 'Comprando…', skin: 'Equipando apariencia…', sale: 'Vendiendo…', reset: 'Reiniciando…', travel: 'Viajando…', sleep: 'Durmiendo…', chest: 'Abriendo cofre…' }[sale.kind]) : null);
      let newVersion;
      try {
        newVersion = await this.api.save(userId, expected, snapshot);
      } catch (error) {
        if (stale()) return { ok: false, status: this.status };
        return this.handleFailure(error, snapshot, expected, sale);
      }
      if (stale()) return { ok: true, status: this.status };
      this.version = newVersion;

      // 4. Primer guardado de la sesión: leer la fila y comprobar que versión y datos se
      //    aplicaron JUNTOS (atomicidad). Hasta entonces no se muestra "Guardado".
      if (!this.firstSaveVerified) {
        let row;
        try {
          row = await this.api.getProfile(userId);
        } catch (error) {
          // Appwrite confirmó, pero no se pudo comprobar: el próximo intento verificará leyendo
          if (!stale()) this.uncertain = { snapshot, expected, sale };
          throw error;
        }
        if (stale()) return { ok: true, status: this.status };
        if (this.compare(row, snapshot, expected) !== 'applied') {
          this.dirty = true;
          this.saleFailed(sale, 'atomicidad');
          return this.fail(SAVE_STATUS.CONDITION, 'atomicidad', null, 'Tras guardar, la versión y los datos de Appwrite no coinciden con lo enviado. El guardado se ha desactivado; tu mochila sigue en memoria.');
        }
        this.firstSaveVerified = true;
      }
      this.confirmed = pickSaved(snapshot);
      if (sale) {
        this.applySale(sale, snapshot);
        const info = sale.kind === 'purchase' ? { purchase: { id: sale.id, key: sale.key, level: sale.level } } : sale.kind === 'skin' ? { skin: sale.skinId } : sale.kind === 'reset' ? { reset: true } : { sale: { id: sale.id, earned: sale.earned } };
        return { ...this.confirmSaved(), ok: true, ...info };
      }
      return this.confirmSaved();
    } catch (error) {
      // Error al leer o en la comprobación inicial: se clasifica igual que un guardado
      if (stale()) return { ok: false, status: this.status };
      this.dirty = true;
      return this.handleKind(this.api.classify(error), error);
    }
  }

  confirmSaved() {
    this.retryIndex = 0;
    if (this.dirty) {
      this.setStatus(SAVE_STATUS.PENDING);
      this.schedule(); // Llegaron cambios mientras se guardaba
    } else {
      this.setStatus(SAVE_STATUS.SAVED);
    }
    return { ok: !this.dirty, status: this.status };
  }

  /** Un guardado falló. Los datos locales nunca se descartan. */
  async handleFailure(error, snapshot, expected, sale = null) {
    this.dirty = true; // Lo local sigue pendiente
    this.dirtySince ??= this.clock.now();
    const kind = this.api.classify(error);

    if (kind === 'condition') {
      // La condición del incremento no se cumplió: se lee la fila para saber por qué
      const userId = this.userId;
      const row = await this.api.getProfile(userId);
      if (this.userId !== userId) return { ok: false, status: this.status };
      if (row && row.saveVersion === expected) {
        // La versión NO cambió y aun así se rechazó: no es un conflicto. No se ajusta nada.
        const untouched = row.resources === this.confirmed?.resources && row.totalWoodCollected === this.confirmed?.totalWoodCollected;
        this.saleFailed(sale, 'condición');
        return this.fail(SAVE_STATUS.CONDITION, untouched ? 'fallo-condición' : 'atomicidad', error, untouched
          ? `Appwrite rechazó la condición de saveVersion aunque la versión era la esperada (${expected}). El guardado se ha desactivado; tu mochila sigue en memoria.`
          : 'La condición de saveVersion falló pero los datos de la fila cambiaron: posible escritura parcial. El guardado se ha desactivado.');
      }
      if (this.compare(row, snapshot, expected) === 'applied') {
        this.version = expected + 1;
        this.confirmed = pickSaved(snapshot);
        if (sale) this.applySale(sale, snapshot);
        if (this.snapshotEquals(snapshot)) {
          this.dirty = false;
          this.dirtySince = null;
        }
        return this.confirmSaved();
      }
      this.saleFailed(sale, 'conflicto');
      return this.conflictFound(row, expected, error);
    }
    if (kind === 'network' || kind === 'tx-conflict') {
      // No se sabe si se aplicó (o la fila cambió mientras se preparaba): se verificará antes.
      // Una venta NO se reenvía: solo se comprobará si llegó a aplicarse.
      this.uncertain = { snapshot, expected, sale };
      return { ...this.handleKind(kind, error), pending: Boolean(sale) };
    }
    if (kind === 'invalid' && sale?.kind === 'purchase') {
      // Appwrite rechazó el VALOR del nuevo nivel (p. ej. la columna tiene un máximo menor). La
      // transacción es atómica: no se aplicó nada (ni el cobro ni la versión). Solo falla la
      // compra; la mochila y el resto del progreso se siguen guardando con normalidad.
      this.saleFailed(sale, 'nivel-rechazado');
      this.lastError = { kind: 'nivel-rechazado', type: error?.type ?? null, code: error?.code ?? null, message: error?.message ?? String(error ?? ''), at: new Date(this.clock.now()).toISOString() };
      console.error(`[Timber Rush] Compra rechazada por Appwrite (${sale.column} = ${sale.level}): ${this.lastError.message}`, this.lastError);
      this.setStatus(SAVE_STATUS.PENDING);
      this.schedule();
      return { ok: false, reason: 'nivel-rechazado', status: this.status };
    }
    this.saleFailed(sale, kind);
    return this.handleKind(kind, error);
  }

  handleKind(kind, error) {
    if (kind === 'network' || kind === 'tx-conflict') return this.scheduleRetry(error, kind);
    if (kind === 'permission') return this.fail(SAVE_STATUS.PERMISSION, 'permisos', error, 'Sin permiso para guardar (¿sesión caducada?). Tu mochila sigue en memoria.');
    if (kind === 'unsupported') return this.fail(SAVE_STATUS.UNSUPPORTED, 'transacción-no-compatible', error, 'Este servidor de Appwrite no admite las transacciones necesarias. Tu mochila sigue en memoria.');
    if (kind === 'condition') return this.fail(SAVE_STATUS.CONDITION, 'fallo-condición', error, 'La comprobación de saveVersion falló de forma inesperada. Tu mochila sigue en memoria.');
    return this.fail(SAVE_STATUS.ERROR, 'datos-rechazados', error, 'Appwrite rechazó los datos de la mochila. Tu mochila sigue en memoria.');
  }

  /**
   * Compara la fila con un intento:
   *  'applied'     → tiene la versión siguiente y exactamente esos datos
   *  'not-applied' → la versión sigue igual
   *  'other'       → otra sesión la cambió
   */
  compare(row, snapshot, expected) {
    if (!row) return 'other';
    if (row.saveVersion === expected) return 'not-applied';
    // Todas las columnas enviadas (en una venta también coins y totalCoinsEarned)
    const same = row.saveVersion === expected + 1 && Object.keys(snapshot).every((k) => row[k] === snapshot[k]);
    return same ? 'applied' : 'other';
  }

  snapshotEquals(snapshot) {
    const now = this.snapshot();
    return now.resources === snapshot.resources && now.totalWoodCollected === snapshot.totalWoodCollected;
  }

  /** Conflicto real de versiones: otra sesión guardó. No se escribe nada más. */
  conflictFound(row, expected, error = null) {
    this.dirty = true;
    this.uncertain = null;
    if (this.timer) this.clock.clearTimeout(this.timer);
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
    const remote = row?.saveVersion ?? '?';
    return this.fail(SAVE_STATUS.CONFLICT, 'conflicto-versiones', error, `Tu progreso se modificó desde otra sesión (versión ${remote}, esperada ${expected}). No se ha sobrescrito: recarga la página. Tu mochila sigue en memoria.`);
  }

  scheduleRetry(error, kind) {
    const delays = this.s.retryDelays;
    const delay = delays[Math.min(this.retryIndex, delays.length - 1)];
    this.retryIndex++;
    this.dirty = true;
    this.dirtySince ??= this.clock.now();
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      this.flush();
    }, delay);
    const reason = kind === 'tx-conflict' ? 'la fila cambió mientras se guardaba; se comprobará' : 'sin conexión con Appwrite';
    this.lastError = { kind: kind === 'tx-conflict' ? 'transacción-en-conflicto' : 'conexión', type: error?.type ?? null, code: error?.code ?? null, message: error?.message ?? String(error ?? ''), at: new Date(this.clock.now()).toISOString() };
    console.warn(`[Timber Rush] Guardado de la mochila — ${this.lastError.kind}; reintento en ${delay / 1000} s`, this.lastError);
    this.setStatus(SAVE_STATUS.RETRYING, `No se pudo guardar (${reason}). Reintento en ${Math.round(delay / 1000)} s.`);
    return { ok: false, status: SAVE_STATUS.RETRYING, kind };
  }
}
