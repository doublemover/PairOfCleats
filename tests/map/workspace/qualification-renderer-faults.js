import assert from 'node:assert/strict';
import { captureRenderedViewerFrame } from './qualification-rendered-frame.js';
import { classifyQualificationPhase } from './qualification-diagnostics.js';

/** Independent actual-browser negatives; source fallback never qualifies 3D. */
export const qualifyRendererFault = async ({ page, url, diagnostics, scenario }) => {
  const fault = scenario.replace('three-', '');
  diagnostics.begin(scenario);
  const startup = { type: 'requestfailed', url: new URL('/map-snapshot', url).href,
    method: 'POST', requestKind: 'files', message: 'net::ERR_ABORTED', maxCount: 1 };
  diagnostics.expect(startup);
  const moduleUrl = new URL('/three/three.module.js', url).href;
  let moduleInterceptions = 0;
  if (fault === 'module-404') {
    await page.route(moduleUrl, route => {
      moduleInterceptions++;
      return route.fulfill({ status: 404, contentType: 'text/javascript', body: 'missing required fixture module' });
    });
    diagnostics.expect({ type: 'http', url: moduleUrl, statuses: [404], maxCount: 1 });
    diagnostics.expect({ type: 'requestfailed', url: moduleUrl, method: 'GET', message: 'net::ERR_ABORTED', maxCount: 1 });
    diagnostics.expect({ type: 'console', url: moduleUrl,
      messagePattern: '^Failed to load resource: the server responded with a status of 404\\b', maxCount: 1 });
  } else {
    await page.addInitScript(fault => {
      globalThis.__qualificationFault = { fault, intercepted: 0 };
      const original = HTMLCanvasElement.prototype.getContext, contexts = new WeakSet();
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (fault === 'fallback-page-error' && /^webgl/.test(type)) {
          globalThis.__qualificationFault.intercepted++; return null;
        }
        const gl = Reflect.apply(original, this, [type, ...args]);
        if (!gl || !/^webgl/.test(type) || contexts.has(gl)) return gl;
        contexts.add(gl);
        if (fault === 'shader-failure') {
          const source = gl.shaderSource;
          gl.shaderSource = function(shader, text) {
            globalThis.__qualificationFault.intercepted++;
            return Reflect.apply(source, this, [shader, text + '\npoc_invalid_shader_token\n']);
          };
        } else if (fault === 'render-noop' || fault === 'render-exception') {
          for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
            if (typeof gl[name] === 'function') {
              const operation = gl[name];
              gl[name] = function(...args) {
                if (fault === 'render-exception' && !globalThis.__qualificationFault.armed)
                  return Reflect.apply(operation, this, args);
                globalThis.__qualificationFault.intercepted++;
                if (fault === 'render-exception') throw new Error('poc-original-render-exception');
              };
            }
        }
        return gl;
      };
    }, fault);
    if (fault === 'shader-failure') diagnostics.expect({ type: 'console',
      url: new URL('/three/three.core.js', url).href,
      messagePattern: '^THREE.WebGLProgram: Shader Error', maxCount: 16 });
  }
  if (fault === 'render-exception') diagnostics.expect({ type: 'pageerror', url,
    message: 'poc-original-render-exception', maxCount: 1 });
  if (fault === 'fallback-page-error') {
    diagnostics.expect({ type: 'console', url: new URL('/three/three.core.js', url).href,
      message: 'THREE.WebGLRenderer: THREE.WebGLRenderer: Error creating WebGL context.', maxCount: 1 });
    diagnostics.expect({ type: 'pageerror', url, message: 'poc-fallback-page-exception', maxCount: 1 });
  }
  const mark = name => { (diagnostics.phase.operationSteps ||= []).push({ name, at: new Date().toISOString() }); };
  mark('navigate start');
  await page.goto(url); mark('navigation ready');
  await page.waitForFunction(() => document.querySelectorAll('#stack-tree details').length > 0);
  if (fault === 'module-404' || fault === 'fallback-page-error') await page.waitForFunction(() => document.getElementById('summary').textContent.includes('3D unavailable'));
  let priorFrame = null;
  if (fault === 'render-exception' || fault === 'fallback-page-error') {
    const stateHandle = await page.evaluateHandle(async () => (await import('/isomap/state.js')).state);
    let primary;
    try { await page.waitForFunction(state => state.graphWorkerReady === true, stateHandle); }
    catch (error) { primary = error; throw error; }
    finally {
      try { await stateHandle.dispose(); }
      catch (cleanup) {
        if (primary) throw new AggregateError([primary, cleanup], 'Graph worker readiness and handle cleanup failed.', { cause: primary });
        throw cleanup;
      }
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    mark('original source worker and startup requests settled');
  }
  if (fault === 'render-exception') {
    priorFrame = await captureRenderedViewerFrame(page);
    assert.ok(priorFrame.calls > 0, 'fault follows a real previously useful frame');
    mark('original useful frame captured');
  }
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.locator('#stack-search').fill('build');
  await page.locator('#stack-tree button').filter({ hasText: /^(?:snapshot\.ts \/ )?build(?:$| ·)/u }).first().click();
  await page.waitForFunction(() => document.getElementById('stack-breadcrumb').textContent.includes('build'));
  // Breadcrumb selection is synchronous; the original source query/detail
  // requests still own their responses. Finish those before closing the page.
  await page.waitForLoadState('networkidle', { timeout: 5000 });
  mark('initial source selection ready');
  if (fault === 'render-exception') {
    await page.evaluate(() => { globalThis.__qualificationFault.armed = true; });
  }
  if (fault === 'fallback-page-error') {
    await page.evaluate(() => { queueMicrotask(() => { throw new Error('poc-fallback-page-exception'); }); });
    await page.waitForFunction(() => document.getElementById('stack-breadcrumb').textContent.includes('build'));
  }
  let rejected;
  try { await captureRenderedViewerFrame(page); }
  catch (error) { rejected = error; }
  assert.ok(rejected, 'an allocated canvas or functioning hierarchy cannot qualify the injected broken renderer');
  if (fault === 'module-404' || fault === 'fallback-page-error') {
    assert.match(rejected.message, /RendererUnavailableError: Renderer unavailable before useful frame:/);
    if (fault === 'module-404') assert.ok(rejected.message.includes(moduleUrl));
    else assert.match(rejected.message, /Error creating WebGL context/);
  }
  else if (fault === 'render-exception') assert.match(rejected.message, /poc-original-render-exception/);
  else assert.match(rejected.message, /pixel invariant failed/);
  const injection = fault === 'module-404' ? { intercepted: moduleInterceptions } : await page.evaluate(() => globalThis.__qualificationFault);
  assert.ok(injection.intercepted > 0, 'the actual module/shader/draw operation must encounter the fault');
  if (fault === 'render-exception' || fault === 'fallback-page-error') {
    const marker = fault === 'render-exception' ? 'poc-original-render-exception' : 'poc-fallback-page-exception';
    assert.ok(diagnostics.phase.events.some(event => event.type === 'pageerror' && event.message === marker));
    assert.equal(classifyQualificationPhase({ ...diagnostics.phase, expected: [startup] }).ok, false,
      'a previous good frame or usable fallback must not erase a later page failure');
    await page.locator('#stack-search').fill('render');
    const nextSource = page.locator('#stack-tree button').filter({ hasText: /^(?:snapshot\.ts \/ )?render(?:$| ·)/u }).first();
    await nextSource.focus(); await nextSource.press('Enter');
    await page.waitForFunction(() => document.getElementById('stack-breadcrumb').textContent.includes('render'));
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    assert.match(await page.locator('#stack-breadcrumb').textContent(), /render/);
  } else if (fault !== 'render-noop') {
    assert.equal(classifyQualificationPhase({ ...diagnostics.phase, expected: [startup] }).ok, false,
      'the same actual required-resource/shader errors must fail an ordinary positive phase');
    assert.ok(diagnostics.phase.events.some(event => fault === 'module-404'
      ? event.type === 'http' && event.status === 404 && event.url === moduleUrl
      : event.type === 'console' && event.message.startsWith('THREE.WebGLProgram: Shader Error')));
  }
  diagnostics.phase.preferenceAdmission = await page.evaluate(async () => {
    const { state } = await import('/isomap/state.js');
    return { configured: Boolean(state.config?.preferences),
      availabilityFailed: state.settingsSession?.availabilityFailed ?? null,
      availabilityError: state.settingsSession?.availabilityError ?? null,
      status: state.settingsSession?.status ?? null };
  });
  diagnostics.assertClean();
  return { scenario, outcome: 'broken 3D rejected; source navigation remains available',
    frameRejection: rejected.message, priorFrame, injection, softwareRenderer: true, hardwareQualification: false };
};
