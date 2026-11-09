import { describe, expect, it } from "vitest";
import { engineFiles, EngineRegistration, type EngineFile, type EngineService } from "../engine";
import { openPieces } from "../source";
import { ModSession } from "../session";
import { bytesPiece, madeFolder } from "./support";

/** A stand-in for plugin-scm-sim's `scm-sim.engine` (0.19.0): what is registered under which hash now. */
function fakeEngine() {
  const live = new Map<string, { name?: string; files: () => Promise<EngineFile[]> }>();
  const log: string[] = [];
  const engine: EngineService = {
    present: true,
    provideMod: (hash, mod) => {
      live.set(hash, mod);
      log.push(`+${hash}`);
      return { dispose: () => { if (live.get(hash) === mod) live.delete(hash); log.push(`-${hash}`); } };
    },
  };
  return { engine, live, log };
}

const open = async (extra: ReturnType<typeof bytesPiece>[] = []) => ModSession.open(await openPieces([...madeFolder(), ...extra], "made"), { base: null });
const A = "1111222233334444", B = "5555666677778888";

describe("the open mod, registered with the engine by its hash", () => {
  it("registers once a hash is known, again under a new hash, and not after the mod closes", async () => {
    const { engine, live, log } = fakeEngine();
    const reg = new EngineRegistration();
    reg.service(engine);
    const session = await open();
    // (no hash yet: a large mod's is worked out after it opens)
    reg.set({ session, name: "made", hash: null });
    expect(log).toEqual([]);
    reg.set({ session, name: "made", hash: A });
    expect(reg.registered()).toBe(A);
    expect(live.get(A)?.name).toBe("made");
    // The same again: nothing changes. An edit that changes the hash: registered again under the new one.
    reg.set({ session, name: "made", hash: A });
    reg.set({ session, name: "made", hash: B });
    expect(log).toEqual([`+${A}`, `-${A}`, `+${B}`]);
    expect([...live.keys()]).toEqual([B]);
    reg.set(null);
    expect(live.size).toBe(0);
    expect(reg.registered()).toBeNull();
  });

  it("registers when the engine comes after the mod, and lets go when it goes", async () => {
    const { engine, live } = fakeEngine();
    const reg = new EngineRegistration();
    reg.set({ session: await open(), name: "made", hash: A });
    expect(reg.registered()).toBeNull();
    reg.service(engine);
    expect([...live.keys()]).toEqual([A]);
    reg.service(null);
    expect(live.size).toBe(0);
  });

  it("does nothing with an engine from before provideMod, or one that throws", async () => {
    const reg = new EngineRegistration();
    const session = await open();
    reg.service({ present: true });
    expect(() => reg.set({ session, name: "made", hash: A })).not.toThrow();
    expect(reg.registered()).toBeNull();
    reg.service({ present: true, provideMod: () => { throw new Error("no"); } });
    expect(reg.registered()).toBeNull();
    reg.service({ present: false, provideMod: () => ({ dispose() {} }) });
    expect(reg.registered()).toBeNull();
  });

  it("builds the files only when asked: every file the mod provides, its plugins and FireGraft project", async () => {
    const { engine, live } = fakeEngine();
    const session = await open([bytesPiece("made/plugins/made.qdp", new Uint8Array([77, 90])), bytesPiece("made/made.fgp", new Uint8Array([1, 2, 3]))]);
    let asked = 0;
    const counted = { members: () => { asked++; return session.members(); }, has: (k: string) => session.has(k), read: (k: string) => session.read(k), nameOf: (k: string) => session.nameOf(k), source: session.source };
    const reg = new EngineRegistration();
    reg.service(engine);
    reg.set({ session: counted, name: "made", hash: A });
    expect(asked).toBe(0);
    const files = await live.get(A)!.files();
    expect(asked).toBe(1);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain("arr/units.dat");
    expect(paths).toContain("scripts/iscript.bin");
    expect(paths).toContain("plugins/made.qdp");
    expect(paths).toContain("firegraft/made.fgp");
    // (not the read-me beside the game's folders)
    expect(paths.some((p) => p.includes("readme"))).toBe(false);
    expect(files.find((f) => f.path === "plugins/made.qdp")?.bytes).toEqual(new Uint8Array([77, 90]));
    expect(await engineFiles(session)).toHaveLength(files.length);
  });
});
