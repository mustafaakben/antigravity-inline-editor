// Diagnostics for live debugging in Antigravity, compiled in only by `npm run build -- --debug`.
// Frames have no console access from outside, so entries go to the plugin server as a draft named
// __edits_debug__ (no server change or restart needed) and land in drafts.json.
/* global EDITS_DEBUG */
export const DEBUG = EDITS_DEBUG;
const entries = [];
let timer = 0, sink = null;
export function debugSink(fn) { sink = fn; }
export function debug(event, data) {
  if (!DEBUG) return;
  let detail;
  try { detail = JSON.stringify(data, (key, value) => typeof value === 'string' && value.length > 400 ? `${value.slice(0, 400)}…` : value); }
  catch { detail = String(data); }
  entries.push(`${new Date().toISOString()} ${event} ${detail ?? ''}`);
  if (entries.length > 300) entries.splice(0, entries.length - 300);
  clearTimeout(timer);
  timer = setTimeout(() => sink?.(entries.join('\n')).catch(() => {}), 300);
}
