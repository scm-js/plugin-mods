/**
 * An open mod: its files as they came, what the person changed, and everything read from them — the tables (decoded
 * once, edited in place), the string tables, the scripts as text. A file's current bytes are its own when untouched
 * and its edit encoded back through the codecs otherwise, so a table nobody touched leaves byte for byte as it came.
 * No DOM: the tests drive it in Node, and the panel only draws it.
 */
import {
  DAT_SCHEMAS, DAT_TABLES, aiNames, decodeLoFile, encodeLoFile, loFromText, loToText, aiscriptFromText, aiscriptToText, checkMod, datTableOf, decodeDat, decodeTblFile, diffMods, encodeDat, encodeTblFile,
  entryText, fieldType, gameName, iscriptFromText, iscriptToText, loadModData, namesOf, placeOf, readIscriptHeaders, storedRange,
  type AiNames, type DatField, type DatFile, type DatTableName, type DiffSide, type ModChange, type ModData, type ModFinding, type TblFile,
} from "@scm-js/core";
import { identityWith, sha256Hex } from "@scm-js/mod";
import { msg, translate, type Params } from "./i18n";
import { RefIndex } from "./refs";
import type { ModSource } from "./source";

/** A file by the game's name, or null. */
export type ReadMember = (member: string) => Promise<Uint8Array | null>;

export interface SessionOptions {
  /** The game's own files, by member name; null when there is no copy to read. */
  base: ReadMember | null;
  /**
   * Whether the game has a file, without reading it where that can be answered from a list; null when the copy
   * cannot say (a folder it does not keep, such as sounds).
   */
  baseHas?: (member: string) => Promise<boolean | null>;
}

const STRING_KEYS: Record<string, keyof ModData["strings"]> = {
  "rez\\stat_txt.tbl": "stat", "rez\\unitnames.tbl": "unitnames", "arr\\images.tbl": "images", "arr\\sfxdata.tbl": "sfxdata", "arr\\portdata.tbl": "portdata", "arr\\mapdata.tbl": "mapdata",
};

export interface ScriptDoc {
  /** `iscript:<member>`, `ai`, or `overlay:<member>`. */
  id: string;
  kind: "iscript" | "ai" | "overlay";
  /** Its file in a mod folder (`iscript/iscript_terran.txt`, `ai/aiscript.txt`). */
  label: string;
  /** The members it is: one iscript, or aiscript.bin (and bwscript.bin). */
  members: string[];
  /** True when the mod does not have it and the game's is shown. */
  fromGame: boolean;
}

export interface ScriptState {
  text: string | null;
  /** Why the text could not be made (an unreadable binary). */
  unreadable: string | null;
  /** The text as last assembled: the line the codec named, and what it said. */
  error: { line: number; message: string } | null;
  /** The names the AI text was written with, so it reads back the same. */
  names?: AiNames;
}

/** Why an edit was refused: a template, and the values it is filled with. */
export interface Refusal { text: string; params?: Params }

export interface FieldEdit { table: DatTableName; id: number; field: string; part?: string; value: number }

/** One edit, as a running test game takes it (`live.ts`): the member it changed, and the field when it was one. */
export interface EditEvent { member: string; field?: FieldEdit }

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const MAX = { u8: 0xff, u16: 0xffff, u32: 0xffffffff } as const;

export class ModSession {
  readonly source: ModSource;
  readonly base: ReadMember | null;
  private readonly baseHas: SessionOptions["baseHas"];
  /** Each table, string table and script as it is now. */
  data!: ModData;
  refs!: RefIndex;
  private readonly dirtyTables = new Set<DatTableName>();
  /** Each edited table as it came (or the game's, for one the mod took over), copied before its first edit. */
  private readonly pristine: Partial<Record<DatTableName, DatFile>> = {};
  private readonly tbl = new Map<string, TblFile>();
  private readonly dirtyStrings = new Set<string>();
  /** Members the mod did not have that an edit gave it, by key → name. */
  private readonly added = new Map<string, string>();
  /** Members whose bytes are an edit's (an assembled script, an encoded table or string table), by key. */
  private readonly overrides = new Map<string, Uint8Array>();
  private readonly scriptStates = new Map<string, ScriptState>();
  scripts: ScriptDoc[] = [];
  /** Bumped on every change; a view redraws when it moved. */
  revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly editListeners = new Set<(e: EditEvent) => void>();
  private opened: ModData | null = null;
  /** Each edited member's SHA-256, until it changes again. */
  private readonly digests = new Map<string, string>();
  /** Whether a member is byte for byte the game's, once asked. */
  private readonly baseSame = new Map<string, boolean>();

  private constructor(source: ModSource, options: SessionOptions) {
    this.source = source;
    this.base = options.base;
    this.baseHas = options.baseHas;
  }

  static async open(source: ModSource, options: SessionOptions): Promise<ModSession> {
    const s = new ModSession(source, options);
    s.data = await loadModData((n) => s.original(n), s.base, s.modTables(), s.iscriptMembers());
    s.refs = new RefIndex(s.data.tables);
    s.scripts = await s.findScripts();
    return s;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called after each edit with what it changed (a field, or a member's bytes). */
  onEdit(listener: (e: EditEvent) => void): () => void {
    this.editListeners.add(listener);
    return () => this.editListeners.delete(listener);
  }

  private edit(e: EditEvent) {
    for (const l of this.editListeners) l(e);
  }

  private changed(kind: "table" | "strings" | "script" | "file") {
    this.revision++;
    if (kind === "table" || kind === "strings") this.data.names = namesOf(this.data.tables, this.data.strings);
    if (kind === "table") this.refs = new RefIndex(this.data.tables);
    for (const l of this.listeners) l();
  }

  /* ── Files ── */

  /** Every member the mod has now, by key (lower case, backslashes), in name order. */
  members(): string[] {
    return [...new Set([...this.source.files.keys(), ...this.added.keys()])].sort();
  }

  has(member: string): boolean {
    const k = gameName(member);
    return this.source.files.has(k) || this.added.has(k);
  }

  /** A member's name as the mod spells it. */
  nameOf(member: string): string {
    const k = gameName(member);
    return this.source.files.get(k)?.name ?? this.added.get(k) ?? member;
  }

  /** A member as it came. */
  async original(member: string): Promise<Uint8Array | null> {
    const f = this.source.files.get(gameName(member));
    return f ? f.read() : null;
  }

  /** A member as it is now: an edit encoded back, else as it came. */
  async read(member: string): Promise<Uint8Array | null> {
    const k = gameName(member);
    const table = this.tableAt(k);
    if (table && this.dirtyTables.has(table)) {
      let bytes = this.overrides.get(k);
      if (!bytes) { bytes = encodeDat(this.data.tables[table]!); this.overrides.set(k, bytes); }
      return bytes;
    }
    if (this.dirtyStrings.has(k)) {
      let bytes = this.overrides.get(k);
      if (!bytes) { bytes = encodeTblFile(this.tbl.get(k)!); this.overrides.set(k, bytes); }
      return bytes;
    }
    return this.overrides.get(k) ?? (this.source.files.has(k) ? this.original(k) : null);
  }

  /** A member as the game would read it: the mod's now, else the game's. */
  async readOver(member: string): Promise<Uint8Array | null> {
    return (await this.read(member)) ?? (this.base ? this.base(member) : null);
  }

  /** The members whose bytes differ from what came (an edit put back the way it was is not one). */
  async edited(): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.touchedMembers()) {
      const now = await this.read(k), was = await this.original(k);
      if (!now) continue;
      if (!was || !equal(now, was)) out.push(k);
    }
    return out;
  }

  /** The members an edit has touched (their bytes may be what came, an edit put back), by key, in name order. */
  private touchedMembers(): string[] {
    return [...new Set([...this.overrides.keys(), ...this.added.keys(), ...[...this.dirtyTables].map((t) => gameName(this.tableMember(t))), ...this.dirtyStrings])].sort();
  }

  /** Forget a member's cached digest (its bytes changed). */
  private touched(member: string) {
    const k = gameName(member);
    this.overrides.delete(k);
    this.digests.delete(k);
    this.baseSame.delete(k);
  }

  /* ── Tables ── */

  private modTables(): Partial<Record<DatTableName, string>> {
    const out: Partial<Record<DatTableName, string>> = {};
    for (const k of this.members()) {
      const t = /^arr\\[^\\]+\.dat(?:ex)?$/.test(k) ? datTableOf(k) : null;
      if (t && (!out[t] || /\.datex$/.test(k))) out[t] = this.nameOf(k);
    }
    return out;
  }

  private tableAt(key: string): DatTableName | null {
    for (const t of DAT_TABLES) if (this.data.fromMod[t] && gameName(this.data.fromMod[t]!) === key) return t;
    return null;
  }

  /** The member a table is written to: the mod's own, or the game's name for a table the mod takes over by editing it. */
  tableMember(t: DatTableName): string {
    return this.data.fromMod[t] ?? DAT_SCHEMAS[t].file;
  }

  tables(): DatTableName[] {
    return DAT_TABLES.filter((t) => this.data.tables[t]);
  }

  /** Whether an entry stores a field (the game's layout leaves some out for ranges of ids). */
  stores(t: DatTableName, field: DatField, id: number): boolean {
    const file = this.data.tables[t]!;
    const [from, end] = storedRange(field, file.layout, file.count);
    return id >= from && id < end;
  }

  /** A field's value as the table came, or null when the table was never edited (so nothing in it differs). */
  openedValue(t: DatTableName, field: string, part: string | undefined, id: number): number | null {
    const was = this.pristine[t];
    if (!was || id >= was.count) return null;
    const f = DAT_SCHEMAS[t].fields.find((x) => x.name === field);
    if (!f) return null;
    const col = was.columns[field];
    return part && f.parts ? col[id * f.parts.length + f.parts.indexOf(part)] : col[id];
  }

  /** Why a value cannot go in a field (a template for `translate`, and its values), or null when it can. */
  refuse(edit: FieldEdit): Refusal | null {
    const file = this.data.tables[edit.table];
    if (!file) return { text: msg("The mod has no {table} table."), params: { table: edit.table } };
    const field = DAT_SCHEMAS[edit.table].fields.find((f) => f.name === edit.field);
    if (!field) return { text: msg("{table} has no field {field}."), params: { table: edit.table, field: edit.field } };
    if (edit.id < 0 || edit.id >= file.count) return { text: msg("{table} has no entry {id}."), params: { table: edit.table, id: edit.id } };
    if (!this.stores(edit.table, field, edit.id)) return { text: msg("Entry {id} does not store {field} in this layout."), params: { id: edit.id, field: edit.field } };
    if (field.parts && (!edit.part || !field.parts.includes(edit.part))) return { text: msg("{field} is in parts: {parts}."), params: { field: edit.field, parts: field.parts.join(", ") } };
    const type = fieldType(field, file.layout);
    if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > MAX[type]) return { text: msg("{field} holds a whole number from 0 to {max} ({type})."), params: { field: edit.field, max: MAX[type].toLocaleString("en"), type } };
    return null;
  }

  /** Sets a field (after `refuse` said nothing). A table the mod did not have becomes the mod's own. */
  setField(edit: FieldEdit) {
    const why = this.refuse(edit);
    if (why) throw new Error(translate(why.text, why.params));
    const t = edit.table;
    if (!this.data.fromMod[t]) {
      const own = decodeDat(t, encodeDat(this.data.tables[t]!), { fileName: DAT_SCHEMAS[t].file });
      this.data.tables[t] = own;
      this.data.fromMod[t] = DAT_SCHEMAS[t].file;
      this.added.set(gameName(DAT_SCHEMAS[t].file), DAT_SCHEMAS[t].file);
    }
    const file = this.data.tables[t]!;
    this.pristine[t] ??= cloneDat(file);
    const field = DAT_SCHEMAS[t].fields.find((f) => f.name === edit.field)!;
    const at = field.parts ? edit.id * field.parts.length + field.parts.indexOf(edit.part!) : edit.id;
    if (file.columns[field.name][at] === edit.value) return;
    file.columns[field.name][at] = edit.value;
    this.dirtyTables.add(t);
    this.touched(this.tableMember(t));
    this.changed("table");
    this.edit({ member: gameName(this.tableMember(t)), field: { ...edit } });
  }

  /* ── String tables ── */

  /** The mod's string tables, and the game's names and labels when the mod has none of its own. */
  stringFiles(): { member: string; fromGame: boolean }[] {
    const own = this.members().filter((k) => k.endsWith(".tbl")).map((member) => ({ member, fromGame: false }));
    const game = this.base ? Object.keys(STRING_KEYS).filter((k) => !own.some((o) => o.member === k) && this.data.strings[STRING_KEYS[k]]).map((member) => ({ member, fromGame: true })) : [];
    // The names first: what a person changes most.
    const rank = (m: string) => (m === "rez\\stat_txt.tbl" ? 0 : m === "rez\\unitnames.tbl" ? 1 : 2);
    return [...own, ...game].sort((a, b) => rank(a.member) - rank(b.member) || Number(a.fromGame) - Number(b.fromGame) || (a.member < b.member ? -1 : 1));
  }

  async strings(member: string): Promise<string[] | null> {
    const k = gameName(member);
    let file = this.tbl.get(k);
    if (!file) {
      const bytes = (await this.read(k)) ?? (this.base ? await this.base(k) : null);
      if (!bytes) return null;
      file = decodeTblFile(bytes);
      this.tbl.set(k, file);
      // The names follow the table the person edits: one array, read by both.
      if (STRING_KEYS[k]) this.data.strings[STRING_KEYS[k]] = file.strings;
    }
    return file.strings;
  }

  /** Sets entry `index` (0-based) of a string table to `text` (the whole entry, NULs and all). */
  async setString(member: string, index: number, text: string) {
    const k = gameName(member);
    const list = await this.strings(k);
    if (!list) throw new Error(`no string table ${member}`);
    if (index < 0 || index >= list.length) throw new Error(`${member} has no entry ${index + 1}`);
    if (list[index] === text) return;
    list[index] = text;
    if (!this.has(k)) this.added.set(k, k);
    this.dirtyStrings.add(k);
    this.touched(k);
    if (STRING_KEYS[k]) this.data.stringsFromMod.add(STRING_KEYS[k]);
    this.changed("strings");
    this.edit({ member: k });
  }

  /* ── Scripts ── */

  private iscriptMembers(): string[] {
    return this.members().filter((k) => /^scripts\\.+\.bin$/.test(k) && !/^scripts\\(aiscript|bwscript)\.bin$/.test(k)).map((k) => this.nameOf(k));
  }

  private async findScripts(): Promise<ScriptDoc[]> {
    const out: ScriptDoc[] = [];
    const own = this.iscriptMembers();
    for (const m of own) out.push({ id: `iscript:${gameName(m)}`, kind: "iscript", label: placeOf(m).file, members: [m], fromGame: false });
    if (!own.length && this.base && (await this.base("scripts\\iscript.bin"))) out.push({ id: "iscript:scripts\\iscript.bin", kind: "iscript", label: placeOf("scripts\\iscript.bin").file, members: ["scripts\\iscript.bin"], fromGame: true });
    const ai = ["scripts\\aiscript.bin", "scripts\\bwscript.bin"].filter((m) => this.has(m));
    if (ai.length) out.push({ id: "ai", kind: "ai", label: "ai/aiscript.txt", members: ai.map((m) => this.nameOf(m)), fromGame: false });
    else if (this.base && (await this.base("scripts\\aiscript.bin"))) out.push({ id: "ai", kind: "ai", label: "ai/aiscript.txt", members: ["scripts\\aiscript.bin", "scripts\\bwscript.bin"], fromGame: true });
    for (const m of this.members().filter((k) => /\.lo[a-z]$/.test(k))) out.push({ id: `overlay:${m}`, kind: "overlay", label: placeOf(this.nameOf(m)).file, members: [this.nameOf(m)], fromGame: false });
    return out;
  }

  script(id: string): ScriptDoc | undefined {
    return this.scripts.find((s) => s.id === id);
  }

  /** The script's text (made the first time it is asked for). */
  async scriptState(id: string): Promise<ScriptState> {
    const known = this.scriptStates.get(id);
    if (known) return known;
    const doc = this.script(id);
    if (!doc) throw new Error(`no script ${id}`);
    const state: ScriptState = { text: null, unreadable: null, error: null };
    try {
      if (doc.kind === "iscript") {
        const bytes = await this.readOver(doc.members[0]);
        if (!bytes) throw new Error(`${doc.members[0]} is not there`);
        state.text = iscriptToText(bytes, { headerComment: (sid) => this.iscriptComment(sid) });
      } else if (doc.kind === "overlay") {
        const bytes = await this.readOver(doc.members[0]);
        if (!bytes) throw new Error(`${doc.members[0]} is not there`);
        state.text = loToText(decodeLoFile(bytes));
      } else {
        const [ai, bw] = await Promise.all(doc.members.map((m) => this.readOver(m)));
        if (!ai) throw new Error("scripts\\aiscript.bin is not there");
        state.names = aiNames(this.data.names);
        state.text = aiscriptToText(ai, bw ?? null, { names: state.names });
      }
    } catch (e) {
      state.unreadable = (e as Error).message;
    }
    this.scriptStates.set(id, state);
    return state;
  }

  /** PyICE's header comment: the images that use a script. */
  private iscriptComment(id: string | number): string | undefined {
    const images = this.data.tables.images;
    if (!images) return undefined;
    const used: string[] = [];
    for (let i = 0; i < images.count && used.length < 8; i++) {
      if (images.columns.iscript_id[i] !== Number(id)) continue;
      const path = this.data.names.images?.[i];
      used.push(path ? `${i} (${path})` : String(i));
    }
    return used.length ? `Used by image${used.length === 1 ? "" : "s"} ${used.join(", ")}` : undefined;
  }

  /**
   * The person's text for a script: assembled at once, and on success it is what the member holds. On an error the
   * member keeps the last text that assembled, and the error is returned with its line.
   */
  async setScriptText(id: string, text: string): Promise<ScriptState> {
    const doc = this.script(id);
    if (!doc) throw new Error(`no script ${id}`);
    const state = await this.scriptState(id);
    state.text = text;
    try {
      if (doc.kind === "iscript") this.putScript(doc.members[0], iscriptFromText(text));
      else if (doc.kind === "overlay") this.putScript(doc.members[0], encodeLoFile(loFromText(text)));
      else {
        const out = aiscriptFromText(text, { names: state.names });
        this.putScript(doc.members[0], out.aiscript);
        if (out.bwscript) {
          const bw = doc.members[1] ?? "scripts\\bwscript.bin";
          if (!doc.members[1]) doc.members.push(bw);
          this.putScript(bw, out.bwscript);
        }
      }
      state.error = null;
    } catch (e) {
      const said = (e as Error).message ?? String(e);
      const line = (e as { line?: number }).line ?? Number(/^line (\d+): /.exec(said)?.[1] ?? 0);
      state.error = { line, message: (e as Error).message.replace(/^line \d+: /, "") };
    }
    this.changed("script");
    return state;
  }

  private putScript(member: string, bytes: Uint8Array) {
    const k = gameName(member);
    this.digests.delete(k);
    this.baseSame.delete(k);
    this.overrides.set(k, bytes);
    if (!this.source.files.has(k)) this.added.set(k, member);
    const doc = this.scripts.find((s) => s.members.some((m) => gameName(m) === k));
    if (doc) doc.fromGame = false;
    this.edit({ member: k });
  }

  /**
   * A member's bytes replaced as a whole (a picture imported, a sound replaced). A member the mod did not have becomes
   * its own. Bytes equal to what came leave the member untouched.
   */
  setMember(member: string, bytes: Uint8Array) {
    const k = gameName(member);
    const was = this.source.files.get(k);
    this.digests.delete(k);
    this.baseSame.delete(k);
    this.overrides.set(k, bytes);
    if (!was) this.added.set(k, member);
    this.changed("file");
    this.edit({ member: k });
  }

  /** An overlay opened as text (the game's, for an image whose overlay the mod does not have) becomes a script to edit. */
  addOverlay(member: string): ScriptDoc {
    const k = gameName(member);
    const id = `overlay:${k}`;
    let doc = this.script(id);
    if (!doc) { doc = { id, kind: "overlay", label: placeOf(member).file, members: [member], fromGame: !this.has(k) }; this.scripts.push(doc); }
    return doc;
  }

  /** Scripts whose text does not assemble now (the member keeps its last good bytes). */
  scriptErrors(): { doc: ScriptDoc; error: { line: number; message: string } }[] {
    return this.scripts.flatMap((doc) => { const e = this.scriptStates.get(doc.id)?.error; return e ? [{ doc, error: e }] : []; });
  }

  /* ── Reading it all: diff, check, the files that differ from the game ── */

  private async dataNow(): Promise<ModData> {
    const read: ReadMember = (n) => this.read(n);
    return loadModData(read, this.base, this.modTables(), this.iscriptMembers());
  }

  private side(data: ModData, read: ReadMember, names: string[]): DiffSide {
    return { data, read: async (n) => (await read(n)) ?? (this.base ? this.base(n) : null), names };
  }

  /** A changelog: against the game itself, or against the mod as it was opened. */
  async diff(against: "game" | "opened"): Promise<ModChange[]> {
    const now = this.side(await this.dataNow(), (n) => this.read(n), this.members());
    let before: DiffSide;
    if (against === "game") {
      before = { data: await loadModData(async () => null, this.base, {}), read: async (n) => (this.base ? this.base(n) : null), names: [] };
    } else {
      this.opened ??= await loadModData((n) => this.original(n), this.base, this.openedTables(), this.openedIscripts());
      before = this.side(this.opened, (n) => this.original(n), [...this.source.files.keys()]);
    }
    return diffMods(before, now);
  }

  private openedTables(): Partial<Record<DatTableName, string>> {
    const out: Partial<Record<DatTableName, string>> = {};
    for (const [k, f] of this.source.files) {
      const t = /^arr\\[^\\]+\.dat(?:ex)?$/.test(k) ? datTableOf(k) : null;
      if (t && (!out[t] || /\.datex$/.test(k))) out[t] = f.name;
    }
    return out;
  }

  private openedIscripts(): string[] {
    return [...this.source.files.entries()].filter(([k]) => /^scripts\\.+\.bin$/.test(k) && !/^scripts\\(aiscript|bwscript)\.bin$/.test(k)).map(([, f]) => f.name);
  }

  /** The lints across the mod as it is now. */
  async check(): Promise<ModFinding[]> {
    const grafts: { member: string; bytes: Uint8Array }[] = [];
    for (const k of this.members()) if (k.endsWith(".graft")) { const b = await this.read(k); if (b) grafts.push({ member: this.nameOf(k), bytes: b }); }
    const baseHas = this.baseHas;
    return checkMod(await this.dataNow(), {
      inMod: (n) => this.has(n),
      inBase: this.base ? async (n) => (baseHas ? baseHas(n) : !!(await this.base!(n))) : null,
      grafts,
    });
  }

  /** The members that differ from the game's own (all of them where no copy of the game can say), by key. */
  async changedMembers(): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.members()) {
      let same = this.baseSame.get(k);
      if (same === undefined) {
        const has = this.baseHas ? await this.baseHas(k) : null;
        const theirs = has === false || !this.base ? null : await this.base(k);
        const mine = theirs ? await this.read(k) : null;
        same = !!theirs && !!mine && equal(theirs, mine);
        this.baseSame.set(k, same);
      }
      if (!same && this.has(k)) out.push(k);
    }
    return out;
  }

  /** Those members with their bytes: what the play page is handed. */
  async changedFiles(): Promise<{ name: string; bytes: Uint8Array }[]> {
    const out: { name: string; bytes: Uint8Array }[] = [];
    for (const k of await this.changedMembers()) { const bytes = await this.read(k); if (bytes) out.push({ name: this.nameOf(k), bytes }); }
    return out;
  }

  /**
   * What the mod goes by between people, as it is now: the hash `@scm-js/mod` gives it (`Identity.hash`), the one the
   * editor, `scmjs mod info` and the play page name it by. Unedited, it is the mod's identity as it opened
   * (`ModSource.identify`: known at once, or worked out the first time for a large mod). Edited, it is the hash the
   * reader would give the mod saved as it is now (`identityWith`): each member an edit touched by the digest of the
   * bytes it has now, the code as it came, which no edit here changes. Only the touched members are read, each once
   * until it changes again. A member that cannot be read has no line, as the reader leaves it out.
   */
  async hash(): Promise<string> {
    const id = await this.source.identify();
    const touched = this.touchedMembers();
    if (!touched.length) return id.hash;
    const files: Record<string, string | null> = {};
    for (const k of touched) {
      const name = this.source.files.get(k)?.line ?? this.nameOf(k);
      let d = this.digests.get(k);
      if (!d) {
        let bytes: Uint8Array | null = null;
        try { bytes = await this.read(k); } catch { /* left out */ }
        if (!bytes) { files[name] = null; continue; }
        d = await sha256Hex(bytes);
        this.digests.set(k, d);
      }
      files[name] = d;
    }
    return (await identityWith(id, { files })).hash;
  }

  /** Every iscript id the mod's scripts define now, for the completion and the tables' references. */
  async iscriptIds(): Promise<number[]> {
    const ids = new Set<number>();
    for (const m of this.iscriptMembers()) {
      const b = await this.read(m);
      if (!b) continue;
      try { for (const h of readIscriptHeaders(b).headers) ids.add(h.id); } catch { /* an unreadable script */ }
    }
    return [...ids].sort((a, b) => a - b);
  }

  /** An entry's name: a unit's, weapon's, upgrade's or technology's; an image's GRP; a sound's WAV; else "". */
  entryName(t: DatTableName, id: number): string {
    const n = this.data.names;
    switch (t) {
      case "units": return n.units[id] ?? "";
      case "weapons": return n.weapons[id] ?? "";
      case "upgrades": return n.upgrades[id] ?? "";
      case "techdata": return n.technologies[id] ?? "";
      case "images": return n.images?.[id] ?? "";
      case "sfxdata": return n.sounds?.[id] ?? "";
      case "flingy": case "sprites": return this.drawnBy(t, id);
      case "orders": case "portdata": case "mapdata": {
        const label = t === "orders" ? this.data.tables.orders?.columns.label?.[id] : undefined;
        const stat = this.data.strings.stat;
        return label && stat && label <= stat.length ? entryText(stat[label - 1]) : "";
      }
      default: return "";
    }
  }

  /** A flingy or sprite named for the first unit drawn with it, else its image's GRP. */
  private drawnBy(t: "flingy" | "sprites", id: number): string {
    const { units, flingy, sprites } = this.data.tables;
    if (t === "flingy" && units) for (let u = 0; u < units.count; u++) if (units.columns.graphics[u] === id && this.data.names.units[u]) return this.data.names.units[u];
    if (t === "sprites" && units && flingy) for (let u = 0; u < units.count; u++) { const f = units.columns.graphics[u]; if (f < flingy.count && flingy.columns.sprite[f] === id && this.data.names.units[u]) return this.data.names.units[u]; }
    const image = t === "sprites" ? sprites?.columns.image[id] : sprites && flingy ? sprites.columns.image[flingy.columns.sprite[id]] : undefined;
    return image !== undefined ? this.data.names.images?.[image] ?? "" : "";
  }

  /** The tables as they are now, for a reader. */
  table(t: DatTableName): DatFile | undefined {
    return this.data.tables[t];
  }

  /** What a table field points at, from the schema. */
  static refOf(t: DatTableName, field: string): string | undefined {
    return DAT_SCHEMAS[t].fields.find((f) => f.name === field)?.ref;
  }
}

const cloneDat = (file: DatFile): DatFile => ({ ...file, columns: Object.fromEntries(Object.entries(file.columns).map(([k, v]) => [k, v.slice()])) });
