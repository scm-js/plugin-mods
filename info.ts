/**
 * What a mod is, in one line, as `scmjs mod info` says it: its name, where it came from, its files by kind, and which
 * tables are wider than the game's. Read from names and sizes only; nothing is decoded.
 */
import { DAT_SCHEMAS } from "@scm-js/core";
import { MOD_KINDS, gameCopyText, kindOf, tableShape, type ModKind } from "@scm-js/mod";
import { modWords, t } from "./i18n";
import type { ModSource } from "./source";

export interface ModSummary {
  files: number;
  bytes: number;
  kinds: Partial<Record<ModKind, number>>;
  /** Tables wider than the game's: `units.datex`, 3,000 entries, GPTP's `.datex` layout. */
  extended: { member: string; entries: number; layout: "expanded" | "datex" }[];
}

export function summarize(source: ModSource): ModSummary {
  const kinds: ModSummary["kinds"] = {};
  let bytes = 0;
  const extended: ModSummary["extended"] = [];
  for (const f of source.files.values()) {
    const k = kindOf(f.name);
    kinds[k] = (kinds[k] ?? 0) + 1;
    bytes += f.size;
    if (source.kind === "mod folder") continue;
    const shape = tableShape(f.name, f.size);
    if (shape?.extended && shape.entries !== null && (shape.layout === "expanded" || shape.layout === "datex")) extended.push({ member: f.name, entries: shape.entries, layout: shape.layout });
  }
  extended.sort((a, b) => (a.member < b.member ? -1 : 1));
  return { files: source.files.size, bytes, kinds, extended };
}

export const num = (n: number) => n.toLocaleString("en");

export function sizeText(bytes: number): string {
  if (bytes < 1024) return t("{n} bytes", { n: num(bytes) });
  if (bytes < 1024 * 1024) return t("{n} KB", { n: (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) });
  return t("{n} MB", { n: (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) });
}

function kindText(kind: ModKind, n: number): string {
  switch (kind) {
    case "tables": return t("{n, plural, one {{count} table} other {{count} tables}}", { n, count: num(n) });
    case "scripts": return t("{n, plural, one {{count} script} other {{count} scripts}}", { n, count: num(n) });
    case "pictures": return t("{n, plural, one {{count} picture} other {{count} pictures}}", { n, count: num(n) });
    case "sounds": return t("{n, plural, one {{count} sound} other {{count} sounds}}", { n, count: num(n) });
    case "terrain": return t("{n, plural, one {{count} terrain file} other {{count} terrain files}}", { n, count: num(n) });
    case "strings": return t("{n, plural, one {{count} string table} other {{count} string tables}}", { n, count: num(n) });
    case "AI": return t("{n, plural, one {{count} AI script} other {{count} AI scripts}}", { n, count: num(n) });
    case "maps": return t("{n, plural, one {{count} map} other {{count} maps}}", { n, count: num(n) });
    default: return t("{n, plural, one {{count} other file} other {{count} other files}}", { n, count: num(n) });
  }
}

function fromText(kind: ModSource["kind"]): string {
  switch (kind) {
    case "mod folder": return t("a mod folder");
    case "folder": return t("a folder of the game's files");
    case "archive": return t("an MPQ");
    case "exe": return t("a self-executing mod (its archive read, nothing run)");
    default: return t("a zip");
  }
}

/** The line the panel shows when a mod opens. */
export function foundLine(source: ModSource): string {
  const s = summarize(source);
  const kinds = MOD_KINDS.filter((k) => s.kinds[k]).map((k) => kindText(k, s.kinds[k]!)).join(", ");
  const parts = [t("{name}, from {from}: {files} files ({size}) — {kinds}.", { name: source.name, from: fromText(source.kind), files: num(s.files), size: sizeText(s.bytes), kinds: kinds || t("nothing of the game's") })];
  const units = s.extended.find((e) => /units\.dat/i.test(e.member));
  if (s.extended.length) {
    parts.push(s.extended.every((e) => e.layout === "datex")
      ? t("{n, plural, one {{count} table} other {{count} tables}} in GPTP's .datex layout", { n: s.extended.length, count: num(s.extended.length) })
      : t("{n, plural, one {{count} table} other {{count} tables}} wider than the game's", { n: s.extended.length, count: num(s.extended.length) }));
    if (units) parts[parts.length - 1] += t(" ({n} unit types, the game has {standard})", { n: num(units.entries), standard: num(DAT_SCHEMAS.units.entries) }) + ".";
    else parts[parts.length - 1] += ".";
  }
  const carried = source.plugins.length + source.firegraft.length;
  if (carried) parts.push(t("{n, plural, one {{count} plugin or FireGraft file} other {{count} plugins or FireGraft files}} kept, not run.", { n: carried, count: num(carried) }));
  const copy = gameCopyNotice(source);
  if (copy) parts.push(copy);
  return parts.join(" ");
}

/** What was left out as a copy of the game handed over with the mod, a sentence a copy (`@scm-js/mod`'s); "" when there was none. */
export function gameCopyNotice(source: ModSource): string {
  return gameCopyText(source.gameCopy, source.name).map(modWords).join(" ");
}
