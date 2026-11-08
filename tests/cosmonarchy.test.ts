/**
 * A large mod as it ships, read from disk: `SCMJS_COSMONARCHY=<the release folder>` (the one holding `mpq/`). Skipped
 * without it; nothing of the mod is in this repository.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDat } from "@scm-js/core";
import { openPieces } from "../source";
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
    // The attach reader: the mod's .datex tables, read as .datex.
    const { reader } = attachReader({ members: () => s.members(), read: (m) => s.read(m), baseManifest: { datex: [], optional: [] } });
    const manifest = JSON.parse(new TextDecoder().decode((await reader("unit/manifest.json"))!));
    expect(manifest.datex).toEqual(["flingy", "images", "mapdata", "orders", "portdata", "sprites", "techdata", "units", "upgrades", "weapons"]);
    expect(manifest.optional).toEqual(["rez/unitnames.tbl", "unit/cmdbtns/uniticons.grp"]);
    expect(decodeDat("units", (await reader("arr/units.datex"))!, { fileName: "units.datex" }).count).toBe(3000);
  });
});
