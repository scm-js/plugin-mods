# Mod Editor

A plugin for the [scmJS](https://github.com/scm-js/scm-js) StarCraft map editor: open a mod and edit its tables,
strings, animation scripts and AI scripts beside the map, with the map drawn from the mod's files as you change them.

## Installing

In scmJS, open **Plugins ▸ Browse Plugins…** and press **Install** on the Mod Editor row. You can also open
**Plugins ▸ Manage Plugins…**, paste `github:scm-js/plugin-mods` and press **Add**.

It needs scmJS 0.13.0 or newer. An older editor opens mods and edits them, but cannot draw the map from them.

## What it does

**File ▸ Open a Mod…** opens a panel under the map. Drop the mod on it, or choose its folder or file: a folder of the
game's files (at its root or one folder down, as `mpq/` in a mod's release), an `.mpq`, a mod's self-executing `.exe`
(MPQDraft's or FireGraft's — the archive inside is read, nothing is run), a `.zip` of any of these, or a folder that
`scmjs mod unpack` wrote. An `.mpq`, `.exe` or `.zip` dropped on the editor itself opens here too. The panel says in
one line what it found.

A copy of the game in what you open is not the mod. In a folder that holds `StarDat.mpq`, the game's own archives
(`StarDat.mpq`, `BrooDat.mpq`, `patch_rt.mpq`, `StarCraft.mpq`, `BroodWar.mpq`) and everything under its `Maps` folder
are left out unread, and the panel says which archives. A `patch_rt.mpq` opened on its own, as some old mods ship, is
still a mod.

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
- **Requirements and Buttons** — the mod's `datreq\*.graft` files (GPTP's grafting, which Firegraft's `.fgp` became)
  as forms. A unit's button set is a row a button: its place on the card (1–9), its icon, the condition that shows it
  and the action it does, each by name from the game's 67 conditions and 60 actions with what their parameter names
  (a unit, an upgrade, a technology, a button set), and the tips shown when it is lit and when it is greyed, as the
  strings in `stat_txt.tbl` they are. A requirement list is lines in words — `current unit is Terran Barracks (111)`,
  `owns Terran Academy (112)`, `is not lifted off`, `or` — read back as you change them. A mod without grafts takes the
  game's own from a running test game (they are read out of its memory) and edits those.
- **Races** — the races the mod gives players past the game's own. A player's race is a number: 0 to 7 are the game's
  (Zerg, Terran, Protoss, and five the game uses for itself), and a mod may use others, but none of its files says
  what they are called. Name them here: a row a race, with its number (8 to 255), its name, the letter its own files
  go by (`a` for `game\aconsole.pcx` and `rez\statbtna.bin`; empty when it has none) and the game's race it plays as,
  if you know it. The editor then shows the name wherever a player's race is shown, instead of `Race 69`. A row is
  checked as you type: a number the game uses or another row has, an empty name or one over 40 characters, and the
  game's own letters (z, t, p, n) are refused.

  The number is not in any of the mod's files. Open a replay or a map made with the mod: a player whose race has no
  name shows as `Race` and the number. The names the mod's `rez\network.tbl` has past the game's own, and the letters
  it has a console picture or status buttons for, are offered as buttons for the row you are typing; they are
  guesses, and nothing is filled in until you click one.

  The names are not part of the mod's files, so naming a race leaves its hash as it was. The editor keeps them for
  the mod (a new release of it too), and saving the mod as a folder writes them into its `mod.json` as `races`:

  ```json
  "races": [{ "id": 69, "name": "Askosi", "letter": "a", "like": 1 }]
  ```

  (`like` is 0 Zerg, 1 Terran, 2 Protoss.) A folder opened with a `mod.json` that has `races` hands them to the
  editor, and Play and Start Test Game hand them to the play page with the mod, so its setup screen offers them. A
  mod that names none writes `mod.json` as before. An editor from before race names shows the table but
  cannot keep it; the races a `mod.json` has are still written back when the mod is saved as a folder.

**The map follows the mod.** While a mod is open the editor draws from it: the unit palette shows its units and names,
the settings dialogs its defaults, the map its pictures. Change a unit's hit points and Unit Settings shows the new
default. The status line says what the editor draws from and the mod's hash (the one a map saved now records). Files an
operating system leaves in folders (`desktop.ini`, `Thumbs.db`, `.DS_Store` and the like) are not the mod's: they are
left out of its files, its counts and its hash, so a mod has the same hash whether its folder was picked, dropped or
read by `scmjs`.

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

While a mod is open and the editor draws from it, the scm-sim plugin (0.19.0 or later) is told where its files are,
under the mod's hash. A replay of the mod opened in the Aftermath plugin's Game view, Play From Here, Test in Browser
and a replay's analysis then play with the mod even where the play page has not got it yet: the page is handed the
mod's files (every file it provides, its plugins and its FireGraft project) and keeps them, once. Nothing is read
until a page says it has not got the mod. Another hash after an edit is registered in its place; closing the mod
takes it away.

**Start Test Game** takes Play's place when the scm-sim plugin is installed (its `scm-sim.live` service): the open map —
or a blank one — is played with the mod in the play page's tab, and while that game runs alone **every edit goes into
it**. A table's field is written into the running game between two turns (the marine's hit points, a weapon's damage:
the next hit takes it); an imported picture is drawn at once; a moved button moves on the card. The animation scripts,
the sound table and the strings are read by the game once, so those are kept and take effect at the next start (the
play page's Restart). The status line says which: "applied in the running game", "takes effect at the next start", or
the page's reason for refusing — a game between people refuses every edit, since a change on one page only would
make it another game on the others.

## Developing

```sh
npm install
npm run build        # dist/plugin.js
npm test             # vitest; SCMJS_COSMONARCHY=<a release folder holding mpq/> adds a large mod's test,
                     # SCMJS_COSMONARCHY_ROOT=<a folder holding Release/ beside a copy of the game> another
npm run typecheck
```

Serve this folder over HTTP on another origin than the editor (any static server that sends CORS headers)
and add its address in Plugins ▸ Manage Plugins (or open the editor with `?plugin-dev=http://127.0.0.1:<port>/`).
The code editor is TrigScript's Monaco build, fetched from jsDelivr at a tag of that repository; for work without the
network, serve TrigScript's `dist/` and set the plugin's storage key `monacoDist` to its address
(`localStorage["scmjs.plugin.mods.monacoDist"] = JSON.stringify("http://127.0.0.1:<port>/monaco")`).

## License

MIT. The plugin carries nothing of the game's or of any mod's; the tests make their own mod from the codecs, and the
large-mod test reads one from disk only when it is named.
