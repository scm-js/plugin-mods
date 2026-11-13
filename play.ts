/**
 * The mod on the play page (scm-sim, served at `/play/` beside the editor), in a tab of its own — the conversation
 * plugin-scm-sim's Test Map and `scmjs mod play` have with it:
 *
 *   ← `{ type: "scmjs.play.ready" }`                                  the play page, each time it loads
 *   → `{ type: "scmjs.play", dataSet: { name, hash, files: [{ path, file }], races? }, map?, name? }`
 *   ← `{ type: "scmjs.play.started" }` / `{ type: "scmjs.play.shown" }` / `{ type: "scmjs.play.error", message }`
 *
 * `files` are the mod's files that differ from the game's and all of its code (`engine.ts`'s `playFiles`: `path` the
 * game's path in lower case with forward slashes, a module under `plugins/` or `firegraft/`, a program that carries
 * plugins at the top by its own name; `file` a `File`); `hash` is what the mod goes by in the editor. The page keeps them
 * as if they were dropped on it, loads again with the mod (at the address that runs its code) and says ready again, and
 * is handed the same message; with a map it plays it, without one it shows its Mods dialog. Nothing leaves the person's
 * browser.
 */

import type { DataSetRace } from "./races";

export interface PlayHandoff {
  name: string;
  hash: string;
  /** By the page's path (`playFiles`). */
  files: { path: string; bytes: Uint8Array }[];
  map?: { bytes: Uint8Array; name: string } | null;
  /** The races the mod adds (the Races tab's rows), handed with its data set; none: left out. */
  races?: readonly DataSetRace[];
}

export type PlayOutcome = "started" | "shown";

/** The window's name: the one tab the play page is played in (plugin-scm-sim's Test Map uses the same). */
const TAB = "scmjs-play";

/** The play page beside this editor: `/play/` on the same origin. */
export function playAddress(at: Location = location): string {
  return `${at.origin}/play/`;
}

/**
 * Whether the play page is there. A dev server answers any path with the editor's own page, so an answer that is the
 * editor's page again counts as no play page.
 */
export async function playPageThere(address: string, own: string = location.href): Promise<boolean> {
  try {
    const res = await fetch(address, { cache: "no-store" });
    if (!res.ok) return false;
    const text = await res.text();
    const mine = await fetch(own.split(/[?#]/)[0], { cache: "no-store" }).then((r) => r.text()).catch(() => "");
    return text !== mine;
  } catch {
    return false;
  }
}

/**
 * A file's path as the page is handed it: forward slashes; a game file's in lower case (the game's paths). The mod's code
 * keeps its own names — a module under `plugins/` or `firegraft/`, a program at the top that carries plugins — as a
 * dropped folder gives them: the page names the modules, and the mod after its program, by them.
 */
export const pagePath = (path: string): string => {
  const p = path.replace(/\\/g, "/");
  return !p.includes("/") || /^(plugins|firegraft)\/[^/]+\.(qdp|bwl|dll|fgp|fgd)$/i.test(p) ? p : p.toLowerCase();
};

/** The message the play page is handed (files as `File`s by the game's path). */
export function playMessage(h: PlayHandoff): Record<string, unknown> {
  return {
    type: "scmjs.play",
    dataSet: {
      name: h.name, hash: h.hash,
      files: h.files.map((f) => ({ path: pagePath(f.path), file: new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split(/[\\/]/).pop()!) })),
      ...(h.races?.length ? { races: h.races.map((r) => ({ ...r })) } : {}),
    },
    ...(h.map ? { map: h.map.bytes.slice(), name: h.map.name } : {}),
  };
}

export class PlayTab {
  private tab: Window | null = null;
  private ready = false;
  private handing: Record<string, unknown> | null = null;
  private waiting: { resolve(o: PlayOutcome): void; reject(e: Error): void } | null = null;
  private readonly origin: string;
  private readonly address: string;
  private readonly heard = (e: MessageEvent) => {
    if (e.origin !== this.origin || !this.tab || e.source !== this.tab) return;
    const m = e.data as { type?: unknown; message?: unknown } | null;
    if (!m || typeof m.type !== "string") return;
    if (m.type === "scmjs.play.ready") { this.ready = true; this.hand(); }
    else if (m.type === "scmjs.play.started" || m.type === "scmjs.play.shown") { this.waiting?.resolve(m.type === "scmjs.play.shown" ? "shown" : "started"); this.waiting = null; }
    else if (m.type === "scmjs.play.error") { this.waiting?.reject(new Error(String(m.message ?? ""))); this.waiting = null; }
  };

  constructor(address: string) {
    this.address = address;
    this.origin = new URL(address).origin;
    window.addEventListener("message", this.heard);
  }

  /** Opens the tab (call it from the click itself: a browser lets a click open a tab, not what follows it later). */
  openTab(): boolean {
    if (this.tab && !this.tab.closed) { this.tab.focus(); return true; }
    this.ready = false;
    this.tab = window.open(this.address, TAB);
    return this.tab !== null;
  }

  private hand() {
    if (!this.tab || this.tab.closed || !this.handing || !this.ready) return;
    this.tab.postMessage(this.handing, this.origin);
  }

  /** Hands the mod over once the page says ready (again after each load), and waits for it to start or show. */
  play(message: Record<string, unknown>, timeout = 300_000): Promise<PlayOutcome> {
    this.handing = message;
    this.waiting?.reject(new Error("replaced"));
    const done = new Promise<PlayOutcome>((resolve, reject) => {
      this.waiting = { resolve, reject };
      setTimeout(() => { if (this.waiting?.resolve === resolve) { this.waiting = null; reject(new Error("timeout")); } }, timeout);
    });
    this.hand();
    return done;
  }

  dispose() {
    window.removeEventListener("message", this.heard);
    this.waiting = null;
  }
}
