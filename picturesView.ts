/**
 * The Pictures tab: every GRP the mod has, and the game's its images name, with the images that draw each. The chosen
 * one is drawn frame by frame, as a sheet, or animated by an image's script, in a tileset's palette with a team colour.
 * Import a PNG (a sheet, or one frame in place of the frame shown) with the colours it loses shown before it is used;
 * export a GRP as a PNG sheet. An imported picture is the mod's file at once, and the map draws with it.
 */
import { decodeGrpImage, type GrpImage } from "@scm-js/core";
import { button, clear, h } from "./dom";
import { msg, t, translate } from "./i18n";
import { num, sizeText } from "./info";
import type { Look } from "./look";
import { PALETTES, exportPng, frameRgba, importPng, pictureList, sheetRgba, type ImportPlan, type PictureEntry } from "./pictures";
import { AnimPreview } from "./preview";
import type { ViewContext } from "./tablesView";

type Mode = "frames" | "sheet" | "animation";

/** The first eight `tunit.pcx` rows, as the game's player colours are called; the file has sixteen. */
const TEAM_NAMES = [msg("Red"), msg("Blue"), msg("Teal"), msg("Purple"), msg("Orange"), msg("Brown"), msg("White"), msg("Yellow")];

export class PicturesView {
  readonly el: HTMLElement;
  private readonly ctx: ViewContext;
  private readonly look: Look;
  private entries: PictureEntry[] = [];
  private shown: PictureEntry[] = [];
  private selected: PictureEntry | null = null;
  private grp: GrpImage | null = null;
  private bytes: Uint8Array | null = null;
  private frame = 0;
  private mode: Mode = "frames";
  private query = "";
  private onlyOwn = false;
  private revision = -1;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly info: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly modeBar: HTMLElement;
  private readonly preview: AnimPreview;

  constructor(ctx: ViewContext, look: Look) {
    this.ctx = ctx;
    this.look = look;
    this.preview = new AnimPreview(ctx.session, () => this.look.current());
    this.list = h("div", { className: "mx-list mx-pics" });
    this.count = h("div", { className: "mx-dim mx-count", style: "padding: 2px 6px" });
    const search = h("input", { type: "search", placeholder: t("Search paths"), style: "width: 100%", oninput: () => { this.query = search.value; this.filter(); } });
    const own = h("input", { type: "checkbox", onchange: () => { this.onlyOwn = own.checked; this.filter(); } });
    const palette = h("select", { title: t("Palette"), onchange: () => { this.look.palette = palette.value; void this.look.load().then(() => this.draw()); } },
      ...PALETTES.map((p) => h("option", { value: p }, p)));
    palette.value = this.look.palette;
    const team = h("select", { title: t("Team colour (tunit.pcx)"), onchange: () => { this.look.team = Number(team.value); this.draw(); } },
      h("option", { value: "-1" }, t("No team colour")), ...Array.from({ length: 16 }, (_, i) => h("option", { value: String(i) }, TEAM_NAMES[i] ? t("Team colour: {name}", { name: translate(TEAM_NAMES[i]) }) : t("Team colour: row {n}", { n: i }))));
    team.value = String(this.look.team);
    this.modeBar = h("span", { className: "mx-bar", style: "padding: 0" });
    this.info = h("div", { className: "mx-dim", style: "padding: 2px 6px; white-space: normal" });
    this.stage = h("div", { className: "mx-stagewrap" });
    this.stage.addEventListener("dragover", (e) => { e.preventDefault(); });
    this.stage.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) void this.importFile(f); });
    this.el = h("div", { className: "mx-pictures" },
      h("div", { className: "mx-col" }, h("div", { className: "mx-bar" }, search), h("label", { className: "mx-dim", style: "padding: 0 6px" }, own, t("Only the mod's own")), this.count, this.list),
      h("div", { className: "mx-col" },
        h("div", { className: "mx-bar" }, this.modeBar, h("span", { className: "mx-sep" }), palette, team, h("span", { className: "mx-sep" }),
          button(t("Import PNG…"), () => void this.pickPng(), { title: t("A sheet replaces every frame; a picture one frame in size replaces the frame shown") }),
          button(t("Export PNG"), () => void this.exportSheet())),
        this.info, this.stage));
    void this.look.load().then(() => this.refresh());
  }

  /** The list again (after an edit or a language change), keeping the choice. */
  refresh() {
    if (this.revision === this.ctx.session.revision && this.entries.length) { this.preview.refresh(); return; }
    this.revision = this.ctx.session.revision;
    this.entries = pictureList(this.ctx.session, this.ctx.gameGrps());
    const keep = this.selected?.member;
    this.filter();
    const again = keep ? this.entries.find((e) => e.member === keep) : this.shown[0];
    if (again) void this.choose(again, true);
  }

  private filter() {
    const q = this.query.trim().toLowerCase();
    this.shown = this.entries.filter((e) => (!this.onlyOwn || e.own) && (!q || e.member.includes(q)));
    const own = this.entries.filter((e) => e.own).length;
    this.count.textContent = t("{own} GRPs in the mod, {game} of the game's; {shown} shown", { own: num(own), game: num(this.entries.length - own), shown: num(this.shown.length) });
    clear(this.list);
    for (const e of this.shown.slice(0, 3000)) {
      this.list.append(h("div", { className: `item${e === this.selected ? " on" : ""}`, title: e.member, dataset: { member: e.member }, onclick: () => void this.choose(e) },
        e.member.replace(/^unit\\/, ""), e.own ? null : h("span", { className: "tag" }, t("the game's")), e.images.length ? h("span", { className: "tag" }, `· ${num(e.images.length)}`) : null));
    }
    if (this.shown.length > 3000) this.list.append(h("div", { className: "mx-faint", style: "padding: 3px 8px" }, t("and {n} more: search to find them", { n: num(this.shown.length - 3000) })));
  }

  /** Show a GRP; `keepFrame` after an edit of the same one. */
  async choose(e: PictureEntry, keepFrame = false) {
    const same = this.selected?.member === e.member;
    this.selected = e;
    for (const row of this.list.querySelectorAll<HTMLElement>(".item")) row.classList.toggle("on", row.dataset.member === e.member);
    this.bytes = await this.ctx.session.readOver(e.member);
    this.grp = null;
    try { this.grp = this.bytes ? decodeGrpImage(this.bytes) : null; } catch (err) { this.info.textContent = t("{file} is not read as a GRP: {error}", { file: e.member, error: (err as Error).message }); }
    if (!(same && keepFrame)) this.frame = 0;
    if (this.grp && this.frame >= this.grp.frames.length) this.frame = 0;
    if (this.mode === "animation") await this.preview.show(e.images[0] ?? null);
    this.draw();
  }

  /** Show the GRP an image draws, in the animation view, playing `anim`. */
  async showImage(image: number, anim?: string) {
    const e = this.entries.find((x) => x.images.includes(image));
    if (!e) return;
    this.mode = "animation";
    await this.choose(e);
    await this.preview.show(image, anim);
    this.draw();
  }

  private drawModes() {
    clear(this.modeBar);
    const m = (id: Mode, label: string) => h("button", { type: "button", className: `mx-tab${this.mode === id ? " on" : ""}`, dataset: { mode: id }, onclick: () => { this.mode = id; if (id === "animation") void this.preview.show(this.selected?.images[0] ?? null); this.draw(); } }, label);
    this.modeBar.append(m("frames", t("Frames")), m("sheet", t("Sheet")), m("animation", t("Animation")));
  }

  draw() {
    this.drawModes();
    clear(this.stage);
    const e = this.selected, grp = this.grp, look = this.look.current();
    if (!e) { this.info.textContent = t("Choose a GRP."); return; }
    if (!grp) { if (!this.bytes) this.info.textContent = t("{file} is in neither the mod nor the game's files here.", { file: e.member }); return; }
    if (!look) { this.info.textContent = t("The palette {name} is in neither the mod nor the game's files here.", { name: this.look.palette }); return; }
    clear(this.info);
    this.info.append(`${e.member} · ${grp.width} × ${grp.height} · ${t("{n, plural, one {{count} frame} other {{count} frames}}", { n: grp.frames.length, count: num(grp.frames.length) })} · ${sizeText(this.bytes!.length)}${e.own ? "" : ` · ${t("the game's")}`} · `);
    if (e.images.length) {
      this.info.append(t("used by "));
      e.images.slice(0, 12).forEach((id, i) => { if (i) this.info.append(", "); this.info.append(h("a", { className: "mx-link", onclick: () => this.ctx.go("images", id) }, t("image {id}", { id }))); });
      if (e.images.length > 12) this.info.append(` ${t("and {n} more", { n: num(e.images.length - 12) })}`);
    } else this.info.append(t("no image draws it"));
    if (this.mode === "animation") {
      const shown = this.preview.imageId();
      const choices = e.images.length > 200 ? [...new Set([...(shown >= 0 ? [shown] : []), ...e.images.slice(0, 200)])] : e.images;
      const pick = h("select", { onchange: () => void this.preview.show(Number(pick.value)) }, ...choices.map((id) => h("option", { value: String(id) }, t("image {id}", { id }))));
      if (shown >= 0) pick.value = String(shown);
      if (!e.images.length) { this.stage.append(h("p", { className: "mx-dim" }, t("No image draws this GRP, so it has no script to play."))); return; }
      this.stage.append(h("div", { className: "mx-bar" }, t("Image"), pick), this.preview.el);
      this.preview.refresh();
      return;
    }
    const canvas = h("canvas", { className: "mx-canvas" });
    if (this.mode === "sheet") {
      const sheet = sheetRgba(grp, look.palette, look.lut);
      canvas.width = sheet.width; canvas.height = sheet.height;
      canvas.getContext("2d")!.putImageData(new ImageData(sheet.rgba, sheet.width, sheet.height), 0, 0);
      this.stage.append(h("div", { className: "mx-sheet" }, canvas));
      return;
    }
    const scale = grp.width <= 128 ? 3 : grp.width <= 256 ? 2 : 1;
    canvas.width = grp.width * scale; canvas.height = grp.height * scale;
    const off = new OffscreenCanvas(grp.width, grp.height);
    off.getContext("2d")!.putImageData(new ImageData(frameRgba(grp, this.frame, look.palette, look.lut), grp.width, grp.height), 0, 0);
    const c2 = canvas.getContext("2d")!;
    c2.imageSmoothingEnabled = false;
    c2.drawImage(off, 0, 0, canvas.width, canvas.height);
    const slider = h("input", { type: "range", min: "0", max: String(grp.frames.length - 1), value: String(this.frame), style: "width: 240px", oninput: () => { this.frame = Number(slider.value); this.draw(); } });
    const f = grp.frames[this.frame];
    this.stage.append(
      h("div", { className: "mx-bar" }, button("‹", () => { this.frame = (this.frame + grp.frames.length - 1) % grp.frames.length; this.draw(); }), slider, button("›", () => { this.frame = (this.frame + 1) % grp.frames.length; this.draw(); }),
        h("span", { className: "mx-dim mx-frameinfo" }, t("Frame {i} of {n}: {w} × {h} at {x}, {y}", { i: this.frame, n: grp.frames.length, w: f.width, h: f.height, x: f.x, y: f.y }))),
      h("div", { className: "mx-stage" }, canvas));
  }

  private async pickPng() {
    const files = await this.ctx.api.ui.pickFiles({ accept: ".png,image/png", multiple: false });
    if (files[0]) await this.importFile(files[0]);
  }

  /** A PNG brought in: what it would change, shown first; used when the person says so. */
  async importFile(file: File) {
    const e = this.selected, grp = this.grp, palette = this.look.named();
    if (!e || !grp || !palette) { this.ctx.say(t("Choose a GRP to import over first.")); return; }
    let plan: ImportPlan | { refused: "size" | "frames"; width: number; height: number };
    try { plan = await importPng(grp, new Uint8Array(await file.arrayBuffer()), palette, this.frame); } catch (err) { this.ctx.say(t("{file} is not read as a PNG: {error}", { file: file.name, error: (err as Error).message })); return; }
    if ("refused" in plan) {
      this.ctx.say(plan.refused === "frames"
        ? t("{file} is {w} × {h}: fewer cells than the GRP's {n} frames of {fw} × {fh}.", { file: file.name, w: plan.width, h: plan.height, n: grp.frames.length, fw: grp.width, fh: grp.height })
        : t("{file} is {w} × {h}: neither one frame ({fw} × {fh}) nor a sheet of them.", { file: file.name, w: plan.width, h: plan.height, fw: grp.width, fh: grp.height }));
      return;
    }
    const ok = await this.reportDialog(file.name, plan, e.member);
    if (!ok) { this.ctx.say(t("Not imported.")); return; }
    this.ctx.session.setMember(e.member, plan.grp);
    this.ctx.say(plan.kind === "frame" ? t("Frame {i} of {file} replaced from {png}.", { i: this.frame, file: e.member, png: file.name }) : t("{file}: every frame replaced from {png}.", { file: e.member, png: file.name }));
  }

  private reportDialog(name: string, plan: ImportPlan, member: string): Promise<boolean> {
    const r = plan.report;
    const pal = this.look.current()!.palette;
    const swatch = (rgb: string) => h("span", { className: "mx-swatch", style: `background: ${rgb}` });
    const index = (i: number) => `rgb(${pal[i * 4]}, ${pal[i * 4 + 1]}, ${pal[i * 4 + 2]})`;
    return new Promise((resolve) => {
      let answered = false;
      const answer = (v: boolean) => { if (!answered) { answered = true; resolve(v); } };
      this.ctx.api.ui.dialog({
        title: t("Import {png}", { png: name }),
        size: "md",
        mount: (body) => {
          const root = h("div", { className: "mx mx-dlg mx-report" });
          body.append(root);
          root.append(h("p", null, plan.kind === "frame" ? t("It replaces frame {i} of {file}.", { i: this.frame, file: member }) : t("It replaces all {n} frames of {file}.", { n: plan.image.frames.length, file: member })));
          if (r.paletteMismatch) root.append(h("p", { className: "mx-warn" }, t("The sheet says it was drawn in the palette {was}; it is read in {now}.", { was: r.paletteMismatch, now: this.look.palette })));
          if (!r.coloursLost.length && !r.pixelsAlphaRounded) root.append(h("p", { className: "mx-ok" }, t("Every pixel is a colour of the palette: nothing is lost.")));
          else {
            root.append(h("p", { className: "mx-warn" }, t("{n} colours are not in the palette {palette}: {pixels} pixels take the nearest colour it has.", { n: num(r.coloursLost.length), palette: this.look.palette, pixels: num(r.pixelsChanged) })));
            if (r.pixelsAlphaRounded) root.append(h("p", { className: "mx-warn" }, t("{n} pixels were partly transparent and are now either opaque or transparent.", { n: num(r.pixelsAlphaRounded) })));
            const list = h("div", { className: "mx-lost" });
            for (const c of [...r.coloursLost].sort((a, b) => b.pixels - a.pixels).slice(0, 40)) list.append(h("div", null, swatch(c.colour), ` ${c.colour} → `, swatch(index(c.became)), ` ${t("index {i}", { i: c.became })} · ${t("{n} pixels", { n: num(c.pixels) })}`));
            if (r.coloursLost.length > 40) list.append(h("div", { className: "mx-faint" }, t("and {n} more", { n: num(r.coloursLost.length - 40) })));
            root.append(list);
          }
          return () => answer(false);
        },
        buttons: [{ label: t("Cancel"), run: () => answer(false) }, { label: t("Use It"), primary: true, run: () => answer(true) }],
      });
    });
  }

  private async exportSheet() {
    const e = this.selected, palette = this.look.named();
    if (!e || !this.bytes || !palette) return;
    try {
      const png = await exportPng(this.bytes, palette, e.member);
      const name = `${e.member.split("\\").pop()!.replace(/\.grp$/i, "")}.png`;
      const where = await this.ctx.api.ui.saveFile(png, name);
      if (where) this.ctx.say(t("Saved {file}: the sheet in the palette {palette}; import it back to change the picture.", { file: where.fileName, palette: palette.name }));
    } catch (err) {
      this.ctx.say(t("Not saved: {error}", { error: (err as Error).message }));
    }
  }
}
