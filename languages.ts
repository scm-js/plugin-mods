/**
 * The two script dialects in Monaco: PyICE's iscript text (`pyice`) and PyAI's AI script text (`pyai`), as
 * `@scm-js/core` writes and reads them. Colouring (Monarch, with TrigScript's token names so the shared theme colours
 * them), completion of the commands with their arguments and of image, sprite, sound, weapon and unit ids by name,
 * and go to a label's definition. Registered once per Monaco; the names come from the open mod through `ScriptNames`.
 */
import { AI_OPCODES, ISCRIPT_ANIMS, ISCRIPT_OPCODES, type AiArgKind, type IscriptArgKind } from "@scm-js/core";
import type * as Monaco from "monaco-editor";
import type { MonacoApi } from "./monaco";

export const PYICE = "pyice";
export const PYAI = "pyai";

/** An id with what it is called, for completion. */
export interface Named { id: number; label: string }

/** What the open mod calls things; read when a completion list is asked for. */
export interface ScriptNames {
  images(): Named[];
  sprites(): Named[];
  sounds(): Named[];
  weapons(): Named[];
  /** Units, upgrades and technologies as the AI text writes them (by name where the name is unique). */
  aiUnits(): string[];
  aiUpgrades(): string[];
  aiTechnologies(): string[];
}

/** What an iscript command's argument is, where it is an id worth naming. */
type IdKind = "image" | "sprite" | "sound" | "weapon" | "label";

const ISCRIPT_IDS: Record<string, (IdKind | null)[]> = {
  imgol: ["image"], imgul: ["image"], imgolorig: ["image"], switchul: ["image"], imgoluselo: ["image"], imguluselo: ["image"],
  sprol: ["sprite"], highsprol: ["sprite"], lowsprul: ["sprite"], spruluselo: ["sprite"], sprul: ["sprite"], sproluselo: ["sprite"], grdsprol: ["sprite"],
  playsnd: ["sound"], playsndbtwn: ["sound", "sound"], playsndrand: [null, "sound", "sound", "sound", "sound", "sound", "sound", "sound", "sound"],
  useweapon: ["weapon"], goto: ["label"], call: ["label"], randcondjmp: [null, "label"], pwrupcondjmp: ["label"], trgtrangecondjmp: [null, "label"],
  trgtarccondjmp: [null, null, "label"], curdirectcondjmp: [null, null, "label"], liftoffcondjmp: ["label"],
};

const ARG_WORDS: Record<IscriptArgKind, string> = { b: "byte", s: "signed", w: "word", f: "frame", L: "label", N: "count …" };

function iscriptArgName(name: string, kind: IscriptArgKind, i: number): string {
  const id = ISCRIPT_IDS[name]?.[i];
  if (id && id !== "label") return id;
  if (/^(imgol|imgul|sprol|highsprol|lowsprul|sprul|grdsprol|imgoluselo|imguluselo|spruluselo)$/.test(name)) return ["id", "x", "y"][i] ?? ARG_WORDS[kind];
  if (name === "setpos") return ["x", "y"][i];
  return ARG_WORDS[kind];
}

const AI_SCRIPT_KEYS = ["name_string", "bin_file", "broodwar_only", "staredit_hidden", "requires_location", "entry_point"];

/** The Monarch grammar of PyICE text. */
export function iscriptGrammar(): Monaco.languages.IMonarchLanguage {
  return {
    defaultToken: "",
    opcodes: ISCRIPT_OPCODES.map((o) => o.name),
    headerKeys: ["IsId", "Type", ...ISCRIPT_ANIMS],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/^\s*\.(headerstart|headerend)\b/, "keyword"],
        [/^[A-Za-z_][\w]*(?=:)/, "type.identifier"],
        [/[:]/, "delimiter"],
        [/\[NONE\]/, "string"],
        [/0x[0-9a-fA-F]+\b/, "number"],
        [/-?\d+\b/, "number"],
        [/[A-Za-z_][\w]*/, { cases: { "@opcodes": "keyword", "@headerKeys": "keyword", "@default": "identifier" } }],
      ],
    },
  } as Monaco.languages.IMonarchLanguage;
}

/** The Monarch grammar of PyAI text. */
export function aiGrammar(): Monaco.languages.IMonarchLanguage {
  return {
    defaultToken: "",
    commands: AI_OPCODES.map((o) => o.name),
    scriptKeys: ["script", ...AI_SCRIPT_KEYS],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/--[^-\s]+--/, "type.identifier"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/0x[0-9a-fA-F]+\b/, "number"],
        [/-?\d+\b/, "number"],
        [/[{}(),]/, "delimiter"],
        [/[A-Za-z_][\w]*/, { cases: { "@commands": "keyword", "@scriptKeys": "keyword", "@default": "identifier" } }],
      ],
    },
  } as Monaco.languages.IMonarchLanguage;
}

/** Labels a model defines: `Name:` at a line's start (PyICE), `--name--` on a line of its own (PyAI). */
export function labelsOf(text: string, language: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  const re = language === PYICE ? /^([A-Za-z_][\w]*):\s*(#.*)?$/ : /^\s*--([^-\s]+)--\s*$/;
  text.split("\n").forEach((l, i) => { const m = re.exec(l); if (m) out.push({ name: m[1], line: i + 1 }); });
  return out;
}

/**
 * Where the cursor is in an iscript line: typing the command (`arg` -1) or its argument `arg` (0-based).
 * Null in a comment or a header line.
 */
export function iscriptPlace(line: string): { command: string; arg: number } | null {
  const code = line.split("#")[0];
  if (/^\S/.test(code) && !/^\s/.test(code)) return null; // a label or a directive
  const words = code.trim().split(/\s+/).filter(Boolean);
  const typing = /\S$/.test(code);
  if (!words.length || (words.length === 1 && typing)) return { command: words[0] ?? "", arg: -1 };
  return { command: words[0], arg: words.length - 1 - (typing ? 1 : 0) };
}

/** Where the cursor is in an AI line: in `cmd(a, b|`, the command and argument 1. Null outside a call. */
export function aiPlace(line: string): { command: string; arg: number } | null {
  const code = line.split("#")[0];
  const open = code.lastIndexOf("(");
  if (open < 0 || code.indexOf(")", open) >= 0) return /^\s*[A-Za-z_]*$/.test(code) ? { command: code.trim(), arg: -1 } : null;
  const command = code.slice(0, open).trim();
  const arg = (code.slice(open + 1).match(/,/g) ?? []).length;
  return { command, arg };
}

let registered: WeakSet<object> | null = null;

/** Puts both languages in a Monaco, once. */
export function registerLanguages(monaco: MonacoApi, names: () => ScriptNames | null) {
  registered ??= new WeakSet();
  if (registered.has(monaco)) return;
  registered.add(monaco);
  const L = monaco.languages;
  L.register({ id: PYICE, extensions: [".iscript"], aliases: ["PyICE iscript"] });
  L.register({ id: PYAI, extensions: [".pyai"], aliases: ["PyAI script"] });
  L.setMonarchTokensProvider(PYICE, iscriptGrammar());
  L.setMonarchTokensProvider(PYAI, aiGrammar());
  L.setLanguageConfiguration(PYICE, { comments: { lineComment: "#" } });
  L.setLanguageConfiguration(PYAI, { comments: { lineComment: "#" }, brackets: [["(", ")"], ["{", "}"]], autoClosingPairs: [{ open: "(", close: ")" }, { open: "{", close: "}" }, { open: "\"", close: "\"" }] });
  const K = L.CompletionItemKind;

  const ids = (list: Named[], range: Monaco.IRange, kind: Monaco.languages.CompletionItemKind): Monaco.languages.CompletionItem[] =>
    list.map((n) => ({ label: { label: String(n.id), description: n.label }, kind, insertText: String(n.id), filterText: `${n.id} ${n.label}`, sortText: String(n.id).padStart(6, "0"), range }));

  L.registerCompletionItemProvider(PYICE, {
    triggerCharacters: [" ", "\t"],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      if (/^\s*$/.test(line) || /^[A-Z][A-Za-z0-9]*$/.test(line)) {
        // A header's keys inside .headerstart … .headerend.
        const before = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: 1 });
        if (before.lastIndexOf(".headerstart") > before.lastIndexOf(".headerend")) {
          return { suggestions: ["IsId", "Type", ...ISCRIPT_ANIMS].map((k) => ({ label: k, kind: K.Property, insertText: `${k.padEnd(17)}\t`, range })) };
        }
      }
      const place = iscriptPlace(line);
      if (!place) return { suggestions: [] };
      if (place.arg < 0) {
        return {
          suggestions: ISCRIPT_OPCODES.filter((o) => !o.name.startsWith("__")).map((o) => ({
            label: { label: o.name, description: o.args.map((a, i) => iscriptArgName(o.name, a, i)).join(" ") },
            kind: K.Keyword,
            insertText: o.args.length ? `${o.name.padEnd(17)}\t${o.args.map((a, i) => `\${${i + 1}:${iscriptArgName(o.name, a, i)}}`).join(" ")}` : o.name,
            insertTextRules: L.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      }
      const kind = ISCRIPT_IDS[place.command]?.[place.arg];
      const n = names();
      if (kind === "label") return { suggestions: labelsOf(model.getValue(), PYICE).map((l) => ({ label: l.name, kind: K.Reference, insertText: l.name, range })) };
      if (!n || !kind) return { suggestions: [] };
      const list = kind === "image" ? n.images() : kind === "sprite" ? n.sprites() : kind === "sound" ? n.sounds() : n.weapons();
      return { suggestions: ids(list, range, K.Value) };
    },
  });

  const aiArgList = (kind: AiArgKind | undefined, n: ScriptNames | null): string[] => {
    if (!n || !kind) return [];
    if (kind === "unit" || kind === "unit_id" || kind === "unit_group") return n.aiUnits();
    if (kind === "upgrade") return n.aiUpgrades();
    if (kind === "technology") return n.aiTechnologies();
    return [];
  };

  L.registerCompletionItemProvider(PYAI, {
    triggerCharacters: ["(", ",", " "],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const place = aiPlace(line);
      if (!place) return { suggestions: [] };
      // A name may hold spaces: replace back to the last "(" or ",".
      const from = Math.max(line.lastIndexOf("("), line.lastIndexOf(",")) + 1;
      const lead = line.slice(from).match(/^\s*/)![0].length;
      const word = model.getWordUntilPosition(position);
      const range = place.arg < 0
        ? { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
        : { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: from + lead + 1, endColumn: position.column };
      if (place.arg < 0) {
        return {
          suggestions: AI_OPCODES.filter((o) => !o.inferred).map((o) => ({
            label: { label: o.name, description: `(${o.args.join(", ")})${o.aise ? " aise" : ""}` },
            kind: K.Function,
            insertText: `${o.name}(${o.args.map((a, i) => `\${${i + 1}:${a}}`).join(", ")})`,
            insertTextRules: L.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      }
      const op = AI_OPCODES.find((o) => o.name === place.command);
      const kind = op?.args[place.arg];
      if (kind === "block" || kind === "long_block") return { suggestions: labelsOf(model.getValue(), PYAI).map((l) => ({ label: l.name, kind: K.Reference, insertText: l.name, range })) };
      return { suggestions: aiArgList(kind, names()).filter(Boolean).map((name) => ({ label: name, kind: K.Value, insertText: name, range })) };
    },
  });

  for (const language of [PYICE, PYAI]) {
    L.registerDefinitionProvider(language, {
      provideDefinition(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const found = labelsOf(model.getValue(), language).find((l) => l.name === word.word);
        return found ? { uri: model.uri, range: { startLineNumber: found.line, startColumn: 1, endLineNumber: found.line, endColumn: 1 } } : null;
      },
    });
  }
}
