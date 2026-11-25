// Markdown Preview for Edits. Claiming .md replaces Antigravity's own Preview, so Edits renders
// one itself, following the native renderer's structure (task circles, framed tables, code blocks
// with a language header and copy button). Raw HTML in the document is escaped (html: false) and
// markdown-it rejects javascript:, vbscript:, and non-image data: links, so the preview cannot run
// code in this view, which can write files.
import MarkdownIt from 'markdown-it';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
const escape = md.utils.escapeHtml;

const CHECK = '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
const COPY = '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/></svg>';
export const COPIED_ICON = CHECK;

// GitHub-style task list items, drawn like Antigravity's: a round box, and done items dimmed.
md.core.ruler.after('inline', 'task-lists', state => {
  for (let i = 2; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (token.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' || state.tokens[i - 2].type !== 'list_item_open') continue;
    const match = /^\[([ xX])\]\s/.exec(token.content);
    if (!match || token.children[0]?.type !== 'text') continue;
    const checked = match[1] !== ' ';
    token.children[0].content = token.children[0].content.slice(match[0].length);
    const box = new state.Token('html_inline', '', 0);
    box.content = `<span class="edits-task" role="img" aria-label="${checked ? 'Done' : 'Not done'}">${checked ? CHECK : ''}</span>`;
    token.children.unshift(box);
    if (checked) {
      const open = new state.Token('html_inline', '', 0), close = new state.Token('html_inline', '', 0);
      open.content = '<span class="task-checked-content">'; close.content = '</span>';
      token.children.splice(1, 0, open); token.children.push(close);
    }
    state.tokens[i - 2].attrJoin('class', checked ? 'task-list-item task-checked' : 'task-list-item');
  }
});

// Every block remembers the source lines it came from (1-based, inclusive), so a selection in
// the preview can be quoted with line numbers.
md.core.ruler.push('source-lines', state => {
  const offset = state.env.lineOffset || 0;
  for (const token of state.tokens) {
    if (!token.map || token.nesting < 0) continue;
    token.attrSet('data-line', String(token.map[0] + offset + 1));
    token.attrSet('data-line-end', String(Math.max(token.map[0] + 1, token.map[1]) + offset));
  }
});

// Tables sit in a rounded, scrollable frame.
md.renderer.rules.table_open = (tokens, idx, options, env, self) => `<div class="edits-table"${self.renderAttrs(tokens[idx])}><table>\n`;
md.renderer.rules.table_close = () => '</table></div>\n';

// Links show their address on hover; ::after in the styles adds the open-in-new icon.
const linkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href');
  if (href && !tokens[idx].attrGet('title')) tokens[idx].attrSet('title', href);
  return linkOpen(tokens, idx, options, env, self);
};

// Code blocks: a language header with a copy button, and the same syntax colors as the editor.
const parsers = {};
function parserFor(language) {
  const name = language.toLowerCase();
  const make = {
    js: () => javascript(), javascript: () => javascript(), mjs: () => javascript(), cjs: () => javascript(),
    jsx: () => javascript({ jsx: true }), ts: () => javascript({ typescript: true }), typescript: () => javascript({ typescript: true }),
    tsx: () => javascript({ typescript: true, jsx: true }), json: () => json(), jsonc: () => json(),
    py: () => python(), python: () => python(), css: () => css(), html: () => html(), xml: () => html(),
    md: () => markdown(), markdown: () => markdown(),
  }[name];
  if (!make) return null;
  return (parsers[name] ??= make().language.parser);
}

export function highlight(code, language) {
  const parser = parserFor(language || '');
  if (!parser) return escape(code);
  let out = '';
  try {
    highlightCode(code, parser.parse(code), classHighlighter,
      (text, classes) => { out += classes ? `<span class="${classes}">${escape(text)}</span>` : escape(text); },
      () => { out += '\n'; });
    return out;
  } catch { return escape(code); }
}

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const language = (token.info || '').trim().split(/\s+/)[0];
  const code = token.content.replace(/\n$/, '');
  return `<div class="edits-codeblock"${self.renderAttrs(token)}>` +
    `<div class="edits-codeblock-header"><span>${escape(language || 'text')}</span>` +
    `<button type="button" class="edits-copy" aria-label="Copy code" title="Copy code">${COPY}</button></div>` +
    `<pre><code>${highlight(code, language)}</code></pre></div>\n`;
};
md.renderer.rules.code_block = (tokens, idx, options, env, self) =>
  `<div class="edits-codeblock"${self.renderAttrs(tokens[idx])}><pre><code>${escape(tokens[idx].content.replace(/\n$/, ''))}</code></pre></div>\n`;

// Front matter is shown as a code block rather than rendered as text and a rule.
function splitFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return match ? { front: match[1], body: text.slice(match[0].length) } : { front: null, body: text };
}

export const isMarkdown = name => /\.(md|markdown|mdx)$/i.test(name);

export function renderMarkdown(text) {
  const { front, body } = splitFrontMatter(text);
  const head = front === null ? '' : `<pre class="edits-front-matter"><code>${escape(front)}</code></pre>`;
  const lineOffset = front === null ? 0 : text.slice(0, text.length - body.length).split('\n').length - 1;
  return head + md.render(body, { lineOffset });
}
