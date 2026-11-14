// Punto de entrada de Timber Rush 3D.
// Coordina las pantallas (ui.js) con la autenticación (appwrite.js).
// FASE 2: flujo de registro, inicio de sesión, recuperación de sesión y cierre de sesión.
// FASE 7A: la mochila se restaura al entrar y se guarda en Appwrite (progressSync.js).
// FASE 7B: venta segura con F en el aserradero; la celebración solo llega tras confirmarla.
import './style.css';
import { Game } from './game/Game.js';
import * as api from './appwrite.js';
import * as ui from './ui.js';
import { ProgressSync, SAVE_STATUS } from './progressSync.js';
import { nextUpgrade, saleValue } from './game/economy.js';
import { SaleCelebrationSequence } from './game/saleSequence.js';

// La escena de prueba de la Fase 1 queda de fondo detrás de las pantallas.
// En fases posteriores el juego solo se iniciará al pulsar "Jugar".
const game = new Game(document.getElementById('game-container'));
game.start();

let currentUser = null; // Usuario de Appwrite con sesión activa
let busy = false; // Evita enviar dos peticiones a la vez

// Sincronización de la mochila con la fila de progreso del usuario
const sync = new ProgressSync({
  api: { getProfile: api.getProfile, save: api.saveProgressFields, probe: api.probeVersionGuard, classify: api.classifySaveError },
  saleValue,
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
  ui.coinCounter.set(sync.coins); // Saldo real guardado, sin animación
  ui.renderUpgradeProgress(nextUpgrade(sync.levels), sync.coins);
  if (damaged) ui.showAuthMessage('Los datos guardados de tu mochila no son válidos. No se modificarán hasta revisarlos.', 'error');
  ui.clearAuthMessage();
  ui.showScreen('menu');
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

ui.bindMenuEvents({
  // Jugar y Continuar son clics del usuario: desde ellos se puede capturar el cursor
  onPlay: () => {
    ui.showScreen('game');
    game.setPlaying(true);
  },
  onResume: () => game.resume(),
  onBackToMenu: () => {
    game.setPlaying(false);
    ui.showScreen('menu');
    sync.flush(); // Guardar al volver al menú
  },
});

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
