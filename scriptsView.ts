/**
 * The Scripts tab: the mod's animation scripts (each `scripts\*.bin` as PyICE text) and its AI scripts (aiscript.bin
 * and bwscript.bin as one PyAI text) in Monaco, coloured, with completion of commands and of ids by name. Every change
 * is assembled a moment later by the same assembler `scmjs mod pack` uses; an error is marked on its line and the
 * script keeps the last text that assembled until it does again.
 */
import { entryText, type DatTableName } from "@scm-js/core";
import type * as Monaco from "monaco-editor";
import { clear, h } from "./dom";
import { t } from "./i18n";
import { num } from "./info";
import { PYAI, PYICE, PYLO, registerLanguages, type Named, type ScriptNames } from "./languages";
import type { Look } from "./look";
import { AnimPreview } from "./preview";
import { ScriptIndex } from "./animate";
import { DEFAULT_DIST, THEME, loadMonaco, type MonacoApi } from "./monaco";
import type { ModSession, ScriptDoc } from "./session";
import type { ViewContext } from "./tablesView";

let current: ModSession | null = null;

/** The open mod's names, for the completion lists (registered once per Monaco, so read through here). */
function namesOf(session: ModSession): ScriptNames {
  const list = (table: DatTableName): Named[] => {
    const file = session.table(table);
    return file ? Array.from({ length: file.count }, (_, id) => ({ id, label: session.entryName(table, id) })).filter((n) => n.label) : [];
  };
  const ai = (names: string[]) => [...new Set(names.filter((n) => n && !/^\s*(0x[0-9a-f]+|\d+)\s*$/i.test(n)))];
  return {
    images: () => list("images"),
    sprites: () => list("sprites"),
    sounds: () => {
      const sfx = session.table("sfxdata");
      const files = session.data.strings.sfxdata;
      return sfx && files ? Array.from({ length: sfx.count }, (_, id) => ({ id, label: entryText(files[sfx.columns.sound_file[id] - 1]) })).filter((n) => n.label) : [];
    },
    weapons: () => list("weapons"),
    aiUnits: () => ai(session.data.names.units),
    aiUpgrades: () => ai(session.data.names.upgrades),
    aiTechnologies: () => ai(session.data.names.technologies),
  };
}

export class ScriptsView {
  readonly el: HTMLElement;
  private readonly ctx: ViewContext;
  private readonly list: HTMLElement;
  private readonly host: HTMLElement;
  private readonly say: HTMLElement;
  private monaco: MonacoApi | null = null;
  private editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private readonly models = new Map<string, Monaco.editor.ITextModel>();
  private open: ScriptDoc | null = null;
  private timer = 0;
  private readonly dist: string;
  private readonly kinds: ScriptDoc["kind"][];
  private readonly preview: AnimPreview | null;
  private query = "";
  private cursorTimer = 0;

  /** `kinds`: the scripts this tab lists (the Scripts tab's iscript and AI, the Overlays tab's overlays). */
  constructor(ctx: ViewContext, dist: string = DEFAULT_DIST, kinds: ScriptDoc["kind"][] = ["iscript", "ai"], look?: Look) {
    this.ctx = ctx;
    this.dist = dist;
    this.kinds = kinds;
    current = ctx.session;
    this.list = h("div", { className: "mx-list" });
    this.host = h("div", { className: "mx-editor" });
    this.say = h("div", { className: "mx-say mx-dim" }, kinds.includes("overlay") ? t("Choose an overlay file.") : t("Choose a script."));
    this.preview = look && kinds.includes("iscript") ? new AnimPreview(ctx.session, () => look.current()) : null;
    const search = h("input", { type: "search", placeholder: t("Search"), style: "width: 100%", oninput: () => { this.query = search.value.toLowerCase(); this.drawList(); } });
    const many = this.docs().length > 20;
    this.el = h("div", { className: `mx-scripts${this.preview ? " with-preview" : ""}` },
      h("div", { className: "mx-col" }, many ? h("div", { className: "mx-bar" }, search) : null, this.list),
      h("div", { className: "mx-col" }, this.host, this.say),
      this.preview ? h("div", { className: "mx-side" }, h("h4", null, t("Preview")), h("p", { className: "mx-faint" }, t("The animation of the script at the cursor, for the first image that uses it.")), this.preview.el) : null);
    if (look) void look.load();
    this.drawList();
  }

  private docs(): ScriptDoc[] {
    return this.ctx.session.scripts.filter((d) => this.kinds.includes(d.kind));
  }

  private drawList() {
    clear(this.list);
    const errors = new Set(this.ctx.session.scriptErrors().map((e) => e.doc.id));
    const docs = this.docs();
    if (!docs.length) this.list.append(h("p", { className: "mx-dim", style: "padding: 6px" }, this.kinds.includes("overlay") ? t("The mod has no overlay files.") : t("The mod has no animation or AI scripts.")));
    for (const doc of docs.filter((d) => !this.query || d.label.toLowerCase().includes(this.query))) {
      this.list.append(h("div", { className: `item${doc === this.open ? " on" : ""}`, title: doc.members.join(", "), dataset: { id: doc.id }, onclick: () => void this.show(doc.id) },
        doc.label, doc.fromGame ? h("span", { className: "tag" }, t("the game's")) : null, errors.has(doc.id) ? h("span", { className: "err" }, "●") : null));
    }
  }

  refresh() {
    this.drawList();
  }

  /** Opens a script; `line` puts the cursor there. */
  async show(id: string, line?: number) {
    const doc = this.ctx.session.script(id);
    if (!doc) return;
    this.open = doc;
    this.drawList();
    const state = await this.ctx.session.scriptState(id);
    if (state.unreadable !== null || state.text === null) {
      this.editor?.setModel(null);
      this.say.className = "mx-say mx-danger";
      this.say.textContent = t("{file} cannot be shown as text: {why}", { file: doc.members[0], why: state.unreadable ?? "" });
      return;
    }
    const monaco = await this.load();
    if (!monaco) return;
    let model = this.models.get(id);
    if (!model) {
      model = monaco.editor.createModel(state.text, doc.kind === "ai" ? PYAI : doc.kind === "overlay" ? PYLO : PYICE, monaco.Uri.parse(`mods:///${doc.label}`));
      model.onDidChangeContent(() => this.changed(doc, model!));
      this.models.set(id, model);
    }
    this.editor!.setModel(model);
    this.mark(doc, model);
    if (line) { this.editor!.revealLineInCenter(line); this.editor!.setPosition({ lineNumber: line, column: 1 }); }
    this.editor!.focus();
  }

  /** Opens the iscript that defines `iscriptId`, at its header. */
  async showIscript(iscriptId: number) {
    for (const doc of this.ctx.session.scripts.filter((d) => d.kind === "iscript")) {
      const state = await this.ctx.session.scriptState(doc.id);
      const lines = (state.text ?? "").split("\n");
      const at = lines.findIndex((l) => new RegExp(`^IsId\\s+${iscriptId}\\s*(#.*)?$`).test(l));
      if (at >= 0) return this.show(doc.id, at + 1);
    }
    this.ctx.say(t("No script defines iscript {id}.", { id: iscriptId }));
  }

  private async load(): Promise<MonacoApi | null> {
    if (this.monaco) return this.monaco;
    this.say.className = "mx-say mx-dim";
    this.say.textContent = t("Loading the code editor…");
    try {
      const monaco = await loadMonaco(this.dist);
      registerLanguages(monaco, () => (current ? namesOf(current) : null));
      this.monaco = monaco;
      this.editor = monaco.editor.create(this.host, { model: null, theme: THEME, automaticLayout: true, minimap: { enabled: false }, fontSize: 12, tabSize: 8, insertSpaces: false, renderWhitespace: "none", scrollBeyondLastLine: false, wordBasedSuggestions: "off" });
      this.editor.onDidChangeCursorPosition(() => { clearTimeout(this.cursorTimer); this.cursorTimer = window.setTimeout(() => this.follow(), 250); });
      return monaco;
    } catch (err) {
      this.say.className = "mx-say mx-danger";
      this.say.textContent = t("The code editor could not be loaded: {error}", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  private changed(doc: ScriptDoc, model: Monaco.editor.ITextModel) {
    clearTimeout(this.timer);
    this.say.className = "mx-say mx-dim";
    this.say.textContent = t("Assembling…");
    this.timer = window.setTimeout(async () => {
      await this.ctx.session.setScriptText(doc.id, model.getValue());
      if (this.open === doc) this.mark(doc, model);
      this.drawList();
      this.preview?.refresh();
    }, 350);
  }

  /**
   * The preview follows the cursor: the header above it names the iscript id, and the first image that plays it is
   * shown — an image whose id is this file's (a mod with several iscript files picks the file by the id's high word).
   */
  private follow() {
    const model = this.editor?.getModel();
    const doc = this.open;
    if (!this.preview || !model || doc?.kind !== "iscript") return;
    const line = this.editor!.getPosition()?.lineNumber ?? 1;
    let id = -1;
    for (let l = line; l >= 1 && id < 0; l--) { const m = /^IsId\s+(\d+)/.exec(model.getLineContent(l)); if (m) id = Number(m[1]); }
    if (id < 0) return;
    void (async () => {
      const images = this.ctx.session.table("images");
      if (!images) return;
      if (!this.index || this.indexAt !== this.ctx.session.revision) {
        const files: { member: string; bytes: Uint8Array }[] = [];
        for (const d of this.ctx.session.scripts.filter((x) => x.kind === "iscript")) { const b = await this.ctx.session.readOver(d.members[0]); if (b) files.push({ member: d.members[0], bytes: b }); }
        this.index = new ScriptIndex(files, images.columns.iscript_id);
        this.indexAt = this.ctx.session.revision;
      }
      let image = -1;
      for (let i = 0; i < images.count && image < 0; i++) {
        const v = images.columns.iscript_id[i] >>> 0;
        if ((v & 0xffff) === id && this.index.find(v)?.member === doc.members[0]) image = i;
      }
      if (image !== this.shownImage) { this.shownImage = image; await this.preview!.show(image >= 0 ? image : null); }
    })();
  }

  private index: ScriptIndex | null = null;
  private indexAt = -1;
  private shownImage = -2;

  /** The assembler's verdict, on the line it named and under the editor. */
  private async mark(doc: ScriptDoc, model: Monaco.editor.ITextModel) {
    const monaco = this.monaco!;
    const state = await this.ctx.session.scriptState(doc.id);
    const e = state.error;
    if (e) {
      const line = Math.max(1, Math.min(e.line || 1, model.getLineCount()));
      monaco.editor.setModelMarkers(model, "mods", [{ severity: monaco.MarkerSeverity.Error, message: e.message, startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }]);
      this.say.className = "mx-say mx-danger";
      this.say.textContent = e.line ? t("Line {line}: {message}. The script keeps its last text that assembled.", { line: e.line, message: e.message }) : t("{message}. The script keeps its last text that assembled.", { message: e.message });
      return;
    }
    monaco.editor.setModelMarkers(model, "mods", []);
    const bytes = await this.ctx.session.read(doc.members[0]) ?? await this.ctx.session.readOver(doc.members[0]);
    this.say.className = "mx-say mx-dim";
    this.say.textContent = t("{file}: {lines} lines, {bytes} bytes as assembled.", { file: doc.members.join(" + "), lines: num(model.getLineCount()), bytes: num(bytes?.length ?? 0) });
  }

  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.cursorTimer);
    this.preview?.stop();
    this.editor?.dispose();
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    if (current === this.ctx.session) current = null;
  }
}
