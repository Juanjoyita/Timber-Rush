// Procesado de los sonidos de la venta (Fase 7B). Herramienta de preparación: NO forma parte del juego.
// Uso desde la raíz del proyecto (macOS, usa afconvert del sistema):
//   node herramientas/procesar_audio_venta.mjs
// Lee los MP3 originales de recursos-originales/ (no los modifica) y escribe en public/assets/audio/:
//   sale_bonus.wav · sale_chime.wav · sale_levelup.wav  (WAV mono 16 bits, 44,1 kHz)
//
// Tratamiento de cada sonido:
//   1. Se decodifica a WAV temporal con afconvert.
//   2. Se recorta el fragmento útil (sin silencios ni colas largas) con fundidos suaves.
//   3. Se mezcla a mono (se comprueba antes que no haya cancelación de fase).
//   4. Se iguala la sonoridad: RMS de la parte audible a TARGET_RMS_DB, con el pico limitado a
//      PEAK_LIMIT_DB (sin distorsión: solo se cambia la ganancia, nunca se recorta la onda).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'recursos-originales';
const OUT = 'public/assets/audio';
const RATE = 44100;
const TARGET_RMS_DB = -18; // Sonoridad común de la parte audible
const PEAK_LIMIT_DB = -3; // Margen para no saturar al sumarse con otros sonidos

// Fragmentos elegidos tras analizar los originales (envolvente y notas dominantes):
//  - Bonus Points: arpegio en Do mayor, 0,00–0,60 s (después solo hay cola).
//  - Reward Chime: 0,46 s de silencio al principio; brillo útil 0,46–1,42 s (después decae
//    hacia Re/Fa#, que chocaría con el Do menor de Level Up).
//  - Level Up 06: arpegio ascendente en Do menor; la parte fuerte acaba a 0,64 s.
const SOUNDS = [
  { file: 'liecio-bonus-points-190035.mp3', out: 'sale_bonus.wav', start: 0.0, end: 0.6, fadeIn: 0.003, fadeOut: 0.12 },
  { file: 'universfield-reward-chime-144757.mp3', out: 'sale_chime.wav', start: 0.46, end: 1.42, fadeIn: 0.005, fadeOut: 0.3 },
  { file: 'universfield-level-up-06-370051.mp3', out: 'sale_levelup.wav', start: 0.04, end: 1.0, fadeIn: 0.005, fadeOut: 0.3 },
];

function readWav(path) {
  const b = readFileSync(path);
  let o = 12, fmt, data;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  const n = data.length / 2 / fmt.ch;
  const channels = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) channels[c][i] = data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
  return { rate: fmt.rate, channels };
}

function writeWavMono(path, x, rate) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(path, b);
}

const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
/** RMS de la parte audible (ventanas de 20 ms por encima de -40 dBFS). */
function activeRms(x, rate) {
  const win = Math.round(rate * 0.02);
  let sum = 0, count = 0;
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let k = 0; k < win; k++) s += x[i + k] ** 2;
    if (Math.sqrt(s / win) > 10 ** (-40 / 20)) { sum += s; count += win; }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

const tmp = mkdtempSync(join(tmpdir(), 'timber-audio-'));
try {
  for (const s of SOUNDS) {
    const src = join(SRC, s.file);
    if (!existsSync(src)) throw new Error(`No existe ${src}`);
    const wav = join(tmp, `${s.out}.tmp.wav`);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, src, wav]);
    const { rate, channels } = readWav(wav);
    const a = Math.round(s.start * rate), e = Math.min(channels[0].length, Math.round(s.end * rate));
    const parts = channels.map((c) => c.subarray(a, e));
    const mono = new Float32Array(e - a);
    for (let i = 0; i < mono.length; i++) mono[i] = parts.reduce((sum, c) => sum + c[i], 0) / parts.length;
    // Pérdida al pasar a mono (cancelación de fase entre canales)
    const stereoRms = Math.sqrt(parts.reduce((sum, c) => sum + rms(c) ** 2, 0) / parts.length);
    const monoLoss = db(stereoRms) - db(rms(mono));
    // Fundidos (curva coseno: sin chasquidos)
    const fi = Math.round(s.fadeIn * rate), fo = Math.round(s.fadeOut * rate);
    for (let i = 0; i < fi; i++) mono[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
    for (let i = 0; i < fo; i++) mono[mono.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
    // Ganancia: sonoridad objetivo sin superar el pico límite
    const peak = mono.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const gainDb = Math.min(TARGET_RMS_DB - db(activeRms(mono, rate)), PEAK_LIMIT_DB - db(peak));
    const gain = 10 ** (gainDb / 20);
    for (let i = 0; i < mono.length; i++) mono[i] *= gain;
    writeWavMono(join(OUT, s.out), mono, rate);
    const newPeak = mono.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    console.log(`${s.out.padEnd(17)} ${s.file} · ${s.start.toFixed(2)}–${s.end.toFixed(2)} s (${(mono.length / rate).toFixed(2)} s) · pérdida mono ${monoLoss.toFixed(2)} dB · ganancia ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB · RMS audible ${db(activeRms(mono, rate)).toFixed(1)} dBFS · pico ${db(newPeak).toFixed(1)} dBFS`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
