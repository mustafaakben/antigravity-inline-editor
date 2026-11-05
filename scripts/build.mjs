#!/usr/bin/env node
// Builds dist/editor-core.bundle.js from runtime/editor-core.js and runtime/find-panel.js.
// --check rebuilds in memory and fails if the committed bundle is out of date.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const outfile = fileURLToPath(new URL('dist/editor-core.bundle.js', root));
const check = process.argv.includes('--check');

// Collects the license text of every npm package that ends up in the bundle.
async function notices(metafile) {
  const packages = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll('\\', '/'));
    if (match) packages.add(match[1]);
  }
  const sections = [];
  for (const name of [...packages].sort()) {
    const dir = fileURLToPath(new URL(`node_modules/${name}/`, root));
    const { version, license } = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const file = (await readdir(dir)).find(entry => /^(licen[cs]e|copying)(\.|$)/i.test(entry));
    const text = file ? (await readFile(join(dir, file), 'utf8')).trim().replace(/\r\n/g, '\n') : `License: ${license}`;
    sections.push(`${name}@${version} (${license})\n\n${text}`);
  }
  return [
    'Third-party software bundled in dist/editor-core.bundle.js.',
    'The find bar icons are Material Symbols by Google, licensed under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0).',
    ...sections,
  ].join('\n\n' + '-'.repeat(72) + '\n\n') + '\n';
}

const result = await build({
  entryPoints: [fileURLToPath(new URL('runtime/editor-core.js', root))],
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true,
  legalComments: 'inline', write: false, metafile: true, outfile,
  banner: { js: '/* antigravity-inline-editor: CodeMirror 6 editor bundle. Rebuild with: npm run build */' },
});
const outputs = {
  [outfile]: result.outputFiles[0].text,
  [fileURLToPath(new URL('dist/THIRD_PARTY_LICENSES.txt', root))]: await notices(result.metafile),
};

if (check) {
  for (const [file, text] of Object.entries(outputs)) {
    if (await readFile(file, 'utf8').catch(() => '') !== text) {
      console.error(`${file.split(/[\\/]/).slice(-2).join('/')} is out of date. Run \`npm run build\` and commit the result.`);
      process.exit(1);
    }
  }
  console.log('dist/ is up to date.');
} else {
  for (const [file, text] of Object.entries(outputs)) await writeFile(file, text);
  console.log(`Built dist/editor-core.bundle.js (${Math.round(outputs[outfile].length / 1024)} KB) and dist/THIRD_PARTY_LICENSES.txt.`);
}
