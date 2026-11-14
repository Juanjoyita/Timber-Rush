// Punto de entrada de Timber Rush 3D.
// Coordina las pantallas (ui.js) con la autenticación (appwrite.js).
// FASE 2: flujo de registro, inicio de sesión, recuperación de sesión y cierre de sesión.
import './style.css';
import { Game } from './game/Game.js';
import * as api from './appwrite.js';
import * as ui from './ui.js';

// La escena de prueba de la Fase 1 queda de fondo detrás de las pantallas.
// En fases posteriores el juego solo se iniciará al pulsar "Jugar".
const game = new Game(document.getElementById('game-container'));
game.start();

let currentUser = null; // Usuario de Appwrite con sesión activa
let busy = false; // Evita enviar dos peticiones a la vez

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
  ui.clearAuthMessage();
  ui.showScreen('menu');
}

// ---------- Menú principal ----------
// La partida avisa a la interfaz de la pausa y de si hace falta un clic para capturar el cursor
game.onPauseChange = ui.showPause;
game.onLockHint = ui.showLockHint;

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
      // En la Fase 10 aquí se guardará el progreso antes de cerrar la sesión
      await api.logout();
      currentUser = null;
      ui.showScreen('auth');
      ui.showAuthForm('login');
      ui.showAuthMessage('Sesión cerrada correctamente.', 'success');
    }),
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
