/**
 * What points at what, from the schema's `ref`: a unit's ground weapon at a weapons entry, a flingy at a sprite, an
 * image's `grp_file` at an entry of images.tbl. Read the other way it is the "used by" list — which units carry this
 * weapon, which images draw this GRP. Pure.
 */
import { DAT_SCHEMAS, DAT_TABLES, storedRange, type DatFile, type DatTableName } from "@scm-js/core";

export interface RefFrom { table: DatTableName; id: number; field: string }

/** A target of references: a table entry, or an entry of a string table (`images.tbl` 12, 1-based as the tables store it). */
export type RefTarget = string;

export class RefIndex {
  private readonly by = new Map<string, RefFrom[]>();

  constructor(tables: Partial<Record<DatTableName, DatFile>>) {
    for (const t of DAT_TABLES) {
      const file = tables[t];
      if (!file) continue;
      for (const field of DAT_SCHEMAS[t].fields) {
        if (!field.ref || field.parts || field.name === "sublabel") continue;
        const [from, end] = storedRange(field, file.layout, file.count);
        const col = file.columns[field.name];
        for (let id = from; id < end && id < file.count; id++) {
          const v = col[id];
          // 0 is "none" for a string id; a table's "none" is past its end and lands nowhere anyone asks about.
          if (field.ref.endsWith(".tbl") && v === 0) continue;
          const key = `${field.ref}:${v}`;
          let list = this.by.get(key);
          if (!list) { list = []; this.by.set(key, list); }
          list.push({ table: t, id, field: field.name });
        }
      }
    }
  }

  /** Every entry whose field points at `target` `id` (a table's id, a string table's 1-based entry, an iscript id). */
  usedBy(target: RefTarget, id: number): RefFrom[] {
    return this.by.get(`${target}:${id}`) ?? [];
  }
}
