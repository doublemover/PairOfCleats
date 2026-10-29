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
  if (fault === 'module-404') {
    await page.route(moduleUrl, route => route.fulfill({ status: 404, contentType: 'text/javascript', body: 'missing required fixture module' }));
    diagnostics.expect({ type: 'http', url: moduleUrl, statuses: [404], maxCount: 1 });
    diagnostics.expect({ type: 'requestfailed', url: moduleUrl, method: 'GET', message: 'net::ERR_ABORTED', maxCount: 1 });
    diagnostics.expect({ type: 'console', url: moduleUrl,
      messagePattern: '^Failed to load resource: the server responded with a status of 404\\b', maxCount: 1 });
  } else {
    await page.addInitScript(fault => {
      globalThis.__qualificationFault = { fault, intercepted: 0 };
      const original = HTMLCanvasElement.prototype.getContext, contexts = new WeakSet();
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        const gl = Reflect.apply(original, this, [type, ...args]);
        if (!gl || !/^webgl/.test(type) || contexts.has(gl)) return gl;
        contexts.add(gl);
        if (fault === 'shader-failure') {
          const source = gl.shaderSource;
          gl.shaderSource = function(shader, text) {
            globalThis.__qualificationFault.intercepted++;
            return Reflect.apply(source, this, [shader, text + '\npoc_invalid_shader_token\n']);
          };
        } else if (fault === 'render-noop') {
          for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
            if (typeof gl[name] === 'function') gl[name] = () => { globalThis.__qualificationFault.intercepted++; };
        }
        return gl;
      };
    }, fault);
    if (fault === 'shader-failure') diagnostics.expect({ type: 'console',
      url: new URL('/three/three.core.js', url).href,
      messagePattern: '^THREE.WebGLProgram: Shader Error', maxCount: 16 });
  }
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#stack-tree details').length > 0);
  if (fault === 'module-404') await page.waitForFunction(() => document.getElementById('summary').textContent.includes('3D unavailable'));
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.locator('#stack-search').fill('build');
  await page.locator('#stack-tree button').filter({ hasText: /^(?:snapshot\.ts \/ )?build(?:$| ·)/u }).first().click();
  await page.waitForFunction(() => document.getElementById('stack-breadcrumb').textContent.includes('build'));
  let rejected;
  try { await captureRenderedViewerFrame(page); }
  catch (error) { rejected = error; }
  assert.ok(rejected, 'an allocated canvas or functioning hierarchy cannot qualify the injected broken renderer');
  if (fault === 'module-404') assert.match(rejected.message, /no original controls submission owner is active/);
  else assert.match(rejected.message, /pixel invariant failed/);
  const injection = fault === 'module-404' ? { intercepted: 1 } : await page.evaluate(() => globalThis.__qualificationFault);
  assert.ok(injection.intercepted > 0, 'the actual module/shader/draw operation must encounter the fault');
  if (fault !== 'render-noop') {
    assert.equal(classifyQualificationPhase({ ...diagnostics.phase, expected: [startup] }).ok, false,
      'the same actual required-resource/shader errors must fail an ordinary positive phase');
    assert.ok(diagnostics.phase.events.some(event => fault === 'module-404'
      ? event.type === 'http' && event.status === 404 && event.url === moduleUrl
      : event.type === 'console' && event.message.startsWith('THREE.WebGLProgram: Shader Error')));
  }
  diagnostics.assertClean();
  return { scenario, outcome: 'broken 3D rejected; source navigation remains available',
    frameRejection: rejected.message, injection, softwareRenderer: true, hardwareQualification: false };
};
