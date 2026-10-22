import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { resolveToolRoot } from '../../../tools/shared/dict-utils.js';
import { verifyMapViewerModuleGraph } from '../../../tools/bench/map/module-graph.js';
import { attachQualificationDiagnostics } from './qualification-diagnostics.js';
import { captureRenderedViewerFrame } from './qualification-rendered-frame.js';

// Explicit browser qualification, outside ordinary discovery. Run separately for
// the actual FPS and LOD launcher URLs; preparation/server startup is not rendering.
const options = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) =>
  [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
for (const key of ['url', 'playwright', 'chromium', 'out', 'scenario']) if (!options[key]) throw new Error(`Required --${key}`);
if (!['fps', 'lod'].includes(options.scenario)) throw new Error('Scenario must identify the FPS or LOD launcher.');
const url = new URL(options.url);
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('An explicit loopback HTTP benchmark URL is required.');
await requireBootstrap();
const out = path.resolve(options.out); await fs.mkdir(out, { recursive: true });
const receipt = { schemaVersion: 1, scenario: options.scenario, url: url.href, status: 'running',
  preparation: 'provided launcher artifact', listener: 'pending', moduleGraph: 'pending', viewer: 'pending',
  phases: [], captures: [], requestedRenderer: 'ANGLE SwiftShader', hardwareQualification: 'not-run', fps: 'not-measured' };
const { chromium } = await import(pathToFileURL(path.resolve(options.playwright)).href);
let browser, context, error;
const started = performance.now();
const watchdog = setTimeout(() => { error ||= new Error('Benchmark browser qualification exceeded 30 seconds.'); void context?.close(); }, 30000);
try {
  receipt.moduleGraph = await verifyMapViewerModuleGraph({ url: url.href, toolRoot: resolveToolRoot() });
  receipt.listener = 'ready';
  browser = await chromium.launch({ executablePath: path.resolve(options.chromium), headless: true, timeout: 5000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const diagnostics = attachQualificationDiagnostics(page, receipt, `${options.scenario}-desktop`);
  await page.goto(url.href);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['narrow', 390, 844]]) {
    if (name !== 'desktop') diagnostics.begin(`${options.scenario}-${name}`);
    await page.setViewportSize({ width, height });
    const frame = await captureRenderedViewerFrame(page);
    const file = `${options.scenario}-${name}.png`;
    await page.screenshot({ path: path.join(out, file), fullPage: true });
    diagnostics.assertClean();
    receipt.captures.push({ file, frame, viewport: { width, height } });
  }
  receipt.viewer = 'rendered-ready'; receipt.status = 'passed';
} catch (cause) { error ||= cause; receipt.status = 'failed'; receipt.failure = cause.message; }
finally {
  clearTimeout(watchdog);
  const cleanupFailures = [];
  for (const [owner, close] of [['context', () => context?.close()], ['browser', () => browser?.close()]]) {
    try { await close(); } catch (cause) { cleanupFailures.push({ owner, message: cause.message }); }
  }
  receipt.elapsedIncludingCleanupMs = performance.now() - started;
  if (receipt.elapsedIncludingCleanupMs >= 30000) error ||= new Error('Benchmark browser qualification including cleanup exceeded 30 seconds.');
  if (cleanupFailures.length || error) receipt.status = 'failed';
  receipt.cleanupFailures = cleanupFailures;
  await fs.writeFile(path.join(out, `${options.scenario}-browser-qualification.json`), JSON.stringify(receipt, null, 2));
  if (error || cleanupFailures.length) throw new AggregateError([...(error ? [error] : []), ...cleanupFailures.map(row => new Error(row.message))], 'Benchmark browser qualification failed.');
}
