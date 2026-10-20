import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { createPublishedRuntimeWitness } from '../../helpers/published-runtime-witness.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { OPERATIONS } from '../../../src/map/workspace/request.js';
import { projectOutput, refKey } from '../../../src/map/workspace/projection.js';
import { defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';

// Explicit task-owned browser binaries, dependency module and receipt directory.
// This is real-browser qualification, deliberately outside ordinary DOM tests.
const options = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) =>
  [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
for (const key of ['playwright', 'chromium', 'out']) if (!options[key]) throw new Error('Required --' + key);
await requireBootstrap();
const destination = path.resolve(options.out); await fs.mkdir(destination, { recursive: true });
const root = await fs.mkdtemp(path.join(destination, 'fixture-'));
const { chromium } = await import(pathToFileURL(path.resolve(options.playwright)).href);
const receipt = { schemaVersion: 1, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, architecture: process.arch, startedAt: new Date().toISOString(),
  tests: [], screenshots: [], requests: [], runtimeVerification: [], artifactPages: [], browser: null,
  pageErrors: [], consoleErrors: [], resourceFailures: [], assets: [],
  limits: { totalWorkMs: 30000, requestTimeoutMs: 5000, workerDeadlineMs: 1000, viewBytes: 2097152 },
  qualification: 'actual browser/service/Worker; saved synthetic capture; renderer receipt distinguishes software from hardware',
  hardwareQualification: 'not claimed by this headless run', perfetto: 'not requested; no adapter added' };
let browser, context, server, router, runtime, isoController, isoResult, page, qualificationError;
const started = performance.now(), deadline = new AbortController();
const checkDeadline = () => {
  if (performance.now() - started >= receipt.limits.totalWorkMs && !deadline.signal.aborted) {
    deadline.abort(new Error('Browser qualification exceeded its 30-second work allowance; no passing receipt.'));
  }
  deadline.signal.throwIfAborted();
};
const watchdog = setTimeout(() => {
  deadline.abort(new Error('Browser qualification exceeded its 30-second work allowance; no passing receipt.'));
  isoController?.abort(deadline.signal.reason);
  void context?.close().catch(() => {});
}, receipt.limits.totalWorkMs);
const record = name => { checkDeadline(); receipt.tests.push(name); };
try {
  const witness = await createPublishedSemanticWitness({ root, abortSignal: deadline.signal }); checkDeadline();
  runtime = await createPublishedRuntimeWitness(witness, { signal: deadline.signal }); checkDeadline();
  receipt.generation = witness.manifest.generation;
  receipt.runtimeMeasurement = { kind: 'synthetic saved SSR fixture; no live capture',
    verifiedSourceRefs: runtime.functions.map(row => row.ref),
    sourceUnitId: runtime.source.sourceUnitId, sourceHash: runtime.source.byteHash,
    cpuTimeDeltas: [10, 10], cpuClockUnit: 'us', causalClaims: 'inferred and separately labelled' };
  receipt.sources = [...witness.sources.values()].map(source => ({ path: source.path, sourceUnitId: source.sourceUnitId, byteHash: source.byteHash }));
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: witness.repoRoot, allowedRepoRoots: [witness.repoRoot] });
  server = http.createServer(router.handleRequest); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: path.resolve(options.chromium), headless: true,
    timeout: Math.max(1, receipt.limits.totalWorkMs - (performance.now() - started)),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  receipt.browser = { version: browser.version(), executable: path.resolve(options.chromium), rendererMode: 'requested ANGLE SwiftShader; observed renderer below' };
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ignoreHTTPSErrors: true });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = receipt.pageErrors; page.on('pageerror', error => { if (errors.length < 32) errors.push(error.message); });
  page.on('console', message => { if (message.type() === 'error' && receipt.consoleErrors.length < 32) receipt.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => { if (receipt.resourceFailures.length < 32) receipt.resourceFailures.push({ url: request.url(), error: request.failure()?.errorText }); });
  page.on('response', response => { if (response.url().includes('/map/workspace') || response.url().includes('/map/vendor/')) {
    if (receipt.assets.length < 64) receipt.assets.push({ url: response.url(), status: response.status() });
  } });
  await page.goto(base + '/map/workspace'); await page.locator('#query-toggle').click();
  await page.locator('#operation option[value="catalog"]').waitFor({ state: 'attached' });
  const query = async (operation, input, success = true) => {
    checkDeadline();
    await page.locator('#operation').selectOption(operation); await page.locator('#request').fill(JSON.stringify(input));
    const responsePromise = page.waitForResponse(response => response.url().endsWith(OPERATIONS[operation]) && response.request().method() === 'POST');
    await page.locator('#run').click(); const response = await responsePromise;
    checkDeadline();
    receipt.requests.push({ operation, status: response.status() });
    if (success) {
      assert.equal(response.status(), 200, operation); const data = (await response.json()).result;
      await page.waitForFunction(({ family, operation }) => document.getElementById('family').textContent === family
        && document.getElementById('notice').textContent.includes(operation + ' response'), { family: projectOutput(data).family, operation });
      return data;
    }
    assert.ok(response.status() >= 400); await page.locator('#notice.error').waitFor(); return null;
  };
  const catalog = await query('catalog', { repoRoot: witness.repoRoot });
  assert.ok(catalog.artifacts.some(row => row.name === 'semantic_records' && row.available));
  await page.locator('#tree button').filter({ hasText: /^semantic_records/ }).first().click();
  const artifactResponse = page.waitForResponse(response => response.url().endsWith('/map/artifact') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Inspect this artifact', exact: true }).click();
  const firstArtifactResponse = await artifactResponse; assert.equal(firstArtifactResponse.status(), 200);
  let artifact = (await firstArtifactResponse.json()).result;
  await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('semantic_records'));
  const rememberArtifactPage = () => {
    checkDeadline(); assert.equal(artifact.generation, catalog.generation);
    receipt.artifactPages.push({ ordinal: artifact.ordinal, returned: artifact.rows.length, cursor: !!artifact.cursor,
      generation: artifact.generation, kinds: [...new Set(artifact.rows.map(row => row.row?.kind))] });
  };
  rememberArtifactPage();
  const sourceExpression = row => row.ref && row.generation && row.row?.kind === 'expression'
    && row.row.data?.astKind === 'CallExpression'
    && Array.isArray(row.row.span) && row.row.span.length === 2 && row.row.span[1] > row.row.span[0];
  let selectedIndex = artifact.rows.findIndex(sourceExpression);
  while (selectedIndex < 0 && artifact.cursor && receipt.artifactPages.length < 8) {
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/map/artifact') && response.request().method() === 'POST');
    await page.locator('#next-response').click(); const response = await responsePromise;
    assert.equal(response.status(), 200); artifact = (await response.json()).result;
    await page.waitForFunction(({ label }) => document.getElementById('notice').textContent.includes('artifact response')
      && document.querySelector('#tree button')?.childNodes[0].textContent === label, { label: projectOutput(artifact).nodes[0]?.label });
    rememberArtifactPage();
    selectedIndex = artifact.rows.findIndex(sourceExpression);
  }
  assert.ok(selectedIndex >= 0, 'an actual expression must occur within eight bounded service pages');
  const selected = artifact.rows[selectedIndex];
  const selectedSource = witness.sourceFor(selected.ref); assert.ok(selectedSource);
  const [sourceSpan] = await witness.store.getSourceSpans([selected.ref], { signal: deadline.signal, maxBytes: 65536 });
  assert.ok(sourceSpan); assert.equal(sourceSpan.sourceUnitId, selectedSource.sourceUnitId);
  assert.equal(sourceSpan.sourceHash, selectedSource.byteHash);
  receipt.selectedSourceExpression = { ref: selected.ref, span: selected.row.span,
    sourceUnitId: sourceSpan.sourceUnitId, sourceHash: sourceSpan.sourceHash, text: sourceSpan.text };
  await page.locator('#tree button').nth(selectedIndex).click();
  const detailResponse = page.waitForResponse(response => response.url().endsWith('/analysis/semantic-detail') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Load semantic detail', exact: true }).click();
  const detail = (await (await detailResponse).json()).result;
  const exact = detail.records.find(row => refKey(row.ref) === refKey(selected.ref));
  assert.ok(exact); assert.deepEqual(exact.data, selected.row.data); assert.equal(exact.kind, selected.row.kind);
  assert.deepEqual(exact.span, selected.row.span);
  await page.locator('#diagram svg .pick-target').first().waitFor();
  const targets = await page.locator('#diagram .pick-target').evaluateAll(nodes => nodes.map(node => node.dataset.entityId));
  assert.deepEqual([...targets].sort(), projectOutput(detail).nodes.map(node => node.id).sort());
  const target = page.locator('#diagram .pick-target').first(); await target.focus(); await target.press('Enter');
  assert.equal(await target.evaluate(node => node === document.activeElement), true);
  assert.ok(await page.locator('#detail').textContent()); await target.press('Space');
  const workerGeometry = await page.locator('#diagram svg').evaluate(svg => {
    const rect = svg.getBoundingClientRect(); return { width: rect.width, height: rect.height, targets: svg.querySelectorAll('.pick-target').length };
  });
  assert.ok(workerGeometry.width > 0 && workerGeometry.height > 0); receipt.workerGeometry = workerGeometry;
  record('catalog → actual artifact → exact semantic detail → real Worker/SVG selection and keyboard focus');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-evidence').click();
  const download = await downloadPromise, downloaded = path.join(destination, 'semantic-detail.json');
  await download.saveAs(downloaded); assert.deepEqual(JSON.parse(await fs.readFile(downloaded, 'utf8')).result, detail);
  record('download preserves the complete admitted service envelope');
  const candidates = await query('find', { repoRoot: witness.repoRoot, generation: witness.manifest.generation,
    selector: { field: 'astKind', value: 'CallExpression' }, limits: { records: 2, bytes: 65536, workMs: 250 } });
  assert.ok(candidates.records.length);
  assert.equal(candidates.records[0].generation, undefined, 'canonical records pin generation on their envelope');
  await page.locator('#tree button').first().click();
  const hydrationResponse = page.waitForResponse(response => response.url().endsWith('/analysis/semantic-detail') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Load semantic detail', exact: true }).click();
  const hydration = await hydrationResponse;
  assert.equal(hydration.status(), 200);
  const hydrationInput = hydration.request().postDataJSON();
  assert.deepEqual(hydrationInput.generation, candidates.generation);
  assert.deepEqual(hydrationInput.refs, [candidates.records[0].ref]);
  assert.equal(hydrationInput.repoRoot, witness.repoRoot);
  const hydrated = (await hydration.json()).result;
  assert.ok(hydrated.operands.length, 'hydration loads actual operands of the selected call');
  await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('semantic detail'));
  await page.locator('#tree button').first().click();
  await page.getByRole('button', { name: 'Load semantic detail', exact: true }).waitFor();
  record('canonical find → exact envelope generation/ref → hydrated operands; canonical detail remains hydratable');
  const typed = await query('find', { repoRoot: witness.repoRoot, generation: witness.manifest.generation,
    selector: { typeExpression: { expression: 'number', match: 'exact-expression', sources: ['compiler'], roles: ['parameter'] } },
    limits: { records: 2, bytes: 65536, workMs: 250 } });
  assert.ok(typed.matches.length); assert.ok(typed.matches.every(row => row.category === 'type-fact'
    && row.fact.source === 'compiler' && row.fact.role === 'parameter' && row.fact.sourceHash));
  const literals = await query('find', { repoRoot: witness.repoRoot, generation: witness.manifest.generation,
    selector: { literal: { type: 'number', representation: '10' } }, limits: { records: 2, bytes: 65536, workMs: 250 } });
  assert.ok(literals.matches.length); assert.ok(literals.matches.every(row => row.category === 'literal-value' && row.fact.source === 'literal'));
  record('real service/browser strict compiler-role fact and exact scalar occurrence provenance');
  const search = await query('search', { repoPath: witness.repoRoot, query: 'build', mode: 'code', backend: 'memory', ann: false, top: 5 });
  assert.ok(search.code.length); const ranked = projectOutput(search);
  const labels = await page.locator('#tree button').evaluateAll(nodes => nodes.map(node => node.childNodes[0].textContent));
  assert.deepEqual(labels, ranked.nodes.map(node => node.label));
  record('ranked search preserves service order and scores');
  const beforeStale = await page.locator('#family').textContent();
  await query('detail', { repoRoot: witness.repoRoot, generation: { ...witness.manifest.generation, baseBuildId: 'stale-browser-generation' }, refs: [selected.ref] }, false);
  assert.equal(await page.locator('#family').textContent(), beforeStale);
  assert.deepEqual(await page.locator('#tree button').evaluateAll(nodes => nodes.map(node => node.childNodes[0].textContent)), labels);
  record('stale generation error retains the prior ranked view');
  let release, startedResolve;
  const held = new Promise(resolve => { release = resolve; }), dispatched = new Promise(resolve => { startedResolve = resolve; });
  await page.route('**/search', async route => {
    const response = await route.fetch(); startedResolve(); await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator('#operation').selectOption('search'); await page.locator('#request').fill(JSON.stringify({ repoPath: witness.repoRoot, query: 'render', mode: 'code', backend: 'memory', ann: false }));
  await page.locator('#run').click(); await dispatched; await page.locator('#cancel').click(); release(); await page.unroute('**/search');
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Request cancelled'));
  assert.deepEqual(await page.locator('#tree button').evaluateAll(nodes => nodes.map(node => node.childNodes[0].textContent)), labels);
  record('cancel suppresses a delayed real-service reply and retains prior view');
  const common = { schemaVersion: 1, repoRoot: witness.repoRoot, destination: 'runtime-import' };
  const generation = witness.manifest.generation, repositoryNamespace = runtime.source.repositoryNamespace;
  const families = await query('families', { ...common, limits: { maxFamilies: 8, maxScan: 32, maxBytes: 65536, maxMs: 1000 }, cursor: null });
  assert.ok(families.families.some(row => row.generationId === runtime.first.pointer.generationId));
  const observed = await query('runtime', { ...common, request: { schemaVersion: 1, repositoryNamespace, generation,
    familyGenerations: [runtime.first.pointer.generationId], selectors: { ...defaultRuntimeQuerySelectors(), records: [runtime.functions[0].ref] },
    limits: { maxRecords: 1, maxBytes: 65536, maxMs: 1000 }, cursor: null } });
  assert.equal(observed.observations.length, 1); assert.deepEqual(observed.observations[0].join.targets, [runtime.functions[0].ref]);
  assert.equal(observed.observations[0].join.targetQuality, 'verified-coordinate'); receipt.runtimeVerification.push(observed.cost);
  await page.locator('#tree button').first().click(); assert.ok(await page.locator('#detail').textContent());
  const comparison = await query('compare', { ...common, request: { schemaVersion: 1, repositoryNamespace, generation,
    leftFamily: runtime.first.pointer.generationId, rightFamily: runtime.second.pointer.generationId, sources: runtime.base.capture.sources,
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true } });
  const claims = await query('claims', { ...common, request: { schemaVersion: 1, repositoryNamespace, generation,
    claimGeneration: comparison.claimGeneration, limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, cursor: null } });
  assert.ok(claims.claims.length); assert.ok(claims.claims.every(row => row.evidenceClass === 'inferred'));
  record('saved family → observed exact SSR source coordinate → separate immutable inferred claim');
  await query('detail', { repoRoot: witness.repoRoot, generation: selected.generation, refs: [selected.ref], include: ['operands', 'names', 'ownership'] });
  await page.locator('#diagram svg').waitFor(); await page.locator('#editor-toggle').click();
  const priorSvg = await page.locator('#diagram svg').innerHTML();
  await page.route('**/reladraw-worker.js', route => route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => {};' }));
  const deadlineStart = performance.now(); await page.locator('#compile').click();
  await page.waitForFunction(() => document.getElementById('compile-status').textContent.includes('1-second deadline'));
  receipt.workerDeadlineMs = performance.now() - deadlineStart; assert.ok(receipt.workerDeadlineMs < 2200);
  assert.equal(await page.locator('#diagram svg').innerHTML(), priorSvg); await page.unroute('**/reladraw-worker.js');
  record('real Worker watchdog terminates an injected stall and retains prior SVG');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile-portrait', 390, 844], ['mobile-landscape', 844, 390]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const footer = document.querySelector('footer').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
      const editor = document.querySelector('#editor').getBoundingClientRect();
      const editorControlsBottom = Math.max(editor.bottom, ...[...document.querySelectorAll('#editor button,#compile-status')]
        .map(node => node.getBoundingClientRect().bottom));
      return { horizontal: document.documentElement.scrollWidth <= innerWidth,
        footerTop: footer.top, mainBottom: main.bottom, toolbarBottom: toolbar.bottom, editorBottom: editor.bottom, editorControlsBottom };
    });
    assert.equal(layout.horizontal, true, name + ' horizontal layout');
    assert.ok(layout.footerTop >= Math.max(layout.mainBottom, layout.toolbarBottom, layout.editorControlsBottom) - 1,
      name + ' footer must follow the complete workspace controls');
    (receipt.viewportLayouts ||= []).push({ name, width, height, ...layout });
    const filename = name + '.png'; await page.screenshot({ path: path.join(destination, filename), fullPage: true }); receipt.screenshots.push(filename);
  }
  assert.deepEqual(errors, [], 'workspace emitted no uncaught browser errors');
  record('desktop/mobile portrait/mobile landscape rendered layout receipts');

  // The independent real Three.js CLI/server remains a separate viewer authority.
  isoController = new AbortController(); let readyResolve, launcherLog = '';
  const ready = new Promise(resolve => { readyResolve = resolve; });
  isoResult = spawnSubprocess(process.execPath, ['tools/analysis/map-iso-serve.js', '--repo', witness.repoRoot, '--no-open', '--cert-dir', path.join(root, 'viewer-tls')],
    { cwd: process.cwd(), env: process.env, signal: isoController.signal, timeoutMs: 30000, outputMode: 'string',
      onStderr: chunk => { launcherLog += String(chunk); const match = launcherLog.match(/Serving map: (https:\/\/localhost:\d+\/map.iso.html)/); if (match) readyResolve(match[1]); } })
    .then(result => ({ result }), error => ({ error }));
  const isoUrl = await Promise.race([ready, isoResult.then(result => { throw new Error('Three.js launcher ended before readiness: ' + launcherLog + ' ' + (result.error?.message || '')); })]);
  await page.goto(isoUrl); await page.waitForFunction(() => document.querySelectorAll('#stack-tree details').length > 0 && document.querySelector('canvas'));
  const renderer = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2'), debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      version: gl?.getParameter(gl.VERSION), contextLost: gl?.isContextLost(), width: canvas.width, height: canvas.height };
  });
  assert.ok(renderer.width > 0 && renderer.height > 0); assert.equal(renderer.contextLost, false); receipt.renderer = renderer;
  await page.locator('#stack-search').fill('build'); const member = page.locator('#stack-tree button').filter({ hasText: /^build/ }).first();
  await member.focus(); await member.press('Enter'); await page.waitForFunction(() => document.getElementById('stack-breadcrumb').textContent.includes('build'));
  assert.match(await page.locator('#selection-body').textContent(), /Directed relationships/);
  await page.locator('#stack-mode').selectOption('segments'); await page.locator('#stack-focus').click();
  await page.screenshot({ path: path.join(destination, 'three-selection.png'), fullPage: true }); receipt.screenshots.push('three-selection.png');
  record('independent actual Three.js server/WebGL renderer/keyboard source-member selection');
  const fallback = await context.newPage(); fallback.setDefaultTimeout(5000);
  await fallback.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : get.call(this, type, ...args); };
  });
  await fallback.goto(isoUrl); await fallback.waitForFunction(() => document.getElementById('summary').textContent.includes('3D unavailable'));
  await fallback.locator('#stack-search').fill('build'); await fallback.locator('#stack-tree button').filter({ hasText: /^build/ }).first().click();
  assert.match(await fallback.locator('#stack-breadcrumb').textContent(), /build/); assert.match(await fallback.locator('#selection-body').textContent(), /All source fields/);
  await fallback.screenshot({ path: path.join(destination, 'three-no-webgl.png'), fullPage: true }); receipt.screenshots.push('three-no-webgl.png');
  await fallback.close(); record('injected WebGL unavailability preserves real source hierarchy and inspector');
  checkDeadline(); receipt.workMs = performance.now() - started; receipt.status = 'passed';
} catch (error) { qualificationError = error; receipt.status = 'failed'; receipt.failure = { message: error.message, stack: error.stack }; throw error; }
finally {
  clearTimeout(watchdog);
  const cleanupErrors = [];
  const finish = async (owner, action) => {
    try { await action(); } catch (error) { cleanupErrors.push({ owner, error }); }
  };
  isoController?.abort(); if (isoResult) await finish('three-server', () => isoResult);
  await finish('browser-context', () => context?.close()); await finish('browser', () => browser?.close());
  await finish('api-router', () => router?.close());
  if (server) await finish('http-server', () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await finish('saved-capture-fixture', () => runtime?.cleanup());
  receipt.totalWithCleanupMs = performance.now() - started; receipt.endedAt = new Date().toISOString();
  if (receipt.totalWithCleanupMs >= receipt.limits.totalWorkMs) cleanupErrors.push({ owner: 'deadline', error: new Error('Qualification including cleanup exceeded 30 seconds.') });
  if (cleanupErrors.length) {
    receipt.status = 'failed'; receipt.cleanupFailures = cleanupErrors.map(({ owner, error }) => ({ owner, message: error.message }));
  }
  await fs.writeFile(path.join(destination, 'browser-qualification.json'), JSON.stringify(receipt, null, 2));
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors.map(row => row.error), 'Browser qualification cleanup failed.', { cause: qualificationError });
}
