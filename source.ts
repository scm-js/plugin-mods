/**
 * A mod as the person hands it over, opened into its files by the game's names: a folder of loose files (the game's
 * paths at its root or a folder down), one `.mpq`, a self-executing `.exe` (MPQDraft's or FireGraft's — its archive
 * read, nothing run), a `.zip` of any of these, or a folder `scmjs mod unpack` wrote (its text packed back as each
 * file is asked for). Archives are laid first, in the order found, and loose files over them, the later winning as the
 * game layers its own archives. This is the command line's `mod/source.ts` for a page: the pieces come from a drop or
 * a picker instead of the disk. No DOM is needed, so the tests run it in Node.
 */
import { Archive } from "mopaq";
import {
  DAT_SCHEMAS, DAT_TABLES, MOD_MANIFEST, decodeTblFile, entryText, exeArchive, gameName, isMpq, isZip, memberOf, modRoot, namesOf, packFile, readManifest, readZip,
  decodeDat, datTableOf, type DatTableName, type ModData, type ModManifest, type ModNames,
} from "@scm-js/core";

/** A file as it was handed over: its path (forward slashes, folders included) and a way to read it. */
export interface Piece {
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

/** One of the mod's files, by the game's name. */
export interface ModFile {
  /** The name as the source spells it (`arr\units.datex`). */
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
  /** The layer it came from (an archive, `mpq/`, a folder file). */
  layer: string;
}

/** A plugin or FireGraft file the mod carries: kept, never run. `member` when it was inside the mod's archive. */
export interface Carried { name: string; bytes: number; read(): Promise<Uint8Array>; member?: string; layer: string }

export type SourceKind = "mod folder" | "folder" | "archive" | "exe" | "zip";

export interface ModSource {
  kind: SourceKind;
  name: string;
  /** The layers, in load order. */
  layers: string[];
  /** The mod's files by the game's name (lower case, backslashes). */
  files: Map<string, ModFile>;
  plugins: Carried[];
  firegraft: Carried[];
  exes: { file: string; kind: "sempq" | "firegraft"; at: number; plugins: { id: number; size: number }[] }[];
  /** Two files of a folder for one game path (any case): the later is used. */
  duplicates: string[];
  /** Files that are not the game's (a read-me beside the game's folders), left out. */
  left: string[];
  /** Archives with no list of their files, read by the names the game uses. */
  probed: string[];
  /** A text folder's manifest (`mod.json`); null for anything else. */
  manifest: ModManifest | null;
}

export class OpenError extends Error {}

export function emptySource(kind: SourceKind, name: string): ModSource {
  return { kind, name, layers: [], files: new Map(), plugins: [], firegraft: [], exes: [], duplicates: [], left: [], probed: [], manifest: null };
}

/** The names the game reads, to look for in an archive that has no list of its files. */
function probeNames(archive: Archive): string[] {
  const names = new Set<string>();
  for (const t of DAT_TABLES) { names.add(DAT_SCHEMAS[t].file); names.add(`${DAT_SCHEMAS[t].file}ex`); }
  for (const n of ["rez\\stat_txt.tbl", "rez\\unitnames.tbl", "arr\\images.tbl", "arr\\sfxdata.tbl", "arr\\portdata.tbl", "arr\\mapdata.tbl", "scripts\\iscript.bin", "scripts\\aiscript.bin", "scripts\\bwscript.bin", "unit\\cmdbtns\\cmdicons.grp", "unit\\cmdbtns\\ticon.pcx", "unit\\cmdbtns\\uniticons.grp", "game\\tunit.pcx", "game\\tselect.pcx", "game\\tminimap.pcx", "game\\tblink.pcx"]) names.add(n);
  for (const t of ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"]) for (const ext of ["cv5", "vf4", "vr4", "vx4", "vx4ex", "wpe", "grp", "dddata.dat"]) names.add(ext.includes(".") ? `tileset\\${t}\\${ext}` : `tileset\\${t}.${ext}`);
  for (const [tbl, under] of [["arr\\images.tbl", "unit\\"], ["arr\\sfxdata.tbl", "sound\\"]] as const) {
    try { for (const s of decodeTblFile(archive.readFile(tbl)).strings) { const p = entryText(s); if (p) names.add(under + p); } } catch { /* not in this archive */ }
  }
  return [...names].filter((n) => { try { return !!archive.fileInfo(n); } catch { return false; } });
}

const leaf = (p: string) => p.split("/").pop()!;

/**
 * Opens what was handed over. `name` is what the person called it (a folder's or a file's name); a mod's own
 * `mod.json`, or the one exe of a folder that holds an archive, names it better and wins. `base` reads the game's own
 * files by member name, for a text folder whose AI script names units by the game's string tables.
 */
export async function openPieces(pieces: Piece[], name: string, base: ((member: string) => Promise<Uint8Array | null>) | null = null): Promise<ModSource> {
  if (!pieces.length) throw new OpenError("Nothing was handed over.");
  const textFolder = await findTextFolder(pieces);
  if (textFolder) return openTextFolder(textFolder.root, textFolder.manifest, pieces, name, base);
  const single = pieces.length === 1 && !pieces[0].path.includes("/");
  const lower = pieces[0].path.toLowerCase();
  const kind: SourceKind = !single ? "folder" : lower.endsWith(".zip") ? "zip" : lower.endsWith(".exe") ? "exe" : "archive";
  if (single) {
    const bytes = await pieces[0].read();
    if (kind === "zip" && !isZip(bytes)) throw new OpenError(`${pieces[0].path} is not a zip.`);
    if (kind === "archive" && !isMpq(bytes)) throw new OpenError(`${pieces[0].path} is not a mod: not an MPQ, a self-executing exe or a zip.`);
    const piece: Piece = { path: pieces[0].path, size: bytes.length, read: async () => bytes };
    return fromPieces(kind, name.replace(/\.(mpq|exe|zip)$/i, ""), [piece]);
  }
  return fromPieces(kind, name, pieces);
}

async function fromPieces(kind: SourceKind, name: string, pieces: Piece[]): Promise<ModSource> {
  const source = emptySource(kind, name);
  const loose: Piece[] = [];
  const archives: { label: string; archive: Archive }[] = [];
  let modName: string | null = null;
  const take = async (list: Piece[], depth: number): Promise<void> => {
    for (const p of list) {
      const l = leaf(p.path).toLowerCase();
      if (/\.(qdp|bwl)$/.test(l)) { source.plugins.push({ name: p.path, bytes: p.size, read: p.read, layer: p.path }); continue; }
      if (/\.(fgp|fgd)$/.test(l)) { source.firegraft.push({ name: p.path, bytes: p.size, read: p.read, layer: p.path }); continue; }
      if (l === "mod.json" && p.path.split("/").length <= 2) {
        try { const n = JSON.parse(new TextDecoder().decode(await p.read())).name; if (typeof n === "string" && n.trim()) modName = n.trim(); } catch { /* not ours to read */ }
        continue;
      }
      if (!/\.(zip|mpq|exe)$/.test(l)) { loose.push(p); continue; }
      const bytes = await p.read();
      if (l.endsWith(".zip") && isZip(bytes)) {
        if (depth > 2) continue;
        let members;
        try { members = readZip(bytes); } catch (e) { throw new OpenError(`${p.path}: ${(e as Error).message}`); }
        const prefix = list.length === 1 && depth === 0 ? "" : p.path.replace(/\.zip$/i, "") + "/";
        await take(members.map((m) => ({ path: `${prefix}${m.path}`, size: m.size, read: m.read })), depth + 1);
      } else if (l.endsWith(".mpq") && isMpq(bytes)) {
        try { archives.push({ label: p.path, archive: Archive.open(bytes) }); } catch (e) { throw new OpenError(`${p.path} could not be opened as an archive: ${(e as Error).message}`); }
      } else if (l.endsWith(".exe")) {
        const found = exeArchive(bytes);
        if (!found) { source.left.push(p.path); continue; }
        try { archives.push({ label: p.path, archive: Archive.open(found.archive) }); } catch (e) { throw new OpenError(`The archive inside ${p.path} could not be opened: ${(e as Error).message}`); }
        source.exes.push({ file: p.path, kind: found.kind, at: found.at, plugins: found.plugins });
      } else loose.push(p);
    }
  };
  await take(pieces, 0);

  for (const { label, archive } of archives) {
    source.layers.push(label);
    // A list of the archive's files may be partial (Blizzard's own are): the names the game reads are looked for too.
    const listed = (archive.files() ?? []).filter((n) => !n.startsWith("("));
    if (!listed.length) source.probed.push(label);
    const seen = new Set(listed.map(gameName));
    for (const n of [...listed, ...probeNames(archive).filter((n) => !seen.has(gameName(n)))]) {
      const info = archive.fileInfo(n);
      if (!info) continue;
      const read = async () => archive.readFile(n);
      const key = gameName(n);
      if (/\.(qdp|bwl)$/.test(key)) { source.plugins.push({ name: n.split("\\").pop()!, bytes: info.uncompressedSize, read, member: n, layer: label }); continue; }
      if (/\.(fgp|fgd)$/.test(key)) { source.firegraft.push({ name: n.split("\\").pop()!, bytes: info.uncompressedSize, read, member: n, layer: label }); continue; }
      source.files.set(key, { name: n, size: info.uncompressedSize, read, layer: label });
    }
  }
  const root = modRoot(loose.map((p) => p.path));
  const layer = root ? `${root}/` : "./";
  if (loose.some((p) => !root || p.path.startsWith(root + "/"))) source.layers.push(layer);
  for (const p of loose) {
    if (root && !p.path.startsWith(root + "/")) { source.left.push(p.path); continue; }
    const rel = root ? p.path.slice(root.length + 1) : p.path;
    // A file beside the game's folders (a read-me, notes) is not one of the game's.
    if (!rel.includes("/")) { source.left.push(p.path); continue; }
    const key = gameName(rel);
    const was = source.files.get(key);
    if (was && was.layer === layer) source.duplicates.push(`${was.name} and ${rel.replace(/\//g, "\\")}`);
    source.files.set(key, { name: rel.replace(/\//g, "\\"), size: p.size, read: p.read, layer });
  }
  // A folder the mod's makers ship holds its launcher: the one exe with an archive in it is named as the mod is.
  if (kind === "folder" && source.exes.length === 1) source.name = leaf(source.exes[0].file).replace(/\.exe$/i, "");
  if (modName) source.name = modName;
  return source;
}

/* ── A folder `scmjs mod unpack` wrote ─────────────────────────────────── */

async function findTextFolder(pieces: Piece[]): Promise<{ root: string; manifest: ModManifest } | null> {
  for (const p of pieces) {
    const parts = p.path.split("/");
    if (parts[parts.length - 1] !== "mod.json" || parts.length > 2) continue;
    let manifest: ModManifest | null = null;
    try { manifest = readManifest(new TextDecoder().decode(await p.read())); } catch (e) { throw new OpenError((e as Error).message); }
    if (manifest) return { root: parts.slice(0, -1).join("/"), manifest };
  }
  return null;
}

/**
 * The text folder's members, each packed from its file when it is first read (a PNG sheet to a GRP takes a moment,
 * and most members are never asked for). The AI text packs to two members at once; tables and string tables are
 * packed up front when the AI text names units by the mod's own names, as `mod pack` does.
 */
async function openTextFolder(root: string, manifest: ModManifest, pieces: Piece[], name: string, base: ((member: string) => Promise<Uint8Array | null>) | null): Promise<ModSource> {
  const source = emptySource("mod folder", manifest.name || name);
  source.manifest = manifest;
  source.layers.push(root ? `${root}/` : "./");
  const inside = pieces.filter((p) => !root || p.path.startsWith(root + "/")).map((p) => ({ ...p, path: root ? p.path.slice(root.length + 1) : p.path }));
  let names: ModNames | null | undefined;
  const ctx = () => ({ manifest, names });
  const packed = new Map<string, Promise<{ member: string; data: Uint8Array }[]>>();
  const pack = (p: Piece) => {
    let got = packed.get(p.path);
    if (!got) { got = p.read().then((data) => packFile(p.path, data, ctx())); packed.set(p.path, got); }
    return got;
  };
  for (const p of inside) {
    if (p.path === MOD_MANIFEST) continue;
    const of = memberOf(p.path, manifest);
    if (!of) { source.left.push(p.path); continue; }
    if (of.form === "plugin" || of.form === "firegraft") {
      const member = of.members[0];
      const read = async () => (await pack(p))[0].data;
      (of.form === "plugin" ? source.plugins : source.firegraft).push({ name: leaf(p.path), bytes: p.size, read, member, layer: source.layers[0] });
      continue;
    }
    for (const member of of.form === "ai" ? of.members : [of.members[0]]) {
      const read = async () => {
        const got = (await pack(p)).find((m) => gameName(m.member) === gameName(member));
        if (!got) throw new OpenError(`${p.path} gave no ${member}`);
        return got.data;
      };
      source.files.set(gameName(member), { name: member, size: p.size, read, layer: p.path });
    }
  }
  // The AI text names units as the folder was written: from its own tables and string tables, or the game's.
  if (manifest.names !== "none" && [...source.files.keys()].some((k) => /^scripts\\(aiscript|bwscript)\.bin$/.test(k))) {
    const read = async (member: string) => {
      const f = source.files.get(gameName(member));
      if (f) return f.read();
      return manifest.names === "game" && base ? base(member) : null;
    };
    const tables: ModData["tables"] = {};
    for (const t of DAT_TABLES) {
      for (const member of [`${DAT_SCHEMAS[t].file}ex`, DAT_SCHEMAS[t].file]) {
        const bytes = await read(member);
        if (bytes) { tables[t as DatTableName] = decodeDat(datTableOf(member)!, bytes, { fileName: member }); break; }
      }
    }
    const tbl = async (member: string) => { const b = await read(member); return b ? decodeTblFile(b).strings : null; };
    names = namesOf(tables, { stat: await tbl("rez\\stat_txt.tbl"), unitnames: await tbl("rez\\unitnames.tbl"), images: await tbl("arr\\images.tbl"), sfxdata: await tbl("arr\\sfxdata.tbl"), portdata: null, mapdata: null });
  }
  return source;
}
