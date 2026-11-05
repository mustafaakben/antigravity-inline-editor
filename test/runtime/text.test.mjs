// Loads the pure helpers from runtime/edits-tab.js through its test hook, without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../runtime/edits-tab.js', import.meta.url), 'utf8');
const helpers = vm.runInNewContext(source, { window: { __agyEditsTestHooks: true }, TextDecoder, TextEncoder, atob, btoa });
const { decode, encode, clip, formatQuote } = helpers;
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

test('decode normalizes CRLF and remembers the format', () => {
  assert.deepEqual({ ...decode(b64('a\r\nb\r\n')) }, { text: 'a\nb\n', eol: '\r\n', bom: false });
  assert.deepEqual({ ...decode(b64('a\nb')) }, { text: 'a\nb', eol: '\n', bom: false });
});

test('decode detects a UTF-8 BOM and keeps Unicode', () => {
  const value = decode(b64(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('café ✓\n')])));
  assert.equal(value.bom, true);
  assert.equal(value.text.replace(/^\uFEFF/, ''), 'café ✓\n');
});

test('decode refuses binary, invalid UTF-8, mixed endings, and large files', () => {
  assert.throws(() => decode(b64('a\0b')), /binary/);
  assert.throws(() => decode(b64(Buffer.from([0xff, 0xfe, 0x00]))));
  assert.throws(() => decode(b64('a\r\nb\nc')), /mixed line endings/);
  assert.throws(() => decode('A'.repeat(3 * 1024 * 1024)), /2 MB/);
});

test('encode round-trips text with the original line endings and BOM', () => {
  for (const original of [Buffer.from('x\r\ny\r\n'), Buffer.from('x\ny'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('é\r\n')])]) {
    const value = decode(b64(original));
    const text = value.text.replace(/^\uFEFF/, '');
    assert.equal(encode(text, value), b64(original));
  }
});

test('clip keeps the side nearest the selection', () => {
  assert.equal(clip('abcdef', 10, true), 'abcdef');
  assert.equal(clip('abcdef', 3, true), '…def');
  assert.equal(clip('abcdef', 3, false), 'abc…');
});

const sel = { text: 'chosen words', startLine: 5, endLine: 5, linePrefix: 'Some ', lineSuffix: ' here.', lineBefore: '## Heading', lineAfter: 'Next paragraph.' };

test('formatQuote frames the selection with nearby lines', () => {
  assert.equal(formatQuote({ name: 'notes.md', sel, unsaved: false }), [
    '<quote file="notes.md" lines="5">',
    '<before>## Heading\nSome </before>',
    '<selection>chosen words</selection>',
    '<after> here.\nNext paragraph.</after>',
    '</quote>'].join('\n'));
});

test('formatQuote marks unsaved drafts, ranges, and escapes the file name', () => {
  const quote = formatQuote({ name: 'a "b" & <c>.md', sel: { ...sel, endLine: 7, linePrefix: '', lineBefore: '' }, unsaved: true });
  assert.match(quote, /^<quote file="a &quot;b&quot; &amp; &lt;c>.md" lines="5-7" status="unsaved draft">/);
  assert.doesNotMatch(quote, /<before>/);
});

test('runtime exposes its version', () => assert.match(helpers.VERSION, /^\d+\.\d+\.\d+$/));
