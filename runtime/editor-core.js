import { basicSetup } from "codemirror";
import { EditorState, EditorSelection, Compartment, Prec, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, Decoration } from "@codemirror/view";
import { indentWithTab, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { createFindPanel, openFind, toggleFind, findTheme } from "./find-panel.js";
import { indentUnit, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";

function language(uri) {
  const ext = uri.split(/[?#]/)[0].split(".").pop().toLowerCase();
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext)) {
    return javascript({ typescript: ["ts", "tsx"].includes(ext), jsx: ["jsx", "tsx"].includes(ext) });
  }
  return ({ json, py: python, pyw: python, md: markdown, markdown, css, html, htm: html })[ext]?.() ?? [];
}

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "12px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)", lineHeight: "1.6" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--editor-line-number-foreground)", border: "none", paddingRight: "8px" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--muted)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--editor-selection-background) !important" },
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)", fontFamily: "inherit" },
  ".cm-textfield, .cm-button": { color: "var(--foreground)", background: "var(--background)", border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 6px", font: "inherit" },
  ".cm-textfield::placeholder": { color: "var(--placeholder)" },
  ".cm-textfield:focus-visible, .cm-button:focus-visible": { outline: "1px solid var(--primary)", outlineOffset: "1px" },
  ".cm-button, .cm-foldPlaceholder": { background: "var(--secondary)", color: "var(--secondary-foreground)", borderColor: "var(--border)" },
  ".cm-button:hover": { background: "var(--muted)", color: "var(--foreground)" },
  ".cm-searchMatch": { backgroundColor: "var(--editor-find-match-background)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--editor-find-current-background)", outline: "1px solid var(--editor-find-current-border)" },
  ".cm-matchingBracket": { backgroundColor: "var(--editor-selection-background)", outline: "1px solid var(--border)" },
  ".cm-nonmatchingBracket": { color: "var(--error)" },
  ".cm-tooltip": { backgroundColor: "var(--card)", color: "var(--foreground)", border: "1px solid var(--card-border)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--secondary)", color: "var(--foreground)" },
  ...findTheme,
});

// A nonfallback highlighter prevents basicSetup's independent default palette.
const noLezerHighlighting = syntaxHighlighting(HighlightStyle.define([]));
const refreshPrism = StateEffect.define();
const prismAliases = {
  md: "markdown", markdown: "markdown", js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", cts: "typescript", mts: "typescript", py: "python", pyw: "python",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", txt: "text", plaintext: "text",
  sh: "bash", shell: "bash", yml: "yaml", rb: "ruby", rs: "rust", cs: "csharp", h: "c", cc: "cpp",
};

function prismHighlighting(uri) {
  const ext = uri.split(/[?#]/)[0].split(".").pop().toLowerCase();
  const name = prismAliases[ext] ?? ext;
  const grammar = () => {
    const languages = window.Prism?.languages;
    const value = languages && Object.hasOwn(languages, name) ? languages[name] : null;
    return value && typeof value === "object" ? value : null;
  };
  function decorate(view, rules) {
    if (!rules || !window.Prism?.tokenize || view.state.doc.length > 100000) return Decoration.none;
    const ranges = [];
    let offset = 0;
    // Raw's h7c gives every leaf the child's aliases followed by its inherited classes.
    function flatten(token, inherited = "") {
      if (typeof token === "string") {
        const lines = token.split("\n");
        lines.forEach((line, index) => {
          if (line && inherited) ranges.push(Decoration.mark({ class: inherited }).range(offset, offset + line.length));
          offset += line.length + (index < lines.length - 1 ? 1 : 0);
        });
      } else {
        const alias = Array.isArray(token.alias) ? token.alias.join(" ") : token.alias || "";
        const type = token.type + (alias ? ` ${alias}` : "");
        const classes = `token ${type}` + (inherited ? ` ${inherited.replace(/^token /, "")}` : "");
        if (Array.isArray(token.content)) token.content.forEach(child => flatten(child, classes));
        else flatten(token.content, classes);
      }
    }
    try {
      window.Prism.tokenize(view.state.doc.toString(), rules).forEach(token => flatten(token));
      return Decoration.set(ranges);
    } catch {
      return Decoration.none;
    }
  }
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.rules = grammar();
      this.decorations = decorate(view, this.rules);
      this.loaded = event => {
        if (event.target?.tagName === "SCRIPT" && grammar() !== this.rules) view.dispatch({ effects: refreshPrism.of(null) });
      };
      document.addEventListener("load", this.loaded, true);
    }
    update(update) {
      const rules = grammar();
      if (update.docChanged || rules !== this.rules || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshPrism)))) {
        this.rules = rules;
        this.decorations = decorate(update.view, rules);
      }
    }
    destroy() { document.removeEventListener("load", this.loaded, true); }
  }, { decorations: plugin => plugin.decorations });
}

// Nearest nonblank line, so Markdown's blank paragraph separators do not hide the context.
function neighbor(doc, number, step) {
  for (let n = number + step; n >= 1 && n <= doc.lines; n += step) {
    const text = doc.line(n).text;
    if (text.trim()) return text;
  }
  return "";
}

function create({ parent, uri = "", text = "", onChange = () => {}, onPosition = () => {}, onSave = () => {}, onSelection = () => {}, onSearch = () => {} }) {
  const documents = new Map();
  const readOnly = new Compartment();
  let currentUri = uri, locked = false, hostChange = false, frame = 0, destroyed = false, selectionFrame = 0;
  // Layout reads are not allowed inside update listeners, so selection consumers run next frame.
  const notifySelection = () => {
    if (!selectionFrame && !destroyed) selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0;
      if (!destroyed) onSelection();
    });
  };
  let generation = 0, restoreFrame = 0, restoring = false, pendingPosition = null, inChange = false;
  const position = () => {
    if (restoring && pendingPosition) return { ...pendingPosition };
    const top = view.scrollDOM.scrollTop;
    // Update callbacks cannot force a layout read; their existing viewport is sufficient.
    const block = inChange ? view.viewportLineBlocks.find(line => line.bottom > top) ?? view.lineBlockAt(view.viewport.from) : view.lineBlockAtHeight(top);
    return {
      anchor: view.state.selection.main.anchor, head: view.state.selection.main.head,
      scrollTop: top, scrollLeft: view.scrollDOM.scrollLeft,
      scrollAnchor: block.from, scrollOffset: top - block.top,
    };
  };
  const notifyPosition = () => {
    if (!frame && !destroyed && !restoring) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!destroyed && !restoring) onPosition(position());
    });
  };
  const extensions = (fileUri) => [
    basicSetup, theme, noLezerHighlighting, prismHighlighting(fileUri), language(fileUri), EditorView.lineWrapping, indentUnit.of("  "), EditorState.tabSize.of(2),
    search({ top: true, createPanel: createFindPanel }), readOnly.of(EditorState.readOnly.of(locked)),
    Prec.highest(keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => { onSave(); return true; } },
      indentWithTab, ...searchKeymap,
    ])),
    EditorView.domEventHandlers({
      scroll() { notifyPosition(); notifySelection(); },
      keydown(event) {
        if (event.key === "Tab" || ((event.metaKey || event.ctrlKey) && ["s", "f", "h"].includes(event.key.toLowerCase()))) event.stopPropagation();
        return false;
      },
    }),
    EditorView.updateListener.of(update => {
      if (update.docChanged && !hostChange) {
        inChange = true;
        try { onChange(update.state.doc.toString()); } finally { inChange = false; }
      }
      if (!hostChange && (update.selectionSet || update.docChanged)) notifyPosition();
      if (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged) notifySelection();
    }),
  ];
  const selectionFor = (value, length) => EditorSelection.single(
    Math.max(0, Math.min(length, Number(value?.anchor) || 0)),
    Math.max(0, Math.min(length, Number(value?.head ?? value?.anchor) || 0)),
  );
  const newState = (fileUri, content, selection) => EditorState.create({
    doc: content, selection: selectionFor(selection, content.length), extensions: extensions(fileUri),
  });
  const view = new EditorView({ parent, state: newState(uri, text) });
  view.dom.setAttribute("aria-label", "File editor");
  view.contentDOM.setAttribute("aria-label", "Edit file contents");
  view.dom.dataset.findIgnore = "true";

  function setDocument({ uri: nextUri, text: nextText, selection, scrollTop, scrollLeft, scrollAnchor, scrollOffset }) {
    if (destroyed) return;
    const previous = position();
    documents.set(currentUri, { state: view.state, scroll: restoring ? null : view.scrollSnapshot(), ...previous });
    const saved = documents.get(nextUri);
    const restored = selection ?? saved ?? {};
    const run = ++generation;
    cancelAnimationFrame(restoreFrame);
    cancelAnimationFrame(frame);
    frame = 0;
    const valid = () => !destroyed && generation === run && currentUri === nextUri;
    const finish = () => {
      if (!valid()) return;
      restoring = false;
      pendingPosition = null;
      notifyPosition();
    };
    let state = saved?.state;
    const unchanged = state?.doc.toString() === nextText;
    if (!state) state = newState(nextUri, nextText, restored);
    else if (!unchanged) {
      // Text changed outside the editor (disk sync, conflict choice): apply it as one minimal,
      // undoable edit so earlier undo history survives and ⌘Z can step back past it.
      const previous = state.doc.toString();
      let start = 0, endA = previous.length, endB = nextText.length;
      while (start < endA && start < endB && previous.charCodeAt(start) === nextText.charCodeAt(start)) start++;
      while (endA > start && endB > start && previous.charCodeAt(endA - 1) === nextText.charCodeAt(endB - 1)) { endA--; endB--; }
      state = state.update({
        changes: { from: start, to: endA, insert: nextText.slice(start, endB) },
        effects: readOnly.reconfigure(EditorState.readOnly.of(locked)),
        annotations: Transaction.userEvent.of("input.external"),
      }).state;
    } else state = state.update({
      selection: selectionFor(restored, state.doc.length),
      effects: readOnly.reconfigure(EditorState.readOnly.of(locked)),
    }).state;
    currentUri = nextUri;
    const top = scrollTop ?? saved?.scrollTop ?? 0, left = scrollLeft ?? saved?.scrollLeft ?? 0;
    const logicalAnchor = scrollAnchor ?? saved?.scrollAnchor;
    const logicalOffset = scrollOffset ?? saved?.scrollOffset ?? 0;
    const targetAnchor = Math.max(0, Math.min(state.doc.length, Number(logicalAnchor) || 0));
    restoring = true;
    pendingPosition = { anchor: state.selection.main.anchor, head: state.selection.main.head, scrollTop: top, scrollLeft: left, scrollAnchor: targetAnchor, scrollOffset: logicalOffset };
    hostChange = true;
    try {
      view.setState(state);
      if (unchanged && saved.scroll && scrollAnchor === undefined && (scrollTop === undefined || scrollTop === saved.scrollTop) && (scrollLeft === undefined || scrollLeft === saved.scrollLeft)) {
        view.dispatch({ effects: saved.scroll });
        restoreFrame = requestAnimationFrame(() => {
          if (valid()) view.requestMeasure({ read: () => null, write: finish });
        });
        return;
      }
      if (logicalAnchor !== undefined) view.dispatch({ effects: EditorView.scrollIntoView(targetAnchor, { y: "start", yMargin: 0 }) });
    } finally { hostChange = false; }
    // CM applies scrollIntoView after measure writes; correct the offset in the next frame.
    restoreFrame = requestAnimationFrame(() => {
      if (!valid()) return;
      view.requestMeasure({
        read: () => valid() ? logicalAnchor === undefined ? top : view.lineBlockAt(targetAnchor).top + logicalOffset : null,
        write: measuredTop => {
          if (!valid() || measuredTop === null) return;
          view.scrollDOM.scrollTop = measuredTop;
          view.scrollDOM.scrollLeft = left;
          finish();
        },
      });
    });
  }

  return {
    get text() { return view.state.doc.toString(); },
    setDocument,
    getPosition: position,
    focus() { view.focus(); },
    get hasFocus() { return view.hasFocus; },
    undo() { undo(view); view.focus(); },
    redo() { redo(view); view.focus(); },
    get history() { return { undo: undoDepth(view.state), redo: redoDepth(view.state) }; },
    // Describes the main nonempty selection with 1-based inclusive lines and nearby context.
    selection() {
      const { from, to, head } = view.state.selection.main;
      if (from === to) return null;
      const doc = view.state.doc, first = doc.lineAt(from);
      let last = doc.lineAt(to);
      if (last.from === to && last.number > first.number) last = doc.line(last.number - 1);
      const coords = view.coordsAtPos(head, head === from ? 1 : -1);
      return {
        text: doc.sliceString(from, to), startLine: first.number, endLine: last.number,
        linePrefix: doc.sliceString(first.from, from), lineSuffix: doc.sliceString(Math.min(to, last.to), last.to),
        lineBefore: neighbor(doc, first.number, -1), lineAfter: neighbor(doc, last.number, 1),
        // Matches Raw's comment anchors: 50 adjacent characters without line breaks.
        textBefore: doc.sliceString(Math.max(0, from - 200), from).replace(/\n/g, "").slice(-50),
        textAfter: doc.sliceString(to, Math.min(doc.length, to + 200)).replace(/\n/g, "").slice(0, 50),
        rect: coords && { left: coords.left, top: coords.top, bottom: coords.bottom },
      };
    },
    setReadOnly(value) {
      if (locked === !!value) return;
      locked = !!value;
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(locked)) });
    },
    // Find opens without Replace; replace:true opens both. toggleSearch closes an open panel.
    openSearch({ replace = false } = {}) { openFind(view, { replace, onToggle: onSearch }); },
    toggleSearch() { return toggleFind(view, { onToggle: onSearch }); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(selectionFrame);
      documents.clear();
      view.destroy();
    },
  };
}

window.__agyEditorCore = { version: 7, create };
