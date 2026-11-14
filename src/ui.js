// ui.js — Manejo de las pantallas HTML (solo DOM, sin lógica de Appwrite).
// FASE 2: pantalla de carga, autenticación (login / registro / elegir nombre)
// y un menú provisional con el usuario y el botón de cerrar sesión.

const $ = (id) => document.getElementById(id);

// ---------- Navegación entre pantallas ----------
/** Muestra una sola pantalla (<section class="screen">) y oculta las demás. */
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('hidden', screen.id !== `screen-${name}`);
  });
}

// ---------- Pantalla de autenticación ----------
/** Cambia entre los formularios: 'login', 'register' o 'username'. */
export function showAuthForm(form) {
  $('form-login').classList.toggle('hidden', form !== 'login');
  $('form-register').classList.toggle('hidden', form !== 'register');
  $('form-username').classList.toggle('hidden', form !== 'username');
  // Las pestañas no tienen sentido mientras se elige el nombre
  $('auth-tabs').classList.toggle('hidden', form === 'username');
  $('tab-login').classList.toggle('active', form === 'login');
  $('tab-register').classList.toggle('active', form === 'register');
  clearAuthMessage();
}

/** Muestra el mensaje en la pantalla que esté visible (autenticación o menú). */
export function showAuthMessage(text, type = 'error') {
  const menuVisible = !$('screen-menu').classList.contains('hidden');
  const box = menuVisible ? $('menu-message') : $('auth-message');
  box.textContent = text;
  box.className = `message ${type}`;
}

export function clearAuthMessage() {
  $('auth-message').className = 'message hidden';
  $('menu-message').className = 'message hidden';
}

/** Desactiva los botones mientras hay una petición en curso (evita envíos dobles). */
export function setBusy(busy) {
  document.querySelectorAll('#screen-auth button, #screen-menu button').forEach((b) => {
    b.disabled = busy;
  });
}

/** Vacía los campos de contraseña: no deben quedarse en el DOM tras enviarse. */
export function clearPasswords() {
  $('login-password').value = '';
  $('register-password').value = '';
  $('register-password2').value = '';
}

// ---------- Menú principal ----------
/** Formato de números en español: 12500 → "12.500". */
const formatNumber = (n) => Number(n ?? 0).toLocaleString('es-ES');

/** Rellena el menú con los datos de la fila de progreso. */
export function renderMenu(profile) {
  $('menu-username').textContent = profile.username;
  $('menu-coins').textContent = formatNumber(profile.coins);
  $('menu-total').textContent = formatNumber(profile.totalCoinsEarned);
  $('menu-forests').textContent = `${profile.unlockedForests ?? 1}/5`;
}

export function bindMenuEvents(handlers) {
  $('btn-play').addEventListener('click', handlers.onPlay);
  $('btn-back-menu').addEventListener('click', handlers.onBackToMenu);
  $('btn-resume').addEventListener('click', handlers.onResume);
}

// ---------- Pantalla de juego ----------
/** Panel de pausa (ESC). */
export function showPause(visible) {
  $('pause-overlay').classList.toggle('hidden', !visible);
}

/** Indicación "Haz clic para controlar la cámara" (si no se pudo capturar el cursor). */
export function showLockHint(visible) {
  $('lock-hint').classList.toggle('hidden', !visible);
}

// ---------- Eventos ----------
/**
 * Conecta los formularios con las funciones que recibe (handlers).
 * Así ui.js no necesita saber nada de Appwrite.
 */
export function bindAuthEvents(handlers) {
  $('tab-login').addEventListener('click', () => showAuthForm('login'));
  $('tab-register').addEventListener('click', () => showAuthForm('register'));

  $('form-login').addEventListener('submit', (e) => {
    e.preventDefault(); // Evita que el formulario recargue la página
    handlers.onLogin({
      email: $('login-email').value.trim(),
      password: $('login-password').value,
    });
  });

  $('form-register').addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onRegister({
      username: $('register-username').value.trim(),
      email: $('register-email').value.trim(),
      password: $('register-password').value,
      password2: $('register-password2').value,
    });
  });

  $('form-username').addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onChooseUsername($('choose-username').value.trim());
  });

  $('btn-username-logout').addEventListener('click', handlers.onLogout);
  $('btn-logout').addEventListener('click', handlers.onLogout);
}
