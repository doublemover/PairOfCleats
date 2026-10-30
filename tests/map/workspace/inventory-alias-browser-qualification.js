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
assert.equal(expected.nodes.length, 5, 'The inventory companion requires all five actual exported files.');
assert.equal(expected.nodes.reduce((sum, file) => sum + file.members.length, 0), 1);
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
    return Boolean(state.sourceIndex && state.remoteSource && state.graphWorkerReady && state.refreshStackNavigation && state.viewerShell);
  }, null, { timeout: 5000 });
  const search = page.locator('#stack-search'), tree = page.locator('#stack-tree');
  const toolbar = page.locator('#stack-bar'), inspector = page.locator('#hud');
  const openPanel = async name => {
    const trigger = toolbar.getByRole('button', { name, exact: true });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', `Open ${name} through its actual toolbar action.`);
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await (name === 'Explore' ? search : inspector).waitFor({ state: 'visible' });
  };
  await openPanel('Explore');
  // Manifest counts and the actual paginated hierarchy own full inventory.
  // The resident sourceIndex intentionally retains only a bounded working set.
  await search.fill(''); await search.dispatchEvent('input');
  await page.waitForFunction(count => document.querySelectorAll('#stack-tree > details').length === count, expected.nodes.length);
  const paths = await tree.locator(':scope > details > summary').allTextContents();
  assert.deepEqual(paths.map(value => value.split(' · ')[0]).sort(), expected.nodes.map(file => file.path).sort());
  const counts = await page.evaluate(async () => (await import('/isomap/state.js')).state.sourceIndex.counts);
  assert.equal(counts.files, expected.nodes.length);
  assert.equal(counts.members, expected.nodes.reduce((sum, file) => sum + file.members.length, 0));
  assert.equal(counts.edges, expected.edges.length);
  receipt.observations = { files: [], aliases: [], navigation: [], available: counts,
    inventoryOwner: 'actual hierarchy pages and pinned manifest', panels: 'actual Explore/Inspect toolbar controls',
    aliasOwner: 'pinned lazy member detail opened through the visible source-fields inspector; compact selection rows omit rich dataflow' };
  const selectionValue = label => page.locator('#selection-body .sel-row')
    .filter({ has: page.locator('.sel-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.sel-value');
  const waitForFile = file => page.waitForFunction(async expectedFile => {
    const { state } = await import('/isomap/state.js');
    const rows = [...document.querySelectorAll('#selection-body .sel-row')];
    return state.selectedInfo?.type === 'file' && state.selectedInfo.file === expectedFile
      && rows.some(row => row.querySelector('.sel-label')?.textContent === 'Path' && row.querySelector('.sel-value')?.textContent === expectedFile);
  }, file);
  const waitForMember = member => page.waitForFunction(async ({ id, file }) => {
    const { state } = await import('/isomap/state.js');
    const rows = [...document.querySelectorAll('#selection-body .sel-row')];
    return state.selectedInfo?.type === 'member' && state.selectedInfo.id === id && state.selectedInfo.file === file
      && rows.some(row => row.querySelector('.sel-label')?.textContent === 'Id' && row.querySelector('.sel-value')?.textContent === String(id));
  }, { id: member.id, file: member.file });
  let detailEvidence = null;
  const inspectAliases = async member => {
    const labels = member.dataflow?.aliases || [];
    assert.equal(labels.length, 5, 'All five aliases from the real producer/export fixture reach the actual inspector.');
    // The server's resolve/members protocol intentionally carries identity-only
    // rows. Its full member remains in the generation-bound lazy detail owner.
    // Observe the response initiated by this real disclosure, without issuing
    // another request or putting rich fields into the resident source index.
    const pending = detailEvidence ? null : context.waitForEvent('response', { predicate: response => {
      if (new URL(response.url()).pathname !== '/map-snapshot' || response.request().method() !== 'POST') return false;
      try { const query = response.request().postDataJSON(); return query.kind === 'detail' && query.entity?.type === 'member'; }
      catch { return false; }
    }, timeout: 5000 });
    pending?.catch(() => {});
    const sourceFields = page.locator('#selection-body > details')
      .filter({ has: page.locator('summary', { hasText: /^Source fields · load on demand$/ }) });
    await sourceFields.locator(':scope > summary').click();
    const dataflow = sourceFields.locator(':scope > div > .evidence > details')
      .filter({ has: page.locator('summary', { hasText: /^dataflow: / }) });
    await dataflow.locator(':scope > summary').click();
    const aliases = dataflow.locator(':scope > .evidence > details')
      .filter({ has: page.locator('summary', { hasText: /^aliases: / }) });
    assert.equal(await aliases.locator(':scope > summary').textContent(), 'aliases: 5 items');
    await aliases.locator(':scope > summary').click();
    await aliases.locator(':scope > .evidence').waitFor({ state: 'visible' });
    assert.deepEqual(await aliases.locator(':scope > .evidence > details > summary').allTextContents(),
      labels.map((label, index) => `${index}: ${label}`));
    if (pending) {
      const response = await pending, query = response.request().postDataJSON(), raw = await response.text(), value = JSON.parse(raw);
      assert.equal(response.ok(), true);
      assert.equal(query.snapshot, receipt.source.sha256, 'the UI detail request must select the exact supplied map bytes');
      for (const key of ['protocol', 'snapshot', 'request', 'revision', 'kind']) assert.equal(value[key], query[key]);
      assert.deepEqual(value.detail, member, 'the real UI-triggered detail must preserve the complete saved member');
      detailEvidence = value;
      receipt.observations.detail = { snapshot: value.snapshot, sha256: createHash('sha256').update(raw).digest('hex'),
        id: value.detail.id, aliases: labels.length, trigger: 'visible source fields → dataflow → aliases disclosures' };
    }
    assert.equal(detailEvidence.detail.id, member.id);
    return detailEvidence.detail;
  };
  for (const node of expected.nodes) {
    await search.fill(node.path);
    // The prior all-files page already contains this file. Wait for the actual
    // filtered page before opening its group, so a late search replacement
    // cannot discard the just-opened summary/member request.
    await page.waitForFunction(file => {
      const groups = [...document.querySelectorAll('#stack-tree > details')];
      return groups.length === 1 && groups[0].querySelector('summary')?.textContent.startsWith(file + ' · ');
    }, node.path);
    const group = tree.locator(':scope > details').filter({ has: page.locator('summary', { hasText: node.path + ' · ' }) });
    await group.waitFor({ state: 'visible' });
    // Remote hierarchy groups start collapsed. Opening their real summary
    // both exposes the focus action and asks the original source for members.
    assert.equal(await group.getAttribute('open'), null);
    await group.locator(':scope > summary').click();
    await page.waitForFunction(({ file, count }) => [...document.querySelectorAll('#stack-tree > details')]
      .find(row => row.querySelector('summary')?.textContent.startsWith(file + ' · '))?.textContent.includes(`of ${count} available members.`),
    { file: node.path, count: node.members.length });
    const memberButtons = group.locator('section button');
    assert.equal(await memberButtons.count(), node.members.length);
    await group.getByRole('button', { name: 'Inspect / focus stack', exact: true }).click();
    await waitForFile(node.path);
    await openPanel('Inspect');
    assert.equal(await selectionValue('Members').textContent(), String(node.members.length));
    receipt.observations.files.push({ path: node.path, members: node.members.length, hierarchy: true });
    await openPanel('Explore');
    for (const member of node.members) {
      await memberButtons.filter({ hasText: member.name + ' · ' }).click();
      await waitForMember(member);
      await openPanel('Inspect');
      const actual = await page.evaluate(async id => (await import('/isomap/state.js')).state.sourceIndex.member(id).member, member.id);
      assert.equal(actual.id, member.id);
      const labels = member.dataflow?.aliases || [], detail = await inspectAliases(member);
      const contribution = await page.evaluate(async value => {
        const { scoreMember } = await import('/isomap/layout-utils.js');
        const { scoringDefaults } = await import('/isomap/defaults.js');
        const baseline = scoreMember({ ...value, dataflow: { ...value.dataflow, aliases: [] } }, scoringDefaults);
        return { actual: scoreMember(value, scoringDefaults) - baseline, expected: value.dataflow.aliases.length * scoringDefaults.dataflow };
      }, detail);
      assert.ok(Math.abs(contribution.actual - contribution.expected) < 1e-9);
      receipt.observations.aliases.push({ id: member.id, labels, contribution: contribution.actual });
      // These toolbar controls replay the actual source navigation history;
      // inspector visibility stays on the user's selected task surface.
      await toolbar.getByRole('button', { name: 'Previous selection', exact: true }).click();
      await waitForFile(node.path);
      assert.equal(await selectionValue('Members').textContent(), String(node.members.length));
      await toolbar.getByRole('button', { name: 'Next selection', exact: true }).click();
      await waitForMember(member);
      await inspectAliases(member);
      receipt.observations.navigation.push({ file: node.path, member: member.id, back: 'file', forward: 'member', aliases: labels.length });
      await openPanel('Explore');
    }
  }
  assert.equal(receipt.observations.files.length, 5);
  assert.equal(receipt.observations.aliases.length, 1);
  assert.equal(receipt.observations.navigation.length, 1);
  const aliasMember = expected.nodes.flatMap(node => node.members)[0];
  await search.fill(aliasMember.name);
  const namedMember = tree.getByRole('button', { name: `${aliasMember.file} / ${aliasMember.name}`, exact: true });
  await namedMember.focus(); await namedMember.press('Enter');
  await waitForMember(aliasMember);
  await openPanel('Inspect');
  await inspectAliases(aliasMember);
  receipt.observations.memberNameSearch = { id: aliasMember.id, action: 'actual source-name search and keyboard Enter', aliases: 5 };
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
