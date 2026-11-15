// Punto de entrada de Timber Rush 3D.
// Coordina las pantallas (ui.js) con la autenticación (appwrite.js).
// FASE 2: flujo de registro, inicio de sesión, recuperación de sesión y cierre de sesión.
// FASE 7A: la mochila se restaura al entrar y se guarda en Appwrite (progressSync.js).
// FASE 7B: venta segura con F en el aserradero; la celebración solo llega tras confirmarla.
// FASE 8: tienda con B: compras seguras de mejoras (hacha, mochila, aserradero).
// FASE 9: trabajadores: producen madera en el almacén mientras se juega (se vende con F).
// FASE 10: menú principal cinematográfico: Continuar (con comprobación del progreso y
//          transición de cámara), Nueva partida (segura, con REINICIAR), Estadísticas,
//          Configuración (en este navegador) y Cerrar sesión.
import './style.css';
import { Game } from './game/Game.js';
import * as api from './appwrite.js';
import * as ui from './ui.js';
import { ProgressSync, SAVE_STATUS } from './progressSync.js';
import { chestReward, forestList, nextUpgrade, productionStats, purchaseOffer, saleValue, shopItems, unlockedForestCount } from './game/economy.js';
import { SaleCelebrationSequence } from './game/saleSequence.js';
import { forestById, WORKERS } from './config.js';
import { Settings } from './settings.js';

// El bosque se dibuja desde el principio: detrás de la autenticación y del menú se ve la
// vista cinematográfica (sin gameplay: el juego solo se simula al pulsar Continuar).
const game = new Game(document.getElementById('game-container'));
game.start();

// Configuración del navegador (Fase 10): se aplica al instante y se conserva al recargar
const settings = new Settings();
game.applySettings(settings.values);
settings.onChange = (values) => {
  game.applySettings(values);
  ui.renderSettings(values);
};
ui.renderSettings(settings.values);
ui.bindSettings((key, value) => settings.set(key, value));

let currentUser = null; // Usuario de Appwrite con sesión activa
let busy = false; // Evita enviar dos peticiones a la vez

// Sincronización de la mochila con la fila de progreso del usuario
const sync = new ProgressSync({
  api: { getProfile: api.getProfile, save: api.saveProgressFields, probe: api.probeVersionGuard, classify: api.classifySaveError },
  saleValue,
  purchaseOffer,
  forestUnlocks: unlockedForestCount, // Bosques desbloqueados por monedas históricas (Fase 11A)
  chestReward, // Recompensa determinista de cada cofre (Fase 11C)
  storageCapacity: WORKERS.storageCapacity,
  productionDelay: WORKERS.saveDelay, // La producción se guarda como mucho cada 30 s
});
sync.onStatus = ui.showSaveStatus;

// ---------- Venta (Fase 7B) ----------
// La fuente de verdad es el saldo CONFIRMADO (sync.coins). El contador animado solo lo muestra.
// Vender NO mejora nada automáticamente: solo suma monedas. Los niveles (hacha, mochila,
// aserradero, trabajadores…) solo cambiarán con una compra explícita en la tienda (Fase 8).
const celebration = new SaleCelebrationSequence({
  banner: ui.saleBanner,
  sound: { play: (name, delay) => game.audio.playUi(name, delay), stopAll: () => game.audio.stopUi() },
  burst: () => game.burstSaleCoins(),
});
sync.onSale = (sale) => {
  celebration.celebrate(sale); // Una sola vez por venta confirmada (por su identificador)
  ui.coinCounter.animateTo(sale.coins);
  ui.renderUpgradeProgress(nextUpgrade(sync.levels), sale.coins);
  ui.updateMenuCoins(sale.coins, sale.totalCoinsEarned);
  // Fase 11A: la venta (ya guardada) desbloqueó bosques nuevos
  if (sale.unlockedForests?.length) {
    const names = sale.unlockedForests.map((id) => forestById(id).name).join(', ');
    ui.showSaleMessage(`¡Nuevo bosque desbloqueado: ${names}! Viaja desde el poste del campamento (E).`);
    ui.renderMenu({ coins: sync.coins, totalCoinsEarned: sync.totalCoinsEarned, unlockedForests: sync.forests.unlockedForests });
  }
};
sync.onSaleFailed = ({ reason }) => {
  ui.showSaleMessage(`La venta no se completó (${reason}). Tu madera sigue en la mochila.`);
};
const SALE_MESSAGES = {
  vacía: 'No llevas madera para vender.',
  [SAVE_STATUS.CONFLICT]: 'No se puede vender: tu progreso cambió en otra sesión. Recarga la página.',
  [SAVE_STATUS.CONDITION]: 'No se puede vender: el guardado está desactivado (ver aviso de la mochila).',
  [SAVE_STATUS.BLOCKED]: 'No se puede vender: los datos guardados no son válidos.',
};
game.onSellZoneChange = ui.showSellPrompt;

// ---------- Trabajadores y almacén (Fase 9) ----------
const renderStorage = () => {
  const { batch, cycle } = productionStats(sync.levels.sawmillLevel ?? 0); // Ritmo según el aserradero
  ui.renderStorage({ total: sync.storageTotal, capacity: WORKERS.storageCapacity, workers: sync.levels.workers ?? 0, batch, cycle });
};
sync.onStorageChange = (total) => {
  renderStorage();
  game.setStoragePile(total / WORKERS.storageCapacity); // La pila del aserradero crece con el almacén
};
game.storageFree = () => sync.storageFree;
// Madera del bosque actual (por ahora, el Bosque Verde)
// Fase 11A: SIEMPRE madera del Bosque Verde (2 monedas/u), estés en el bosque que estés
game.onWorkersProduce = (units) => sync.addToStorage(WORKERS.woodForestId, units);

// ---------- Bosques (Fase 11A) ----------
// Viajar es gratis. El cambio de bosque solo ocurre cuando Appwrite confirma currentForest
// (misma escritura versionada y atómica). La mochila, el almacén y las monedas no cambian; la
// madera del suelo y los árboles talados de cada bosque se conservan en memoria (Game.js).
const FOREST_SWATCH = (f) => `#${(f.theme?.foliage?.[0] ?? f.colors.meadow).toString(16).padStart(6, '0')}`;
let travelBusyId = null;
const renderTravel = () =>
  ui.renderTravel(
    forestList(sync.totalCoinsEarned, sync.forests.unlockedForests, sync.forests.currentForest).map((f) => ({ ...f, swatch: FOREST_SWATCH(forestById(f.id)) })),
    sync.totalCoinsEarned,
    travelBusyId
  );
game.onTravelPostChange = ui.showTravelPrompt;
game.onTravelChange = (open) => {
  ui.showTravel(open);
  if (open) renderTravel();
};
/**
 * Cambia de bosque. Desde el panel de viaje: la cámara sube entre las nubes, el bosque cambia
 * oculto por ellas (con el nombre del destino) y baja hasta el Worker; el juego sigue congelado.
 * Fuera de la partida (p. ej. un viaje verificado más tarde, en el menú): cambio directo.
 */
let forestSwitch = Promise.resolve();
function switchForest(forestId) {
  const cinematic = game.session.inTravel;
  if (cinematic) ui.showTravel(false); // El panel se aparta: se ve el viaje
  const run = cinematic
    ? game.travelTo(forestId, { onPeak: () => ui.showForestTitle(forestById(forestId)), onClear: () => ui.showForestTitle(null) })
    : game.setForest(forestId);
  forestSwitch = run.finally(() => {
    ui.showForestTitle(null);
    ui.setForestHud(forestById(game.forestId).name);
  });
  return forestSwitch;
}
sync.onTravel = ({ forestId }) => switchForest(forestId); // Confirmado en Appwrite
sync.onTravelFailed = ({ forestId, reason }) => {
  ui.showSaleMessage(`No se pudo guardar el viaje al ${forestById(forestId).name} (${reason}).`);
};
const TRAVEL_MESSAGES = {
  bloqueado: 'Este bosque todavía está bloqueado.',
  'mismo-bosque': 'Ya estás en este bosque.',
  'no-existe': 'Ese bosque no existe.',
  'en-curso': 'Espera a que termine la operación en curso.',
  [SAVE_STATUS.CONFLICT]: 'No se puede viajar: tu progreso cambió en otra sesión. Recarga la página.',
  [SAVE_STATUS.CONDITION]: 'No se puede viajar: el guardado está desactivado.',
  [SAVE_STATUS.BLOCKED]: 'No se puede viajar: los datos guardados no son válidos.',
};
ui.bindTravelEvents({
  onTravel: async (forestId) => {
    if (travelBusyId !== null) return;
    travelBusyId = forestId;
    game.session.travelBusy = true; // El panel no se cierra durante el viaje
    renderTravel();
    ui.showTravelMessage(`Viajando al ${forestById(forestId).name}…`);
    let result;
    try {
      result = await sync.travel(forestId);
      if (result.ok) await forestSwitch.catch(() => {}); // Viaje entre las nubes hasta el bosque nuevo
    } finally {
      travelBusyId = null;
      game.session.travelBusy = false;
    }
    if (result.ok && game.forestId === forestId) {
      game.session.closeTravel({ force: true }); // De vuelta al juego en el bosque nuevo
      return;
    }
    if (result.ok) {
      // Guardado, pero el bosque no se pudo construir (p. ej. falta memoria): se avisa
      ui.showTravel(true);
      renderTravel();
      ui.showTravelMessage('El viaje se guardó, pero el bosque no se pudo cargar. Recarga la página para continuar allí.', true);
      return;
    }
    renderTravel();
    const text = TRAVEL_MESSAGES[result.reason] ?? `No se pudo guardar el viaje (${result.reason ?? result.status}). Sigues en el ${forestById(game.forestId).name}.`;
    ui.showTravelMessage(text, true);
  },
  onClose: () => game.session.closeTravel(),
});

// ---------- Día y noche (Fase 11B) ----------
// El reloj es global y solo avanza jugando. Su hora viaja dentro de resources en TODAS las
// escrituras (sin guardado aparte). Dormir: solo de noche, junto a la tienda; el amanecer solo
// se muestra cuando Appwrite confirma el nuevo día.
game.onClockChange = (state) => sync.setClock(state);
game.onClockDisplay = (text, night) => ui.renderClock(text, night);
game.onRestPromptChange = ui.showRestPrompt;
game.onRestDenied = () => ui.showSaleMessage('Solo puedes dormir de noche (de 20:00 a 06:00).');
sync.onSleep = ({ clock }) => game.setClock(clock); // Confirmado: el día siguiente a las 06:00
sync.onSleepFailed = ({ reason }) => ui.showSaleMessage(`No se pudo guardar el descanso (${reason}).`);
const SLEEP_MESSAGES = {
  'no-es-de-noche': 'Ya no es de noche: no hace falta dormir.',
  'en-curso': 'Espera a que termine la operación en curso.',
  [SAVE_STATUS.CONFLICT]: 'No se pudo dormir: tu progreso cambió en otra sesión. Recarga la página.',
  [SAVE_STATUS.CONDITION]: 'No se pudo dormir: el guardado está desactivado.',
  [SAVE_STATUS.BLOCKED]: 'No se pudo dormir: los datos guardados no son válidos.',
};
let sleeping = false;
game.onSleepRequest = async () => {
  if (sleeping || !game.session.startSleep()) return; // Una sola vez aunque se pulse E varias veces
  sleeping = true;
  try {
    sync.setClock(game.clock.toJSON()); // La hora exacta antes de dormir
    await ui.showSleep(true); // Fundido a negro: "Durmiendo…"
    const result = await sync.sleep();
    if (result.ok) {
      ui.showSleepDay(`Día ${game.clock.day}`); // Amanece (reloj ya guardado)
      await new Promise((r) => setTimeout(r, 1300));
    } else {
      ui.showSaleMessage(SLEEP_MESSAGES[result.reason] ?? `No se pudo guardar el descanso (${result.reason ?? result.status}). Sigues en la misma noche.`);
    }
  } finally {
    await ui.showSleep(false);
    game.session.endSleep();
    sleeping = false;
  }
};

// ---------- Cofres y tesoros (Fase 11C) ----------
// Abrir = una escritura versionada (monedas + cofre abierto). El oro, la tapa abierta y la
// celebración solo llegan con la confirmación de Appwrite (onChest). La partida NO se detiene.
game.chestsOpened = (forestId, day) => sync.openedChests(forestId, day);
game.onChestPromptChange = ui.showChestPrompt;
const CHEST_MESSAGES = {
  'ya-abierto': 'Este cofre ya está vacío. Vuelve mañana.',
  'en-curso': 'Espera un momento: hay otra operación en curso.',
  'otro-bosque': 'Este cofre es de otro bosque.',
  [SAVE_STATUS.CONFLICT]: 'No se pudo abrir: tu progreso cambió en otra sesión. Recarga la página.',
  [SAVE_STATUS.CONDITION]: 'No se pudo abrir: el guardado está desactivado.',
  [SAVE_STATUS.BLOCKED]: 'No se pudo abrir: los datos guardados no son válidos.',
};
let chestBusy = false;
const celebrated = new Set(); // Cofres ya celebrados al abrirlos (no se repite al confirmar)
const CHEST_SOUNDS = { comun: 'chest_coins_small', raro: 'chest_coins', legendario: 'chest_treasure' };
game.onChestRequest = async ({ forestId, slot, day, kind }) => {
  if (chestBusy) return; // Pulsar E varias veces no abre (ni cobra) dos veces
  chestBusy = true;
  // Respuesta inmediata: tapa y cerradura ya; a los 0,25 s, monedas, su sonido y el anuncio con la
  // cantidad (es fija: se conoce antes de guardar). El SALDO solo cambia con la confirmación.
  game.setChestPending(slot, true);
  const key = `${forestId}:${day}:${slot}`;
  const reward = chestReward(forestId, day, slot);
  const preview = setTimeout(() => {
    celebrated.add(key);
    game.chestBurst(slot, kind);
    game.audio.playUi(CHEST_SOUNDS[kind] ?? 'chest_coins');
    ui.chestBanner.show({ kind, earned: reward?.coins ?? 0, pending: true });
  }, 250);
  let result = { ok: false, status: 'error' };
  try {
    sync.setClock(game.clock.toJSON()); // El día exacto del cofre
    result = await sync.openChest(forestId, slot);
    if (!result.ok && result.reason !== undefined) {
      ui.showSaleMessage(CHEST_MESSAGES[result.reason] ?? `No se pudo abrir el cofre (${result.reason ?? result.status}). Sigue cerrado.`);
    } else if (!result.ok && !result.pending) {
      ui.showSaleMessage(`No se pudo abrir el cofre (${result.status}). Sigue cerrado.`);
    }
  } finally {
    // Si Appwrite respondió antes de los 0,25 s, onChest ya lo celebró: no se repite
    clearTimeout(preview);
    // Respuesta perdida (pending): se sabrá al verificar; mientras tanto, la tapa vuelve a cerrarse
    if (!result.ok) {
      if (celebrated.delete(key)) ui.chestBanner.fail(); // El anuncio pasa a "no se guardó"
      game.chestFailed(slot);
    }
    game.setChestPending(slot, false);
    chestBusy = false;
  }
};
sync.onChest = (chest) => {
  // Confirmado en Appwrite. Si ya se celebró al abrirlo, solo se actualiza el saldo; si la
  // confirmación llega más tarde (respuesta perdida y verificada), se celebra ahora.
  const key = `${chest.forestId}:${chest.day}:${chest.slot}`;
  const already = celebrated.delete(key);
  game.chestOpened(chest, { celebrate: !already });
  if (already) ui.chestBanner.confirm();
  else {
    ui.chestBanner.show(chest);
    game.audio.playUi(CHEST_SOUNDS[chest.kind] ?? 'chest_coins');
  }
  ui.coinCounter.animateTo(chest.coins);
  ui.renderUpgradeProgress(nextUpgrade(sync.levels), chest.coins);
  ui.updateMenuCoins(chest.coins, chest.totalCoinsEarned);
  if (chest.unlockedForests?.length) {
    const names = chest.unlockedForests.map((id) => forestById(id).name).join(', ');
    ui.showSaleMessage(`¡Nuevo bosque desbloqueado: ${names}! Viaja desde el poste del campamento (E).`);
    ui.renderMenu({ coins: sync.coins, totalCoinsEarned: sync.totalCoinsEarned, unlockedForests: sync.forests.unlockedForests });
  }
};
sync.onChestFailed = ({ reason }) => ui.showSaleMessage(`No se pudo guardar el cofre (${reason}). Sigue cerrado.`);

// ---------- Tienda (Fase 8) ----------
// Los datos de las tarjetas salen siempre del saldo y los niveles CONFIRMADOS (sync).
// Comprar no cambia nada en el juego hasta que Appwrite confirma la compra (onPurchase).
let shopBusy = null; // Mejora que se está comprando
const renderShop = () => ui.renderShop(shopItems(sync.levels, sync.coins), sync.coins, shopBusy);
const PURCHASE_MESSAGES = {
  'saldo-insuficiente': 'No tienes monedas suficientes.',
  'nivel-máximo': 'Esa mejora ya está al máximo.',
  'en-curso': null, // Ya hay una operación en curso: no hace falta avisar
  vacía: null,
  [SAVE_STATUS.CONFLICT]: 'No se puede comprar: tu progreso cambió en otra sesión. Recarga la página.',
  [SAVE_STATUS.CONDITION]: 'No se puede comprar: el guardado está desactivado (ver aviso).',
  [SAVE_STATUS.BLOCKED]: 'No se puede comprar: los datos guardados no son válidos.',
};
game.onShopChange = (open) => {
  ui.showShop(open);
  if (open) renderShop();
};
ui.bindShopEvents({
  onClose: () => game.closeShop(), // Clic del usuario: permite volver a capturar el cursor
  onBuy: async (key) => {
    if (shopBusy) return;
    shopBusy = key;
    renderShop();
    const result = await sync.buy(key);
    shopBusy = null;
    renderShop();
    if (result.ok) return; // onPurchase ya informó
    if (result.pending) ui.showShopMessage('Sin respuesta de Appwrite: comprobando si la compra se completó…', true);
    else {
      const text = PURCHASE_MESSAGES[result.reason] ?? PURCHASE_MESSAGES[result.status];
      if (text !== null) ui.showShopMessage(text ?? 'No se pudo completar la compra. No se ha cobrado nada.', true);
    }
  },
});
sync.onPurchase = (purchase) => {
  // Efectos solo con la compra confirmada: hacha en la mano y daño, capacidad de la mochila
  // (la aplica sync) o bonificación del aserradero (la usa la próxima venta)
  if (purchase.key === 'axe') game.setAxeLevel(purchase.level);
  if (purchase.key === 'workers') {
    game.setWorkerCount(purchase.level); // Aparece en su puesto del aserradero y empieza a producir
    renderStorage();
  }
  if (purchase.key === 'sawmill') {
    game.setSawmillLevel(purchase.level); // Nuevas construcciones y trabajadores más productivos
    renderStorage();
  }
  if (purchase.key === 'home') {
    // Vivienda (Fase 11D): SOLO el aspecto de la aldea. Ningún sistema del juego lee este nivel.
    game.setHomeLevel(purchase.level);
    game.villageCelebration();
    ui.villageBanner.show(purchase.level);
  }
  ui.coinCounter.animateTo(purchase.coins);
  ui.renderUpgradeProgress(nextUpgrade(sync.levels), purchase.coins);
  ui.updateMenuCoins(purchase.coins, sync.totalCoinsEarned);
  renderShop();
  ui.flashShopCard(purchase.key);
  const item = shopItems(purchase.levels, purchase.coins).find((i) => i.key === purchase.key);
  ui.showShopMessage(purchase.key === 'home' ? `¡Tu aldea ha crecido! ${item.effect} (solo decorativo).` : `¡${item.name} nivel ${purchase.level}! ${item.effect}.`);
  game.audio.playUi(purchase.key === 'home' ? 'village_build' : 'sale_levelup');
};
sync.onPurchaseFailed = ({ reason }) => {
  ui.showShopMessage(`La compra no se completó (${reason}). No se ha cobrado nada.`, true);
  renderShop();
};
game.onSellRequest = async () => {
  const result = await sync.sell();
  if (result.ok || result.reason === 'en-curso') return; // La celebración la dispara onSale
  if (result.pending) ui.showSaleMessage('Sin respuesta de Appwrite: comprobando si la venta se completó…');
  else ui.showSaleMessage(SALE_MESSAGES[result.reason] ?? SALE_MESSAGES[result.status] ?? 'No se pudo vender. Tu madera sigue en la mochila.');
};

/** Ejecuta una acción asíncrona bloqueando los botones y mostrando errores. */
async function runAction(action) {
  if (busy) return;
  busy = true;
  ui.setBusy(true);
  try {
    await action();
  } catch (error) {
    console.error(error);
    ui.showAuthMessage(api.describeError(error), 'error');
  } finally {
    busy = false;
    ui.setBusy(false);
  }
}

/** Tras iniciar sesión: si el usuario no tiene perfil, debe elegir nombre. */
async function afterLogin(user) {
  currentUser = user;
  const profile = await api.getProfile(user.$id);
  if (profile) {
    enterMenu(profile);
  } else {
    ui.showScreen('auth');
    ui.showAuthForm('username');
  }
}

function enterMenu(profile) {
  ui.renderMenu(profile);
  // Restaura la mochila (capacidad 20/40/80 según backpackLevel) desde la fila recién leída.
  // Si la lectura hubiera fallado no se llegaría aquí: nunca se confunde con una mochila vacía.
  const { damaged } = sync.attach(currentUser.$id, profile, game.backpack);
  applyProgressToGame();
  ui.clearAuthMessage();
  if (damaged) ui.showAuthMessage('Los datos guardados de tu mochila no son válidos. No se modificarán hasta revisarlos.', 'error');
  ui.showMenuSection('main');
  ui.fadeMenu(false);
  ui.showScreen('menu');
}

/** Lleva al juego y a la interfaz el progreso CONFIRMADO (al entrar, al restaurar o al reiniciar). */
function applyProgressToGame() {
  ui.coinCounter.set(sync.coins); // Saldo real guardado, sin animación
  game.setAxeLevel(sync.levels.axeLevel); // Hacha del nivel guardado (modelo y daño)
  game.setWorkerCount(sync.levels.workers ?? 0); // Trabajadores contratados
  game.setSawmillLevel(sync.levels.sawmillLevel ?? 0); // Etapa visual y producción del aserradero guardados
  game.setClock(sync.gameClock); // Día y hora guardados (Fase 11B)
  game.setHomeLevel(sync.levels.home ?? 0); // Aldea del nivel comprado (Fase 11D, solo visual)
  game.refreshChests(); // Cofres del día con los ya abiertos (Fase 11C)
  sync.warmUp(); // Comprobación de seguridad de la sesión ya, no en la primera operación
  // Bosque guardado (Fase 11A): se construye en segundo plano; Continuar espera a que esté listo
  game.setForest(sync.forests.currentForest).then(() => ui.setForestHud(forestById(game.forestId).name), () => {});
  renderStorage();
  ui.renderBackpack(game.backpack);
  ui.renderUpgradeProgress(nextUpgrade(sync.levels), sync.coins);
  ui.renderMenu({ coins: sync.coins, totalCoinsEarned: sync.totalCoinsEarned, unlockedForests: sync.forests.unlockedForests });
}

// ---------- Menú principal ----------
// La partida avisa a la interfaz de la pausa y de si hace falta un clic para capturar el cursor
game.onPauseChange = (paused) => {
  ui.showPause(paused);
  if (paused) sync.flush(); // Guardar al pausar
};
game.onLockHint = ui.showLockHint;
// Indicador de la mochila (Fase 7A)
game.onBackpackChange = (backpack) => {
  ui.renderBackpack(backpack);
  sync.markDirty(); // Guardado diferido (4 s, máximo 10 s): nunca en cada fotograma
};
game.onWoodCollected = (units) => sync.recordCollected(units);
game.onBackpackFull = ui.flashBackpackFull;
ui.renderBackpack(game.backpack);

let entering = false; // "Continuar" en curso (evita dobles clics)
ui.bindMenuEvents({
  /**
   * Continuar partida: 1) pide el cursor en este mismo clic (el navegador lo exige), 2) guarda
   * lo pendiente y comprueba la fila en Appwrite (si otra sesión la cambió, se restaura), 3) solo
   * entonces la cámara baja hasta el Worker y, al terminar, se activan los controles.
   */
  onPlay: () => {
    if (entering || !game.beginEnter()) return;
    entering = true;
    ui.fadeMenu(true);
    (async () => {
      try {
        await game.ready;
        const result = await sync.refreshFromServer();
        if (!result.ok) throw new Error(result.reason);
        if (result.reloaded) applyProgressToGame(); // Progreso cambiado en otra sesión
        await game.forestTask; // El bosque guardado ya está construido
        ui.showScreen('game');
        game.startEnterTransition(() => {
          entering = false;
        });
      } catch (error) {
        console.error('[Timber Rush] No se pudo comprobar el progreso antes de jugar', error);
        game.cancelEnter(); // Se libera el cursor y se queda en el menú
        ui.fadeMenu(false);
        entering = false;
        ui.showAuthMessage('No se pudo comprobar tu progreso en Appwrite. Revisa la conexión e inténtalo de nuevo.', 'error');
      }
    })();
  },
  onResume: () => game.resume(),
  /** Volver al menú (desde la pausa): se detiene la partida, se guarda y la cámara sube a la órbita. */
  onBackToMenu: () => {
    const left = game.leaveToMenu(() => {
      ui.showMenuSection('main');
      ui.fadeMenu(false); // El panel aparece cuando la cámara ya está en la órbita
    });
    if (!left) return;
    ui.fadeMenu(true);
    ui.showScreen('menu');
    sync.flush(); // Guardar al volver al menú
  },
  onShowStats: () => ui.renderStats({ ...sync.stats(), currentForestName: forestById(sync.forests.currentForest).name, clockText: game.clock.format() }),
  /** Nueva partida: solo llega aquí con "REINICIAR" escrito (lo comprueba ui.js). */
  onNewGame: async () => {
    ui.setNewGameBusy(true);
    ui.setNewGameStatus('Reiniciando… no cierres la página.');
    const result = await sync.resetProgress();
    ui.setNewGameBusy(false);
    if (result.ok) return; // onReset ya lo aplicó
    if (result.pending) ui.setNewGameStatus('Sin respuesta de Appwrite: comprobando si se reinició…', true);
    else ui.setNewGameStatus(`No se reinició nada (${result.reason ?? result.status}). Tu partida sigue igual.`, true);
  },
});

// ---------- Nueva partida (Fase 10) ----------
// Solo con el reinicio CONFIRMADO por Appwrite (también si se confirma más tarde, tras una
// respuesta perdida): bosque intacto, Worker al inicio y todo el progreso a sus valores iniciales.
sync.onReset = () => {
  celebration.cancel();
  game.resetWorld();
  applyProgressToGame();
  ui.setNewGameStatus('¡Nueva partida lista! Pulsa «Continuar partida» para empezar.');
};
sync.onResetFailed = (reason) => {
  ui.setNewGameStatus(`El reinicio no se completó (${reason}). Tu partida sigue igual.`, true);
};

// ---------- Manejadores de los formularios ----------
ui.bindAuthEvents({
  onLogin: ({ email, password }) =>
    runAction(async () => {
      ui.clearPasswords();
      const user = await api.login(email, password);
      await afterLogin(user);
    }),

  onRegister: ({ username, email, password, password2 }) => {
    // Validaciones previas en el cliente (la validación real la hace Appwrite)
    const usernameError = api.validateUsername(username);
    if (usernameError) return ui.showAuthMessage(usernameError);
    if (password.length < 8) return ui.showAuthMessage('La contraseña debe tener al menos 8 caracteres.');
    if (password !== password2) return ui.showAuthMessage('Las contraseñas no coinciden.');

    runAction(async () => {
      ui.clearPasswords();
      currentUser = await api.register(email, password, username);
      try {
        const profile = await api.createProfile(currentUser, username);
        enterMenu(profile);
      } catch (error) {
        if (error.type !== api.USERNAME_TAKEN) throw error;
        // La cuenta ya existe, pero el nombre estaba ocupado: pedimos otro
        ui.showAuthForm('username');
        ui.showAuthMessage(api.describeError(error));
      }
    });
  },

  onChooseUsername: (username) => {
    const usernameError = api.validateUsername(username);
    if (usernameError) return ui.showAuthMessage(usernameError);
    runAction(async () => {
      const profile = await api.createProfile(currentUser, username);
      enterMenu(profile);
    });
  },

  onLogout: () =>
    runAction(async () => {
      // Antes de salir: guardar lo pendiente y esperar el resultado
      if (!(await saveBeforeLogout())) return; // El jugador decidió no salir
      sync.detach();
      celebration.cancel();
      game.resetPlayerData(); // La siguiente cuenta empieza sin la mochila ni la madera de esta
      await api.logout();
      currentUser = null;
      ui.showScreen('auth');
      ui.showAuthForm('login');
      ui.showAuthMessage('Sesión cerrada correctamente.', 'success');
    }),
});

/**
 * Guarda los cambios pendientes antes de cerrar sesión. Si no se puede, pregunta al jugador:
 * reintentar, salir sin guardar o cancelar. Devuelve true si se puede cerrar la sesión.
 */
async function saveBeforeLogout() {
  for (;;) {
    const result = await sync.flush();
    if (result.ok) return true;
    const reason = {
      [SAVE_STATUS.CONFLICT]: 'Tu progreso se modificó desde otra sesión y no se ha sobrescrito.',
      [SAVE_STATUS.PERMISSION]: 'Appwrite denegó el permiso para guardar (¿sesión caducada?).',
      [SAVE_STATUS.UNSUPPORTED]: 'Este servidor de Appwrite no admite las transacciones necesarias.',
      [SAVE_STATUS.CONDITION]: 'La comprobación de versión de Appwrite no se comportó como se esperaba; el guardado está desactivado.',
      [SAVE_STATUS.BLOCKED]: 'Los datos guardados de la mochila no son válidos y no se modifican.',
      [SAVE_STATUS.ERROR]: 'Appwrite rechazó los datos de la mochila.',
    }[result.status] ?? 'No se pudo conectar con Appwrite.';
    const diag = sync.lastError ? ` (Diagnóstico: ${sync.lastError.kind}${sync.lastError.type ? `, ${sync.lastError.type}` : ''}${sync.lastError.code ? `, ${sync.lastError.code}` : ''}.)` : '';
    const choice = await ui.askUnsavedProgress(`${reason}${diag} Si sales ahora, perderás la madera recogida desde el último guardado.`);
    if (choice === 'discard') return true;
    if (choice === 'cancel') return false;
  }
}

// Al ocultar o cerrar la pestaña se intenta guardar. El navegador NO garantiza que la petición
// termine, así que además se pide confirmación al cerrar si hay cambios sin confirmar.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sync.flush();
});
window.addEventListener('pagehide', () => sync.flush());
window.addEventListener('beforeunload', (event) => {
  if (!sync.hasUnsaved) return;
  sync.flush();
  event.preventDefault(); // El navegador muestra su aviso genérico de "cambios sin guardar"
});

// ---------- Arranque: recuperar la sesión activa ----------
async function init() {
  ui.showScreen('loading');
  ui.showAuthForm('login');

  if (!api.isConfigured()) {
    ui.showScreen('auth');
    ui.showAuthMessage('Falta configurar Appwrite en el archivo .env (y reiniciar "npm run dev").');
    ui.setBusy(true);
    return;
  }

  try {
    const user = await api.getCurrentUser();
    if (user) await afterLogin(user);
    else ui.showScreen('auth');
  } catch (error) {
    console.error(error);
    ui.showScreen('auth');
    ui.showAuthMessage(api.describeError(error));
  }
}

// Si falla la carga de algún modelo 3D, se informa en la pantalla visible
// (se espera a que init termine para que el mensaje no se borre al cambiar de pantalla).
init()
  .then(() => game.ready)
  .catch((error) => {
    console.error(error);
    ui.showAuthMessage(`Error al cargar el escenario: ${error.message}`);
  });
