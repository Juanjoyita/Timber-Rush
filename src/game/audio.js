// audio.js — Efectos de sonido posicionales (Fase 6: tala de árboles).
//
// Criterios:
// - UN solo AudioListener, unido a la cámara: el oído del jugador.
// - Un grupo FIJO de fuentes THREE.PositionalAudio reutilizables (no una por árbol): cada
//   sonido toma una fuente libre, la coloca donde ocurre el evento y la reproduce.
// - Los archivos se cargan UNA vez; sus buffers se reutilizan en todas las reproducciones.
// - Atenuación por distancia (modelo inverso): se oye natural cerca y se apaga al alejarse.
// - Los navegadores bloquean el audio hasta que el usuario interactúa: el AudioContext se
//   reanuda con la primera pulsación de ratón o teclado, y antes de eso no se reproduce nada.
// - Limitador por sonido (tiempo mínimo entre repeticiones y máximo de copias simultáneas)
//   para evitar saturación.
// - Fase 7B: sonidos de INTERFAZ (venta) sin posición ni atenuación (THREE.Audio). Cada uno
//   tiene su propia fuente, así que nunca suena duplicado; se pueden programar con retardo en
//   el reloj de audio y cancelar. Un fallo de audio nunca interrumpe el juego.
import * as THREE from 'three';
import { AUDIO } from '../config.js';

const AUDIO_PATH = '/assets/audio/';

/**
 * Decide si un sonido puede sonar ahora. No depende de Web Audio: se prueba de forma aislada.
 * - cooldown: segundos mínimos entre dos reproducciones del mismo sonido.
 * - maxConcurrent: copias del mismo sonido que pueden sonar a la vez.
 */
export class SoundLimiter {
  constructor(sounds) {
    this.sounds = sounds;
    this.lastPlay = {};
    this.active = {}; // nombre → lista de instantes en que terminan las copias que suenan
  }

  canPlay(name, now) {
    const cfg = this.sounds[name];
    if (!cfg) return false;
    if (now - (this.lastPlay[name] ?? -Infinity) < (cfg.cooldown ?? 0)) return false;
    this.active[name] = (this.active[name] ?? []).filter((end) => end > now);
    return this.active[name].length < (cfg.maxConcurrent ?? Infinity);
  }

  register(name, now, duration) {
    this.lastPlay[name] = now;
    (this.active[name] ??= []).push(now + duration);
  }
}

export class AudioManager {
  /**
   * @param camera   Cámara a la que se une el AudioListener
   * @param scene    Escena donde se colocan las fuentes posicionales
   * @param options  Dependencias opcionales (las pruebas usan versiones simuladas)
   */
  constructor(camera, scene, { listener = null, createSource = null, createUiSource = null, loader = null, config = AUDIO } = {}) {
    this.config = config;
    this.listener = listener ?? new THREE.AudioListener();
    this.listener.setMasterVolume(config.masterVolume);
    camera.add(this.listener);

    this.loader = loader ?? new THREE.AudioLoader();
    this.buffers = new Map(); // archivo → AudioBuffer (cargado una vez)
    this.missing = [];
    this.limiter = new SoundLimiter(config.sounds);

    const make = createSource ?? (() => new THREE.PositionalAudio(this.listener));
    this.pool = Array.from({ length: config.poolSize }, () => {
      const source = make();
      source.setDistanceModel('inverse');
      source.setRefDistance(config.refDistance);
      source.setRolloffFactor(config.rolloffFactor);
      source.setMaxDistance(config.maxDistance);
      source.lastStart = -Infinity;
      scene.add(source);
      return source;
    });

    // Sonidos de interfaz: una fuente no posicional por sonido (marcados con ui: true)
    const makeUi = createUiSource ?? (() => new THREE.Audio(this.listener));
    this.uiSources = new Map(
      Object.entries(config.sounds)
        .filter(([, cfg]) => cfg.ui)
        .map(([name]) => [name, makeUi()])
    );
  }

  /** Carga todos los archivos (una vez cada uno). Si falta alguno, el juego sigue sin ese sonido. */
  async load() {
    const files = [...new Set(Object.values(this.config.sounds).flatMap((s) => s.files ?? [s.file]))];
    await Promise.all(
      files.map(async (file) => {
        try {
          this.buffers.set(file, await this.loader.loadAsync(AUDIO_PATH + file));
        } catch {
          this.missing.push(file);
        }
      })
    );
    if (this.missing.length) console.warn(`[Timber Rush] Audio no disponible: ${this.missing.join(', ')} (en ${AUDIO_PATH})`);
  }

  /** Reanuda el AudioContext tras la primera interacción del usuario (política de los navegadores). */
  installUnlock(target = window) {
    const unlock = () => {
      const ctx = this.listener.context;
      if (ctx.state !== 'running') ctx.resume();
      target.removeEventListener('pointerdown', unlock);
      target.removeEventListener('keydown', unlock);
    };
    target.addEventListener('pointerdown', unlock);
    target.addEventListener('keydown', unlock);
  }

  setMasterVolume(volume) {
    this.config.masterVolume = volume;
    this.listener.setMasterVolume(volume);
  }

  /**
   * Reproduce un sonido en una posición del mundo. Devuelve true si ha sonado.
   * No suena si: el audio aún está bloqueado, falta el archivo o lo impide el limitador.
   */
  play(name, position) {
    const cfg = this.config.sounds[name];
    // Con varias variantes se elige una al azar entre las que se han cargado
    const variants = cfg ? (cfg.files ?? [cfg.file]).filter((f) => this.buffers.has(f)) : [];
    const buffer = variants.length ? this.buffers.get(variants[Math.floor(Math.random() * variants.length)]) : null;
    const ctx = this.listener.context;
    if (!buffer || ctx.state !== 'running') return false;
    const now = ctx.currentTime;
    if (!this.limiter.canPlay(name, now)) return false;

    // Fuente libre; si todas suenan, se reutiliza la que empezó hace más tiempo
    const source = this.pool.find((s) => !s.isPlaying) ?? this.pool.reduce((a, b) => (a.lastStart <= b.lastStart ? a : b));
    if (source.isPlaying) source.stop();

    source.position.copy(position);
    source.updateMatrixWorld(true); // Coloca el panner ya, sin esperar al siguiente fotograma
    source.setBuffer(buffer);
    source.offset = cfg.offset ?? 0;
    source.duration = cfg.duration; // undefined = hasta el final
    // Variación de volumen opcional (p. ej. pasos): cada repetición suena un poco distinta
    const volumeVariation = cfg.volumeVariation ?? 0;
    source.setVolume((cfg.volume ?? 1) * (1 - Math.random() * volumeVariation));
    const variation = cfg.pitchVariation ?? 0;
    source.setPlaybackRate(1 + (Math.random() * 2 - 1) * variation); // Evita que suene repetitivo
    source.play();
    source.lastStart = now;

    const length = (cfg.duration ?? buffer.duration - (cfg.offset ?? 0)) / source.playbackRate;
    this.limiter.register(name, now, length);
    return true;
  }

  /**
   * Sonido de interfaz (sin posición), opcionalmente programado "delay" segundos después en el
   * reloj de audio. Si ese sonido ya estaba sonando o programado, se reinicia (nunca se duplica).
   * Devuelve true si se ha programado; false si el audio está bloqueado, falta el archivo o falla.
   */
  playUi(name, delay = 0) {
    try {
      const cfg = this.config.sounds[name];
      const source = this.uiSources.get(name);
      const buffer = cfg && this.buffers.get(cfg.file);
      if (!source || !buffer || this.listener.context.state !== 'running') return false;
      if (source.isPlaying) source.stop();
      source.setBuffer(buffer);
      source.setVolume(cfg.volume ?? 1);
      source.play(delay);
      return true;
    } catch (error) {
      console.warn(`[Timber Rush] No se pudo reproducir ${name}`, error);
      return false;
    }
  }

  /** Detiene (o cancela si aún no habían empezado) todos los sonidos de interfaz. */
  stopUi() {
    for (const source of this.uiSources.values()) {
      try {
        if (source.isPlaying) source.stop();
      } catch {
        // Ignorar: detener un sonido nunca debe romper el juego
      }
    }
  }

  /** Traduce los eventos de la tala (chopping.js) a sonidos. */
  handleChopEvent(event) {
    switch (event.type) {
      case 'hit':
        // Chasquido del filo + golpe grave de la madera (variante al azar)
        this.play('axe_hit', event.position);
        this.play('axe_body', event.position);
        if (event.final) this.play('wood_crack', event.position); // El último golpe parte la madera
        break;
      case 'fallStart':
        this.play('tree_falling', event.position);
        break;
      case 'fallImpact':
        // Ramas que chocan + el tronco pesado golpeando la tierra
        this.play('tree_impact', event.position);
        this.play('ground_thud', event.position);
        break;
      default:
        break;
    }
  }
}
