import { describe, expect, it } from "vitest";
import { engineFiles, EngineRegistration, type EngineFile, type EngineService } from "../engine";
import { openPieces } from "../source";
import { ModSession } from "../session";
import { readMod } from "@scm-js/mod";
import { textFolder, writeMpq } from "../save";
import { bytesPiece, madeFolder, madeLibrary, madePatcherExe } from "./support";

/** A stand-in for plugin-scm-sim's `scm-sim.engine` (0.19.0): what is registered under which hash now. */
function fakeEngine() {
  const live = new Map<string, { name?: string; files: () => Promise<EngineFile[]> }>();
  const log: string[] = [];
  const engine: EngineService = {
    present: true,
    provideMod: (hash, mod) => {
      live.set(hash, mod);
      log.push(`+${hash}`);
      return { dispose: () => { if (live.get(hash) === mod) live.delete(hash); log.push(`-${hash}`); } };
    },
  };
  return { engine, live, log };
}

const open = async (extra: ReturnType<typeof bytesPiece>[] = []) => ModSession.open(await openPieces([...madeFolder(), ...extra], "made"), { base: null });
const A = "1111222233334444", B = "5555666677778888";

describe("the open mod, registered with the engine by its hash", () => {
  it("registers once a hash is known, again under a new hash, and not after the mod closes", async () => {
    const { engine, live, log } = fakeEngine();
    const reg = new EngineRegistration();
    reg.service(engine);
    const session = await open();
    // (no hash yet: a large mod's is worked out after it opens)
    reg.set({ session, name: "made", hash: null });
    expect(log).toEqual([]);
    reg.set({ session, name: "made", hash: A });
    expect(reg.registered()).toBe(A);
    expect(live.get(A)?.name).toBe("made");
    // The same again: nothing changes. An edit that changes the hash: registered again under the new one.
    reg.set({ session, name: "made", hash: A });
    reg.set({ session, name: "made", hash: B });
    expect(log).toEqual([`+${A}`, `-${A}`, `+${B}`]);
    expect([...live.keys()]).toEqual([B]);
    reg.set(null);
    expect(live.size).toBe(0);
    expect(reg.registered()).toBeNull();
  });

  it("registers when the engine comes after the mod, and lets go when it goes", async () => {
    const { engine, live } = fakeEngine();
    const reg = new EngineRegistration();
    reg.set({ session: await open(), name: "made", hash: A });
    expect(reg.registered()).toBeNull();
    reg.service(engine);
    expect([...live.keys()]).toEqual([A]);
    reg.service(null);
    expect(live.size).toBe(0);
  });

  it("does nothing with an engine from before provideMod, or one that throws", async () => {
    const reg = new EngineRegistration();
    const session = await open();
    reg.service({ present: true });
    expect(() => reg.set({ session, name: "made", hash: A })).not.toThrow();
    expect(reg.registered()).toBeNull();
    reg.service({ present: true, provideMod: () => { throw new Error("no"); } });
    expect(reg.registered()).toBeNull();
    reg.service({ present: false, provideMod: () => ({ dispose() {} }) });
    expect(reg.registered()).toBeNull();
  });

  it("builds the files only when asked: every file the mod provides, its plugins and FireGraft project", async () => {
    const { engine, live } = fakeEngine();
    const session = await open([bytesPiece("made/plugins/made.qdp", new Uint8Array([77, 90])), bytesPiece("made/made.fgp", new Uint8Array([1, 2, 3]))]);
    let asked = 0;
    const counted = { members: () => { asked++; return session.members(); }, has: (k: string) => session.has(k), read: (k: string) => session.read(k), nameOf: (k: string) => session.nameOf(k), source: session.source };
    const reg = new EngineRegistration();
    reg.service(engine);
    reg.set({ session: counted, name: "made", hash: A });
    expect(asked).toBe(0);
    const files = await live.get(A)!.files();
    expect(asked).toBe(1);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain("arr/units.dat");
    expect(paths).toContain("scripts/iscript.bin");
    expect(paths).toContain("plugins/made.qdp");
    expect(paths).toContain("firegraft/made.fgp");
    // (not the read-me beside the game's folders)
    expect(paths.some((p) => p.includes("readme"))).toBe(false);
    expect(files.find((f) => f.path === "plugins/made.qdp")?.bytes).toEqual(new Uint8Array([77, 90]));
    expect(await engineFiles(session)).toHaveLength(files.length);
  });
});

/** The hash a page gives the files it is handed: the same reader, in the game's paths (scm-sim's `inputFromHanded`). */
async function pageHash(files: EngineFile[]): Promise<string> {
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  return (await readMod({ name: "handed", layout: "game", list: async () => files.map((f) => ({ path: f.path, size: f.bytes.length })), read: async (p) => byPath.get(p)! })).identity.hash;
}

describe("what the engine's page is handed names the mod as the editor does", () => {
  const edit = (s: ModSession) => s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });

  it("a folder with a plugin, a library beside it and a project: opened, edited", async () => {
    const s = await open([bytesPiece("made/plugins/made.qdp", new Uint8Array([77, 90])), bytesPiece("made/plugins/helper.dll", new Uint8Array([1])), bytesPiece("made/made.fgp", new Uint8Array([1, 2, 3]))]);
    expect(s.source.plugins.map((p) => `${p.name} ${p.line}`)).toEqual(["made/plugins/made.qdp made.qdp", "made/plugins/helper.dll helper.dll"]);
    expect(await pageHash(await engineFiles(s))).toBe(await s.hash());
    edit(s);
    expect(await pageHash(await engineFiles(s))).toBe(await s.hash());
  });

  it("a patcher exe: the plugins it carries are handed by the names their lines go by, and the page's hash is the editor's", async () => {
    const archive = await writeMpq((await Promise.all(madeFolder().filter((p) => !p.path.endsWith("readme.txt")).map(async (p) => ({ member: p.path.slice(5).replace(/\//g, "\\"), data: await p.read() })))).concat([{ member: "firegraft\\Made.fgp", data: new Uint8Array([9, 9]) }, { member: "plugins\\inside.qdp", data: new Uint8Array([5]) }]));
    const exe = madePatcherExe([{ id: 0x1234, bytes: madeLibrary("Carried.qdp") }], archive);
    const source = await openPieces([bytesPiece("Made.exe", exe)], "Made.exe");
    expect(source.kind).toBe("exe");
    expect(source.name).toBe("Made");
    expect(source.exes.map((e) => `${e.file} ${e.kind} ${e.plugins.length}`)).toEqual(["Made.exe firegraft 1"]);
    expect(source.plugins.map((p) => `${p.name} ${p.line ?? "-"} ${p.member ?? "-"}`)).toEqual(["Carried.qdp Carried.qdp -", "inside.qdp - plugins\\inside.qdp"]);
    const s = await ModSession.open(source, { base: null });
    expect(await s.hash()).toBe(source.identity!.hash);
    const files = await engineFiles(s);
    expect(files.map((f) => f.path)).toContain("plugins/Carried.qdp");
    expect(files.map((f) => f.path)).toContain("firegraft/Made.fgp");
    // (a plugin inside the archive: no loader loads it, and it has no line)
    expect(files.some((f) => /inside/.test(f.path))).toBe(false);
    expect(await pageHash(files)).toBe(await s.hash());
    edit(s);
    expect(await s.hash()).not.toBe(source.identity!.hash);
    expect(await pageHash(await engineFiles(s))).toBe(await s.hash());
  });

  it("a text folder saved from an edited mod opens again under the edited mod's hash", async () => {
    const s = await open([bytesPiece("made/plugins/made.qdp", new Uint8Array([77, 90])), bytesPiece("made/made.fgp", new Uint8Array([1, 2, 3]))]);
    edit(s);
    const { files } = await textFolder(s);
    const again = await ModSession.open(await openPieces(files.map((f) => bytesPiece(`made-text/${f.file}`, f.data)), "made-text"), { base: null });
    expect(again.source.kind).toBe("mod folder");
    expect(again.source.plugins.map((p) => p.line)).toEqual(["made.qdp"]);
    expect(await again.hash()).toBe(await s.hash());
  });
});

describe("a large mod, and the archives it is read from", () => {
  const edit = (s: ModSession) => s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });

  it("described at once, its hash worked out when first asked: the same hash, edited or not", async () => {
    const { HASH_LATER } = await import("../source");
    // (a read-me beside the game's folders said to be large: what was handed over is, the mod is not)
    const large = { path: "made/notes.txt", size: HASH_LATER, read: async () => new TextEncoder().encode("notes") };
    const now = await open();
    const later = await ModSession.open(await openPieces([...madeFolder(), large], "made"), { base: null });
    expect(now.source.identity).not.toBeNull();
    expect(later.source.identity).toBeNull();
    // An edit before the hash is known: the hash, when it comes, is the edited mod's.
    edit(now); edit(later);
    expect(await later.hash()).toBe(await now.hash());
    expect(later.source.identity?.hash).toBe((await (await open()).hash()));
    expect(await pageHash(await engineFiles(later))).toBe(await later.hash());
  });

  it("opens each archive once for every read after the reader's, a plugin inside it too, and again only after close", async () => {
    let reads = 0;
    const archive = await writeMpq([{ member: "unit\\made\\x.grp", data: new Uint8Array([1, 2, 3]) }, { member: "plugins\\inside.qdp", data: new Uint8Array([5]) }]);
    const s = await open([{ path: "made/mod.mpq", size: archive.length, read: async () => { reads++; return archive; } }]);
    expect(reads).toBe(1);
    const inside = s.source.plugins.find((p) => p.member)!;
    expect(await inside.read()).toEqual(new Uint8Array([5]));
    expect(s.source.files.get("unit\\made\\x.grp")!.layer).toBe("made/mod.mpq");
    expect(await s.read("unit\\made\\x.grp")).toEqual(new Uint8Array([1, 2, 3]));
    expect(reads).toBe(1);
    s.source.close();
    expect(await inside.read()).toEqual(new Uint8Array([5]));
    expect(reads).toBe(2);
  });
});
