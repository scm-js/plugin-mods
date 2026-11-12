/**
 * The open mod, registered with plugin-scm-sim's engine (`scm-sim.engine`, its `provideMod` from 0.19.0; the shape is
 * repeated here so this plugin does not need that one installed to build). While the mod is open and the editor draws
 * from it, everything that plays with its hash and has not got it — the Game view of a replay, Play From Here, Test in
 * Browser, a replay's analysis — finds its files here, and the play page keeps them as a dropped mod. Nothing is read
 * until a page says it has not got the mod.
 *
 * The files are what the mod's hash is worked out over (`ModSession.hash`, `@scm-js/mod`'s identity), in the game's
 * paths (`handedFiles`): every file the mod provides as it is now, every module of its code that has a line in the hash
 * (its plugins and the libraries they map, given as files or carried in a patcher exe) under `plugins/`, and its
 * FireGraft files under `firegraft/`. The page reads them with the same reader, so it names them by the same hash, and
 * a mod whose code runs is kept with its code (Play hands only the files that differ from the game's: kept without its
 * plugins, such a mod would play another game).
 */
import type { ModSession } from "./session";
import { handedFiles } from "./source";

export const ENGINE_SERVICE = "scm-sim.engine";

/** A mod's file as the engine's page takes it: by the game's path, or a plugin or project under its own folder. */
export interface EngineFile { path: string; bytes: Uint8Array }
/** `scm-sim.engine`, as far as this plugin uses it. */
export interface EngineService {
  readonly present: boolean;
  provideMod?(hash: string, mod: { name?: string; url?: string; files: () => Promise<EngineFile[]> }): { dispose(): void };
}

type EngineSession = Pick<ModSession, "members" | "has" | "read" | "nameOf" | "source">;

/** The open mod's files for the engine: every file it provides as it is now, and its code (`handedFiles`). */
export async function engineFiles(s: EngineSession): Promise<EngineFile[]> {
  return handedFiles(s.source, s.members().filter((k) => s.has(k)), (k) => s.read(k), (k) => s.nameOf(k));
}

/**
 * Keeps the open mod registered with the engine under its current hash: `set` with the session and hash now (null for
 * none: the mod closed, or the editor no longer draws from it), and again whenever either changes. An engine without
 * `provideMod` (plugin-scm-sim before 0.19.0), or none at all, is left alone.
 */
export class EngineRegistration {
  private engine: EngineService | null = null;
  private now: { session: EngineSession; name: string; hash: string } | null = null;
  private held: { hash: string; session: unknown; dispose(): void } | null = null;

  /** The engine service came or went. */
  service(engine: EngineService | null): void {
    this.engine = engine && engine.present ? engine : null;
    this.sync();
  }

  /** The mod open now and the hash it is named by; null for none. */
  set(mod: { session: EngineSession; name: string; hash: string | null } | null): void {
    this.now = mod && mod.hash ? { session: mod.session, name: mod.name, hash: mod.hash } : null;
    this.sync();
  }

  /** The hash registered now, or null. */
  registered(): string | null { return this.held?.hash ?? null; }

  private sync(): void {
    const now = this.now, engine = this.engine;
    if (this.held && (!now || !engine || this.held.hash !== now.hash || this.held.session !== now.session)) {
      try { this.held.dispose(); } catch { /* the engine is gone */ }
      this.held = null;
    }
    if (this.held || !now || !engine || typeof engine.provideMod !== "function") return;
    const session = now.session;
    try {
      const handle = engine.provideMod(now.hash, { name: now.name, files: () => engineFiles(session) });
      this.held = { hash: now.hash, session, dispose: () => handle.dispose() };
    } catch { /* an engine that refuses it: nothing registered */ }
  }

  dispose(): void { this.now = null; this.engine = null; this.sync(); }
}
