/**
 * What a mod is, in one line, as `scmjs mod info` says it: its name, where it came from, its files by kind, and which
 * tables are wider than the game's. Read from names and sizes only; nothing is decoded.
 */
import { DAT_SCHEMAS, datShape, datTableOf, gameName } from "@scm-js/core";
import { t } from "./i18n";
import { gameCopies, type ModSource } from "./source";

/** The kinds of file a mod changes, in the order they are named (the command line and the play page name them alike). */
export const MOD_KINDS = ["tables", "scripts", "pictures", "sounds", "terrain", "strings", "AI", "maps", "other"] as const;
export type ModKind = (typeof MOD_KINDS)[number];

export function kindOf(name: string): ModKind {
  const lower = gameName(name);
  const [top] = lower.split("\\");
  if (/^scripts\\(aiscript|bwscript)\.bin$/.test(lower)) return "AI";
  if (top === "scripts") return "scripts";
  if (top === "arr") return lower.endsWith(".tbl") ? "strings" : /\.dat(ex)?$/.test(lower) ? "tables" : "other";
  if (top === "tileset") return "terrain";
  if (top === "maps" || /\.sc[mx]$/.test(lower)) return "maps";
  if (/\.(wav|ogg)$/.test(lower) || top === "sound" || top === "music") return "sounds";
  if (lower.endsWith(".tbl") || top === "font") return "strings";
  if (/\.(grp|pcx|lo[a-z]|dds|anim|smk|spk|bmp|png)$/.test(lower) || ["unit", "game", "dlgs", "cursor", "portrait"].includes(top)) return "pictures";
  return "other";
}

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
    const table = /^arr\\[^\\]+\.dat(?:ex)?$/.test(gameName(f.name)) ? datTableOf(f.name) : null;
    if (!table || source.kind === "mod folder") continue;
    const shape = datShape(table, f.size, f.name);
    if (shape && shape.layout !== "dat") extended.push({ member: f.name, entries: shape.count, layout: shape.layout });
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

/** What was left out as a copy of the game handed over with the mod, a sentence a copy; "" when there was none. */
export function gameCopyNotice(source: ModSource): string {
  return gameCopies(source.gameCopy).map(({ folder, names }) => {
    const list = names.slice(0, 6).join(", ") + (names.length > 6 ? ` ${t("and {n} more", { n: num(names.length - 6) })}` : "");
    return t("{folder} is a copy of the game. Its own archives ({list}) are not part of the mod and were left out.", { folder: folder || source.name, list });
  }).join(" ");
}
