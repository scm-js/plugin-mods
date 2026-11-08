// `@scm-js/core` is type-checked from its sources here (README: "Before publishing"), and a few of the editor's modules
// behind its exports use Vite's `import.meta`. The plugin's bundle never runs them; these say what they are.
interface ImportMeta {
  readonly env: Record<string, string> & { DEV: boolean; PROD: boolean };
  glob(pattern: string | string[], options?: Record<string, unknown>): Record<string, unknown>;
}
