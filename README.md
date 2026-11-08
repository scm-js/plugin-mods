# Mod Editor

A plugin for the [scmJS](https://github.com/scm-js/scm-js) StarCraft map editor: open a mod and edit its tables,
strings, animation scripts and AI scripts beside the map, with the map drawn from the mod's files as you change them.

## What it does

**File ▸ Open a Mod…** opens a panel under the map. Drop the mod on it, or choose its folder or file: a folder of the
game's files (at its root or one folder down, as `mpq/` in a mod's release), an `.mpq`, a mod's self-executing `.exe`
(MPQDraft's or FireGraft's — the archive inside is read, nothing is run), a `.zip` of any of these, or a folder that
`scmjs mod unpack` wrote. An `.mpq`, `.exe` or `.zip` dropped on the editor itself opens here too. The panel says in
one line what it found.

- **Tables** — a grid a table (units, weapons, flingy, sprites, images, upgrades, technologies, orders, sounds,
  portraits, campaign maps), every field under its PyMS name, the entry's name beside its id. Search by name or id.
  A table wider than the game's shows its named entries until *Unnamed too* is ticked. The side shows the chosen
  entry's fields with what each points at, and what points at the entry (the units that carry a weapon, the images
  that draw the same GRP). Double-click a value to change it; it is checked against the field (a whole number in the
  field's width; hit points in whole points, supply in units, flags in hex) before it is stored.
- **Strings** — the mod's string tables (and the game's names, when the mod has none of its own), a line an entry as
  PyTBL writes them: `<0>` between a name's parts, `<NN>` for a control character. Double-click to change.
- **Pictures** — every GRP the mod has, and the game's, with the images that draw each. The chosen one is drawn frame
  by frame, as a sheet, or animated by an image's script, in a tileset's palette (jungle unless you choose another)
  with a team colour from `tunit.pcx`. **Import PNG…** takes a sheet (every frame) or a picture one frame in size (the
  frame shown), and lists the colours that are not in the palette, with what each becomes, before it is used.
  **Export PNG** writes the sheet, which imports back unchanged.
- **Sounds** — the sound table's rows with the files they play. Play a file; replace it with a dropped or chosen sound
  (a WAV, or anything the browser plays), converted to the game's 22050 Hz, 16-bit, mono unless it is one already; or
  record one from the microphone.
- **Overlays** — each `.lo?` file as PyLO text in the code editor, assembled as you type, an error on its line.
- **The animation preview** (Pictures ▸ Animation, and beside the Scripts tab, following the script at the cursor)
  plays an image's animation from the mod's iscript as it is now: frames, waits, jumps, calls, position and facing.
  Sounds, attacks and orders are skipped, overlays are not drawn, jumps that read the game's state take the "no" way,
  and it stops at anything else, saying which — a running game (Play) shows the rest.
- **Scripts** — each animation script as PyICE text and the AI scripts as PyAI text, in the code editor TrigScript
  uses: coloured, with completion of the commands and of image, sprite, sound, weapon and unit ids by name, and go to
  a label. Every change is assembled a moment later; an error is marked on its line, and the script keeps its last
  text that assembled until it assembles again.

**The map follows the mod.** While a mod is open the editor draws from it: the unit palette shows its units and names,
the settings dialogs its defaults, the map its pictures. Change a unit's hit points and Unit Settings shows the new
default. The status line says what the editor draws from and the mod's hash (the one a map saved now records).

**Save** writes the mod in the form it came: an MPQ for an `.mpq`, `.exe` or `.zip`; the folder of text for a folder
`scmjs mod unpack` wrote (as a zip); for a folder of loose files, the files you changed in their folders (as a zip, to
copy over it). **Save as Folder** writes the folder of text and pictures `scmjs mod unpack` lays out, as a zip, each
text kept only where it packs back to the same bytes. **Export as MPQ** writes the MPQ the launchers load. A file
nobody changed is written byte for byte as it came.

**Diff…** reads what changed as a changelog — against the game, or against the mod as it was opened ("Terran Marine:
hit points 40 → 50"). **Check…** looks across the tables for what would break in the game (a reference past its
table, an image with no picture, a script no image uses …); click a finding to go to it.

**Play** hands the mod's files that differ from the game's, with the open map, to the play page at `/play/` beside the
editor (on scmjs.dev), in a tab of its own. A development server of the editor alone has no play page, and the panel
says so.

## Developing

```sh
npm install
npm run build        # dist/plugin.js
npm test             # vitest; SCMJS_COSMONARCHY=<a release folder holding mpq/> adds a large mod's test
npm run typecheck
```

Serve this folder over HTTP on another origin than the editor (any static server that sends CORS headers)
and add its address in Plugins ▸ Manage Plugins (or open the editor with `?plugin-dev=http://127.0.0.1:<port>/`).
The code editor is TrigScript's Monaco build, fetched from jsDelivr at a tag of that repository; for work without the
network, serve TrigScript's `dist/` and set the plugin's storage key `monacoDist` to its address
(`localStorage["scmjs.plugin.mods.monacoDist"] = JSON.stringify("http://127.0.0.1:<port>/monaco")`).

## Before publishing

The codecs and the mod folder form come from `@scm-js/core`, which has them on scm-js's `mods` branch and not yet in
a published version. Until then `package.json` takes it as `file:../scm-js-mods/core` (a checkout of that branch
beside this one), and `build.mjs`, `tsconfig.json` (`paths`, plus `core-env.d.ts` for the Vite-only `import.meta`
of a few of the editor's modules) and `vitest.config.ts` read its sources. When the version with the mod formats is
published:

1. `npm install @scm-js/core@<that version>` (replacing the `file:` dependency).
2. Delete the `alias` in `build.mjs` (it is skipped already once `node_modules/@scm-js/core/dist/` exists), the
   `paths` entry in `tsconfig.json`, `core-env.d.ts`, and the alias in `vitest.config.ts`.
3. When `@scm-js/plugin-api` declares `gameData.attach` and `gameData.reload`, drop the `AttachApi` cast in `plugin.ts`.

## License

MIT. The plugin carries nothing of the game's or of any mod's; the tests make their own mod from the codecs, and the
large-mod test reads one from disk only when it is named.
