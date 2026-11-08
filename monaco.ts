/**
 * Monaco, borrowed from TrigScript: the same self-built bundle (the editor and its workers) that plugin serves from a
 * tag of its repository through jsDelivr, imported here under its own URL (`?instance=mods`) so it is a module instance
 * of its own — TrigScript's TypeScript language service and this plugin's two languages never see each other's models.
 * The cost is a second download of the same bundle, only when both are in use. The theme is TrigScript's, rule for
 * rule: Monaco writes token colours into global `.mtkN` classes, so two instances with different themes would repaint
 * each other. `MonacoEnvironment` is global; both point it at the same worker files.
 *
 * The URL is not a static import on purpose: the editor's plugin loader follows every literal import specifier. A
 * dynamic `import()` of a variable passes through to the browser untouched.
 */
import type * as Monaco from "monaco-editor";

export const DIST_TAG = "monaco-0.56.0-2";
export const DEFAULT_DIST = `https://cdn.jsdelivr.net/gh/scm-js/plugin-trigscript@${DIST_TAG}/dist`;
/** The plugin storage key that overrides where the bundle is fetched from (development: a local server). */
export const DIST_STORAGE_KEY = "monacoDist";

export type MonacoApi = typeof Monaco;

export const THEME = "scm";

let loading: Promise<MonacoApi> | null = null;

function moduleWorker(url: string): Worker {
  const blob = new Blob([`import ${JSON.stringify(url)};\n`], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob), { type: "module" });
}

function configure(monaco: MonacoApi) {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5d6675", fontStyle: "italic" },
      { token: "keyword", foreground: "e6b95c" },
      { token: "string", foreground: "4fd1c5" },
      { token: "number", foreground: "f4d08a" },
      { token: "type.identifier", foreground: "8fd3ff" },
      { token: "identifier", foreground: "dde2ea" },
      { token: "delimiter", foreground: "99a2b3" },
      { token: "operator", foreground: "99a2b3" },
    ],
    colors: {
      "editor.background": "#0a0c10",
      "editor.foreground": "#dde2ea",
      "editor.lineHighlightBackground": "#12151b",
      "editor.lineHighlightBorder": "#12151b",
      "editorLineNumber.foreground": "#5d6675",
      "editorLineNumber.activeForeground": "#99a2b3",
      "editor.selectionBackground": "#2b4f80",
      "editor.inactiveSelectionBackground": "#222732",
      "editorCursor.foreground": "#e6b95c",
      "editorIndentGuide.background1": "#222732",
      "editorIndentGuide.activeBackground1": "#353c4b",
      "editorWidget.background": "#191d25",
      "editorWidget.border": "#2c3341",
      "editorSuggestWidget.background": "#191d25",
      "editorSuggestWidget.border": "#2c3341",
      "editorSuggestWidget.selectedBackground": "#2b4f80",
      "editorHoverWidget.background": "#191d25",
      "editorHoverWidget.border": "#2c3341",
      "editorError.foreground": "#d9534f",
      "editorWarning.foreground": "#e0a545",
      "scrollbarSlider.background": "#353c4b80",
      "scrollbarSlider.hoverBackground": "#3b4453a0",
      "editorGutter.background": "#0a0c10",
      "minimap.background": "#0a0c10",
      // The command palette, Go to Line and the context menu are Monaco's own widgets; the workspace around them is tokens.css.
      "focusBorder": "#3a68a8",
      "widget.shadow": "#000000a0",
      "input.background": "#0a0c10",
      "input.foreground": "#dde2ea",
      "input.border": "#2c3341",
      "quickInput.background": "#191d25",
      "quickInput.foreground": "#dde2ea",
      "quickInputList.focusBackground": "#2b4f80",
      "quickInputList.focusForeground": "#dde2ea",
      "list.hoverBackground": "#222732",
      "list.highlightForeground": "#e6b95c",
      "list.focusHighlightForeground": "#f4d08a",
      "pickerGroup.border": "#2c3341",
      "pickerGroup.foreground": "#99a2b3",
      "keybindingLabel.background": "#222732",
      "keybindingLabel.foreground": "#dde2ea",
      "keybindingLabel.border": "#3b4453",
      "keybindingLabel.bottomBorder": "#3b4453",
      "menu.background": "#191d25",
      "menu.foreground": "#dde2ea",
      "menu.selectionBackground": "#2b4f80",
      "menu.selectionForeground": "#dde2ea",
      "menu.separatorBackground": "#2c3341",
      "menu.border": "#3b4453",
    },
  });
}

/** Monaco, loaded once from `base`; a failed load can be retried. */
export function loadMonaco(base: string = DEFAULT_DIST): Promise<MonacoApi> {
  loading ??= (async () => {
    const dist = base.replace(/\/+$/, "");
    const env = globalThis as { MonacoEnvironment?: unknown };
    // Global, and TrigScript sets it too; both point at the same two worker files.
    env.MonacoEnvironment ??= {
      getWorker: (_id: string, label: string) => moduleWorker(`${dist}/${label === "typescript" || label === "javascript" ? "ts.worker.js" : "editor.worker.js"}`),
    };
    const monaco = (await import(/* @vite-ignore */ `${dist}/monaco.js?instance=mods`)) as MonacoApi;
    configure(monaco);
    return monaco;
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}
