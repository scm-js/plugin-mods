/**
 * The Races tab: the races the mod adds to the game's own, as a table a person fills in. Number, name, the letter of
 * its files, and which of the game's races it plays as; add, edit, remove. Every change goes to the editor
 * (`RaceTable`), which names the race wherever a player's race is shown, and into `mod.json` when the mod is saved as
 * a folder. The names and letters the editor finds in the mod's files are offered as buttons for the row being edited,
 * and taken only when one is clicked.
 */
import { button, clear, h } from "./dom";
import { t, translate } from "./i18n";
import { GAME_RACES, RaceTable, checkRow, draftOf, emptyDraft, type RaceDraft, type RaceField } from "./races";

export class RacesView {
  readonly el: HTMLElement;
  private readonly table: RaceTable;
  private readonly say: (text: string) => void;
  /** The row being edited: its id, or null for a new row. */
  private editing: number | null = null;
  private draft: RaceDraft = emptyDraft();
  /** After Add was pressed and refused: every field's reason shown, an empty one's too. */
  private showAll = false;
  private hints: { names: string[]; letters: string[] } = { names: [], letters: [] };
  private asked = 0;

  constructor(table: RaceTable, say: (text: string) => void) {
    this.table = table;
    this.say = say;
    this.el = h("div", { className: "mx-races", style: "flex: 1; min-height: 0; overflow: auto; padding: 4px 8px" });
  }

  /** The table may have changed (the editor's, a load): draw it again, and ask for the hints again. */
  refresh() {
    this.draw();
    const asked = ++this.asked;
    void this.table.hints().then((hints) => {
      if (asked !== this.asked) return;
      this.hints = hints;
      this.draw();
    });
  }

  private draw() {
    const el = this.el;
    clear(el);
    const rows = this.table.rows, keeps = this.table.canKeep;
    el.append(h("p", { className: "mx-dim" }, t("A mod can give players races past the game's own. Its files do not say what they are called, so name them here: the editor then shows the name wherever a player's race is shown, and saving the mod as a folder writes them into its mod.json. The mod's files and its hash do not change.")));
    if (!keeps) el.append(h("p", { className: "mx-warn" }, t("This editor cannot keep race names; update it to name the races a mod adds. Races in the mod's mod.json are still written back when it is saved as a folder.")));

    const grid = h("table", { className: "mx-form", style: "border-collapse: collapse; margin: 4px 0" },
      h("tr", null, ...[t("Number"), t("Name"), t("Letter of its files"), t("Plays as"), ""].map((x) => h("th", { style: "text-align: left; padding: 2px 8px 2px 0" }, x))));
    for (const r of rows) {
      grid.append(h("tr", { dataset: { race: String(r.id) }, className: this.editing === r.id ? "on" : "" },
        h("td", { style: "padding: 1px 8px 1px 0; font-variant-numeric: tabular-nums" }, String(r.id)),
        h("td", { style: "padding: 1px 8px 1px 0" }, r.name),
        h("td", { style: "padding: 1px 8px 1px 0" }, r.letter ?? h("span", { className: "mx-faint" }, t("none"))),
        h("td", { style: "padding: 1px 8px 1px 0" }, r.like === undefined ? h("span", { className: "mx-faint" }, t("not said")) : translate(GAME_RACES[r.like])),
        h("td", { style: "white-space: nowrap" }, keeps ? button(t("Edit"), () => { this.editing = r.id; this.draft = draftOf(r); this.showAll = false; this.draw(); }) : null, " ",
          keeps ? button("×", () => this.remove(r.id), { title: t("Remove this race") }) : null)));
    }
    if (!rows.length) grid.append(h("tr", null, h("td", { colSpan: 5, className: "mx-faint", style: "padding: 2px 0" }, t("No races are named for this mod."))));
    el.append(grid);
    if (keeps) el.append(this.form());
    el.append(h("p", { className: "mx-faint" }, t("A race's number is not in any of the mod's files. To find it, open a replay or a map made with the mod: a player whose race has no name here shows as Race and the number, such as Race 9.")));
  }

  /** The row being added or edited, each field's refusal beside it as it is typed. */
  private form(): HTMLElement {
    const d = this.draft;
    const errorsEl = h("div", { className: "mx-danger" });
    const save = button(this.editing === null ? t("Add") : t("Save Changes"), () => this.put(), { primary: true });
    const inputs: Record<RaceField, HTMLInputElement> = {
      id: h("input", { type: "text", inputMode: "numeric", value: d.id, placeholder: "8–255", style: "width: 64px", title: t("The race's number: 8 to 255") }),
      name: h("input", { type: "text", value: d.name, style: "width: 180px", maxLength: 60 }),
      letter: h("input", { type: "text", value: d.letter, style: "width: 36px", maxLength: 1, title: t("The lower-case letter its own files go by, as in game\\<letter>console.pcx; empty when it has none") }),
    };
    const like = h("select", { onchange: () => { this.draft.like = like.value; } },
      h("option", { value: "" }, t("not said")), ...[0, 1, 2].map((v) => h("option", { value: String(v) }, translate(GAME_RACES[v])))) as HTMLSelectElement;
    like.value = d.like;
    const check = () => {
      const { errors } = checkRow(this.draft, this.table.rows, this.editing);
      // (A field still empty on a new row is not yet wrong: it is said when Add is pressed.)
      const shown = (f: RaceField) => (this.showAll || this.draft[f].trim() || this.editing !== null ? errors[f] : undefined);
      clear(errorsEl);
      for (const f of ["id", "name", "letter"] as const) {
        const why = shown(f);
        inputs[f].classList.toggle("bad", !!why);
        if (why) errorsEl.append(h("div", null, why));
      }
      save.disabled = (["id", "name", "letter"] as const).some((f) => shown(f));
    };
    for (const f of ["id", "name", "letter"] as const) inputs[f].addEventListener("input", () => { this.draft[f] = inputs[f].value; check(); });
    inputs.name.addEventListener("keydown", (e) => { if (e.key === "Enter") this.put(); });
    check();

    const box = h("div", { style: "border-top: 1px solid var(--border, #2c3341); padding-top: 4px" },
      h("div", { className: "mx-bar" },
        h("b", null, this.editing === null ? t("New race") : t("Race {n}", { n: this.editing })),
        h("label", null, t("Number"), inputs.id),
        h("label", null, t("Name"), inputs.name),
        h("label", null, t("Letter"), inputs.letter),
        h("label", null, t("Plays as"), like),
        save,
        this.editing !== null ? button(t("Cancel"), () => { this.editing = null; this.draft = emptyDraft(); this.showAll = false; this.draw(); }) : null),
      errorsEl);

    const { names, letters } = this.hints;
    if (names.length || letters.length) {
      const take = (f: "name" | "letter", value: string) => { this.draft[f] = value; inputs[f].value = value; check(); };
      box.append(h("p", { className: "mx-dim", style: "margin: 4px 0 2px" }, t("Found in the mod's files: names its network.tbl has past the game's own, and letters it has a console picture or status buttons for. They are guesses; check one before you use it.")));
      if (names.length) box.append(h("div", { className: "mx-bar", dataset: { hints: "name" } }, h("span", { className: "mx-dim" }, t("Name")), ...names.map((n) => button(n, () => take("name", n), { title: t("Use this name") }))));
      if (letters.length) box.append(h("div", { className: "mx-bar", dataset: { hints: "letter" } }, h("span", { className: "mx-dim" }, t("Letter")), ...letters.map((l) => button(l, () => take("letter", l), { title: t("Use this letter") }))));
    }
    return box;
  }

  private put() {
    const editing = this.editing;
    const { ok, errors } = this.table.put(this.draft, editing);
    if (!ok) {
      const first = Object.values(errors)[0];
      if (first) this.say(first);
      this.showAll = true;
      this.draw();
      return;
    }
    const id = Number(this.draft.id.trim());
    this.say(editing === null ? t("Race {n} added: {name}.", { n: id, name: this.draft.name.trim() }) : t("Race {n} changed.", { n: id }));
    this.editing = null;
    this.draft = emptyDraft();
    this.showAll = false;
    this.refresh();
  }

  private remove(id: number) {
    const was = this.table.rows.find((r) => r.id === id);
    if (!this.table.remove(id)) return;
    if (this.editing === id) { this.editing = null; this.draft = emptyDraft(); }
    this.say(t("Race {n} removed: {name}.", { n: id, name: was?.name ?? "" }));
    this.refresh();
  }
}
