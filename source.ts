/**
 * A mod as the person hands it over, opened into its files by the game's names: a folder of loose files (the game's
 * paths at its root or a folder down), one `.mpq`, a self-executing `.exe` (MPQDraft's or FireGraft's — its archive
 * read, nothing run), a `.zip` of any of these, or a folder `scmjs mod unpack` wrote (its text packed back as each
 * file is asked for). Archives are laid first, in the order found, and loose files over them, the later winning as the
 * game layers its own archives. This is the command line's `mod/source.ts` for a page: the pieces come from a drop or
 * a picker instead of the disk. No DOM is needed, so the tests run it in Node.
 */
import { Archive } from "mopaq";
import { t } from "./i18n";
import {
  DAT_SCHEMAS, DAT_TABLES, GAME_FOLDERS, MOD_MANIFEST, decodeTblFile, entryText, exeArchive, gameName, isMpq, isZip, memberOf, modRoot, namesOf, packFile, readManifest, readZip,
  decodeDat, datTableOf, type DatTableName, type ModData, type ModManifest, type ModNames,
} from "@scm-js/core";

/**
 * Files an operating system or its file manager leaves in folders, and into the archives and zips made of them: never
 * the game's, so never a mod's. Told by name alone, any case: `desktop.ini` (Windows Explorer's settings for a folder),
 * `Thumbs.db`, `ehthumbs.db`, `ehthumbs_vista.db` (its caches of thumbnails), `.DS_Store` and `Icon\r` (the macOS
 * Finder's), `._<name>` (the AppleDouble half of a file) and everything under `__MACOSX/` (the folder macOS's zips
 * keep those in), `.directory` (KDE's).
 *
 * They are left out of the mod's files here, and so out of its hash, its counts and what a page is handed: the mod's
 * hash has no line for one (`@scm-js/core`'s `SYSTEM_FILES`, the same list, from the release after 0.13.0, whose
 * `modHashOfDigests` drops such a line itself). Why: the same folder is not handed over alike by every route. A folder
 * picked with the browser's folder picker, or dropped and read through its handle, never shows `desktop.ini` or
 * `Thumbs.db` (Chromium refuses the names); a drop read through its entries, a folder input and the command line do.
 */
export const SYSTEM_FILES = {
  names: ["desktop.ini", "thumbs.db", "ehthumbs.db", "ehthumbs_vista.db", ".ds_store", "icon\r", ".directory"],
  prefixes: ["._"],
  folders: ["__macosx"],
} as const;

/** Whether a path (either slash, any case) is one of `SYSTEM_FILES`: by its file name, or by a folder it is under. */
export function isSystemFile(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]/).filter(Boolean);
  const name = parts.pop() ?? "";
  return (SYSTEM_FILES.names as readonly string[]).includes(name)
    || SYSTEM_FILES.prefixes.some((p) => name.startsWith(p))
    || parts.some((folder) => (SYSTEM_FILES.folders as readonly string[]).includes(folder));
}

/*
 * A copy of the game in what was handed over is not the mod. A mod's makers may ship the game beside it (Cosmonarchy's
 * `Release/` beside a whole 1.16.1 `Starcraft/`); laid as layers, the game's archives would be taken for the mod's
 * files, the last found winning — original StarCraft's `iscript.bin` from `StarDat.mpq` over the mod's. A folder that
 * holds a `StarDat.mpq` is such a copy: its `GAME_ARCHIVES`, and everything under its `Maps` folder (the person's maps
 * folder, which the game lists from disk and reads no mod's data by), are the game's own and left out unread. Anything
 * else in it is taken as before.
 *
 * `@scm-js/core` gets the same list and function in the release after 0.13.1 (the command line and the play page tell a
 * copy of the game the same way); a copy here so the plugin is right with the core on npm today.
 */
/** The game's own archives, by file name (lower case): what a 1.16.1 installation holds beside its program. */
export const GAME_ARCHIVES = ["stardat.mpq", "broodat.mpq", "patch_rt.mpq", "starcraft.mpq", "broodwar.mpq"] as const;

/** The files among `paths` (forward slashes) that are a copy of the game's own and so no part of a mod: in every folder
 *  that holds a `StarDat.mpq`, that folder's `GAME_ARCHIVES` and every file under its `Maps` folder. */
export function gameCopyFiles(paths: readonly string[]): Set<string> {
  const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const leaf = (p: string) => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
  const copies = new Set(paths.filter((p) => leaf(p) === "stardat.mpq").map((p) => dir(p).toLowerCase()));
  const out = new Set<string>();
  if (!copies.size) return out;
  for (const p of paths) {
    if (copies.has(dir(p).toLowerCase()) && (GAME_ARCHIVES as readonly string[]).includes(leaf(p))) { out.add(p); continue; }
    for (const c of copies) if (p.toLowerCase().startsWith(c ? `${c}/maps/` : "maps/")) { out.add(p); break; }
  }
  return out;
}

/**
 * The copies of the game a source's `gameCopy` paths came from: each copy's folder as it was handed over (`""` for the
 * root of what was handed over) and the names of its files left out — the game's archives first, in `GAME_ARCHIVES`'
 * order, then those under `Maps` by path.
 */
export function gameCopies(gameCopy: readonly string[]): { folder: string; names: string[] }[] {
  const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const folders = [...new Set(gameCopy.filter((p) => name(p).toLowerCase() === "stardat.mpq").map(dir))].sort((a, b) => b.length - a.length);
  const rank = (p: string) => { const i = (GAME_ARCHIVES as readonly string[]).indexOf(name(p).toLowerCase()); return i < 0 ? GAME_ARCHIVES.length : i; };
  const by = new Map<string, string[]>();
  for (const p of gameCopy) {
    const folder = folders.find((f) => !f || p.toLowerCase().startsWith(`${f.toLowerCase()}/`)) ?? dir(p);
    by.set(folder, [...(by.get(folder) ?? []), p]);
  }
  return [...by].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([folder, paths]) => ({
    folder,
    names: paths.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)).map(name),
  }));
}

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
  /** Files that are not the game's (a read-me beside the game's folders, an operating system's `desktop.ini`), left out. */
  left: string[];
  /** Files of a copy of the game handed over with the mod (`gameCopyFiles`), left out unread: the game's, not the mod's. */
  gameCopy: string[];
  /** Archives with no list of their files, read by the names the game uses. */
  probed: string[];
  /** A text folder's manifest (`mod.json`); null for anything else. */
  manifest: ModManifest | null;
}

export class OpenError extends Error {}

export function emptySource(kind: SourceKind, name: string): ModSource {
  return { kind, name, layers: [], files: new Map(), plugins: [], firegraft: [], exes: [], duplicates: [], left: [], gameCopy: [], probed: [], manifest: null };
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
  if (!pieces.length) throw new OpenError(t("Nothing was handed over."));
  const textFolder = await findTextFolder(pieces);
  if (textFolder) return openTextFolder(textFolder.root, textFolder.manifest, pieces, name, base);
  const single = pieces.length === 1 && !pieces[0].path.includes("/");
  // A zip may hold a text folder (Save as Folder writes one): looked into before it is taken as the game's files.
  if (single && /\.zip$/i.test(pieces[0].path)) {
    const bytes = await pieces[0].read();
    if (!isZip(bytes)) throw new OpenError(t("{file} is not a zip.", { file: pieces[0].path }));
    let members;
    try { members = readZip(bytes); } catch (e) { throw new OpenError(t("{file}: {error}", { file: pieces[0].path, error: (e as Error).message })); }
    const inside = members.map((m) => ({ path: m.path, size: m.size, read: m.read }));
    const folder = await findTextFolder(inside);
    if (folder) return openTextFolder(folder.root, folder.manifest, inside, name.replace(/\.zip$/i, ""), base);
  }
  const lower = pieces[0].path.toLowerCase();
  const kind: SourceKind = !single ? "folder" : lower.endsWith(".zip") ? "zip" : lower.endsWith(".exe") ? "exe" : "archive";
  if (single) {
    const bytes = await pieces[0].read();
    if (kind === "zip" && !isZip(bytes)) throw new OpenError(t("{file} is not a zip.", { file: pieces[0].path }));
    if (kind === "archive" && !isMpq(bytes)) throw new OpenError(t("{file} is not a mod: not an MPQ, a self-executing exe or a zip.", { file: pieces[0].path }));
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
    // A copy of the game among several pieces (a folder's, a zip's members) is left out unread; the one file the person
    // named (an old mod's lone `patch_rt.mpq`) is opened as it is.
    const copy = depth === 0 && kind !== "folder" ? new Set<string>() : gameCopyFiles(list.map((p) => p.path));
    for (const p of list) {
      const l = leaf(p.path).toLowerCase();
      // (An operating system's file is nothing of the mod's, whatever its name ends in: macOS's `._gptp.qdp` is no plugin.)
      if (isSystemFile(p.path)) { source.left.push(p.path); continue; }
      // (An archive of the copy is named in `gameCopy`, which the notice lists; a map or a campaign's music under its
      // `Maps` folder is left out as any file outside the mod is.)
      if (copy.has(p.path)) { (/\.(mpq|exe|zip)$/i.test(p.path) ? source.gameCopy : source.left).push(p.path); continue; }
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
        try { members = readZip(bytes); } catch (e) { throw new OpenError(t("{file}: {error}", { file: p.path, error: (e as Error).message })); }
        const prefix = list.length === 1 && depth === 0 ? "" : p.path.replace(/\.zip$/i, "") + "/";
        await take(members.map((m) => ({ path: `${prefix}${m.path}`, size: m.size, read: m.read })), depth + 1);
      } else if (l.endsWith(".mpq") && isMpq(bytes)) {
        try { archives.push({ label: p.path, archive: Archive.open(bytes) }); } catch (e) { throw new OpenError(t("{file} could not be opened as an archive: {error}", { file: p.path, error: (e as Error).message })); }
      } else if (l.endsWith(".exe")) {
        const found = exeArchive(bytes);
        if (!found) { source.left.push(p.path); continue; }
        try { archives.push({ label: p.path, archive: Archive.open(found.archive) }); } catch (e) { throw new OpenError(t("The archive inside {file} could not be opened: {error}", { file: p.path, error: (e as Error).message })); }
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
      // (An archive packed from a folder Explorer had been in holds its desktop.ini too: not the mod's.)
      if (isSystemFile(key)) continue;
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
  source.gameCopy.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // With a copy of the game left out, what else came with it may be only the game's own loose files (a read-me, its
  // dlls, a zip of shaders): a mod is an archive laid as a layer, a plugin or FireGraft file, or a loose file under one
  // of the game's folders (`maps` aside, as `modRoot` scores them). Without any of those there is no mod.
  const underGameFolder = (path: string) => path.toLowerCase().split("/").slice(0, -1).some((f) => f !== "maps" && GAME_FOLDERS.includes(f));
  if (source.gameCopy.length && !archives.length && !source.plugins.length && !source.firegraft.length && !loose.some((p) => underGameFolder(p.path))) {
    throw new OpenError(gameCopies(source.gameCopy).map((c) => t("{folder} is a copy of the game, and there is no mod in it.", { folder: c.folder || name })).join(" "));
  }
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
    if (isSystemFile(p.path)) { source.left.push(p.path); continue; }
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
        if (!got) throw new OpenError(t("{file} gave no {member}.", { file: p.path, member }));
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

/** A folder of a mod: the game's folders (or a mod folder's manifest) at its root or one folder down. */
export function looksLikeMod(paths: readonly string[]): boolean {
  return paths.some((p) => /^[^/]+\/([^/]+\/)?(arr\/[^/]+\.dat(ex)?|scripts\/[^/]+\.bin|rez\/[^/]+\.tbl|unit\/.+\.grp)$/i.test(p) || /^[^/]+\/mod\.json$/i.test(p));
}
