import { describe, expect, it } from "vitest";
import { buttonGraftFromText, buttonGraftToText, decodeButtonGraft, encodeButtonGraft, encodeReqGraft, reqGraftFromText, reqGraftToText, type ButtonGraft } from "@scm-js/core";
import { ACTIONS, ButtonsDoc, CONDITIONS, RequirementsDoc, requirementLines, requirementWords } from "../grafts";
import { openPieces } from "../source";
import { ModSession } from "../session";
import { bytesPiece, equal, madeFolder } from "./support";

const cond = (name: string) => CONDITIONS.findIndex((c) => c.name === name);
const act = (name: string) => ACTIONS.findIndex((a) => a.name === name);
const button = (position: number, icon: number, condition: string, action: string, enabledString: number, disabledString = 0, conditionParam = 0, actionParam = 0) =>
  ({ position, icon, condition: cond(condition), action: act(action), conditionParam, actionParam, enabledString, disabledString });

/** A made buttons.graft: a marine's set (move, stop, attack, patrol, hold, stim at 7), shared with unit 1; unit 2 none. */
function madeButtons(): ButtonGraft {
  const marine = [
    button(1, 228, "Always", "Move", 664), button(2, 229, "Always", "Stop", 665), button(3, 230, "Unit Has A Weapon", "Attack", 666),
    button(4, 254, "Always", "Patrol", 667), button(5, 255, "Always", "Hold Position", 668), button(7, 237, "Ability Is Researched", "Stim Pack", 334, 346, 0),
  ];
  return { buttons: marine, sets: [{ count: 6, first: 0, connected: 0xffff }, { count: 6, first: 0, connected: 0xffff }, { count: 0, first: 0, connected: 0xffff }], status: [[0, 1, 0], [1, 1, 0], [2, 1, 0]] };
}

describe("the lists a graft names routines by", () => {
  it("has GPTP's 67 conditions and 60 actions, each with what its parameter is", () => {
    expect(CONDITIONS).toHaveLength(67);
    expect(ACTIONS).toHaveLength(60);
    expect(CONDITIONS[4]).toEqual({ name: "Can Create Unit/Building", param: "unit" });
    expect(ACTIONS[59]).toEqual({ name: "Change Displayed Buttons", param: "set" });
    expect(ACTIONS[26]).toEqual({ name: "Research Upgrade", param: "upgrade" });
  });
});

describe("buttons as rows, over core's codec", () => {
  it("a file nobody edits encodes back byte for byte, and through graftc's text too", () => {
    const bytes = encodeButtonGraft(madeButtons());
    const doc = ButtonsDoc.decode(bytes);
    expect(equal(doc.encode(), bytes)).toBe(true);
    expect(equal(encodeButtonGraft(buttonGraftFromText(buttonGraftToText(decodeButtonGraft(bytes)))), bytes)).toBe(true);
    expect(doc.rows(0).map((b) => `${b.position} ${ACTIONS[b.action].name}`)).toEqual(["1 Move", "2 Stop", "3 Attack", "4 Patrol", "5 Hold Position", "7 Stim Pack"]);
    expect(doc.sharedWith(0)).toEqual([1]);
    expect(doc.rows(2)).toEqual([]);
  });

  it("a moved button: its place changes, the rows stay in the order of their places, and a shared set is copied first", () => {
    const doc = ButtonsDoc.decode(encodeButtonGraft(madeButtons()));
    doc.move(0, 5, 9);
    expect(doc.rows(0).map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 9]);
    // Unit 1 keeps the set as it was; unit 0 has a run of its own at the end.
    expect(doc.rows(1).map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(doc.graft.sets[0]).toEqual({ count: 6, first: 6, connected: 0xffff });
    // Moved to the front: it is placed first.
    doc.move(0, 5, 1);
    expect(doc.rows(0).map((b) => `${b.position} ${ACTIONS[b.action].name}`)[1]).toBe("1 Stim Pack");
    // Round trip of the edited file.
    const again = ButtonsDoc.decode(doc.encode());
    expect(again.rows(0)).toEqual(doc.rows(0));
  });

  it("checks what a row may hold, and adds and removes buttons", () => {
    const doc = ButtonsDoc.decode(encodeButtonGraft(madeButtons()));
    expect(() => doc.setButton(0, 0, { position: 10 })).toThrow(/1 to 9/);
    expect(() => doc.setButton(0, 0, { action: 60 })).toThrow(/no action 60/);
    doc.add(2, button(1, 0, "Always", "Stop", 665));
    expect(doc.rows(2).map((b) => ACTIONS[b.action].name)).toEqual(["Stop"]);
    doc.remove(0, 0);
    expect(doc.rows(0)).toHaveLength(5);
    expect(doc.rows(1)).toHaveLength(6);
  });
});

describe("requirements as lines", () => {
  const names = (t: number) => ({ 111: "Terran Barracks", 112: "Terran Academy", 107: "Comsat Station" } as Record<number, string>)[t] ?? "";
  const byName = (n: string) => ({ "terran barracks": 111, "terran academy": 112 } as Record<string, number>)[n.toLowerCase()] ?? null;

  it("words to lines and back, an upgrade's levels included", () => {
    const firebat = [0xff02, 111, 0xff03, 112, 0xff07, 0xffff];
    expect(requirementLines(firebat, names)).toEqual(["current unit is Terran Barracks (111)", "must have (complete or not) Terran Academy (112)", "is not training or morphing"]);
    expect(requirementWords(requirementLines(firebat, names).join("\n"), byName)).toEqual(firebat);
    const levels = [0xff1f, 0xff02, 111, 0xffff, 0xff20, 112, 0xffff, 0xff21, 0xff01, 0xffff];
    expect(requirementLines(levels, names)).toEqual(["by level — level 1:", "current unit is Terran Barracks (111)", "end", "level 2:", "owns Terran Academy (112)", "end", "level 3:", "or"]);
    expect(requirementWords(requirementLines(levels, names).join("\n"), byName)).toEqual(levels);
  });

  it("an edited line through core's codec: a unit by name, by bracket, by number; a bad line said with its number", () => {
    const graft = reqGraftFromText("#DAT REQ:\n32:\n  0xFF02\n  111\n  0xFF03\n  112\n  0xFFFF\n");
    const bytes = encodeReqGraft(graft), doc = RequirementsDoc.decode(bytes);
    expect(equal(doc.encode(), bytes)).toBe(true);
    expect(doc.lines(32, names)).toEqual(["current unit is Terran Barracks (111)", "must have (complete or not) Terran Academy (112)"]);
    doc.setLines(32, "current unit is terran barracks\nowns (107)\nis not lifted off", byName);
    expect(doc.words(32)).toEqual([0xff02, 111, 107, 0xff05, 0xffff]);
    expect(reqGraftToText(RequirementsDoc.decode(doc.encode()).graft)).toContain("32:\n  0xFF02\n  111\n  107\n  0xFF05\n  0xFFFF");
    expect(() => doc.setLines(32, "current unit is\nfly away", byName)).toThrow(/line 1/);
    expect(() => doc.setLines(32, "owns Terran Barracks\nfly away", byName)).toThrow(/line 2: "fly away" is no requirement/);
    doc.setLines(0, "owns 112", byName);
    expect(doc.ids()).toEqual([32, 0]);
    doc.setLines(0, "", byName);
    expect(doc.ids()).toEqual([32]);
  });
});

describe("a graft in a mod", () => {
  it("edited through the session: the member changes and an edit is said for the live sender", async () => {
    const s = await ModSession.open(await openPieces([...madeFolder(), bytesPiece("made/datreq/buttons.graft", encodeButtonGraft(madeButtons()))], "made"), { base: null });
    const heard: string[] = [];
    s.onEdit((e) => heard.push(e.member));
    const doc = ButtonsDoc.decode((await s.read("datreq\\buttons.graft"))!);
    doc.move(0, 5, 9);
    s.setMember("datreq\\buttons.graft", doc.encode());
    expect(heard).toEqual(["datreq\\buttons.graft"]);
    expect(ButtonsDoc.decode((await s.read("datreq\\buttons.graft"))!).rows(0).map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 9]);
    expect(await s.edited()).toEqual(["datreq\\buttons.graft"]);
  });
});
