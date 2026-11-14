// session.js — Estado de la partida: jugando, en pausa y control del cursor (Pointer Lock).
//
// Reglas:
// - Jugar (clic en el menú) pide capturar el cursor desde esa misma interacción.
// - ESC pausa y libera el cursor. Cuando el cursor está capturado, el navegador consume ESC
//   y solo avisa con "pointerlockchange"; en otros casos llega el "keydown". Para que ESC no
//   pause y reanude dos veces, pause() es idempotente y ESC NUNCA reanuda: para continuar hay
//   que hacer clic (el navegador exige una interacción para volver a capturar el cursor).
// - Si se pierde el cursor (ESC, cambio de ventana…), se pausa y se detiene el ataque.
// - Si el navegador no deja capturar el cursor, se muestra "Haz clic para controlar la cámara".
// - Atacar (y por tanto talar) solo es posible jugando, sin pausa y con el cursor capturado.
// - Tienda (Fase 8): B la abre (jugando y sin pausa) y B o ESC la cierran. Con la tienda abierta
//   la simulación se congela (como en la pausa) y el cursor queda libre para hacer clic, pero no
//   se muestra el panel de pausa. Al cerrarla se vuelve a capturar el cursor.
// - Menú principal (Fase 10): modos menu → entering → playing → leaving → menu. Solo en
//   "playing" (sin pausa ni tienda) la partida está activa. En el menú y en las transiciones no
//   hay controles, ESC/B no hacen nada y perder el cursor no es una pausa.
// No depende del renderizado: se puede probar sin navegador.
export class PlaySession {
  /**
   * @param cameraRig  ThirdPersonCamera (requestLock / releaseLock / locked / enabled)
   * @param player     Player (setEnabled / resetInput)
   * @param callbacks  { onPauseChange(enPausa), onLockHint(mostrar) } para la interfaz
   */
  constructor(cameraRig, player, { onPauseChange = () => {}, onLockHint = () => {}, onShopChange = () => {} } = {}) {
    this.cameraRig = cameraRig;
    this.player = player;
    this.onPauseChange = onPauseChange;
    this.onLockHint = onLockHint;
    this.onShopChange = onShopChange;
    this.inShop = false;
    this.mode = 'menu';
    this.paused = false;
    this.attackHeld = false;
  }

  /** Jugando (puede estar en pausa o con la tienda abierta). */
  get playing() {
    return this.mode === 'playing';
  }

  get inMenu() {
    return this.mode === 'menu';
  }

  /** Cámara en transición entre el menú y la partida (sin controles). */
  get transitioning() {
    return this.mode === 'entering' || this.mode === 'leaving';
  }

  /** La simulación avanza (personaje, tala, regeneración) solo jugando y sin pausa. */
  get active() {
    return this.playing && !this.paused;
  }

  /** Ataque con el hacha: jugando, sin pausa, con el cursor capturado y el clic izquierdo pulsado. */
  get attacking() {
    return this.active && this.cameraRig.locked && this.attackHeld;
  }

  setActiveControls(active) {
    this.attackHeld = false;
    this.player.setEnabled(active);
    this.cameraRig.enabled = active;
  }

  // ---------- Menú ↔ partida (Fase 10) ----------

  /**
   * "Continuar" (clic del usuario): empieza la entrada a la partida. Pide el cursor AHORA,
   * dentro de la interacción (el navegador lo exige); los controles se activan al terminar la
   * transición de cámara (finishEnter).
   */
  beginEnter() {
    if (this.mode !== 'menu') return false;
    this.mode = 'entering';
    this.paused = false;
    this.setActiveControls(false);
    this.onLockHint(false);
    this.cameraRig.requestLock();
    return true;
  }

  /** La comprobación del progreso falló: se vuelve al menú sin haber jugado. */
  cancelEnter() {
    if (this.mode !== 'entering') return;
    this.mode = 'menu';
    this.cameraRig.releaseLock();
  }

  /** Fin de la transición: el jugador ya controla al Worker. */
  finishEnter() {
    if (this.mode !== 'entering') return;
    this.mode = 'playing';
    this.paused = false;
    this.setActiveControls(true);
    this.onPauseChange(false);
    if (!this.cameraRig.locked) this.onLockHint(true); // Sin cursor: "Haz clic para controlar la cámara"
  }

  /** Volver al menú: se detiene la partida y se libera el cursor (la cámara vuelve a la órbita). */
  beginLeave() {
    if (this.mode === 'menu' || this.mode === 'leaving') return false;
    this.mode = 'leaving'; // Primero: así la pérdida del cursor no se interpreta como pausa
    if (this.inShop) {
      this.inShop = false;
      this.onShopChange(false);
    }
    this.paused = false;
    this.setActiveControls(false);
    this.onPauseChange(false);
    this.onLockHint(false);
    this.cameraRig.releaseLock();
    return true;
  }

  finishLeave() {
    if (this.mode === 'leaving') this.mode = 'menu';
  }

  /** Entrar directamente, sin transición (pruebas y casos sin cámara animada). */
  start() {
    this.beginEnter();
    this.finishEnter();
  }

  /** Volver al menú directamente, sin transición. */
  stop() {
    this.beginLeave();
    this.finishLeave();
  }

  pause() {
    if (!this.playing || this.paused || this.inShop) return; // Idempotente: ESC + pointerlockchange = una sola pausa
    this.paused = true;
    this.setActiveControls(false);
    this.onLockHint(false);
    this.onPauseChange(true);
    this.cameraRig.releaseLock();
  }

  /** Botón "Continuar" (interacción del usuario): reanuda y vuelve a pedir el cursor. */
  resume() {
    if (!this.playing || !this.paused) return;
    this.paused = false;
    this.setActiveControls(true);
    this.onPauseChange(false);
    this.cameraRig.requestLock();
  }

  // ---------- Tienda (Fase 8) ----------

  /** Abre la tienda: congela la simulación y libera el cursor (sin panel de pausa). */
  openShop() {
    if (!this.active) return false;
    this.inShop = true;
    this.paused = true;
    this.setActiveControls(false);
    this.onLockHint(false);
    this.onShopChange(true);
    this.cameraRig.releaseLock();
    return true;
  }

  /** Cierra la tienda y vuelve al juego (pide de nuevo el cursor). */
  closeShop() {
    if (!this.inShop) return false;
    this.inShop = false;
    this.paused = false;
    this.setActiveControls(true);
    this.onShopChange(false);
    this.cameraRig.requestLock(); // Si el navegador no lo permite, se mostrará "Haz clic…"
    return true;
  }

  // ---------- Eventos (los conecta Game.js) ----------

  pointerDown(button) {
    if (button !== 0 || !this.active) return;
    if (this.cameraRig.locked) this.attackHeld = true;
    else this.cameraRig.requestLock(); // Sin cursor capturado, el clic sirve para capturarlo
  }

  pointerUp(button) {
    if (button === 0) this.attackHeld = false;
  }

  keyDown(code) {
    if (code === 'Escape') {
      if (this.inShop) this.closeShop();
      else this.pause();
    } else if (code === 'KeyB') {
      if (this.inShop) this.closeShop();
      else this.openShop();
    }
  }

  lockChange(locked) {
    if (locked) {
      this.onLockHint(false);
      return;
    }
    // Cursor perdido: nada de ataque ni teclas pulsadas; si se estaba jugando, pausa
    // (en la tienda el cursor se libera a propósito: no es una pausa)
    this.attackHeld = false;
    if (this.inShop) return;
    this.player.resetInput();
    this.pause();
  }

  lockError() {
    if (this.active && !this.cameraRig.locked) this.onLockHint(true);
  }

  blur() {
    this.attackHeld = false;
    this.player.resetInput();
  }
}
