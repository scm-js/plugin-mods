/**
 * The mod's pictures: which GRPs there are (the mod's own, and the game's its images name), which images draw each,
 * a frame drawn through a palette with a player's team colour, and a PNG brought in — a whole sheet, or one frame in
 * place of the frame shown. Pure: the panel puts the pixels on a canvas.
 */
import { decodeGrpImage, encodeGrpImage, entryText, framePicture, gameName, grpToPng, pngToGrp, sheetColumns, type GrpImage, type NamedPalette, type QuantiseReport } from "@scm-js/core";
import { decodePng } from "@scm-js/core";
import type { ModSession } from "./session";

/** The tilesets whose `.wpe` a picture can be drawn with; the game draws units with the map's. */
export const PALETTES = ["jungle", "badlands", "platform", "install", "ashworld", "desert", "ice", "twilight"] as const;

export interface PictureEntry {
  /** The member (`unit\terran\marine.grp`), by the game's name. */
  member: string;
  /** The mod has it (else it is the game's, named by the mod's images). */
  own: boolean;
  /** The images that draw it (images.dat's `grp_file`). */
  images: number[];
}

/**
 * Every GRP the mod has, every one its images name that it does not, and the game's others (`gameGrps`, paths under
 * `unit\` as the editor's copy lists them), by path.
 */
export function pictureList(session: ModSession, gameGrps: readonly string[] = []): PictureEntry[] {
  const byPath = new Map<string, PictureEntry>();
  for (const k of session.members()) if (k.endsWith(".grp")) byPath.set(k, { member: k, own: true, images: [] });
  for (const p of gameGrps) { const k = gameName(`unit\\${p}`); if (!byPath.has(k)) byPath.set(k, { member: k, own: false, images: [] }); }
  const images = session.table("images"), tbl = session.data.strings.images;
  if (images && tbl) {
    for (let id = 0; id < images.count; id++) {
      const v = images.columns.grp_file[id];
      if (!v || v > tbl.length) continue;
      const path = entryText(tbl[v - 1]);
      if (!path) continue;
      const member = gameName(`unit\\${path}`);
      let e = byPath.get(member);
      if (!e) { e = { member, own: false, images: [] }; byPath.set(member, e); }
      e.images.push(id);
    }
  }
  return [...byPath.values()].sort((a, b) => (a.member < b.member ? -1 : 1));
}

/** A `.wpe` (256 × RGBX) or 768-byte palette as 256 RGBA words, index 0 transparent. */
export function paletteRgba(colours: Uint8Array): Uint8Array {
  const step = colours.length >= 1024 ? 4 : 3;
  const out = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) { out[i * 4] = colours[i * step]; out[i * 4 + 1] = colours[i * step + 1]; out[i * 4 + 2] = colours[i * step + 2]; out[i * 4 + 3] = i === 0 ? 0 : 255; }
  return out;
}

/** The index remap for a `tunit.pcx` row: palette slots 8–15 take the row's eight indices (as the editor draws units). */
export function teamLut(tunit: Uint8Array | null, row: number | null): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  if (tunit && row !== null && row >= 0) {
    const r = Math.min(Math.floor(tunit.length / 8) - 1, row);
    for (let s = 0; s < 8; s++) lut[8 + s] = tunit[r * 8 + s] ?? 8 + s;
  }
  return lut;
}

/** A frame as RGBA in the GRP's box, mirrored when `flip`, through `palette` (RGBA words) and `lut`. */
export function frameRgba(image: GrpImage, index: number, palette: Uint8Array, lut: Uint8Array, flip = false): Uint8ClampedArray<ArrayBuffer> {
  const { width, height } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  if (index < 0 || index >= image.frames.length) return out;
  const pic = framePicture(image, index);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = pic[y * width + x];
      if (!v) continue;
      const c = lut[v] * 4, o = (y * width + (flip ? width - 1 - x : x)) * 4;
      out[o] = palette[c]; out[o + 1] = palette[c + 1]; out[o + 2] = palette[c + 2]; out[o + 3] = 255;
    }
  }
  return out;
}

/** Every frame laid out as `grpToPng`'s sheet would be, as RGBA. */
export function sheetRgba(image: GrpImage, palette: Uint8Array, lut: Uint8Array): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer>; columns: number } {
  const columns = sheetColumns(image.frames.length);
  const rows = Math.max(1, Math.ceil(image.frames.length / columns));
  const W = Math.max(1, image.width * columns), H = Math.max(1, image.height * rows);
  const rgba = new Uint8ClampedArray(W * H * 4);
  image.frames.forEach((_, i) => {
    const f = frameRgba(image, i, palette, lut);
    const ox = (i % columns) * image.width, oy = Math.floor(i / columns) * image.height;
    for (let y = 0; y < image.height; y++) rgba.set(f.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((oy + y) * W + ox) * 4);
  });
  return { width: W, height: H, rgba, columns };
}

export interface ImportPlan {
  /** What the PNG is taken as. */
  kind: "sheet" | "frame";
  grp: Uint8Array;
  image: GrpImage;
  report: QuantiseReport;
}

/**
 * A PNG as the GRP's new bytes. A sheet `grpToPng` wrote (or one whole frames wide and high) replaces every frame; a
 * picture one frame in size replaces frame `frame` alone. Anything else is refused, with why.
 */
export async function importPng(current: GrpImage, png: Uint8Array, palette: NamedPalette, frame: number): Promise<ImportPlan | { refused: "size" | "frames"; width: number; height: number }> {
  const img = await decodePng(png);
  const fromSheet = !!img.text["scmjs:grp"];
  if (!fromSheet && img.width === current.width && img.height === current.height) {
    const one = await pngToGrp(png, palette, { frameWidth: current.width, frameHeight: current.height, frames: 1 });
    const frames = current.frames.slice();
    frames[frame] = one.image.frames[0];
    // A frame given new pixels no longer shares another's data.
    const image: GrpImage = { ...current, frames, ...(current.shares ? { shares: current.shares.map((s, i) => (i === frame ? i : s === frame ? i : s)) } : {}) };
    return { kind: "frame", grp: encodeGrpImage(image), image, report: one.report };
  }
  if (fromSheet || (img.width % current.width === 0 && img.height % current.height === 0)) {
    const cells = (img.width / current.width) * (img.height / current.height);
    if (!fromSheet && cells < current.frames.length) return { refused: "frames", width: img.width, height: img.height };
    const out = await pngToGrp(png, palette, fromSheet ? {} : { frameWidth: current.width, frameHeight: current.height, frames: current.frames.length });
    return { kind: "sheet", ...out };
  }
  return { refused: "size", width: img.width, height: img.height };
}

/** The GRP as a PNG sheet, in its palette's colours, with the note that brings it back. */
export function exportPng(bytes: Uint8Array, palette: NamedPalette, member: string): Promise<Uint8Array> {
  return grpToPng(decodeGrpImage(bytes), palette, { text: { "scmjs:path": member } });
}
