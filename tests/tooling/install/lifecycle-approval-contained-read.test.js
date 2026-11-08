import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildToolInstallReceipt, writeToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';
import { planToolLifecycle, applyToolLifecyclePlan, readToolLifecycleApproval, TOOL_LIFECYCLE_PLAN_VERSION } from '../../../tools/tooling/lifecycle.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual canonical receipt/plan and bounded descriptor owner.
// No installer, executable, real CLI/child, IPC, native binding or symlink run.
const root = await makeTempDir('poc-lifecycle-approval-read-');
const open = fsp.open, lstat = fs.lstatSync;
try {
  const toolingRoot = path.join(root, 'tooling'); await fsp.mkdir(toolingRoot);
  const command = path.join(toolingRoot, 'inert-consumer');
  await fsp.writeFile(command, 'canonical receipt consumer bytes; never executed');
  const toolId = 'approval-read-fixture';
  writeToolInstallReceipt(toolingRoot, buildToolInstallReceipt({ tool: { id: toolId }, toolingRoot,
    result: { path: command, probe: { ok: false } } }));
  const plan = await planToolLifecycle({ toolingRoot, id: toolId, operation: 'verify' });
  assert.equal(plan.schemaVersion, TOOL_LIFECYCLE_PLAN_VERSION);
  const file = path.join(root, 'approved.json');
  const bytes = Buffer.from(JSON.stringify(plan)); await fsp.writeFile(file, bytes);
  const selection = { toolingRoot, toolId };
  const approved = await readToolLifecycleApproval(file, selection);
  assert.deepEqual(approved, plan);
  const applied = await applyToolLifecyclePlan(approved);
  assert.equal(applied.ok, true); assert.equal(applied.applied, false, 'ordinary verification does not execute/adopt the tool');
  const pathnameRead = fs.readFileSync;
  try {
    fs.readFileSync = (target, ...args) => {
      if (target === file) assert.fail('approval cannot use an unchecked pathname read after lstat');
      return pathnameRead(target, ...args);
    };
    assert.deepEqual(await readToolLifecycleApproval(file, selection), plan);
  } finally { fs.readFileSync = pathnameRead; }
  for (const body of [null, [], { ...plan, schemaVersion: TOOL_LIFECYCLE_PLAN_VERSION + 1 }, { ...plan, kind: 'unregistered-kind' },
    { ...plan, planId: 'not-a-plan-identity' }, { ...plan, planId: [plan.planId] }, { ...plan, operation: 'arbitrary-operation' },
    { ...plan, toolingRoot: path.join(root, 'different') }, { ...plan, toolingRoot: './relative-owner' }, { ...plan, toolId: 'different-tool' }]) {
    await fsp.writeFile(file, JSON.stringify(body));
    await assert.rejects(readToolLifecycleApproval(file, selection), /identity\/target/);
  }
  await fsp.writeFile(file, Buffer.alloc(1024 * 1024 + 1, 32));
  await assert.rejects(readToolLifecycleApproval(file, selection), { code: 'ERR_FILE_TOO_LARGE' });
  await fsp.writeFile(file, bytes);
  {
    let changed = false, closes = 0;
    fsp.open = async (target, ...args) => {
      const actual = await open(target, ...args); if (target !== file) return actual;
      return new Proxy(actual, { get(handle, field) {
        if (field === 'read') return async (...readArgs) => {
          if (!changed) { changed = true; await fsp.appendFile(file, Buffer.alloc(1024 * 1024 + 1, 32)); }
          return handle.read(...readArgs);
        };
        if (field === 'close') return async () => { closes += 1; return handle.close(); };
        const value = Reflect.get(handle, field, handle); return typeof value === 'function' ? value.bind(handle) : value;
      } });
    };
    await assert.rejects(readToolLifecycleApproval(file, selection), { code: 'ERR_FILE_CHANGED' });
    assert.equal(changed, true); assert.equal(closes, 1, 'growth refusal still reaches the existing actual descriptor close');
    fsp.open = open;
  }
  await fsp.writeFile(file, bytes);
  {
    fs.lstatSync = (target, ...args) => {
      const stat = lstat(target, ...args); if (path.resolve(target) !== file) return stat;
      return new Proxy(stat, { get(actual, field) {
        if (field === 'isSymbolicLink') return () => true;
        const value = Reflect.get(actual, field, actual); return typeof value === 'function' ? value.bind(actual) : value;
      } });
    };
    await assert.rejects(readToolLifecycleApproval(file, selection), { code: 'ERR_UNSAFE_FILE_PATH' });
    fs.lstatSync = lstat;
  }
  const cancelled = new AbortController(); cancelled.abort(new Error('cancelled approval read'));
  let opens = 0;
  fsp.open = async (...args) => { opens += 1; return open(...args); };
  await assert.rejects(readToolLifecycleApproval(file, { ...selection, signal: cancelled.signal }), /cancelled approval read/);
  assert.equal(opens, 0); fsp.open = open;
  await assert.rejects(readToolLifecycleApproval(file, { toolingRoot: 'relative', toolId }), /launch-selected/);
  assert.deepEqual(await fsp.readFile(command), Buffer.from('canonical receipt consumer bytes; never executed'));
  assert.deepEqual(await fsp.readFile(file), bytes);
} finally { fsp.open = open; fs.lstatSync = lstat; await rmDirRecursive(root); }
console.log('Lifecycle approval reads retain existing bounded descriptor and launch authority.');
