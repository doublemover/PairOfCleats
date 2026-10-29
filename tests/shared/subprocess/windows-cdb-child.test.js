import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { WINDOWS_CDB_CHILD_CONTEXT } from '../../../tools/shared/windows-cdb-protocol.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Ordinary small real Node children; no CDB or native crash.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['async-output', 'nonzero-exit', 'truncated-output', 'invalid-context', 'simulated-native-exit', 'phase-checkpoint'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`cdb-child-${selected}`);
const directory = path.join(root, 'attempt'), cwd = path.join(root, 'application-root');
await fs.mkdir(directory); await fs.mkdir(cwd);
let passed = false;
try {
  const module = new URL('../../../tools/shared/windows-cdb-child.js', import.meta.url).href;
  const entry = path.join(directory, 'entry.mjs');
  await fs.writeFile(entry, `import {runWindowsCdbChild} from ${JSON.stringify(module)}; await runWindowsCdbChild();`);
  const application = selected === 'async-output' ? 'setTimeout(()=>{process.stdout.write(JSON.stringify({cwd:process.cwd(),finished:true}));process.stderr.write("late stderr");},40);'
    : selected === 'nonzero-exit' ? 'process.stderr.write("intentional ordinary failure");process.exit(7);'
      : selected === 'truncated-output' ? 'process.stdout.write("x".repeat(2*1024*1024));'
        : selected === 'simulated-native-exit' ? 'process.exit(3221225477);'
          : selected === 'phase-checkpoint' ? `import {recordWindowsCdbChildPhase} from ${JSON.stringify(module)};recordWindowsCdbChildPhase('sqlite:update-start');process.stdout.write('{}');`
            : 'process.stdout.write("must not execute");';
  await fs.writeFile(path.join(directory, 'application.mjs'), application);
  const token = randomUUID();
  const result = await spawnSubprocess(process.execPath, [entry], { cwd: directory,
    env: { ...process.env, [WINDOWS_CDB_CHILD_CONTEXT]: JSON.stringify({ token: selected === 'invalid-context' ? 'invalid' : token, directory, cwd }) },
    timeoutMs: 30000, maxOutputBytes: 4096, outputMode: 'string', rejectOnNonZeroExit: false, killTree: true, detached: false });
  if (selected === 'invalid-context') {
    assert.notEqual(result.exitCode, 0);
    assert.equal((await fs.readdir(directory)).includes('child-launch.json'), false);
    assert.equal(result.stdout.includes('must not execute'), false);
  } else {
    const launch = JSON.parse(await fs.readFile(path.join(directory, 'child-launch.json'), 'utf8'));
    const reply = JSON.parse(await fs.readFile(path.join(directory, 'child-exit.json'), 'utf8'));
    assert.equal(launch.token, token); assert.equal(reply.token, token); assert.equal(reply.pid, launch.pid);
    assert.equal(reply.outputFailure, null); assert.ok(Number.isSafeInteger(launch.pid)); assert.ok(launch.pid > 0);
    const stdout = await fs.readFile(path.join(directory, 'child-stdout.bin'));
    if (selected === 'async-output') {
      assert.equal(result.exitCode, 0); assert.equal(reply.exitCode, 0);
      assert.deepEqual(JSON.parse(stdout.toString('utf8')), { cwd, finished: true });
      assert.equal(await fs.readFile(path.join(directory, 'child-stderr.bin'), 'utf8'), 'late stderr');
    }
    if (selected === 'nonzero-exit') { assert.equal(result.exitCode, 7); assert.equal(reply.exitCode, 7); }
    if (selected === 'simulated-native-exit') {
      // Node's exit callback can expose the signed int32 representation. The
      // protocol retains that exact value; both representations have these bits.
      assert.ok([0xC0000005, 0xC0000005 | 0].includes(reply.exitCode), 'only the exact signed/unsigned status is admitted');
      assert.equal(reply.exitCode >>> 0, 0xC0000005);
      assert.notEqual(result.exitCode, 0, 'the native-shaped status remains a failed process');
      assert.equal(result.signal, null);
      assert.equal(process.platform === 'win32' ? result.exitCode >>> 0 : result.exitCode,
        process.platform === 'win32' ? 0xC0000005 : 5, 'the OS child outcome retains its platform exit semantics');
      assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.dmp')), false, 'process.exit never establishes native minidump capture');
    }
    if (selected === 'truncated-output') {
      assert.equal(stdout.length, 1024 * 1024); assert.equal(reply.outputCapture.stdout.bytes, 2 * 1024 * 1024);
      assert.equal(reply.outputCapture.stdout.capturedBytes, stdout.length); assert.equal(reply.outputCapture.stdout.truncated, true);
    }
    const progress = (await fs.readFile(path.join(directory, 'child-progress.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(progress[0].phase, 'child:initialized');
    assert.ok(progress.every((event, index) => event.token === token && event.pid === launch.pid && event.sequence === index + 1));
    assert.equal(progress.at(-1).phase, selected === 'phase-checkpoint' ? 'sqlite:update-start' : 'child:initialized');
  }
  passed = true;
} finally {
  if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
}
console.log(`Real ordinary CDB child wrapper protocol: ${selected}`);
