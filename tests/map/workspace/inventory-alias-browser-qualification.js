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
    return Boolean(state.sourceIndex && state.refreshStackNavigation);
  }, null, { timeout: 5000 });
  const search = page.locator('#stack-search'), tree = page.locator('#stack-tree');
  // Manifest counts and the actual paginated hierarchy own full inventory.
  // The resident sourceIndex intentionally retains only a bounded working set.
  await search.fill(''); await search.dispatchEvent('input');
  await page.waitForFunction(count => document.querySelectorAll('#stack-tree > details').length === count, expected.nodes.length);
  const paths = await tree.locator(':scope > details > summary').allTextContents();
  assert.deepEqual(paths.map(value => value.split(' · ')[0]).sort(), expected.nodes.map(file => file.path).sort());
  const counts = await page.evaluate(async () => (await import('/isomap/state.js')).state.sourceIndex.counts);
  assert.equal(counts.files, expected.nodes.length);
  assert.equal(counts.members, expected.nodes.reduce((sum, file) => sum + file.members.length, 0));
  receipt.observations = { files: [], aliases: [], available: counts, inventoryOwner: 'actual hierarchy pages and pinned manifest' };
  const selectionValue = label => page.locator('#selection-body .sel-row').filter({ has: page.locator('.sel-label', { hasText: label }) }).locator('.sel-value');
  for (const node of expected.nodes) {
    await search.fill(node.path);
    const group = tree.locator(':scope > details').filter({ has: page.locator('summary', { hasText: node.path + ' · ' }) });
    await group.waitFor();
    await group.getByRole('button', { name: 'Inspect / focus stack', exact: true }).click();
    await page.waitForFunction(file => {
      const rows = [...document.querySelectorAll('#selection-body .sel-row')];
      return rows.some(row => row.querySelector('.sel-label')?.textContent === 'Path' && row.querySelector('.sel-value')?.textContent === file);
    }, node.path);
    assert.equal(await selectionValue('Members').textContent(), String(node.members.length));
    await group.locator('summary').click();
    await page.waitForFunction(({ file, count }) => [...document.querySelectorAll('#stack-tree > details')]
      .find(row => row.querySelector('summary')?.textContent.startsWith(file + ' · '))?.textContent.includes(`of ${count} available members.`),
    { file: node.path, count: node.members.length });
    const memberButtons = group.locator('section button');
    assert.equal(await memberButtons.count(), node.members.length);
    receipt.observations.files.push({ path: node.path, members: node.members.length, hierarchy: true });
    for (const member of node.members) {
      await memberButtons.filter({ hasText: member.name + ' · ' }).click();
      await page.waitForFunction(async id => Boolean((await import('/isomap/state.js')).state.sourceIndex.member(id)), member.id);
      const actual = await page.evaluate(async id => (await import('/isomap/state.js')).state.sourceIndex.member(id).member, member.id);
      assert.equal(actual.id, member.id);
      const labels = member.dataflow?.aliases || []; assert.deepEqual(actual.dataflow?.aliases || [], labels);
      if (!labels.length) continue;
      assert.deepEqual(await selectionValue('Aliases').locator('.sel-pill').allTextContents(), labels);
      const contribution = await page.evaluate(async id => {
        const { state } = await import('/isomap/state.js');
        const { scoreMember } = await import('/isomap/layout-utils.js');
        const { scoringDefaults } = await import('/isomap/defaults.js');
        const value = state.sourceIndex.member(id).member;
        const baseline = scoreMember({ ...value, dataflow: { ...value.dataflow, aliases: [] } }, scoringDefaults);
        return { actual: scoreMember(value, scoringDefaults) - baseline, expected: value.dataflow.aliases.length * scoringDefaults.dataflow };
      }, member.id);
      assert.ok(Math.abs(contribution.actual - contribution.expected) < 1e-9);
      receipt.observations.aliases.push({ id: member.id, labels, contribution: contribution.actual });
    }
  }
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
