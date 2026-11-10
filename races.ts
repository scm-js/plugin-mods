/**
 * The races a mod adds to the game's own. A player's race is a byte: 0–7 are the game's (Zerg, Terran, Protoss, then
 * Independent, Neutral, User Selectable, Random, Inactive), and a mod may give players others. No file of a mod says
 * what they are called (its plugin's code does), so the person names them: a small table that rides beside the data
 * set's name (the editor keeps it with the profile's id, and `mod.json` carries it as `races`), never inside the mod's
 * files, so naming a race leaves the mod's hash as it was.
 *
 * Here: the row's shape and the rule every carrier reads a table by (`normalizeRaces`), a row as typed checked field by
 * field (`checkRow`), and the table the Races tab edits (`RaceTable`) over the editor's `gameData.races`, `setRaces` and
 * `raceCandidates`. Those came after this plugin's API package; an editor from before them has none, so each is looked
 * for before it is called. Pure: no DOM, so the tests run it in Node.
 */
import { msg, t, translate } from "./i18n";

/** A race a data set adds to the game's own (the editor's `DataSetRace`). */
export interface DataSetRace {
  /** The race byte: 8–255. (0–7 are the game's and cannot be declared.) */
  id: number;
  /** What it is called, 40 characters at most, trimmed, not empty. */
  name: string;
  /** The lower-case letter its per-race files go by (`game\<letter>console.pcx`, `rez\statbtn<letter>.bin`), when it has them. */
  letter?: string;
  /** The game's race it plays as, where only the game's three are known: 0, 1 or 2. Absent: not declared. */
  like?: 0 | 1 | 2;
}

/** The first race byte a data set may declare; 0–7 are the game's. */
export const FIRST_RACE = 8;
export const LAST_RACE = 255;
/** The longest name a declared race may have. */
export const RACE_NAME_MAX = 40;

/** The game's own eight races by their byte. */
export const GAME_RACES: readonly string[] = [msg("Zerg"), msg("Terran"), msg("Protoss"), msg("Independent"), msg("Neutral"), msg("User Selectable"), msg("Random"), msg("Inactive")];

/** The letters the game's own per-race files go by (`game\zconsole.pcx` …, `n` the neutral console's), and whose. */
export const GAME_LETTERS: Readonly<Record<string, string>> = { z: msg("Zerg"), t: msg("Terran"), p: msg("Protoss"), n: msg("Neutral") };

/**
 * A table of declared races as every carrier keeps it (the editor's rule): each row's `id` an integer 8–255, its `name`
 * trimmed, not empty and at most 40 characters, `letter` one letter a–z (lower-cased) and `like` 0, 1 or 2 when present
 * and valid (an invalid one is left off the row). A row without a usable id or name is dropped, and so is a later row
 * with an id an earlier one has. Sorted by id. Fields a row has beyond these are kept. Anything that is not an array is
 * an empty table; nothing here throws.
 */
export function normalizeRaces(value: unknown): DataSetRace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: DataSetRace[] = [];
  for (const row of value as unknown[]) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const id = r.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < FIRST_RACE || id > LAST_RACE || seen.has(id)) continue;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || name.length > RACE_NAME_MAX) continue;
    const kept: Record<string, unknown> = { ...r, id, name };
    delete kept.letter;
    delete kept.like;
    const letter = typeof r.letter === "string" && /^[a-z]$/i.test(r.letter.trim()) ? r.letter.trim().toLowerCase() : undefined;
    if (letter) kept.letter = letter;
    if (r.like === 0 || r.like === 1 || r.like === 2) kept.like = r.like;
    seen.add(id);
    out.push(kept as unknown as DataSetRace);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Whether two tables say the same: the same ids, names, letters and `like`s, in order. */
export function sameRaces(a: readonly DataSetRace[], b: readonly DataSetRace[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i].id && r.name === b[i].name && r.letter === b[i].letter && r.like === b[i].like);
}

/* ── A row as typed ───────────────────────────────────────────────────── */

/** The form's fields as typed: `like` is "" (not said), "0", "1" or "2". */
export interface RaceDraft { id: string; name: string; letter: string; like: string }

export type RaceField = "id" | "name" | "letter";

export const emptyDraft = (): RaceDraft => ({ id: "", name: "", letter: "", like: "" });

export const draftOf = (r: DataSetRace): RaceDraft => ({ id: String(r.id), name: r.name, letter: r.letter ?? "", like: r.like === undefined ? "" : String(r.like) });

/**
 * A row as typed, checked against the table: `editing` is the id of the row it replaces (null for a new row). Each
 * field that cannot be taken has its reason, in plain words; with none the row is given, its fields beyond the four kept
 * from the row it replaces. A letter of the game's own (z, t, p, n) is refused for a new row, and for a row whose letter
 * changes to one; a row that came with one keeps it.
 */
export function checkRow(draft: RaceDraft, rows: readonly DataSetRace[], editing: number | null): { row: DataSetRace | null; errors: Partial<Record<RaceField, string>> } {
  const errors: Partial<Record<RaceField, string>> = {};
  const was = editing === null ? null : rows.find((r) => r.id === editing) ?? null;
  const idText = draft.id.trim();
  const id = /^\d+$/.test(idText) ? Number(idText) : NaN;
  if (!idText) errors.id = t("Give the race's number, from 8 to 255.");
  else if (!Number.isInteger(id)) errors.id = t("The number is a whole number from 8 to 255.");
  else if (id < FIRST_RACE) errors.id = t("{n} is the game's own race, {race}. A mod's races are numbered 8 to 255.", { n: id, race: translate(GAME_RACES[id]) });
  else if (id > LAST_RACE) errors.id = t("A race's number is 255 at most.");
  else {
    const other = rows.find((r) => r.id === id && r.id !== editing);
    if (other) errors.id = t("Race {n} is already in the table, as {name}.", { n: id, name: other.name });
  }
  const name = draft.name.trim();
  if (!name) errors.name = t("Give the race a name.");
  else if (name.length > RACE_NAME_MAX) errors.name = t("A name is 40 characters at most; this one has {n}.", { n: name.length });
  const letter = draft.letter.trim().toLowerCase();
  if (letter && !/^[a-z]$/.test(letter)) errors.letter = t("The letter is one letter from a to z, or none.");
  else if (letter && GAME_LETTERS[letter] && letter !== was?.letter) errors.letter = t("{letter} is the letter of the game's own files for {race}.", { letter, race: translate(GAME_LETTERS[letter]) });
  if (Object.keys(errors).length) return { row: null, errors };
  const row: Record<string, unknown> = { ...(was ?? {}), id, name };
  delete row.letter;
  delete row.like;
  if (letter) row.letter = letter;
  if (draft.like === "0" || draft.like === "1" || draft.like === "2") row.like = Number(draft.like);
  return { row: row as unknown as DataSetRace, errors };
}

/* ── The table, kept by the editor ────────────────────────────────────── */

/** What the Races tab needs of `api.gameData`: each absent in an editor from before races a data set adds. */
export interface RacesApi {
  races?: () => DataSetRace[];
  setRaces?: (races: readonly DataSetRace[], id?: string) => unknown;
  raceCandidates?: () => Promise<{ names: string[]; letters: string[] }>;
}

export interface RaceTableHost {
  /** `api.gameData`, read as the calls it may have. */
  gameData: RacesApi;
  /** The id of the profile the mod is attached under (null before it is). */
  profileId(): string | null;
  /** Whether the editor draws from this mod now: `races()` and `raceCandidates()` speak of the set in use. */
  ours(): boolean;
}

/**
 * The races of the open mod. It starts from what the mod brought (`mod.json`'s `races`); once the editor draws from
 * the mod, `load` takes the editor's table for it (what was handed in, or what the editor kept for the id before).
 * Every change is handed to the editor with `setRaces(rows, id)`, and is what Save writes into `mod.json`. In an editor
 * that cannot keep races (`canKeep` false) the table is only shown, and carried into `mod.json` as it came.
 */
export class RaceTable {
  private host: RaceTableHost;
  rows: DataSetRace[];

  constructor(host: RaceTableHost, initial: unknown = []) {
    this.host = host;
    this.rows = normalizeRaces(initial);
  }

  /** Whether the editor keeps race names (an editor from before them cannot). */
  get canKeep(): boolean {
    return typeof this.host.gameData.setRaces === "function";
  }

  /** Whether the editor can suggest names and letters from the mod's files, now. */
  get canHint(): boolean {
    return typeof this.host.gameData.raceCandidates === "function" && this.host.ours();
  }

  /** Takes the editor's table for the mod, when it draws from the mod. Whether anything changed. */
  load(): boolean {
    const g = this.host.gameData;
    if (typeof g.races !== "function" || !this.host.ours()) return false;
    const next = normalizeRaces(g.races());
    if (sameRaces(next, this.rows)) return false;
    this.rows = next;
    return true;
  }

  /** Adds a row, or replaces the row `editing`; refused (with the reasons) as `checkRow` says. */
  put(draft: RaceDraft, editing: number | null = null): { ok: boolean; errors: Partial<Record<RaceField, string>> } {
    if (!this.canKeep) return { ok: false, errors: {} };
    const { row, errors } = checkRow(draft, this.rows, editing);
    if (!row) return { ok: false, errors };
    this.keep([...this.rows.filter((r) => r.id !== editing), row]);
    return { ok: true, errors };
  }

  remove(id: number): boolean {
    if (!this.canKeep || !this.rows.some((r) => r.id === id)) return false;
    this.keep(this.rows.filter((r) => r.id !== id));
    return true;
  }

  /** The editor's suggestions, for a person to choose from; empty when it gives none. Never written into a row here. */
  async hints(): Promise<{ names: string[]; letters: string[] }> {
    const g = this.host.gameData;
    if (!this.canHint) return { names: [], letters: [] };
    try {
      const got = await g.raceCandidates!();
      const taken = new Set(this.rows.map((r) => r.name.toLowerCase())), letters = new Set(this.rows.map((r) => r.letter));
      return {
        names: [...new Set((got?.names ?? []).filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim()))].filter((n) => !taken.has(n.toLowerCase())),
        letters: (got?.letters ?? []).filter((l) => typeof l === "string" && /^[a-z]$/.test(l) && !GAME_LETTERS[l] && !letters.has(l)),
      };
    } catch {
      return { names: [], letters: [] };
    }
  }

  private keep(rows: DataSetRace[]) {
    this.rows = normalizeRaces(rows);
    const id = this.host.profileId();
    if (id) this.host.gameData.setRaces?.(this.rows, id);
  }
}

/**
 * A refusal of the row as typed, said in the panel's status line when Add is pressed. Once the row changes it is about
 * a row that is no longer there, so `changed` takes it back: `unsay(text)` clears the status line if it still says it
 * (and leaves it when something else was said since).
 */
export class Refusal {
  private said: string | null = null;
  private readonly say: (text: string) => void;
  private readonly unsay: (text: string) => void;

  constructor(say: (text: string) => void, unsay: (text: string) => void) {
    this.say = say;
    this.unsay = unsay;
  }

  refuse(text: string) {
    this.said = text;
    this.say(text);
  }

  /** The row changed (a field typed in, a hint taken, Cancel, another row chosen, a row kept). */
  changed() {
    if (this.said === null) return;
    const text = this.said;
    this.said = null;
    this.unsay(text);
  }
}

/** `api.gameData` as the calls the Races tab may find on it. */
export const racesApi = (gameData: object): RacesApi => gameData as RacesApi;
