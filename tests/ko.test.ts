import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOD_MESSAGES, renderMessage, say, templateParams } from "@scm-js/mod";
import { modWords } from "../i18n";
import { KO } from "../ko";
import { MOD_KO } from "../modKo";

// Every literal the plugin shows through `t("…")` or keeps for later through `msg("…")`, read from every source file.
const files = readdirSync(new URL("..", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && f !== "ko.ts" && f !== "i18n.ts" && f !== "vitest.config.ts");
const sources = files.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const keys = new Set(sources.flatMap((source) => [...source.matchAll(/\b(?:t|msg)\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string)));

/** The placeholders a string fills: `{name}`, `{n, plural, …}`, `{name|을}` — not the words inside a plural's branches. */
const names = (s: string) => new Set([...s.matchAll(/\{(\w+)(?=[},|])/g)].map((m) => m[1]));
/** The ones only English needs: the count a plural chooses its branch by. */
const counts = (s: string) => new Set([...s.matchAll(/\{(\w+), plural/g)].map((m) => m[1]));

describe("the Korean catalogue", () => {
  it("has every string the plugin shows", () => {
    expect([...keys].filter((k) => !(k in KO))).toEqual([]);
  });

  it("has nothing the plugin no longer shows", () => {
    expect(Object.keys(KO).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("keeps every placeholder, and adds none", () => {
    for (const [en, ko] of Object.entries(KO)) {
      const want = [...names(en)].filter((n) => !counts(en).has(n) || names(ko).has(n)).sort();
      expect([...names(ko)].sort(), en).toEqual(want);
    }
  });

  // The editor reads a particle inside the braces, `{file|은}`; written after them, `{file}|은`, the bar is shown.
  it("writes a particle inside its placeholder", () => {
    expect(Object.entries(KO).filter(([, ko]) => /\}\|/.test(ko)).map(([en]) => en)).toEqual([]);
  });
});

describe("the Korean for @scm-js/mod's sentences", () => {
  const templates = Object.values(MOD_MESSAGES).map((m) => m.text as string);

  it("has every template the package can produce, and nothing else", () => {
    expect(templates.filter((en) => !(en in MOD_KO))).toEqual([]);
    expect(Object.keys(MOD_KO).filter((en) => !templates.includes(en))).toEqual([]);
  });

  it("keeps every placeholder, and adds none (the package's own reading of a template; a particle is Korean only)", () => {
    for (const m of Object.values(MOD_MESSAGES) as { text: string; params: readonly string[]; hidden?: readonly string[] }[]) {
      const ko = [...templateParams(MOD_KO[m.text])].map((n) => n.split("|")[0]).sort();
      // (a message with a parameter its English does not show: the Korean shows it, the translated reason, in place of the library's text)
      if (m.hidden) expect(ko, m.text).toEqual([...templateParams(m.text), ...m.hidden].filter((n) => n !== "why").sort());
      else expect(ko, m.text).toEqual([...templateParams(m.text)].sort());
    }
  });

  it("an archive that cannot be opened: the reason translated in Korean, the library's text in English", () => {
    const fill = (template: string, params: Readonly<Record<string, string | number>>) => template.replace(/\{(\w+)(\|[^}]*)?\}/g, (_, k) => String(params[k] ?? ""));
    for (const m of [say("archive-unopenable", { path: "a.mpq", why: "Invalid MPQ header", reason: say("mpq-damaged", { detail: "Invalid MPQ header" }) }), say("exe-archive-unopenable", { path: "a.exe", at: 512, why: "Invalid MPQ header", reason: say("mpq-damaged", { detail: "Invalid MPQ header" }) })]) {
      expect(m.text).toContain(": Invalid MPQ header");
      expect(renderMessage(m, (template, params) => fill(MOD_KO[template] ?? template, params))).toContain("손상되었습니다(Invalid MPQ header)");
    }
  });

  it("shares no key with the plugin's own catalogue", () => {
    expect(Object.keys(MOD_KO).filter((en) => en in KO)).toEqual([]);
  });

  it("a message is shown through the catalogue by its template; with no editor to ask, in the package's English", () => {
    for (const m of [say("game-copy", { folder: "Game", list: "StarDat.mpq, BrooDat.mpq", more: 3 }), say("copy-only", { folder: "Game" })]) expect(modWords(m)).toBe(m.text);
  });
});
