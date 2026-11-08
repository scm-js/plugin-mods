/**
 * The Sounds tab: the sound table's rows (sfxdata.dat) with the files they play (sfxdata.tbl, under `sound\`). A row's
 * file plays here; it is replaced with a dropped or chosen sound — a WAV, or anything the browser decodes — converted
 * to the game's own format (22050 Hz, 16-bit, mono) unless it already is one, or with a recording from the microphone.
 * A replaced file is the mod's at once; every row that plays the same file plays the new one.
 */
import { entryText, gameName, parseWavHeader } from "@scm-js/core";
import { button, clear, h } from "./dom";
import { t } from "./i18n";
import { num, sizeText } from "./info";
import type { ViewContext } from "./tablesView";
import { GAME_WAV, browserDecode, convertToWav, decodePcmWav } from "./wav";

const ROW = 22;

export class SoundsView {
  readonly el: HTMLElement;
  private readonly ctx: ViewContext;
  private ids: number[] = [];
  private query = "";
  private all = false;
  private selected = -1;
  private readonly grid: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly side: HTMLElement;
  private readonly count: HTMLElement;
  private drawn = { from: -1, to: -1, revision: -1 };
  private audio: AudioContext | null = null;
  private playing: AudioBufferSourceNode | null = null;
  private recorder: MediaRecorder | null = null;

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    const search = h("input", { type: "search", placeholder: t("Search files and row numbers"), style: "width: 220px", oninput: () => { this.query = search.value; this.filter(); } });
    const all = h("input", { type: "checkbox", onchange: () => { this.all = all.checked; this.filter(); } });
    this.count = h("span", { className: "mx-dim mx-count" });
    this.rows = h("div");
    this.sizer = h("div", { style: "position: relative" }, this.rows);
    this.grid = h("div", { className: "mx-grid", onscroll: () => this.paint() }, this.sizer);
    this.side = h("div", { className: "mx-side" });
    this.side.addEventListener("dragover", (e) => e.preventDefault());
    this.side.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) void this.replace(f); });
    this.el = h("div", { className: "mx-split" },
      h("div", { className: "mx-col" }, h("div", { className: "mx-bar" }, search, h("label", { className: "mx-dim" }, all, t("Rows with no file too")), this.count), this.grid),
      this.side);
    new ResizeObserver(() => this.paint()).observe(this.grid);
    this.filter();
  }

  /** The file a row plays (`sound\…`), or "" for none. */
  private fileOf(id: number): string {
    const sfx = this.ctx.session.table("sfxdata"), tbl = this.ctx.session.data.strings.sfxdata;
    if (!sfx || !tbl) return "";
    const v = sfx.columns.sound_file[id];
    const path = v && v <= tbl.length ? entryText(tbl[v - 1]) : "";
    return path ? `sound\\${path}` : "";
  }

  refresh() {
    this.filter(true);
  }

  private filter(keep = false) {
    const sfx = this.ctx.session.table("sfxdata");
    const q = this.query.trim().toLowerCase();
    const n = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
    this.ids = [];
    let withFile = 0;
    for (let id = 0; id < (sfx?.count ?? 0); id++) {
      const f = this.fileOf(id);
      if (f) withFile++;
      if (q ? id === n || f.toLowerCase().includes(q) : this.all || f) this.ids.push(id);
    }
    this.count.textContent = sfx ? t("{shown} shown; {files} of {rows} rows play a file", { shown: num(this.ids.length), files: num(withFile), rows: num(sfx.count) }) : t("Neither the mod nor the game here has a sound table.");
    this.sizer.style.height = `${(this.ids.length + 1) * ROW}px`;
    if (!keep) this.grid.scrollTop = 0;
    this.drawn.revision = -1;
    this.paint();
    this.drawSide();
  }

  private paint() {
    if (!this.el.isConnected) return;
    const from = Math.max(0, Math.floor(this.grid.scrollTop / ROW) - 9);
    const to = Math.min(this.ids.length, Math.ceil((this.grid.scrollTop + this.grid.clientHeight) / ROW) + 8);
    if (from === this.drawn.from && to === this.drawn.to && this.drawn.revision === this.ctx.session.revision) return;
    this.drawn = { from, to, revision: this.ctx.session.revision };
    clear(this.rows);
    const cols = "grid-template-columns: 64px minmax(0, 1fr) 80px";
    this.rows.append(h("div", { className: "mx-row head", style: cols }, h("span", { className: "mx-cell num" }, t("Row")), h("span", { className: "mx-cell" }, t("File")), h("span", { className: "mx-cell" }, t("In the mod"))));
    this.rows.append(h("div", { style: `height: ${from * ROW}px` }));
    for (let k = from; k < to; k++) {
      const id = this.ids[k], file = this.fileOf(id);
      const own = file && this.ctx.session.has(file);
      this.rows.append(h("div", { className: `mx-row${id === this.selected ? " on" : ""}`, style: cols, dataset: { id: String(id) }, onclick: () => this.select(id), ondblclick: () => void this.play(id) },
        h("span", { className: "mx-cell num mx-mono" }, String(id)),
        h("span", { className: "mx-cell mx-mono", title: file }, file.replace(/^sound\\/, "") || h("span", { className: "mx-faint" }, "—")),
        h("span", { className: "mx-cell mx-dim" }, file ? (own ? t("yes") : t("the game's")) : "")));
    }
  }

  private select(id: number) {
    this.selected = id;
    for (const r of this.rows.querySelectorAll<HTMLElement>(".mx-row[data-id]")) r.classList.toggle("on", r.dataset.id === String(id));
    this.drawSide();
  }

  private drawSide() {
    clear(this.side);
    const id = this.selected;
    if (id < 0) { this.side.append(h("p", { className: "mx-dim" }, t("Choose a row to play its file or replace it. Double-click a row to play it."))); return; }
    const file = this.fileOf(id);
    this.side.append(h("h4", null, t("Sound {id}", { id })));
    if (!file) { this.side.append(h("p", { className: "mx-dim" }, t("This row plays no file."))); return; }
    const info = h("p", { className: "mx-dim mx-soundinfo" }, file);
    const pick = h("input", { type: "file", accept: "audio/*,.wav,.ogg,.mp3,.flac,.m4a,.webm", style: "display: none" }) as HTMLInputElement;
    pick.addEventListener("change", () => { const f = pick.files?.[0]; if (f) void this.replace(f); pick.value = ""; });
    const rec = button(this.recorder ? t("Stop Recording") : t("Record…"), () => void this.record());
    this.side.append(info,
      h("div", { className: "mx-bar" }, button(t("Play"), () => void this.play(id), { primary: true }), button(t("Stop"), () => this.stop())),
      h("div", { className: "mx-bar" }, button(t("Replace…"), () => pick.click(), { title: t("A WAV, or any sound the browser plays; drop one here too") }), rec, button(t("Save WAV…"), () => void this.save(file))),
      h("p", { className: "mx-faint" }, t("A replacement is converted to 22050 Hz, 16-bit, mono (the game's own) unless it is one already.")),
      pick);
    void this.ctx.session.readOver(file).then((bytes) => {
      const w = bytes ? parseWavHeader(bytes) : null;
      info.textContent = w ? `${file} · ${t("{rate} Hz · {bits}-bit · {ch}", { rate: num(w.sampleRate), bits: w.bitsPerSample, ch: w.channels === 1 ? t("mono") : t("stereo") })} · ${(w.dataLength / (w.sampleRate * w.channels * (w.bitsPerSample / 8) || 1)).toFixed(2)} s · ${sizeText(bytes!.length)}` : bytes ? `${file} · ${sizeText(bytes.length)}` : t("{file} is in neither the mod nor the game's files here.", { file });
    });
  }

  /** Plays a row's file (the page's audio starts on this click). */
  async play(id: number) {
    const file = this.fileOf(id);
    if (!file) return;
    this.stop();
    const bytes = await this.ctx.session.readOver(file);
    if (!bytes) { this.ctx.say(t("{file} is in neither the mod nor the game's files here.", { file })); return; }
    this.audio ??= new AudioContext();
    try {
      const pcm = decodePcmWav(bytes);
      let buffer: AudioBuffer;
      if (pcm) {
        buffer = this.audio.createBuffer(pcm.channels.length, Math.max(1, pcm.channels[0].length), pcm.sampleRate);
        pcm.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      } else buffer = await this.audio.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
      const source = this.audio.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audio.destination);
      source.onended = () => { if (this.playing === source) this.playing = null; };
      source.start();
      this.playing = source;
      this.ctx.say(t("Playing {file} ({s} s).", { file, s: buffer.duration.toFixed(2) }));
    } catch (err) {
      this.ctx.say(t("{file} does not play here: {error}", { file, error: (err as Error).message }));
    }
  }

  stop() {
    try { this.playing?.stop(); } catch { /* already ended */ }
    this.playing = null;
  }

  /** A sound brought in for the selected row's file. */
  async replace(file: Blob & { name?: string }) {
    const target = this.fileOf(this.selected);
    if (!target) return;
    try {
      const out = await convertToWav(new Uint8Array(await file.arrayBuffer()), GAME_WAV, browserDecode);
      this.ctx.session.setMember(gameName(target), out.bytes);
      const sharing = this.rowsPlaying(target).length;
      this.ctx.say(t("{file} replaced by {name} ({s} s{converted}){shared}.", {
        file: target, name: file.name ?? t("the recording"), s: out.seconds.toFixed(2),
        converted: out.converted ? t(", converted to 22050 Hz, 16-bit, mono") : "",
        shared: sharing > 1 ? t("; {n} rows play it", { n: sharing }) : "",
      }));
      this.drawSide();
    } catch (err) {
      this.ctx.say(t("{name} is not a sound this page can read: {error}", { name: file.name ?? "", error: (err as Error).message }));
    }
  }

  private rowsPlaying(file: string): number[] {
    const sfx = this.ctx.session.table("sfxdata");
    const out: number[] = [];
    for (let id = 0; id < (sfx?.count ?? 0); id++) if (this.fileOf(id) === file) out.push(id);
    return out;
  }

  /** Records from the microphone; pressed again, stops and uses the recording for the selected row. */
  private async record() {
    if (this.recorder) { this.recorder.stop(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) { this.ctx.say(t("The microphone is not available: {error}", { error: (err as Error).message })); return; }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    this.recorder = recorder;
    const started = performance.now();
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      this.recorder = null;
      this.ctx.say(t("Recorded {s} s.", { s: ((performance.now() - started) / 1000).toFixed(1) }));
      void this.replace(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.start();
    this.ctx.say(t("Recording… press Stop Recording when done."));
    this.drawSide();
  }

  private async save(file: string) {
    const bytes = await this.ctx.session.readOver(file);
    if (!bytes) return;
    const where = await this.ctx.api.ui.saveFile(bytes, file.split("\\").pop()!);
    if (where) this.ctx.say(t("Saved {file}.", { file: where.fileName }));
  }

  dispose() {
    this.stop();
    this.recorder?.stop();
    void this.audio?.close();
  }
}
