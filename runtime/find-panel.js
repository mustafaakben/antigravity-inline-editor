// Find and replace panel for Edits. It mirrors Antigravity's native Raw find bar (same classes
// and icons) and drives CodeMirror's search state, so match highlighting and commands stay native.
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll,
  openSearchPanel, closeSearchPanel, searchPanelOpen,
} from "@codemirror/search";

const MAX_COUNT = 1000;
// Material Symbols paths, copied from the native find bar.
const ICONS = {
  case: "M146.77-262.77L304.46-687.38h61.31L524.61-262.77H464.38L424.23-377.85H246.62L206.23-262.77H146.77ZM265-428H405.62l-69-195.46h-3.23L265-428ZM655.38-253.15q-48.69,0-77.73-26.54t-29.04-68.46q0-43.23 33.92-70.38t87.150-27.150q22.23,0 44.23,4.19t38.38,11.58v-17.77q0-34-20.12-53.15T676.15-520q-21.85,0-40.27,8.35t-34.35,24.81l-36.23-28.85q23.23-24.77 50.46-36.46t61-11.69q63.23,0 94.15,30.96T801.84-440v177.23H752.31v-38.92h-4q-14.77,24.15-38.58,36.35t-54.35,12.19Zm7.38-43.23q40.39,0 65.27-26.69t24.88-64.85q-14-8-34.46-12.5t-40.23-4.5q-35.85,0-56.54,15.15T601-348.15q0,22.31 17.35,37.04t44.42,14.73Z",
  word: "M60-219V-389h60v110H840V-389h60v170H60ZM388.15-360.38v-37.08h-3.38q-13.38,22.31-35.19,34.19t-50.19,11.88q-45.92,0-72.58-24.35t-26.65-66.04q0-42 31.15-68.31t80.62-26.31q21.85,0 41.54,3.88t34.08,11.88v-17.85q0-32.77-18.690-50.690t-53-17.92q-21,0-39.31,8.04t-33.62,23.88l-33.77-27q20.15-23.54 46.46-35.23t60.46-11.69q58.92,0 89.04,29.12t30.12,85.5v174.08H388.15ZM320.62-497.46q-33.92,0-52.85,14.62t-18.92,40.69q0,22.69 15.58,36.35t40.73,13.65q35.08,0 58.73-25.58t23.65-63.35q-13.62-8-32-12.19t-34.92-4.19ZM507.54-360V-761h48.92v123.39l-3,40h2.62q7.62-11.92 29.19-28.96t60.04-17.04q58.23,0 92.54,42.54t34.31,104.85q0,61.54-33.81,103.38T644.92-351q-36.38,0-58.46-15.69T556.08-397h-2.62v37H507.54ZM639-598q-39.23,0-62.38,30.27t-23.15,70.89q0,41.23 23.15,71T639-396.08t61.35-29.19t22.12-71.58t-22.12-71.77T639-598Z",
  regex: "M213.54-210.54q-54.08-54.69-84-124.42T99.62-481.62t29.23-147.04t84.69-124.42l43.15,42.77q-47.15,45-72.12,104.27T159.62-482t25.46,124.04t71.62,104.65l-43.15,42.77Zm131.08-54.08Q330-279.23 330-300t14.62-35.38T380-350t35.38,14.62T430-300t-14.62,35.38T380-250t-35.38-14.62ZM529-450v-78.69l-67.54,39.85l-30-52.31L499-580l-67.54-38.85l30-52.31L529-631.31V-710h60v78.69l67.54-39.85l30,52.31L619-580l67.54,38.85l-30,52.31L589-528.69V-450H529ZM746.08-210.54l-43.15-42.77q47.15-45 72.12-104.46T800-482T774.54-605.85T702.92-710.31l43.15-42.77q54.08,54.69 84,124.61T860-481.62T830.58-334.580t-84.5,124.04Z",
  up: "M480-541.85l-184,184L253.85-400L480-626.15L706.15-400L664-357.85l-184-184Z",
  down: "M480-357.85L253.85-584L296-626.15l184,184l184-184L706.15-584L480-357.85Z",
  close: "M480-437.85L277.08-234.92q-8.31,8.31-20.88,8.5t-21.27-8.5T226.23-256t8.69-21.08L437.85-480L234.92-682.92q-8.31-8.31-8.5-20.88t8.5-21.27T256-733.77t21.08,8.69L480-522.15L682.92-725.08q8.31-8.31 20.88-8.5t21.27,8.5T733.77-704t-8.69,21.08L522.15-480L725.08-277.08q8.31,8.31 8.5,20.88t-8.5,21.27T704-226.23t-21.08-8.69L480-437.85Z",
  chevron: "M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z",
};
const ICON_BUTTON = "group outline-none w-6 h-6 flex shrink-0 items-center justify-center rounded-md hover:bg-secondary transition-[background] disabled:pointer-events-none disabled:opacity-30";
const OPTION_BUTTON = "p-0.5 rounded transition-colors outline-none";
const FIELD = "agy-field relative flex items-center bg-muted rounded-md h-7 flex-1 min-w-0 focus-within-ring";
const INPUT = "flex-1 min-w-0 bg-transparent text-foreground !text-xs rounded-l-md truncate !ring-0 !ring-offset-0 border-none px-2 h-full placeholder:text-placeholder outline-none";
const TEXT_BUTTON = "h-7 px-2 shrink-0 rounded-md text-xs text-foreground hover:bg-secondary transition-[background] outline-none disabled:pointer-events-none disabled:opacity-30";

const panels = new WeakMap();
const requested = new WeakMap();

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
function icon(name, size, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ width: size, height: size, viewBox: "0 -960 960 960", fill: "currentColor", class: className, "aria-hidden": "true" }))
    svg.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}
const iconButton = (name, label, size = 16) => el("button", { type: "button", class: ICON_BUTTON, "aria-label": label, title: label },
  [icon(name, size, "outline-none opacity-70 group-hover:opacity-100 transition-opacity")]);
const optionButton = (name, label) => el("button", { type: "button", class: OPTION_BUTTON, "aria-label": label, title: label, "aria-pressed": "false" }, [icon(name, 14)]);

function count(state, query) {
  if (!query.search || !query.valid) return { total: 0, index: -1 };
  const main = state.selection.main, cursor = query.getCursor(state);
  let total = 0, index = -1;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (next.value.from === main.from && next.value.to === main.to) index = total;
    if (++total >= MAX_COUNT) break;
  }
  return { total, index };
}

class FindPanel {
  constructor(view) {
    this.view = view;
    this.showReplace = !!requested.get(view)?.replace;
    this.origin = view.state.selection.main.from;
    const query = getSearchQuery(view.state);

    this.toggle = iconButton("chevron", "Toggle Replace (⌥⌘F)");
    this.toggle.classList.add("agy-find-toggle");
    this.find = el("input", { type: "text", "aria-label": "Find", placeholder: "Find", class: INPUT, "main-field": "true", spellcheck: "false" });
    this.caseButton = optionButton("case", "Match Case (Aa)");
    this.wordButton = optionButton("word", "Match Whole Word (ab)");
    this.regexButton = optionButton("regex", "Use Regular Expression (.*)");
    const options = el("div", { class: "flex items-center gap-0.5 pr-1 ml-1 pl-1" }, [this.caseButton, this.wordButton, this.regexButton]);
    this.findField = el("div", { class: FIELD }, [this.find, options]);
    this.count = el("span", { class: "text-xs text-foreground opacity-70 px-0.5 min-w-[4.5rem] text-center", "aria-live": "polite", "data-testid": "find-bar-match-count" });
    this.prev = iconButton("up", "Previous Match (Shift+Enter)");
    this.next = iconButton("down", "Next Match (Enter)");
    this.close = iconButton("close", "Close (Escape)", 14);
    const findRow = el("div", { class: "flex items-center gap-1 px-1.5 py-1 w-full min-w-0" },
      [this.toggle, this.findField, this.count, el("div", { class: "flex items-center gap-px" }, [this.prev, this.next]), this.close]);

    this.replace = el("input", { type: "text", "aria-label": "Replace", placeholder: "Replace", class: INPUT, spellcheck: "false" });
    this.replaceOne = el("button", { type: "button", class: TEXT_BUTTON, title: "Replace (Enter)" }, ["Replace"]);
    this.replaceEvery = el("button", { type: "button", class: TEXT_BUTTON, title: "Replace All (⌘Enter)" }, ["Replace All"]);
    this.replaceRow = el("div", { class: "flex items-center gap-1 px-1.5 pb-1 w-full min-w-0" },
      [el("span", { class: "w-6 shrink-0" }), el("div", { class: FIELD }, [this.replace]), this.replaceOne, this.replaceEvery]);

    this.dom = el("div", { class: "agy-find", role: "search", "aria-label": "Find and replace" }, [findRow, this.replaceRow]);
    this.dom.addEventListener("keydown", event => this.keydown(event));
    this.find.addEventListener("input", () => this.commit(true));
    this.replace.addEventListener("input", () => this.commit(false));
    for (const [button, key] of [[this.caseButton, "caseSensitive"], [this.wordButton, "wholeWord"], [this.regexButton, "regexp"]])
      button.addEventListener("click", () => { button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true")); this.commit(true); });
    this.toggle.addEventListener("click", () => this.setReplace(!this.showReplace, true));
    this.prev.addEventListener("click", () => findPrevious(view));
    this.next.addEventListener("click", () => findNext(view));
    this.close.addEventListener("click", () => closeSearchPanel(view));
    this.replaceOne.addEventListener("click", () => replaceNext(view));
    this.replaceEvery.addEventListener("click", () => replaceAll(view));
    this.sync(query);
    this.setReplace(this.showReplace, false);
  }
  get top() { return true; }
  mount() { panels.set(this.view, this); requested.get(this.view)?.onToggle?.(true); this.render(); }
  destroy() { panels.delete(this.view); requested.get(this.view)?.onToggle?.(false); }
  // Mirrors a query set elsewhere (for example ⌘F seeding from a selection) into the inputs.
  sync(query) {
    this.query = query;
    if (this.find.value !== query.search) this.find.value = query.search;
    if (this.replace.value !== query.replace) this.replace.value = query.replace;
    this.caseButton.setAttribute("aria-pressed", String(query.caseSensitive));
    this.wordButton.setAttribute("aria-pressed", String(query.wholeWord));
    this.regexButton.setAttribute("aria-pressed", String(query.regexp));
  }
  commit(jump) {
    const query = new SearchQuery({
      search: this.find.value, replace: this.replace.value,
      caseSensitive: this.caseButton.getAttribute("aria-pressed") === "true",
      wholeWord: this.wordButton.getAttribute("aria-pressed") === "true",
      regexp: this.regexButton.getAttribute("aria-pressed") === "true",
    });
    if (query.eq(this.query)) return;
    this.query = query;
    const effects = [setSearchQuery.of(query)];
    // Live search: select the first match at or after where the search started.
    if (jump && query.search && query.valid) {
      const state = this.view.state;
      let match = query.getCursor(state, this.origin).next();
      if (match.done) match = query.getCursor(state, 0, this.origin).next();
      if (!match.done) {
        this.view.dispatch({ effects: [...effects, EditorView.scrollIntoView(match.value.from, { y: "center" })],
          selection: EditorSelection.single(match.value.from, match.value.to), userEvent: "select.search" });
        return;
      }
    }
    this.view.dispatch({ effects });
  }
  setReplace(show, focus) {
    this.showReplace = show && !this.view.state.readOnly;
    this.replaceRow.hidden = !this.showReplace;
    this.toggle.setAttribute("aria-expanded", String(this.showReplace));
    this.toggle.classList.toggle("agy-find-toggle-open", this.showReplace);
    if (focus) (this.showReplace ? this.replace : this.find).focus();
  }
  render() {
    const { total, index } = count(this.view.state, this.query);
    const capped = total >= MAX_COUNT ? `${MAX_COUNT}+` : `${total}`;
    this.count.textContent = !this.query.search ? "" : total === 0 ? "No Results" : `${index < 0 ? "?" : index + 1} of ${capped}`;
    this.findField.classList.toggle("agy-find-none", !!this.query.search && total === 0);
    this.prev.disabled = this.next.disabled = total === 0;
    const writable = !this.view.state.readOnly;
    this.replaceOne.disabled = this.replaceEvery.disabled = total === 0 || !writable;
    this.toggle.disabled = !writable;
  }
  update(update) {
    const query = getSearchQuery(update.state);
    if (!query.eq(this.query)) this.sync(query);
    if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(effect => effect.is(setSearchQuery)))) this.render();
    if (update.startState.readOnly !== update.state.readOnly) this.setReplace(this.showReplace, false);
  }
  keydown(event) {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") { event.preventDefault(); closeSearchPanel(this.view); }
    else if (event.key === "Enter" && event.target === this.find) { event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(this.view); }
    else if (event.key === "Enter" && event.target === this.replace) { event.preventDefault(); (mod ? replaceAll : replaceNext)(this.view); }
    else if (mod && event.key.toLowerCase() === "g") { event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(this.view); }
    else return;
    event.stopPropagation();
  }
}

export const createFindPanel = view => new FindPanel(view);

// Opens the panel (Find only unless replace is requested) or refocuses it when already open.
export function openFind(view, { replace = false, onToggle } = {}) {
  requested.set(view, { replace, onToggle });
  let panel = panels.get(view);
  if (!panel) {
    openSearchPanel(view);
    panel = panels.get(view);
    if (!panel) return false;
    const input = replace ? panel.replace : panel.find;
    input.focus(); input.select();
    return true;
  }
  const sel = view.state.selection.main, text = view.state.sliceDoc(sel.from, sel.to);
  // Seed from the selection only when invoked from the text, not while typing in the panel.
  if (view.hasFocus && text && !text.includes("\n") && text.length <= 200 && text !== panel.query.search) {
    panel.find.value = text;
    panel.origin = sel.from;
    panel.commit(false);
  }
  if (replace) panel.setReplace(true, false);
  const input = replace ? panel.replace : panel.find;
  input.focus(); input.select();
  return true;
}

export function toggleFind(view, options) {
  if (searchPanelOpen(view.state)) { closeSearchPanel(view); view.focus(); return false; }
  openFind(view, options);
  return true;
}

export const findTheme = {
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".agy-find-toggle svg": { transition: "transform 120ms ease" },
  ".agy-find-toggle-open svg": { transform: "rotate(90deg)" },
  ".agy-find [aria-pressed=false]": { color: "var(--muted-foreground)" },
  ".agy-find [aria-pressed=false]:hover, .agy-find [aria-pressed=true]": { color: "var(--foreground)" },
  ".agy-find [aria-pressed=true]": { backgroundColor: "var(--secondary)" },
  ".agy-find-none": { boxShadow: "inset 0 0 0 1px var(--error)" },
  ".agy-find [hidden]": { display: "none" },
};
