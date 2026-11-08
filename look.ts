/**
 * How pictures are drawn in the panel: a tileset's palette (`tileset\<name>.wpe`, the mod's own first, else the
 * game's) and a team colour (a row of `game\tunit.pcx`, the mod's own first). Shared by the Pictures tab and the
 * animation preview, so both draw alike.
 */
import { decodePcxImage, type NamedPalette } from "@scm-js/core";
import { paletteRgba, teamLut } from "./pictures";
import type { PreviewLook } from "./preview";
import type { ModSession } from "./session";

export class Look {
  palette = "jungle";
  /** A `tunit.pcx` row, or -1 for none. */
  team = 0;
  private wpe = new Map<string, Uint8Array | null>();
  private tunit: Uint8Array | null | undefined;
  private readonly session: ModSession;

  constructor(session: ModSession) {
    this.session = session;
  }

  /** Reads the palette and team colours in use (once each). */
  async load(): Promise<void> {
    if (!this.wpe.has(this.palette)) this.wpe.set(this.palette, await this.session.readOver(`tileset\\${this.palette}.wpe`));
    if (this.tunit === undefined) {
      const pcx = await this.session.readOver("game\\tunit.pcx");
      try { this.tunit = pcx ? decodePcxImage(pcx).pixels : null; } catch { this.tunit = null; }
    }
  }

  /** The palette's bytes as read, or null when neither the mod nor the game has it. */
  colours(): Uint8Array | null {
    return this.wpe.get(this.palette) ?? null;
  }

  named(): NamedPalette | null {
    const c = this.colours();
    return c ? { name: this.palette, colours: c } : null;
  }

  current(): PreviewLook | null {
    const c = this.colours();
    return c ? { palette: paletteRgba(c), lut: teamLut(this.tunit ?? null, this.team >= 0 ? this.team : null) } : null;
  }

  hasTeamColours(): boolean {
    return !!this.tunit;
  }
}
