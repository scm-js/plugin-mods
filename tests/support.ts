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
