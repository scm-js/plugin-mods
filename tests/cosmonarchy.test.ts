/**
 * A large mod as it ships, read from disk: `SCMJS_COSMONARCHY=<the release folder>` (the one holding `mpq/`). Skipped
 * without it; nothing of the mod is in this repository.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDat } from "@scm-js/core";
import { OpenError, openPieces } from "../source";
import { ModSession } from "../session";
import { foundLine } from "../info";
import { attachReader } from "../reader";
import { diskPieces } from "./support";

const dir = process.env.SCMJS_COSMONARCHY ? `${process.env.SCMJS_COSMONARCHY.replace(/\/+$/, "")}/mpq` : "";
const have = !!dir && existsSync(dir);

describe.skipIf(!have)("a large mod's mpq/ folder", () => {
  it("opens, names its units, finds one by name, and shows and checks its scripts", async () => {
    const t0 = Date.now();
    const source = await openPieces(diskPieces(dir), "mpq");
    const s = await ModSession.open(source, { base: null });
    const opened = Date.now() - t0;
    const units = s.data.tables.units!;
    const named = s.data.names.units.filter(Boolean).length;
    console.log(foundLine(source));
    console.log(`opened in ${opened} ms; ${units.count} unit types (${units.layout}), ${named} named, the last named ${s.data.names.units.findLastIndex(Boolean)}`);
    expect(units.count).toBe(3000);
    expect(units.layout).toBe("datex");
    expect(named).toBeGreaterThan(600);
    expect(s.data.names.units.findIndex((n) => /Maverick/.test(n))).toBe(0);
    const doc = s.scripts.find((d) => d.label === "iscript/iscript_terran.txt")!;
    expect(doc).toBeTruthy();
    const state = await s.scriptState(doc.id);
    expect(state.unreadable).toBeNull();
    const bad = await s.setScriptText(doc.id, state.text!.replace("\tplayfram ", "\tplayfrm "));
    expect(bad.error?.message).toBe("\"playfrm\" is not an iscript command");
    expect(await s.edited()).toEqual([]);
    // The attach reader: the mod's .datex table by its member.
    const reader = attachReader({ has: (m) => s.has(m), read: (m) => s.read(m) });
    expect(decodeDat("units", (await reader("arr/units.datex", { member: "arr\\units.datex", under: async () => null }))!, { fileName: "units.datex" }).count).toBe(3000);
  });
});

/**
 * The folder a person opened: `SCMJS_COSMONARCHY_ROOT=<a folder holding the release beside a copy of the game>` (its
 * `Release/` and its `Starcraft/`, a whole 1.16.1). Opened whole, the copy of the game is left out and the mod is the
 * release's alone. Slow: every file is read through the folder, `Release/temp.mpq` (nearly 1 GB) twice.
 */
const root = process.env.SCMJS_COSMONARCHY_ROOT?.replace(/\/+$/, "") ?? "";
const haveRoot = !!root && existsSync(`${root}/Release`) && existsSync(`${root}/Starcraft`);

describe.skipIf(!haveRoot)("a mod's release beside a copy of the game", () => {
  it("opens to the release's files, plugins and hash, the game's archives left out", async () => {
    const top = root.split("/").pop()!;
    const summary = async (dir: string, prefix: string) => {
      const t0 = Date.now();
      const pieces = diskPieces(dir).map((p) => ({ ...p, path: prefix + p.path }));
      const source = await openPieces(pieces, dir.split("/").pop()!);
      const s = await ModSession.open(source, { base: null });
      const hash = await s.hash();
      console.log(`${dir}: ${pieces.length} pieces, ${source.files.size} files, ${source.plugins.length} plugins, ${source.firegraft.length} FireGraft files, ${source.gameCopy.length} left as the game's, hash ${hash}, in ${Date.now() - t0} ms`);
      console.log(foundLine(source));
      return {
        files: [...source.files].map(([k, f]) => `${k} ${f.size} ${f.layer}`).sort(),
        plugins: source.plugins.map((p) => `${p.name} ${p.bytes} ${p.layer}`).sort(),
        firegraft: source.firegraft.map((p) => `${p.name} ${p.bytes} ${p.layer}`).sort(),
        layers: source.layers, gameCopy: source.gameCopy, hash, name: source.name,
      };
    };
    // The release alone, its paths as they are under the root.
    const release = await summary(`${root}/Release`, `${top}/`);
    const whole = await summary(root, "");
    expect(whole.gameCopy.map((p) => p.slice(top.length + 1)).sort()).toEqual([
      "Starcraft/BrooDat.mpq", "Starcraft/BroodWar.mpq", "Starcraft/Maps/CMBW-Root/CMBW-editor/CMBW-editor.mpq", "Starcraft/Maps/CMBW-Root/CMBW-editor/grafting/graftc.exe",
      "Starcraft/StarCraft.mpq", "Starcraft/StarDat.mpq", "Starcraft/patch_rt.mpq",
    ]);
    expect(release.gameCopy).toEqual([]);
    expect(whole.files.some((f) => f.startsWith("scripts\\iscript.bin "))).toBe(false);
    expect(whole.files.length).toBe(release.files.length);
    expect(whole.files).toEqual(release.files);
    expect(whole.plugins).toEqual(release.plugins);
    expect(whole.firegraft).toEqual(release.firegraft);
    expect(whole.layers).toEqual(release.layers);
    expect(whole.name).toBe(release.name);
    expect(whole.hash).toBe(release.hash);
  }, 30 * 60_000);

  it("its copy of the game opened on its own is refused: no mod in it", async () => {
    const t0 = Date.now();
    const pieces = diskPieces(`${root}/Starcraft`);
    const err = await openPieces(pieces, "Starcraft").catch((e: unknown) => e);
    console.log(`${root}/Starcraft: ${pieces.length} pieces, in ${Date.now() - t0} ms: ${(err as Error).message}`);
    expect(err).toBeInstanceOf(OpenError);
    expect((err as Error).message).toBe("Starcraft is a copy of the game, and there is no mod in it.");
  }, 10 * 60_000);
});
