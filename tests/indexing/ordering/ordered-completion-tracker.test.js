#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createOrderedCompletionTracker } from '../../../src/index/build/indexer/steps/process-files.js';

const tracker = createOrderedCompletionTracker();
tracker.track(Promise.resolve('ok'));
await tracker.wait();

const failedTracker = createOrderedCompletionTracker();
const marker = new Error('ordered append failed');
failedTracker.track(Promise.reject(marker));
await new Promise((resolve) => setTimeout(resolve, 0));

let caught = null;
try {
  await failedTracker.wait();
} catch (err) {
  caught = err;
}

assert.equal(caught, marker, 'expected tracker.wait to rethrow completion failures');

const throwTracker = createOrderedCompletionTracker();
const throwMarker = new Error('ordered completion failed after capacity gate');
throwTracker.track(Promise.reject(throwMarker));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.throws(
  () => throwTracker.throwIfFailed(),
  (err) => err === throwMarker,
  'expected throwIfFailed to surface settled completion failures'
);

console.log('ordered completion tracker test passed');
