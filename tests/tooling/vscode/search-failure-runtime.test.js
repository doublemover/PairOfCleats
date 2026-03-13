#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  prepareVsCodeFixtureWorkspace,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-search-failures-'
});

const harness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  activeFile: workspace.resolvePath('src', 'app.ts')
});
harness.activate();

harness.queuedResults.push({
  throw: new Error('sync search spawn failure')
});
await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
assert.match(harness.errorMessages.shift(), /PairOfCleats search failed to start/i);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /sync search spawn failure/i.test(event.line)));

harness.queuedResults.push({
  code: 0,
  stdout: ''
});
await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
assert.equal(harness.errorMessages.shift(), 'PairOfCleats search returned no JSON output.');
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /\[search\] parse failure kind=empty-output/i.test(event.line)));

harness.queuedResults.push({
  code: 0,
  stdout: '{',
  stderr: 'stderr detail'
});
await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
assert.match(harness.errorMessages.shift(), /returned invalid JSON/i);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /stderr detail/i.test(event.line)));

harness.quickPickQueue.push((items) => items[0]);
harness.fakeVscode.workspace.openTextDocument = async () => {
  throw new Error('cannot open selected hit');
};
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/app.ts', startLine: 1, score: 1 }]
  })
});
await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
assert.match(harness.errorMessages.shift(), /could not open/i);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /cannot open selected hit/i.test(event.line)));

console.log('vscode search failure runtime test passed');
