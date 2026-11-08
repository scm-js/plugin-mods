import { describe, expect, it } from "vitest";
import { Archive } from "mopaq";
import { dataSetHash, decodeDat, decodeTblFile } from "@scm-js/core";
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
    expect(s.refuse({ table: "units", id: 0, field: "hit_points", value: -1 })).toMatch(/whole number/);
    expect(s.refuse({ table: "units", id: 0, field: "shield_amount", value: 70000 })).toMatch(/0 to 65,535/);
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
  it("the attach reader answers the edited table and leaves the rest to the copy underneath", async () => {
    const s = await open();
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    const { reader } = attachReader({ members: () => s.members(), read: (m) => s.read(m), baseManifest: { datex: [], optional: [], images: [1] } });
    expect(decodeDat("units", (await reader("arr/units.dat"))!).columns.hit_points[0]).toBe(45 * 256);
    expect(equal(await reader("arr/weapons.dat"), await s.original("arr\\weapons.dat"))).toBe(true);
    expect(decodeTblFile((await reader("tileset/stat_txt.tbl"))!).strings[0]).toBe("Terran Marine\0*\0Ground Units\0");
    expect(await reader("arr/flingy.dat")).toBeNull();
    expect(await reader("unit/terran/marine.grp")).toBeNull();
    expect(JSON.parse(new TextDecoder().decode((await reader("unit/manifest.json"))!))).toEqual({ datex: [], optional: [], images: [1] });
  });

  it("a .datex table is read as one, and the mod's names are listed", async () => {
    const { reader } = attachReader({ members: () => ["arr\\units.datex", "arr\\flingy.dat", "rez\\unitnames.tbl"], read: async () => new Uint8Array(1), baseManifest: { datex: ["flingy"], optional: [] } });
    expect(JSON.parse(new TextDecoder().decode((await reader("unit/manifest.json"))!))).toEqual({ datex: ["units"], optional: ["rez/unitnames.tbl"] });
    expect(await reader("arr/units.datex")).not.toBeNull();
    let off = true;
    const quiet = attachReader({ members: () => ["arr\\units.dat"], read: async () => new Uint8Array(1), baseManifest: null }, () => off);
    expect(await quiet.reader("arr/units.dat")).toBeNull();
    off = false;
    expect(await quiet.reader("arr/units.dat")).not.toBeNull();
  });

  it("the hash is the shared rule's", async () => {
    const s = await open();
    s.setField({ table: "units", id: 0, field: "hit_points", value: 45 * 256 });
    const files = await s.changedFiles();
    expect(files.length).toBe(5);
    expect(await s.hash(files)).toBe(await dataSetHash(files));
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
  });
});
