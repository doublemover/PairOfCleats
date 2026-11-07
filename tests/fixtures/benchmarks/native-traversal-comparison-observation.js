import assert from 'node:assert/strict';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

/** Separate post-parse work pass. Every native getter/method forwards to its
 * captured original; the only algorithm rewrite wraps its actual outer stack.
 */
export const observeTraversalWork = (root, operation) => {
  const restore = [], reads = {}, stacks = [];
  let failed = false, failure, result;
  try {
    for (const key of ['namedChild', 'namedChildCount', 'child', 'childCount', 'childForFieldName', 'childrenForFieldName',
      'parent', 'namedChildren', 'children', 'previousNamedSibling', 'nextNamedSibling', 'firstNamedChild', 'lastNamedChild']) {
      let prototype = Object.getPrototypeOf(root), descriptor;
      while (prototype && !(descriptor = Object.getOwnPropertyDescriptor(prototype, key))) prototype = Object.getPrototypeOf(prototype);
      assert.ok(descriptor, key); assert.equal(descriptor.configurable, true, key); reads[key] = 0;
      const replacement = typeof descriptor.value === 'function' ? { ...descriptor, value: function(...args) {
        reads[key]++; return Reflect.apply(descriptor.value, this, args);
      } } : { ...descriptor, get: function() { reads[key]++; return Reflect.apply(descriptor.get, this, []); } };
      Object.defineProperty(prototype, key, replacement); restore.push(() => Object.defineProperty(prototype, key, descriptor));
    }
    const push = Array.prototype.push, pop = Array.prototype.pop;
    const observeStack = stack => {
      const record = { maximum: stack.length, pushes: 0, pops: 0, length: () => stack.length };
      stacks.push(record);
      return new Proxy(stack, { get(target, key, receiver) {
        if (key === 'push') return (...values) => {
          const result = Reflect.apply(push, target, values); record.pushes += values.length;
          record.maximum = Math.max(record.maximum, target.length); return result;
        };
        if (key === 'pop') return () => { record.pops++; return Reflect.apply(pop, target, []); };
        return Reflect.get(target, key, receiver);
      } });
    };
    result = operation(observeStack);
  } catch (error) { failed = true; failure = error; }
  finally {
    for (const action of restore.reverse()) {
      try { action(); }
      catch (cleanup) { failure = failed ? addStorageFailureContext(failure, {}, cleanup, { secondaryPresent: true }) : cleanup; failed = true; }
    }
  }
  if (failed) throw failure;
  assert.equal(stacks.length, 1, 'Observe the one actual outer gather stack.');
  return { result, reads, outerStack: stacks.map(row => ({ maximum: row.maximum, pushes: row.pushes, pops: row.pops, finalLength: row.length() }))[0],
    scope: 'Separate original-native descriptor pass plus observational outer-array proxy;no parse, native-memory measurement or clean latency. Current work.maxFrontier additionally includes nested callback containers and uses a distinct conservative unit.' };
};
