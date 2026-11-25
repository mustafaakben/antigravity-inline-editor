// Edits: the file viewer view. Antigravity loads this page in an isolated frame when a supported
// file opens in the side panel, and passes an opaque URI for that file. The view reads and writes
// the file through Antigravity (MCP Apps resources), autosaves, and attaches Quote and Comment to
// the user's next message as model context.
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps/app-with-deps';
import { create } from './editor-core.js';
import { decode, encode, fingerprint, formatQuote, formatComment, contextBlocks } from './text.js';
import { isMarkdown, renderMarkdown } from './preview.js';

const VERSION = '0.7.0';
const AUTOSAVE_DELAY = 800, RETRY_DELAY = 3000, SYNC_INTERVAL = 2000, DRAFT_DELAY = 400;
const WRITE_METHOD = 'com.google.antigravity/resources/write';
const RESOURCES_KEY = 'com.google.antigravity/resources';
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const keys = text => mac ? text : text.replace(/⌥⌘/g, 'Ctrl+Alt+').replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+');

const $ = id => document.getElementById(id);
const ui = {
  root: $('edits'), status: $('status'), conflict: $('conflict'), useDisk: $('use-disk'), keepMine: $('keep-mine'),
  undo: $('undo'), redo: $('redo'), find: $('find'), code: $('code'), footer: $('footer'), hint: $('hint'),
  attached: $('attached'), attachedLabel: $('attached-label'), clearAttached: $('clear-attached'),
  popup: $('selection'), comment: $('comment'), quote: $('quote'),
  composer: $('composer'), composerInput: $('composer-input'), cancel: $('composer-cancel'),
  empty: $('empty'), emptyText: $('empty-text'),
  modes: $('modes'), modePreview: $('mode-preview'), modeEdit: $('mode-edit'), preview: $('preview'),
};

const state = {
  file: null, loaded: false, loading: false, saving: null, saveAgain: false, syncing: false,
  baseline: '', baseText: '', draft: '', eol: '\n', bom: false, baseHash: '',
  conflict: false, error: false, message: '', notice: null, canWrite: false, canAttach: false,
  attachments: [], pendingComment: null, revision: 0, draftStored: false,
  markdown: false, mode: 'edit',
};
const dirty = () => state.loaded && state.draft !== state.baseText;
let saveTimer = 0, draftTimer = 0, noticeTimer = 0;

const app = new App({ name: 'Edits', version: VERSION }, {}, { autoResize: false });

const editor = create({
  parent: ui.code,
  onChange(text) {
    if (!state.loaded) return;
    state.draft = text; state.revision++;
    if (!state.conflict) { state.error = false; state.message = ''; }
    scheduleDraft(); scheduleSave(); queueMicrotask(render);
  },
  onPosition() { if (dirty()) scheduleDraft(); },
  onSelection() { updateSelection(); updateHistory(); },
  onSave() { save(); },
  onSearch(open) { ui.find.setAttribute('aria-pressed', String(open)); },
});
editor.setReadOnly(true);

// ---- Rendering --------------------------------------------------------------------------------

function render() {
  const busy = state.saving || dirty();
  const text = !state.file ? '' : state.loading && !state.loaded ? 'Loading…' : state.conflict || state.error ? state.message :
    !state.canWrite ? 'Read only' : busy ? 'Saving…' : 'Saved';
  ui.status.textContent = text;
  ui.status.title = text === 'Saved' ? 'Saved and verified on disk' :
    text === 'Read only' ? 'Antigravity does not allow writing this file from here.' : '';
  ui.status.dataset.error = String(state.error);
  ui.conflict.hidden = !state.conflict;
  ui.empty.hidden = !!(state.file && (state.loaded || state.loading));
  ui.root.dataset.ready = String(state.loaded);
  ui.root.dataset.mode = state.mode;
  ui.modes.hidden = !state.markdown || !state.loaded;
  ui.modePreview.setAttribute('aria-pressed', String(state.mode === 'preview'));
  ui.modeEdit.setAttribute('aria-pressed', String(state.mode === 'edit'));
  editor.setReadOnly(!state.loaded || !state.canWrite);
  updateHistory();
  const count = state.attachments.length;
  ui.attached.hidden = !count;
  ui.attachedLabel.textContent = count === 1 ? '1 item attached to your next message' : `${count} items attached to your next message`;
  ui.footer.dataset.error = String(!!state.notice?.error);
  ui.hint.textContent = state.notice ? state.notice.text : state.mode === 'preview' ? 'Preview · Choose Edit to change the file' :
    `Changes save automatically · ${keys('⌘F')} Find · ${keys('⌥⌘F')} Replace` +
    (state.canAttach ? ' · Select text to Quote or Comment' : '');
}

function updateHistory() {
  const { undo, redo } = editor.history;
  ui.undo.disabled = !undo || !state.canWrite;
  ui.redo.disabled = !redo || !state.canWrite;
}

function notice(text, error = false) {
  clearTimeout(noticeTimer);
  state.notice = { text, error };
  noticeTimer = setTimeout(() => { state.notice = null; render(); }, error ? 8000 : 5000);
  render();
}

// Markdown files open in Preview, like Antigravity's own viewer; Edit shows the editor.
function setMode(mode) {
  if (mode === 'preview' && !state.markdown) mode = 'edit';
  state.mode = mode;
  hideSelection(); closeComposer(false);
  if (mode === 'preview') renderPreview();
  render();
  if (mode === 'edit' && state.loaded) editor.focus();
}

function renderPreview() {
  if (state.mode !== 'preview') return;
  const top = ui.preview.scrollTop;
  ui.preview.innerHTML = renderMarkdown(state.draft);
  ui.preview.scrollTop = top;
}

function showDocument() {
  renderPreview();
  if (editor.text !== state.draft) editor.setDocument({ uri: state.file.name, text: state.draft });
}

// ---- File access through Antigravity ----------------------------------------------------------

async function readDisk() {
  const result = await app.readServerResource({ uri: state.file.resourceUri });
  const content = result?.contents?.[0];
  if (typeof content?.blob === 'string') return content.blob;
  if (typeof content?.text === 'string') return encode(content.text);
  throw new Error('Antigravity returned no contents for this file.');
}

// Antigravity's write method is not in the spec, so the SDK needs a result schema (Standard Schema).
const WriteResult = { '~standard': { version: 1, vendor: 'edits', validate: value => ({ value }) } };
async function writeDisk(blob) {
  const result = await app.request({ method: WRITE_METHOD, params: { uri: state.file.resourceUri, blob } }, WriteResult);
  if (result?.isError) throw new Error('Antigravity refused to write the file.');
}

// ---- Recovery drafts (kept by the plugin server, since frames have no lasting storage) --------

async function tool(name, args) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result?.isError) throw new Error(result.content?.[0]?.text || `${name} failed.`);
  return result?.structuredContent ?? {};
}

function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(storeDraft, DRAFT_DELAY);
}

async function storeDraft() {
  clearTimeout(draftTimer);
  if (!state.loaded || !state.baseHash) return;
  const { name } = state.file, baseHash = state.baseHash;
  try {
    if (dirty()) {
      await tool('save_draft', { name, baseHash, draft: state.draft, position: editor.getPosition() });
      state.draftStored = true;
    } else if (state.draftStored) {
      await tool('clear_draft', { name, baseHash });
      state.draftStored = false;
    }
  } catch { /* Recovery is best effort; autosave is the primary path. */ }
}

async function clearDraftFor(baseHash) {
  if (!state.draftStored || !baseHash) return;
  state.draftStored = false;
  try { await tool('clear_draft', { name: state.file.name, baseHash }); } catch { /* best effort */ }
}

// ---- Loading, saving, syncing ------------------------------------------------------------------

function adopt(base64) {
  const value = decode(base64);
  Object.assign(state, { baseline: base64, baseText: value.text, eol: value.eol, bom: value.bom, baseHash: fingerprint(base64) });
  return value;
}

async function load() {
  state.loading = true; state.error = false; state.message = ''; render();
  try {
    const value = adopt(await readDisk());
    state.draft = value.text;
    state.loaded = true; state.conflict = false;
    let position;
    try {
      const { draft } = await tool('load_draft', { name: state.file.name, baseHash: state.baseHash });
      if (draft && typeof draft.draft === 'string' && draft.draft !== value.text) {
        state.draft = draft.draft; state.draftStored = true; position = draft.position;
        notice('Restored unsaved edits from your last session.');
      }
    } catch { /* No recovery available. */ }
    editor.setDocument({ uri: state.file.name, text: state.draft, selection: position,
      scrollAnchor: position?.scrollAnchor, scrollOffset: position?.scrollOffset });
    if (state.canWrite) scheduleSave();
    // Restored edits open in the editor so they are visible; otherwise Markdown opens in Preview.
    setMode(state.markdown && !dirty() ? 'preview' : 'edit');
  } catch (error) {
    state.error = true; state.message = error.message;
    ui.emptyText.textContent = error.message;
  } finally { state.loading = false; render(); }
}

function scheduleSave(delay = AUTOSAVE_DELAY) {
  clearTimeout(saveTimer); saveTimer = 0;
  if (!state.loaded || !state.canWrite || state.conflict || !dirty()) return;
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, delay);
}

// Read-before-write conflict detection and read-back verification, as in Raw-mode editors.
async function write() {
  const text = state.draft, previousHash = state.baseHash;
  try {
    const blob = encode(text, state);
    if (await readDisk() !== state.baseline) {
      state.conflict = true;
      throw new Error('File changed on disk while you were editing.');
    }
    await writeDisk(blob);
    if (await readDisk() !== blob) throw new Error('Save could not be verified. Retrying…');
    adopt(blob); state.baseText = text;
    await clearDraftFor(previousHash);
    if (dirty()) scheduleDraft();
  } catch (error) {
    state.error = true;
    state.message = state.conflict || error.message.endsWith('Retrying…') ? error.message : `${error.message} Retrying…`;
  }
}

function save() {
  if (state.saving) { state.saveAgain = true; return state.saving; }
  clearTimeout(saveTimer); saveTimer = 0;
  if (!state.loaded || !state.canWrite || state.conflict || !dirty()) return Promise.resolve();
  state.error = false; state.message = '';
  state.saving = write().finally(() => {
    const again = state.saveAgain;
    state.saving = null; state.saveAgain = false;
    if (state.error && !state.conflict) scheduleSave(RETRY_DELAY);
    else if (dirty()) scheduleSave(again ? 0 : AUTOSAVE_DELAY);
    render();
  });
  render();
  return state.saving;
}

async function useDisk() {
  const previousHash = state.baseHash;
  state.conflict = false; state.error = false; state.message = '';
  try {
    const value = adopt(await readDisk());
    state.draft = value.text;
    await clearDraftFor(previousHash);
    showDocument();
  } catch (error) { state.error = true; state.message = error.message; }
  render();
}

async function keepMine() {
  const previousHash = state.baseHash;
  try {
    adopt(await readDisk());
    state.conflict = false; state.error = false; state.message = '';
    await clearDraftFor(previousHash);
    scheduleDraft();
    save();
  } catch (error) { state.error = true; state.message = error.message; render(); }
}

// While there are no pending edits, pick up changes made by agents or other apps.
async function syncFromDisk() {
  if (!state.loaded || state.loading || state.saving || state.conflict || state.syncing || dirty() || document.hidden) return;
  state.syncing = true;
  try {
    const revision = state.revision, disk = await readDisk();
    if (disk === state.baseline || dirty() || state.saving || state.revision !== revision) return;
    const value = adopt(disk);
    state.draft = value.text;
    showDocument();
    notice('Updated with changes made outside Edits.');
  } catch { /* A transient read failure is retried on the next interval. */ }
  finally { state.syncing = false; }
}

// ---- Quote and Comment -------------------------------------------------------------------------

async function attach(text) {
  state.attachments.push({ text });
  try {
    await app.updateModelContext({ content: contextBlocks(state.attachments) });
    render();
    return true;
  } catch {
    state.attachments.pop();
    notice('Antigravity did not accept the attachment.', true);
    return false;
  }
}

async function clearAttachments() {
  state.attachments = [];
  try { await app.updateModelContext({ content: [] }); } catch { /* nothing attached */ }
  render();
  editor.focus();
}

async function quote() {
  const sel = editor.selection();
  if (!sel || !state.canAttach) return;
  hideSelection();
  if (await attach(formatQuote({ name: state.file.name, sel, unsaved: dirty() })))
    notice('Quote attached to your next message.');
}

function openComposer() {
  const sel = editor.selection();
  if (!sel || !state.canAttach) return;
  state.pendingComment = sel;
  hideSelection();
  ui.composer.hidden = false;
  ui.composerInput.value = '';
  place(ui.composer, sel.rect);
  ui.composerInput.focus();
}

function closeComposer(refocus = true) {
  if (ui.composer.hidden) return;
  ui.composer.hidden = true; state.pendingComment = null;
  if (refocus) editor.focus();
}

async function submitComment() {
  const sel = state.pendingComment, comment = ui.composerInput.value.trim();
  if (!sel || !comment) return;
  closeComposer();
  if (await attach(formatComment({ name: state.file.name, sel, comment, unsaved: dirty() })))
    notice('Comment attached to your next message.');
}

// Positions a floating element below the selection end, or above it near the bottom.
function place(el, rect) {
  const root = ui.root.getBoundingClientRect(), code = ui.code.getBoundingClientRect();
  const width = el.offsetWidth, height = el.offsetHeight;
  let top = rect.bottom - root.top + 6;
  if (rect.bottom + 6 + height > code.bottom) top = rect.top - root.top - height - 6;
  el.style.left = `${Math.max(8, Math.min(rect.left - root.left, root.width - width - 8))}px`;
  el.style.top = `${Math.max(code.top - root.top + 4, top)}px`;
}

function hideSelection() { ui.popup.hidden = true; }
function updateSelection() {
  const sel = state.loaded && state.canAttach && ui.composer.hidden && editor.hasFocus && editor.selection();
  const code = ui.code.getBoundingClientRect();
  if (!sel?.rect || sel.rect.bottom < code.top || sel.rect.top > code.bottom) return hideSelection();
  ui.popup.hidden = false;
  place(ui.popup, sel.rect);
}

// ---- Events ------------------------------------------------------------------------------------

for (const [el, label] of [[ui.undo, 'Undo (⌘Z)'], [ui.redo, 'Redo (⇧⌘Z)'], [ui.find, 'Find (⌘F) · Replace (⌥⌘F)'],
  [ui.comment, 'Comment on selection (⌥⌘M)'], [ui.quote, 'Quote selection in chat (⌘L)']]) el.title = keys(label);
for (const el of ui.root.querySelectorAll('[data-keys]')) el.textContent = keys(el.dataset.keys);
for (const el of [ui.popup, ui.undo, ui.redo])
  for (const type of ['mousedown', 'pointerdown']) el.addEventListener(type, event => event.preventDefault(), { capture: true });
ui.undo.addEventListener('click', () => editor.undo());
ui.redo.addEventListener('click', () => editor.redo());
ui.find.addEventListener('click', () => { if (state.mode === 'preview') setMode('edit'); editor.toggleSearch(); });
ui.modePreview.addEventListener('click', () => setMode('preview'));
ui.modeEdit.addEventListener('click', () => setMode('edit'));
// Links open outside the view (http and https only); everything else stays put.
ui.preview.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  event.preventDefault();
  let url;
  try { url = new URL(link.getAttribute('href'), 'https://invalid.example/'); } catch { return; }
  if (link.getAttribute('href').startsWith('#')) {
    document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
  } else if (['http:', 'https:'].includes(url.protocol) && url.hostname !== 'invalid.example') {
    app.openLink({ url: url.href }).catch(() => notice('Antigravity could not open the link.', true));
  }
});
ui.useDisk.addEventListener('click', useDisk);
ui.keepMine.addEventListener('click', keepMine);
ui.quote.addEventListener('click', quote);
ui.comment.addEventListener('click', openComposer);
ui.clearAttached.addEventListener('click', clearAttachments);
ui.cancel.addEventListener('click', () => closeComposer());
ui.composer.addEventListener('submit', event => { event.preventDefault(); submitComment(); });
ui.composerInput.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeComposer(); }
  else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitComment(); }
});
window.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
  const action = event.altKey ? ({ KeyM: 'comment', KeyF: 'replace' })[event.code] :
    ({ f: 'find', s: 'save', l: 'quote' })[event.key.toLowerCase()];
  if (!action) return;
  if ((action === 'quote' || action === 'comment') && !(editor.hasFocus && editor.selection())) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if ((action === 'find' || action === 'replace') && state.mode === 'preview') setMode('edit');
  if (action === 'find' || action === 'replace') editor.openSearch({ replace: action === 'replace' });
  else if (action === 'save') save();
  else if (action === 'quote') quote();
  else openComposer();
}, { capture: true });
// Frames can be removed without warning, so flush on every chance the page gets.
for (const type of ['pagehide', 'visibilitychange']) window.addEventListener(type, () => {
  if (type === 'visibilitychange' && !document.hidden) return;
  if (dirty()) { storeDraft(); save(); }
});
setInterval(syncFromDisk, SYNC_INTERVAL);

// ---- Host connection ---------------------------------------------------------------------------

function applyContext(context) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
  if (context[RESOURCES_KEY]) state.canWrite = !!context[RESOURCES_KEY].write;
}

// Capabilities vary by surface; read them before acting on the first notification.
function refreshCapabilities() {
  state.canWrite = !!app.getHostContext()?.[RESOURCES_KEY]?.write;
  state.canAttach = !!app.getHostCapabilities()?.updateModelContext;
}

function openFile(file) {
  if (!file?.resourceUri || typeof file.resourceUri !== 'string') return;
  refreshCapabilities();
  if (state.file?.resourceUri === file.resourceUri) return;
  state.file = { name: String(file.name || file.resourceUri.split('/').pop() || 'file'), resourceUri: file.resourceUri };
  state.markdown = isMarkdown(state.file.name);
  document.title = `${state.file.name} · Edits`;
  load();
}

app.ontoolinput = ({ arguments: args }) => openFile(args?.file);
app.ontoolresult = result => openFile(result?.structuredContent?.file);
app.onhostcontextchanged = context => { applyContext(context); render(); };

render();
try {
  await app.connect();
  applyContext(app.getHostContext());
  refreshCapabilities();
  if (!state.file) ui.emptyText.textContent = 'Open a text file from the side panel to edit it here.';
} catch (error) {
  ui.emptyText.textContent = `Edits could not connect to Antigravity: ${error.message}`;
}
render();
