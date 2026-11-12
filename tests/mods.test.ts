/**
 * Mods as they ship, read from disk: `SCMJS_MODS=<a folder or a file>[:<another>…]` (a folder as a drop hands it over,
 * every file under it; a file as the person names it). Skipped without it; nothing of any mod is in this repository.
 * For each: the hash the plugin names it by is `@scm-js/mod`'s, the files the engine's page is handed hash to it, and
 * after an edit the page still names it as the editor does.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readMod, type ModFiles } from "@scm-js/mod";
import { openPieces, type Piece } from "../source";
import { ModSession } from "../session";
import { engineFiles, type EngineFile } from "../engine";

const given = (process.env.SCMJS_MODS ?? "").split(":").filter((p) => p && existsSync(p));

/** A folder as a drop hands it over (dot folders too), under its own name; a file as itself. */
function piecesOf(path: string): { pieces: Piece[]; name: string; named?: string } {
  const file = (full: string, as: string): Piece => ({ path: as, size: statSync(full).size, read: async () => new Uint8Array(readFileSync(full)) });
  if (statSync(path).isFile()) { const name = path.split("/").pop()!; return { pieces: [file(path, name)], name, named: name }; }
  const top = path.replace(/\/+$/, "").split("/").pop()!;
  const out: Piece[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const full = join(d, n); if (statSync(full).isDirectory()) walk(full); else out.push(file(full, `${top}/${relative(path, full)}`)); } };
  walk(path);
  return { pieces: out, name: top };
}

async function pageHash(files: EngineFile[]): Promise<string> {
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  return (await readMod({ name: "handed", layout: "game", list: async () => files.map((f) => ({ path: f.path, size: f.bytes.length })), read: async (p) => byPath.get(p)! })).identity.hash;
}

describe.skipIf(!given.length)("mods as they ship", () => {
  for (const path of given) {
    it(path, async () => {
      const { pieces, name, named } = piecesOf(path);
      const byPath = new Map(pieces.map((p) => [p.path, p]));
      const tree: ModFiles = { name: named ? name.replace(/\.(mpq|exe|zip)$/i, "") : name, ...(named ? { named } : {}), list: async () => pieces.map((p) => ({ path: p.path, size: p.size })), read: async (p) => byPath.get(p)!.read() };
      const d = await readMod(tree);
      const s = await ModSession.open(await openPieces(pieces, name), { base: null });
      const opened = await s.hash();
      const handed = await pageHash(await engineFiles(s));
      // An edit: the smallest member, one byte longer.
      const k = s.members().reduce((a, b) => (s.source.files.get(b)!.size < s.source.files.get(a)!.size ? b : a), s.members()[0]);
      if (k) s.setMember(k, new Uint8Array([...(await s.read(k))!, 0]));
      const edited = await s.hash();
      const handedEdited = await pageHash(await engineFiles(s));
      console.log(JSON.stringify({ path, name: s.source.name, identity: d.identity.hash, opened, handed, edited: k ? edited : null, handedEdited, plugins: s.source.plugins.map((p) => `${p.name}${p.line ? "" : " (no line)"}`) }));
      expect(opened).toBe(d.identity.hash);
      expect(handed).toBe(opened);
      if (k) expect(edited).not.toBe(opened);
      expect(handedEdited).toBe(edited);
    }, 30 * 60_000);
  }
});
