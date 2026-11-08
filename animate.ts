/**
 * A small iscript interpreter for the preview: one image's animation played from its header's entry point, a game
 * frame a tick. It models what decides the picture — `playfram`, the waits, jumps and calls, the position and facing
 * opcodes — skips what only means something in a running game (sounds, attacks, orders, overlays, conditional jumps
 * that read the game's state take the "no" branch), and stops at anything else, saying what. The bytes are the
 * mod's iscript as it is now, so an edit to the text shows at the next play. Pure.
 */
import { ISCRIPT_ANIMS, ISCRIPT_OPCODES, readIscriptHeaders, type IscriptOpcode } from "@scm-js/core";

const BY_OP = new Map(ISCRIPT_OPCODES.map((o) => [o.op, o]));

/** Opcodes with no effect on a still picture of one image: skipped, and named once in the notes. */
const SKIPPED = new Set([
  "playsnd", "playsndrand", "playsndbtwn", "domissiledmg", "attackmelee", "followmaingraphic", "attackwith", "attack", "castspell", "useweapon",
  "move", "gotorepeatattk", "engframe", "engset", "nobrkcodestart", "nobrkcodeend", "attkshiftproj", "tmprmgraphicstart", "tmprmgraphicend",
  "setflspeed", "creategasoverlays", "sigorder", "orderdone", "dogrddamage", "setspawnframe", "playframtile", "warpoverlay", "uflunstable",
  // Other images and sprites: the preview draws the one image.
  "imgol", "imgul", "imgolorig", "switchul", "imgoluselo", "imguluselo", "sprol", "highsprol", "lowsprul", "spruluselo", "sprul", "sproluselo", "grdsprol", "imgulnextid",
]);
/** Jumps that read the game's state: the preview takes the "no" branch (falls through). */
const NO_BRANCH = new Set(["pwrupcondjmp", "trgtrangecondjmp", "trgtarccondjmp", "curdirectcondjmp", "liftoffcondjmp"]);

export interface Instruction { op: IscriptOpcode; at: number; next: number; args: number[]; list?: number[] }

/** The instruction at `at`, or null when the byte is no opcode (or runs past the end). */
export function decodeAt(bytes: Uint8Array, at: number): Instruction | null {
  const op = BY_OP.get(bytes[at]);
  if (!op) return null;
  let p = at + 1;
  const args: number[] = [];
  let list: number[] | undefined;
  for (const k of op.args) {
    if (k === "b") { args.push(bytes[p]); p += 1; }
    else if (k === "s") { args.push((bytes[p] << 24) >> 24); p += 1; }
    else if (k === "N") { const n = bytes[p]; p += 1; list = []; for (let i = 0; i < n; i++) { list.push(bytes[p] | (bytes[p + 1] << 8)); p += 2; } }
    else { args.push(bytes[p] | (bytes[p + 1] << 8)); p += 2; }
    if (p > bytes.length) return null;
  }
  return { op, at, next: p, args, ...(list ? { list } : {}) };
}

/**
 * Where an iscript id's animations start, in which of the mod's iscript files; null when none defines it.
 *
 * A mod with several iscript files (GPTP's) gives images.dat's 32-bit `iscript_id` a high word that picks the file and a
 * low word that is the header's id in it. Which file each high word means is the plugin's own list, not in the data,
 * so it is read off the data: for each high word, the file that defines the most of the low ids its images use.
 */
export class ScriptIndex {
  private readonly files: { member: string; bytes: Uint8Array; headers: Map<number, number[]> }[] = [];
  private readonly byHigh = new Map<number, number>();

  constructor(files: { member: string; bytes: Uint8Array }[], imageIds: ArrayLike<number> = []) {
    for (const f of files) {
      try { this.files.push({ ...f, headers: new Map(readIscriptHeaders(f.bytes).headers.map((h) => [h.id, h.anims])) }); } catch { /* an unreadable file */ }
    }
    const wide = new Map<number, number[]>();
    for (let i = 0; i < imageIds.length; i++) { const v = imageIds[i] >>> 0; if (v > 0xffff) wide.set(v >>> 16, [...(wide.get(v >>> 16) ?? []), v & 0xffff]); }
    for (const [high, lows] of wide) {
      let best = -1, most = 0;
      this.files.forEach((f, i) => { const n = lows.filter((l) => f.headers.has(l)).length; if (n > most) { most = n; best = i; } });
      if (best >= 0) this.byHigh.set(high, best);
    }
  }

  find(id: number): { member: string; bytes: Uint8Array; anims: number[] } | null {
    const v = id >>> 0;
    const at = (f: ScriptIndex["files"][number], key: number) => (f.headers.has(key) ? { member: f.member, bytes: f.bytes, anims: f.headers.get(key)! } : null);
    if (v > 0xffff) {
      const f = this.files[this.byHigh.get(v >>> 16) ?? -1];
      const hit = f ? at(f, v & 0xffff) : null;
      if (hit) return hit;
    }
    for (const f of this.files) { const hit = at(f, v); if (hit) return hit; }
    if (v > 0xffff) for (const f of this.files) { const hit = at(f, v & 0xffff); if (hit) return hit; }
    return null;
  }
}

/** `ScriptIndex` for one lookup. */
export function findScript(files: { member: string; bytes: Uint8Array }[], id: number): { member: string; bytes: Uint8Array; anims: number[] } | null {
  return new ScriptIndex(files).find(id);
}

/** The animations a header has, by name, with their entry points. */
export function animationsOf(anims: number[]): { name: string; index: number }[] {
  return anims.map((at, index) => ({ name: ISCRIPT_ANIMS[index] ?? `#${index}`, index, at })).filter((a) => a.at).map(({ name, index }) => ({ name, index }));
}

export interface Pose {
  /** The GRP frame drawn. */
  frame: number;
  flip: boolean;
  x: number;
  y: number;
  /** Facing 0–31. */
  direction: number;
}

export type Stop = { kind: "end" } | { kind: "unknown"; at: number; byte: number } | { kind: "unmodelled"; at: number; name: string } | { kind: "loop"; at: number };

export class AnimationRunner {
  private readonly bytes: Uint8Array;
  private readonly turns: boolean;
  private pc: number;
  private wait = 0;
  private readonly stack: number[] = [];
  private frameBase = 0;
  private flipState = false;
  pose: Pose;
  stopped: Stop | null = null;
  /** Opcodes met and skipped (by name), and jumps that read the game (taken as "no"). */
  readonly skipped = new Set<string>();
  readonly noBranch = new Set<string>();
  /** Game frames run. */
  ticks = 0;
  /** The opcode run last, for the line under the picture. */
  last: Instruction | null = null;
  private readonly random: () => number;

  constructor(bytes: Uint8Array, entry: number, options: { turns: boolean; direction?: number; random?: () => number }) {
    this.bytes = bytes;
    this.turns = options.turns;
    this.pc = entry;
    this.random = options.random ?? Math.random;
    this.pose = { frame: 0, flip: false, x: 0, y: 0, direction: options.direction ?? 0 };
  }

  private setFrame() {
    const d = ((this.pose.direction % 32) + 32) % 32;
    if (this.turns) { this.pose.frame = this.frameBase + (d <= 16 ? d : 32 - d); this.pose.flip = d > 16; }
    else { this.pose.frame = this.frameBase; this.pose.flip = this.flipState; }
  }

  /** One game frame: run until the script waits, ends, or meets what the preview does not model. */
  tick(): void {
    if (this.stopped) return;
    this.ticks++;
    if (this.wait > 0) { this.wait--; return; }
    for (let steps = 0; steps < 2000; steps++) {
      const ins = decodeAt(this.bytes, this.pc);
      if (!ins) { this.stopped = { kind: "unknown", at: this.pc, byte: this.bytes[this.pc] }; return; }
      this.last = ins;
      const name = ins.op.name;
      this.pc = ins.next;
      switch (name) {
        case "playfram": this.frameBase = ins.args[0]; this.setFrame(); break;
        case "sethorpos": this.pose.x = ins.args[0]; break;
        case "setvertpos": this.pose.y = ins.args[0]; break;
        case "setpos": this.pose.x = ins.args[0]; this.pose.y = ins.args[1]; break;
        case "wait": this.wait = Math.max(0, ins.args[0] - 1); return;
        case "waitrand": { const [a, b] = ins.args; this.wait = Math.max(0, a + Math.floor(this.random() * (Math.max(a, b) - a + 1)) - 1); return; }
        case "goto": this.pc = ins.args[0]; break;
        case "call": this.stack.push(this.pc); this.pc = ins.args[0]; break;
        case "return": if (!this.stack.length) { this.stopped = { kind: "end" }; return; } this.pc = this.stack.pop()!; break;
        case "end": this.stopped = { kind: "end" }; return;
        case "randcondjmp": if (this.random() * 256 < ins.args[0]) this.pc = ins.args[1]; break;
        case "setflipstate": this.flipState = !!ins.args[0]; this.setFrame(); break;
        case "turnccwise": this.pose.direction -= ins.args[0]; this.setFrame(); break;
        case "turncwise": this.pose.direction += ins.args[0]; this.setFrame(); break;
        case "turn1cwise": this.pose.direction += 1; this.setFrame(); break;
        case "turnrand": this.pose.direction += (this.random() < 0.5 ? -1 : 1) * ins.args[0]; this.setFrame(); break;
        case "setfldirect": this.pose.direction = ins.args[0]; this.setFrame(); break;
        case "ignorerest": this.stopped = { kind: "unmodelled", at: ins.at, name }; return;
        default:
          if (SKIPPED.has(name)) { this.skipped.add(name); break; }
          if (NO_BRANCH.has(name)) { this.noBranch.add(name); break; }
          this.stopped = { kind: "unmodelled", at: ins.at, name };
          return;
      }
    }
    this.stopped = { kind: "loop", at: this.pc };
  }
}
