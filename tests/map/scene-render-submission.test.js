import assert from 'node:assert/strict';
import { createSceneRenderSubmissionOwner, observeNextSceneRender } from '../../src/map/isometric/client/rendering/scene-render-submission.js';
import { captureControlsRuntimeCallbacks } from '../../src/map/isometric/client/controls-runtime-callbacks.js';
import { createRenderLoop } from '../../src/map/isometric/client/render-loop.js';
import { createControlsLifetime } from '../../src/map/isometric/client/controls-lifetime.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const make = () => {
  const frames = [], errors = [], native = [], renderer = { info: { render: { frame: 0, calls: 0, triangles: 0 } } };
  const state = { renderer, scene: { uuid: 'scene' }, camera: {}, map: { version: 'model-one' }, layoutMetrics: {}, geometryRevision: 1,
    fileGroup: { uuid: 'files' }, memberGroup: { uuid: 'members' }, edgeGroup: { uuid: 'edges' } };
  let current = true, during = () => {};
  renderer.render = function(scene, camera) {
    assert.equal(this, renderer); assert.equal(scene, state.scene); assert.equal(camera, state.camera);
    native.push('render'); during(); this.info.render.frame++; this.info.render.calls = 3; this.info.render.triangles = 80;
  };
  const captured = captureControlsRuntimeCallbacks(renderer, ['render'], callback => callback, () => current);
  const owner = createSceneRenderSubmissionOwner({ state, renderer, render: captured.render, isCurrent: () => current });
  const observe = () => observeNextSceneRender(renderer, { onFrame: row => { native.push('observe'); frames.push(row); }, onError: error => { errors.push(error); } });
  return { state, renderer, owner, frames, errors, native, observe, setDuring: callback => { during = callback; }, retireAuthority: () => { current = false; } };
};

if (selected === 'captured-operation') {
  const fixture = make();
  fixture.renderer.render = () => assert.fail('late replacement has no original captured render authority');
  fixture.observe(); fixture.owner.submit(fixture.state.scene, fixture.state.camera);
  assert.deepEqual(fixture.native, ['render', 'observe']);
  assert.equal(fixture.frames[0].frameBefore, 0); assert.equal(fixture.frames[0].frame, 1);
  assert.equal(fixture.frames[0].geometryRevision, 1); assert.deepEqual(fixture.frames[0].groups, ['files', 'members', 'edges']);
  assert.equal(Object.isFrozen(fixture.frames[0]), true); assert.equal(Object.isFrozen(fixture.frames[0].groups), true);
  fixture.owner.submit(fixture.state.scene, fixture.state.camera);
  assert.equal(fixture.frames.length, 1, 'each observer is consumed once'); fixture.owner.dispose();
} else if (selected === 'generation-change') {
  for (const change of [state => { state.map = {}; }, state => { state.layoutMetrics = {}; },
    state => { state.geometryRevision++; }, state => { state.fileGroup = {}; }, state => { state.preparingScene = true; },
    state => { state.contextLost = true; }]) {
    const fixture = make(); fixture.observe(); fixture.setDuring(() => change(fixture.state));
    fixture.owner.submit(fixture.state.scene, fixture.state.camera);
    assert.equal(fixture.frames.length, 0); assert.match(fixture.errors[0].message, /generation changed/u); fixture.owner.dispose();
  }
} else if (selected === 'native-failure') {
  const fixture = make(), primary = new Error('actual original shader/render failure');
  fixture.observe(); fixture.setDuring(() => { throw primary; });
  assert.throws(() => fixture.owner.submit(fixture.state.scene, fixture.state.camera), error => error === primary);
  assert.equal(fixture.frames.length, 0); assert.equal(fixture.errors[0], primary); fixture.owner.dispose();
} else if (selected === 'observer-lifetime') {
  const fixture = make(), cancel = fixture.observe();
  assert.throws(fixture.observe, /already pending/u); cancel(); cancel(); fixture.observe();
  fixture.owner.dispose(); fixture.owner.dispose();
  assert.equal(fixture.frames.length, 0); assert.equal(fixture.errors.length, 1);
  assert.throws(fixture.observe, /no original controls/u);
  fixture.owner.submit(fixture.state.scene, fixture.state.camera); assert.equal(fixture.native.length, 0);
  const replacement = createSceneRenderSubmissionOwner({ state: fixture.state, renderer: fixture.renderer, render: () => {}, isCurrent: () => true });
  fixture.owner.dispose();
  const cancelReplacement = fixture.observe(); cancelReplacement(); replacement.dispose();
} else if (selected === 'retirement-during-render') {
  const fixture = make(); fixture.observe(); fixture.setDuring(fixture.owner.dispose);
  fixture.owner.submit(fixture.state.scene, fixture.state.camera);
  assert.equal(fixture.frames.length, 0); assert.equal(fixture.errors.length, 1);
  assert.equal(fixture.native.filter(value => value === 'render').length, 1);
} else if (selected === 'noop-submission') {
  const state = { scene: { uuid: 'blank' }, camera: {}, map: {}, layoutMetrics: {}, geometryRevision: 1 }, renderer = { info: { render: { frame: 1, calls: 0, triangles: 0 } } };
  state.renderer = renderer;
  const owner = createSceneRenderSubmissionOwner({ state, renderer, render: () => {}, isCurrent: () => true });
  let receipt;
  observeNextSceneRender(renderer, { onFrame: value => { receipt = value; }, onError: error => { throw error; } });
  owner.submit(state.scene, state.camera);
  assert.equal(receipt.frame, receipt.frameBefore, 'a no-op cannot manufacture a native frame counter');
  assert.equal(receipt.calls, 0); assert.equal(receipt.triangles, 0); owner.dispose();
} else if (selected === 'controls-loop') {
  const fixture = make(), callbacks = [], lifetime = createControlsLifetime(fixture.state);
  let submissions, loop;
  lifetime.construct(() => {
    lifetime.onDetach(fixture.owner.dispose);
    submissions = lifetime.adopt(fixture.owner, 'render submission composition', ['submit']);
    loop = lifetime.adopt(createRenderLoop({ render: lifetime.wrap(() => { submissions.submit(fixture.state.scene, fixture.state.camera); return false; }),
      request: callback => { callbacks.push(callback); return callbacks.length; }, cancel: () => {} }), 'frame loop composition', ['invalidate']);
  });
  fixture.observe(); loop.invalidate(); assert.equal(fixture.frames.length, 0, 'registration never bypasses the real RAF/render owner');
  callbacks[0](100); assert.equal(fixture.frames.length, 1); assert.deepEqual(fixture.native, ['render', 'observe']);
  fixture.observe(); lifetime.dispose(); assert.equal(fixture.errors.length, 1);
  submissions.submit(fixture.state.scene, fixture.state.camera); assert.equal(fixture.frames.length, 1);
} else assert.fail(`Unknown scene render submission control: ${selected}`);
console.log(`scene render submission ${selected} control`);
