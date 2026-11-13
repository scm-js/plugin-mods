/**
 * Writing a mod out: the MPQ the launchers load (`scmjs mod pack`'s rules: name order, 4,096-byte sectors, a listfile,
 * one compression for all), the folder of text and pictures (`scmjs mod unpack`'s form, each text kept only when it
 * packs back to the same bytes) as a zip, and the changed files alone as a zip for a mod that is a folder of loose
 * files. Pure apart from the archive library; the panel hands the bytes to `api.ui.saveFile`.
 */
import {
  DEFAULT_PALETTE, MOD_FOLDERS, MOD_MANIFEST, datTableOf, emptyManifest, folderPath, gameName, recordRendered, renderAiScripts, renderMember, tidyManifest,
  type DatTableName, type ModManifest, type Rendered,
} from "@scm-js/core";
import { normalizeRaces, type DataSetRace } from "./races";
import type { ModSession } from "./session";
import { gameCopies } from "./source";
import { withArchive, writeMpq } from "./archive";

export { writeMpq, type Compression } from "./archive";

/**
 * Every member the mod has now, with its current bytes, in name order; plugins carried inside the archive too. A member
 * its archive lists and does not give (`left`, by name) is left out, as the reader leaves it out of the mod.
 */
export async function currentMembers(session: ModSession, left: string[] = []): Promise<{ member: string; data: Uint8Array }[]> {
  const out: { member: string; data: Uint8Array }[] = [];
  for (const k of session.members()) {
    let data: Uint8Array | null = null;
    try { data = await session.read(k); } catch { left.push(session.nameOf(k)); }
    if (data) out.push({ member: session.nameOf(k), data });
  }
  for (const p of [...session.source.plugins, ...session.source.firegraft]) if (p.member) out.push({ member: p.member, data: await p.read() });
  return out.sort((a, b) => (gameName(a.member) < gameName(b.member) ? -1 : 1));
}

/**
 * The program a mod came as (one self-executing exe: FireGraft's patcher, MPQDraft's self-executing MPQ), with an archive
 * of its members as they are now where its own was (`withArchive`): the program and the plugins it carries, in its
 * loader's order, as they came. Null for a mod that did not come as one program.
 */
export async function writeProgram(session: ModSession, left: string[] = []): Promise<{ bytes: Uint8Array; members: number } | null> {
  const s = session.source;
  const exe = s.kind === "exe" && s.exes.length === 1 ? s.exes[0] : null;
  if (!exe) return null;
  const members = await currentMembers(session, left);
  return { bytes: withArchive(await exe.read(), exe.at, await writeMpq(members)), members: members.length };
}

/**
 * The modules of the mod's code an MPQ does not carry, by name: the plugins and libraries a loader loads from files or
 * from a patcher exe (an MPQ holds none that is run: a plugin among its members is loaded by no loader).
 */
export function codeOutsideMpq(session: ModSession): string[] {
  return session.source.plugins.filter((p) => p.line).map((p) => p.line!);
}

/* ── The text folder ───────────────────────────────────────────────────── */

export interface FolderFile { file: string; data: Uint8Array }

/**
 * The mod as `scmjs mod unpack` lays it out: tables, strings, scripts and overlays as text, GRPs as PNG sheets drawn in
 * `palette` (the mod's `tileset\<name>.wpe`, else the game's), and `mod.json`. `progress` is called after each member.
 * `races` is the table of races the mod adds, written as `mod.json`'s `races` (left out when empty, so a mod that names
 * none writes the file it always did); without it, the races the mod came with.
 */
export async function textFolder(session: ModSession, progress?: (done: number, total: number) => void, races: readonly DataSetRace[] = session.source.races): Promise<{ files: FolderFile[]; manifest: ModManifest & { races?: DataSetRace[] } }> {
  const manifest = emptyManifest(session.source.name);
  manifest.layers = [...session.source.layers];
  manifest.palette = session.source.manifest?.palette ?? DEFAULT_PALETTE;
  const ownNames = session.has("rez\\stat_txt.tbl") || session.has("rez\\unitnames.tbl");
  manifest.names = ownNames ? "mod" : session.base ? "game" : "none";
  // The AI text names units as `mod pack` will read them back: the mod's own names, or the game's under them.
  const names = manifest.names === "none" ? null : session.data.names;
  const wpe = await session.readOver(`tileset\\${manifest.palette}.wpe`);
  const palette = wpe ? { name: manifest.palette, colours: wpe } : null;

  const modTables: Partial<Record<DatTableName, string>> = {};
  for (const k of session.members()) {
    const t = /^arr\\[^\\]+\.dat(?:ex)?$/.test(k) ? datTableOf(k) : null;
    if (t && (!modTables[t] || /\.datex$/.test(k))) modTables[t] = session.nameOf(k);
  }

  const files: FolderFile[] = [];
  const taken = new Map<string, string>();
  const write = async (r: Rendered, members: string[]) => {
    let rendered = r;
    const key = rendered.file.toLowerCase();
    if (taken.has(key) && taken.get(key) !== members[0]) {
      rendered = { form: "file", file: `${MOD_FOLDERS.files}/${folderPath(members[0])}`, data: (await session.read(members[0]))!, kept: `${taken.get(key)} has the same text name` };
    }
    taken.set(rendered.file.toLowerCase(), members[0]);
    files.push({ file: rendered.file, data: rendered.data });
    recordRendered(manifest, members, rendered);
  };
  const all = session.members();
  let done = 0;
  for (const k of all) {
    if (/^scripts\\(aiscript|bwscript)\.bin$/.test(k)) continue;
    const name = session.nameOf(k);
    const bytes = (await session.read(k))!;
    let r = await renderMember(name, bytes, { names, palette });
    const table = datTableOf(name);
    if (r.form === "table" && table && modTables[table] !== name) r = { form: "file", file: `${MOD_FOLDERS.files}/${folderPath(name)}`, data: bytes, kept: `${modTables[table]} is the ${table} table's text` };
    await write(r, [name]);
    progress?.(++done, all.length);
  }
  const aiName = session.has("scripts\\aiscript.bin") ? session.nameOf("scripts\\aiscript.bin") : null;
  const bwName = session.has("scripts\\bwscript.bin") ? session.nameOf("scripts\\bwscript.bin") : null;
  if (aiName || bwName) {
    const ai = aiName ? { member: aiName, bytes: (await session.read(aiName))! } : null;
    const bw = bwName ? { member: bwName, bytes: (await session.read(bwName))! } : null;
    for (const r of renderAiScripts(ai, bw, { names })) {
      const members = r.form === "ai" ? [aiName!, ...(bwName ? [bwName] : [])] : [[aiName, bwName].find((x) => x && `${MOD_FOLDERS.files}/${folderPath(x)}` === r.file) ?? aiName ?? bwName!];
      await write(r, members);
    }
    progress?.(all.length, all.length);
  }
  for (const [list, folder, into] of [[session.source.plugins, MOD_FOLDERS.plugins, manifest.plugins], [session.source.firegraft, MOD_FOLDERS.firegraft, manifest.firegraft]] as const) {
    const seen = new Set<string>();
    for (const p of list) {
      let leaf = p.name.split(/[\\/]/).pop()!;
      while (seen.has(leaf.toLowerCase())) leaf = `${leaf.replace(/(\.[^.]+)$/, "")}.2${leaf.match(/\.[^.]+$/)?.[0] ?? ""}`;
      seen.add(leaf.toLowerCase());
      const file = `${folder}/${folderPath(leaf)}`;
      const data = await p.read();
      files.push({ file, data });
      into.push({ name: p.name.split(/[\\/]/).pop()!, bytes: data.length, file, ...(p.member ? { member: p.member } : {}) });
    }
  }
  for (const { folder, names } of gameCopies(session.source.gameCopy)) manifest.notes.push(`${folder || session.source.name} is a copy of the game: its own archives (${names.join(", ")}) are not part of the mod and were left out`);
  if (session.source.probed.length) manifest.notes.push(`${session.source.probed.join(", ")} had no list of its files: only the names the game reads were found in it`);
  if (!palette) manifest.notes.push(`no palette ${manifest.palette} was found (the mod's tileset\\${manifest.palette}.wpe, or the game's): the GRPs are kept as bytes`);
  tidyManifest(manifest);
  // (Set after the tidying, which in `@scm-js/core` 0.13 knows no `races`: the key comes last in the file.)
  const declared = normalizeRaces(races);
  if (declared.length) (manifest as ModManifest & { races?: DataSetRace[] }).races = declared;
  files.push({ file: MOD_MANIFEST, data: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`) });
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { files, manifest };
}

/* ── A zip, stored (no compression): what a folder is handed over in ──── */

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip of the files under `root/` (forward slashes; names in UTF-8), every member stored. */
export function writeZip(files: readonly FolderFile[], root = ""): Uint8Array {
  const enc = new TextEncoder();
  const prefix = root ? `${root.replace(/\/+$/, "")}/` : "";
  const entries = files.map((f) => ({ name: enc.encode(prefix + f.file), data: f.data, crc: crc32(f.data) }));
  const size = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 22);
  if (size > 0xffffffff || entries.length > 0xffff) throw new Error("too large for a zip without zip64: save as an MPQ instead");
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(at);
    v.setUint32(at, 0x04034b50, true); v.setUint16(at + 4, 20, true); v.setUint16(at + 6, 0x800, true); v.setUint16(at + 8, 0, true);
    v.setUint32(at + 10, 0x00210000, true); // 1980-01-01 00:00, so the same files give the same zip
    v.setUint32(at + 14, e.crc, true); v.setUint32(at + 18, e.data.length, true); v.setUint32(at + 22, e.data.length, true);
    v.setUint16(at + 26, e.name.length, true); v.setUint16(at + 28, 0, true);
    out.set(e.name, at + 30); out.set(e.data, at + 30 + e.name.length);
    at += 30 + e.name.length + e.data.length;
  }
  const dir = at;
  entries.forEach((e, i) => {
    v.setUint32(at, 0x02014b50, true); v.setUint16(at + 4, 20, true); v.setUint16(at + 6, 20, true); v.setUint16(at + 8, 0x800, true); v.setUint16(at + 10, 0, true);
    v.setUint32(at + 12, 0x00210000, true); v.setUint32(at + 16, e.crc, true); v.setUint32(at + 20, e.data.length, true); v.setUint32(at + 24, e.data.length, true);
    v.setUint16(at + 28, e.name.length, true); v.setUint16(at + 30, 0, true); v.setUint16(at + 32, 0, true); v.setUint16(at + 34, 0, true); v.setUint16(at + 36, 0, true);
    v.setUint32(at + 38, 0, true); v.setUint32(at + 42, offsets[i], true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  });
  v.setUint32(at, 0x06054b50, true); v.setUint16(at + 8, entries.length, true); v.setUint16(at + 10, entries.length, true);
  v.setUint32(at + 12, at - dir, true); v.setUint32(at + 16, dir, true);
  return out;
}

/** The members a person changed, in the game's paths under the mod's own folder name: to copy over a mod of loose files. */
export async function changedZip(session: ModSession): Promise<{ zip: Uint8Array; count: number }> {
  const edited = await session.edited();
  const files: FolderFile[] = [];
  for (const k of edited) files.push({ file: session.nameOf(k).replace(/\\/g, "/"), data: (await session.read(k))! });
  return { zip: writeZip(files), count: files.length };
}
