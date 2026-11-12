/**
 * A copy of the game handed over with a mod is not the mod. The archives here are made in the test and only named as
 * the game's: nothing of the game's is in this repository.
 */
import { describe, expect, it } from "vitest";
import { gameCopyFiles } from "@scm-js/mod";
import { OpenError, openPieces, type Piece } from "../source";
import { ModSession } from "../session";
import { foundLine, gameCopyNotice } from "../info";
import { textFolder, writeMpq } from "../save";
import { bytesPiece, madeFolder } from "./support";

const text = (s: string) => new TextEncoder().encode(s);
const mpq = (members: Record<string, string>) => writeMpq(Object.entries(members).map(([member, data]) => ({ member, data: text(data) })));

/** A file that must not be read: the game's own (StarDat.mpq is 60 MB). */
const unread = (path: string): Piece => ({ path, size: 1, read: async () => { throw new Error(`${path} was read`); } });

/** The smallest Windows program with an MPQ after it: what MPQDraft's self-executing mods are. */
function sempq(archive: Uint8Array): Uint8Array {
  const exe = new Uint8Array(512 + archive.length);
  const v = new DataView(exe.buffer);
  exe[0] = 0x4d; exe[1] = 0x5a; // MZ
  v.setUint32(60, 64, true);
  v.setUint32(64, 0x4550, true); // PE\0\0, no sections, no optional header
  exe.set(archive, 512);
  return exe;
}

/** `Cosmonarchy/` as it was handed over: the mod's release beside a whole copy of the game. */
async function handedOver(root = "Cosmonarchy"): Promise<{ mod: Piece[]; game: Piece[] }> {
  const mod = [
    ...madeFolder(`${root}/Release/mpq`),
    bytesPiece(`${root}/Release/temp.mpq`, await mpq({ "unit\\made\\made.grp": "the mod's picture" })),
    bytesPiece(`${root}/Release/plugins/gptp.qdp`, new Uint8Array([1, 2, 3])),
    bytesPiece(`${root}/Release/README.md`, text("read me")),
  ];
  const game = [
    "Starcraft/StarDat.mpq", "Starcraft/BrooDat.mpq", "Starcraft/patch_rt.mpq", "Starcraft/StarCraft.mpq", "Starcraft/BroodWar.mpq",
    "Starcraft/Maps/CMBW-Root/CMBW-editor/CMBW-editor.mpq", "Starcraft/Maps/CMBW-Root/CMBW-editor/grafting/graftc.exe", "Starcraft/Maps/Tools.zip",
  ].map((p) => unread(`${root}/${p}`));
  // What else a copy of the game holds: not its archives, so taken as before (left out here: beside no game folder).
  game.push(bytesPiece(`${root}/Starcraft/License.txt`, text("licence")), bytesPiece(`${root}/Starcraft/Maps/CMBW-Root/CMBW-maps/a.scx`, text("map")));
  return { mod, game };
}

const keys = (s: { files: Map<string, unknown> }) => [...s.files.keys()].sort();

describe("a copy of the game handed over with a mod", () => {
  it("the game's archives and the archives under its Maps folder are left out unread; the mod is what it is alone", async () => {
    const { mod, game } = await handedOver();
    const both = await openPieces([...mod, ...game], "Cosmonarchy");
    const alone = await openPieces(mod.map((p) => ({ ...p, path: p.path.replace(/^Cosmonarchy\//, "") })), "Release");
    // (by copy, the game's own archives first in the game's order, then the rest by path: the reader's order)
    expect(both.gameCopy).toEqual([
      "Cosmonarchy/Starcraft/StarDat.mpq", "Cosmonarchy/Starcraft/BrooDat.mpq", "Cosmonarchy/Starcraft/patch_rt.mpq", "Cosmonarchy/Starcraft/StarCraft.mpq",
      "Cosmonarchy/Starcraft/BroodWar.mpq", "Cosmonarchy/Starcraft/Maps/CMBW-Root/CMBW-editor/CMBW-editor.mpq",
      "Cosmonarchy/Starcraft/Maps/CMBW-Root/CMBW-editor/grafting/graftc.exe", "Cosmonarchy/Starcraft/Maps/Tools.zip",
    ]);
    for (const p of both.gameCopy) expect(both.left, p).not.toContain(p);
    expect(keys(both)).toEqual(keys(alone));
    expect(keys(both)).toContain("unit\\made\\made.grp");
    expect(keys(both)).toContain("scripts\\iscript.bin");
    for (const [k, f] of both.files) expect(f.layer, k).toBe(`Cosmonarchy/${alone.files.get(k)!.layer}`);
    expect(both.layers).toEqual(["Cosmonarchy/Release/temp.mpq", "Cosmonarchy/Release/mpq/"]);
    expect(both.plugins.map((p) => p.name)).toEqual(["Cosmonarchy/Release/plugins/gptp.qdp"]);
    expect(both.left).toEqual(expect.arrayContaining(["Cosmonarchy/Starcraft/License.txt", "Cosmonarchy/Starcraft/Maps/CMBW-Root/CMBW-maps/a.scx"]));
    expect(alone.gameCopy).toEqual([]);
    // The same mod, by the same hash, as the release alone.
    const hash = async (s: typeof both) => (await ModSession.open(s, { base: null })).hash();
    expect(await hash(both)).toBe(await hash(alone));
  });

  it("says so at open: the folder as handed over and the files left out, past six said as a count", async () => {
    const { mod, game } = await handedOver();
    const source = await openPieces([...mod, ...game], "Cosmonarchy");
    const notice = "Cosmonarchy/Starcraft is a copy of the game. Its own archives (StarDat.mpq, BrooDat.mpq, patch_rt.mpq, StarCraft.mpq, BroodWar.mpq, CMBW-editor.mpq and 2 more) are not part of the mod and were left out.";
    expect(gameCopyNotice(source)).toBe(notice);
    expect(foundLine(source).endsWith(` ${notice}`)).toBe(true);
    const six = await openPieces([...mod, ...game.slice(0, 6)], "Cosmonarchy");
    expect(gameCopyNotice(six)).toBe("Cosmonarchy/Starcraft is a copy of the game. Its own archives (StarDat.mpq, BrooDat.mpq, patch_rt.mpq, StarCraft.mpq, BroodWar.mpq, CMBW-editor.mpq) are not part of the mod and were left out.");
    expect(gameCopyNotice(await openPieces(mod, "Cosmonarchy"))).toBe("");
    // and the mod's folder of text, saved, says what was left out
    const { manifest } = await textFolder(await ModSession.open(source, { base: null }));
    expect(manifest.notes).toContain("Cosmonarchy/Starcraft is a copy of the game: its own archives (StarDat.mpq, BrooDat.mpq, patch_rt.mpq, StarCraft.mpq, BroodWar.mpq, CMBW-editor.mpq, graftc.exe, Tools.zip) are not part of the mod and were left out");
  });

  it("the same whatever order the pieces come in", async () => {
    const { mod, game } = await handedOver();
    const want = await openPieces([...mod, ...game], "Cosmonarchy");
    for (const order of [[...game, ...mod], [...mod, ...game].reverse(), [...mod, ...game].sort((a, b) => (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1))]) {
      const got = await openPieces(order, "Cosmonarchy");
      expect(got.gameCopy).toEqual(want.gameCopy);
      expect(keys(got)).toEqual(keys(want));
      expect(got.layers).toEqual(want.layers);
      expect(gameCopyNotice(got)).toBe(gameCopyNotice(want));
    }
  });

  it("a mod's own exe or archive put in the game's folder is still the mod's", async () => {
    const { game } = await handedOver();
    const own = bytesPiece("Cosmonarchy/Starcraft/MyMod.mpq", await mpq({ "arr\\units.dat": "the mod's units" }));
    const exe = bytesPiece("Cosmonarchy/Starcraft/MyMod Launcher.exe", sempq(await mpq({ "scripts\\iscript.bin": "the mod's iscript" })));
    const archives = game.filter((p) => /\.(mpq|exe|zip)$/i.test(p.path));
    const source = await openPieces([...archives, own, exe], "Cosmonarchy");
    expect(source.layers).toEqual(["Cosmonarchy/Starcraft/MyMod.mpq", "Cosmonarchy/Starcraft/MyMod Launcher.exe"]);
    expect(new TextDecoder().decode(await source.files.get("arr\\units.dat")!.read())).toBe("the mod's units");
    expect(new TextDecoder().decode(await source.files.get("scripts\\iscript.bin")!.read())).toBe("the mod's iscript");
    expect(source.exes.map((e) => e.file)).toEqual(["Cosmonarchy/Starcraft/MyMod Launcher.exe"]);
    expect(source.gameCopy).toHaveLength(8);
  });

  it("a patch_rt.mpq in a folder with no StarDat.mpq is the mod's, as some old mods ship", async () => {
    const source = await openPieces([bytesPiece("Old Mod/patch_rt.mpq", await mpq({ "arr\\units.dat": "old" })), bytesPiece("Old Mod/Maps/a.mpq", await mpq({ "arr\\weapons.dat": "w" }))], "Old Mod");
    expect(source.gameCopy).toEqual([]);
    expect(source.layers).toEqual(["Old Mod/patch_rt.mpq", "Old Mod/Maps/a.mpq"]);
    expect(keys(source)).toEqual(["arr\\units.dat", "arr\\weapons.dat"]);
  });

  it("one file named StarDat.mpq or patch_rt.mpq opens as it did", async () => {
    for (const name of ["StarDat.mpq", "patch_rt.mpq", "BROODAT.MPQ"]) {
      const source = await openPieces([bytesPiece(name, await mpq({ "arr\\units.dat": "u" }))], name);
      expect(source.kind, name).toBe("archive");
      expect(source.gameCopy, name).toEqual([]);
      expect(keys(source), name).toEqual(["arr\\units.dat"]);
    }
  });

  it("a zip's members: a copy of the game in it is left out the same way", async () => {
    const { writeZip } = await import("../save");
    const zip = writeZip([
      { file: "Game/StarDat.mpq", data: text("not read") },
      { file: "Game/Maps/tool.exe", data: text("not read") },
      { file: "Game/patch_rt.mpq", data: text("not read") },
      { file: "Game/mod.mpq", data: await mpq({ "arr\\units.dat": "u" }) },
    ]);
    const source = await openPieces([bytesPiece("bundle.zip", zip)], "bundle.zip");
    // (a zip named alone: its members are laid under its own name, as the reader lays them)
    expect(source.gameCopy).toEqual(["bundle/Game/StarDat.mpq", "bundle/Game/patch_rt.mpq", "bundle/Game/Maps/tool.exe"]);
    expect(source.layers).toEqual(["bundle/Game/mod.mpq"]);
    expect(keys(source)).toEqual(["arr\\units.dat"]);
  });

  it("a folder that is only a copy of the game: no mod in it", async () => {
    const { game } = await handedOver();
    const only = game.filter((p) => /\.(mpq|exe|zip)$/i.test(p.path)).map((p) => ({ ...p, path: p.path.replace(/^Cosmonarchy\//, "") }));
    const err = await openPieces(only, "Starcraft").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenError);
    expect((err as Error).message).toBe("Starcraft is a copy of the game, and there is no mod in it.");
    // A plugin beside it is something of a mod's: opened.
    const withPlugin = await openPieces([...only, bytesPiece("Starcraft/plugins/x.qdp", new Uint8Array([1]))], "Starcraft");
    expect(withPlugin.plugins).toHaveLength(1);
    expect(withPlugin.gameCopy).toHaveLength(8);
  });
});

describe("a copy of the game opened on its own, with the rest of what a copy holds", () => {
  /** `Starcraft/` as installed: the game's archives (unread), and the files beside them that are no mod's. */
  const copy = async (): Promise<Piece[]> => {
    const { writeZip } = await import("../save");
    const { game } = await handedOver();
    return [
      ...game.filter((p) => /\.(mpq|exe|zip)$/i.test(p.path)).map((p) => ({ ...p, path: p.path.replace(/^Cosmonarchy\//, "") })),
      bytesPiece("Starcraft/License.txt", text("licence")),
      bytesPiece("Starcraft/storm.dll", text("MZ")),
      bytesPiece("Starcraft/lua_lsp/x.lua", text("-- lua")),
      bytesPiece("Starcraft/Maps/a.scx", text("map")),
      bytesPiece("Starcraft/Shaders/shader-package.zip", writeZip([{ file: "crt/crt.glsl", data: text("void main() {}") }, { file: "readme.txt", data: text("shaders") }])),
    ];
  };
  const refusal = "Starcraft is a copy of the game, and there is no mod in it.";

  it("its read-me, dlls, scripts of other programs, maps and a zip of shaders are no mod: refused", async () => {
    const err = await openPieces(await copy(), "Starcraft").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenError);
    expect((err as Error).message).toBe(refusal);
  });

  it("one loose file under a game folder, one plugin or one mod archive is a mod: opened", async () => {
    const units = bytesPiece("Starcraft/arr/units.dat", text("units"));
    const plugin = bytesPiece("Starcraft/plugins/x.qdp", new Uint8Array([1]));
    const archive = bytesPiece("Starcraft/MyMod.mpq", await mpq({ "rez\\stat_txt.tbl": "t" }));
    for (const extra of [units, plugin, archive]) {
      const source = await openPieces([...await copy(), extra], "Starcraft");
      expect(source.gameCopy, extra.path).toHaveLength(8);
    }
    // a zip's members under a game folder count as loose files do
    const { writeZip } = await import("../save");
    const zipped = await openPieces([...await copy(), bytesPiece("Starcraft/patch.zip", writeZip([{ file: "unit/made/made.grp", data: text("grp") }]))], "Starcraft");
    expect([...zipped.files.keys()]).toContain("unit\\made\\made.grp");
  });

  it("without a copy of the game, a folder of stray files opens as it always did", async () => {
    const stray = (await copy()).filter((p) => !/\.(mpq|exe)$|\/Tools\.zip$/i.test(p.path));
    const source = await openPieces(stray, "Starcraft");
    expect(source.gameCopy).toEqual([]);
    expect(source.files.size).toBeGreaterThan(0);
  });
});

describe("a copy of the game's Maps folder is the person's maps, never the mod's", () => {
  const archives = async () => (await handedOver()).game.filter((p) => /\.(mpq|exe|zip)$/i.test(p.path)).map((p) => ({ ...p, path: p.path.replace(/^Cosmonarchy\//, "") }));

  it("a campaign's music and a table under it are no mod: refused, those files left out, the archives named", async () => {
    const maps = [bytesPiece("Starcraft/Maps/CMBW-maps/campaign/Day/music/a.ogg", text("ogg")), bytesPiece("Starcraft/Maps/x/arr/units.dat", text("units"))];
    const err = await openPieces([...await archives(), ...maps], "Starcraft").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenError);
    expect((err as Error).message).toBe("Starcraft is a copy of the game, and there is no mod in it.");
  });

  it("a mod laid loose in the game's folder opens, rooted there; the maps beside it left out, not the mod's", async () => {
    const pieces = [
      ...await archives(),
      bytesPiece("Starcraft/arr/units.dat", text("units")),
      bytesPiece("Starcraft/Maps/a.scx", text("map")),
      bytesPiece("Starcraft/Maps/c/campaign/m.ogg", text("ogg")),
    ];
    const source = await openPieces(pieces, "Starcraft");
    expect(source.layers).toEqual(["Starcraft/"]);
    expect(keys(source)).toEqual(["arr\\units.dat"]);
    expect(source.left).toEqual(expect.arrayContaining(["Starcraft/Maps/a.scx", "Starcraft/Maps/c/campaign/m.ogg"]));
    expect(source.gameCopy).toHaveLength(8);
    for (const p of source.gameCopy) expect(p).toMatch(/\.(mpq|exe|zip)$/i);
  });
});

describe("gameCopyFiles", () => {
  it("a copy at the root of what was handed over", () => {
    expect([...gameCopyFiles(["StarDat.mpq", "BrooDat.mpq", "Maps/x.mpq", "Maps/a/b/c/tool.EXE", "Maps/a.scx", "mod.mpq", "arr/units.dat", "maps.mpq", "mapsx/a.scx"])].sort())
      .toEqual(["BrooDat.mpq", "Maps/a.scx", "Maps/a/b/c/tool.EXE", "Maps/x.mpq", "StarDat.mpq"]);
  });

  it("a copy a folder or two down, beside a mod, in any case", () => {
    const paths = [
      "Root/Game/STARDAT.MPQ", "Root/Game/broodat.mpq", "Root/Game/Patch_RT.mpq", "Root/Game/starcraft.MPQ", "Root/Game/BroodWar.mpq",
      "Root/Game/maps/x.zip", "Root/Game/MAPS/deep/er/x.mpq", "Root/Game/Maps/x.scm", "Root/Game/Mod.mpq", "Root/Game/StarCraft.exe",
      "Root/Game/sub/patch_rt.mpq", "Root/Game/sub/Maps/x.mpq", "Root/Mod/patch_rt.mpq", "Root/Mod/Maps/x.mpq", "Root/Maps/x.mpq", "Root/gamemaps/x.mpq",
      // everything under the copy's Maps folder, not its archives only: a map, a campaign's music, even the game's paths
      "Root/Game/Maps/c/Day/music/a.ogg", "Root/Game/maps/c/x/arr/units.dat", "Root/Game/arr/units.dat", "Root/Game/License.txt",
      // the same paths with no StarDat.mpq beside: a mod's
      "Root/Mod/Maps/x.scm", "Root/Mod/Maps/c/Day/music/a.ogg", "Root/Mod/maps/c/x/arr/units.dat",
    ];
    expect([...gameCopyFiles(paths)].sort()).toEqual([
      "Root/Game/BroodWar.mpq", "Root/Game/MAPS/deep/er/x.mpq", "Root/Game/Maps/c/Day/music/a.ogg", "Root/Game/Maps/x.scm", "Root/Game/Patch_RT.mpq", "Root/Game/STARDAT.MPQ",
      "Root/Game/broodat.mpq", "Root/Game/maps/c/x/arr/units.dat", "Root/Game/maps/x.zip", "Root/Game/starcraft.MPQ",
    ]);
  });

  it("two copies, and none", () => {
    expect([...gameCopyFiles(["a/StarDat.mpq", "a/patch_rt.mpq", "b/c/stardat.mpq", "b/c/Maps/m.mpq", "b/patch_rt.mpq"])].sort())
      .toEqual(["a/StarDat.mpq", "a/patch_rt.mpq", "b/c/Maps/m.mpq", "b/c/stardat.mpq"]);
    expect(gameCopyFiles(["a/patch_rt.mpq", "a/BrooDat.mpq", "a/Maps/m.mpq", "a/Maps/a.scx", "a/Maps/c/arr/units.dat", "a/StarDat.mpq.bak"]).size).toBe(0);
  });
});
