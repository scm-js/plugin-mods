import { describe, expect, it } from "vitest";
import { engineFiles, EngineRegistration, handedCode, playFiles, type EngineFile, type EngineService } from "../engine";
import { openPieces, type Piece } from "../source";
import { ModSession } from "../session";
import { inGamePaths, readMod, type ModDescription, type ModFiles } from "@scm-js/mod";
import { codeOutsideMpq, currentMembers, textFolder, writeMpq, writeProgram } from "../save";
import { pagePath, playMessage } from "../play";
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
    const counted = { members: () => { asked++; return session.members(); }, has: (k: string) => session.has(k), read: (k: string) => session.read(k), nameOf: (k: string) => session.nameOf(k), edited: () => session.edited(), source: session.source };
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

/** How a page reads the files it is handed: the same reader, in the game's paths where they are (scm-sim's `inputFromHanded`). */
async function pageReads(files: EngineFile[]): Promise<ModDescription> {
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  return readMod({ name: "handed", ...(inGamePaths(files.map((f) => f.path)) ? { layout: "game" as const } : {}), list: async () => files.map((f) => ({ path: f.path, size: f.bytes.length })), read: async (p) => byPath.get(p)! });
}
/** The hash a page gives the files it is handed. */
const pageHash = async (files: EngineFile[]): Promise<string> => (await pageReads(files)).identity.hash;

/** How the page reads what was dropped on it (its pieces as given: a folder, or the one file named). */
async function dropReads(pieces: Piece[]): Promise<ModDescription> {
  const byPath = new Map(pieces.map((p) => [p.path, p]));
  const tree: ModFiles = { name: "dropped", ...(pieces.length === 1 && !pieces[0].path.includes("/") ? { named: pieces[0].path } : {}), list: async () => pieces.map((p) => ({ path: p.path, size: p.size })), read: (p) => byPath.get(p)!.read() };
  return readMod(tree);
}

/** The code as a reader describes it: each module's name, role, where it came from and its place in the loader's order. */
const code = (d: ModDescription) => d.modules.map((m) => `${m.name} ${m.role} ${m.source.kind} ${m.load ? `#${m.order}` : "-"}`);

describe("what the engine's page is handed names the mod as the editor does", () => {
  const edit = (s: ModSession) => s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });

  it("a folder with a plugin, a library beside it and a project: opened, edited", async () => {
    const s = await open([bytesPiece("made/plugins/made.qdp", new Uint8Array([77, 90])), bytesPiece("made/plugins/helper.dll", new Uint8Array([1])), bytesPiece("made/made.fgp", new Uint8Array([1, 2, 3]))]);
    expect(s.source.plugins.map((p) => `${p.name} ${p.line}`)).toEqual(["made/plugins/made.qdp made.qdp", "made/plugins/helper.dll helper.dll"]);
    expect(await pageHash(await engineFiles(s))).toBe(await s.hash());
    edit(s);
    expect(await pageHash(await engineFiles(s))).toBe(await s.hash());
  });

  it("a patcher exe: handed as that program, its plugins as the patcher's, and the page's hash is the editor's", async () => {
    const archive = await writeMpq((await Promise.all(madeFolder().filter((p) => !p.path.endsWith("readme.txt")).map(async (p) => ({ member: p.path.slice(5).replace(/\//g, "\\"), data: await p.read() })))).concat([{ member: "firegraft\\Made.fgp", data: new Uint8Array([9, 9]) }, { member: "plugins\\inside.qdp", data: new Uint8Array([5]) }]));
    const exe = madePatcherExe([{ id: 0x1234, bytes: madeLibrary("Carried.qdp") }], archive);
    const source = await openPieces([bytesPiece("Made.exe", exe)], "Made.exe");
    expect(source.kind).toBe("exe");
    expect(source.name).toBe("Made");
    expect(source.exes.map((e) => `${e.file} ${e.kind} ${e.plugins.length}`)).toEqual(["Made.exe firegraft 1"]);
    expect(source.plugins.map((p) => `${p.name} ${p.line ?? "-"} ${p.member ?? "-"} ${p.exe ?? "-"}`)).toEqual(["Carried.qdp Carried.qdp - Made.exe", "inside.qdp - plugins\\inside.qdp -"]);
    const s = await ModSession.open(source, { base: null });
    expect(await s.hash()).toBe(source.identity!.hash);
    const files = await engineFiles(s);
    // (every file of the mod was the program's: they go back inside it, the project with them)
    expect(files.map((f) => f.path)).toEqual(["Made.exe"]);
    // (none of its files edited: the program as it came)
    expect(files[0].bytes).toEqual(exe);
    const page = await pageReads(files);
    expect(code(page)).toEqual(code(await dropReads([bytesPiece("Made.exe", exe)])));
    expect(code(page)).toEqual(["Carried.qdp plugin carried #0"]);
    expect(page.patches[0]?.files.map((f) => f.name)).toEqual(["Made.fgp"]);
    expect(page.identity.hash).toBe(await s.hash());
    edit(s);
    expect(await s.hash()).not.toBe(source.identity!.hash);
    const edited = await engineFiles(s);
    // (edited: the program and its plugins as they came, its archive written again with the edit)
    expect(edited.map((f) => f.path)).toEqual(["Made.exe"]);
    expect(edited[0].bytes.subarray(0, source.exes[0].at)).toEqual(exe.subarray(0, source.exes[0].at));
    expect(code(await pageReads(edited))).toEqual(["Carried.qdp plugin carried #0"]);
    expect(await pageHash(edited)).toBe(await s.hash());
  });

  it("a patcher's plugins keep its loader's order, and one that names itself .dll stays a plugin (handed, played, saved)", async () => {
    // (the patcher loads Zed.qdp, then Alpha.dll; a folder's loader would sort them by name, and take a .dll for a library)
    const archive = await writeMpq([{ member: "arr\\units.dat", data: new Uint8Array([1, 2, 3]) }, { member: "unit\\made\\x.grp", data: new Uint8Array([4]) }]);
    const exe = madePatcherExe([{ id: 0x22, bytes: madeLibrary("Zed.qdp") }, { id: 0x11, bytes: madeLibrary("Alpha.dll") }], archive);
    const pieces = [bytesPiece("Patched/Patched.exe", exe), bytesPiece("Patched/helper.dll", madeLibrary("helper.dll"))];
    const dropped = await dropReads(pieces);
    expect(code(dropped)).toEqual(["Zed.qdp plugin carried #0", "Alpha.dll plugin carried #1", "helper.dll library file -"]);
    const s = await ModSession.open(await openPieces(pieces, "Patched"), { base: null });
    // The engine (a replay's Game view, Play From Here) and Play: the same code as the drop, in the same order.
    for (const files of [await engineFiles(s), await playFiles(s)]) {
      expect(files.map((f) => f.path).sort()).toEqual(["Patched.exe", "plugins/helper.dll"]);
      const page = await pageReads(files);
      expect(code(page)).toEqual(code(dropped));
      expect(page.identity.hash).toBe(dropped.identity.hash);
    }
    // Before (each plugin under plugins/ by its name): the order was the folder's, and Alpha.dll a library never run.
    const asFiles = await pageReads([{ path: "arr/units.dat", bytes: new Uint8Array([1, 2, 3]) }, { path: "plugins/Zed.qdp", bytes: madeLibrary("Zed.qdp") }, { path: "plugins/Alpha.dll", bytes: madeLibrary("Alpha.dll") }]);
    expect(code(asFiles)).toEqual(["Zed.qdp plugin file #0", "Alpha.dll library file -"]);
    // An edit to a file the program held goes back inside it: the page plays it, under the editor's hash.
    s.setMember("arr\\units.dat", new Uint8Array([9]));
    const edited = await pageReads(await playFiles(s));
    expect(code(edited)).toEqual(code(dropped));
    expect(edited.identity.hash).toBe(await s.hash());
    expect(edited.layers.find((l) => l.kind === "archive")!.files.map((f) => f.name)).toContain("arr\\units.dat");
    // The message the play page is handed names the program and the plugins by their own names.
    const message = playMessage({ name: "Patched", hash: await s.hash(), files: await playFiles(s) }) as { dataSet: { files: { path: string }[] } };
    expect(message.dataSet.files.map((f) => f.path).sort()).toEqual(["Patched.exe", "plugins/helper.dll"]);
    expect(handedCode(await playFiles(s)).sort()).toEqual(["Patched.exe", "helper.dll"]);
    expect(pagePath("ARR\\Units.dat")).toBe("arr/units.dat");
  });

  it("Play hands a mod of code alone: its plugin, read as the dropped plugin is", async () => {
    const plugin = madeLibrary("Alone.qdp");
    const pieces = [bytesPiece("alone/plugins/Alone.qdp", plugin)];
    const s = await ModSession.open(await openPieces(pieces, "alone"), { base: null });
    const files = await playFiles(s);
    expect(files.map((f) => f.path)).toEqual(["plugins/Alone.qdp"]);
    expect(code(await pageReads(files))).toEqual(code(await dropReads(pieces)));
  });
});

describe("saving a mod that came as a program, and what is left out", () => {
  const edit = (s: ModSession) => s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });

  it("Save writes the program again: its plugins in its order, its archive as it is now, the editor's hash", async () => {
    const archive = await writeMpq([{ member: "arr\\units.dat", data: new Uint8Array([1, 2, 3]) }, { member: "Made.fgp", data: new Uint8Array([7]) }]);
    const exe = madePatcherExe([{ id: 0x22, bytes: madeLibrary("Zed.qdp") }, { id: 0x11, bytes: madeLibrary("Alpha.dll") }], archive);
    const s = await ModSession.open(await openPieces([bytesPiece("Made.exe", exe)], "Made.exe"), { base: null });
    s.setMember("arr\\units.dat", new Uint8Array([9]));
    const saved = (await writeProgram(s))!;
    const again = await dropReads([bytesPiece("Made.exe", saved.bytes)]);
    expect(code(again)).toEqual(["Zed.qdp plugin carried #0", "Alpha.dll plugin carried #1"]);
    expect(again.identity.hash).toBe(await s.hash());
    // (the program and what it carries, byte for byte; the project inside the archive, where FireGraft's patcher finds it)
    const at = s.source.exes[0].at;
    expect(saved.bytes.subarray(0, at)).toEqual(exe.subarray(0, at));
    expect(again.patches[0]?.files.map((f) => f.name)).toEqual(["Made.fgp"]);
    // An MPQ holds none of that code, and says so.
    expect(codeOutsideMpq(s)).toEqual(["Zed.qdp", "Alpha.dll"]);
    expect(code(await dropReads([bytesPiece("Made.mpq", await writeMpq(await currentMembers(s)))]))).toEqual([]);
    // A mod that is no program is not written as one.
    expect(await writeProgram(await ModSession.open(await openPieces(madeFolder(), "made"), { base: null }))).toBeNull();
  });

  it("a member its archive lists and does not give is left out of what is played and saved, as the reader leaves it out", async () => {
    const s = await ModSession.open(await openPieces(madeFolder(), "made"), { base: null });
    const broken = s.source.files.get("rez\\stat_txt.tbl")!;
    broken.read = () => Promise.reject(new RangeError("Offset is outside the bounds of the DataView"));
    const left: string[] = [];
    const members = await currentMembers(s, left);
    expect(left).toEqual(["rez\\stat_txt.tbl"]);
    expect(members.some((m) => /stat_txt/.test(m.member))).toBe(false);
    expect((await s.changedFiles()).some((f) => /stat_txt/.test(f.name))).toBe(false);
    expect((await playFiles(s)).some((f) => /stat_txt/.test(f.path))).toBe(false);
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
