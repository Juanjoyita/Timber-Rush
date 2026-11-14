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

/** Indicador de la mochila: cantidad, capacidad y barra de progreso. */
export function renderBackpack({ total, capacity }) {
  $('backpack-count').textContent = `${total} / ${capacity}`;
  const percent = capacity > 0 ? Math.min(100, (total / capacity) * 100) : 0;
  $('backpack-fill').style.width = `${percent}%`;
  $('backpack-hud').classList.toggle('is-full', total >= capacity);
}

/** Aviso breve de "mochila llena" (se reinicia la animación en cada aviso). */
export function flashBackpackFull() {
  const notice = $('backpack-full');
  notice.classList.remove('show');
  void notice.offsetWidth; // Fuerza al navegador a reiniciar la animación CSS
  notice.classList.add('show');
}

/**
 * Estado del guardado de la mochila (lo envía progressSync.js).
 * "Guardado" solo se muestra tras la confirmación de Appwrite y se oculta a los 2 s.
 */
let saveStatusTimer = null;
const SAVE_TEXTS = {
  saving: ['Guardando…', ''],
  saved: ['✓ Guardado', 'is-ok'],
  retrying: [null, 'is-warning'],
  conflict: [null, 'is-error'],
  permission: [null, 'is-error'],
  unsupported: [null, 'is-error'],
  condition: [null, 'is-error'],
  blocked: [null, 'is-error'],
  error: [null, 'is-error'],
};
export function showSaveStatus(status, detail) {
  const el = $('save-status');
  clearTimeout(saveStatusTimer);
  const entry = SAVE_TEXTS[status];
  if (!entry) {
    el.textContent = ''; // Sin cambios o cambios pendientes: no hace falta mostrar nada
    el.className = 'save-status';
    return;
  }
  el.textContent = entry[0] ?? detail ?? '';
  el.className = `save-status ${entry[1]}`.trim();
  if (status === 'saved') saveStatusTimer = setTimeout(() => (el.textContent = ''), 2000);
}

/**
 * Diálogo "Progreso sin guardar" al cerrar sesión. Devuelve una promesa con la elección:
 * 'retry', 'discard' o 'cancel'.
 */
export function askUnsavedProgress(text) {
  $('save-dialog-text').textContent = text;
  $('save-dialog').classList.remove('hidden');
  return new Promise((resolve) => {
    const choose = (choice) => {
      $('save-dialog').classList.add('hidden');
      for (const [id, fn] of handlers) $(id).removeEventListener('click', fn);
      resolve(choice);
    };
    const handlers = [
      ['btn-save-retry', () => choose('retry')],
      ['btn-save-discard', () => choose('discard')],
      ['btn-save-cancel', () => choose('cancel')],
    ];
    for (const [id, fn] of handlers) $(id).addEventListener('click', fn);
  });
}

// ---------- Monedas y venta (Fase 7B) ----------

/**
 * Número animado: muestra la transición del valor anterior al nuevo. Es SOLO visual: el saldo
 * real lo da progressSync (confirmado en Appwrite). Siempre termina exactamente en el último
 * valor recibido; si llega otro a mitad, continúa desde lo que se está mostrando.
 */
export class AnimatedCounter {
  constructor(render, { duration = 0.9, now = () => performance.now(), raf = (f) => requestAnimationFrame(f) } = {}) {
    this.render = render; // (valorMostrado, valorReal) => void
    this.duration = duration * 1000;
    this.now = now;
    this.raf = raf;
    this.target = 0;
    this.shown = 0;
    this.from = 0;
    this.start = 0;
    this.running = false;
    this.tick = this.tick.bind(this);
  }

  /** Muestra el valor al instante (al cargar el perfil). */
  set(value) {
    this.target = value;
    this.shown = value;
    this.running = false;
    this.render(value, value);
  }

  /** Anima desde lo que se ve ahora hasta "value". */
  animateTo(value) {
    if (value === this.target && !this.running) return;
    this.from = this.shown;
    this.target = value;
    this.start = this.now();
    if (!this.running) {
      this.running = true;
      this.raf(this.tick);
    }
  }

  tick() {
    if (!this.running) return;
    const p = Math.min(1, (this.now() - this.start) / this.duration);
    const eased = 1 - (1 - p) ** 3; // Rápido al principio, suave al final
    this.shown = p >= 1 ? this.target : Math.round(this.from + (this.target - this.from) * eased);
    this.render(this.shown, this.target);
    if (p < 1) this.raf(this.tick);
    else this.running = false;
  }
}

/** Contador de monedas del juego (lo usa main.js con el saldo confirmado). */
export const coinCounter = new AnimatedCounter((shown, real) => {
  const el = $('coin-count');
  el.textContent = formatNumber(shown);
  $('coin-hud').setAttribute('aria-label', `Monedas: ${formatNumber(real)}`); // Siempre el valor real
});

/** Brillo breve del contador de monedas de la esquina al recibir monedas. */
export function pulseCoinHud() {
  const hud = $('coin-hud');
  hud.classList.remove('is-earning');
  void hud.offsetWidth; // Reinicia la animación CSS
  hud.classList.add('is-earning');
}

/** Reinicia una animación CSS de una clase (para poder repetirla). */
function restartClass(el, name) {
  el.classList.remove(name);
  void el.offsetWidth;
  el.classList.add(name);
}

/**
 * Anuncio grande de venta confirmada (centro de la pantalla). Solo muestra datos ya confirmados:
 * lo controla saleSequence.js. "+N" se cuenta desde 0; el saldo se muestra con su valor exacto.
 */
const bannerCount = new AnimatedCounter((shown) => {
  $('sale-banner-earned').textContent = formatNumber(shown);
}, { duration: 0.8 });
let bannerHideTimer = null;
export const saleBanner = {
  show({ earned, balance }) {
    const el = $('sale-banner');
    clearTimeout(bannerHideTimer);
    el.classList.remove('hidden', 'is-leaving', 'is-shining', 'is-bumping');
    restartClass(el, 'is-entering');
    $('sale-banner-balance').textContent = formatNumber(balance);
    bannerCount.set(0);
    bannerCount.animateTo(earned);
    pulseCoinHud();
  },
  /** Otra venta mientras se muestra: acumula lo ganado y actualiza el saldo. */
  update({ earned, balance }) {
    const el = $('sale-banner');
    clearTimeout(bannerHideTimer);
    el.classList.remove('hidden', 'is-leaving');
    restartClass(el, 'is-bumping');
    $('sale-banner-balance').textContent = formatNumber(balance);
    bannerCount.animateTo(earned);
    pulseCoinHud();
  },
  shine() {
    restartClass($('sale-banner'), 'is-shining');
  },
  hide() {
    const el = $('sale-banner');
    el.classList.add('is-leaving');
    clearTimeout(bannerHideTimer);
    bannerHideTimer = setTimeout(() => el.classList.add('hidden'), 400);
  },
};

/**
 * Progreso hacia la mejora más barata que falta (solo información: sin botón de compra).
 * @param next  { name, cost } o null
 */
export function renderUpgradeProgress(next, coins) {
  const box = $('upgrade-progress');
  box.classList.toggle('hidden', !next);
  if (!next) return;
  const ready = coins >= next.cost;
  // Solo informativo: comprar (y subir de nivel) será una acción explícita en la tienda (Fase 8)
  $('upgrade-label').textContent = ready
    ? `${next.name} — ¡Ya puedes comprar esta mejora en la tienda! (B)`
    : `${next.name} — ${formatNumber(coins)} / ${formatNumber(next.cost)} monedas`;
  $('upgrade-fill').style.width = `${Math.min(100, (coins / next.cost) * 100)}%`;
  box.classList.toggle('is-ready', ready);
}

/** Aviso "F · Vender madera" sobre la plataforma. */
export function showSellPrompt(visible) {
  $('sell-prompt').classList.toggle('hidden', !visible);
}

/** Mensaje breve sobre la venta (por ejemplo, si no se completó). */
let saleMessageTimer = null;
export function showSaleMessage(text) {
  const el = $('sale-message');
  clearTimeout(saleMessageTimer);
  el.textContent = text;
  el.classList.remove('hidden');
  saleMessageTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

/** Actualiza las monedas del menú principal tras una venta. */
export function updateMenuCoins(coins, totalCoinsEarned) {
  $('menu-coins').textContent = formatNumber(coins);
  $('menu-total').textContent = formatNumber(totalCoinsEarned);
}

// ---------- Tienda (Fase 8) ----------

/** Muestra u oculta el panel de la tienda. */
export function showShop(open) {
  $('shop').classList.toggle('hidden', !open);
  if (open) showShopMessage('');
}

/**
 * Dibuja las tarjetas de la tienda (datos de economy.shopItems con el saldo CONFIRMADO).
 * @param busyKey mejora que se está comprando (su botón muestra "Comprando…" y nada se puede pulsar)
 */
export function renderShop(items, coins, busyKey = null) {
  $('shop-coins').textContent = formatNumber(coins);
  const box = $('shop-items');
  box.replaceChildren(
    ...items.map((item) => {
      const card = document.createElement('div');
      card.className = `shop-card${item.maxed ? ' is-maxed' : ''}${item.available ? '' : ' is-locked'}`;
      card.dataset.key = item.key;
      const line = (cls, text, tag = 'p') => {
        const el = document.createElement(tag);
        el.className = cls;
        el.textContent = text;
        return el;
      };
      card.append(line('shop-card-name', item.name));
      card.append(line('shop-card-level', item.maxed ? `Nivel ${item.level} · máximo` : `Nivel ${item.level} → ${item.nextLevel}`));
      const effect = document.createElement('p');
      effect.className = 'shop-card-effect';
      effect.append(item.effect);
      if (item.nextEffect) {
        effect.append(' → ');
        const strong = document.createElement('strong');
        strong.textContent = item.nextEffect;
        effect.append(strong);
      }
      card.append(effect);
      if (!item.available) {
        card.append(line('shop-soon-tag', 'Fase 9'));
      } else if (item.maxed) {
        card.append(line('shop-soon-tag', '¡Nivel máximo!'));
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-primary btn-small';
        button.dataset.buy = item.key;
        button.disabled = Boolean(busyKey) || !item.affordable;
        button.textContent = busyKey === item.key ? 'Comprando…' : `Comprar · ${formatNumber(item.cost)}`;
        card.append(button);
        if (!item.affordable) card.append(line('shop-card-missing', `Te faltan ${formatNumber(item.missing)} monedas`));
      }
      return card;
    })
  );
}

/** Mensaje bajo las tarjetas (compra realizada o motivo por el que no se pudo). */
export function showShopMessage(text, error = false) {
  const el = $('shop-message');
  el.textContent = text;
  el.classList.toggle('is-error', error);
}

/** Destello de la tarjeta recién comprada. */
export function flashShopCard(key) {
  const card = $('shop-items').querySelector(`[data-key="${key}"]`);
  if (card) restartClass(card, 'is-bought');
}

/** Conecta los botones de la tienda (comprar delegando en el contenedor, y cerrar). */
export function bindShopEvents({ onBuy, onClose }) {
  $('shop-items').addEventListener('click', (e) => {
    const button = e.target.closest('[data-buy]');
    if (button && !button.disabled) onBuy(button.dataset.buy);
  });
  $('btn-shop-close').addEventListener('click', onClose);
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
