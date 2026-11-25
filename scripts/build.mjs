#!/usr/bin/env node
// Builds plugin/editor.html: one self-contained page (the MCP Apps view) with the bundled script
// and styles inline, as Antigravity's default view CSP requires. Also writes the license notices.
// --check rebuilds in memory and fails if the committed output is out of date.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const path = relative => fileURLToPath(new URL(relative, root));
const check = process.argv.includes('--check');
// --debug builds a diagnostic view (src/debug.js) into --out=<file> and never touches plugin/.
const debugBuild = process.argv.includes('--debug');
const debugOut = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);

// Collects the license text of every npm package that ends up in the bundle.
async function notices(metafile) {
  const packages = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll('\\', '/'));
    if (match) packages.add(match[1]);
  }
  const sections = [];
  for (const name of [...packages].sort()) {
    const dir = path(`node_modules/${name}/`);
    const { version, license } = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const file = (await readdir(dir)).find(entry => /^(licen[cs]e|copying)(\.|$)/i.test(entry));
    const text = file ? (await readFile(join(dir, file), 'utf8')).trim().replace(/\r\n/g, '\n') : `License: ${license}`;
    sections.push(`${name}@${version} (${license})\n\n${text}`);
  }
  return [
    'Third-party software bundled in plugin/editor.html.',
    'The find bar and history icons are Material Symbols by Google, licensed under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0).',
    '@modelcontextprotocol/ext-apps is bundled from its app-with-deps build, which includes the MCP TypeScript SDK (MIT) and zod (MIT).',
    ...sections,
  ].join('\n\n' + '-'.repeat(72) + '\n\n') + '\n';
}

const result = await build({
  entryPoints: [path('src/main.js')],
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', minify: true,
  legalComments: 'none', write: false, metafile: true, outfile: path('plugin/editor.js'),
  // Prefer the browser builds of the MCP SDK packages.
  conditions: ['browser'],
  define: { EDITS_DEBUG: String(debugBuild) },
});
const script = result.outputFiles[0].text;
if (/<\/script/i.test(script)) throw new Error('The bundle contains "</script" and cannot be inlined.');
const css = await readFile(path('src/styles.css'), 'utf8');
const template = await readFile(path('src/editor.html'), 'utf8');
const html = template.split('/*STYLES*/').join(css.trim()).split('/*SCRIPT*/').join(
  `\n/* Edits (antigravity-inline-editor). Built from src/ with: npm run build. Licenses: THIRD_PARTY_LICENSES.txt */\n${script}`);

const outputs = {
  [path('plugin/editor.html')]: html,
  [path('plugin/THIRD_PARTY_LICENSES.txt')]: await notices(result.metafile),
};
if (Buffer.byteLength(html) > 10 * 1024 * 1024) throw new Error('editor.html exceeds the 10 MiB MCP Apps limit.');

if (debugBuild) {
  if (!debugOut) throw new Error('--debug needs --out=<file>.');
  await writeFile(debugOut, html);
  console.log(`Built a debug view at ${debugOut}.`);
} else if (check) {
  for (const [file, text] of Object.entries(outputs)) {
    if (await readFile(file, 'utf8').catch(() => '') !== text) {
      console.error(`${file.split(/[\\/]/).slice(-2).join('/')} is out of date. Run \`npm run build\` and commit the result.`);
      process.exit(1);
    }
  }
  console.log('plugin/ build output is up to date.');
} else {
  for (const [file, text] of Object.entries(outputs)) await writeFile(file, text);
  console.log(`Built plugin/editor.html (${Math.round(Buffer.byteLength(html) / 1024)} KB) and plugin/THIRD_PARTY_LICENSES.txt.`);
}
