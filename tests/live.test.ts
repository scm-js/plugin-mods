import { describe, expect, it } from "vitest";
import { answerLine, LiveSender, type LiveAnswer, type LiveField, type LiveFile, type LiveService, type LiveState } from "../live";
import { openPieces } from "../source";
import { ModSession } from "../session";
import { madeFolder } from "./support";

/** A stand-in for plugin-scm-sim's `scm-sim.live`: what it was sent, and how the page answers. */
function fakeService(playing = true, answer: (fields: readonly LiveField[], files: readonly LiveFile[]) => LiveAnswer = (fields, files) => ({
  applied: [...fields.map((f) => ({ ...f, message: "written" })), ...files.filter((f) => !f.path.endsWith(".tbl")).map((f) => ({ path: f.path, message: "loaded" }))],
  deferred: files.filter((f) => f.path.endsWith(".tbl")).map((f) => ({ path: f.path, message: "kept" })),
  errors: [],
})) {
  const sent: { fields: LiveField[]; files: LiveFile[] }[] = [];
  let listener: ((s: LiveState | null) => void) | null = null;
  const service: LiveService & { playingNow: boolean; say(s: LiveState | null): void } = {
    present: true, playingNow: playing,
    playing: async () => service.playingNow,
    onState: (l) => { listener = l; return () => { listener = null; }; },
    patch: async (fields, files = []) => { sent.push({ fields: [...fields], files: [...files] }); return answer(fields, files); },
    grafts: async () => ({ files: [], left: [] }),
    play: async () => "started",
    say: (s) => listener?.(s),
  };
  return { service, sent };
}

const open = async () => ModSession.open(await openPieces(madeFolder(), "made"), { base: null });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("live: edits sent to a running test game", () => {
  it("a field goes as the field, a string table as its file; the status line says applied and next start", async () => {
    const s = await open(), { service, sent } = fakeService();
    const lines: string[] = [];
    const live = new LiveSender((l) => lines.push(l), 5);
    live.setService(service);
    live.follow(s);
    s.setField({ table: "units", id: 0, field: "hit_points", value: 50 * 256 });
    await s.setString("rez\\stat_txt.tbl", 0, "Terran Rifleman\0*\0Ground Units\0");
    await settle(); await live.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].fields).toEqual([{ table: "units", id: 0, field: "hit_points", value: 12800 }]);
    expect(sent[0].files.map((f) => f.path)).toEqual(["rez/stat_txt.tbl"]);
    expect(lines.at(-1)).toBe("units 0 hit_points: applied in the running game. stat_txt.tbl: takes effect at the next start.");
    // The same field twice before it goes: sent once, with its last value.
    s.setField({ table: "units", id: 0, field: "hit_points", value: 51 * 256 });
    s.setField({ table: "units", id: 0, field: "hit_points", value: 52 * 256 });
    await settle(); await live.flush();
    expect(sent[1].fields).toEqual([{ table: "units", id: 0, field: "hit_points", value: 52 * 256 }]);
  });

  it("an imported picture goes as the file; nothing is sent while no game alone runs", async () => {
    const s = await open(), { service, sent } = fakeService(false);
    const live = new LiveSender(() => {}, 5);
    live.setService(service);
    live.follow(s);
    s.setMember("unit\\terran\\marine.grp", new Uint8Array([1, 0, 8, 0, 8, 0]));
    await settle(); await live.flush();
    expect(sent).toEqual([]);
    expect(live.alone).toBe(false);
    service.playingNow = true;
    service.say({ running: true, alone: true, frame: 3, mod: null, waiting: [] });
    expect(live.alone).toBe(true);
    s.setMember("unit\\terran\\marine.grp", new Uint8Array([1, 0, 8, 0, 9, 0]));
    await settle(); await live.flush();
    expect(sent[0].files[0]).toEqual({ path: "unit/terran/marine.grp", bytes: new Uint8Array([1, 0, 8, 0, 9, 0]) });
    expect(live.line).toBe("marine.grp: applied in the running game.");
  });

  it("a refusal is said as the page words it", async () => {
    const s = await open();
    const { service, sent } = fakeService(true, (fields, files) => ({ applied: [], deferred: [], errors: [...fields, ...files].map(() => ({ message: "Refused: this is a game between people, and a change on one page only would make it another game on the others." })) }));
    const live = new LiveSender(() => {}, 5);
    live.setService(service);
    live.follow(s);
    s.setField({ table: "weapons", id: 0, field: "damage_amount", value: 9 });
    await settle(); await live.flush();
    expect(live.line).toBe("Refused by the running game: Refused: this is a game between people, and a change on one page only would make it another game on the others.");
    expect(answerLine({ applied: [], deferred: [{ path: "scripts/iscript.bin", message: "" }], errors: [] })).toBe("iscript.bin: takes effect at the next start.");
    expect(sent[0].fields).toEqual([{ table: "weapons", id: 0, field: "damage_amount", value: 9 }]);
  });
});
