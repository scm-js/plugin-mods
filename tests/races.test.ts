import { describe, expect, it } from "vitest";
import { readManifest } from "@scm-js/core";
import { RaceTable, Refusal, checkRow, draftOf, emptyDraft, normalizeRaces, type DataSetRace, type RacesApi } from "../races";
import { openPieces } from "../source";
import { ModSession } from "../session";
import { textFolder } from "../save";
import { playMessage } from "../play";
import { bytesPiece, madeFolder } from "./support";

// (A mod's fourth race, as one mod gives it: byte 69, its files under the letter a.)
const ASKOSI: DataSetRace = { id: 69, name: "Askosi", letter: "a", like: 1 };

/** The editor's side of the table, as the new editor keeps it: per profile id, normalized, events counted. */
function fakeEditor(opts: { candidates?: { names: string[]; letters: string[] }; ours?: boolean } = {}) {
  const kept = new Map<string, DataSetRace[]>();
  const calls: { races: DataSetRace[]; id?: string }[] = [];
  let asked = 0;
  const gameData: RacesApi = {
    races: () => (kept.get("cosmonarchy-bw") ?? []).map((r) => ({ ...r })),
    setRaces: (races, id) => { calls.push({ races: races.map((r) => ({ ...r })), id }); kept.set(id ?? "cosmonarchy-bw", normalizeRaces(races)); return null; },
    raceCandidates: async () => { asked++; return opts.candidates ?? { names: [], letters: [] }; },
  };
  const host = { gameData, profileId: () => "cosmonarchy-bw", ours: () => opts.ours ?? true };
  return { host, kept, calls, asked: () => asked };
}

describe("a table of races, read by the rule", () => {
  it("keeps rows 8–255 with a name, trimmed, sorted by id, the first of an id", () => {
    expect(normalizeRaces([
      { id: 71, name: " Kogri " },
      { id: 69, name: "Askosi", letter: "A", like: 1 },
      { id: 70, name: "Bloodsummon", like: 5, letter: "ab" },
      { id: 69, name: "Again" },
      { id: 7, name: "Inactive" },
      { id: 256, name: "Too far" },
      { id: 9.5, name: "Half" },
      { id: "10", name: "Text" },
      { id: 11, name: "   " },
      { id: 12, name: "x".repeat(41) },
      { id: 13, name: "x".repeat(40), note: "kept" },
      null, [], "row",
    ])).toEqual([
      { id: 13, name: "x".repeat(40), note: "kept" },
      { id: 69, name: "Askosi", letter: "a", like: 1 },
      { id: 70, name: "Bloodsummon" },
      { id: 71, name: "Kogri" },
    ]);
  });

  it("anything that is not a list is no table, and nothing throws", () => {
    for (const v of [undefined, null, 3, "races", { id: 9, name: "x" }]) expect(normalizeRaces(v)).toEqual([]);
  });
});

describe("a row as typed", () => {
  const rows = [ASKOSI, { id: 70, name: "Bloodsummon" }];
  const draft = (d: Partial<ReturnType<typeof emptyDraft>>) => ({ ...emptyDraft(), ...d });

  it("is refused in plain words: a number of the game's, one another row has, a name empty or too long, a letter of the game's", () => {
    expect(checkRow(draft({ id: "1", name: "X" }), rows, null).errors.id).toBe("1 is the game's own race, Terran. A mod's races are numbered 8 to 255.");
    expect(checkRow(draft({ id: "256", name: "X" }), rows, null).errors.id).toBe("A race's number is 255 at most.");
    expect(checkRow(draft({ id: "x9", name: "X" }), rows, null).errors.id).toBe("The number is a whole number from 8 to 255.");
    expect(checkRow(draft({ id: "", name: "X" }), rows, null).errors.id).toBe("Give the race's number, from 8 to 255.");
    expect(checkRow(draft({ id: "69", name: "X" }), rows, null).errors.id).toBe("Race 69 is already in the table, as Askosi.");
    expect(checkRow(draft({ id: "71", name: "  " }), rows, null).errors.name).toBe("Give the race a name.");
    expect(checkRow(draft({ id: "71", name: "x".repeat(41) }), rows, null).errors.name).toBe("A name is 40 characters at most; this one has 41.");
    expect(checkRow(draft({ id: "71", name: "Kogri", letter: "t" }), rows, null).errors.letter).toBe("t is the letter of the game's own files for Terran.");
    expect(checkRow(draft({ id: "71", name: "Kogri", letter: "N" }), rows, null).errors.letter).toBe("n is the letter of the game's own files for Neutral.");
    expect(checkRow(draft({ id: "71", name: "Kogri", letter: "ab" }), rows, null).errors.letter).toBe("The letter is one letter from a to z, or none.");
  });

  it("is taken trimmed, the letter lower-cased, plays-as a number or absent", () => {
    expect(checkRow(draft({ id: " 71 ", name: " Kogri ", letter: "K", like: "0" }), rows, null)).toEqual({ row: { id: 71, name: "Kogri", letter: "k", like: 0 }, errors: {} });
    expect(checkRow(draft({ id: "71", name: "Kogri" }), rows, null).row).toEqual({ id: 71, name: "Kogri" });
  });

  it("an edit may keep its own number, keeps the row's other fields, and keeps a letter it came with", () => {
    const odd = [{ id: 9, name: "Old", letter: "z", source: "hand" } as DataSetRace];
    expect(checkRow({ ...draftOf(odd[0]), name: "New" }, odd, 9).row).toEqual({ id: 9, name: "New", letter: "z", source: "hand" });
    expect(checkRow(draft({ id: "69", name: "Askosi", letter: "a", like: "" }), rows, 69).row).toEqual({ id: 69, name: "Askosi", letter: "a" });
    expect(checkRow(draft({ id: "70", name: "Askosi" }), rows, 69).errors.id).toBe("Race 70 is already in the table, as Bloodsummon.");
  });
});

describe("the Races tab's table", () => {
  it("in an editor that keeps races: add, edit and remove each hand the whole table to setRaces, under the mod's id", () => {
    const ed = fakeEditor();
    const table = new RaceTable(ed.host);
    expect(table.canKeep).toBe(true);
    expect(table.put({ id: "70", name: "Bloodsummon", letter: "", like: "" }).ok).toBe(true);
    expect(table.put({ id: "69", name: "Askosi", letter: "a", like: "1" }).ok).toBe(true);
    expect(table.rows.map((r) => r.id)).toEqual([69, 70]);
    expect(table.put({ id: "70", name: "Blood Summon", letter: "", like: "2" }, 70).ok).toBe(true);
    expect(table.remove(69)).toBe(true);
    expect(table.remove(69)).toBe(false);
    expect(ed.calls.map((c) => [c.id, c.races.map((r) => `${r.id} ${r.name}`)])).toEqual([
      ["cosmonarchy-bw", ["70 Bloodsummon"]],
      ["cosmonarchy-bw", ["69 Askosi", "70 Bloodsummon"]],
      ["cosmonarchy-bw", ["69 Askosi", "70 Blood Summon"]],
      ["cosmonarchy-bw", ["70 Blood Summon"]],
    ]);
    expect(ed.kept.get("cosmonarchy-bw")).toEqual([{ id: 70, name: "Blood Summon", like: 2 }]);
  });

  it("a refused row changes nothing and reaches nobody", () => {
    const ed = fakeEditor();
    const table = new RaceTable(ed.host, [ASKOSI]);
    expect(table.put({ id: "69", name: "Twice", letter: "", like: "" })).toEqual({ ok: false, errors: { id: "Race 69 is already in the table, as Askosi." } });
    expect(table.rows).toEqual([ASKOSI]);
    expect(ed.calls).toEqual([]);
  });

  it("takes the editor's table once the editor draws from the mod, not before", () => {
    const ed = fakeEditor({ ours: false });
    ed.kept.set("cosmonarchy-bw", [ASKOSI]);
    const table = new RaceTable(ed.host, []);
    expect(table.load()).toBe(false);
    expect(table.rows).toEqual([]);
    const ours = fakeEditor();
    ours.kept.set("cosmonarchy-bw", [ASKOSI]);
    const t2 = new RaceTable(ours.host, []);
    expect(t2.load()).toBe(true);
    expect(t2.rows).toEqual([ASKOSI]);
    expect(t2.load()).toBe(false);
  });

  it("in an editor from before races: shown as the mod brought them, nothing changed, nothing called", async () => {
    const host = { gameData: {} as RacesApi, profileId: () => "cosmonarchy-bw", ours: () => true };
    const table = new RaceTable(host, [ASKOSI, { id: 3, name: "no" }]);
    expect(table.canKeep).toBe(false);
    expect(table.canHint).toBe(false);
    expect(table.rows).toEqual([ASKOSI]);
    expect(table.load()).toBe(false);
    expect(table.put({ id: "70", name: "Bloodsummon", letter: "", like: "" }).ok).toBe(false);
    expect(table.remove(69)).toBe(false);
    expect(table.rows).toEqual([ASKOSI]);
    expect(await table.hints()).toEqual({ names: [], letters: [] });
  });
});

describe("a refusal in the status line", () => {
  /** The panel's status line: `unsay` clears it only while it still says the refusal. */
  const statusLine = () => {
    const line = { text: "" };
    const refusal = new Refusal((text) => { line.text = text; }, (text) => { if (line.text === text) line.text = ""; });
    return { line, refusal };
  };

  it("is said on Add, and taken back as soon as the row changes", () => {
    const { line, refusal } = statusLine();
    const rows = [ASKOSI];
    const draft = { ...emptyDraft(), id: "70" };
    const { errors } = checkRow(draft, rows, null);
    refusal.refuse(errors.name!);
    expect(line.text).toBe("Give the race a name.");
    refusal.changed();
    expect(line.text).toBe("");
    // (Taken back once: a later change says nothing.)
    line.text = "Race 70 added: Bloodsummon.";
    refusal.changed();
    expect(line.text).toBe("Race 70 added: Bloodsummon.");
  });

  it("leaves the status line alone when something else was said since", () => {
    const { line, refusal } = statusLine();
    refusal.refuse("Give the race a name.");
    line.text = "stat_txt.tbl entry 3 changed.";
    refusal.changed();
    expect(line.text).toBe("stat_txt.tbl entry 3 changed.");
  });
});

describe("hints from the mod's files", () => {
  it("are offered, never applied: the table is as it was and nothing is kept until a person adds a row", async () => {
    const ed = fakeEditor({ candidates: { names: ["Askosi", "Bloodsummon", " Kogri "], letters: ["a", "t", "b", "ab"] } });
    const table = new RaceTable(ed.host, [ASKOSI]);
    const hints = await table.hints();
    // (A name or letter a row has already, and a letter of the game's, is not offered.)
    expect(hints).toEqual({ names: ["Bloodsummon", "Kogri"], letters: ["b"] });
    expect(ed.asked()).toBe(1);
    expect(table.rows).toEqual([ASKOSI]);
    expect(ed.calls).toEqual([]);
    // What a click does: the hint goes into the row being typed, which is added only when Add is pressed.
    const draft = { ...emptyDraft(), name: hints.names[0] };
    expect(table.rows).toEqual([ASKOSI]);
    expect(table.put(draft).ok).toBe(false);
    expect(table.put({ ...draft, id: "70" }).ok).toBe(true);
    expect(ed.calls).toHaveLength(1);
  });

  it("are asked only while the editor draws from the mod, and a failing call gives none", async () => {
    const away = fakeEditor({ ours: false, candidates: { names: ["Askosi"], letters: [] } });
    expect(await new RaceTable(away.host).hints()).toEqual({ names: [], letters: [] });
    expect(away.asked()).toBe(0);
    const broken = fakeEditor();
    broken.host.gameData.raceCandidates = async () => { throw new Error("no"); };
    expect(await new RaceTable(broken.host).hints()).toEqual({ names: [], letters: [] });
  });
});

describe("mod.json", () => {
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  const manifestOf = (files: { file: string; data: Uint8Array }[]) => files.find((f) => f.file === "mod.json")!.data;
  const reopen = async (files: { file: string; data: Uint8Array }[]) => openPieces(files.map((f) => bytesPiece(`made-text/${f.file}`, f.data)), "made-text");

  it("@scm-js/core 0.13's readManifest keeps a races key it does not know, as written; the plugin reads it by the rule", async () => {
    const raw = { scmjs: 1, name: "made", races: [ASKOSI, { id: 2, name: "Protoss" }] };
    expect((readManifest(JSON.stringify(raw)) as unknown as { races: unknown }).races).toEqual(raw.races);
    const { files } = await textFolder(await ModSession.open(await openPieces(madeFolder(), "made"), { base: null }));
    const withRaces = files.map((f) => (f.file === "mod.json" ? { ...f, data: new TextEncoder().encode(JSON.stringify({ ...JSON.parse(text(f.data)), races: raw.races })) } : f));
    expect((await reopen(withRaces)).races).toEqual([ASKOSI]);
  });

  it("a mod that names no races writes the file it always did, and opens again with none", async () => {
    const s = await ModSession.open(await openPieces(madeFolder(), "made"), { base: null });
    expect(s.source.races).toEqual([]);
    const plain = manifestOf((await textFolder(s)).files);
    expect(text(plain)).not.toContain("races");
    expect(manifestOf((await textFolder(s, undefined, [])).files)).toEqual(plain);
    expect(manifestOf((await textFolder(s, undefined, [{ id: 3, name: "not ours" }])).files)).toEqual(plain);
    // Opened again and saved, twice: the same bytes each time (the first names the folder it came from as its layer).
    const again = await ModSession.open(await reopen((await textFolder(s)).files), { base: null });
    expect(again.source.races).toEqual([]);
    const once = (await textFolder(again)).files;
    expect(text(manifestOf(once))).not.toContain("races");
    const twice = await ModSession.open(await reopen(once), { base: null });
    expect(manifestOf((await textFolder(twice)).files)).toEqual(manifestOf(once));
  });

  it("the table is written as races, last in the file, and comes back when the folder opens again", async () => {
    const s = await ModSession.open(await openPieces(madeFolder(), "made"), { base: null });
    const plain = text(manifestOf((await textFolder(s)).files));
    const { files, manifest } = await textFolder(s, undefined, [{ id: 70, name: "Bloodsummon" }, ASKOSI]);
    expect(manifest.races).toEqual([ASKOSI, { id: 70, name: "Bloodsummon" }]);
    const written = text(manifestOf(files));
    expect(Object.keys(JSON.parse(written)).pop()).toBe("races");
    expect(JSON.parse(written)).toEqual({ ...JSON.parse(plain), races: [ASKOSI, { id: 70, name: "Bloodsummon" }] });
    const again = await ModSession.open(await reopen(files), { base: null });
    expect(again.source.races).toEqual([ASKOSI, { id: 70, name: "Bloodsummon" }]);
    // Saved again with nothing changed: the races carried from what was opened, and the same bytes from then on.
    const once = (await textFolder(again)).files;
    expect(JSON.parse(text(manifestOf(once))).races).toEqual([ASKOSI, { id: 70, name: "Bloodsummon" }]);
    const twice = await ModSession.open(await reopen(once), { base: null });
    expect(manifestOf((await textFolder(twice)).files)).toEqual(manifestOf(once));
    // Every race removed: the file as a mod that never named one writes it.
    const none = JSON.parse(text(manifestOf((await textFolder(twice, undefined, [])).files)));
    expect("races" in none).toBe(false);
    expect(manifestOf((await textFolder(twice, undefined, [])).files)).toEqual(manifestOf((await textFolder(await ModSession.open(await reopen((await textFolder(s)).files), { base: null }))).files));
  });

  it("a folder of the game's files with a mod.json of its own beside them: its races are read with its name", async () => {
    const json = new TextEncoder().encode(JSON.stringify({ name: "Made BW", races: [ASKOSI, { id: 300, name: "far" }] }));
    const source = await openPieces([...madeFolder(), bytesPiece("made/mod.json", json)], "made");
    expect(source.kind).toBe("folder");
    expect(source.name).toBe("Made BW");
    expect(source.races).toEqual([ASKOSI]);
    // (No file of the mod's: its hash is the folder's without it.)
    const without = await ModSession.open(await openPieces(madeFolder(), "made"), { base: null });
    expect(await (await ModSession.open(source, { base: null })).hash()).toBe(await without.hash());
  });
});

describe("the play page's hand-over", () => {
  it("carries the races the mod adds beside its name, and none when there are none", () => {
    const files = [{ path: "arr/units.dat", bytes: new Uint8Array([1]) }];
    const named = playMessage({ name: "Made", hash: "0123456789abcdef", files, races: [ASKOSI] }) as { dataSet: { races?: DataSetRace[] } };
    expect(named.dataSet.races).toEqual([ASKOSI]);
    const plain = playMessage({ name: "Made", hash: "0123456789abcdef", files, races: [] }) as { dataSet: Record<string, unknown> };
    expect("races" in plain.dataSet).toBe(false);
  });
});
