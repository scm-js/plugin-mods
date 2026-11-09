import { describe, expect, it } from "vitest";
import { Archive } from "mopaq";
import { decodeDat, decodeTblFile, modHash } from "@scm-js/core";
import { openPieces } from "../source";
import { ModSession } from "../session";
import { attachReader } from "../reader";
import { currentMembers, textFolder, writeMpq, writeZip } from "../save";
import { foundLine } from "../info";
import { bytesPiece, equal, madeFolder } from "./support";

const open = async (pieces = madeFolder(), name = "made") => ModSession.open(await openPieces(pieces, name), { base: null });

describe("a made mod, opened", () => {
  it("as a folder: the game's paths under it, a read-me beside them left out", async () => {
    const source = await openPieces(madeFolder(), "made");
    expect([...source.files.keys()].sort()).toEqual(["arr\\units.dat", "arr\\weapons.dat", "rez\\stat_txt.tbl", "scripts\\iscript.bin", "sound\\misc\\made.wav"]);
    expect(source.left).toEqual(["made/readme.txt"]);
    expect(foundLine(source)).toBe("made, from a folder of the game's files: 5 files (26 KB) — 2 tables, 1 script, 1 sound, 1 string table.");
  });

  it("as an MPQ and as a zip of the folder, the same files", async () => {
    const folder = await openPieces(madeFolder(), "made");
    const members = await Promise.all([...folder.files.values()].map(async (f) => ({ member: f.name, data: await f.read() })));
    const mpq = await writeMpq(members);
    const fromMpq = await openPieces([bytesPiece("made.mpq", mpq)], "made.mpq");
    expect(fromMpq.kind).toBe("archive");
    expect(fromMpq.name).toBe("made");
    const zip = writeZip(await Promise.all(madeFolder().map(async (p) => ({ file: p.path, data: await p.read() }))));
    const fromZip = await openPieces([bytesPiece("made.zip", zip)], "made.zip");
    for (const other of [fromMpq, fromZip]) {
      expect([...other.files.keys()].sort()).toEqual([...folder.files.keys()].sort());
      for (const [k, f] of folder.files) expect(equal(await other.files.get(k)!.read(), await f.read()), k).toBe(true);
    }
  });

  it("names its entries from its own string table", async () => {
    const s = await open();
    expect(s.data.tables.units!.count).toBe(228);
    expect(s.entryName("units", 0)).toBe("Terran Marine");
    expect(s.entryName("weapons", 0)).toBe("Gauss Rifle");
    expect(s.refs.usedBy("weapons", 0)).toEqual([{ table: "units", id: 0, field: "ground_weapon" }]);
    expect(s.scripts.map((d) => d.label)).toEqual(["iscript/iscript.txt"]);
  });
});

describe("an edit", () => {
  it("the marine's hit points, encoded back and read; the rest byte for byte as it came", async () => {
    const s = await open();
    expect(s.refuse({ table: "units", id: 0, field: "hit_points", value: -1 })?.text).toMatch(/whole number/);
    expect(s.refuse({ table: "units", id: 0, field: "shield_amount", value: 70000 })?.params?.max).toBe("65,535");
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    const units = decodeDat("units", (await s.read("arr\\units.dat"))!);
    expect(units.columns.hit_points[0]).toBe(45 * 256);
    expect(units.columns.mineral_cost[0]).toBe(50);
    expect(await s.edited()).toEqual(["arr\\units.dat"]);
    for (const k of ["arr\\weapons.dat", "rez\\stat_txt.tbl", "scripts\\iscript.bin", "sound\\misc\\made.wav"]) expect(equal(await s.read(k), await s.original(k)), k).toBe(true);
    // Put back as it was, nothing is edited.
    s.setField({ table: "units", id: 0, field: "hit_points", value: 40 * 256 });
    expect(await s.edited()).toEqual([]);
  });

  it("reads as a changelog against the mod as opened", async () => {
    const s = await open();
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    s.setField({ table: "weapons", id: 0, field: "damage_amount", value: 7 });
    await s.setString("rez\\stat_txt.tbl", 1, "Terran Spectre\0*\0Ground Units\0");
    const lines = (await s.diff("opened")).map((c) => c.text);
    expect(lines).toEqual([
      "Terran Marine: hit points 40 → 45",
      "Terran Marine: ground weapon damage 6 → 7",
      "stat_txt.tbl 2: \"Terran Ghost | * | Ground Units\" → \"Terran Spectre | * | Ground Units\"",
    ]);
    expect(s.entryName("units", 1)).toBe("Terran Spectre");
  });

  it("a script: assembled on each change, an unknown command named with its line", async () => {
    const s = await open();
    const state = await s.scriptState("iscript:scripts\\iscript.bin");
    expect(state.text).toContain("playsnd");
    const bad = await s.setScriptText("iscript:scripts\\iscript.bin", state.text!.replace("wait", "wiat"));
    expect(bad.error).toEqual({ line: expect.any(Number), message: "\"wiat\" is not an iscript command" });
    expect(bad.text!.split("\n")[bad.error!.line - 1]).toContain("wiat");
    expect(await s.edited()).toEqual([]);
    const good = await s.setScriptText("iscript:scripts\\iscript.bin", bad.text!.replace("wiat             \t1", "wait             \t2"));
    expect(good.error).toBeNull();
    expect(await s.edited()).toEqual(["scripts\\iscript.bin"]);
  });
});

describe("what the editor is handed", () => {
  it("the attach reader answers the edited table by its member and leaves the rest to the set underneath", async () => {
    const s = await open();
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    const reader = attachReader({ has: (m) => s.has(m), read: (m) => s.read(m) });
    const ask = (path: string, member: string | null) => Promise.resolve(reader(path, { member, under: async () => null }));
    expect(decodeDat("units", (await ask("arr/units.dat", "arr\\units.dat"))!).columns.hit_points[0]).toBe(45 * 256);
    expect(equal((await ask("arr/weapons.dat", "arr\\weapons.dat")) ?? null, await s.original("arr\\weapons.dat"))).toBe(true);
    // The editor names the member: the copy's own layout (stat_txt kept beside the tilesets) is not the plugin's to know.
    expect(decodeTblFile((await ask("tileset/stat_txt.tbl", "rez\\stat_txt.tbl"))!).strings[0]).toBe("Terran Marine\0*\0Ground Units\0");
    expect(await ask("arr/flingy.dat", "arr\\flingy.dat")).toBeNull();
    expect(await ask("unit/terran/marine.grp", "unit\\terran\\marine.grp")).toBeNull();
    // The copy's own lists are the editor's to work out.
    expect(await ask("unit/manifest.json", null)).toBeNull();
  });

  it("a dropped folder is taken for a mod when it holds the game's folders at its root or one down", async () => {
    const { looksLikeMod } = await import("../source");
    expect(looksLikeMod(madeFolder().map((p) => p.path))).toBe(true);
    expect(looksLikeMod(["release/mpq/arr/units.datex", "release/readme.md"])).toBe(true);
    expect(looksLikeMod(["text/mod.json", "text/tables/units.txt"])).toBe(true);
    expect(looksLikeMod(["photos/a.jpg", "photos/arr.txt"])).toBe(false);
  });

  it("the hash is the mod's, by the rule the play page and `scmjs mod info` share", async () => {
    const carried = [bytesPiece("made/plugins/gptp.qdp", new Uint8Array([1, 2, 3])), bytesPiece("made/Made.fgp", new Uint8Array([4, 5])), bytesPiece("made/1161.fgd", new Uint8Array([6]))];
    const s = await open([...madeFolder(), ...carried]);
    const want = async () => {
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const k of s.members()) { const bytes = await s.read(k); if (bytes) files.push({ name: k, bytes }); }
      return (await modHash({ files, plugins: [{ name: "gptp.qdp", bytes: new Uint8Array([1, 2, 3]) }], firegraft: [{ name: "Made.fgp", bytes: new Uint8Array([4, 5]) }] })).hash;
    };
    // Every game file, the plugin and the project: not the files that differ from the game's alone.
    const opened = await s.hash();
    expect(opened).toBe(await want());
    expect(opened).not.toBe((await modHash({ files: await s.changedFiles() })).hash);
    // FireGraft's database is not a line.
    const withoutFgd = await open([...madeFolder(), ...carried.slice(0, 2)]);
    expect(await withoutFgd.hash()).toBe(opened);
    // An edit is in it, and only the edited member is read again.
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    const edited = await s.hash();
    expect(edited).not.toBe(opened);
    expect(edited).toBe(await want());
  });
});

describe("an operating system's files are not the mod's", () => {
  const text = (t: string) => new TextEncoder().encode(t);
  /** One file of each kind the list names, under a game folder (and the zip folder macOS makes). */
  const SYSTEM = ["sound/desktop.ini", "sound/misc/Desktop.INI", "unit/Thumbs.db", "unit/ehthumbs.db", "unit/ehthumbs_vista.db", "arr/.DS_Store", "arr/._units.dat", "arr/Icon\r", "rez/.directory", "arr/__MACOSX/units.dat", "__MACOSX/arr/._units.dat"];
  /** Names that only hold one of the list's: files of the mod like any other. */
  const NOT_SYSTEM = ["sound/mydesktop.ini", "sound/desktop.ini.bak", "sound/desktop.ini/voice.wav", "unit/thumbs.db.txt", "unit/xthumbs.db", "arr/.ds_store2", "arr/a._b", "arr/_.units.dat", "rez/x.directory", "arr/icon", "my__macosx/units.dat", "samase/config.ini"];

  it("is told by name alone, any case and either slash", async () => {
    const { isSystemFile, SYSTEM_FILES } = await import("../source");
    for (const path of SYSTEM) {
      expect(isSystemFile(path), path).toBe(true);
      expect(isSystemFile(path.toUpperCase().replace(/\//g, "\\")), path).toBe(true);
    }
    for (const path of NOT_SYSTEM) expect(isSystemFile(path), path).toBe(false);
    for (const name of SYSTEM_FILES.names) expect(SYSTEM.some((p) => p.toLowerCase().endsWith(`/${name}`)), JSON.stringify(name)).toBe(true);
  });

  it("a folder opens to the same files and the same hash with each of them and without; a name that only holds one counts", async () => {
    const carried = [bytesPiece("made/plugins/gptp.qdp", new Uint8Array([1, 2, 3])), bytesPiece("made/Made.fgp", new Uint8Array([4, 5]))];
    const plain = await open([...madeFolder(), ...carried]);
    const hash = await plain.hash();
    for (const path of SYSTEM) {
      const s = await open([...madeFolder(), ...carried, bytesPiece(`made/${path}`, text("x"))]);
      expect([...s.source.files.keys()].sort(), path).toEqual([...plain.source.files.keys()].sort());
      expect(s.source.left, path).toContain(`made/${path}`);
      expect(await s.hash(), path).toBe(hash);
    }
    for (const path of NOT_SYSTEM) {
      const s = await open([...madeFolder(), ...carried, bytesPiece(`made/${path}`, text("x"))]);
      expect(await s.hash(), path).not.toBe(hash);
    }
    // macOS's half of a plugin and of a project: no plugin, no project
    const forked = await open([...madeFolder(), ...carried, bytesPiece("made/plugins/._gptp.qdp", text("fork")), bytesPiece("made/._Made.fgp", text("fork"))]);
    expect(forked.source.plugins.map((p) => p.name)).toEqual(["made/plugins/gptp.qdp"]);
    expect(forked.source.firegraft.map((p) => p.name)).toEqual(["made/Made.fgp"]);
    expect(await forked.hash()).toBe(hash);
  });

  it("an archive packed from a folder that had one, and a zip made on macOS, are the same mod", async () => {
    const folder = await openPieces(madeFolder(), "made");
    const members = await Promise.all([...folder.files.values()].map(async (f) => ({ member: f.name, data: await f.read() })));
    const hash = await (await ModSession.open(await openPieces([bytesPiece("made.mpq", await writeMpq(members))], "made.mpq"), { base: null })).hash();
    const packed = await writeMpq([...members, { member: "sound\\desktop.ini", data: text("[ViewState]") }, { member: "sound\\misc\\Thumbs.db", data: text("t") }]);
    const fromMpq = await ModSession.open(await openPieces([bytesPiece("made.mpq", packed)], "made.mpq"), { base: null });
    expect([...fromMpq.source.files.keys()].sort()).toEqual([...folder.files.keys()].sort());
    expect(await fromMpq.hash()).toBe(hash);
    const zip = writeZip([...await Promise.all(madeFolder().map(async (p) => ({ file: p.path, data: await p.read() }))), { file: "__MACOSX/made/arr/._units.dat", data: text("fork") }, { file: "made/arr/.DS_Store", data: text("Bud1") }]);
    const fromZip = await ModSession.open(await openPieces([bytesPiece("made.zip", zip)], "made.zip"), { base: null });
    expect([...fromZip.source.files.keys()].sort()).toEqual([...folder.files.keys()].sort());
    expect(await fromZip.hash()).toBe(hash);
  });
});

describe("saving", () => {
  it("an MPQ: the edited member changed, every other byte for byte", async () => {
    const s = await open();
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    const archive = Archive.open(await writeMpq(await currentMembers(s)));
    for (const k of s.members()) {
      const back = archive.readFile(s.nameOf(k));
      if (k === "arr\\units.dat") expect(decodeDat("units", back).columns.hit_points[0]).toBe(45 * 256);
      else expect(equal(back, await s.original(k)), k).toBe(true);
    }
  });

  it("a text folder that opens again to the same members", async () => {
    const s = await open();
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    const { files, manifest } = await textFolder(s);
    expect(files.map((f) => f.file)).toEqual(["iscript/iscript.txt", "mod.json", "sounds/sound/misc/made.wav", "strings/stat_txt.txt", "tables/units.txt", "tables/weapons.txt"]);
    expect(manifest.kept).toEqual([]);
    expect(new TextDecoder().decode(files.find((f) => f.file === "tables/units.txt")!.data)).toContain("# Terran Marine");
    const again = await ModSession.open(await openPieces(files.map((f) => bytesPiece(`made-text/${f.file}`, f.data)), "made-text"), { base: null });
    expect(again.source.kind).toBe("mod folder");
    for (const k of s.members()) expect(equal(await again.read(k), await s.read(k)), k).toBe(true);
    // The same folder in a zip, as Save as Folder hands it over.
    const zipped = await ModSession.open(await openPieces([bytesPiece("made.zip", writeZip(files, "made"))], "made.zip"), { base: null });
    expect(zipped.source.kind).toBe("mod folder");
    expect(zipped.source.name).toBe("made");
    for (const k of s.members()) expect(equal(await zipped.read(k), await s.read(k)), k).toBe(true);
  });
});

describe("a value as typed", () => {
  it("hit points in whole points and 1/256ths, supply in halves, flags in hex; each reads back to itself", async () => {
    const { DAT_SCHEMAS } = await import("@scm-js/core");
    const { display, parse } = await import("../fields");
    const field = (t: "units", n: string) => DAT_SCHEMAS[t].fields.find((f) => f.name === n)!;
    const hp = field("units", "hit_points"), supply = field("units", "supply_required"), flags = field("units", "special_ability_flags");
    for (const v of [0, 1, 40 * 256, 40 * 256 + 128, 0x7fffff]) expect(parse(hp, display(hp, v))).toBe(v);
    expect(display(hp, 1)).toBe("0.00390625");
    expect(parse(hp, "45")).toBe(45 * 256);
    expect(parse(hp, "0.001")).toEqual({ error: "Hit points go in 1/256ths." });
    expect(display(supply, 3)).toBe("1.5");
    expect(parse(supply, "1.5")).toBe(3);
    expect(display(flags, 0x41)).toBe("0x00000041");
    expect(parse(flags, "0x41")).toBe(0x41);
    expect(parse(flags, "x")).toEqual({ error: "A whole number is needed (0x… for hex)." });
  });
});
