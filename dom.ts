/**
 * A small element builder and the Mod Editor's stylesheet. The panel is plain DOM; the styles are scoped under `.mx`
 * and lean on the editor's design tokens, with fallbacks.
 */

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** A button in the panel's look. */
export function button(label: string, onClick: () => void, opts: { title?: string; primary?: boolean; className?: string } = {}): HTMLButtonElement {
  return h("button", { className: `mx-btn${opts.primary ? " primary" : ""}${opts.className ? ` ${opts.className}` : ""}`, title: opts.title, type: "button", onclick: onClick }, label);
}

let styled = false;
/** Puts the stylesheet in the page once. */
export function ensureStyle() {
  if (styled) return;
  styled = true;
  document.head.append(h("style", { "data-plugin": "mods" }, STYLE));
}

const STYLE = `
.mx { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 12px; color: var(--text, #dde2ea); }
.mx * { box-sizing: border-box; }
.mx button, .mx input, .mx select { font: inherit; }
.mx input, .mx select { color: inherit; background: var(--bg-0, #0a0c10); border: 1px solid var(--border, #2c3341); border-radius: 3px; padding: 1px 5px; min-height: 22px; }
.mx input:focus, .mx select:focus { outline: none; box-shadow: var(--focus, 0 0 0 1px #4fd1c5); }
.mx input.bad { box-shadow: 0 0 0 1px var(--danger, #d9534f); }
.mx .mx-dim { color: var(--text-dim, #99a2b3); }
.mx .mx-faint { color: var(--text-faint, #5d6675); }
.mx .mx-warn { color: var(--warn, #e0a545); }
.mx .mx-danger { color: var(--danger, #d9534f); }
.mx .mx-ok { color: var(--ok, #5cb85c); }
.mx .mx-mono { font-family: var(--font-mono, ui-monospace, Consolas, Menlo, monospace); }
.mx .mx-btn { padding: 1px 8px; min-height: 22px; border: 1px solid var(--border, #2c3341); border-radius: 3px; background: var(--bg-3, #222732); color: var(--text, #dde2ea); cursor: pointer; white-space: nowrap; }
.mx .mx-btn:hover { background: var(--bg-4, #2b313e); }
.mx .mx-btn:disabled { opacity: .45; cursor: default; }
.mx .mx-btn.primary { background: var(--teal-dim, #2c8a83); border-color: var(--teal, #4fd1c5); color: #fff; }
.mx .mx-link { color: var(--teal, #4fd1c5); cursor: pointer; text-decoration: none; }
.mx .mx-link:hover { text-decoration: underline; }
.mx .mx-bar { display: flex; align-items: center; gap: 6px; flex: none; flex-wrap: wrap; padding: 3px 4px; }
.mx .mx-bar .mx-grow { flex: 1; min-width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mx .mx-sep { width: 1px; height: 18px; background: var(--border, #2c3341); }
.mx .mx-tabs { display: flex; gap: 2px; flex: none; border-bottom: 1px solid var(--border, #2c3341); padding: 0 4px; }
.mx .mx-tab { padding: 3px 12px; border: 1px solid transparent; border-bottom: none; border-radius: 4px 4px 0 0; background: none; color: var(--text-dim, #99a2b3); cursor: pointer; }
.mx .mx-tab.on { background: var(--bg-2, #191d25); border-color: var(--border, #2c3341); color: var(--text, #dde2ea); }
.mx .mx-body { flex: 1; min-height: 0; display: flex; }
.mx .mx-status { flex: none; padding: 2px 6px; border-top: 1px solid var(--border, #2c3341); color: var(--text-dim, #99a2b3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mx .mx-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 2px dashed var(--border, #2c3341); border-radius: 6px; margin: 8px; color: var(--text-dim, #99a2b3); text-align: center; padding: 12px; }
.mx .mx-empty.over { border-color: var(--teal, #4fd1c5); color: var(--text, #dde2ea); }

/* tables */
.mx .mx-split { flex: 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; }
.mx .mx-col { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.mx .mx-grid { flex: 1; min-height: 0; overflow: auto; position: relative; border-top: 1px solid var(--border, #2c3341); }
.mx .mx-grid .mx-row { display: grid; height: 22px; align-items: center; border-bottom: 1px solid rgba(255,255,255,.04); cursor: default; }
.mx .mx-grid .mx-row.head { position: sticky; top: 0; z-index: 2; background: var(--bg-2, #191d25); color: var(--gold, #e6b95c); font-weight: 600; }
.mx .mx-grid .mx-row:not(.head):hover { background: var(--bg-3, #222732); }
.mx .mx-grid .mx-row.on { background: var(--sel, #2b4f80); }
.mx .mx-grid .mx-cell { padding: 0 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; height: 100%; line-height: 22px; border-right: 1px solid rgba(255,255,255,.04); font-variant-numeric: tabular-nums; }
.mx .mx-grid .mx-cell.num { text-align: right; }
.mx .mx-grid .mx-cell.edited { color: var(--gold-hi, #f4d08a); }
.mx .mx-grid .mx-cell.none { color: var(--text-faint, #5d6675); }
.mx .mx-grid .mx-cell.stick { position: sticky; z-index: 1; background: var(--bg-1, #12151b); }
.mx .mx-grid .mx-row.head .mx-cell.stick { background: var(--bg-2, #191d25); }
.mx .mx-grid .mx-row.on .mx-cell.stick { background: var(--sel, #2b4f80); }
.mx .mx-grid .mx-cell input { width: 100%; min-height: 20px; height: 20px; padding: 0 3px; }
.mx .mx-side { border-left: 1px solid var(--border, #2c3341); overflow: auto; padding: 4px 6px; min-height: 0; }
.mx .mx-side h4 { margin: 4px 0; font-size: 12px; color: var(--gold, #e6b95c); }
.mx .mx-kv { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; align-items: baseline; }
.mx .mx-kv .k { color: var(--text-dim, #99a2b3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mx .mx-kv .v { text-align: right; font-variant-numeric: tabular-nums; cursor: text; }
.mx .mx-kv .v.edited { color: var(--gold-hi, #f4d08a); }
.mx .mx-kv .r { grid-column: 1 / -1; font-size: 11px; margin: -1px 0 2px 10px; }
.mx .mx-uses { margin: 0; padding: 0; list-style: none; }
.mx .mx-uses li { padding: 1px 0; }

/* strings */
.mx .mx-strings .mx-row { grid-template-columns: 60px minmax(0, 1fr) 90px; }

/* scripts */
.mx .mx-scripts { flex: 1; min-height: 0; display: grid; grid-template-columns: 210px minmax(0, 1fr); }
.mx .mx-list { overflow: auto; border-right: 1px solid var(--border, #2c3341); }
.mx .mx-list .item { padding: 3px 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mx .mx-list .item:hover { background: var(--bg-3, #222732); }
.mx .mx-list .item.on { background: var(--sel, #2b4f80); }
.mx .mx-list .item .tag { font-size: 10px; margin-left: 4px; color: var(--text-faint, #5d6675); }
.mx .mx-list .item .err { color: var(--danger, #d9534f); margin-left: 4px; }
.mx .mx-editor { flex: 1; min-height: 0; }
.mx .mx-say { flex: none; padding: 2px 6px; border-top: 1px solid var(--border, #2c3341); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* dialogs */
.mx-dlg { display: flex; flex-direction: column; gap: 6px; min-height: 0; height: 100%; font-size: 12px; }
.mx-dlg .mx-lines { flex: 1; min-height: 200px; overflow: auto; margin: 0; padding: 6px; border: 1px solid var(--border, #2c3341); border-radius: 4px; background: var(--bg-0, #0a0c10); font-family: var(--font-mono, ui-monospace, monospace); white-space: pre-wrap; }
.mx-dlg .mx-finding { display: grid; grid-template-columns: 16px 110px minmax(0, 1fr); gap: 6px; padding: 3px 4px; border-bottom: 1px solid rgba(255,255,255,.05); cursor: pointer; }
.mx-dlg .mx-finding:hover { background: var(--bg-3, #222732); }
.mx-dlg .mx-finding .lvl.error { color: var(--danger, #d9534f); }
.mx-dlg .mx-finding .lvl.warning { color: var(--warn, #e0a545); }
.mx-dlg .mx-finding .where { color: var(--text, #dde2ea); }
.mx-dlg .mx-finding .why { color: var(--text-dim, #99a2b3); }
`;
