import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { initViewerShell } from '../../src/map/isometric/client/workspace-shell.js';

const fixture = () => {
  const window = new Window({ url: 'http://127.0.0.1:12345', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(renderIsometricHtml({ mapModel: { nodes: [], edges: [] }, threeUrl: '/three/three.module.js' }).replace(/<script[\s\S]*?<\/script>/g, ''));
  return { window, document: window.document, state: {} };
};
const turn = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const contains = (error, original, visited = new Set()) => {
  if (Object.is(error, original)) return true;
  if (!error || typeof error !== 'object' || visited.has(error)) return false;
  visited.add(error);
  const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  return (cause && contains(cause.value, original, visited))
    || (Object.getOwnPropertyDescriptor(error, 'errors')?.value || []).some(value => contains(value, original, visited));
};
{
  // A native constructor returning after reentrant retirement must still hand
  // its exact returned observer to cleanup before the authority fence throws.
  const f = fixture(); let shell, observes = 0, closes = 0, constructing = false;
  f.window.ResizeObserver = class {
    constructor() { constructing = true; shell = f.state.viewerShell; shell.dispose(); constructing = false; }
    observe() { observes++; }
    disconnect() { assert.equal(constructing, false); closes++; }
  };
  assert.throws(() => initViewerShell(f.state, f.document), /authority/);
  await shell.dispose(); assert.equal(closes, 1); assert.equal(observes, 0); assert.equal(f.state.viewerShell, undefined);
  await f.window.happyDOM.close();
}
{
  const f = fixture(), menu = f.document.getElementById('menu'), scope = f.document.getElementById('summary');
  const children = [...menu.childNodes], parent = scope.parentNode, next = scope.nextSibling;
  const originalReveal = () => {}, removed = [], observers = [];
  f.state.revealInspector = originalReveal;
  const originalRemove = f.document.removeEventListener;
  f.document.removeEventListener = function(...args) { removed.push(args[0]); return Reflect.apply(originalRemove, this, args); };
  f.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.closes = 0; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { assert.equal(this, observers[0]); this.closes++; }
  };
  const shell = initViewerShell(f.state, f.document), help = f.document.getElementById('viewer-help');
  const trigger = [...f.document.querySelectorAll('#stack-bar button')].find(node => node.textContent === 'Explore');
  const originalTrigger = trigger.onclick;
  trigger.click(); assert.equal(shell.active, 'Explore');
  observers[0].disconnect = () => assert.fail('replacement disconnect must not run');
  f.document.removeEventListener = () => assert.fail('replacement document remover must not run');
  const closing = shell.dispose(); assert.equal(shell.dispose(), closing); assert.equal(shell.retired, true);
  await closing;
  assert.equal(observers[0].closes, 1); assert.equal(removed.filter(name => name === 'keydown').length, 1);
  assert.deepEqual([...menu.childNodes], children); assert.equal(scope.parentNode, parent); assert.equal(scope.nextSibling, next);
  assert.equal(f.document.getElementById('viewer-help'), null); assert.equal(help.parentNode, null); assert.equal(trigger.onclick, null);
  assert.equal(f.state.revealInspector, originalReveal); assert.equal(f.state.viewerShell, undefined);
  assert.equal(f.document.getElementById('app').classList.contains('scene-first-workspace'), false);
  assert.equal(f.document.getElementById('app').style.getPropertyValue('--viewer-header-height'), '');
  const previousActive = shell.active; originalTrigger.call(trigger, { currentTarget: trigger }); observers[0].callback();
  assert.equal(shell.choose('Appearance'), false); assert.equal(shell.active, previousActive); assert.equal(shell.pendingOwners.length, 0);
  f.document.removeEventListener = originalRemove;
  await f.window.happyDOM.close();
}
{
  // Actual partial construction preserves the primary and each independent
  // failed remover, while the original observer and other removers still run.
  const f = fixture(), primary = Object.freeze(new Error('observe installed then failed'));
  let closed = 0, removed = 0, failRemove = true, sceneReleased = false, cacheReleased = false;
  const cleanup = Object.freeze(Object.defineProperties(new Error('original key remover failed'), {
    sceneOwnershipReleased: { value: () => sceneReleased }, cacheOwnershipReleased: { value: () => cacheReleased }
  }));
  const originalRemove = f.document.removeEventListener;
  f.document.removeEventListener = function(name, ...args) {
    if (name === 'keydown') { removed++; if (failRemove) throw cleanup; }
    return Reflect.apply(originalRemove, this, [name, ...args]);
  };
  f.window.ResizeObserver = class { observe() { throw primary; } disconnect() { closed++; } };
  let failure;
  try { initViewerShell(f.state, f.document); } catch (error) { failure = error; }
  assert.equal(contains(failure, primary), true);
  const shell = f.state.viewerShell; assert.equal(shell.retired, true);
  await turn(); assert.equal(closed, 1); assert.equal(removed, 1);
  await assert.rejects(shell.dispose(), error => contains(error, cleanup));
  const remover = shell.pendingOwners.find(owner => owner.label === 'original viewer shell keydown subscription');
  assert.ok(remover); failRemove = false; sceneReleased = true;
  await assert.rejects(remover.releaseAsync()); assert.equal(removed, 1);
  cacheReleased = true; await remover.releaseAsync(); assert.equal(removed, 2);
  await shell.resourceOwner.releaseAsync(); assert.equal(closed, 1); assert.equal(f.state.viewerShell, undefined);
  await f.window.happyDOM.close();
}
{
  // The original initial setter may install and throw a falsey value, or may
  // synchronously revoke the shell before any DOM acquisition is authorized.
  for (const mode of ['throw', 'reenter']) {
    const f = fixture(); let installed, closed, lookups = 0;
    const lookup = f.document.getElementById;
    f.document.getElementById = function(...args) { lookups++; return Reflect.apply(lookup, this, args); };
    Object.defineProperty(f.state, 'viewerShell', { configurable: true, get: () => installed, set(value) {
      installed = value;
      if (value) { if (mode === 'throw') throw null; closed = value.dispose(); }
    } });
    let failure;
    try { initViewerShell(f.state, f.document); } catch (error) { failure = error; }
    assert.ok(failure); if (mode === 'throw') assert.equal(contains(failure, null), true);
    const shell = installed; assert.equal(shell.retired, true); assert.equal(lookups, 0);
    await (closed || shell.dispose()); assert.equal(installed, undefined);
    await f.window.happyDOM.close();
  }
}
{
  // Original async settings closure and later sibling publication are separate.
  // No delayed cleanup or old callback can clear that sibling's state or DOM.
  const f = fixture(), shell = initViewerShell(f.state, f.document);
  let finish, closes = 0;
  const session = { dispose() { closes++; return new Promise(resolve => { finish = resolve; }); } };
  shell.adoptSettings(session); const closing = shell.dispose(); await turn(); assert.equal(closes, 1);
  const sibling = { accepted: true }, reveal = () => {}, menu = f.document.getElementById('menu');
  f.state.viewerShell = sibling; f.state.revealInspector = reveal;
  const marker = f.document.createElement('span'); marker.textContent = 'sibling'; menu.append(marker);
  session.dispose = () => assert.fail('sibling settings method cannot be adopted');
  finish(); await closing;
  assert.equal(f.state.viewerShell, sibling); assert.equal(f.state.revealInspector, reveal); assert.equal(marker.parentNode, menu);
  assert.equal(shell.choose('Inspect'), false); assert.equal(closes, 1);
  await f.window.happyDOM.close();
}
console.log('Actual viewer shell partial construction, complete original teardown and sibling revocation controls passed.');
