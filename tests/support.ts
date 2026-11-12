/**
 * A made mod, from the codecs alone: nothing of the game's or of any mod's. The game's own tables are not needed —
 * a table here is the game's layout with a few entries filled in, enough for names, a weapon, a script and a sound.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { emptyDat, encodeDat, encodeTblFile, iscriptFromText, type DatFile } from "@scm-js/core";
import type { Piece } from "../source";

export const ISCRIPT = `.headerstart
IsId             	0
Type             	0
Init             	Marine_Init
.headerend

Marine_Init:
	playfram         	0x00
	wait             	1
	playsnd          	1
	end
`;

/** units.dat with a marine (40 hit points, weapon 0), weapons.dat with one weapon, stat_txt.tbl naming both. */
export function madeTables(): { units: DatFile; weapons: DatFile; stat: string[] } {
  const units = emptyDat("units");
  const weapons = emptyDat("weapons");
  for (let id = 0; id < units.count; id++) { units.columns.ground_weapon[id] = 130; units.columns.air_weapon[id] = 130; units.columns.subunit1[id] = 228; units.columns.subunit2[id] = 228; }
  units.columns.hit_points[0] = 40 * 256;
  units.columns.ground_weapon[0] = 0;
  units.columns.mineral_cost[0] = 50;
  weapons.columns.damage_amount[0] = 6;
  // stat_txt: one entry a unit (228), then the weapon's label.
  const stat: string[] = Array.from({ length: 228 }, (_, id) => (id === 0 ? "Terran Marine\0*\0Ground Units\0" : id === 1 ? "Terran Ghost\0*\0Ground Units\0" : "\0"));
  stat.push("Gauss Rifle\0");
  weapons.columns.label[0] = stat.length; // 1-based
  return { units, weapons, stat };
}

export const bytesPiece = (path: string, data: Uint8Array): Piece => ({ path, size: data.length, read: async () => data });

/** The made mod as a folder of loose files: `made/arr/units.dat` … plus a read-me beside the game's folders. */
export function madeFolder(root = "made"): Piece[] {
  const { units, weapons, stat } = madeTables();
  const files: [string, Uint8Array][] = [
    ["arr/units.dat", encodeDat(units)],
    ["arr/weapons.dat", encodeDat(weapons)],
    ["rez/stat_txt.tbl", encodeTblFile({ strings: stat, encoding: "windows-1252" })],
    ["scripts/iscript.bin", iscriptFromText(ISCRIPT)],
    ["sound/misc/made.wav", new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69])],
    ["readme.txt", new TextEncoder().encode("A made mod.")],
  ];
  return files.map(([p, d]) => bytesPiece(`${root}/${p}`, d));
}

/** A folder on disk as the pieces a drop gives: paths under the folder's own name. */
export function diskPieces(dir: string): Piece[] {
  const out: Piece[] = [];
  const top = dir.replace(/\/+$/, "").split("/").pop()!;
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith(".")) continue;
      const full = join(d, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else out.push({ path: `${top}/${relative(dir, full).replace(/\\/g, "/")}`, size: s.size, read: async () => new Uint8Array(readFileSync(full)) });
    }
  };
  walk(dir);
  return out;
}

export const equal = (a: Uint8Array | null, b: Uint8Array | null) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/* ── A patcher exe, made byte by byte (no mod is needed) ──────────────── */

const concat = (...parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const words = (...w: number[]): Uint8Array => { const b = new Uint8Array(w.length * 4), v = new DataView(b.buffer); w.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };

/** A Windows program of one section, 0x400 bytes, never run; `overlayAt` where FireGraft's patcher keeps its overlay's offset. */
function program(overlayAt: number): Uint8Array {
  const b = new Uint8Array(0x400), v = new DataView(b.buffer);
  b[0] = 0x4d; b[1] = 0x5a; v.setUint32(0x18, overlayAt, true); v.setUint32(0x3c, 0x40, true);
  v.setUint32(0x40, 0x00004550, true); v.setUint16(0x46, 1, true); v.setUint16(0x54, 0, true);
  b.set([0x2e, 0x74, 0x65, 0x78, 0x74], 0x40 + 24);
  v.setUint32(0x40 + 24 + 16, 0x200, true); v.setUint32(0x40 + 24 + 20, 0x200, true);
  return b;
}

/** A library of 0x400 bytes whose export directory names it `name`: a plugin a patcher carries goes by that name. */
export function madeLibrary(name: string): Uint8Array {
  const b = new Uint8Array(0x400), v = new DataView(b.buffer);
  b[0] = 0x4d; b[1] = 0x5a; v.setUint32(0x3c, 0x40, true);
  v.setUint32(0x40, 0x00004550, true); v.setUint16(0x44, 0x14c, true); v.setUint16(0x46, 1, true); v.setUint16(0x54, 0xe0, true); v.setUint16(0x56, 0x2102, true);
  const opt = 0x58;
  v.setUint16(opt, 0x10b, true); v.setUint32(opt + 92, 16, true); v.setUint32(opt + 96, 0x1000, true); v.setUint32(opt + 100, 40, true);
  const section = opt + 0xe0;
  b.set([0x2e, 0x65, 0x64, 0x61, 0x74, 0x61], section);
  v.setUint32(section + 8, 0x100, true); v.setUint32(section + 12, 0x1000, true); v.setUint32(section + 16, 0x200, true); v.setUint32(section + 20, 0x200, true);
  v.setUint32(0x200 + 12, 0x1000 + 40, true); b.set(new TextEncoder().encode(name), 0x228);
  return b;
}

/** FireGraft's patcher exe: the program, its overlay (`PEGF`, a count, a form, then each plugin's id, size, 0 and bytes) and the archive after it. */
export function madePatcherExe(plugins: { id: number; bytes: Uint8Array }[], archive: Uint8Array): Uint8Array {
  const overlay = concat(new Uint8Array([0x50, 0x45, 0x47, 0x46]), words(plugins.length, 1), ...plugins.flatMap((p) => [words(p.id, p.bytes.length, 0), p.bytes]));
  const head = concat(program(0x400), overlay);
  const at = Math.ceil(head.length / 512) * 512;
  return concat(head, new Uint8Array(at - head.length), archive);
}
