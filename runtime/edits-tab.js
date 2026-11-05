/* antigravity-inline-editor: the Edits tab, injected into Antigravity windows by host/attach.mjs. */
(() => {
  'use strict';
  const VERSION = '0.6.0';
  // Pure text helpers come first so tests can load them without a browser (see test/runtime).
  const MAX_BYTES = 2 * 1024 * 1024;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  function decode(base64) {
    if (base64.length > MAX_BYTES * 4 / 3 + 4) throw new Error('Edits supports UTF-8 text files up to 2 MB.');
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const text = decoder.decode(bytes);
    if (text.includes('\0')) throw new Error('This file appears to be binary. Edits supports UTF-8 text.');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    if (text.replace(/\r\n/g, '').includes('\r') || (eol === '\r\n' && text.replace(/\r\n/g, '').includes('\n')))
      throw new Error('Edits does not support files with mixed line endings. The file has not been changed.');
    return { text: text.replace(/\r\n/g, '\n'), eol,
      bom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 };
  }
  function encode(text, entry) {
    const source = (entry.bom ? '\ufeff' : '') + (entry.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text);
    const bytes = encoder.encode(source);
    if (bytes.length > MAX_BYTES) throw new Error('Edits supports UTF-8 text files up to 2 MB.');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }
  const clip = (text, max, keepEnd) => text.length <= max ? text :
    keepEnd ? `…${text.slice(-max)}` : `${text.slice(0, max)}…`;
  const attr = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  // Quote attaches the selected text itself, framed by the nearest lines, so it stays accurate
  // for unsaved drafts whose line numbers differ from the file on disk.
  function formatQuote({ name, sel, unsaved }) {
    const lines = sel.startLine === sel.endLine ? `${sel.startLine}` : `${sel.startLine}-${sel.endLine}`;
    const before = clip([sel.lineBefore, sel.linePrefix].filter(Boolean).join('\n'), 800, true);
    const after = clip([sel.lineSuffix, sel.lineAfter].filter(Boolean).join('\n'), 800, false);
    return [`<quote file="${attr(name)}" lines="${lines}"${unsaved ? ' status="unsaved draft"' : ''}>`,
      before && `<before>${before}</before>`, `<selection>${sel.text}</selection>`,
      after && `<after>${after}</after>`, '</quote>'].filter(Boolean).join('\n');
  }
  if (window.__agyEditsTestHooks) return { VERSION, decode, encode, clip, attr, formatQuote };
  if (window.__agyEditsTab) return window.__agyEditsTab.status();
  if (!window.__agyEditorCore) throw new Error('The editor component must load before Edits.');
  const drafts = new Map();
  const views = new Map();
  const pendingRecovery = new Map();
  const recoveryTimers = new Map();
  let recoverySequence = 0;
  const AUTOSAVE_DELAY = 800, RETRY_DELAY = 3000, SYNC_INTERVAL = 2000;
  const saveTimers = new Map();
  const abort = new AbortController();
  const listen = (el, event, handler, options = {}) =>
    el.addEventListener(event, handler, { ...options, signal: abort.signal });
  const dirty = entry => entry.loaded && entry.draft !== entry.baseText;
  const visible = el => el.isConnected && el.getClientRects().length > 0;
  function fileUri(header) {
    const crumbs = header.querySelectorAll('nav[aria-label="File path breadcrumbs"] [data-uri]');
    try {
      const url = new URL(crumbs[crumbs.length - 1]?.getAttribute('data-uri'));
      if (url.protocol !== 'file:') return null;
      url.hash = ''; return url.href;
    } catch { return null; }
  }
  function current(view) {
    return view.header.isConnected && visible(view.header) && fileUri(view.header) === view.uri;
  }
  const element = (tag, attrs = {}, text = '') => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    el.textContent = text;
    return el;
  };
  const style = element('style', { 'data-agy-edits': '' });
  style.textContent = `
    .agy-edits-host > .agy-edits-panel { display:none }
    .agy-edits-host.agy-edits-open > :not(.agy-edits-panel) { display:none !important }
    .agy-edits-host.agy-edits-open > .agy-edits-panel {
      display:flex; flex-direction:column; position:absolute; inset:0; z-index:5;
      background:var(--background, #181818); color:var(--foreground, #eeeeee);
      font:12px -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .agy-edits-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap;
      padding:6px 12px; border-bottom:1px solid var(--border); flex-shrink:0 }
    .agy-edits-status { flex:1; min-width:120px; font-size:11px; opacity:.65 }
    .agy-edits-status[data-error=true] { color:var(--error); opacity:1 }
    .agy-edits-action { background:transparent; color:inherit; border:1px solid var(--border);
      border-radius:5px; padding:3px 8px; cursor:pointer; font:inherit; line-height:18px }
    .agy-edits-action:disabled { opacity:.4; cursor:default }
    .agy-edits-action:hover:not(:disabled), .agy-edits-action[aria-pressed=true] {
      background:var(--secondary); color:var(--secondary-foreground) }
    .agy-edits-save, .agy-edits-save:hover:not(:disabled) {
      background:var(--primary); color:var(--primary-foreground); border-color:transparent }
    .agy-edits-code { flex:1; min-height:0; overflow:hidden }
    .agy-edits-conflict { display:flex; gap:6px }
    .agy-edits-history { display:flex; gap:2px }
    .agy-edits-icon { display:flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0;
      border:0; border-radius:5px; background:transparent; color:inherit; cursor:pointer; opacity:.75 }
    .agy-edits-icon:hover:not(:disabled) { background:var(--secondary); opacity:1 }
    .agy-edits-icon:disabled { opacity:.3; cursor:default }
    .agy-edits-conflict[hidden] { display:none }
    .agy-edits-tab { cursor:pointer; border:0; box-shadow:none !important }
    .agy-edits-tabs-active > :not(.agy-edits-tab) { background:transparent !important }
    .agy-edits-tab[aria-pressed=true] { background:var(--secondary) !important;
      color:var(--secondary-foreground, var(--foreground)) !important; opacity:1 }
    [data-agy-edit-modes] > button { font-size:12px; line-height:16px; padding:4px 8px; border:0 }
    .agy-edits-footer { padding:4px 12px; border-top:1px solid var(--border);
      color:var(--muted-foreground); font-size:10px }
    .agy-edits-footer[data-error=true] { color:var(--error) }
    .agy-edits-selection { position:absolute; z-index:50; width:max-content }
    .agy-edits-selection[hidden], .agy-edits-composer[hidden] { display:none }
    .agy-edits-selection button:disabled { opacity:.45; cursor:default; background:transparent }
    .agy-edits-composer { position:absolute; z-index:50; width:min(360px, calc(100% - 24px));
      display:flex; flex-direction:column; gap:6px; padding:8px; border-radius:8px;
      background:var(--card, var(--background)); color:var(--foreground);
      border:1px solid var(--card-border, var(--border)); box-shadow:0 4px 16px rgb(0 0 0 / .15) }
    .agy-edits-composer textarea { resize:vertical; min-height:56px; padding:6px 8px; border-radius:5px;
      font:inherit; color:inherit; background:var(--background); border:1px solid var(--border); outline:none }
    .agy-edits-composer textarea:focus { border-color:var(--primary) }
    .agy-edits-composer textarea::placeholder { color:var(--placeholder, var(--muted-foreground)) }
    .agy-edits-composer-actions { display:flex; justify-content:flex-end; gap:6px }
  `;
  // Read the host's actual type metrics so app zoom and theme remain consistent.
  function syncAppearance() {
    for (const header of document.querySelectorAll('[aria-label="File Viewer header"]')) {
      const tab = header.querySelector('.agy-edits-tab');
      if (!tab) continue;
      const native = [...header.querySelectorAll('button, [role="button"]')]
        .find(el => el !== tab && el.textContent.trim() === 'Raw');
      if (native) {
        const computed = getComputedStyle(native);
        for (const property of ['font-family','font-size','font-weight','line-height','padding-top','padding-bottom','padding-left','padding-right','border-radius'])
          tab.style.setProperty(property, computed.getPropertyValue(property));
      }
    }
  }
  document.head.append(style);

  async function rpc(method, body) {
    if (!window.__APP_CONFIG__?.csrfToken) throw new Error('File service unavailable. Reattach Edits after reloading Antigravity.');
    const response = await fetch(`/exa.language_server_pb.LanguageServerService/${method}`, {
      method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': window.__APP_CONFIG__.csrfToken },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`File service returned ${response.status}. Your draft is retained.`);
    return response.json();
  }
  async function read(uri) {
    const result = await rpc('ReadFile', { uri, userInitiated: true });
    return result.content || '';
  }
  function entryFor(uri) {
    if (!drafts.has(uri)) {
      const entry = { uri, loaded:false, loading:false, saving:false, draft:'', baseText:'',
        baseline:'', eol:'\n', bom:false, message:'', error:false, conflict:false,
        position:{anchor:0,head:0,scrollTop:0,scrollLeft:0}, revision:0, recovered:false,
        recovery:'clean', recoveryError:'', lastPersisted:0 };
      const stored = window.__agyEditsRecovery?.[uri];
      if (stored && typeof stored.draft === 'string' && typeof stored.baseline === 'string') {
        try {
          const base = decode(stored.baseline);
          Object.assign(entry, { baseline:stored.baseline, baseText:base.text, draft:stored.draft,
            eol:base.eol, bom:base.bom, position:stored.position || entry.position,
            loaded:stored.draft !== base.text, recovered:stored.draft !== base.text,
            recovery:'stored' });
        } catch { entry.message = 'Stored draft could not be read. The recovery copy has been kept.'; entry.error = true; }
      }
      drafts.set(uri, entry);
    }
    return drafts.get(uri);
  }
  function persist(entry) {
    clearTimeout(recoveryTimers.get(entry.uri)); recoveryTimers.delete(entry.uri);
    if (!entry.loaded) return;
    if (typeof window.__agyEditsPersist !== 'function') {
      entry.recovery = 'error'; entry.recoveryError = 'Draft recovery is disconnected. Save your file before closing.';
      renderUri(entry.uri); return;
    }
    const requestId = `${Date.now()}-${++recoverySequence}`;
    const revision = entry.revision;
    entry.recovery = 'pending';
    const timeout = setTimeout(() => {
      if (!pendingRecovery.has(requestId)) return;
      pendingRecovery.delete(requestId);
      if (entry.revision === revision) {
        entry.recovery = 'error'; entry.recoveryError = 'Draft recovery is disconnected. Save your file before closing.';
        renderUri(entry.uri);
      }
    }, 10000);
    pendingRecovery.set(requestId, { entry, revision, timeout });
    try {
      window.__agyEditsPersist(JSON.stringify({ type:'put', uri:entry.uri, requestId,
        entry:{baseline:entry.baseline, draft:entry.draft, eol:entry.eol, bom:entry.bom,
          position:entry.position, clientId:window.__agyEditsClientId} }));
    } catch {
      clearTimeout(timeout); pendingRecovery.delete(requestId);
      entry.recovery = 'error'; entry.recoveryError = 'Could not store the recovery draft. Save your file before closing.';
    }
    renderUri(entry.uri);
  }
  function queueRecovery(entry, delay = 200) {
    entry.revision++; entry.recovery = 'pending'; entry.recoveryError = '';
    clearTimeout(recoveryTimers.get(entry.uri));
    recoveryTimers.set(entry.uri, setTimeout(() => persist(entry), delay));
  }
  window.__agyEditsPersistAck = (requestId, ok, error) => {
    const pending = pendingRecovery.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout); pendingRecovery.delete(requestId);
    const { entry, revision } = pending;
    if (entry.revision !== revision) return;
    entry.recovery = ok ? 'stored' : 'error';
    entry.recoveryError = ok ? '' : (error || 'Could not store the recovery draft.');
    if (ok) entry.lastPersisted = revision;
    renderUri(entry.uri);
  };
  function remember(view) {
    if (!view.uri || view.editorUri !== view.uri || !view.open || !visible(view.host) || !current(view)) return;
    const entry = entryFor(view.uri);
    const position = view.editor.getPosition();
    if (JSON.stringify(entry.position) !== JSON.stringify(position)) {
      entry.position = position; queueRecovery(entry, 500);
    }
  }
  function show(view) {
    if (!view.uri) return;
    const entry = entryFor(view.uri);
    const state = entry.loading ? 'Loading…' : entry.conflict || entry.error ? entry.message :
      entry.saving || dirty(entry) ? 'Saving…' : 'Saved';
    view.status.textContent = state;
    view.status.title = state === 'Saved' ? 'Saved and verified on disk' : '';
    view.conflict.hidden = !entry.conflict;
    updateHistory(view);
    view.status.dataset.error = String(entry.error);
    view.footer.dataset.error = String(!!view.notice?.error);
    view.footer.textContent = view.notice ? view.notice.text : entry.recovery === 'error' ? entry.recoveryError :
      'Changes save automatically · ⌘F Find · ⌥⌘F Replace · Select text to Comment or Quote';
    view.editor.setReadOnly(!entry.loaded || entry.loading);
    view.tab.textContent = dirty(entry) && (entry.conflict || entry.error) ? 'Edits *' : 'Edits';
    if (view.editorUri !== view.uri || view.editor.text !== entry.draft) {
      const position = entry.position;
      view.editorUri = view.uri;
      view.editor.setDocument({uri:view.uri, text:entry.draft, selection:position,
        scrollTop:position.scrollTop, scrollLeft:position.scrollLeft,
        scrollAnchor:position.scrollAnchor, scrollOffset:position.scrollOffset});
    }
  }
  function updateHistory(view) {
    const { undo, redo } = view.editor.history;
    view.undo.disabled = !undo || !current(view);
    view.redo.disabled = !redo || !current(view);
  }
  // Material Symbols undo/redo glyphs, matching the app's icon set.
  function historyButton(label, path) {
    const button = element('button', { type:'button', class:'agy-edits-icon', title:label, 'aria-label':label });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width:'16', height:'16', viewBox:'0 -960 960 960', fill:'currentColor', 'aria-hidden':'true' })) svg.setAttribute(key, value);
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path); svg.append(shape); button.append(svg);
    return button;
  }
  function renderUri(uri) { for (const view of views.values()) if (view.uri === uri) show(view); }
  async function load(entry, force = false) {
    if (entry.loading || entry.saving || (entry.loaded && !force)) return;
    entry.loading = true; entry.error = false; entry.message = ''; renderUri(entry.uri);
    try {
      const baseline = await read(entry.uri);
      const value = decode(baseline);
      Object.assign(entry, { baseline, baseText:value.text, draft:value.text, eol:value.eol,
        bom:value.bom, loaded:true, recovered:false, conflict:false, message:'Saved' });
      queueRecovery(entry);
    } catch (error) { entry.error = true; entry.message = error.message; }
    finally { entry.loading = false; renderUri(entry.uri); }
  }
  // Autosave: edits are written shortly after typing pauses, with read-before-write conflict
  // detection and read-back verification. A failed write retries; a conflict waits for a choice.
  function scheduleSave(entry, delay = AUTOSAVE_DELAY) {
    clearTimeout(saveTimers.get(entry.uri)); saveTimers.delete(entry.uri);
    if (!entry.loaded || entry.conflict || !dirty(entry)) return;
    saveTimers.set(entry.uri, setTimeout(() => { saveTimers.delete(entry.uri); save(entry); }, delay));
  }
  async function write(entry) {
    const text = entry.draft;
    try {
      const content = encode(text, entry);
      if (await read(entry.uri) !== entry.baseline) {
        entry.conflict = true;
        throw new Error('File changed on disk while you were editing.');
      }
      await rpc('WriteFile', { uri:entry.uri, content, overwrite:true });
      if (await read(entry.uri) !== content) throw new Error('Save could not be verified. Retrying…');
      entry.baseline = content; entry.baseText = text; entry.recovered = false;
      queueRecovery(entry);
    } catch (error) {
      entry.error = true;
      entry.message = entry.conflict || error.message.endsWith('Retrying…') ? error.message : `${error.message} Retrying…`;
    }
  }
  function save(entry) {
    if (entry.saving) { entry.saveAgain = true; return entry.saving; }
    clearTimeout(saveTimers.get(entry.uri)); saveTimers.delete(entry.uri);
    if (!entry.loaded || entry.loading || entry.conflict || !dirty(entry)) return Promise.resolve();
    entry.error = false; entry.message = '';
    entry.saving = write(entry).finally(() => {
      const again = entry.saveAgain;
      entry.saving = null; entry.saveAgain = false;
      if (entry.error && !entry.conflict) scheduleSave(entry, RETRY_DELAY);
      else if (dirty(entry)) scheduleSave(entry, again ? 0 : AUTOSAVE_DELAY);
      renderUri(entry.uri);
    });
    renderUri(entry.uri);
    return entry.saving;
  }
  // Conflict choices: take the disk version, or write this draft over it.
  function useDisk(entry) { entry.conflict = false; entry.error = false; load(entry, true); }
  async function keepMine(entry) {
    try {
      const disk = await read(entry.uri), value = decode(disk);
      Object.assign(entry, { baseline:disk, baseText:value.text, eol:value.eol, bom:value.bom, conflict:false, error:false, message:'' });
      save(entry);
    } catch (error) { entry.error = true; entry.message = error.message; renderUri(entry.uri); }
  }
  // While Edits shows a file with no pending edits, pick up changes made by agents or other apps.
  async function syncFromDisk(view) {
    const entry = entryFor(view.uri);
    if (!entry.loaded || entry.loading || entry.saving || entry.conflict || entry.syncing || dirty(entry)) return;
    entry.syncing = true;
    try {
      const revision = entry.revision, disk = await read(entry.uri);
      if (disk === entry.baseline || dirty(entry) || entry.saving || entry.revision !== revision) return;
      const value = decode(disk);
      Object.assign(entry, { baseline:disk, baseText:value.text, draft:value.text, eol:value.eol, bom:value.bom, recovered:false });
      queueRecovery(entry);
      notice(view, 'Updated with changes made outside Edits.');
    } catch { /* A transient read failure is retried on the next interval. */ }
    finally { entry.syncing = false; }
  }
  // Comment and Quote reuse Antigravity's own comment store and chat input, found through the
  // React tree above the file viewer. These are internal interfaces; failures are reported.
  function appContext(view) {
    const key = Object.keys(view.host).find(name => name.startsWith('__reactFiber$'));
    const found = {};
    for (let fiber = key && view.host[key]; fiber; fiber = fiber.return) {
      const value = fiber.memoizedProps?.value;
      if (value && typeof value === 'object') {
        if (found.scope === undefined && 'scopeToken' in value) found.scope = value.scopeToken;
        if (!found.registry && typeof value.getActiveEditor === 'function' && !value.isNoop) found.registry = value;
      }
      if (!found.store && typeof fiber.memoizedProps?.store?.dispatch === 'function') found.store = fiber.memoizedProps.store;
    }
    return found;
  }
  function notice(view, text, error = false) {
    clearTimeout(view.noticeTimer);
    view.notice = { text, error };
    view.noticeTimer = setTimeout(() => { view.notice = null; show(view); }, error ? 8000 : 5000);
    show(view);
  }
  function quoteText(view, sel) {
    return formatQuote({ name:decodeURIComponent(new URL(view.uri).pathname.split('/').pop()), sel, unsaved:dirty(entryFor(view.uri)) });
  }
  function quote(view) {
    const sel = current(view) && view.editor.selection();
    if (!sel) return;
    const chat = appContext(view).registry?.getActiveEditor();
    const Mention = chat?._nodes?.get('beautifulMention'), Text = chat?._nodes?.get('text')?.klass;
    if (typeof Mention?.replace !== 'function' || !Text) return notice(view, 'Quote is unavailable: the chat input was not found.', true);
    const data = JSON.stringify({ textBlock: {
      fileLineRange: { absoluteUri:view.uri, startLine:sel.startLine - 1, endLine:sel.endLine - 1 },
      content: quoteText(view, sel) } });
    try {
      chat.update(() => {
        const state = chat._pendingEditorState;
        let target = state._selection;
        if (typeof target?.insertNodes !== 'function' || !target.isCollapsed?.()) target = state._nodeMap.get('root').selectEnd();
        target.insertNodes([Mention.replace(new Mention.klass('@', 'contextScopeItemMention', { data })), new Text(' ')]);
      }, { discrete:true });
    } catch { return notice(view, 'Quote could not be added to the chat input.', true); }
    hideSelection(view);
    chat.focus();
  }
  async function openComposer(view) {
    let sel = current(view) && view.editor.selection();
    if (!sel) return;
    const entry = entryFor(view.uri);
    // Comments point to saved lines, so finish any pending autosave first.
    if (dirty(entry)) { await save(entry); sel = current(view) && view.editor.selection(); }
    if (!sel || dirty(entry)) return notice(view, 'The file could not be saved, so comments are unavailable until it is.', true);
    view.pendingComment = { uri:view.uri, sel };
    hideSelection(view);
    view.composer.hidden = false;
    view.composerInput.value = '';
    place(view, view.composer, sel.rect);
    view.composerInput.focus();
  }
  function closeComposer(view, refocus = true) {
    if (view.composer.hidden) return;
    view.composer.hidden = true; view.pendingComment = null;
    if (refocus && view.open) view.editor.focus();
  }
  function submitComment(view) {
    const pending = view.pendingComment, comment = view.composerInput.value.trim();
    if (!pending || !comment) return;
    if (!current(view) || view.uri !== pending.uri || dirty(entryFor(view.uri))) {
      closeComposer(view);
      return notice(view, 'The file changed before the comment was added. Save, then select the text again.', true);
    }
    const { store, scope } = appContext(view);
    if (!store || scope === undefined) return notice(view, 'Comments are unavailable in this window.', true);
    const { sel } = pending;
    store.dispatch({ type:'comments/addFileComment', payload:{ fileUri:view.uri, scope,
      commentId:`${view.uri}-${crypto.randomUUID()}`,
      selection:{ $typeName:'exa.codeium_common_pb.TextSelection', startLine:sel.startLine - 1, endLine:sel.endLine, content:sel.text },
      comment, initialPositioning:{ startLine:sel.startLine, endLine:sel.endLine, beforeText:sel.textBefore,
        afterText:sel.textAfter, textSelection:sel.text, hasLineNumbers:true } } });
    closeComposer(view);
    notice(view, 'Comment added. It shows in Raw and Preview and goes with your next message.');
  }
  // Positions a floating element below the selection end, or above it near the panel bottom.
  function place(view, el, rect) {
    const panel = view.panel.getBoundingClientRect(), code = view.code.getBoundingClientRect();
    const width = el.offsetWidth, height = el.offsetHeight;
    let top = rect.bottom - panel.top + 6;
    if (rect.bottom + 6 + height > code.bottom) top = rect.top - panel.top - height - 6;
    el.style.left = `${Math.max(8, Math.min(rect.left - panel.left, panel.width - width - 8))}px`;
    el.style.top = `${Math.max(code.top - panel.top + 4, top)}px`;
  }
  function hideSelection(view) { view.selectionPopup.hidden = true; }
  function updateSelection(view) {
    const entry = view.uri && entryFor(view.uri);
    const sel = view.open && current(view) && entry?.loaded && view.composer.hidden && view.editor.hasFocus && view.editor.selection();
    const code = view.code.getBoundingClientRect();
    if (!sel?.rect || sel.rect.bottom < code.top || sel.rect.top > code.bottom) return hideSelection(view);
    view.commentButton.disabled = entry.conflict;
    view.commentButton.title = entry.conflict ? 'Resolve the file conflict to comment.' : 'Comment on selection (⌥⌘M)';
    view.selectionPopup.hidden = false;
    place(view, view.selectionPopup, sel.rect);
  }
  function selectionUi(view) {
    const pillButton = 'flex items-center gap-1 justify-center px-2 py-1 transition-colors cursor-pointer hover:bg-secondary text-xs';
    const action = (label, shortcut, extra = '') => {
      const button = element('button', { type:'button', class:`${pillButton} ${extra}` });
      button.append(element('span', { class:'text-xs' }, label), element('span', { class:'text-xs opacity-50' }, shortcut));
      return button;
    };
    const popup = element('div', { class:'agy-edits-selection selection-popup shadow rounded-md overflow-visible', 'data-find-ignore':'true', hidden:'' });
    const pill = element('div', { class:'agy-selection-pill surface-glass flex rounded-md bg-muted text-foreground border border-border shadow-sm overflow-hidden' });
    const commentButton = action('Comment', '⌥⌘M');
    const quoteButton = action('Quote', '⌘L', 'border-l border-border');
    quoteButton.title = 'Quote selection in chat (⌘L)';
    pill.append(commentButton, quoteButton); popup.append(pill);
    const composer = element('form', { class:'agy-edits-composer', 'data-find-ignore':'true', hidden:'' });
    const composerInput = element('textarea', { placeholder:'Write a comment...', 'aria-label':'Comment', rows:'3' });
    const actions = element('div', { class:'agy-edits-composer-actions' });
    const cancel = element('button', { type:'button', class:'agy-edits-action' }, 'Cancel');
    const submit = element('button', { type:'submit', class:'agy-edits-action agy-edits-save' }, 'Comment');
    actions.append(cancel, submit); composer.append(composerInput, actions);
    return { popup, commentButton, quoteButton, composer, composerInput, cancel };
  }
  function setOpen(view, value) {
    if (value && !current(view)) return;
    if (!value) { remember(view); hideSelection(view); closeComposer(view, false); if (view.uri) save(entryFor(view.uri)); }
    view.open = value;
    view.host.classList.toggle('agy-edits-open', value);
    view.tabs.classList.toggle('agy-edits-tabs-active', value);
    view.tab.setAttribute('aria-pressed', String(value));
    if (value) syncAppearance();
    if (value && view.uri) {
      const entry = entryFor(view.uri);
      load(entry, !dirty(entry)).then(() => {
        scheduleSave(entry);
        if (view.open && view.uri === entry.uri && entry.loaded) {
          const position = entry.position;
          view.editor.setDocument({uri:entry.uri,text:entry.draft,selection:position,
            scrollTop:position.scrollTop,scrollLeft:position.scrollLeft,
            scrollAnchor:position.scrollAnchor,scrollOffset:position.scrollOffset});
          view.editor.focus();
        }
      });
      show(view);
    }
  }
  function attach(header, scope, host, tabs, raw, ownTabs = false) {
    const tab = element('button', { type:'button', class:`${raw.className} agy-edits-tab`,
      'aria-pressed':'false', title:'Edit this file directly. Save with Cmd+S.' }, 'Edits');
    const panel = element('section', { class:'agy-edits-panel', 'aria-label':'File editor', 'data-find-ignore':'true' });
    const toolbar = element('div', { class:'agy-edits-toolbar' });
    const status = element('span', { class:'agy-edits-status', role:'status', 'aria-live':'polite' });
    const conflict = element('div', { class:'agy-edits-conflict', hidden:'' });
    const useDiskButton = element('button', { type:'button', class:'agy-edits-action', title:'Discard your edits and show the file as it is on disk' }, 'Use disk version');
    const keepMineButton = element('button', { type:'button', class:'agy-edits-action agy-edits-save', title:'Write your version over the disk changes' }, 'Keep mine');
    conflict.append(useDiskButton, keepMineButton);
    const history = element('div', { class:'agy-edits-history' });
    const undoButton = historyButton('Undo (⌘Z)', 'M280-200v-80h284q63 0 109.5-40T720-420q0-60-46.5-100T564-560H312l104 104-56 56-200-200 200-200 56 56-104 104h252q97 0 166.5 63T800-420q0 94-69.5 157T564-200H280Z');
    const redoButton = historyButton('Redo (⇧⌘Z)', 'M396-200q-97 0-166.5-63T160-420q0-94 69.5-157T396-640h252L544-744l56-56 200 200-200 200-56-56 104-104H396q-63 0-109.5 40T240-420q0 60 46.5 100T396-280h284v80H396Z');
    history.append(undoButton, redoButton);
    const search = element('button', { type:'button', class:'agy-edits-action', title:'Find (⌘F) · Replace (⌥⌘F)', 'aria-pressed':'false' }, 'Find');
    const mount = element('div', {class:'agy-edits-code'});
    const footer = element('div', {class:'agy-edits-footer'});
    const ui = selectionUi();
    toolbar.append(status, conflict, history, search);
    panel.append(toolbar, mount, footer, ui.popup, ui.composer);
    host.classList.add('agy-edits-host'); host.append(panel); tabs.append(tab);
    const view = { header, scope, host, tabs, tab, panel, status, footer, conflict, undo:undoButton, redo:redoButton,
      uri:null, editorUri:null, open:false, ownTabs, editor:null, code:mount, notice:null,
      selectionPopup:ui.popup, commentButton:ui.commentButton, composer:ui.composer,
      composerInput:ui.composerInput, pendingComment:null };
    view.editor = window.__agyEditorCore.create({parent:mount,
      onSelection() { updateSelection(view); updateHistory(view); },
      onSearch(open) { search.setAttribute('aria-pressed', String(open)); },
      onChange(text) {
        if (!view.editorUri) return;
        const entry = entryFor(view.editorUri); entry.draft = text;
        if (!entry.conflict) { entry.message = ''; entry.error = false; }
        queueRecovery(entry); scheduleSave(entry); queueMicrotask(() => renderUri(entry.uri));
        if (!current(view)) setOpen(view,false);
      },
      onPosition(position) {
        if (!current(view) || !view.open || !view.uri) return;
        const entry = entryFor(view.uri);
        if (!entry.loaded || entry.loading) return;
        if (JSON.stringify(entry.position) !== JSON.stringify(position)) {
          entry.position = position; queueRecovery(entry,500);
        }
      },
      onSave() { if (current(view)) { remember(view); save(entryFor(view.uri)); } }
    });
    views.set(header, view);
    listen(tab, 'click', () => setOpen(view, true));
    listen(tabs, 'click', event => {
      const button = event.target.closest('button, [role="button"]');
      if (button && button !== tab && ['Preview','Raw'].includes(button.textContent.trim())) setOpen(view, false);
    });
    // Keep the editor selection while the popup is clicked.
    for (const type of ['mousedown', 'pointerdown']) listen(ui.popup, type, event => event.preventDefault(), {capture:true});
    listen(ui.commentButton, 'click', () => openComposer(view));
    listen(ui.quoteButton, 'click', () => quote(view));
    listen(ui.cancel, 'click', () => closeComposer(view));
    listen(ui.composer, 'submit', event => { event.preventDefault(); submitComment(view); });
    listen(ui.composerInput, 'keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeComposer(view); }
      else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitComment(view); }
    });
    listen(search, 'click', () => view.editor.toggleSearch());
    for (const type of ['mousedown', 'pointerdown']) listen(history, type, event => event.preventDefault(), {capture:true});
    listen(undoButton, 'click', () => { if (current(view)) view.editor.undo(); });
    listen(redoButton, 'click', () => { if (current(view)) view.editor.redo(); });
    listen(useDiskButton, 'click', () => { if (current(view)) useDisk(entryFor(view.uri)); });
    listen(keepMineButton, 'click', () => { if (current(view)) keepMine(entryFor(view.uri)); });
    return view;
  }
  function cleanupView(view) {
    remember(view); clearTimeout(view.noticeTimer); view.editor.destroy();
    view.tab.remove(); view.panel.remove();
    view.host.classList.remove('agy-edits-host', 'agy-edits-open');
    view.tabs.classList.remove('agy-edits-tabs-active');
    if (view.ownTabs) view.tabs.remove();
  }
  function scan() {
    for (const [header, view] of views) {
      if (!header.isConnected || !view.host.isConnected || !view.tab.isConnected || !view.panel.isConnected) {
        cleanupView(view); views.delete(header);
      }
    }
    for (const header of document.querySelectorAll('[aria-label="File Viewer header"]')) {
      if (!visible(header)) continue;
      const scope = header.closest('[data-side-panel-focus-scope="true"]');
      const host = scope?.querySelector('div[aria-label="File Viewer"][tabindex="0"]');
      const buttons = [...header.querySelectorAll('button, [role="button"]')];
      let raw = buttons.find(el => el.textContent.trim() === 'Raw');
      let tabs = raw?.parentElement;
      const uri = fileUri(header);
      if (!host || !uri) { if (views.has(header)) setOpen(views.get(header), false); continue; }
      let ownTabs = false;
      if (!tabs) {
        if (!host.querySelector('.file-viewer-root')) continue;
        const actions = header.lastElementChild;
        if (!actions) continue;
        tabs = element('div', { class:'flex gap-1 rounded-md border p-0.5', 'data-agy-edit-modes':'' });
        raw = element('button', { type:'button', class:'agy-edits-action' }, 'Raw');
        tabs.append(raw); actions.prepend(tabs); ownTabs = true;
      }
      const view = views.get(header) || attach(header, scope, host, tabs, raw, ownTabs);
      if (view.uri !== uri) {
        remember(view);
        if (view.uri) save(entryFor(view.uri));
        view.uri = uri;
        if (view.open) setOpen(view, true);
        show(view);
      }
    }
    syncAppearance();
  }
  let timer;
  const observer = new MutationObserver(() => {
    for (const view of views.values()) if (view.open && !current(view)) {
      view.editor.setReadOnly(true);
    }
    if (!timer) timer = setTimeout(() => { timer = null; scan(); }, 100);
  });
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-uri'] });
  // Handle editor shortcuts before Antigravity's document-level file-viewer keys.
  // Cmd+L quotes and Option+Cmd+M comments (the app's own secondary binding; plain C must type).
  listen(window, 'keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
    const action = event.altKey ? ({ KeyM:'comment', KeyF:'replace' })[event.code] :
      ({ f:'find', s:'save', l:'quote' })[event.key.toLowerCase()];
    if (!action) return;
    const view = [...views.values()].find(item => item.open && item.panel.contains(event.target));
    if (!view || !current(view)) return;
    if ((action === 'quote' || action === 'comment') && !(view.editor.hasFocus && view.editor.selection())) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (action === 'find' || action === 'replace') view.editor.openSearch({ replace: action === 'replace' });
    else if (action === 'save') { remember(view); save(entryFor(view.uri)); }
    else if (action === 'quote') quote(view);
    else openComposer(view);
  }, {capture:true});
  listen(window, 'beforeunload', event => {
    for (const view of views.values()) remember(view);
    for (const uri of recoveryTimers.keys()) persist(drafts.get(uri));
    for (const entry of drafts.values()) save(entry);
    if ([...drafts.values()].some(entry => entry.saving || (dirty(entry) && entry.recovery !== 'stored'))) {
      event.preventDefault(); event.returnValue = '';
    }
  });
  const syncTimer = setInterval(() => {
    if (document.hidden) return;
    for (const view of views.values()) if (view.open && view.uri && current(view)) syncFromDisk(view);
  }, SYNC_INTERVAL);
  const status = () => ({ version:VERSION, installed:true, attached:views.size,
    editors:views.size, dirty:[...drafts.values()].filter(dirty).length,
    recoveryPending:pendingRecovery.size + recoveryTimers.size,
    recoveryErrors:[...drafts.values()].filter(entry=>entry.recovery==='error').length });
  window.__agyEditsTab = {
    status,
    remove() {
      if ([...drafts.values()].some(entry => dirty(entry) || entry.saving))
        return { removed:false, refused:true, dirty:[...drafts.values()].filter(dirty).length };
      observer.disconnect(); clearTimeout(timer); clearInterval(syncTimer); abort.abort();
      for (const pending of saveTimers.values()) clearTimeout(pending);
      for (const view of views.values()) cleanupView(view);
      for (const uri of recoveryTimers.keys()) persist(drafts.get(uri));
      style.remove(); delete window.__agyEditsTab;
      return { removed:true };
    }
  };
  scan();
  return status();
})();
