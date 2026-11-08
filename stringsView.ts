/**
 * The Strings tab: a string table's entries a line each, as PyTBL writes them (`<0>` between a unit's name parts,
 * `<NN>` for a control character), edited in place; what uses an entry beside it (a unit's name, a weapon's label, the
 * images that draw a GRP path). Entry numbers are 1-based, as the tables count them.
 */
import { entryText, gameName, tblEscape, tblUnescape } from "@scm-js/core";
import { clear, h } from "./dom";
import { t } from "./i18n";
import { num } from "./info";
import type { ViewContext } from "./tablesView";

const ROW = 22;
/** The reference name a string table goes by in the tables' schema. */
const REF_OF: Record<string, string> = { "rez\\stat_txt.tbl": "stat_txt.tbl", "arr\\images.tbl": "images.tbl", "arr\\sfxdata.tbl": "sfxdata.tbl", "arr\\portdata.tbl": "portdata.tbl", "arr\\mapdata.tbl": "mapdata.tbl" };

export class StringsView {
  readonly el: HTMLElement;
  private readonly ctx: ViewContext;
  private member = "";
  private strings: string[] = [];
  private ids: number[] = [];
  private query = "";
  private selected = -1;
  private editing: HTMLInputElement | null = null;
  private readonly picker: HTMLSelectElement;
  private readonly search: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly rows: HTMLElement;
  private drawn = { from: -1, to: -1, revision: -1 };

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    this.picker = h("select", { title: t("The string table"), onchange: () => void this.show(this.picker.value) });
    this.search = h("input", { type: "search", placeholder: t("Search text and entry numbers"), style: "width: 220px", oninput: () => { this.query = this.search.value; this.filter(); } });
    this.count = h("span", { className: "mx-dim" });
    this.rows = h("div");
    this.sizer = h("div", { style: "position: relative" }, this.rows);
    this.grid = h("div", { className: "mx-grid mx-strings", onscroll: () => this.paint() }, this.sizer);
    this.el = h("div", { className: "mx-col", style: "flex: 1" },
      h("div", { className: "mx-bar" }, this.picker, this.search, this.count, h("span", { className: "mx-faint" }, t("Double-click an entry to change it. <0> ends a part, <NN> is a control character."))),
      this.grid);
    new ResizeObserver(() => this.paint()).observe(this.grid);
    this.fillPicker();
    const first = this.ctx.session.stringFiles()[0];
    if (first) void this.show(first.member);
  }

  private fillPicker() {
    clear(this.picker);
    for (const f of this.ctx.session.stringFiles()) this.picker.append(h("option", { value: f.member }, `${this.ctx.session.nameOf(f.member)}${f.fromGame ? ` ${t("(the game's)")}` : ""}`));
    if (this.member) this.picker.value = this.member;
  }

  refresh() {
    this.fillPicker();
    this.filter(true);
  }

  async show(member: string, entry?: number) {
    const key = gameName(member);
    if (key !== this.member) { this.query = ""; this.search.value = ""; }
    this.member = key;
    this.picker.value = key;
    this.strings = (await this.ctx.session.strings(key)) ?? [];
    this.selected = entry !== undefined ? entry - 1 : -1;
    this.filter();
    if (entry !== undefined) {
      const at = this.ids.indexOf(entry - 1);
      if (at >= 0) this.grid.scrollTop = Math.max(0, (at + 1) * ROW - this.grid.clientHeight / 3);
      this.drawn.revision = -1;
      this.paint();
    }
  }

  private filter(keep = false) {
    const q = this.query.trim().toLowerCase();
    const n = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
    this.ids = [];
    this.strings.forEach((s, i) => { if (!q || i + 1 === n || s.toLowerCase().includes(q)) this.ids.push(i); });
    this.count.textContent = q ? t("{shown} of {total} found", { shown: num(this.ids.length), total: num(this.strings.length) }) : t("{total} entries", { total: num(this.strings.length) });
    this.sizer.style.height = `${(this.ids.length + 1) * ROW}px`;
    if (!keep) this.grid.scrollTop = 0;
    this.drawn.revision = -1;
    this.paint();
  }

  /** What uses entry `i` (0-based): the unit it names, the table fields that point at it. */
  private uses(i: number): HTMLElement[] {
    const out: HTMLElement[] = [];
    const s = this.ctx.session;
    if (this.member === "rez\\stat_txt.tbl" && i < 228 && s.table("units") && !s.data.strings.unitnames?.[i]?.replace(/\0/g, "")) {
      out.push(h("a", { className: "mx-link", onclick: () => this.ctx.go("units", i) }, t("unit {id}'s name", { id: i })));
    }
    if (this.member === "rez\\unitnames.tbl" && s.table("units") && i < s.table("units")!.count) out.push(h("a", { className: "mx-link", onclick: () => this.ctx.go("units", i) }, t("unit {id}'s name", { id: i })));
    const ref = REF_OF[this.member];
    if (ref) for (const r of s.refs.usedBy(ref, i + 1).slice(0, 3)) out.push(h("a", { className: "mx-link", onclick: () => this.ctx.go(r.table, r.id, r.field) }, `${r.table} ${r.id} ${r.field}`));
    const more = ref ? s.refs.usedBy(ref, i + 1).length - 3 : 0;
    if (more > 0) out.push(h("span", { className: "mx-faint" }, t("and {n} more", { n: num(more) })));
    return out;
  }

  private paint() {
    if (!this.el.isConnected || this.editing) return;
    const from = Math.max(0, Math.floor(this.grid.scrollTop / ROW) - 9);
    const to = Math.min(this.ids.length, Math.ceil((this.grid.scrollTop + this.grid.clientHeight) / ROW) + 8);
    if (from === this.drawn.from && to === this.drawn.to && this.drawn.revision === this.ctx.session.revision) return;
    this.drawn = { from, to, revision: this.ctx.session.revision };
    clear(this.rows);
    const cols = "grid-template-columns: 60px minmax(0, 1fr) 260px";
    this.rows.append(h("div", { className: "mx-row head", style: cols }, h("span", { className: "mx-cell num" }, t("Entry")), h("span", { className: "mx-cell" }, t("Text")), h("span", { className: "mx-cell" }, t("Used by"))));
    this.rows.append(h("div", { style: `height: ${from * ROW}px` }));
    for (let k = from; k < to; k++) {
      const i = this.ids[k];
      const text = h("span", { className: "mx-cell mx-mono", title: entryText(this.strings[i]) }, tblEscape(this.strings[i]));
      text.addEventListener("dblclick", () => this.edit(text, i));
      const uses = h("span", { className: "mx-cell" });
      this.uses(i).forEach((u, n) => { if (n) uses.append(", "); uses.append(u); });
      this.rows.append(h("div", { className: `mx-row${i === this.selected ? " on" : ""}`, style: cols, onclick: () => { this.selected = i; this.drawn.revision = -1; this.paint(); } }, h("span", { className: "mx-cell num mx-mono" }, String(i + 1)), text, uses));
    }
  }

  private edit(cell: HTMLElement, i: number) {
    const before = tblEscape(this.strings[i]);
    const input = h("input", { value: before, className: "mx-mono" });
    this.editing = input;
    clear(cell);
    cell.append(input);
    input.focus();
    const done = async (commit: boolean) => {
      if (this.editing !== input) return;
      this.editing = null;
      if (commit && input.value !== before) {
        await this.ctx.session.setString(this.member, i, tblUnescape(input.value));
        this.ctx.say(t("{file} entry {n} changed.", { file: this.ctx.session.nameOf(this.member), n: i + 1 }));
      }
      this.drawn.revision = -1;
      this.paint();
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") void done(true); else if (e.key === "Escape") void done(false); });
    input.addEventListener("blur", () => void done(true));
  }
}
