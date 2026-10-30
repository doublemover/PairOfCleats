import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';

// Manual actual-browser companion. Every prerequisite is supplied explicitly;
// absent browser/module/pinned map/server is an error, never a qualified skip.
const args = process.argv.slice(2);
assert.equal(args.length % 2, 0, 'Expected --name value pairs.');
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) =>
  [args[index * 2].replace(/^--/, ''), args[index * 2 + 1]]));
for (const key of ['url', 'map', 'playwright', 'chromium', 'out']) assert.ok(options[key], 'Required --' + key);
const url = new URL(options.url);
assert.ok(['http:', 'https:'].includes(url.protocol));
await requireBootstrap();
const sourcePath = path.resolve(options.map), bytes = await fs.readFile(sourcePath), expected = JSON.parse(bytes);
assert.ok(expected.nodes.some(file => file.members?.length === 0), 'Supply the actual exported inventory fixture.');
assert.ok(expected.nodes.some(file => file.members?.some(member => member.dataflow?.aliases?.length > 3)),
  'Supply the actual producer/export fixture with more than three canonical or legacy aliases.');
const playwright = path.resolve(options.playwright), executable = path.resolve(options.chromium);
await fs.access(playwright); await fs.access(executable);
const { chromium } = await import(pathToFileURL(playwright).href);
const out = path.resolve(options.out); await fs.mkdir(out, { recursive: true });
const started = performance.now(), errors = [], receipt = { schemaVersion: 1,
  qualification: 'actual headless browser hierarchy/inspector/scoring; no hardware or frame-rate claim',
  source: { path: sourcePath, sha256: createHash('sha256').update(bytes).digest('hex') },
  url: url.href, node: process.version, platform: process.platform, status: 'failed', observations: null };
let browser, context, failure;
const deadline = setTimeout(() => { void context?.close(); }, 30000);
try {
  browser = await chromium.launch({ executablePath: executable, headless: true, timeout: 5000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 5000 });
  await page.waitForFunction(async () => {
    const { state } = await import('/isomap/state.js');
    return Boolean(state.sourceIndex?.files.size && state.refreshStackNavigation);
  }, null, { timeout: 5000 });
  receipt.observations = await page.evaluate(async expectedMap => {
    const { state } = await import('/isomap/state.js');
    const { renderSelectionDetails } = await import('/isomap/selection.js');
    const { scoreMember } = await import('/isomap/layout-utils.js');
    const { scoringDefaults } = await import('/isomap/defaults.js');
    const fail = message => { throw new Error(message); };
    const expectedFiles = expectedMap.nodes.map(file => file.path).sort();
    if (JSON.stringify([...state.sourceIndex.files.keys()].sort()) !== JSON.stringify(expectedFiles)) fail('Pinned file inventory mismatch.');
    const files = [], aliases = [];
    for (const node of expectedMap.nodes) {
      const actual = state.sourceIndex.files.get(node.path);
      if (JSON.stringify(actual.members.map(member => member.id)) !== JSON.stringify(node.members.map(member => member.id))) fail('Canonical member identity drift.');
      // Use the actual browser hierarchy search owner, including its async
      // worker route when enabled by the real viewer.
      document.getElementById('stack-search').value = node.path;
      document.getElementById('stack-search').dispatchEvent(new Event('input'));
      for (let attempt = 0; attempt < 100 && !document.getElementById('stack-tree').textContent.includes(node.path); attempt++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      if (!document.getElementById('stack-tree').textContent.includes(node.path)) fail('Inventory file absent from actual hierarchy.');
      renderSelectionDetails({ type: 'file', file: node.path });
      const rows = () => [...state.dom.selectionBody.querySelectorAll('.sel-row')];
      const value = label => rows().find(row => row.querySelector('.sel-label')?.textContent === label)?.querySelector('.sel-value');
      if (value('Members')?.textContent !== String(node.members.length)) fail('Inspector invented or lost a member.');
      files.push({ path: node.path, members: node.members.length, hierarchy: true });
      for (const member of actual.members) {
        const expectedMember = node.members.find(row => row.id === member.id);
        const labels = expectedMember.dataflow?.aliases || [];
        if (JSON.stringify(member.dataflow?.aliases || []) !== JSON.stringify(labels)) fail('Alias meaning drift.');
        if (!labels.length) continue;
        renderSelectionDetails({ type: 'member', id: member.id, file: node.path });
        const pills = [...value('Aliases').querySelectorAll('.sel-pill')].map(pill => pill.textContent);
        if (JSON.stringify(pills) !== JSON.stringify(labels)) fail('Inspector omitted aliases.');
        const baseline = scoreMember({ ...member, dataflow: { ...member.dataflow, aliases: [] } }, scoringDefaults);
        const contribution = scoreMember(member, scoringDefaults) - baseline;
        if (Math.abs(contribution - labels.length * scoringDefaults.dataflow) >= 1e-9) fail('Alias score drift.');
        aliases.push({ id: member.id, labels, contribution });
      }
    }
    return { files, aliases };
  }, expected);
  assert.deepEqual(errors, []);
  receipt.screenshot = path.join(out, 'inventory-alias-inspector.png');
  await page.screenshot({ path: receipt.screenshot });
  assert.ok(performance.now() - started < 30000, 'Original total work bound exceeded.');
  receipt.browser = browser.version(); receipt.status = 'passed';
} catch (error) { failure = error; receipt.error = { name: error.name, message: error.message }; }
finally {
  await context?.close(); await browser?.close(); clearTimeout(deadline);
  receipt.elapsedMs = performance.now() - started; receipt.pageErrors = errors;
  if (receipt.elapsedMs >= 30000) {
    receipt.status = 'failed'; failure ||= new Error('Browser qualification exceeded its original 30-second bound, including cleanup.');
  }
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
if (failure) throw failure;
console.log(JSON.stringify(receipt));
