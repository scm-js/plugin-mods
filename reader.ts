/**
 * The mod as the editor reads a data set: `api.gameData.attach(profile, read)` asks for each file by its path in an
 * extracted copy and names the member the game's archives know it by (`file.member`: `arr\units.dat`,
 * `rez\stat_txt.tbl` for `tileset/stat_txt.tbl`). This answers each from the mod's current files — a table or script
 * the person edited encoded back, the rest as they came — or null, which leaves the file to the data set underneath.
 * The copy's own lists (`unit/manifest.json`) are left to the editor, which works out a reader's tables and names
 * itself. Pure: the files come through the functions given.
 */
import { gameName } from "@scm-js/core";
import type { GameDataReadContext, GameDataReader } from "@scm-js/plugin-api";

export interface ReaderFiles {
  /** Whether the mod has a member now, by the game's name. */
  has(member: string): boolean;
  /** A member's current bytes. */
  read(member: string): Promise<Uint8Array | null>;
}

/** The function to hand `api.gameData.attach`. */
export function attachReader(files: ReaderFiles): GameDataReader {
  return async (_path: string, file: GameDataReadContext) => {
    const member = file?.member ? gameName(file.member) : null;
    return member && files.has(member) ? files.read(member) : null;
  };
}
