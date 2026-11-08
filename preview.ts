/**
 * The animation preview: one image's animation played from the mod's iscript as it is now, drawn from its GRP with
 * the chosen palette and team colour. Step a frame at a time or play at the game's fastest speed (42 ms a frame).
 * Under the picture: the frame, what was skipped, and where the preview stopped and why — it models what decides the
 * picture of one image, not a running game (see `animate.ts`).
 */
import { decodeGrpImage, entryText, gameName, ISCRIPT_ANIMS, type GrpImage } from "@scm-js/core";
import { AnimationRunner, ScriptIndex, animationsOf } from "./animate";
import { button, clear, h } from "./dom";
import { t } from "./i18n";
import { frameRgba } from "./pictures";
import type { ModSession } from "./session";

/** One game frame at the fastest speed. */
const FRAME_MS = 42;

export interface PreviewLook {
  /** The palette as 256 RGBA words, and the team colour's index remap. */
  palette: Uint8Array;
  lut: Uint8Array;
}

export class AnimPreview {
  readonly el: HTMLElement;
  private readonly session: ModSession;
  private readonly look: () => PreviewLook | null;
  private image = -1;
  private anim = 0;
  private direction = 0;
  private runner: AnimationRunner | null = null;
  private grp: GrpImage | null = null;
  private timer = 0;
  private revision = -1;
  private readonly canvas: HTMLCanvasElement;
  private readonly animPick: HTMLSelectElement;
  private readonly facing: HTMLInputElement;
  private readonly title: HTMLElement;
  private readonly line: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly playButton: HTMLButtonElement;

  constructor(session: ModSession, look: () => PreviewLook | null) {
    this.session = session;
    this.look = look;
    this.title = h("div", { className: "mx-dim" });
    this.animPick = h("select", { title: t("Animation"), onchange: () => { this.anim = Number(this.animPick.value); void this.restart(); } });
    this.facing = h("input", { type: "range", min: "0", max: "31", value: "0", title: t("Facing"), style: "width: 90px", oninput: () => { this.direction = Number(this.facing.value); void this.restart(); } });
    this.playButton = button(t("Play"), () => this.toggle());
    this.canvas = h("canvas", { width: 64, height: 64, className: "mx-canvas" });
    this.line = h("div", { className: "mx-mono mx-dim mx-preview-line" });
    this.notes = h("div", { className: "mx-faint mx-preview-notes" });
    this.el = h("div", { className: "mx-preview" },
      this.title,
      h("div", { className: "mx-bar" }, this.animPick, this.facing, this.playButton, button(t("Step"), () => this.step()), button(t("Restart"), () => void this.restart())),
      h("div", { className: "mx-stage" }, this.canvas),
      this.line, this.notes);
  }

  /** The image shown, or -1. */
  imageId(): number {
    return this.image;
  }

  /** Show image `id` (an images.dat entry); null clears the preview. */
  async show(id: number | null, anim?: string) {
    this.image = id ?? -1;
    if (id === null) { this.stop(); this.title.textContent = t("No image chosen."); clear(this.animPick); this.draw(); return; }
    const found = await this.script();
    clear(this.animPick);
    const list = found ? animationsOf(found.anims) : [];
    for (const a of list) this.animPick.append(h("option", { value: String(a.index) }, a.name));
    const wanted = anim ? list.find((a) => a.name === anim) : list.find((a) => a.index === this.anim) ?? list[0];
    this.anim = wanted?.index ?? 0;
    this.animPick.value = String(this.anim);
    await this.restart();
  }

  /** The image's iscript header, in the mod's iscript files as they are now (the game's when the mod has none). */
  private async script() {
    const images = this.session.table("images");
    if (!images || this.image < 0 || this.image >= images.count) return null;
    const id = images.columns.iscript_id[this.image];
    const files: { member: string; bytes: Uint8Array }[] = [];
    for (const doc of this.session.scripts.filter((d) => d.kind === "iscript")) {
      const bytes = await this.session.readOver(doc.members[0]);
      if (bytes) files.push({ member: doc.members[0], bytes });
    }
    return new ScriptIndex(files, images.columns.iscript_id).find(id);
  }

  private async grpOf(): Promise<GrpImage | null> {
    const images = this.session.table("images"), tbl = this.session.data.strings.images;
    if (!images || !tbl) return null;
    const v = images.columns.grp_file[this.image];
    const path = v && v <= tbl.length ? entryText(tbl[v - 1]) : "";
    if (!path) return null;
    const bytes = await this.session.readOver(gameName(`unit\\${path}`));
    try { return bytes ? decodeGrpImage(bytes) : null; } catch { return null; }
  }

  /** Start the animation over (after a change of image, animation, facing, or the mod's files). */
  async restart() {
    const playing = this.timer !== 0;
    this.stop();
    this.revision = this.session.revision;
    const images = this.session.table("images");
    const found = await this.script();
    this.grp = await this.grpOf();
    const raw = images && this.image >= 0 ? images.columns.iscript_id[this.image] >>> 0 : -1;
    const iscriptId = raw > 0xffff ? `${raw & 0xffff} (${t("file {n}", { n: raw >>> 16 })})` : String(raw);
    const path = images && this.image >= 0 ? this.session.entryName("images", this.image) : "";
    this.title.textContent = t("Image {id} ({path}), iscript {script}", { id: this.image, path: path || "—", script: found ? `${iscriptId} · ${found.member}` : iscriptId });
    this.runner = null;
    if (!found) { this.say(t("No iscript defines {id}.", { id: iscriptId })); this.draw(); return; }
    const entry = found.anims[this.anim];
    if (!entry) { this.say(t("This script has no {anim} animation.", { anim: ISCRIPT_ANIMS[this.anim] ?? String(this.anim) })); this.draw(); return; }
    this.runner = new AnimationRunner(found.bytes, entry, { turns: !!images!.columns.gfx_turns[this.image], direction: this.direction });
    this.runner.tick();
    this.draw();
    if (playing) this.toggle();
  }

  /** Called when the mod changed: an edit to the script or the picture is played from the start. */
  refresh() {
    if (this.image >= 0 && this.revision !== this.session.revision && this.el.isConnected) void this.restart();
  }

  private say(text: string) {
    this.line.textContent = text;
    this.notes.textContent = "";
  }

  step() {
    if (!this.runner) return;
    this.runner.tick();
    this.draw();
  }

  toggle() {
    if (this.timer) { this.stop(); return; }
    if (!this.runner) return;
    this.playButton.textContent = t("Pause");
    this.timer = window.setInterval(() => {
      if (!this.el.isConnected) { this.stop(); return; }
      this.runner?.tick();
      this.draw();
      if (this.runner?.stopped) this.stop();
    }, FRAME_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
    this.playButton.textContent = t("Play");
  }

  private draw() {
    const ctx = this.canvas.getContext("2d")!;
    const look = this.look();
    const r = this.runner, grp = this.grp;
    if (!grp || !look) {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!grp && this.image >= 0) this.say(t("The image's GRP is not there."));
      return;
    }
    const scale = grp.width <= 96 ? 2 : 1;
    if (this.canvas.width !== grp.width * scale || this.canvas.height !== grp.height * scale) { this.canvas.width = grp.width * scale; this.canvas.height = grp.height * scale; }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!r) return;
    const frame = r.pose.frame;
    if (frame >= grp.frames.length) this.line.textContent = t("Frame {frame} is past the GRP's {n} frames.", { frame, n: grp.frames.length });
    else {
      const pixels = frameRgba(grp, frame, look.palette, look.lut, r.pose.flip);
      const off = new OffscreenCanvas(grp.width, grp.height);
      off.getContext("2d")!.putImageData(new ImageData(pixels, grp.width, grp.height), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, r.pose.x * scale, r.pose.y * scale, grp.width * scale, grp.height * scale);
      this.line.textContent = t("Game frame {tick} · GRP frame {frame}{flip} · facing {dir}", { tick: r.ticks, frame, flip: r.pose.flip ? t(" (mirrored)") : "", dir: ((r.pose.direction % 32) + 32) % 32 });
    }
    const notes: string[] = [];
    if (r.skipped.size) notes.push(t("Skipped (no picture of their own here): {names}.", { names: [...r.skipped].sort().join(", ") }));
    if (r.noBranch.size) notes.push(t("Read the game's state, so taken as \"no\": {names}.", { names: [...r.noBranch].sort().join(", ") }));
    const s = r.stopped;
    if (s?.kind === "end") notes.push(t("The animation ended."));
    else if (s?.kind === "unmodelled") notes.push(t("Stopped at {name} (offset {at}): the preview does not model it. A running game shows the rest (Play, or Test Map).", { name: s.name, at: s.at }));
    else if (s?.kind === "unknown") notes.push(t("Stopped at byte {byte} (offset {at}), which is no opcode of 1.16.1: a plugin's own.", { byte: s.byte, at: s.at }));
    else if (s?.kind === "loop") notes.push(t("Stopped: the script runs on without a wait (offset {at}).", { at: s.at }));
    this.notes.textContent = notes.join(" ");
  }
}
