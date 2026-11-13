/**
 * A mod as the person hands it over, opened into its files by the game's names: a folder of loose files, one `.mpq`, a
 * self-executing `.exe` (MPQDraft's or FireGraft's — its archive read, nothing run), a `.zip` of any of these, or a
 * folder `scmjs mod unpack` wrote (its text packed back as each file is asked for).
 *
 * What a mod is — which of what was given are its files and from which layer, which are its code, which are left out
 * (an operating system's files, a copy of the game, a read-me beside the game's folders), its name and what it goes by
 * between people — is `@scm-js/mod`'s `readMod`, the reader the command line, the editor and the play page share. Here
 * the pieces become its `ModFiles`, and its description becomes what the editing session keeps: each file with a way to
 * read it, the code it carries, and its `identity`. A text folder is this plugin's own (the reader recognises one and
 * leaves it to be packed): its members are packed here, by `@scm-js/core`'s folder form. No DOM is needed, so the
 * tests run it in Node.
 */
import {
  ModError, firegraftBytes, fileReaders, gameCopyFolders, gameName as lineName, hasCodeLine, isSystemFile, isZip, leafOf, modIdentity, moduleBytes, normalizeRaces, openLayer,
  readMod, readPath, readZip,
  type DataSetRace, type Identity, type Layer, type ModDescription, type ModFiles, type ModMessage, type OpenArchives, type UnhashedDescription,
} from "@scm-js/mod";
import { t, modWords } from "./i18n";
import { withArchive, writeMpq } from "./archive";
import {
  DAT_SCHEMAS, DAT_TABLES, MOD_MANIFEST, decodeTblFile, gameName, memberOf, namesOf, packFile, readManifest,
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
  /** The name as the source spells it (`arr\units.dat`). */
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
  /** The layer it came from (an archive, `mpq/`, a folder file). */
  layer: string;
  /** The name its line in the mod's hash goes by: the reader's game name (`Identity.lines`). */
  line: string;
}

/**
 * A plugin, library or FireGraft file the mod carries: kept, never run. `member` when it was inside the mod's archive
 * (a plugin there is loaded by no loader and has no line in the mod's hash). `line`: the name its line in the hash goes
 * by (`Identity.plugins`), for a module of the mod's code that has one. `bytes`: its size (0 for a plugin inside the
 * archive, whose size the reader does not give). `exe`: the program that carries it, for a plugin a patcher exe carries
 * in itself (one of `ModSource.exes`): it goes wherever the mod goes inside that program, which keeps its loader's order.
 */
export interface Carried { name: string; bytes: number; read(): Promise<Uint8Array>; member?: string; layer: string; line?: string; exe?: string }

/**
 * A program the mod came in (a self-executing exe: FireGraft's patcher, MPQDraft's self-executing MPQ, another program
 * with the mod's archive after it): its path, its form, where its archive is (`at`), what it carries, and its bytes.
 */
export interface Program { file: string; kind: "sempq" | "firegraft"; at: number; plugins: { id: number; size: number }[]; read(): Promise<Uint8Array> }

export type SourceKind = "mod folder" | "folder" | "archive" | "exe" | "zip";

export interface ModSource {
  kind: SourceKind;
  name: string;
  /** The layers, in load order (the later wins). */
  layers: string[];
  /** The mod's files by the game's name (lower case, backslashes). */
  files: Map<string, ModFile>;
  /**
   * The modules of its code: plugins, plugins that load plugins and the libraries they map (given as files or carried
   * in a patcher exe), then the plugins inside its archive.
   */
  plugins: Carried[];
  firegraft: Carried[];
  exes: Program[];
  /** Two files of a folder for one game path (any case): the later is used. */
  duplicates: string[];
  /** Files that are not the mod's (a read-me beside the game's folders, an operating system's `desktop.ini`), left out. */
  left: string[];
  /** The archives of a copy of the game handed over with the mod, left out unread: the game's, not the mod's. */
  gameCopy: string[];
  /** Archives with no list of their files, read by the names the game uses. */
  probed: string[];
  /** A text folder's manifest (`mod.json`); null for anything else. */
  manifest: ModManifest | null;
  /**
   * The races the mod adds, as its `mod.json` declares them (`races`, normalized). Empty when none are declared. No file
   * of the mod's: they never reach its hash.
   */
  races: DataSetRace[];
  /**
   * What the mod goes by, once it is known: as the reader worked it out when the mod opened, or later (`identify`). Null
   * until then: a large mod is described at once and its files hashed afterwards, and a text folder's is its members
   * packed (`identityOf`).
   */
  identity: Identity | null;
  /** The mod's identity as it opened, worked out once when first asked (at once where `identity` is known); it sets `identity`. */
  identify(): Promise<Identity>;
  /** Lets go of the archives the mod's files are read from (the mod is closed); a later read opens them again. */
  close(): void;
}

export class OpenError extends Error {}

export function emptySource(kind: SourceKind, name: string): ModSource {
  const source: ModSource = {
    kind, name, layers: [], files: new Map(), plugins: [], firegraft: [], exes: [], duplicates: [], left: [], gameCopy: [], probed: [], manifest: null, races: [], identity: null,
    identify: () => Promise.reject(new Error("not yet")),
    close: () => {},
  };
  source.identify = once(() => (source.identity ? Promise.resolve(source.identity) : identityOf(source)), source);
  return source;
}

/** `work` done once, its identity kept on the source. */
function once(work: () => Promise<Identity>, source: { identity: Identity | null }): () => Promise<Identity> {
  let made: Promise<Identity> | null = null;
  return () => (made ??= work().then((id) => (source.identity = id)));
}

/**
 * From this much handed over (bytes, all pieces together), the mod is described without hashing its files, and its hash
 * follows: `readMod` with `hashFiles: false`, then `modIdentity` when the hash is first asked for (`identify`). Below it,
 * the hash comes with the description. 64 MB is the size up to which this plugin worked out a mod's hash before
 * handing the mod to the editor, before it read mods with `@scm-js/mod`: hashing that much (reading each file,
 * inflating an archive's members, SHA-256) takes well under a second, where a release of 2.6 GB takes about two seconds
 * more than describing it in Node. The size of what was handed over is all that is known before reading.
 */
export const HASH_LATER = 64 * 1024 * 1024;

const leaf = (p: string) => p.split("/").pop()!;

/** What the reader refused, in the editor's language. */
function refused(e: unknown): never {
  if (e instanceof ModError) throw new OpenError(modWords(e.detail));
  throw e;
}

/**
 * Opens what was handed over. `name` is what the person called it (a folder's or a file's name); a mod's own
 * `mod.json`, or the one program at the top of a folder that holds the mod, names it better and wins. `base` reads the
 * game's own files by member name, for a text folder whose AI script names units by the game's string tables.
 * `progress` hears how far the reader is (every file of the mod is read once, for its hash).
 */
export async function openPieces(pieces: Piece[], name: string, base: ((member: string) => Promise<Uint8Array | null>) | null = null, progress?: (message: ModMessage) => void): Promise<ModSource> {
  if (!pieces.length) throw new OpenError(t("Nothing was handed over."));
  const textFolder = await findTextFolder(pieces);
  if (textFolder) return openTextFolder(textFolder.root, textFolder.manifest, pieces, name, base);
  const single = pieces.length === 1 && !pieces[0].path.includes("/");
  let given = pieces;
  if (single) {
    // (read once: the reader is handed these bytes)
    const bytes = await pieces[0].read();
    given = [{ path: pieces[0].path, size: bytes.length, read: async () => bytes }];
    // A zip may hold a text folder (Save as Folder writes one): looked into before it is read as a mod.
    if (/\.zip$/i.test(pieces[0].path) && isZip(bytes)) {
      let members: ReturnType<typeof readZip> = [];
      try { members = readZip(bytes); } catch (e) { refused(e); }
      const inside = members.map((m) => ({ path: m.path, size: m.size, read: m.read }));
      const folder = await findTextFolder(inside);
      if (folder) return openTextFolder(folder.root, folder.manifest, inside, name.replace(/\.zip$/i, ""), base);
    }
  }
  const byPath = new Map(given.map((p) => [p.path, p]));
  const tree: ModFiles = {
    name: single ? name.replace(/\.(mpq|exe|zip)$/i, "") : name,
    ...(single ? { named: given[0].path } : {}),
    list: async () => given.map((p) => ({ path: p.path, size: p.size })),
    read: async (path) => byPath.get(path)!.read(),
  };
  // (every archive the reader opens is kept here, and read from again by everything after it: none is opened twice)
  const archives: OpenArchives = new Map();
  const later = given.reduce((n, p) => n + p.size, 0) >= HASH_LATER;
  let d: ModDescription | UnhashedDescription, identity: Identity | (() => Promise<Identity>);
  try {
    if (later) {
      const unhashed = await readMod(tree, { progress, archives, hashFiles: false });
      d = unhashed;
      identity = () => modIdentity(tree, unhashed, { archives });
    } else {
      const hashed = await readMod(tree, { progress, archives });
      d = hashed;
      identity = hashed.identity;
    }
  } catch (e) { return refused(e); }
  // A copy of the game with nothing of a mod beside it; nothing of a mod at all.
  const copyOnly = d.said.find((m) => m.key === "copy-only");
  if (copyOnly) throw new OpenError(modWords(copyOnly));
  if (!d.files.length && !d.modules.length && !d.patches.length) {
    const none = d.said.find((m) => m.key === "no-game-files");
    throw new OpenError(single || !none ? t("{file} is not a mod: not an MPQ, a self-executing exe or a zip.", { file: single ? pieces[0].path : name }) : modWords(none));
  }
  const lower = pieces[0].path.toLowerCase();
  const program = single && d.layers.some((l) => l.kind === "archive" && l.path === given[0].path && l.by !== "mpqdraft" && l.by !== "replacement");
  const kind: SourceKind = !single ? "folder" : lower.endsWith(".zip") ? "zip" : lower.endsWith(".exe") || program ? "exe" : "archive";
  return fromDescription(kind, tree, d, archives, identity);
}

/**
 * The reader's description as the session keeps it: each file with a way to read it, the code, what was left out.
 * `archives`: those the reader opened, which every read after it takes from. `identity`: the description's, or how it
 * is worked out for a mod described without hashing.
 */
function fromDescription(kind: SourceKind, tree: ModFiles, d: ModDescription | UnhashedDescription, archives: OpenArchives, identity: Identity | (() => Promise<Identity>)): ModSource {
  const source = emptySource(kind, d.name);
  if (typeof identity === "function") source.identify = once(identity, source);
  else source.identity = identity;
  source.races = d.races ?? [];
  const label = (l: Layer) => (l.kind === "archive" ? l.path : l.path ? `${l.path}/` : "./");
  source.layers = d.layers.map(label);
  source.probed = d.layers.filter((l) => l.probed).map((l) => l.path);
  const readerOf = fileReaders(tree, d, { archives });
  source.close = () => { readerOf.close(); archives.clear(); };
  for (const f of d.files) {
    const l = d.layers[f.layer];
    const name = l.kind === "archive" ? f.member! : (l.path ? f.path!.slice(l.path.length + 1) : f.path!).replace(/\//g, "\\");
    source.files.set(gameName(f.name), { name, size: f.size, read: readerOf(f), layer: label(l), line: f.name });
  }
  // The code: every module with a line in the hash (a plugin, a plugin that loads plugins, a library they map; given as
  // a file or carried in a patcher exe), by the name its line goes by; then the plugins inside an archive, which no
  // loader loads and which have none.
  for (const m of d.modules) {
    if (!hasCodeLine(m)) continue;
    const s = m.source;
    const line = d.identity.plugins[m.name] === m.sha256 ? m.name : undefined;
    source.plugins.push({ name: s.kind === "file" ? s.path : m.name, bytes: m.size, read: () => moduleBytes(tree, m), layer: s.kind === "file" ? s.path : s.kind === "carried" ? s.exe : s.archive, ...(line ? { line } : {}), ...(s.kind === "carried" ? { exe: s.exe } : {}) });
  }
  for (const c of d.carried) {
    const s = c.source;
    if (s?.kind !== "member") continue;
    // (read from its archive as the reader opened it. The description gives no size for it, so none is said.)
    const read = async () => {
      const layer = d.layers.find((l) => l.kind === "archive" && l.path === s.archive);
      const bytes = layer ? (await openLayer(tree, layer, { archives })).readFile(s.member) : null;
      if (!bytes) throw new OpenError(t("{file} gave no {member}.", { file: s.archive, member: s.member }));
      return bytes;
    };
    source.plugins.push({ name: c.name, bytes: 0, read, member: s.member, layer: s.archive });
  }
  for (const f of d.patches[0]?.files ?? []) {
    source.firegraft.push({ name: f.path ?? f.name, bytes: f.size, read: () => firegraftBytes(tree, d, f, { archives }), ...(f.member ? { member: f.member } : {}), layer: f.path ?? f.archive ?? "" });
  }
  for (const l of d.layers) {
    if (l.kind !== "archive" || (l.by !== "firegraft-patcher" && l.by !== "mpqdraft-sempq" && l.by !== "self-executing")) continue;
    const carried = d.modules.filter((m) => m.source.kind === "carried" && m.source.exe === l.path);
    source.exes.push({ file: l.path, kind: l.by === "firegraft-patcher" ? "firegraft" : "sempq", at: l.at ?? 0, plugins: carried.map((m) => ({ id: m.id ?? 0, size: m.size })), read: () => readPath(tree, l.path) });
  }
  source.duplicates = d.duplicates.map((x) => x.paths.join(" and "));
  source.left = d.left.map((x) => x.path);
  source.gameCopy = d.gameCopy;
  return source;
}

/** The copies of the game a source's `gameCopy` came from: each copy's folder as handed over ("" the top) and the
 *  names of its archives left out, the game's own first (`@scm-js/mod`'s `gameCopyFolders`). */
export function gameCopies(gameCopy: readonly string[]): { folder: string; names: string[] }[] {
  return gameCopyFolders(gameCopy).map(({ folder, paths }) => ({ folder, names: paths.map(leafOf) }));
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
 * packed up front when the AI text names units by the mod's own names, as `mod pack` does. A plugin or FireGraft file
 * that sat beside the archive (no `member` in the manifest) is carried as a file beside it, as `mod pack` lays it.
 */
async function openTextFolder(root: string, manifest: ModManifest, pieces: Piece[], name: string, base: ((member: string) => Promise<Uint8Array | null>) | null): Promise<ModSource> {
  const source = emptySource("mod folder", manifest.name || name);
  source.manifest = manifest;
  // (`@scm-js/core` 0.13's `readManifest` keeps a key it does not know as it was written, unchecked: read by the rule.)
  source.races = normalizeRaces((manifest as ModManifest & { races?: unknown }).races);
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
    if (!of) {
      // (a plugin or FireGraft file that was beside the archive: its bytes as they are)
      const plugin = manifest.plugins.find((c) => !c.member && c.file === p.path), fg = manifest.firegraft.find((c) => !c.member && c.file === p.path);
      if (plugin) source.plugins.push({ name: plugin.name, bytes: p.size, read: p.read, layer: source.layers[0], line: plugin.name });
      else if (fg) source.firegraft.push({ name: fg.name, bytes: p.size, read: p.read, layer: source.layers[0] });
      else source.left.push(p.path);
      continue;
    }
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
      source.files.set(gameName(member), { name: member, size: p.size, read, layer: p.path, line: lineName(member) });
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

/* ── Handed over ───────────────────────────────────────────────────────── */

/**
 * The mod's files and code as a page is handed them, in the game's paths (`ModFiles.layout` "game"): each file by its
 * game path (`arr/units.dat`), each module of its code that has a line in the hash under `plugins/` by the name the line
 * goes by, and its FireGraft files under `firegraft/`. A plugin inside the mod's archive is not handed: no loader loads
 * it, and it has no line. `read` gives a file as it is now (an edit's bytes); one that cannot be read is left out.
 *
 * A program that carries plugins of the mod's (a patcher exe's own) is handed as that program, at the top, by its own
 * name. Its plugins are then read by the page as the patcher's, in its loader's order and each as the plugin it is;
 * given as files under `plugins/`, they would be a folder's, sorted by name, and one that names itself `x.dll` a library
 * that is never run. Where none of the files it held was edited (`edited`, by key) it is handed as it came; else its
 * program and what it carries as they came, with an archive of the files given here that it held, as they are now, where
 * its archive was (`withArchive`), its FireGraft project and database among them where they were.
 */
export async function handedFiles(source: ModSource, keys: readonly string[], read: (key: string) => Promise<Uint8Array | null>, nameOf: (key: string) => string, edited?: ReadonlySet<string>): Promise<{ path: string; bytes: Uint8Array }[]> {
  const out: { path: string; bytes: Uint8Array }[] = [];
  // (each program that carries a plugin with a line, and the members it gets back)
  const programs = new Map<string, { exe: Program; members: { member: string; data: Uint8Array }[] }>();
  for (const e of source.exes) if (source.plugins.some((p) => p.exe === e.file && p.line) && ![...programs.keys()].some((f) => leafOf(f).toLowerCase() === leafOf(e.file).toLowerCase())) programs.set(e.file, { exe: e, members: [] });
  // (a program none of whose files was edited: as it came, its files and project inside it)
  const asCame = new Set(edited ? [...programs.keys()].filter((file) => ![...edited].some((k) => source.files.get(k)?.layer === file)) : []);
  for (const k of keys) {
    if (asCame.has(source.files.get(k)?.layer ?? "")) continue;
    let bytes: Uint8Array | null = null;
    // (a member its archive lists and does not hold: left out, as the reader leaves it)
    try { bytes = await read(k); } catch { /* left out */ }
    if (!bytes) continue;
    const into = programs.get(source.files.get(k)?.layer ?? "");
    if (into) into.members.push({ member: nameOf(k), data: bytes });
    else out.push({ path: gameName(nameOf(k)).replace(/\\/g, "/"), bytes });
  }
  for (const p of source.plugins) if (p.line && !(p.exe && programs.has(p.exe))) out.push({ path: `plugins/${p.line}`, bytes: await p.read() });
  for (const p of source.firegraft) {
    if (!/\.(fgp|fgd)$/i.test(p.name)) continue;
    if (p.member && asCame.has(p.layer)) continue;
    const into = p.member ? programs.get(p.layer) : undefined;
    if (into) into.members.push({ member: p.member!, data: await p.read() });
    else out.push({ path: `firegraft/${leafOf(p.name)}`, bytes: await p.read() });
  }
  // (stored: the page reads it once and keeps what it needs)
  for (const { exe, members } of programs.values()) out.push({ path: leafOf(exe.file), bytes: asCame.has(exe.file) ? await exe.read() : withArchive(await exe.read(), exe.at, await writeMpq(members, "none")) });
  return out;
}

/**
 * The identity of a mod held as members (a text folder, packed): what the reader gives the same files handed over in
 * the game's paths (`handedFiles`), which is what it gives the folder packed and saved.
 */
export async function identityOf(source: ModSource): Promise<Identity> {
  const keys = [...source.files.keys()].sort();
  const files = await handedFiles(source, keys, async (k) => source.files.get(k)!.read(), (k) => source.files.get(k)!.name);
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  return (await readMod({ name: source.name, layout: "game", list: async () => files.map((f) => ({ path: f.path, size: f.bytes.length })), read: async (p) => byPath.get(p)! })).identity;
}

/** A folder of a mod: the game's folders (or a mod folder's manifest) at its root or one folder down. */
export function looksLikeMod(paths: readonly string[]): boolean {
  return paths.some((p) => /^[^/]+\/([^/]+\/)?(arr\/[^/]+\.dat(ex)?|scripts\/[^/]+\.bin|rez\/[^/]+\.tbl|unit\/.+\.grp)$/i.test(p) || /^[^/]+\/mod\.json$/i.test(p));
}
