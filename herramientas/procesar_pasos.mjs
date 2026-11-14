// Procesado de los sonidos de pasos. Herramienta de preparación: NO forma parte del juego.
// Uso desde la raíz del proyecto (macOS, usa afconvert del sistema):
//   node herramientas/procesar_pasos.mjs
// Lee los OGG originales de recursos-originales/kenney_impact-sounds/Audio/ (Kenney, CC0; no se
// modifican) y escribe en public/assets/audio/:
//   step_grass_0..4.wav (hierba) · step_wood_0..4.wav (suelo de madera del aserradero)
//
// Los originales duran 0,25–0,8 s pero el paso solo ocupa ~0,1–0,2 s (el resto es silencio) y sus
// niveles varían hasta 9 dB entre variantes. Por eso:
//   1. Se recorta cada paso a su parte audible, con un fundido final corto.
//   2. Hierba: se suavizan los agudos (filtro paso bajo de 2 polos) y el golpe inicial (entrada
//      de 4 ms): el original es un chasquido seco que resulta molesto al repetirse cada paso.
//   3. Se iguala la sonoridad de todas las variantes de un mismo suelo (RMS de la parte audible),
//      con el pico limitado: solo cambia la ganancia, nunca se recorta la onda.
//   4. WAV mono 16 bits a 22,05 kHz (como el resto de sonidos de Kenney del juego).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'recursos-originales/kenney_impact-sounds/Audio';
const OUT = 'public/assets/audio';
const RATE = 22050;
const TARGET_RMS_DB = -22; // Algo por debajo de los demás efectos: los pasos se repiten sin parar
const PEAK_LIMIT_DB = -3;
const SETS = [
  { prefix: 'footstep_grass', out: 'step_grass', maxLength: 0.22, fadeOut: 0.06, fadeIn: 0.004, lowpass: 2800 },
  { prefix: 'footstep_wood', out: 'step_wood', maxLength: 0.26, fadeOut: 0.06, fadeIn: 0.002, lowpass: null },
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
  const n = data.length / 2 / fmt.ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2);
    x[i] = s / fmt.ch / 32768;
  }
  return { rate: fmt.rate, x };
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

const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));

/** Filtro paso bajo de 2 polos (dos filtros de 1 polo en cascada, 12 dB/octava): suaviza agudos. */
function lowpass(x, rate, cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  for (let pass = 0; pass < 2; pass++) {
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      y += a * (x[i] - y);
      x[i] = y;
    }
  }
}
/** Ventanas de 10 ms: RMS de la parte audible (> -45 dBFS) y final del sonido audible. */
function measure(x, rate) {
  const win = Math.round(rate * 0.01);
  let sum = 0, count = 0, lastAudible = 0;
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let k = 0; k < win; k++) s += x[i + k] ** 2;
    if (Math.sqrt(s / win) > 10 ** (-45 / 20)) {
      sum += s;
      count += win;
      lastAudible = i + win;
    }
  }
  return { rms: Math.sqrt(sum / Math.max(1, count)), lastAudible };
}

const tmp = mkdtempSync(join(tmpdir(), 'timber-pasos-'));
try {
  for (const set of SETS) {
    for (let v = 0; v < 5; v++) {
      const src = join(SRC, `${set.prefix}_00${v}.ogg`);
      if (!existsSync(src)) throw new Error(`No existe ${src}`);
      const wav = join(tmp, `${set.out}_${v}.wav`);
      execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, src, wav]);
      const { rate, x: full } = readWav(wav);
      // Recorte: hasta el final audible (+20 ms), sin pasar de maxLength
      const { lastAudible } = measure(full, rate);
      const end = Math.min(full.length, Math.round(set.maxLength * rate), lastAudible + Math.round(0.02 * rate));
      const x = full.slice(0, end);
      if (set.lowpass) lowpass(x, rate, set.lowpass);
      const fi = Math.round(set.fadeIn * rate); // Entrada suave: sin chasquido inicial
      for (let i = 0; i < fi; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
      const fo = Math.min(Math.round(set.fadeOut * rate), Math.floor(x.length * 0.4)); // Respeta el golpe inicial
      for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
      // Sonoridad común para todas las variantes
      const peak = x.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
      const gainDb = Math.min(TARGET_RMS_DB - db(measure(x, rate).rms), PEAK_LIMIT_DB - db(peak));
      const g = 10 ** (gainDb / 20);
      for (let i = 0; i < x.length; i++) x[i] *= g;
      const out = `${set.out}_${v}.wav`;
      writeWavMono(join(OUT, out), x, rate);
      const newPeak = x.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
      console.log(`${out.padEnd(16)} ← ${set.prefix}_00${v}.ogg · ${(x.length / rate).toFixed(3)} s · ganancia ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB · RMS audible ${db(measure(x, rate).rms).toFixed(1)} dBFS · pico ${db(newPeak).toFixed(1)} dBFS`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
