/**
 * The Requirements and Buttons tab (part d): the mod's `datreq\*.graft` as forms. Buttons: a unit's set as rows —
 * place, icon, condition and action by name with their parameters, the lit and greyed tips as the strings they are.
 * Requirements: an entry's list as lines in words, read back as the person types. Every change is encoded through
 * `@scm-js/core`'s graft codecs into the member, so it reaches the editor, Save and a running test game like any
 * other edit. A mod without grafts takes the game's own from a test game that is running (the page reads them out of
 * the game's memory), and edits those.
 */
import { gameName, tblEscape, tblUnescape } from "@scm-js/core";
import { button, clear, h } from "./dom";
import { ACTIONS, BUTTONS_GRAFT, ButtonsDoc, CONDITIONS, GRAFT_MEMBERS, REQUIREMENT_GRAFTS, RequirementsDoc, type ButtonRow, type ParamKind } from "./grafts";
import { t } from "./i18n";
import { num } from "./info";
import type { ViewContext } from "./tablesView";

const STAT = "rez\\stat_txt.tbl";
type Which = "buttons" | (typeof REQUIREMENT_GRAFTS)[number]["kind"];

export class GraftsView {
  readonly el: HTMLElement;
  private readonly ctx: ViewContext;
  private readonly takeFromGame: (() => Promise<{ files: { path: string; bytes: Uint8Array }[]; left: string[] }>) | null;
  private which: Which = "buttons";
  private selected = 0;
  private query = "";
  private picker: HTMLSelectElement;
  private list: HTMLElement;
  private form: HTMLElement;
  private searchBox: HTMLInputElement;
  private doc: { member: string; buttons?: ButtonsDoc; reqs?: RequirementsDoc } | null = null;

  constructor(ctx: ViewContext, takeFromGame: GraftsView["takeFromGame"]) {
    this.ctx = ctx;
    this.takeFromGame = takeFromGame;
    this.picker = h("select", { onchange: () => { this.which = this.picker.value as Which; this.selected = 0; this.refresh(); } },
      h("option", { value: "buttons" }, t("Buttons")),
      h("option", { value: "units" }, t("Requirements: units")), h("option", { value: "upgrades" }, t("Requirements: upgrades")),
      h("option", { value: "research" }, t("Requirements: research")), h("option", { value: "tech" }, t("Requirements: using a technology")),
      h("option", { value: "orders" }, t("Requirements: orders")));
    this.searchBox = h("input", { type: "search", placeholder: t("Search by name or id"), oninput: () => { this.query = this.searchBox.value.trim().toLowerCase(); this.drawList(); } });
    this.list = h("div", { className: "mx-list", style: "overflow: auto; width: 240px; flex: none; border-right: 1px solid var(--border, #2c3341)" });
    this.form = h("div", { style: "overflow: auto; flex: 1; min-width: 0; padding: 4px 8px" });
    this.el = h("div", { className: "mx", style: "display: flex; flex-direction: column; flex: 1; min-height: 0" },
      h("div", { className: "mx-bar" }, this.picker, this.searchBox),
      h("div", { style: "display: flex; flex: 1; min-height: 0" }, this.list, this.form));
  }

  private member(): string {
    return this.which === "buttons" ? BUTTONS_GRAFT : REQUIREMENT_GRAFTS.find((g) => g.kind === this.which)!.member;
  }

  /** Reads the member again (another view or a load changed it) and draws. */
  refresh() {
    void (async () => {
      const member = this.member(), bytes = await this.ctx.session.read(member);
      try {
        this.doc = !bytes ? null : this.which === "buttons" ? { member, buttons: ButtonsDoc.decode(bytes) } : { member, reqs: RequirementsDoc.decode(bytes) };
      } catch (e) {
        this.doc = null;
        clear(this.list); clear(this.form);
        this.form.append(h("p", { className: "mx-danger" }, t("{file} could not be read: {error}", { file: member, error: e instanceof Error ? e.message : String(e) })));
        return;
      }
      await this.ctx.session.strings(STAT);
      this.drawList();
      this.drawForm();
    })();
  }

  /** The ids the list shows: a unit a button set, or a requirement entry's id. */
  private ids(): number[] {
    if (!this.doc) return [];
    if (this.doc.buttons) return Array.from({ length: this.doc.buttons.units }, (_, u) => u);
    const g = REQUIREMENT_GRAFTS.find((x) => x.kind === this.which)!;
    const own = this.doc.reqs!.ids(), table = this.ctx.session.table(g.ids);
    return [...new Set([...own, ...Array.from({ length: Math.min(table?.count ?? 0, 1000) }, (_, i) => i)])].sort((a, b) => a - b);
  }

  private nameOf(id: number): string {
    if (this.which === "buttons") return id < 228 ? this.ctx.session.entryName("units", id) : t("The game's own set {id}", { id });
    const g = REQUIREMENT_GRAFTS.find((x) => x.kind === this.which)!;
    return this.ctx.session.entryName(g.ids, id);
  }

  private drawList() {
    clear(this.list);
    if (!this.doc) { this.drawMissing(); return; }
    const q = this.query;
    for (const id of this.ids()) {
      const name = this.nameOf(id), has = this.doc.buttons ? this.doc.buttons.rows(id).length : (this.doc.reqs!.words(id)?.length ?? 0);
      if (q && !String(id).includes(q) && !name.toLowerCase().includes(q)) continue;
      if (!q && !name && !has) continue;
      this.list.append(h("div", {
        className: `mx-row${id === this.selected ? " on" : ""}`, dataset: { id: String(id) }, style: "cursor: pointer; padding: 1px 6px",
        onclick: () => { this.selected = id; this.drawList(); this.drawForm(); },
      }, h("span", { className: "mx-faint" }, `${id} `), name || t("(no name)"), has ? "" : h("span", { className: "mx-faint" }, ` — ${t("none")}`)));
    }
  }

  private drawMissing() {
    clear(this.form);
    const missing = GRAFT_MEMBERS.filter((m) => !this.ctx.session.has(m));
    this.form.append(h("p", null, t("This mod has no {file}.", { file: this.member() })));
    if (!this.takeFromGame) { this.form.append(h("p", { className: "mx-dim" }, t("Start a test game: its buttons and requirements can then be taken from it to edit."))); return; }
    this.form.append(h("p", { className: "mx-dim" }, t("The game's own buttons and requirements can be taken from the running test game (they are read out of the game's memory) and edited here; they become the mod's files.")),
      button(t("Take the Game's Buttons and Requirements"), () => void this.take(missing), { primary: true }));
  }

  private async take(missing: string[]) {
    try {
      this.ctx.say(t("Reading the buttons and requirements of the running game…"));
      const { files, left } = await this.takeFromGame!();
      let n = 0;
      for (const f of files) { const m = gameName(f.path); if (missing.includes(m)) { this.ctx.session.setMember(m, f.bytes); n++; } }
      this.ctx.say(left.length ? t("{n} files taken from the game; {left} buttons name a routine no graft can say and were left out.", { n, left: left.length }) : t("{n} files taken from the game.", { n }));
      this.refresh();
    } catch (e) {
      this.ctx.say(t("The game's buttons and requirements could not be read: {error}", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private save() {
    if (!this.doc) return;
    const bytes = this.doc.buttons ? this.doc.buttons.encode() : this.doc.reqs!.encode();
    this.ctx.session.setMember(this.doc.member, bytes);
  }

  private drawForm() {
    clear(this.form);
    if (!this.doc) { this.drawMissing(); return; }
    if (this.doc.buttons) this.drawButtons(this.doc.buttons);
    else this.drawRequirements(this.doc.reqs!);
  }

  /* ── Buttons ── */

  private paramHint(kind: ParamKind, value: number): string {
    const s = this.ctx.session;
    if (kind === "unit") return s.entryName("units", value);
    if (kind === "upgrade") return s.entryName("upgrades", value);
    if (kind === "tech") return s.entryName("techdata", value);
    if (kind === "set") return value < 228 ? t("{name}'s set", { name: s.entryName("units", value) }) : t("the game's own set {id}", { id: value });
    return "";
  }

  private tipText(id: number): string {
    const list = this.ctx.session.data.strings.stat;
    return id && list && id <= list.length ? tblEscape(list[id - 1]) : "";
  }

  private drawButtons(doc: ButtonsDoc) {
    const unit = this.selected, rows = doc.rows(unit), shared = doc.sharedWith(unit);
    const edit = (index: number, change: Partial<ButtonRow>) => {
      try { doc.setButton(unit, index, change); this.save(); }
      catch (e) { this.ctx.say(e instanceof Error ? e.message : String(e)); }
    };
    const numberCell = (value: number, set: (v: number) => void, width = 56) => {
      const input = h("input", { type: "number", value: String(value), min: "0", max: "65535", style: `width: ${width}px` }) as HTMLInputElement;
      input.addEventListener("change", () => { const v = Number(input.value); if (Number.isInteger(v) && v >= 0 && v <= 0xffff) set(v); else input.classList.add("bad"); });
      return input;
    };
    const select = (options: readonly { name: string }[], value: number, set: (v: number) => void) => {
      const el = h("select", { onchange: () => set(Number(el.value)), style: "max-width: 220px" }, ...options.map((o, i) => h("option", { value: String(i) }, `${i} ${o.name}`))) as HTMLSelectElement;
      el.value = String(value);
      return el;
    };
    const tip = (id: number, which: "enabledString" | "disabledString", index: number) => {
      const text = h("input", { type: "text", value: this.tipText(id), style: "width: 220px", title: t("The string in stat_txt.tbl: its first byte is the hotkey, its second what the tooltip shows the cost of, then the words.") }) as HTMLInputElement;
      text.disabled = !id;
      text.addEventListener("change", () => void this.ctx.session.setString(STAT, id - 1, tblUnescape(text.value)).then(() => this.ctx.say(t("stat_txt.tbl entry {id} changed.", { id })), (e) => this.ctx.say(String(e))));
      return h("span", { style: "display: inline-flex; gap: 3px" }, numberCell(id, (v) => edit(index, { [which]: v }), 52), text);
    };
    this.form.append(h("div", { className: "mx-bar" },
      h("b", null, `${unit} ${this.nameOf(unit) || ""}`),
      shared.length ? h("span", { className: "mx-dim" }, t("Shared with {units}: a change gives this unit its own set.", { units: shared.slice(0, 4).map((u) => this.nameOf(u) || String(u)).join(", ") })) : null,
      h("span", { className: "mx-grow" }),
      button(t("Add a Button"), () => { try { doc.add(unit, { position: Math.min(9, (rows[rows.length - 1]?.position ?? 0) + 1), icon: 0, condition: 3, action: 10, conditionParam: 0, actionParam: 0, enabledString: 0, disabledString: 0 }); this.save(); } catch (e) { this.ctx.say(String(e)); } })));
    if (!rows.length) { this.form.append(h("p", { className: "mx-dim" }, t("No buttons: the unit shows an empty card."))); return; }
    const table = h("table", { className: "mx-form", style: "border-collapse: collapse" },
      h("tr", null, ...[t("Place"), t("Icon"), t("Condition"), t("Parameter"), t("Action"), t("Parameter"), t("Tip when lit"), t("Tip when greyed"), ""].map((x) => h("th", { style: "text-align: left; padding: 2px 4px" }, x))));
    rows.forEach((b, i) => {
      const place = h("select", { onchange: () => edit(i, { position: Number(place.value) }) }, ...Array.from({ length: 9 }, (_, k) => h("option", { value: String(k + 1) }, String(k + 1)))) as HTMLSelectElement;
      place.value = String(b.position);
      const cond = CONDITIONS[b.condition], act = ACTIONS[b.action];
      table.append(h("tr", { dataset: { row: String(i) } },
        h("td", null, place),
        h("td", null, numberCell(b.icon, (v) => edit(i, { icon: v }), 52)),
        h("td", null, select(CONDITIONS, b.condition, (v) => edit(i, { condition: v }))),
        h("td", { style: "white-space: nowrap" }, numberCell(b.conditionParam, (v) => edit(i, { conditionParam: v })), " ", h("span", { className: "mx-dim" }, cond ? this.paramHint(cond.param, b.conditionParam) : "")),
        h("td", null, select(ACTIONS, b.action, (v) => edit(i, { action: v }))),
        h("td", { style: "white-space: nowrap" }, numberCell(b.actionParam, (v) => edit(i, { actionParam: v })), " ", h("span", { className: "mx-dim" }, act ? this.paramHint(act.param, b.actionParam) : "")),
        h("td", null, tip(b.enabledString, "enabledString", i)),
        h("td", null, tip(b.disabledString, "disabledString", i)),
        h("td", null, button("×", () => { doc.remove(unit, i); this.save(); }, { title: t("Remove this button") }))));
    });
    this.form.append(table, h("p", { className: "mx-faint" }, t("The game places a set's buttons in order: for each place in turn, the next button whose condition shows it goes there, unless its place is later.")));
  }

  /* ── Requirements ── */

  private drawRequirements(doc: RequirementsDoc) {
    const id = this.selected, s = this.ctx.session;
    const names = (type: number) => s.entryName("units", type);
    const unitByName = (name: string) => {
      const units = s.table("units"), want = name.toLowerCase();
      for (let u = 0; units && u < units.count; u++) if (s.entryName("units", u).toLowerCase() === want) return u;
      return null;
    };
    const area = h("textarea", { className: "mx-mono", spellcheck: false, style: "width: 100%; min-height: 180px; font-size: 12px" }) as HTMLTextAreaElement;
    area.value = doc.lines(id, names).join("\n");
    const said = h("div", { className: "mx-dim" });
    area.addEventListener("change", () => {
      try {
        doc.setLines(id, area.value, unitByName);
        this.save();
        said.className = "mx-ok";
        said.textContent = t("{n} words.", { n: num(doc.words(id)?.length ?? 0) });
      } catch (e) { said.className = "mx-danger"; said.textContent = e instanceof Error ? e.message : String(e); }
    });
    this.form.append(
      h("div", { className: "mx-bar" }, h("b", null, `${id} ${this.nameOf(id)}`)),
      h("p", { className: "mx-faint" }, t("A line a requirement: \"owns <unit>\", an opcode by name (\"current unit is <unit>\", \"is not lifted off\", \"or\"), \"end\" closing an upgrade's level. A unit by name or by its number in brackets.")),
      area, said);
  }
}
