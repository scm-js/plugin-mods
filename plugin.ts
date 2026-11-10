/**
 * Mod Editor — a plugin for the scmJS map editor (https://github.com/scm-js/scm-js).
 *
 * File ▸ Open a Mod… (or a mod's folder, `.mpq`, `.exe` or `.zip` dropped on the panel, or an `.mpq` / `.exe` /
 * `.zip` dropped on the editor) opens a mod into a panel under the map, with three tabs: Tables (a grid a table, every
 * field under its PyMS name, search, what each entry points at and what points at it, values edited in place),
 * Strings (the TBLs, `<NN>` escapes as PyTBL writes them) and Scripts (iscript and AI scripts as PyICE and PyAI text in
 * Monaco, assembled on every change). The editor draws from the mod while it is open — `api.gameData.attach` with a
 * reader over the mod's current files — so a change to a unit's hit points shows in Unit Settings' default at once.
 * Save writes the mod back in the form it came (an MPQ, or a folder of text as `scmjs mod unpack` lays one out),
 * Diff and Check read it the way `scmjs mod diff` and `mod check` do, and Play hands it to the play page.
 *
 * The codecs and the folder form are `@scm-js/core`'s, the same code the editor and the command line run.
 */
import type { FolderFile, GameDataProfile, PanelHandle, PluginApi } from "@scm-js/plugin-api";
import { DAT_SCHEMAS, createScenario, serializeScenario, type DatTableName, type ModChange, type ModFinding } from "@scm-js/core";
import { button, clear, ensureStyle, h } from "./dom";
import { bindLanguage, msg, t } from "./i18n";
import { foundLine, gameCopyNotice, num, sizeText } from "./info";
import { KO } from "./ko";
import { DEFAULT_DIST, DIST_STORAGE_KEY } from "./monaco";
import { PlayTab, playAddress, playMessage, playPageThere } from "./play";
import { attachReader } from "./reader";
import { changedZip, currentMembers, textFolder, writeMpq, writeZip } from "./save";
import { Look } from "./look";
import { PicturesView } from "./picturesView";
import { RaceTable, racesApi, type DataSetRace } from "./races";
import { RacesView } from "./racesView";
import { ScriptsView } from "./scriptsView";
import { SoundsView } from "./soundsView";
import { ModSession } from "./session";
import { OpenError, looksLikeMod, openPieces, type Piece } from "./source";
import { StringsView } from "./stringsView";
import { GraftsView } from "./graftsView";
import { LIVE_SERVICE, LiveSender, livePath, type LiveService } from "./live";
import { ENGINE_SERVICE, EngineRegistration, type EngineService } from "./engine";
import { TablesView, type ViewContext } from "./tablesView";

export default function activate(api: PluginApi) {
  api.i18n.register({ ko: KO });
  bindLanguage(api);
  const editor = new ModEditor(api);
  api.commands.register({ id: "open", title: msg("Open a Mod…"), run: (...args: unknown[]) => editor.openCommand(args[0]) });
  api.menu.add("File", { label: msg("Open a Mod…"), after: "Open Recent", command: "open" });
  api.ui.fileType({
    name: t("StarCraft mod"), extensions: [".mpq", ".exe", ".zip"],
    open: (files) => editor.openFiles(files.map(filePiece), files[0]?.name ?? "mod"),
    // A folder dropped anywhere on the editor: a mod when it holds the game's folders at its root or one down.
    acceptsFolder: (paths) => looksLikeMod(paths),
    openFolder: (files) => editor.openFiles(files.map(folderPiece), files[0]?.path.split("/")[0] ?? "mod"),
  });
  api.events.on("language", () => editor.relabel());
  api.events.on("gameData", () => editor.sourceChanged());
  // Live (part d): plugin-scm-sim's `scm-sim.live`, when it is installed, carries edits into a running test game.
  const watching = api.services.watch<LiveService>(LIVE_SERVICE, (service) => editor.liveService(service));
  // The open mod for the engine's pages (`engine.ts`): plugin-scm-sim 0.19.0's `provideMod`, when it is installed.
  const engine = api.services.watch<EngineService>(ENGINE_SERVICE, (service) => editor.engineService(service));
  return () => { watching.dispose(); engine.dispose(); editor.close(true); };
}

/** What the copy of the game the editor draws from keeps, by its paths: the rest it cannot say anything about. */
const COPY_HOLDS = /^(arr\/[^/]+$|scripts\/iscript\.bin$|unit\/|tileset\/|game\/|rez\/unitnames\.tbl$)/;

/** The game's files the plugin keeps once read: small, and read again by every diff, check and string table. */
const SMALL = /^(arr\/[^/]+$|scripts\/iscript\.bin$|tileset\/stat_txt\.tbl$|rez\/unitnames\.tbl$|unit\/manifest\.json$)/;

type Tab = "tables" | "strings" | "pictures" | "sounds" | "scripts" | "overlays" | "grafts" | "races";

class ModEditor {
  private readonly api: PluginApi;
  private panel: PanelHandle | null = null;
  private body: HTMLElement | null = null;
  private session: ModSession | null = null;
  private found = "";
  private tab: Tab = "tables";
  private tables: TablesView | null = null;
  private strings: StringsView | null = null;
  private scripts: ScriptsView | null = null;
  private pictures: PicturesView | null = null;
  private sounds: SoundsView | null = null;
  private overlays: ScriptsView | null = null;
  private grafts: GraftsView | null = null;
  private racesView: RacesView | null = null;
  /** The races the open mod adds (`races.ts`): from its `mod.json`, then the editor's table for it. */
  private races: RaceTable | null = null;
  /** Edits into a running test game (`live.ts`). */
  private readonly live = new LiveSender(() => this.status());
  private liveSvc: LiveService | null = null;
  /** The open mod registered with the engine by its hash (`engine.ts`). */
  private readonly engine = new EngineRegistration();
  /** The palette and team colour pictures are drawn with, shared by the Pictures tab and the previews. */
  private look: Look | null = null;
  private statusEl: HTMLElement | null = null;
  private said = "";
  /** Draw-from state: the profile handed to `attach`, the hash it carries, and the set in use before. */
  private attached: { profile: GameDataProfile; hash: string | null; label: string } | null = null;
  private before: string | null = null;
  private reader: ReturnType<typeof attachReader> | null = null;

  /** The game's small files (tables, string tables, iscript, the unit manifest) as read before the mod was laid over them. */
  private readonly baseCache = new Map<string, Uint8Array | null>();
  /** The copy's unit list, for which GRPs and overlays it has without reading each. */
  private baseManifest: { grps?: string[]; overlays?: string[] } | null = null;
  private update = { timer: 0, running: false, again: false };
  private playTab: PlayTab | null = null;
  private playThere: Promise<boolean> | null = null;
  private opening = false;

  constructor(api: PluginApi) {
    this.api = api;
  }

  /** The `scm-sim.live` service came or went. */
  liveService(service: LiveService | null) {
    this.liveSvc = service && service.present ? service : null;
    this.live.setService(this.liveSvc);
    if (this.session) this.draw();
  }

  /** The `scm-sim.engine` service came or went. */
  engineService(service: EngineService | null) { this.engine.service(service); }

  /** The mod registered with the engine as it stands: its hash while the editor draws from it, none otherwise. */
  private provide() {
    const s = this.session;
    this.engine.set(s && this.attached?.hash ? { session: s, name: s.source.name, hash: this.attached.hash } : null);
  }

  /** The game data API when the editor can draw from a set in memory (an editor from before it cannot). */
  private get gameData(): PluginApi["gameData"] | null {
    const g = this.api.gameData;
    return typeof g.attach === "function" && typeof g.rehash === "function" ? g : null;
  }

  /* ── The panel ── */

  private ensurePanel() {
    ensureStyle();
    if (this.panel?.isOpen()) return;
    this.panel = this.api.ui.panel({
      title: t("Mod Editor"),
      dock: "bottom",
      height: 380,
      mount: (body) => { this.body = h("div", { className: "mx" }); body.append(this.body); this.draw(); },
      onClose: () => { this.panel = null; this.body = null; },
    });
  }

  relabel() {
    this.panel?.setTitle(t("Mod Editor"));
    if (this.session) this.found = foundLine(this.session.source);
    this.dropViews();
    this.draw();
  }

  /** Every tab's view goes (a language change, another mod); they are made again when shown. */
  private dropViews() {
    this.scripts?.dispose(); this.overlays?.dispose(); this.sounds?.dispose();
    this.tables = null; this.strings = null; this.scripts = null; this.pictures = null; this.sounds = null; this.overlays = null; this.grafts = null; this.racesView = null;
  }

  private draw() {
    const body = this.body;
    if (!body) return;
    clear(body);
    this.statusEl = h("div", { className: "mx-status" });
    if (!this.session) { body.append(this.openScreen(), this.statusEl); this.status(); return; }
    const s = this.session;
    const tabs = h("div", { className: "mx-tabs" });
    const tabButton = (id: Tab, label: string) => h("button", { className: `mx-tab${this.tab === id ? " on" : ""}`, type: "button", dataset: { tab: id }, onclick: () => { this.tab = id; this.draw(); } }, label);
    tabs.append(tabButton("tables", t("Tables")), tabButton("strings", t("Strings")), tabButton("pictures", t("Pictures")), tabButton("sounds", t("Sounds")), tabButton("scripts", t("Scripts")), tabButton("overlays", t("Overlays")), tabButton("grafts", t("Requirements and Buttons")), tabButton("races", t("Races")));
    const bar = h("div", { className: "mx-bar" },
      h("span", { className: "mx-grow", title: this.found }, h("b", null, s.source.name), " ", h("span", { className: "mx-dim" }, this.found.replace(/^[^,]*, /, ""))),
      button(t("Open…"), () => { this.closeMod(); }, { title: t("Close this mod and open another") }),
      h("span", { className: "mx-sep" }),
      button(t("Save"), () => void this.save("same"), { title: this.saveTitle() }),
      button(t("Save as Folder"), () => void this.save("folder"), { title: t("The mod as a folder of text and pictures (scmjs mod unpack's form), in a zip") }),
      button(t("Export as MPQ"), () => void this.save("mpq"), { title: t("The mod as an MPQ the launchers load") }),
      h("span", { className: "mx-sep" }),
      button(t("Diff…"), () => this.diffDialog(), { title: t("What changed: against the game, or against the mod as it was opened") }),
      button(t("Check…"), () => void this.checkDialog(), { title: t("Look across the tables for what would break in the game") }),
      this.liveSvc
        ? button(t("Start Test Game"), () => this.testGame(), { title: t("Play the open map (or a blank one) with the mod in the play page's tab; while it runs, every edit goes into the game"), className: "primary" })
        : button(t("Play"), () => this.play(), { title: t("Play the mod on the play page, with the open map"), className: "primary" }));
    const view = h("div", { className: "mx-body" });
    body.append(bar, tabs, view, this.statusEl);
    view.append(this.view(this.tab));
    this.status();
  }

  private context(): ViewContext {
    return {
      api: this.api,
      session: this.session!,
      say: (text) => this.say(text),
      go: (table, id, field) => this.go(table, id, field),
      goScript: (id) => { this.tab = "scripts"; this.draw(); void this.scripts!.showIscript(id); },
      goString: (member, entry) => { this.tab = "strings"; this.draw(); void this.strings!.show(member, entry); },
      gameGrps: () => this.baseManifest?.grps ?? [],
      goImage: (id) => { this.tab = "pictures"; this.draw(); void this.pictures!.showImage(id); },
    };
  }

  private view(tab: Tab): HTMLElement {
    if (tab === "tables") { this.tables ??= new TablesView(this.context()); this.tables.refresh(); return this.tables.el; }
    if (tab === "strings") { this.strings ??= new StringsView(this.context()); this.strings.refresh(); return this.strings.el; }
    if (tab === "races") { this.racesView ??= new RacesView(this.races!, (text) => this.say(text)); this.racesView.refresh(); return this.racesView.el; }
    this.look ??= new Look(this.session!);
    if (tab === "pictures") { this.pictures ??= new PicturesView(this.context(), this.look); this.pictures.refresh(); return this.pictures.el; }
    if (tab === "sounds") { this.sounds ??= new SoundsView(this.context()); this.sounds.refresh(); return this.sounds.el; }
    const dist = this.api.storage.get<string>(DIST_STORAGE_KEY, DEFAULT_DIST);
    if (tab === "overlays") { this.overlays ??= new ScriptsView(this.context(), dist, ["overlay"]); this.overlays.refresh(); return this.overlays.el; }
    if (tab === "grafts") { this.grafts ??= new GraftsView(this.context(), this.liveSvc ? () => this.liveSvc!.grafts() : null); this.grafts.refresh(); return this.grafts.el; }
    this.scripts ??= new ScriptsView(this.context(), dist, ["iscript", "ai"], this.look);
    this.scripts.refresh();
    return this.scripts.el;
  }

  private go(table: DatTableName, id: number, field?: string) {
    this.tab = "tables";
    this.draw();
    this.tables!.show(table, id, field);
  }

  private openScreen(): HTMLElement {
    const zone = h("div", { className: "mx-empty", dataset: { drop: "mods" } },
      h("div", null, t("Drop a mod here: its folder, an .mpq, a mod's .exe or a .zip.")),
      h("div", { className: "mx-dim" }, t("Nothing of an .exe is run; its archive is read.")),
      h("div", { className: "mx-bar", style: "justify-content: center" },
        button(t("Choose a Folder…"), () => void this.pickFolder(), { primary: true }),
        button(t("Choose a File…"), () => void this.pickFile())));
    zone.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation(); zone.classList.remove("over");
      void droppedPieces(e.dataTransfer).then((d) => { if (d.pieces.length) void this.openFiles(d.pieces, d.name); });
    });
    return zone;
  }

  private async pickFolder() {
    const files = await this.api.ui.pickFiles({ directory: true });
    if (files.length) await this.openFiles(files.map(folderPiece), files[0].path.split("/")[0]);
  }

  private async pickFile() {
    const files = await this.api.ui.pickFiles({ accept: ".mpq,.exe,.zip", multiple: false });
    if (files.length) await this.openFiles(files.map(filePiece), files[0].name);
  }

  /* ── Status ── */

  private say(text: string) {
    this.said = text;
    this.status();
  }

  private status() {
    const el = this.statusEl;
    if (!el) return;
    const parts: string[] = [];
    if (this.said) parts.push(this.said);
    if (this.session && this.liveSvc) parts.push(this.live.alone ? t("Live: a test game is running alone; each edit goes into it.") : t("No test game is running: edits stay in the mod until the next one."));
    if (this.live.line && this.live.alone) parts.unshift(this.live.line);
    if (this.session) {
      if (this.attached) parts.push(this.attached.label);
      else if (!this.gameData) parts.push(t("This editor cannot draw from a mod in memory; update it to see the edits on the map."));
      else parts.push(t("The editor is not drawing from this mod now."));
    }
    el.textContent = parts.join("  ·  ");
    el.title = el.textContent;
  }

  /* ── Opening ── */

  /** `mods.open` for another plugin or a script: no argument opens the panel; `File[]` (or `{ path, file }[]`) opens those. */
  async openCommand(arg?: unknown) {
    this.ensurePanel();
    if (!Array.isArray(arg) || !arg.length) return;
    const pieces: Piece[] = arg.map((x: File | { path: string; file: File }) => (x instanceof File ? filePiece(x) : { path: x.path, size: x.file.size, read: async () => new Uint8Array(await x.file.arrayBuffer()) }));
    const first = arg[0] instanceof File ? ((arg[0] as File).webkitRelativePath || (arg[0] as File).name) : (arg[0] as { path: string }).path;
    await this.openFiles(pieces, pieces.length > 1 ? first.split("/")[0] : first);
  }

  async openFiles(pieces: Piece[], name: string) {
    if (this.opening) return;
    this.ensurePanel();
    if (this.session && !(await this.api.ui.confirm(t("Close {name} and open another mod? Changes not saved are lost.", { name: this.session.source.name })))) return;
    this.opening = true;
    this.closeMod(false, false);
    this.say(t("Opening {name}…", { name }));
    try {
      const t0 = performance.now();
      const base = this.api.gameData.source()?.kind === "none" ? null : (member: string) => this.baseRead(member);
      this.baseCache.clear();
      if (base) await this.readBaseManifest();
      const source = await openPieces(pieces, name, base);
      const session = await ModSession.open(source, { base, baseHas: base ? (m) => this.baseHas(m) : undefined });
      this.session = session;
      this.races = new RaceTable({ gameData: racesApi(this.api.gameData), profileId: () => (this.session === session ? this.profile().id : null), ours: () => this.session === session && this.isOurs() }, source.races);
      this.found = foundLine(source);
      this.tab = "tables";
      session.onChange(() => this.edited());
      this.live.follow(session);
      this.said = t("Opened in {s} s. {found}", { s: ((performance.now() - t0) / 1000).toFixed(1), found: this.found });
      this.api.ui.status(this.found);
      // A copy of the game handed over with the mod was left out: said where it cannot be missed, kept until dismissed.
      const copy = gameCopyNotice(source);
      if (copy) this.api.ui.toast({ kind: "warn", title: copy, ttl: 0 });
      this.draw();
      await this.attach();
    } catch (e) {
      this.session = null;
      this.say(e instanceof OpenError ? e.message : t("The mod could not be opened: {error}", { error: e instanceof Error ? e.message : String(e) }));
      this.draw();
    } finally {
      this.opening = false;
    }
  }

  /** `restore`: put the editor back on the data set it drew from before (not when another mod is about to replace it). */
  private closeMod(redraw = true, restore = true) {
    this.dropViews();
    this.look = null;
    const ours = !!this.attached && this.isOurs();
    this.session = null;
    this.races = null;
    this.live.follow(null);
    this.attached = null;
    this.reader = null;
    this.provide();
    clearTimeout(this.update.timer);
    // Put the editor back on the data set it drew from before, if nothing else moved it meanwhile.
    if (ours && restore) void (async () => this.api.gameData.select(this.before ?? (await this.api.gameData.profiles())[0]?.id ?? "starcraft"))().catch(() => undefined);
    this.said = "";
    if (redraw) this.draw();
  }

  close(disposing = false) {
    this.closeMod(!disposing);
    this.playTab?.dispose();
    this.live.dispose();
    this.engine.dispose();
    if (disposing) this.panel?.close();
  }

  /* ── The game's own files, read past the mod ── */

  /**
   * A file of the game beneath the mod, by member: `gameData.read(…, { under: true })` reads the set the mod is laid
   * over without asking the mod's reader. Only paths the editor's copy keeps are asked; the small files are kept.
   */
  private async baseRead(member: string): Promise<Uint8Array | null> {
    const stored = this.api.gameData.storedPath(member);
    if (!COPY_HOLDS.test(stored)) return null;
    if (this.baseCache.has(stored)) return this.baseCache.get(stored)!;
    const bytes = await this.api.gameData.read(stored, { under: true });
    if (SMALL.test(stored)) this.baseCache.set(stored, bytes);
    return bytes;
  }

  private async readBaseManifest() {
    const bytes = await this.api.gameData.read("unit/manifest.json", { under: true });
    try { this.baseManifest = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null; } catch { this.baseManifest = null; }
  }

  /** Whether the copy has a member, from its unit manifest where that lists it (no fetch), else by reading it. */
  private async baseHas(member: string): Promise<boolean | null> {
    const stored = this.api.gameData.storedPath(member);
    if (!COPY_HOLDS.test(stored)) return null;
    const m = this.baseManifest;
    const under = stored.startsWith("unit/") && !stored.startsWith("unit/cmdbtns/") ? stored.slice(5).replace(/\//g, "\\") : null;
    if (under && m?.grps && /\.grp$/.test(under)) return m.grps.some((g) => g.toLowerCase() === under);
    if (under && m?.overlays && /\.lo[a-z]$/.test(under)) return m.overlays.some((g) => g.toLowerCase() === under);
    return !!(await this.baseRead(member));
  }

  /* ── Drawing from the mod ── */

  /**
   * The profile the mod is attached under. It carries the races the panel has for the mod (from its `mod.json`, or as
   * the person named them), so the editor keeps them for the id; with none it carries no `races`, and the editor keeps
   * what it had for the id. (An editor from before races a data set adds ignores the field.)
   */
  private profile(): GameDataProfile {
    const name = this.session!.source.name;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mod";
    const races = this.races?.rows ?? [];
    const profile: GameDataProfile & { races?: DataSetRace[] } = { id, name, ...(races.length ? { races: races.map((r) => ({ ...r })) } : {}) };
    return profile;
  }

  private isOurs(): boolean {
    const s = this.api.gameData.source();
    return !!s && s.kind === "reader" && !!this.attached && s.profile.id === this.attached.profile.id;
  }

  /**
   * Hands the editor a reader over the mod's current files. The hash (over the files that differ from the game's) is
   * what a map saved now records: a small mod's goes with the reader, a large one's follows by `rehash` once worked out,
   * the editor drawing from the mod meanwhile.
   */
  private async attach() {
    const gd = this.gameData;
    const session = this.session;
    if (!gd || !session) { this.status(); return; }
    const now = this.api.gameData.source();
    this.before = now && now.kind !== "reader" ? now.profile.id : this.before;
    this.reader = attachReader({ has: (m) => session.has(m), read: (m) => session.read(m) });
    const profile = this.profile();
    const bytes = [...session.source.files.values()].reduce((n, f) => n + f.size, 0);
    const hash = bytes < 64 * 1024 * 1024 ? await session.hash() : null;
    if (this.session !== session) return;
    const source = await gd.attach(profile, this.reader, hash ? { hash } : undefined);
    this.attached = { profile, hash, label: this.attachedLabel(source.label, hash) };
    // The editor's table for the mod: what was handed in, or what it kept for the id before.
    if (this.races?.load()) this.racesView?.refresh();
    this.provide();
    this.status();
    if (!hash) {
      this.say(t("Working out the mod's hash over {size}…", { size: sizeText(bytes) }));
      const later = await session.hash();
      if (this.session !== session || !this.isOurs()) return;
      const again = gd.rehash(later);
      this.attached = { profile, hash: later, label: this.attachedLabel(again?.label ?? source.label, later) };
      this.provide();
      this.say(t("The mod's hash is {hash}.", { hash: later }));
    }
  }

  private attachedLabel(label: string, hash: string | null): string {
    return t("{label}{hash}: the unit palette, the settings dialogs' defaults and the units drawn follow the mod's files as you edit them.", { label, hash: hash ? ` (${hash})` : "" });
  }

  /** The editor's data set moved: another was chosen, or ours came back. */
  sourceChanged() {
    // (Races named for the mod elsewhere — another plugin, a script — show here.)
    if (this.attached && this.isOurs() && this.races?.load() && this.tab === "races") this.racesView?.refresh();
    if (!this.attached || this.isOurs()) return;
    this.attached = null;
    this.provide();
    this.say(t("Another data set was chosen, so the editor no longer draws from {name}. Edit anything to draw from it again.", { name: this.session?.source.name ?? "" }));
  }

  /** An edit: redraw the views, and a moment later have the editor read the mod's files again. */
  private edited() {
    if (this.tab === "tables") this.tables?.refresh();
    else if (this.tab === "strings") this.strings?.refresh();
    else if (this.tab === "pictures") this.pictures?.refresh();
    else if (this.tab === "sounds") this.sounds?.refresh();
    else if (this.tab === "overlays") this.overlays?.refresh();
    else if (this.tab === "grafts") this.grafts?.refresh();
    else if (this.tab === "races") this.racesView?.refresh();
    else this.scripts?.refresh();
    clearTimeout(this.update.timer);
    this.update.timer = window.setTimeout(() => void this.redraw(), 400);
  }

  private async redraw() {
    if (this.update.running) { this.update.again = true; return; }
    const gd = this.gameData, session = this.session;
    if (!gd || !session || !this.reader) return;
    this.update.running = true;
    try {
      if (!this.attached || !this.isOurs()) {
        // Another data set was chosen meanwhile: draw from the mod again.
        await this.attach();
      } else {
        // Draw from the edit at once, and name it when its digest is ready (only the edited member is read again).
        gd.reload();
        const hash = await session.hash();
        if (this.session !== session) return;
        if (hash !== this.attached.hash) {
          const source = gd.rehash(hash);
          this.attached = { profile: this.attached.profile, hash, label: this.attachedLabel(source?.label ?? "", hash) };
          this.provide();
        }
      }
      const edited = await session.edited();
      this.said = edited.length ? t("{n, plural, one {{count} file edited} other {{count} files edited}}: {files}.", { n: edited.length, count: num(edited.length), files: edited.slice(0, 4).map((k) => session.nameOf(k)).join(", ") + (edited.length > 4 ? " …" : "") }) : t("No file differs from the mod as it was opened.");
      this.status();
    } finally {
      this.update.running = false;
      if (this.update.again) { this.update.again = false; void this.redraw(); }
    }
  }

  /* ── Save, export ── */

  private saveTitle(): string {
    const kind = this.session?.source.kind;
    return kind === "mod folder" ? t("The folder of text and pictures, in a zip") : kind === "folder" ? t("The files you changed, in their folders, in a zip: copy them over the mod's folder") : t("The mod as an MPQ");
  }

  private async save(how: "same" | "folder" | "mpq") {
    const s = this.session;
    if (!s) return;
    const errors = s.scriptErrors();
    if (errors.length && !(await this.api.ui.confirm(t("{n, plural, one {{count} script does not assemble} other {{count} scripts do not assemble}} ({first}); the last text that did is what is saved. Save anyway?", { n: errors.length, count: num(errors.length), first: t("{file}, line {line}", { file: errors[0].doc.label, line: errors[0].error.line }) })))) return;
    const form = how === "same" ? (s.source.kind === "mod folder" ? "folder" : s.source.kind === "folder" ? "changes" : "mpq") : how;
    const progress = this.api.ui.progress(t("Writing {name}…", { name: s.source.name }));
    try {
      let bytes: Uint8Array, fileName: string, what: string;
      if (form === "mpq") {
        const members = await currentMembers(s);
        progress.report(0.3, t("Packing {n} files…", { n: num(members.length) }));
        bytes = await writeMpq(members);
        fileName = `${s.source.name}.mpq`;
        what = t("{n} files in an MPQ, {size}", { n: num(members.length), size: sizeText(bytes.length) });
      } else if (form === "folder") {
        const { files, manifest } = await textFolder(s, (done, total) => progress.report(done / total * 0.9, t("{done} of {total} files…", { done: num(done), total: num(total) })), this.races?.rows ?? s.source.races);
        bytes = writeZip(files, s.source.name);
        fileName = `${s.source.name}.zip`;
        const kept = manifest.kept.reduce((n, k) => n + k.files.length, 0);
        what = t("{n} files of text and pictures in a zip, {size}{kept}", { n: num(files.length), size: sizeText(bytes.length), kept: kept ? t("; {k} kept as bytes (mod.json says why)", { k: num(kept) }) : "" });
      } else {
        const changed = await changedZip(s);
        if (!changed.count) { this.say(t("No file differs from the mod as it was opened: nothing to save.")); return; }
        bytes = changed.zip;
        fileName = `${s.source.name}-changes.zip`;
        what = t("{n, plural, one {{count} changed file} other {{count} changed files}} in a zip, to copy over the mod's folder", { n: changed.count, count: num(changed.count) });
      }
      progress.report(0.95, t("Saving…"));
      const where = await this.api.ui.saveFile(bytes, fileName);
      this.say(where ? t("Saved {file}: {what}.", { file: where.fileName, what }) : t("Not saved."));
    } catch (e) {
      this.say(t("Not saved: {error}", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      progress.done();
    }
  }

  /* ── Diff and Check ── */

  private diffDialog() {
    const s = this.session;
    if (!s) return;
    let against: "game" | "opened" = s.base ? "game" : "opened";
    let lines: ModChange[] = [];
    this.api.ui.dialog({
      title: t("What changed in {name}", { name: s.source.name }),
      size: "lg",
      tall: true,
      mount: (body) => {
        const pick = h("select", { onchange: () => { against = pick.value as "game" | "opened"; void fill(); } },
          h("option", { value: "game", disabled: !s.base }, t("Against the game")), h("option", { value: "opened" }, t("Against the mod as it was opened")));
        pick.value = against;
        const count = h("span", { className: "mx-dim" });
        const out = h("pre", { className: "mx-lines" });
        body.append(h("div", { className: "mx mx-dlg" }, h("div", { className: "mx-bar" }, pick, count), out));
        const fill = async () => {
          count.textContent = t("Reading…");
          out.textContent = "";
          lines = await s.diff(against);
          count.textContent = t("{n, plural, one {{count} change} other {{count} changes}}", { n: lines.length, count: num(lines.length) });
          out.textContent = lines.length ? lines.map((c) => c.text).join("\n") : t("Nothing differs.");
        };
        void fill();
      },
      buttons: [
        { label: t("Copy"), closes: false, run: async () => { await navigator.clipboard.writeText(lines.map((c) => c.text).join("\n")).catch(() => undefined); this.api.ui.toast({ kind: "ok", title: t("Copied") }); } },
        { label: t("Close"), primary: true },
      ],
    });
  }

  private async checkDialog() {
    const s = this.session;
    if (!s) return;
    this.say(t("Checking…"));
    const findings = await s.check();
    const errors = findings.filter((f) => f.level === "error").length;
    this.say(findings.length ? t("Check: {e} errors, {w} warnings.", { e: num(errors), w: num(findings.length - errors) }) : t("Check: nothing found."));
    const dialog = this.api.ui.dialog({
      title: t("Check {name}", { name: s.source.name }),
      size: "lg",
      tall: findings.length > 12,
      mount: (body) => {
        const root = h("div", { className: "mx mx-dlg" });
        body.append(root);
        if (!findings.length) { root.append(h("p", null, t("Nothing found: every reference lands in its table, every picture and script the mod's images name is there."))); return; }
        root.append(h("p", { className: "mx-dim" }, t("{e} errors (what breaks or shows nothing in the game) and {w} warnings (what is probably a mistake). Click one to go to it.", { e: num(errors), w: num(findings.length - errors) })));
        const list = h("div", { style: "overflow: auto; flex: 1; min-height: 0" });
        for (const f of findings) list.append(this.findingRow(f, () => dialog.close()));
        root.append(list);
      },
      buttons: [{ label: t("Close"), primary: true }],
    });
  }

  private findingRow(f: ModFinding, close: () => void): HTMLElement {
    const m = /^(units|weapons|flingy|sprites|images|upgrades|techdata|orders|sfxdata|portdata|mapdata) (\d+)(?: \([^)]*\))?(?: (\S+))?$/.exec(f.where);
    const iscript = /^iscript (\d+)$/.exec(f.where);
    return h("div", {
      className: "mx-finding", title: f.rule,
      onclick: () => {
        if (m && DAT_SCHEMAS[m[1] as DatTableName]) { close(); this.go(m[1] as DatTableName, Number(m[2]), m[3]); }
        else if (iscript) { close(); this.tab = "scripts"; this.draw(); void this.scripts!.showIscript(Number(iscript[1])); }
      },
    }, h("span", { className: `lvl ${f.level}` }, f.level === "error" ? "●" : "▲"), h("span", { className: "where" }, f.where), h("span", { className: "why" }, f.why));
  }

  /* ── A test game, live ── */

  /**
   * The open map (or a blank one) played with the mod in the play page's tab, through `scm-sim.live`: the page keeps
   * the mod's files, loads again on them and starts the map. While it runs alone, each edit goes into it (`live.ts`).
   */
  private testGame() {
    const s = this.session, svc = this.liveSvc;
    if (!s || !svc) return;
    this.say(t("Handing {name} to the play page…", { name: s.source.name }));
    // The tab is opened from the click itself: the service opens it before anything is awaited.
    const test = (async () => {
      const files = await s.changedFiles();
      if (!files.length) throw new Error(t("{name} changes nothing of the game here: every file is the game's own.", { name: s.source.name }));
      const hash = await s.hash();
      let map: { bytes: Uint8Array; name: string } | null = null, blank = false;
      if (this.api.document.isOpen()) {
        const file = await this.api.document.export();
        if (file) map = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
      }
      if (!map) {
        // A blank map, 64 × 64 badlands, played with its own settings (it has no start locations for a melee game).
        // (A bare scenario, which the play page takes as it is: no archive writer in the plugin for it.)
        map = { bytes: serializeScenario(createScenario({ width: 64, height: 64, era: 0, name: t("Blank map") })), name: "blank.chk" };
        blank = true;
      }
      return { map, mod: { name: s.source.name, hash, files: files.map((f) => ({ path: livePath(f.name), bytes: f.bytes })) }, ...(blank ? { useMapSettings: true } : {}) };
    })();
    svc.play(test).then(
      (outcome) => this.say(outcome === "started" ? t("The test game is running with {name}: each edit goes into it.", { name: s.source.name }) : t("The play page has {name}; choose a map there.", { name: s.source.name })),
      (e) => this.say(t("The play page said: {message}", { message: e instanceof Error ? e.message : String(e) })),
    );
  }

  /* ── Play ── */

  private play() {
    const s = this.session;
    if (!s) return;
    const address = playAddress();
    this.playThere ??= playPageThere(address);
    // The tab is opened from the click itself; a browser refuses a tab opened after the work that follows.
    this.playTab ??= new PlayTab(address);
    void this.playThere.then(async (there) => {
      if (!there) { this.say(t("There is no play page at {address}: it is served beside the editor on scmjs.dev, not by a development server of the editor alone.", { address })); return; }
      if (!this.playTab!.openTab()) { this.say(t("The browser did not open the play page's tab. Allow pop-ups for this page and press Play again.")); return; }
      this.say(t("Handing {name} to the play page…", { name: s.source.name }));
      const files = await s.changedFiles();
      if (!files.length) { this.say(t("{name} changes nothing of the game here: every file is the game's own.", { name: s.source.name })); return; }
      const hash = await s.hash();
      let map: { bytes: Uint8Array; name: string } | null = null;
      if (this.api.document.isOpen()) {
        const file = await this.api.document.export();
        if (file) map = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
      }
      try {
        const outcome = await this.playTab!.play(playMessage({ name: s.source.name, hash, files, map }));
        this.say(outcome === "started"
          ? t("Playing {map} with {name} ({n} files, {hash}).", { map: map?.name ?? "", name: s.source.name, n: num(files.length), hash })
          : t("The play page has {name} ({n} files, {hash}); choose a map there.", { name: s.source.name, n: num(files.length), hash }));
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        this.say(why === "timeout" ? t("The play page did not answer. Is it open in another tab?") : t("The play page said: {message}", { message: why }));
      }
    });
  }
}

/** A file of a picked or dropped folder (`ui.pickFiles({ directory: true })`, `fileType.openFolder`) as a piece. */
function folderPiece(f: FolderFile): Piece {
  return { path: f.path, size: f.file.size, read: async () => new Uint8Array(await f.file.arrayBuffer()) };
}

/** A picked or dropped `File` as a piece, under its folder path when the picker gave one. */
function filePiece(f: File): Piece {
  return { path: f.webkitRelativePath || f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) };
}

/** What was dropped, folders walked: each file under its path from the dropped folder. */
async function droppedPieces(transfer: DataTransfer | null): Promise<{ pieces: Piece[]; name: string }> {
  if (!transfer) return { pieces: [], name: "" };
  const entries = [...transfer.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return { pieces: [...transfer.files].map(filePiece), name: transfer.files[0]?.name ?? "" };
  const pieces: Piece[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      pieces.push({ path: entry.fullPath.replace(/^\/+/, ""), size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return { pieces, name: entries[0].name };
}
