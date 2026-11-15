// Sonidos de los cofres (Fase 11C). Herramienta de preparación: NO forma parte del juego.
// Uso desde la raíz del proyecto (macOS, usa afconvert del sistema):
//   node herramientas/procesar_sonidos_cofre.mjs
// Lee los OGG de recursos-originales/kenney_impact-sounds/Audio/ (Kenney, CC0; no se modifican) y
// COMPONE sonidos nuevos en public/assets/audio/ (WAV mono 16 bits, 44,1 kHz):
//   chest_open.wav         chasquido metálico de la cerradura + golpe de madera de la tapa
//   chest_coins_small.wav  tintineo corto de monedas (cofre común)
//   chest_coins.wav        tintineo más rico (cofre raro)
//   chest_treasure.wav     lluvia de monedas con una campana brillante (tesoro legendario)
// Las monedas son golpes cortos de cristal, placa y metal subidos de tono (más agudos y cortos:
// suenan a monedas), repartidos en el tiempo con volumen decreciente. Todo es determinista.
// Al final se iguala la sonoridad (RMS) con el pico limitado: solo cambia la ganancia.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'recursos-originales/kenney_impact-sounds/Audio';
const OUT = 'public/assets/audio';
const RATE = 44100;
const PEAK_LIMIT_DB = -3;

function readWav(path) {
  const b = readFileSync(path);
  let o = 12, fmt, data;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  const n = data.length / 2 / fmt.ch, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
    out[i] = s / fmt.ch;
  }
  return out;
}

function writeWav(path, samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2));
  writeFileSync(path, b);
}

const tmp = mkdtempSync(join(tmpdir(), 'cofre-'));
const cache = new Map();
function load(name) {
  if (!cache.has(name)) {
    const wav = join(tmp, `${name}.wav`);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, `${SRC}/${name}.ogg`, wav]);
    const s = readWav(wav);
    // Empieza en el golpe (sin el silencio inicial)
    let start = 0;
    const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    while (start < s.length && Math.abs(s[start]) < peak * 0.05) start++;
    cache.set(name, s.subarray(Math.max(0, start - 20)));
  }
  return cache.get(name);
}

/** Copia un sonido en la mezcla: cambio de tono por remuestreo, ganancia, duración y fundido. */
function mix(dest, src, { at = 0, pitch = 1, gain = 1, length = 0.3, fade = 0.05 }) {
  const start = Math.round(at * RATE), n = Math.min(Math.round(length * RATE), Math.floor((src.length - 1) / pitch));
  const fadeN = Math.round(fade * RATE);
  for (let i = 0; i < n && start + i < dest.length; i++) {
    const p = i * pitch, k = Math.floor(p), f = p - k;
    const v = src[k] * (1 - f) + src[k + 1] * f;
    const env = i > n - fadeN ? (n - i) / fadeN : 1;
    dest[start + i] += v * gain * env;
  }
}

let seed = 1234567;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** Tintineo de monedas: "count" golpecitos agudos a lo largo de "span" segundos. */
function coins(dest, { from = 0, count, span, gain = 0.8 }) {
  const sources = ['impactGlass_light_000', 'impactGlass_light_002', 'impactGlass_light_004', 'impactPlate_light_001', 'impactPlate_light_003', 'impactMetal_light_002'];
  for (let i = 0; i < count; i++) {
    const t = from + span * (i / count) ** 0.8 + rand() * 0.03;
    const decay = 1 - 0.6 * (i / count);
    mix(dest, load(sources[Math.floor(rand() * sources.length)]), { at: t, pitch: 1.9 + rand() * 0.9, gain: gain * decay * (0.6 + rand() * 0.4), length: 0.12, fade: 0.06 });
  }
}

function normalize(s, targetRmsDb) {
  let sum = 0, n = 0, peak = 0;
  for (const v of s) {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 0.01) { sum += v * v; n++; }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  let gain = 10 ** (targetRmsDb / 20) / rms;
  gain = Math.min(gain, 10 ** (PEAK_LIMIT_DB / 20) / peak);
  return s.map((v) => v * gain);
}

const sounds = {
  // Cerradura (metal, agudo y corto) + tapa de madera que golpea al abrirse
  chest_open: { length: 0.62, rms: -17, build(d) {
    mix(d, load('impactMetal_light_000'), { at: 0, pitch: 1.35, gain: 0.7, length: 0.1, fade: 0.04 });
    mix(d, load('impactMetal_light_003'), { at: 0.035, pitch: 1.6, gain: 0.4, length: 0.08, fade: 0.04 });
    mix(d, load('impactWood_light_002'), { at: 0.13, pitch: 0.85, gain: 0.9, length: 0.35, fade: 0.15 });
    mix(d, load('impactPlank_medium_001'), { at: 0.2, pitch: 1.1, gain: 0.35, length: 0.3, fade: 0.15 });
  } },
  chest_coins_small: { length: 0.55, rms: -19, build(d) { coins(d, { count: 6, span: 0.32 }); } },
  chest_coins: { length: 0.85, rms: -18, build(d) { coins(d, { count: 12, span: 0.55 }); coins(d, { from: 0.08, count: 5, span: 0.4, gain: 0.5 }); } },
  chest_treasure: { length: 1.7, rms: -17, build(d) {
    mix(d, load('impactBell_heavy_001'), { at: 0, pitch: 1.5, gain: 0.55, length: 1.2, fade: 0.8 }); // Campana brillante
    mix(d, load('impactBell_heavy_003'), { at: 0.22, pitch: 2.0, gain: 0.35, length: 1.0, fade: 0.7 });
    coins(d, { from: 0.05, count: 24, span: 1.1 });
    coins(d, { from: 0.2, count: 10, span: 0.9, gain: 0.55 });
  } },
};

try {
  for (const [name, def] of Object.entries(sounds)) {
    const dest = new Float32Array(Math.round(def.length * RATE));
    def.build(dest);
    const out = normalize(dest, def.rms);
    writeWav(`${OUT}/${name}.wav`, out);
    console.log(`${name}.wav · ${def.length.toFixed(2)} s`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
