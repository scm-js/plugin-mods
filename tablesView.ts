/**
 * The Tables tab: one grid a table, every field under its PyMS name, the entry's name beside its id, a search over
 * names and ids, and beside the grid the selected entry — every field with what it points at, and what points at it
 * (the units that carry a weapon, the images that draw a GRP). A value is edited where it is shown (double-click,
 * Enter), checked against the field's type before it is stored.
 */
import type { PluginApi } from "@scm-js/plugin-api";
import { DAT_SCHEMAS, entryText, type DatTableName } from "@scm-js/core";
import { clear, h } from "./dom";
import { columnsOf, display, parse, type Column } from "./fields";
import { t, translate } from "./i18n";
import { num } from "./info";
import type { RefFrom } from "./refs";
import type { ModSession } from "./session";

export interface ViewContext {
  api: PluginApi;
  session: ModSession;
  /** Say something in the panel's status line. */
  say(text: string): void;
  /** Show a table entry (switching to the Tables tab). */
  go(table: DatTableName, id: number, field?: string): void;
  /** Show the iscript entry with this id (switching to the Scripts tab). */
  goScript(iscriptId: number): void;
  /** Show a string table's entry (1-based, switching to the Strings tab). */
  goString(member: string, entry: number): void;
  /** Show an image's GRP and play its animation (switching to the Pictures tab). */
  goImage(image: number): void;
  /** The GRPs the game's copy here has, under `unit\` (from its unit manifest). */
  gameGrps(): readonly string[];
}

const ROW = 22;
/** Tables whose entries have names of their own; an unnamed entry of these is hidden until asked for. */
const NAMED: DatTableName[] = ["units", "weapons", "upgrades", "techdata"];

export function tableLabel(table: DatTableName): string {
  switch (table) {
    case "units": return t("Units");
    case "weapons": return t("Weapons");
    case "flingy": return t("Flingy");
    case "sprites": return t("Sprites");
    case "images": return t("Images");
    case "upgrades": return t("Upgrades");
    case "techdata": return t("Technologies");
    case "orders": return t("Orders");
    case "sfxdata": return t("Sounds");
    case "portdata": return t("Portraits");
    default: return t("Campaign maps");
  }
}

/** The string table a `*.tbl` reference names, by member. */
const TBL_MEMBER: Record<string, string> = { "stat_txt.tbl": "rez\\stat_txt.tbl", "images.tbl": "arr\\images.tbl", "sfxdata.tbl": "arr\\sfxdata.tbl", "portdata.tbl": "arr\\portdata.tbl", "mapdata.tbl": "arr\\mapdata.tbl" };

export class TablesView {
  readonly el: HTMLElement;
  private table: DatTableName = "units";
  private query = "";
  private unnamed = false;
  private selected = -1;
  private ids: number[] = [];
  private columns: Column[] = [];
  private names: string[] = [];
  private namesAt = -1;
  private readonly grid: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly side: HTMLElement;
  private readonly count: HTMLElement;
  private readonly picker: HTMLSelectElement;
  private readonly search: HTMLInputElement;
  private readonly unnamedBox: HTMLInputElement;
  private template = "";
  private drawn = { from: -1, to: -1, revision: -1 };
  private editing: HTMLInputElement | null = null;

  private readonly ctx: ViewContext;

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    this.picker = h("select", { title: t("The table"), onchange: () => this.show(this.picker.value as DatTableName) });
    this.search = h("input", { type: "search", placeholder: t("Search names and ids"), style: "width: 200px", oninput: () => { this.query = this.search.value; this.filter(); } });
    this.unnamedBox = h("input", { type: "checkbox", onchange: () => { this.unnamed = this.unnamedBox.checked; this.filter(); } });
    this.count = h("span", { className: "mx-dim mx-count" });
    this.rows = h("div");
    this.sizer = h("div", { style: "position: relative" }, this.rows);
    this.grid = h("div", { className: "mx-grid", tabindex: "0", onscroll: () => this.paint() }, this.sizer);
    this.grid.addEventListener("keydown", (e) => this.key(e));
    this.side = h("div", { className: "mx-side" });
    this.el = h("div", { className: "mx-split" },
      h("div", { className: "mx-col" },
        h("div", { className: "mx-bar" }, this.picker, this.search, h("label", { className: "mx-dim", title: t("Entries with no name of their own: most of a widened table is unused rows") }, this.unnamedBox, " ", t("Unnamed too")), this.count),
        this.grid),
      this.side);
    new ResizeObserver(() => this.paint()).observe(this.grid);
    this.fillPicker();
    this.show("units");
  }

  private get session() { return this.ctx.session; }

  private fillPicker() {
    clear(this.picker);
    for (const tb of this.session.tables()) {
      const file = this.session.table(tb)!;
      const own = this.session.data.fromMod[tb] ? "" : ` ${t("(the game's)")}`;
      this.picker.append(h("option", { value: tb }, `${tableLabel(tb)} — ${num(file.count)}${own}`));
    }
    this.picker.value = this.table;
  }

  /** Redraw after a change elsewhere (an edit, a language change). */
  refresh() {
    this.fillPicker();
    this.filter(true);
  }

  show(table: DatTableName, id?: number, field?: string) {
    if (!this.session.table(table)) return;
    if (table !== this.table) { this.query = ""; this.search.value = ""; }
    this.table = table;
    this.picker.value = table;
    this.unnamed = !NAMED.includes(table);
    this.unnamedBox.checked = this.unnamed;
    this.columns = columnsOf(table);
    this.template = `56px 210px 52px ${this.columns.map((c) => (c.field.text?.kind === "flags" ? "96px" : "84px")).join(" ")}`;
    this.namesAt = -1;
    this.selected = id ?? -1;
    this.filter();
    if (id !== undefined) {
      // An entry asked for by a link is shown even when the filter would hide it.
      if (!this.ids.includes(id)) { this.unnamed = true; this.unnamedBox.checked = true; this.query = ""; this.search.value = ""; this.filter(); }
      this.reveal(id, field);
    }
  }

  private entryNames(): string[] {
    if (this.namesAt !== this.session.revision) {
      const count = this.session.table(this.table)!.count;
      this.names = Array.from({ length: count }, (_, id) => this.session.entryName(this.table, id));
      this.namesAt = this.session.revision;
    }
    return this.names;
  }

  private filter(keep = false) {
    const file = this.session.table(this.table)!;
    const names = this.entryNames();
    const q = this.query.trim().toLowerCase();
    const idQuery = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
    const ids: number[] = [];
    for (let id = 0; id < file.count; id++) {
      const name = names[id];
      if (q) { if (id !== idQuery && !name.toLowerCase().includes(q)) continue; }
      else if (!this.unnamed && !name) continue;
      ids.push(id);
    }
    this.ids = ids;
    const named = names.filter(Boolean).length;
    const what = tableLabel(this.table).toLowerCase();
    this.count.textContent = q
      ? t("{shown} of {total} found", { shown: num(ids.length), total: num(file.count) })
      : NAMED.includes(this.table) ? t("{named} named {what} of {total}", { named: num(named), what, total: num(file.count) }) : t("{total} entries", { total: num(file.count) });
    this.sizer.style.height = `${(ids.length + 1) * ROW}px`;
    this.sizer.style.width = `${56 + 210 + 52 + this.columns.reduce((n, c) => n + (c.field.text?.kind === "flags" ? 96 : 84), 0)}px`;
    if (!keep) this.grid.scrollTop = 0;
    this.drawn.revision = -1;
    this.paint();
    this.drawSide();
  }

  private reveal(id: number, field?: string) {
    const at = this.ids.indexOf(id);
    if (at < 0) return;
    this.selected = id;
    const top = (at + 1) * ROW;
    if (top < this.grid.scrollTop + ROW || top > this.grid.scrollTop + this.grid.clientHeight - ROW) this.grid.scrollTop = Math.max(0, top - this.grid.clientHeight / 3);
    if (field) {
      const col = this.columns.findIndex((c) => c.key === field || c.field.name === field);
      if (col >= 0) this.grid.scrollLeft = Math.max(0, 318 + col * 84 - this.grid.clientWidth / 2);
    }
    this.drawn.revision = -1;
    this.paint();
    this.drawSide();
  }

  private paint() {
    if (!this.el.isConnected) return;
    const from = Math.max(0, Math.floor(this.grid.scrollTop / ROW) - 1 - 8);
    const to = Math.min(this.ids.length, Math.ceil((this.grid.scrollTop + this.grid.clientHeight) / ROW) + 8);
    if (from === this.drawn.from && to === this.drawn.to && this.drawn.revision === this.session.revision && !this.editing) return;
    if (this.editing) return;
    this.drawn = { from, to, revision: this.session.revision };
    clear(this.rows);
    const head = h("div", { className: "mx-row head", style: `grid-template-columns: ${this.template}; top: 0` },
      h("span", { className: "mx-cell stick", style: "left: 0" }, t("Id")),
      h("span", { className: "mx-cell stick", style: "left: 56px" }, t("Name")),
      h("span", { className: "mx-cell num", title: t("How many entries of other tables point at this one") }, t("Used")),
      ...this.columns.map((c) => h("span", { className: "mx-cell", title: `${c.key} (${c.field.type}${c.field.ref ? ` → ${c.field.ref}` : ""})` }, c.key)));
    // The header row rides at the top of the scrolled area.
    head.style.position = "sticky";
    this.rows.append(head);
    const names = this.entryNames();
    const spacer = h("div", { style: `height: ${from * ROW}px` });
    this.rows.append(spacer);
    for (let i = from; i < to; i++) {
      const id = this.ids[i];
      const used = this.session.refs.usedBy(this.table, id).length;
      const row = h("div", { className: `mx-row${id === this.selected ? " on" : ""}`, style: `grid-template-columns: ${this.template}`, dataset: { id: String(id) }, onclick: () => this.select(id) },
        h("span", { className: "mx-cell num stick mx-mono", style: "left: 0" }, String(id)),
        h("span", { className: "mx-cell stick", style: "left: 56px", title: names[id] }, names[id] || h("span", { className: "mx-faint" }, "—")),
        h("span", { className: "mx-cell num" }, used ? String(used) : ""));
      for (const c of this.columns) {
        const stored = this.session.stores(this.table, c.field, id);
        if (!stored) { row.append(h("span", { className: "mx-cell none" }, "")); continue; }
        const v = this.value(c, id);
        const cell = h("span", { className: `mx-cell num${this.changedFromOpened(c, id) ? " edited" : ""}`, title: this.cellTitle(c, v) }, display(c.field, v));
        cell.addEventListener("dblclick", () => this.edit(cell, c, id));
        row.append(cell);
      }
      this.rows.append(row);
    }
  }

  /** Selects an entry without drawing the rows again (a double-click's first click must leave its cell in place). */
  private select(id: number) {
    if (this.selected === id) return;
    this.selected = id;
    for (const row of this.rows.querySelectorAll<HTMLElement>(".mx-row[data-id]")) row.classList.toggle("on", row.dataset.id === String(id));
    this.drawSide();
  }

  private value(c: Column, id: number): number {
    const file = this.session.table(this.table)!;
    const col = file.columns[c.field.name];
    return c.part ? col[id * c.field.parts!.length + c.field.parts!.indexOf(c.part)] : col[id];
  }

  /** Whether a value differs from the table as the mod came (or the game's, for a table the mod took over). */
  private changedFromOpened(c: Column, id: number): boolean {
    const was = this.session.openedValue(this.table, c.field.name, c.part, id);
    return was !== null && was !== this.value(c, id);
  }

  private cellTitle(c: Column, v: number): string {
    const ref = c.field.ref;
    if (!ref) return c.key;
    const target = this.refName(ref, v);
    return target ? `${c.key} → ${target}` : c.key;
  }

  /** What a value of a `ref` field is: `weapons 0 (Gauss Rifle)`, `images.tbl 5 (terran\marine.grp)`. */
  private refName(ref: string, v: number): string {
    const s = this.session;
    if (ref in DAT_SCHEMAS) {
      const tb = ref as DatTableName;
      const file = s.table(tb);
      if (!file || v >= file.count) return t("none");
      const n = s.entryName(tb, v);
      return n ? `${tb} ${v} (${n})` : `${tb} ${v}`;
    }
    if (TBL_MEMBER[ref]) {
      if (v === 0) return t("none");
      const key = ({ "stat_txt.tbl": "stat", "images.tbl": "images", "sfxdata.tbl": "sfxdata", "portdata.tbl": "portdata", "mapdata.tbl": "mapdata" } as const)[ref as "stat_txt.tbl"];
      const list = s.data.strings[key];
      return list && v <= list.length ? `${ref} ${v} (${entryText(list[v - 1])})` : `${ref} ${v}`;
    }
    return `${ref} ${v}`;
  }

  private edit(cell: HTMLElement, c: Column, id: number) {
    if (this.editing) return;
    const before = display(c.field, this.value(c, id));
    const input = h("input", { value: before, className: "mx-mono" });
    this.editing = input;
    clear(cell);
    cell.append(input);
    input.focus();
    input.select();
    /** `leaving`: the field lost focus, so a value that will not go in is dropped rather than kept for correcting. */
    const done = (commit: boolean, leaving = false) => {
      if (this.editing !== input) return;
      if (commit && input.value.trim() !== before) {
        const error = this.commit(c, id, input.value);
        if (error) {
          this.ctx.say(error);
          if (!leaving) { input.classList.add("bad"); input.title = error; input.focus(); return; }
        }
      }
      this.editing = null;
      this.drawn.revision = -1;
      this.paint();
      this.drawSide();
      if (!leaving) this.grid.focus({ preventScroll: true });
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done(true);
      else if (e.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => done(true, true));
  }

  /** Stores a typed value; the reason it was refused, or null. */
  private commit(c: Column, id: number, text: string): string | null {
    const parsed = parse(c.field, text);
    if (typeof parsed !== "number") return translate(parsed.error);
    const edit = { table: this.table, id, field: c.field.name, part: c.part, value: parsed };
    const why = this.session.refuse(edit);
    if (why) return translate(why.text, why.params);
    this.session.setField(edit);
    const name = this.session.entryName(this.table, id);
    this.ctx.say(t("{what} {id}{name}: {field} set to {value}.", { what: this.table, id, name: name ? ` (${name})` : "", field: c.key, value: display(c.field, parsed) }));
    return null;
  }

  private key(e: KeyboardEvent) {
    if (this.editing || !this.ids.length) return;
    const at = this.ids.indexOf(this.selected);
    const move = (to: number) => { e.preventDefault(); this.reveal(this.ids[Math.max(0, Math.min(this.ids.length - 1, to))]); };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "PageDown") move(at + 20);
    else if (e.key === "PageUp") move(at - 20);
  }

  private drawSide() {
    clear(this.side);
    const id = this.selected;
    const file = this.session.table(this.table);
    if (!file || id < 0 || id >= file.count) {
      this.side.append(h("p", { className: "mx-dim" }, t("Choose an entry to see every field, what it points at, and what uses it. Double-click a value to change it.")));
      return;
    }
    const name = this.session.entryName(this.table, id);
    this.side.append(h("h4", null, `${tableLabel(this.table)} ${id}${name ? ` — ${name}` : ""}`));
    if (this.table === "images") this.side.append(h("p", null, h("a", { className: "mx-link", onclick: () => this.ctx.goImage(id) }, t("Its picture and animation →"))));
    const kv = h("div", { className: "mx-kv" });
    for (const c of this.columns) {
      if (!this.session.stores(this.table, c.field, id)) continue;
      const v = this.value(c, id);
      const val = h("span", { className: `v mx-mono${this.changedFromOpened(c, id) ? " edited" : ""}`, title: t("Double-click to change") }, display(c.field, v));
      val.addEventListener("dblclick", () => this.editSide(val, c, id));
      kv.append(h("span", { className: "k", title: c.key }, c.key), val);
      const link = this.refLink(c, v);
      if (link) kv.append(h("span", { className: "r" }, link));
    }
    this.side.append(kv);
    this.side.append(h("h4", null, t("Used by")));
    const uses = this.uses(id);
    if (!uses.length) this.side.append(h("p", { className: "mx-faint" }, t("Nothing points at this entry.")));
    else {
      const list = h("ul", { className: "mx-uses" });
      for (const u of uses) list.append(h("li", null, u));
      this.side.append(list);
    }
  }

  private editSide(val: HTMLElement, c: Column, id: number) {
    const before = val.textContent ?? "";
    const input = h("input", { value: before, className: "mx-mono", style: "width: 90px" });
    val.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const done = (commit: boolean) => {
      if (closed) return;
      if (commit && input.value.trim() !== before) {
        const error = this.commit(c, id, input.value);
        if (error) { input.classList.add("bad"); input.title = error; this.ctx.say(error); return; }
      }
      closed = true;
      this.drawn.revision = -1;
      this.paint();
      this.drawSide();
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") done(true); else if (e.key === "Escape") { input.classList.remove("bad"); done(false); } });
    input.addEventListener("blur", () => done(false));
  }

  /** A link to what a field points at. */
  private refLink(c: Column, v: number): HTMLElement | null {
    const ref = c.field.ref;
    if (!ref) return null;
    const text = `→ ${this.refName(ref, v)}`;
    if (ref in DAT_SCHEMAS) {
      const file = this.session.table(ref as DatTableName);
      if (!file || v >= file.count) return h("span", { className: "mx-faint" }, text);
      return h("a", { className: "mx-link", onclick: () => this.ctx.go(ref as DatTableName, v) }, text);
    }
    if (TBL_MEMBER[ref] && v > 0) return h("a", { className: "mx-link", onclick: () => this.ctx.goString(TBL_MEMBER[ref], v) }, text);
    if (ref === "iscript.bin") return h("a", { className: "mx-link", onclick: () => this.ctx.goScript(v) }, `→ iscript ${v}`);
    return h("span", { className: "mx-faint" }, text);
  }

  /**
   * What points at an entry, as links, a group a field (`units · ground_weapon`): the entries of other tables, and for
   * an image the others that draw its GRP, for a sound row the others that play its file. A long group shows its first
   * entries and says how many more.
   */
  private uses(id: number): HTMLElement[] {
    const groups = new Map<string, { refs: RefFrom[]; note?: string }>();
    const add = (r: RefFrom, note?: string) => {
      const key = `${r.table} · ${note ?? r.field}`;
      const g = groups.get(key) ?? { refs: [], note };
      g.refs.push(r);
      groups.set(key, g);
    };
    for (const r of this.session.refs.usedBy(this.table, id)) add(r);
    const file = this.session.table(this.table)!;
    if (this.table === "images") {
      const grp = file.columns.grp_file[id];
      for (const r of this.session.refs.usedBy("images.tbl", grp)) if (!(r.table === "images" && r.id === id) && r.field === "grp_file") add(r, t("the same picture"));
    }
    if (this.table === "sfxdata") {
      const wav = file.columns.sound_file[id];
      for (const r of this.session.refs.usedBy("sfxdata.tbl", wav)) if (!(r.table === "sfxdata" && r.id === id)) add(r, t("the same sound file"));
    }
    const out: HTMLElement[] = [];
    for (const [key, g] of groups) {
      out.push(h("span", { className: "mx-dim" }, `${key} (${num(g.refs.length)})`));
      for (const r of g.refs.slice(0, 12)) {
        const n = this.session.entryName(r.table, r.id);
        out.push(h("a", { className: "mx-link", style: "margin-left: 10px", onclick: () => this.ctx.go(r.table, r.id, r.field) }, `${r.table} ${r.id}${n ? ` ${n}` : ""}`));
      }
      if (g.refs.length > 12) out.push(h("span", { className: "mx-faint", style: "margin-left: 10px" }, t("and {n} more", { n: num(g.refs.length - 12) })));
    }
    return out;
  }
}

