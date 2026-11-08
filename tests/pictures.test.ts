import { describe, expect, it } from "vitest";
import { decodeGrpImage, decodeLoFile, decodePng, emptyDat, encodeDat, encodeGrpImage, encodeLoFile, encodePng, encodeTblFile, iscriptFromText, parseWavHeader, type GrpImage } from "@scm-js/core";
import { exportPng, frameRgba, importPng, paletteRgba, pictureList, teamLut } from "../pictures";
import { AnimationRunner, ScriptIndex, animationsOf, findScript } from "../animate";
import { GAME_WAV, convertToWav, decodePcmWav, encodeWav } from "../wav";
import { openPieces } from "../source";
import { ModSession } from "../session";
import { bytesPiece, equal } from "./support";

/** A palette of plain steps: index i is (i, 255 − i, i / 2). */
const PALETTE = new Uint8Array(1024).map((_, k) => { const i = k >> 2, c = k & 3; return c === 0 ? i : c === 1 ? 255 - i : c === 2 ? i >> 1 : 0; });
const named = { name: "steps", colours: PALETTE };

/** Two 8 × 8 frames: a square of team colour (index 8) on the first, a diagonal of index 100 on the second. */
function madeGrp(): GrpImage {
  const a = new Uint8Array(64), b = new Uint8Array(64);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) a[y * 8 + x] = 8;
  for (let i = 0; i < 8; i++) b[i * 8 + i] = 100;
  const frame = (p: Uint8Array) => ({ x: 0, y: 0, width: 8, height: 8, pixels: p });
  return decodeGrpImage(encodeGrpImage({ width: 8, height: 8, frames: [frame(a), frame(b)] }));
}

describe("pictures", () => {
  it("a frame drawn through the palette, team colour from a tunit row, mirrored", () => {
    const grp = madeGrp();
    const pal = paletteRgba(PALETTE);
    const plain = frameRgba(grp, 0, pal, teamLut(null, null));
    expect([...plain.subarray((2 * 8 + 2) * 4, (2 * 8 + 2) * 4 + 4)]).toEqual([8, 247, 4, 255]);
    expect(plain[3]).toBe(0); // index 0 is transparent
    const tunit = new Uint8Array(128).map((_, i) => 200 + (i % 8)); // every row's ramp starts at 200
    const red = frameRgba(grp, 0, pal, teamLut(tunit, 0));
    expect([...red.subarray((2 * 8 + 2) * 4, (2 * 8 + 2) * 4 + 3)]).toEqual([200, 55, 100]);
    const flipped = frameRgba(grp, 1, pal, teamLut(null, null), true);
    expect(flipped[(0 * 8 + 7) * 4 + 3]).toBe(255); // the diagonal's first pixel lands at the right
  });

  it("export as a PNG sheet and import it back: the same GRP, nothing lost", async () => {
    const bytes = encodeGrpImage(madeGrp());
    const png = await exportPng(bytes, named, "unit\\made\\made.grp");
    const plan = await importPng(decodeGrpImage(bytes), png, named, 0);
    expect("refused" in plan).toBe(false);
    if ("refused" in plan) return;
    expect(plan.kind).toBe("sheet");
    expect(plan.report.coloursLost).toEqual([]);
    expect(equal(plan.grp, bytes)).toBe(true);
  });

  it("a full-colour picture of one frame replaces that frame, with the colours it lost", async () => {
    const grp = madeGrp();
    const rgba = new Uint8Array(64 * 4);
    for (let i = 0; i < 64; i++) rgba.set(i % 2 ? [8, 247, 4, 255] : [13, 240, 9, 255], i * 4); // index 8's colour, and one near it
    const plan = await importPng(grp, await encodePng({ width: 8, height: 8, rgba }), named, 1);
    if ("refused" in plan) throw new Error("refused");
    expect(plan.kind).toBe("frame");
    expect(plan.report.coloursLost.map((c) => c.colour)).toEqual(["#0df009"]);
    expect(plan.report.pixelsChanged).toBe(32);
    const back = decodeGrpImage(plan.grp);
    expect(back.frames.length).toBe(2);
    expect(equal(back.frames[0].pixels, grp.frames[0].pixels)).toBe(true);
    expect(new Set(back.frames[1].pixels)).toEqual(new Set([8, plan.report.coloursLost[0].became]));
    // A picture of another size is refused.
    expect(await importPng(grp, await encodePng({ width: 5, height: 3, rgba: new Uint8Array(60) }), named, 0)).toEqual({ refused: "size", width: 5, height: 3 });
    expect((await decodePng(await exportPng(plan.grp, named, "x"))).width).toBe(16);
  });

  it("lists the mod's GRPs and the game's its images name, with the images that draw each", async () => {
    const images = emptyDat("images");
    images.columns.grp_file[0] = 1; images.columns.grp_file[1] = 1; images.columns.grp_file[2] = 2;
    const tbl = encodeTblFile({ strings: ["terran\\marine.grp\0", "made\\made.grp\0"], encoding: "windows-1252" });
    const s = await ModSession.open(await openPieces([bytesPiece("m/arr/images.dat", encodeDat(images)), bytesPiece("m/arr/images.tbl", tbl), bytesPiece("m/unit/made/made.grp", encodeGrpImage(madeGrp())), bytesPiece("m/unit/made/extra.grp", encodeGrpImage(madeGrp()))], "m"), { base: null });
    expect(pictureList(s)).toEqual([
      { member: "unit\\made\\extra.grp", own: true, images: [] },
      { member: "unit\\made\\made.grp", own: true, images: [2] },
      { member: "unit\\terran\\marine.grp", own: false, images: [0, 1] },
    ]);
    // An imported picture is the member's bytes now, and the mod's edited files say so.
    const plan = await importPng(madeGrp(), await exportPng(encodeGrpImage({ ...madeGrp(), frames: madeGrp().frames.slice().reverse() }), named, "x"), named, 0);
    if ("refused" in plan) throw new Error("refused");
    s.setMember("unit\\made\\made.grp", plan.grp);
    expect(await s.edited()).toEqual(["unit\\made\\made.grp"]);
  });
});

describe("sounds", () => {
  it("a 44.1 kHz stereo WAV becomes the game's 22050 Hz mono 16-bit, and reads back", async () => {
    const n = 4410;
    const left = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 441 * i) / 44100) * 0.5), right = left.map((x) => -x * 0.5);
    const input = encodeWav([left, right], 44100, 16);
    const out = await convertToWav(input, GAME_WAV);
    expect(out.converted).toBe(true);
    expect(out.seconds).toBeCloseTo(0.1, 5);
    const info = parseWavHeader(out.bytes)!;
    expect([info.format, info.sampleRate, info.channels, info.bitsPerSample]).toEqual([1, 22050, 1, 16]);
    const back = decodePcmWav(out.bytes)!;
    expect(back.channels[0].length).toBe(2205);
    // Mono is the channels' mean: (0.5 sin − 0.25 sin) / 2, a 441 Hz wave at an eighth of full scale.
    expect(Math.max(...back.channels[0])).toBeCloseTo(0.125, 2);
    // Already the game's format: kept byte for byte.
    expect((await convertToWav(out.bytes, GAME_WAV)).converted).toBe(false);
    await expect(convertToWav(new Uint8Array([1, 2, 3]), GAME_WAV)).rejects.toThrow(/not a sound/);
  });
});

describe("overlays", () => {
  it("a .lo? as PyLO text, edited, assembled back; an error named with its line", async () => {
    const lo = encodeLoFile({ frames: [[[1, -2], [3, 4]], [[5, 6], [-7, 8]]] });
    const s = await ModSession.open(await openPieces([bytesPiece("m/unit/made/made.lob", lo)], "m"), { base: null });
    const doc = s.scripts.find((d) => d.kind === "overlay")!;
    expect(doc.label).toBe("overlays/unit/made/made.lob.txt");
    const state = await s.scriptState(doc.id);
    expect(state.text).toBe("Frame:\n    (1, -2)\n    (3, 4)\n\nFrame:\n    (5, 6)\n    (-7, 8)\n\n");
    expect(equal(encodeLoFile(decodeLoFile(lo)), lo)).toBe(true);
    const bad = await s.setScriptText(doc.id, state.text!.replace("(5, 6)", "(500, 6)"));
    expect(bad.error).toEqual({ line: 6, message: "(500, 6) is outside −128…127" });
    await s.setScriptText(doc.id, bad.text!.replace("(500, 6)", "(9, 6)"));
    expect(decodeLoFile((await s.read("unit\\made\\made.lob"))!).frames[1][0]).toEqual([9, 6]);
  });
});

describe("the animation preview", () => {
  const TEXT = `.headerstart
IsId             	7
Type             	12
Init             	Thing_Init
Death            	Thing_Death
GndAttkInit      	Thing_Attack
AirAttkInit      	[NONE]
Unused1          	[NONE]
GndAttkRpt       	Thing_Attack
AirAttkRpt       	[NONE]
CastSpell        	[NONE]
GndAttkToIdle    	Thing_Init
AirAttkToIdle    	[NONE]
Unused2          	[NONE]
Walking          	[NONE]
WalkingToIdle    	[NONE]
SpecialState1    	[NONE]
.headerend

Thing_Init:
	playfram         	0x00
	goto             	Thing_Local

Thing_Local:
	wait             	125
	goto             	Thing_Local

Thing_Attack:
	playsnd          	69
	playfram         	0x11
	wait             	2
	attackwith       	1
	playfram         	0x22
	wait             	1
	gotorepeatattk
	goto             	Thing_Init

Thing_Death:
	playfram         	0x33
	wait             	1
	castspell
	tmprmgraphicstart
	end
`;

  it("steps an attack: frames by facing, the waits, what it skipped", () => {
    const bytes = iscriptFromText(TEXT);
    const found = findScript([{ member: "scripts\\iscript.bin", bytes }], 7)!;
    expect(animationsOf(found.anims).map((a) => a.name)).toEqual(["Init", "Death", "GndAttkInit", "GndAttkRpt", "GndAttkToIdle"]);
    const run = new AnimationRunner(bytes, found.anims[2], { turns: true, direction: 20 });
    const frames: string[] = [];
    for (let i = 0; i < 7; i++) { run.tick(); frames.push(`${run.pose.frame}${run.pose.flip ? "f" : ""}`); }
    // Facing 20 is facing 12 mirrored: 0x11 + 12, then 0x22 + 12, then back to the idle frame 0 + 12.
    expect(frames).toEqual(["29f", "29f", "46f", "12f", "12f", "12f", "12f"]);
    expect([...run.skipped].sort()).toEqual(["attackwith", "gotorepeatattk", "playsnd"]);
    expect(run.stopped).toBeNull();
  });

  it("stops at what it does not model and says which", () => {
    const bytes = iscriptFromText(TEXT.replace("\tcastspell\n", "\tcastspell\n\tsigorder         \t1\n\tturnrand         \t3\n\t__3e\n"));
    const found = findScript([{ member: "scripts\\iscript.bin", bytes }], 7)!;
    const run = new AnimationRunner(bytes, found.anims[1], { turns: false });
    for (let i = 0; i < 5; i++) run.tick();
    expect(run.pose.frame).toBe(0x33);
    expect(run.stopped).toMatchObject({ kind: "unmodelled", name: "__3e" });
  });

  it("finds a header in the file an id's high word picks, learned from the images that use it", () => {
    const one = (ids: number[]) => iscriptFromText(ids.map((id) => `.headerstart\nIsId             \t${id}\nType             \t0\nInit             \tS${id}_Init\n.headerend\n\nS${id}_Init:\n\tplayfram         \t${id}\n\tend\n`).join("\n"));
    const a = { member: "scripts\\a.bin", bytes: one([7, 8]) }, b = { member: "scripts\\b.bin", bytes: one([7, 9]) };
    const index = new ScriptIndex([a, b], [0x10007, 0x10009, 8]);
    expect(index.find(0x10007)?.member).toBe("scripts\\b.bin");
    expect(index.find(7)?.member).toBe("scripts\\a.bin");
    expect(index.find(0x20008)?.member).toBe("scripts\\a.bin");
    expect(index.find(10)).toBeNull();
  });
});
