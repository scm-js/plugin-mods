/**
 * Live (part d): while a test game runs alone in the play page's tab, every edit goes into it — the `scm-sim.live`
 * service of plugin-scm-sim carries it (its `contract.d.ts`, `ScmSimLiveService`; the shape is repeated here so this
 * plugin does not need that one installed to build). A field of a table is sent as the field; any other member that
 * changed (a string table, a script that assembles, an imported picture, a graft) as the file. The page answers item by
 * item: applied in the running game, kept for the next start, or refused, and the status line says which.
 *
 * Edits are gathered for a moment (a typed script changes on every key) and sent together; one patch at a time.
 */
import { gameName } from "@scm-js/core";
import { t } from "./i18n";
import type { EditEvent, ModSession } from "./session";

export interface LiveField { table: string; id: number; field: string; part?: string; value: number }
export interface LiveFile { path: string; bytes: Uint8Array }
export interface LiveItem { table?: string; id?: number; field?: string; part?: string; value?: number; was?: number; path?: string; message: string }
export interface LiveAnswer { applied: LiveItem[]; deferred: LiveItem[]; errors: LiveItem[]; frame?: number }
export interface LiveState { running: boolean; alone: boolean; frame: number; mod: { hash: string; name: string } | null; waiting: string[] }
export interface LiveTest { map: { bytes: Uint8Array; name: string } | null; mod: { name: string; hash: string; files: LiveFile[] }; useMapSettings?: boolean }

/** `scm-sim.live`, as far as this plugin uses it. */
export interface LiveService {
  readonly present: boolean;
  playing(): Promise<boolean>;
  onState(listener: (state: LiveState | null) => void): () => void;
  patch(fields: readonly LiveField[], files?: readonly LiveFile[]): Promise<LiveAnswer>;
  grafts(): Promise<{ files: LiveFile[]; left: string[] }>;
  play(test: LiveTest | Promise<LiveTest>): Promise<"started" | "shown">;
}

export const LIVE_SERVICE = "scm-sim.live";
/** The tables a running game takes a field of (scm-sim `src/mods/live.ts`, `LIVE_TABLES`). */
const LIVE_TABLES = new Set(["units", "weapons", "flingy", "sprites", "images", "upgrades", "techdata", "orders", "portdata"]);

/** A member's path as the page takes it: the game's path, lower case, forward slashes. */
export const livePath = (member: string) => gameName(member).replace(/\\/g, "/");

/** The status line for an answer: what went in, what waits for a start, what was refused. */
export function answerLine(a: LiveAnswer): string {
  const parts: string[] = [];
  const what = (items: LiveItem[]) => items.slice(0, 3).map((i) => (i.path ? i.path.replace(/^.*[\\/]/, "") : i.part ? `${i.table} ${i.id} ${i.field}.${i.part}` : `${i.table} ${i.id} ${i.field}`)).join(", ") + (items.length > 3 ? " …" : "");
  if (a.applied.length) parts.push(t("{what}: applied in the running game.", { what: what(a.applied) }));
  if (a.deferred.length) parts.push(t("{what}: takes effect at the next start.", { what: what(a.deferred) }));
  if (a.errors.length) parts.push(t("Refused by the running game: {why}", { why: a.errors[0].message }));
  return parts.join(" ");
}

export class LiveSender {
  private service: LiveService | null = null;
  private session: ModSession | null = null;
  private stopSession: (() => void) | null = null;
  private stopState: (() => void) | null = null;
  private fields = new Map<string, LiveField>();
  private files = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> | null = null;
  /** Whether the page last said a game alone is running (unasked; `playing()` asks). */
  alone = false;
  /** The last answer, in words (empty before any). */
  line = "";
  private readonly said: (line: string) => void;
  private readonly delay: number;

  constructor(said: (line: string) => void, delay = 250) { this.said = said; this.delay = delay; }

  /** The service came or went (`api.services.watch`). */
  setService(service: LiveService | null) {
    this.stopState?.();
    this.service = service && service.present ? service : null;
    this.alone = false;
    this.stopState = this.service ? this.service.onState((s) => { this.alone = !!s?.alone; this.said(this.line); }) : null;
  }

  get available(): boolean { return this.service !== null; }

  /** The mod whose edits go to the game (null: none). */
  follow(session: ModSession | null) {
    this.stopSession?.();
    this.stopSession = null;
    this.session = session;
    this.fields.clear(); this.files.clear();
    if (session) this.stopSession = session.onEdit((e) => this.edited(e));
  }

  private edited(e: EditEvent) {
    if (!this.service) return;
    // A field of a table the running game holds per game goes as the field; the sound table and the campaign maps'
    // (read once, at the program's start) as their file, which the page keeps for the next start.
    if (e.field && LIVE_TABLES.has(e.field.table)) {
      const f = e.field;
      this.fields.set(`${f.table}/${f.id}/${f.field}/${f.part ?? ""}`, { table: f.table, id: f.id, field: f.field, ...(f.part ? { part: f.part } : {}), value: f.value });
    } else this.files.add(gameName(e.member));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delay);
  }

  /** Sends what has gathered, when a game alone is running; otherwise the edits stay in the mod for the next test game. */
  async flush(): Promise<void> {
    if (this.sending) { await this.sending; if (!this.fields.size && !this.files.size) return; }
    const service = this.service, session = this.session;
    if (!service || !session || (!this.fields.size && !this.files.size)) return;
    const fields = [...this.fields.values()], members = [...this.files];
    this.fields.clear(); this.files.clear();
    this.sending = (async () => {
      try {
        if (!(await service.playing())) { this.alone = false; return; }
        this.alone = true;
        const files: LiveFile[] = [];
        for (const m of members) { const bytes = await session.read(m); if (bytes) files.push({ path: livePath(m), bytes }); }
        const answer = await service.patch(fields, files);
        this.line = answerLine(answer);
      } catch (e) {
        this.line = t("The running game did not take the edit: {error}", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        this.sending = null;
        this.said(this.line);
      }
    })();
    await this.sending;
  }

  dispose() { this.follow(null); this.setService(null); if (this.timer) clearTimeout(this.timer); }
}
