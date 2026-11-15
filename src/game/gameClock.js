// gameClock.js — Reloj y calendario del juego (Fase 11B). Sin Three.js ni DOM.
//
// Ciclo de 20 minutos de gameplay ACTIVO (el reloj solo avanza cuando Game.js lo pide):
//   Amanecer 06:00–07:00 · 1 min   (1 h = 60 s)
//   Día      07:00–19:00 · 12 min  (1 h = 60 s)
//   Atardecer 19:00–20:00 · 1 min  (1 h = 60 s)
//   Noche    20:00–06:00 · 6 min   (1 h = 36 s: la noche pasa más deprisa)
// El estado es { d, t }: d = día (1, 2, 3…) y t = segundos del ciclo contados desde las 06:00
// (0 ≤ t < 1200). El día aumenta al llegar a las 06:00 (al terminar la noche).
// Es global: el mismo para los cinco bosques. Se guarda dentro de resources.clock.
//
// Interfaz para la fauna (Fase 11C): clock.hour, clock.period, clock.isNight,
// clock.onNewDay(fn) y clock.onPeriodChange(fn).
import { DAY_NIGHT } from '../config.js';

export const CYCLE = DAY_NIGHT.cycle; // 1200 s
export const DAWN_END = DAY_NIGHT.dawn; // 60 s  (07:00)
export const DUSK_START = DAY_NIGHT.duskStart; // 780 s (19:00)
export const NIGHT_START = DAY_NIGHT.nightStart; // 840 s (20:00)
const LIGHT_HOUR = DAY_NIGHT.lightHourSeconds; // 60 s por hora entre las 06:00 y las 20:00
const NIGHT_HOUR = (CYCLE - NIGHT_START) / 10; // 36 s por hora entre las 20:00 y las 06:00

export const PERIODS = { DAWN: 'amanecer', DAY: 'dia', DUSK: 'atardecer', NIGHT: 'noche' };

/** Hora del juego (0..24, con decimales) para t segundos desde las 06:00. */
export function hourOf(t) {
  if (t < NIGHT_START) return 6 + t / LIGHT_HOUR;
  return (20 + (t - NIGHT_START) / NIGHT_HOUR) % 24;
}

/** t (segundos desde las 06:00) para una hora del juego (0..24). */
export function timeOfHour(h) {
  const hour = ((h % 24) + 24) % 24;
  if (hour >= 6 && hour < 20) return (hour - 6) * LIGHT_HOUR;
  return NIGHT_START + ((hour - 20 + 24) % 24) * NIGHT_HOUR;
}

export function periodOf(t) {
  if (t < DAWN_END) return PERIODS.DAWN;
  if (t < DUSK_START) return PERIODS.DAY;
  if (t < NIGHT_START) return PERIODS.DUSK;
  return PERIODS.NIGHT;
}

export const isNightAt = (t) => t >= NIGHT_START;

/** Estado inicial de una partida: Día 1 a las 08:00. */
export const START_CLOCK = Object.freeze({ d: 1, t: timeOfHour(DAY_NIGHT.startHour) });

/** Valida un reloj guardado. @returns el reloj normalizado o null si no es válido */
export function parseClock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { d, t } = raw;
  if (!Number.isInteger(d) || d < 1 || d > 1e6) return null;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t >= CYCLE) return null;
  return { d, t };
}

/** "Día 7 — 21:30" (la hora va de 10 en 10 minutos: el texto cambia poco). */
export function formatClock({ d, t }) {
  const minutes = Math.floor((hourOf(t) * 60) / 10 + 1e-6) * 10;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `Día ${d} — ${hh}:${mm}`;
}

export class GameClock {
  constructor(state = START_CLOCK) {
    this.listeners = { newDay: [], period: [] };
    this.set(state);
  }

  /** Coloca el reloj (al cargar el progreso o tras dormir). No emite eventos. */
  set(state) {
    const clock = parseClock(state) ?? START_CLOCK;
    this.d = clock.d;
    this.t = clock.t;
    this.lastPeriod = periodOf(this.t);
  }

  get day() {
    return this.d;
  }

  get time() {
    return this.t;
  }

  get hour() {
    return hourOf(this.t);
  }

  get period() {
    return periodOf(this.t);
  }

  get isNight() {
    return isNightAt(this.t);
  }

  /** Estado para guardar (t con una décima de segundo). */
  toJSON() {
    return { d: this.d, t: Math.round(this.t * 10) / 10 % CYCLE };
  }

  format() {
    return formatClock(this);
  }

  /** Reloj al despertar: el día siguiente a las 06:00 (solo tiene sentido de noche). */
  sleepTarget() {
    return { d: this.d + 1, t: 0 };
  }

  onNewDay(fn) {
    this.listeners.newDay.push(fn);
    return () => this.listeners.newDay.splice(this.listeners.newDay.indexOf(fn), 1);
  }

  onPeriodChange(fn) {
    this.listeners.period.push(fn);
    return () => this.listeners.period.splice(this.listeners.period.indexOf(fn), 1);
  }

  /**
   * Avanza el reloj (solo con la partida activa: lo decide Game.js).
   * Un fotograma muy largo se procesa por tramos: nunca se salta un cambio de día.
   */
  advance(dt) {
    let left = Math.max(0, dt);
    while (left > 0) {
      const step = Math.min(left, CYCLE - this.t);
      this.t += step;
      left -= step;
      if (this.t >= CYCLE - 1e-9) {
        this.t = 0;
        this.d += 1;
        for (const fn of this.listeners.newDay) fn(this.d);
      }
      const period = periodOf(this.t);
      if (period !== this.lastPeriod) {
        const from = this.lastPeriod;
        this.lastPeriod = period;
        for (const fn of this.listeners.period) fn(period, from);
      }
    }
  }
}
