/**
 * Sounds as the game plays them: plain PCM WAVs (22050 Hz, 16-bit, mono is what the game's own are). A sound the
 * person brings — a WAV in another rate or width, or anything the browser decodes (MP3, Ogg, FLAC, a recording) —
 * becomes one: a plain PCM WAV is read here, anything else by Web Audio; the rate and channels are changed here by
 * linear interpolation and averaging, so the same input gives the same bytes in any browser and in the tests.
 * The editor's Sound Editor (`audioConvert.ts`) is the model; core does not export its WAV codec, so this is a small
 * one of the plugin's own.
 */
import { parseWavHeader } from "@scm-js/core";

export interface Pcm { sampleRate: number; channels: Float32Array[] }
export interface WavTarget { sampleRate: number; channels: 1 | 2; bits: 8 | 16 }

/** What the game's own sounds are. */
export const GAME_WAV: WavTarget = { sampleRate: 22050, channels: 1, bits: 16 };

/** Samples of a plain PCM (or float) WAV, or null when it is in another encoding. */
export function decodePcmWav(bytes: Uint8Array): Pcm | null {
  const info = parseWavHeader(bytes);
  if (!info || (info.format !== 1 && info.format !== 3)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = info.dataOffset, size = info.dataLength;
  const width = info.bitsPerSample / 8, n = info.channels;
  const frames = Math.floor(size / (width * n));
  const float = info.format === 3;
  const channels = Array.from({ length: n }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < n; c++) {
      const o = start + (f * n + c) * width;
      let s: number;
      if (float && width === 4) s = v.getFloat32(o, true);
      else if (width === 1) s = (bytes[o] - 128) / 128;
      else if (width === 2) s = v.getInt16(o, true) / 32768;
      else if (width === 3) s = ((bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) << 8 >> 8) / 8388608;
      else if (width === 4) s = v.getInt32(o, true) / 2147483648;
      else return null;
      channels[c][f] = s;
    }
  }
  return { sampleRate: info.sampleRate, channels };
}

/** Samples in another rate and channel count: linear interpolation, channels averaged down (or copied up). */
export function resample(pcm: Pcm, target: WavTarget): Float32Array[] {
  const mono = pcm.channels.length === 1 ? pcm.channels[0] : null;
  const src = target.channels === 1
    ? [mono ?? pcm.channels[0].map((_, i) => pcm.channels.reduce((sum, ch) => sum + ch[i], 0) / pcm.channels.length)]
    : [pcm.channels[0], pcm.channels[1] ?? pcm.channels[0]];
  if (pcm.sampleRate === target.sampleRate) return src.map((c) => c.slice());
  const ratio = pcm.sampleRate / target.sampleRate;
  const frames = Math.max(1, Math.round(src[0].length / ratio));
  return src.map((c) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const x = i * ratio, j = Math.floor(x), t = x - j;
      out[i] = (c[j] ?? 0) * (1 - t) + (c[Math.min(j + 1, c.length - 1)] ?? 0) * t;
    }
    return out;
  });
}

/** A plain PCM WAV of the samples. */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 8 | 16): Uint8Array {
  const n = channels.length, frames = channels[0]?.length ?? 0, width = bits / 8;
  const data = frames * n * width;
  const out = new Uint8Array(44 + data + (data & 1));
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, out.length - 8, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, n, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * n * width, true); v.setUint16(32, n * width, true); v.setUint16(34, bits, true);
  tag(36, "data"); v.setUint32(40, data, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < n; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][f]));
      if (bits === 16) { v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true); o += 2; }
      else { out[o] = Math.round(s * 127 + 128); o += 1; }
    }
  }
  return out;
}

/**
 * `bytes` as a WAV in `target`: unchanged when it already is one; a plain PCM WAV converted here; anything else
 * decoded by `decode` (Web Audio's, in the page) first.
 */
export async function convertToWav(bytes: Uint8Array, target: WavTarget, decode?: (bytes: Uint8Array) => Promise<Pcm>): Promise<{ bytes: Uint8Array; converted: boolean; seconds: number }> {
  const info = parseWavHeader(bytes);
  if (info && info.format === 1 && info.sampleRate === target.sampleRate && info.channels === target.channels && info.bitsPerSample === target.bits) {
    const pcm = decodePcmWav(bytes);
    return { bytes, converted: false, seconds: pcm ? pcm.channels[0].length / pcm.sampleRate : 0 };
  }
  const pcm = decodePcmWav(bytes) ?? (decode ? await decode(bytes) : null);
  if (!pcm) throw new Error("not a sound this page can read");
  return { bytes: encodeWav(resample(pcm, target), target.sampleRate, target.bits), converted: true, seconds: pcm.channels[0].length / pcm.sampleRate };
}

/** Web Audio's decoder as a `decode` for `convertToWav` (any format the browser plays). */
export async function browserDecode(bytes: Uint8Array): Promise<Pcm> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
  return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice()) };
}
