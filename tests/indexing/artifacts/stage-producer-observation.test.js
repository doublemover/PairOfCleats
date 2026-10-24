import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { observeStageProducer } from '../../../src/index/build/stage-provenance.js';

// Exercise the actual prepared checkout and real Git processes. Count process
// work rather than asserting a machine-dependent latency or fabricating setup.
const revision = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const originalSpawn = childProcess.spawn, commands = [];
childProcess.spawn = function(command, args, options) {
  if (command === 'git') commands.push([...args]);
  return originalSpawn.call(this, command, args, options);
};
syncBuiltinESMExports();
try {
  const producer = await observeStageProducer();
  assert.equal(producer.revision, revision); assert.match(producer.identity, /^[a-f0-9]{64}$/);
  assert.match(producer.bootstrap, /^[a-f0-9]{64}$/);
  assert.equal(producer.evidenceScope, 'observed-implementation-files-and-bootstrap-receipt');
  assert.ok(commands[0].includes('status'), 'the first observation combines actual HEAD and membership');
  const selectedPaths = commands[0].slice(commands[0].lastIndexOf('--') + 1);
  const clean = childProcess.execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--',
    ...selectedPaths], { encoding: 'utf8' }).length === 0;
  // An index-only change can be dirty to Git status while the final worktree
  // bytes equal HEAD. That legitimately retains the exact fallback inventory.
  if (clean) {
    assert.equal(producer.dirtyFiles, 0);
    assert.equal(commands.length, 2, 'clean provenance needs only before/after Git status observations');
    assert.ok(commands.every(args => args.includes('status') && args.includes('--porcelain=v2')));
  } else {
    assert.ok(commands.some(args => args.includes('diff')), 'dirty implementation files retain exact content inventory');
    assert.ok(commands.some(args => args.includes('ls-files')), 'untracked implementation files stay in provenance');
  }
} finally { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); }
console.log('Producer provenance retains actual HEAD/bootstrap/dirty authority with bounded clean Git process work.');
