#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const read = async (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

const benchEntrypoint = await read('tools/bench/language-repos.js');
const benchRunLoop = await read('tools/bench/language-repos/run-loop.js');
const benchLifecycle = await read('tools/bench/language-repos/lifecycle.js');
const buildIndexIndex = await read('src/integrations/core/build-index/index.js');
const buildIndexStages = await read('src/integrations/core/build-index/stages.js');
const runtimeRuntime = await read('src/index/build/runtime/runtime.js');

assert.doesNotMatch(benchEntrypoint, /display\.error\(/, 'bench-language entrypoint should route operator errors through the bench logger');
assert.doesNotMatch(benchRunLoop, /display\.error\(/, 'bench-language run loop should not bypass the bench logger');
assert.doesNotMatch(benchLifecycle, /display\.error\(/, 'bench-language lifecycle should not bypass the bench logger');
assert.match(benchEntrypoint, /appendLogSync\(/, 'fatal bench-language output should use the sync bench logger path');

assert.doesNotMatch(buildIndexIndex, /log\(`\[warn\]/, 'build-index default warnings should not be emitted as prefixed info logs');
assert.doesNotMatch(buildIndexStages, /\[warn\] Index validation warnings/, 'stage validation warnings should use warning metadata instead of embedded prefixes');
assert.doesNotMatch(runtimeRuntime, /log\(`\[warn\]/, 'runtime envelope warnings should use warning metadata instead of embedded prefixes');

console.log('bench logging routing contract test passed');
