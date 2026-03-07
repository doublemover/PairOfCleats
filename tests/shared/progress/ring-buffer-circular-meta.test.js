#!/usr/bin/env node
import assert from 'node:assert/strict';
import { configureLogger, getRecentLogEvents, log } from '../../../src/shared/progress.js';

configureLogger({ enabled: false });

const meta = { name: 'circular' };
meta.self = meta;

log('circular meta test', meta);

const events = getRecentLogEvents();
const last = events[events.length - 1];
assert.ok(last, 'expected a recent log event');
assert.notStrictEqual(last.meta, meta, 'meta should not be stored by reference');
assert.equal(typeof last.meta, 'string', 'expected meta snapshot to be a string');
assert.ok(last.meta.includes('[Circular]'), 'expected circular marker in snapshot');

console.log('progress ring buffer circular meta test passed');
