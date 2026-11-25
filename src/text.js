// Pure text helpers for the Edits view. No DOM access, so tests can import them under Node.
export const MAX_BYTES = 10 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export function bytesFromBase64(base64) {
  if (base64.length > MAX_BYTES * 4 / 3 + 4) throw new Error('Edits supports UTF-8 text files up to 10 MB.');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

// Decodes file bytes into editor text, remembering the line ending and byte order mark so a save
// writes them back unchanged.
export function decode(base64) {
  const bytes = bytesFromBase64(base64);
  let text;
  try { text = decoder.decode(bytes); }
  catch { throw new Error('This file is not UTF-8 text, so Edits cannot open it. The file has not been changed.'); }
  if (text.includes('\0')) throw new Error('This file appears to be binary. Edits supports UTF-8 text.');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text.replace(/\r\n/g, '').includes('\r') || (eol === '\r\n' && text.replace(/\r\n/g, '').includes('\n')))
    throw new Error('Edits does not support files with mixed line endings. The file has not been changed.');
  return { text: text.replace(/\r\n/g, '\n'), eol, bom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 };
}

export function encode(text, { eol = '\n', bom = false } = {}) {
  const source = (bom ? '﻿' : '') + (eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text);
  const bytes = encoder.encode(source);
  if (bytes.length > MAX_BYTES) throw new Error('Edits supports UTF-8 text files up to 10 MB.');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

// A short, stable fingerprint of a file version (53-bit cyrb53 plus length), used to match
// recovery drafts to the exact disk contents they were based on.
export function fingerprint(base64) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < base64.length; i++) {
    const ch = base64.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}-${base64.length.toString(36)}`;
}

export const clip = (text, max, keepEnd) => text.length <= max ? text :
  keepEnd ? `…${text.slice(-max)}` : `${text.slice(0, max)}…`;
export const attr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const lineRange = sel => sel.startLine === sel.endLine ? `${sel.startLine}` : `${sel.startLine}-${sel.endLine}`;
function context(sel) {
  return {
    before: clip([sel.lineBefore, sel.linePrefix].filter(Boolean).join('\n'), 800, true),
    after: clip([sel.lineSuffix, sel.lineAfter].filter(Boolean).join('\n'), 800, false),
  };
}

// Quote attaches the selected text itself, framed by the nearest lines, so it stays accurate
// for unsaved drafts whose line numbers differ from the file on disk.
export function formatQuote({ name, sel, unsaved }) {
  const { before, after } = context(sel);
  return [`<quote file="${attr(name)}" lines="${lineRange(sel)}"${unsaved ? ' status="unsaved draft"' : ''}>`,
    before && `<before>${before}</before>`, `<selection>${sel.text}</selection>`,
    after && `<after>${after}</after>`, '</quote>'].filter(Boolean).join('\n');
}

// A comment is a quote with the user's note about it.
export function formatComment({ name, sel, comment, unsaved }) {
  const { before, after } = context(sel);
  return [`<comment file="${attr(name)}" lines="${lineRange(sel)}"${unsaved ? ' status="unsaved draft"' : ''}>`,
    before && `<before>${before}</before>`, `<selection>${sel.text}</selection>`,
    after && `<after>${after}</after>`, `<note>${comment}</note>`, '</comment>'].filter(Boolean).join('\n');
}

// The model context Edits attaches to the user's next message: every pending quote and comment.
export function contextBlocks(items) {
  if (!items.length) return [];
  const header = items.length === 1 ? 'The user attached this from a file open in Edits:' :
    `The user attached these ${items.length} items from files open in Edits:`;
  return [{ type: 'text', text: [header, ...items.map(item => item.text)].join('\n\n') }];
}
