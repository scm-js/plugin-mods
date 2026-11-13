/**
 * The archives this plugin writes: an MPQ of members (`scmjs mod pack`'s rules: name order, 4,096-byte sectors, a
 * listfile, one compression for all), and a mod's program with a new archive where its own was.
 *
 * A self-executing mod (FireGraft's patcher, MPQDraft's self-executing MPQ) is a program, then what its loader carries
 * (FireGraft's overlay of plugins; MPQDraft's file system of plugins and their data files), then the archive, at the
 * place storm finds it (`at`, `@scm-js/mod`'s `exeArchive`). Everything before that place is kept byte for byte — the
 * plugins in the order the loader loads them, each by the name it gives itself — and the archive written here is laid
 * where the old one was, so the program, a loader and every reader take it as the same patcher with the files it has now.
 */
import { Creator } from "mopaq";

export type Compression = "zlib" | "pkware" | "none";

/** The members as an MPQ. */
export async function writeMpq(members: readonly { member: string; data: Uint8Array }[], compression: Compression = "zlib"): Promise<Uint8Array> {
  const creator = new Creator({ sectorSize: 4096, listfile: true, listfileCompress: compression === "pkware" ? "pkware" : "zlib" });
  for (const m of members) creator.addFile(m.member, m.data, { compress: compression === "none" ? false : compression });
  return creator.writeAsync();
}

/** `program` (a self-executing mod's exe) with `archive` in place of its own, whose header was at `at`. */
export function withArchive(program: Uint8Array, at: number, archive: Uint8Array): Uint8Array {
  if (at <= 0 || at > program.length) throw new RangeError(`no archive at ${at} in a program of ${program.length} bytes`);
  const out = new Uint8Array(at + archive.length);
  out.set(program.subarray(0, at));
  out.set(archive, at);
  return out;
}
