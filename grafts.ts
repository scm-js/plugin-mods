/**
 * Requirements and buttons as forms (part d): the mod's `datreq\*.graft` files — GPTP's grafting, the successor of a
 * Firegraft `.fgp` — read and written through `@scm-js/core`'s graft codecs, and shaped for a person: a unit's button
 * set as rows (place, icon, condition and action by name, their parameters, the lit and greyed tips), a requirement
 * list as lines in words. No DOM: the tests drive it in Node.
 *
 * The conditions and actions are the game's own routines, which a graft names by their place in the two lists GPTP
 * and Firegraft share (`hooks/grafting/grafting.cpp`): the 67 conditions and 60 actions below, in that order, with
 * Firegraft's names and what each one's parameter is. The requirement opcodes are the game's (its evaluator 0x46D610);
 * their names are labels for reading a list — the game evaluates it, the editor never does.
 */
import { decodeButtonGraft, decodeReqGraft, encodeButtonGraft, encodeReqGraft, type ButtonGraft, type GraftButton, type ReqGraft } from "@scm-js/core";

/** What a routine's parameter names: a unit type, an upgrade, a technology, a button set, or nothing. */
export type ParamKind = "none" | "unit" | "upgrade" | "tech" | "set";

export interface Routine { name: string; param: ParamKind }
const r = (name: string, param: ParamKind = "none"): Routine => ({ name, param });

/** The 67 conditions, in the order a graft names them by. */
export const CONDITIONS: readonly Routine[] = [
  r("Slow Down Replay"), r("Speed Up Replay"), r("Play/Pause Replay"), r("Always"), r("Can Create Unit/Building", "unit"), r("Can Build Subunit", "unit"),
  r("Mixed Group Move/Patrol/Hold Position"), r("Mixed Group Stop"), r("Unit Has A Weapon"), r("Attacking Building"), r("Cancel Last"), r("Cancel Add-On"),
  r("Larva Exists (Upgrading Only)"), r("Rally Point"), r("Rally Point (While Upgrading Only)"), r("Construction/Mutation Underway"), r("Upgrade Underway"), r("Research Underway"),
  r("Unit Is Carrying Nothing (Gather, Probe)"), r("Unit Is Carrying Something (Return Cargo, Probe)"), r("Unit Capacity Has Not Been Met"), r("Carrying Some Units"),
  r("Tech/Spell Not Researched", "tech"), r("Spell Researched", "tech"), r("Has Spidermine and Is Researched"), r("Upgrade Not At Max Level", "upgrade"),
  r("Can Cloak"), r("Can Decloak"), r("Can Cloak (Mixed)"), r("Can Decloak (Mixed)"), r("Tank Is In Tank Mode"), r("Tank Is In Siege Mode"), r("Tank Is In Tank Mode (Move)"),
  r("Nuke Available"), r("Recharge Shields"), r("Building Can Move And Has Lifted Off"), r("Building Has Lifted Off"), r("Building Has Landed"),
  r("Ability Is Researched", "tech"), r("Is Using Ability", "tech"), r("Morph To Lurker"), r("Not Burrowed (Move/Stop/Patrol/Hold Position)"), r("Not Burrowed (Attack)"),
  r("Has No Cargo (Gather, Drone)"), r("Has Cargo (Return Cargo, Drone)"), r("Burrowed (Stop, Lurker)"), r("Has No Exit"), r("Zerg Basic Buildings"), r("Zerg Advanced Buildings"),
  r("Has Interceptors"), r("Has Scarabs"), r("Two Units Selected and Not Researched (Archon Merge)"), r("Two Units Selected (Archon Warp)"),
  r("Two Units Selected and Not Researched (Dark Archon Meld)"), r("Two Units Selected (Dark Archon Meld)"), r("Protoss Basic Buildings"), r("Protoss Advanced Buildings"),
  r("Is Constructing (Halt, SCV)"), r("Move (SCV)"), r("Stop (SCV)"), r("Attack (SCV)"), r("Repair (SCV)"), r("Gather (SCV)"), r("Return Cargo (SCV)"),
  r("Terran Basic Buildings"), r("Terran Advanced Buildings"), r("Nuke Train"),
];

/** The 60 actions, in the order a graft names them by. */
export const ACTIONS: readonly Routine[] = [
  r("Cancel Infestation"), r("Rally Point"), r("Select Larva"), r("Create Unit", "unit"), r("Cancel Last"), r("Tank Mode"), r("Siege Mode"), r("Cancel Construction"),
  r("Cancel Morph"), r("Move"), r("Stop"), r("Attack"), r("Attack (Suicide)"), r("Attack (Building)"), r("Move (Carrier or Reaver)"), r("Stop (Carrier)"), r("Stop (Reaver)"),
  r("Attack (Carrier)"), r("Attack (Reaver)"), r("Build Subunit", "unit"), r("Patrol"), r("Hold Position"), r("Research Technology", "tech"), r("Cancel Technology Research"),
  r("Use Technology", "tech"), r("Stim Pack"), r("Research Upgrade", "upgrade"), r("Cancel Upgrade Research"), r("Cancel Add-On"), r("Create Building (Terran)", "unit"),
  r("Place COP", "unit"), r("Create Building (Protoss)", "unit"), r("Create Add-On", "unit"), r("Create Building (Zerg)", "unit"), r("Place Nydus Canal Exit"),
  r("Building Morph", "unit"), r("Land"), r("Repair"), r("Unit Morph", "unit"), r("Gather"), r("Return Cargo"), r("Burrow"), r("Unburrow"), r("Cloak"), r("Decloak"),
  r("Lift Off"), r("Load"), r("Unload"), r("Archon Warp"), r("Dark Archon Meld"), r("Recharge Shields"), r("Nuclear Strike"), r("Cancel Nuclear Strike"), r("Heal"),
  r("Slow Down Replay"), r("Play/Pause Replay"), r("Speed Up Replay"), r("Cancel"), r("Cancel Place Building"), r("Change Displayed Buttons", "set"),
];

/** The requirement opcodes, by word: their names, and the ones that read the next word as a unit type. */
export const OPCODES: Readonly<Record<number, { name: string; takes?: true }>> = {
  0xff01: { name: "or" }, 0xff02: { name: "current unit is", takes: true }, 0xff03: { name: "must have (complete or not)", takes: true }, 0xff04: { name: "must have add-on", takes: true },
  0xff05: { name: "is not lifted off" }, 0xff06: { name: "is lifted off" }, 0xff07: { name: "is not training or morphing" }, 0xff08: { name: "is not constructing an add-on" },
  0xff09: { name: "is not researching" }, 0xff0a: { name: "is not upgrading" }, 0xff0b: { name: "is not constructing" }, 0xff0c: { name: "does not have an add-on" },
  0xff0d: { name: "does not have a nydus exit" }, 0xff0e: { name: "has a hangar for interceptors" }, 0xff0f: { name: "tech researched" }, 0xff10: { name: "has no nuke" },
  0xff11: { name: "is not burrowed" }, 0xff12: { name: "is not lifted off (or)" }, 0xff13: { name: "is lifted off (or)" }, 0xff14: { name: "can move" }, 0xff15: { name: "can attack" },
  0xff16: { name: "is a worker" }, 0xff17: { name: "can lift off" }, 0xff18: { name: "is a transport" }, 0xff19: { name: "is powerup" }, 0xff1a: { name: "is a subunit" },
  0xff1b: { name: "has spider mines" }, 0xff1c: { name: "is a hero" }, 0xff1d: { name: "can rally or right-click" }, 0xff1e: { name: "allowed on hallucinations" },
  0xff1f: { name: "by level — level 1:" }, 0xff20: { name: "level 2:" }, 0xff21: { name: "level 3:" }, 0xff22: { name: "disabled (Brood War only)" }, 0xff23: { name: "blank (never)" },
  0xff24: { name: "Brood War only" }, 0xff25: { name: "unused 0xFF25" }, 0xff26: { name: "is burrowed" },
};

/** The five requirement grafts, by member, and what their ids are. */
export const REQUIREMENT_GRAFTS = [
  { member: "datreq\\units.graft", kind: "units", ids: "units" },
  { member: "datreq\\upgrades.graft", kind: "upgrades", ids: "upgrades" },
  { member: "datreq\\research.graft", kind: "research", ids: "techdata" },
  { member: "datreq\\tech.graft", kind: "tech", ids: "techdata" },
  { member: "datreq\\orders.graft", kind: "orders", ids: "orders" },
] as const;
export const BUTTONS_GRAFT = "datreq\\buttons.graft";
export const GRAFT_MEMBERS: readonly string[] = [BUTTONS_GRAFT, ...REQUIREMENT_GRAFTS.map((g) => g.member)];

export class GraftError extends Error {}

/* ── Buttons ── */

/** A button as a row of the form: the codec's button, conditions and actions by their place in the lists above. */
export type ButtonRow = GraftButton;

/**
 * A `buttons.graft` to edit: a unit's set as rows. Units may share one run of buttons (the graft says a unit's set by
 * where its buttons start and how many): the first edit of such a unit gives it a run of its own at the end, so the
 * others keep theirs. A file nobody edited encodes back to the same bytes.
 */
export class ButtonsDoc {
  graft: ButtonGraft;
  constructor(graft: ButtonGraft) { this.graft = graft; }
  static decode(bytes: Uint8Array): ButtonsDoc { return new ButtonsDoc(decodeButtonGraft(bytes)); }
  encode(): Uint8Array { return encodeButtonGraft(this.graft); }

  /** How many units (button sets) the graft has. */
  get units(): number { return this.graft.sets.length; }

  /** A unit's buttons, in order (copies: change them through the methods). */
  rows(unit: number): ButtonRow[] {
    const s = this.graft.sets[unit];
    return s && s.count ? this.graft.buttons.slice(s.first, s.first + s.count).map((b) => ({ ...b })) : [];
  }

  /** The unit whose set this one's buttons also are, or null. */
  sharedWith(unit: number): number[] {
    const s = this.graft.sets[unit];
    if (!s?.count) return [];
    return this.graft.sets.flatMap((o, u) => (u !== unit && o.count && o.first < s.first + s.count && s.first < o.first + o.count ? [u] : []));
  }

  /** A unit's buttons replaced by `rows`: in place when it owns its run and the count is the same, else in a new run at the end. */
  setRows(unit: number, rows: readonly ButtonRow[]) {
    for (const [i, b] of rows.entries()) checkRow(b, i);
    while (this.graft.sets.length <= unit) this.graft.sets.push({ count: 0, first: 0, connected: 0xffff });
    const s = this.graft.sets[unit];
    if (s.count === rows.length && s.count && !this.sharedWith(unit).length) {
      rows.forEach((b, i) => { this.graft.buttons[s.first + i] = { ...b }; });
      return;
    }
    s.first = rows.length ? this.graft.buttons.length : 0;
    s.count = rows.length;
    this.graft.buttons.push(...rows.map((b) => ({ ...b })));
  }

  /** One field of one button. */
  setButton(unit: number, index: number, change: Partial<ButtonRow>) {
    const rows = this.rows(unit);
    if (!rows[index]) throw new GraftError(`unit ${unit} has no button ${index + 1}`);
    rows[index] = { ...rows[index], ...change };
    this.setRows(unit, change.position !== undefined ? byPosition(rows) : rows);
  }

  /**
   * A button moved to another place on the card (1–9, left to right, top to bottom). The rows are kept in the order of
   * their places, as the game places them: for each place in turn, the next button that shows goes there unless its
   * place is later.
   */
  move(unit: number, index: number, position: number) { this.setButton(unit, index, { position }); }

  add(unit: number, row: ButtonRow) { this.setRows(unit, byPosition([...this.rows(unit), row])); }
  remove(unit: number, index: number) { const rows = this.rows(unit); rows.splice(index, 1); this.setRows(unit, rows); }
}

const byPosition = (rows: ButtonRow[]) => rows.map((b, i) => ({ b, i })).sort((x, y) => x.b.position - y.b.position || x.i - y.i).map((x) => x.b);

function checkRow(b: ButtonRow, i: number) {
  const u16 = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xffff;
  if (!Number.isInteger(b.position) || b.position < 1 || b.position > 9) throw new GraftError(`button ${i + 1}: a place is 1 to 9`);
  if (!CONDITIONS[b.condition]) throw new GraftError(`button ${i + 1}: no condition ${b.condition}`);
  if (!ACTIONS[b.action]) throw new GraftError(`button ${i + 1}: no action ${b.action}`);
  for (const k of ["icon", "conditionParam", "actionParam", "enabledString", "disabledString"] as const) if (!u16(b[k])) throw new GraftError(`button ${i + 1}: ${k} is a whole number from 0 to 65535`);
}

/* ── Requirements ── */

/** Names a unit type for a line ("Terran Barracks"), "" when it has none. */
export type UnitName = (type: number) => string;

const hex = (w: number) => `0x${w.toString(16).toUpperCase().padStart(4, "0")}`;
const unitText = (names: UnitName, type: number) => { const n = names(type); return n ? `${n} (${type})` : `(${type})`; };

/**
 * A requirement entry's words as lines: a unit type the player must own completed ("owns Terran Academy (112)"), an
 * opcode by name with its unit after it ("current unit is Terran Barracks (111)"), "end" for a level section's close.
 * The entry's own closing word is left out (the lines are what is between).
 */
export function requirementLines(words: readonly number[], names: UnitName): string[] {
  const body = words[words.length - 1] === 0xffff ? words.slice(0, -1) : words.slice();
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const w = body[i], op = OPCODES[w];
    if (w === 0xffff) out.push("end");
    else if (w < 0xff00) out.push(`owns ${unitText(names, w)}`);
    else if (!op) out.push(hex(w));
    else if (op.takes && i + 1 < body.length) out.push(`${op.name} ${unitText(names, body[++i])}`);
    else out.push(op.name);
  }
  return out;
}

const OPCODE_NAMES = Object.entries(OPCODES).map(([w, o]) => ({ word: Number(w), ...o })).sort((a, b) => b.name.length - a.name.length);

/**
 * Lines back to the entry's words, the closing 0xFFFF added. A unit is named by its number in brackets, by its name,
 * or by a bare number; an opcode by its name or as a hex word. Throws with the line's number on what it cannot read.
 */
export function requirementWords(text: string, unitByName: (name: string) => number | null): number[] {
  const words: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const n = i + 1;
    const unit = (rest: string): number => {
      const bracket = /\((\d+)\)\s*$/.exec(rest);
      if (bracket) return Number(bracket[1]);
      if (/^\d+$/.test(rest.trim())) return Number(rest.trim());
      const byName = unitByName(rest.trim());
      if (byName === null) throw new GraftError(`line ${n}: "${rest.trim()}" names no unit`);
      return byName;
    };
    const lower = line.toLowerCase();
    if (lower === "end") { words.push(0xffff); return; }
    if (/^0x[0-9a-f]{1,4}$/i.test(line)) { words.push(parseInt(line, 16)); return; }
    if (lower.startsWith("owns ")) { words.push(unit(line.slice(5))); return; }
    const op = OPCODE_NAMES.find((o) => lower === o.name.toLowerCase() || (o.takes && lower.startsWith(o.name.toLowerCase() + " ")));
    if (!op) throw new GraftError(`line ${n}: "${line}" is no requirement`);
    words.push(op.word);
    if (op.takes) words.push(unit(line.slice(op.name.length)));
  });
  for (const w of words) if (w < 0 || w > 0xffff) throw new GraftError(`${w} is not a 16-bit word`);
  return [...words, 0xffff];
}

/** A requirement graft to edit: its entries by id, as lines. */
export class RequirementsDoc {
  graft: ReqGraft;
  constructor(graft: ReqGraft) { this.graft = graft; }
  static decode(bytes: Uint8Array): RequirementsDoc { return new RequirementsDoc(decodeReqGraft(bytes)); }
  encode(): Uint8Array { return encodeReqGraft(this.graft); }
  ids(): number[] { return this.graft.entries.map((e) => e.id); }
  words(id: number): number[] | null { return this.graft.entries.find((e) => e.id === id)?.words.slice() ?? null; }
  lines(id: number, names: UnitName): string[] { const w = this.words(id); return w ? requirementLines(w, names) : []; }
  /** An entry's words from lines; an id with none gets an entry at the end. Empty text removes the entry. */
  setLines(id: number, text: string, unitByName: (name: string) => number | null) {
    const i = this.graft.entries.findIndex((e) => e.id === id);
    if (!text.trim()) { if (i >= 0) this.graft.entries.splice(i, 1); return; }
    const words = requirementWords(text, unitByName);
    if (i >= 0) this.graft.entries[i].words = words;
    else this.graft.entries.push({ id, words });
  }
}
