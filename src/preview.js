// Markdown Preview for Edits. Claiming .md replaces Antigravity's own Preview, so Edits renders
// one itself. Raw HTML in the document is escaped (html: false) and markdown-it rejects
// javascript:, vbscript:, and non-image data: links, so the preview cannot run code in this view,
// which can write files.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

// GitHub-style task list items: "- [ ] todo" and "- [x] done".
md.core.ruler.after('inline', 'task-lists', state => {
  for (let i = 2; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (token.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' || state.tokens[i - 2].type !== 'list_item_open') continue;
    const match = /^\[([ xX])\]\s/.exec(token.content);
    if (!match || token.children[0]?.type !== 'text') continue;
    token.children[0].content = token.children[0].content.slice(match[0].length);
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'}> `;
    token.children.unshift(box);
    state.tokens[i - 2].attrJoin('class', 'task-item');
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

// Front matter is shown as a code block rather than rendered as text and a rule.
function splitFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return match ? { front: match[1], body: text.slice(match[0].length) } : { front: null, body: text };
}

export const isMarkdown = name => /\.(md|markdown|mdx)$/i.test(name);

export function renderMarkdown(text) {
  const { front, body } = splitFrontMatter(text);
  const head = front === null ? '' : `<pre class="edits-front-matter"><code>${md.utils.escapeHtml(front)}</code></pre>`;
  const lineOffset = front === null ? 0 : text.slice(0, text.length - body.length).split('\n').length - 1;
  return head + md.render(body, { lineOffset });
}
