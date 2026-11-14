// saleSequence.js — Dirige la celebración de una venta CONFIRMADA (Fase 7B).
//
// Coordina, según SALE.timeline, el anuncio grande de la interfaz, las monedas 3D y los sonidos.
// No sabe nada de Appwrite: solo se le llama con ventas ya confirmadas (progressSync.onSale).
// Tampoco toca el DOM ni Three.js directamente: recibe esas funciones (se prueba sin navegador).
//
// Reglas:
// - Una venta (identificador) se celebra una sola vez.
// - Si llega otra venta mientras el anuncio sigue visible, no se apilan dos celebraciones:
//   el anuncio acumula las monedas ganadas, se cancelan los sonidos pendientes y suena una
//   versión corta (Bonus Points → Level Up), y la salida se retrasa.
// - Un fallo en el sonido o en un efecto no interrumpe el resto de la celebración.
import { SALE } from '../config.js';

export class SaleCelebrationSequence {
  /**
   * @param banner { show({ earned, balance }), update({ earned, balance }), shine(), hide() }
   * @param sound  { play(nombre, retardo), stopAll() }
   * @param burst  () => void — monedas 3D en la plataforma
   * @param timers { setTimeout, clearTimeout } (se sustituyen en las pruebas)
   */
  constructor({ banner, sound, burst, timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) }, timeline = SALE.timeline, mergeTimeline = SALE.mergeTimeline }) {
    this.banner = banner;
    this.sound = sound;
    this.burst = burst;
    this.timers = timers;
    this.timeline = timeline;
    this.mergeTimeline = mergeTimeline;
    this.celebrated = new Set(); // Ventas ya celebradas
    this.active = false; // Anuncio visible
    this.earned = 0; // Monedas acumuladas en el anuncio actual
    this.pending = []; // Temporizadores de la celebración en curso
  }

  /** Celebra una venta confirmada { id, earned, coins }. Devuelve false si ya se había celebrado. */
  celebrate(sale) {
    if (this.celebrated.has(sale.id)) return false;
    this.celebrated.add(sale.id);
    this.clearTimers();
    const merging = this.active;
    this.earned = merging ? this.earned + sale.earned : sale.earned;
    const data = { earned: this.earned, balance: sale.coins };
    const t = merging ? this.mergeTimeline : this.timeline;

    this.safe(() => (merging ? this.banner.update(data) : this.banner.show(data)));
    this.safe(() => this.burst());
    this.safe(() => this.sound.stopAll()); // Nada pendiente de la celebración anterior
    this.safe(() => this.sound.play('sale_bonus', 0));
    if (!merging) this.safe(() => this.sound.play('sale_chime', t.chime));
    this.safe(() => this.sound.play('sale_levelup', t.levelUp));
    this.active = true;

    this.later(t.levelUp, () => this.banner.shine());
    this.later(t.exit, () => this.banner.hide());
    this.later(t.exit + this.timeline.exitDuration, () => {
      this.active = false;
      this.earned = 0;
    });
    return true;
  }

  /** Cancela la celebración en curso (al cerrar sesión). */
  cancel() {
    this.clearTimers();
    this.safe(() => this.sound.stopAll());
    if (this.active) this.safe(() => this.banner.hide());
    this.active = false;
    this.earned = 0;
  }

  later(seconds, fn) {
    const id = this.timers.setTimeout(() => {
      this.pending = this.pending.filter((p) => p !== id);
      this.safe(fn);
    }, seconds * 1000);
    this.pending.push(id);
  }

  clearTimers() {
    for (const id of this.pending) this.timers.clearTimeout(id);
    this.pending = [];
  }

  safe(fn) {
    try {
      fn();
    } catch (error) {
      console.warn('[Timber Rush] Fallo en un efecto de la celebración (la venta ya está guardada)', error);
    }
  }
}
