/**
 * A sound brought in, as the game plays sounds: a PCM WAV (22050 Hz, 16-bit, mono is what the game's own are). The WAV
 * codec is core's (`decodeWav` reads any WAV the game or a sound tool writes, the game's IMA ADPCM included;
 * `encodeWav` writes PCM); anything else is decoded by Web Audio. The rate and channels are changed here by linear
 * interpolation and averaging, so the same input gives the same bytes in any browser and in the tests (the editor's
 * Sound Editor renders through an `OfflineAudioContext`, which is not in core).
 */
import { decodeWav, encodeWav, isPlainPcm, parseWavHeader, type PcmAudio } from "@scm-js/core";

export type Pcm = PcmAudio;
export interface WavTarget { sampleRate: number; channels: 1 | 2; bits: 8 | 16 }

/** What the game's own sounds are. */
export const GAME_WAV: WavTarget = { sampleRate: 22050, channels: 1, bits: 16 };

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

/**
 * `bytes` as a WAV in `target`: unchanged when it already is a plain PCM one of that rate, width and channel count;
 * any WAV core reads converted here; anything else decoded by `decode` (Web Audio's, in the page) first.
 */
export async function convertToWav(bytes: Uint8Array, target: WavTarget, decode?: (bytes: Uint8Array) => Promise<Pcm>): Promise<{ bytes: Uint8Array; converted: boolean; seconds: number }> {
  const info = parseWavHeader(bytes);
  const pcm = decodeWav(bytes) ?? (decode ? await decode(bytes).catch(() => null) : null);
  if (!pcm) throw new Error("not a sound this page can read");
  const seconds = (pcm.channels[0]?.length ?? 0) / pcm.sampleRate;
  if (info && isPlainPcm(info) && info.sampleRate === target.sampleRate && info.channels === target.channels && info.bitsPerSample === target.bits) return { bytes, converted: false, seconds };
  return { bytes: encodeWav(resample(pcm, target), target.sampleRate, target.bits), converted: true, seconds };
}

/** Web Audio's decoder as a `decode` for `convertToWav` (any format the browser plays). */
export async function browserDecode(bytes: Uint8Array): Promise<Pcm> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
  return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice()) };
}
