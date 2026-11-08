/**
 * A table's fields as columns, and a value as a person reads and types it: hit points in whole points (the table
 * keeps 1/256ths), supply in whole units (the table keeps halves), flags in hex, the rest as numbers. Pure.
 */
import { DAT_SCHEMAS, type DatField, type DatTableName } from "@scm-js/core";
import { msg } from "./i18n";

export interface Column {
  field: DatField;
  /** A struct field's part (`unit_extents.left`). */
  part?: string;
  /** PyMS's name, dotted for a part. */
  key: string;
}

export function columnsOf(table: DatTableName): Column[] {
  const out: Column[] = [];
  for (const field of DAT_SCHEMAS[table].fields) {
    if (field.parts) for (const part of field.parts) out.push({ field, part, key: `${field.name}.${part}` });
    else out.push({ field, key: field.name });
  }
  return out;
}

/** A stored value as text. */
export function display(field: DatField, value: number): string {
  const coder = field.text;
  // Exact: a value in 1/256ths has at most eight decimals, and reads back to itself.
  if (coder?.kind === "hitPoints") return String(value / 256);
  if (coder?.kind === "supply") return String(value / 2);
  if (coder?.kind === "flags") return `0x${value.toString(16).padStart(Math.ceil(coder.bits / 4), "0")}`;
  return String(value);
}

/** What a person typed, as the value to store, or why it is not one (for `translate`). The range is checked by the session. */
export function parse(field: DatField, text: string): number | { error: string } {
  const s = text.trim().replace(/,/g, "");
  if (!s) return { error: msg("A number is needed.") };
  const coder = field.text;
  if (coder?.kind === "hitPoints" || coder?.kind === "supply") {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return { error: msg("A number of 0 or more is needed.") };
    const stored = coder.kind === "hitPoints" ? n * 256 : n * 2;
    if (Math.abs(stored - Math.round(stored)) > 1e-6) return { error: coder.kind === "hitPoints" ? msg("Hit points go in 1/256ths.") : msg("Supply goes in halves.") };
    return Math.round(stored);
  }
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s.slice(2), 16) : /^-?\d+$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n)) return { error: msg("A whole number is needed (0x… for hex).") };
  return n;
}
