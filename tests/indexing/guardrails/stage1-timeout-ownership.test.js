import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parse } from 'acorn';
import { registerChildProcessForCleanup, terminateTrackedSubprocesses } from '../../../src/shared/subprocess/tracking.js';

// Exercise the production timeout call expressions with real tracked children.
// Native indexing is not needed to prove which ownership selector they submit.
const source = await fs.readFile(new URL('../../../src/index/build/indexer/steps/process-files.js', import.meta.url), 'utf8');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const reasons = new Set(['stage1_processing_stall_timeout', 'tree_sitter_scheduler_close_timeout']);
const calls = new Map();
const visit = node => {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && node.callee?.name === 'terminateTrackedSubprocesses') {
    const reason = node.arguments[0]?.properties?.find(property => property.key?.name === 'reason')?.value?.value;
    if (reasons.has(reason)) calls.set(reason, source.slice(node.start, node.end));
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) visit(child);
    else if (value && typeof value === 'object') visit(value);
  }
};
visit(ast);
assert.deepEqual([...calls.keys()].sort(), [...reasons].sort(), 'both real timeout routes are covered');
for (const [reason, expression] of calls) {
  const scope = `stage1-timeout-${process.pid}-${reason}:`;
  const children = [], unregister = [];
  const create = async ownershipId => {
    const child = spawn(process.execPath, ['-e', "process.on('message', value => process.send(value)); process.send('ready');"],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    children.push(child);
    unregister.push(registerChildProcessForCleanup(child, { ownershipId, scope: ownershipId, killTree: true }));
    const [message] = await once(child, 'message');
    assert.equal(message, 'ready');
    return child;
  };
  try {
    const owned = await create(`${scope}file`);
    const foreign = await create(`${scope}unrelated`.replace('stage1-timeout-', 'foreign-timeout-'));
    const execute = new Function('terminateTrackedSubprocesses', 'stage1OwnershipPrefix', `return ${expression};`);
    const result = await execute(terminateTrackedSubprocesses, scope);
    assert.deepEqual(result.targetedPids, [owned.pid], reason);
    const reply = once(foreign, 'message');
    foreign.send({ witness: reason });
    const [message] = await reply;
    assert.deepEqual(message, { witness: reason }, 'the other build remains usable after timeout cleanup');
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        child.kill();
        await closed;
      }
    }
    for (const release of unregister) release();
  }
}
console.log('Stage1 stall and scheduler timeout routes terminate only their own tracked subprocesses.');
