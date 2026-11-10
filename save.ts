/**
 * Writing a mod out: the MPQ the launchers load (`scmjs mod pack`'s rules: name order, 4,096-byte sectors, a listfile,
 * one compression for all), the folder of text and pictures (`scmjs mod unpack`'s form, each text kept only when it
 * packs back to the same bytes) as a zip, and the changed files alone as a zip for a mod that is a folder of loose
 * files. Pure apart from the archive library; the panel hands the bytes to `api.ui.saveFile`.
 */
import { Creator } from "mopaq";
import {
  DEFAULT_PALETTE, MOD_FOLDERS, MOD_MANIFEST, datTableOf, emptyManifest, folderPath, gameName, recordRendered, renderAiScripts, renderMember, tidyManifest,
  type DatTableName, type ModManifest, type Rendered,
} from "@scm-js/core";
import type { ModSession } from "./session";
import { gameCopies } from "./source";

export type Compression = "zlib" | "pkware" | "none";

/** Every member the mod has now, with its current bytes, in name order; plugins carried inside the archive too. */
export async function currentMembers(session: ModSession): Promise<{ member: string; data: Uint8Array }[]> {
  const out: { member: string; data: Uint8Array }[] = [];
  for (const k of session.members()) {
    const data = await session.read(k);
    if (data) out.push({ member: session.nameOf(k), data });
  }
  for (const p of [...session.source.plugins, ...session.source.firegraft]) if (p.member) out.push({ member: p.member, data: await p.read() });
  return out.sort((a, b) => (gameName(a.member) < gameName(b.member) ? -1 : 1));
}

/** The members as an MPQ. */
export async function writeMpq(members: readonly { member: string; data: Uint8Array }[], compression: Compression = "zlib"): Promise<Uint8Array> {
  const creator = new Creator({ sectorSize: 4096, listfile: true, listfileCompress: compression === "pkware" ? "pkware" : "zlib" });
  for (const m of members) creator.addFile(m.member, m.data, { compress: compression === "none" ? false : compression });
  return creator.writeAsync();
}

/* ── The text folder ───────────────────────────────────────────────────── */

export interface FolderFile { file: string; data: Uint8Array }

/**
 * The mod as `scmjs mod unpack` lays it out: tables, strings, scripts and overlays as text, GRPs as PNG sheets drawn in
 * `palette` (the mod's `tileset\<name>.wpe`, else the game's), and `mod.json`. `progress` is called after each member.
 */
export async function textFolder(session: ModSession, progress?: (done: number, total: number) => void): Promise<{ files: FolderFile[]; manifest: ModManifest }> {
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
