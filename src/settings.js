// settings.js — Configuración del jugador en ESTE navegador (Fase 10).
//
// Preferencias del dispositivo, no progreso: se guardan en localStorage (nunca en Appwrite) y
// nunca contienen datos sensibles. Si el navegador no permite guardarlas (modo privado,
// almacenamiento bloqueado), el juego funciona igual con los valores por defecto.
//
//   masterVolume  0..1   volumen general (AudioListener)
//   effectsVolume 0..1   volumen de los efectos (hacha, pasos, venta…)
//   sensitivity   0.3..2 multiplicador de la sensibilidad del ratón
//   quality       'high' | 'low'  sombras 2048 y resolución hasta ×2 · sombras 1024 y ×1
export const SETTINGS_KEY = 'timberRush.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({ masterVolume: 0.8, effectsVolume: 1, sensitivity: 1, quality: 'high' });

const clamp = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback);

/** Valores válidos a partir de cualquier dato (corrige rangos y descarta lo desconocido). */
export function sanitizeSettings(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    masterVolume: clamp(d.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
    effectsVolume: clamp(d.effectsVolume, 0, 1, DEFAULT_SETTINGS.effectsVolume),
    sensitivity: clamp(d.sensitivity, 0.3, 2, DEFAULT_SETTINGS.sensitivity),
    quality: d.quality === 'low' ? 'low' : 'high',
  };
}

export class Settings {
  /** @param storage localStorage (o un sustituto en las pruebas) */
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.values = this.load();
    this.onChange = () => {}; // (valores) => void — aplica la configuración al juego
  }

  load() {
    try {
      const raw = this.storage?.getItem(SETTINGS_KEY);
      return sanitizeSettings(raw ? JSON.parse(raw) : DEFAULT_SETTINGS);
    } catch {
      return { ...DEFAULT_SETTINGS }; // Datos corruptos o almacenamiento bloqueado
    }
  }

  save() {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.values));
      return true;
    } catch {
      return false; // Sin almacenamiento: se aplica igual, pero no se conserva al recargar
    }
  }

  /** Cambia un valor, lo aplica al momento y lo guarda. */
  set(key, value) {
    this.values = sanitizeSettings({ ...this.values, [key]: value });
    this.save();
    this.onChange(this.values);
    return this.values[key];
  }
}
