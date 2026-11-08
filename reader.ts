/**
 * The mod as the editor reads a data set: `api.gameData.attach(profile, read)` asks for files by their path in an
 * extracted copy (`arr/units.dat`, `tileset/stat_txt.tbl`, `unit/terran/marine.grp`, `unit/manifest.json`), and this
 * answers each from the mod's current files — a table or script the person edited encoded back, the rest as they came —
 * or null, which leaves the file to the data set underneath. Pure: the files come through the functions given.
 */
import { gameName } from "@scm-js/core";

/**
 * Where the editor's extraction keeps a member, by its path in the game's archives: the inverse of the names it
 * writes (`rez\stat_txt.tbl` is `tileset/stat_txt.tbl`, `tileset\jungle\ofire.pcx` is `tileset/jungle.ofire.pcx`,
 * most members their own path in lower case with forward slashes).
 */
export function storedPathOf(member: string): string {
  const k = gameName(member);
  const renamed = RENAMED[k];
  if (renamed) return renamed;
  const m = /^tileset\\([a-z]+)\\([^\\]+)$/.exec(k);
  if (m) return `tileset/${m[1]}.${m[2]}`;
  return k.replace(/\\/g, "/");
}

const RENAMED: Record<string, string> = { "rez\\stat_txt.tbl": "tileset/stat_txt.tbl" };

/** The tables an extracted copy may keep in GPTP's `.datex` layout (the editor's `DATEX_TABLES`). */
const TABLE_FILE = /^arr\\([a-z]+)\.dat(ex)?$/;
/** The files a copy lists as present in `unit/manifest.json`'s `optional`. */
const OPTIONAL = ["rez\\unitnames.tbl", "unit\\cmdbtns\\uniticons.grp"];

export interface UnitManifest { datex?: string[]; optional?: string[]; [key: string]: unknown }

/**
 * The copy's `unit/manifest.json` as the mod changes it: a table the mod has as `.datex` is read as one (and one it has
 * as `.dat` no longer is), and the unit names and icons the mod brings are listed, so the editor asks for them.
 */
export function manifestFor(base: UnitManifest | null, members: Iterable<string>): UnitManifest {
  const out: UnitManifest = { ...(base ?? {}) };
  const datex = new Set(base?.datex ?? []);
  const optional = new Set(base?.optional ?? []);
  for (const m of members) {
    const k = gameName(m);
    const table = TABLE_FILE.exec(k);
    if (table) { if (table[2]) datex.add(table[1]); else datex.delete(table[1]); }
    if (OPTIONAL.includes(k)) optional.add(storedPathOf(k));
  }
  out.datex = [...datex].sort();
  out.optional = [...optional].sort();
  return out;
}

export interface ReaderFiles {
  /** Every member the mod has now, by the game's name (lower case, backslashes). */
  members(): Iterable<string>;
  /** A member's current bytes. */
  read(member: string): Promise<Uint8Array | null>;
  /** The copy's own `unit/manifest.json`, as read before the mod was laid over it. */
  baseManifest: UnitManifest | null;
}

/**
 * The function to hand `api.gameData.attach`. `off()` true answers nothing (every file from the data set underneath):
 * how the plugin reads the game's own files while its reader is attached.
 */
export function attachReader(files: ReaderFiles, off: () => boolean = () => false) {
  let index: Map<string, string> | null = null;
  let manifest: Uint8Array | null = null;
  const reader = async (path: string): Promise<Uint8Array | null> => {
    if (off()) return null;
    const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    if (!index) {
      index = new Map();
      for (const m of files.members()) index.set(storedPathOf(m), gameName(m));
    }
    if (clean === "unit/manifest.json") {
      manifest ??= new TextEncoder().encode(JSON.stringify(manifestFor(files.baseManifest, files.members())));
      return manifest;
    }
    const member = index.get(clean);
    return member ? files.read(member) : null;
  };
  /** The members changed (one added, or a table now another layout): read the index afresh. */
  const invalidate = () => { index = null; manifest = null; };
  return { reader, invalidate };
}
