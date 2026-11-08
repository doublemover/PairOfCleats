import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { withCheckoutStageJournal, CHECKOUT_JOURNAL_STATUS } from '../../../tools/setup/checkout-stage-journal.js';
import { createNativeSetupDiagnostics } from '../../../tools/setup/native-diagnostics.js';
import { getCheckoutEvidenceFiles } from '../../../tools/setup/checkout-evidence-files.js';
import { prepareCheckoutEvidenceRetention } from '../../../tools/setup/checkout-evidence-retention.js';
import { CHECKOUT_EVIDENCE_LIMITS } from '../../../tools/setup/checkout-evidence-records.js';
import { BOOTSTRAP_RECEIPT, CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-evidence-retention/')[1];
assert.ok(['original-closed-manifest', 'recent-failed-and-readiness-retention', 'unregistered-membership-protected',
  'replaced-file-protected', 'protected-quota-before-mutation', 'producer-byte-proof-required', 'single-journal-per-original-session',
  'pending-diagnostic-blocks-completed-status'].includes(mode));
const root = await makeTempDir('checkout-evidence-retention-'), originalNow = Date.now;
let clock = originalNow(); Date.now = () => ++clock;
const base = path.join(root, '.tmp', 'checkout-bootstrap');
const run = async ({ failed = false, native = false } = {}) => {
  let selected, logs; const original = new Error('original stage failure');
  const result = await withCheckoutMutation(root, session => withCheckoutStageJournal(root, session,
    { root, stages: [{ id: 'fixture' }] }, async journal => {
      selected = { runId: session.runId, directory: path.dirname(journal.file), file: journal.file };
      await journal.runStage('fixture', async () => {
        if (native) {
          const diagnostics = createNativeSetupDiagnostics(root, session);
          const result = await diagnostics.run('explicit-fixture-output', [], { stdio: 'pipe' }, async (command, args, options) => {
            options.onStdoutChunk(Buffer.from('retained original bytes')); return { exitCode: 0, signal: null };
          });
          assert.equal(result.diagnostics.evidenceComplete, true); logs = result.diagnostics.logs;
        }
        if (failed) throw original;
        return { ok: true };
      });
    })).then(() => ({ ok: true }), error => ({ ok: false, error }));
  if (failed) { assert.equal(result.ok, false); assert.equal(errorGraphIncludes(result.error, original), true); }
  else if (!result.ok) throw result.error;
  return { ...selected, logs, manifest: path.join(selected.directory, 'evidence-manifest.json'),
    result: JSON.parse(fs.readFileSync(path.join(selected.directory, 'result.json'), 'utf8')) };
};
try {
  if (mode === 'pending-diagnostic-blocks-completed-status') {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), failedStatus = Promise.withResolvers();
    let directory, diagnosticOutcome;
    const rootOutcome = withCheckoutMutation(root, session => withCheckoutStageJournal(root, session,
      { root, stages: [{ id: 'fixture' }] }, journal => journal.runStage('fixture', async () => {
        directory = path.dirname(journal.file);
        const diagnostics = createNativeSetupDiagnostics(root, session, { publish: async (...args) => {
          entered.resolve(); await release.promise; return atomicWriteJson(...args);
        } });
        diagnosticOutcome = diagnostics.run('explicit-fixture-empty-output', [], { stdio: 'pipe' },
          async () => ({ exitCode: 0, signal: null })).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
        await entered.promise; return { ok: true };
      }), { publish: async (...args) => {
        const actual = await atomicWriteJson(...args); if (args[1].state === 'failed') failedStatus.resolve(); return actual;
      } })).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    try {
      await failedStatus.promise;
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, CHECKOUT_JOURNAL_STATUS), 'utf8')).state, 'failed');
      assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'stages.jsonl'), 'utf8').trim().split('\n').at(-1)).state, 'run-failed');
      assert.equal(fs.existsSync(path.join(directory, 'evidence-manifest.json')), false);
      assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    } finally { release.resolve(); }
    const [outer] = await Promise.all([rootOutcome, diagnosticOutcome]); assert.equal(outer.ok, false);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  } else if (mode === 'original-closed-manifest') {
    fs.mkdirSync(path.join(root, 'node_modules'));
    const prior = Buffer.from([123, 34, 255, 0, 125]); fs.writeFileSync(path.join(root, BOOTSTRAP_RECEIPT), prior);
    const selected = await run({ native: true }), manifest = JSON.parse(fs.readFileSync(selected.manifest, 'utf8'));
    assert.equal(manifest.kind, 'checkout-bootstrap-closed-evidence'); assert.equal(manifest.runId, selected.runId);
    assert.equal(manifest.state, 'completed'); assert.equal(manifest.files.length, 6);
    assert.equal(selected.result.originalResources, 'retired');
    for (const record of manifest.files) {
      const actual = fs.readFileSync(path.join(root, record.path));
      assert.equal(actual.length, record.bytes); assert.equal(createHash('sha256').update(actual).digest('hex'), record.sha256);
      assert.equal(String(fs.lstatSync(path.join(root, record.path), { bigint: true }).ino), record.identity.ino);
    }
    assert.deepEqual(fs.readFileSync(path.join(selected.directory, 'prior-readiness.json')), prior);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  } else if (mode === 'recent-failed-and-readiness-retention') {
    const qualified = await run();
    fs.mkdirSync(path.join(root, 'node_modules'));
    // Protection is deliberately conservative metadata, not current readiness.
    fs.writeFileSync(path.join(root, BOOTSTRAP_RECEIPT), JSON.stringify({ verification: { checkoutRunId: qualified.runId } }));
    const failed = await run({ failed: true });
    const obsolete = await run({ native: true });
    const recent = await run(); const latest = await run();
    const summary = await withCheckoutMutation(root, session => prepareCheckoutEvidenceRetention(root, session));
    for (const selected of [qualified, failed, recent, latest]) assert.equal(fs.existsSync(selected.manifest), true);
    assert.equal(fs.existsSync(obsolete.directory), false);
    for (const log of obsolete.logs) assert.equal(fs.existsSync(log.path), false);
    assert.ok(summary.removedRuns >= 1); assert.ok(summary.removedFiles >= 6);
    assert.ok(summary.retainedBytes + summary.reserveBytes <= summary.limitBytes);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, CHECKOUT_JOURNAL_STATUS), 'utf8')).runId, latest.runId);
  } else if (mode === 'unregistered-membership-protected' || mode === 'replaced-file-protected') {
    const protectedRun = await run({ native: true });
    let unexpected;
    if (mode === 'unregistered-membership-protected') {
      unexpected = path.join(protectedRun.directory, 'unexpected-user-note.txt'); fs.writeFileSync(unexpected, 'preserve this');
    } else {
      const file = protectedRun.logs[0].path;
      unexpected = file + '.original'; fs.renameSync(file, unexpected); fs.copyFileSync(unexpected, file);
      // Keep the extra original outside the candidate leaf: rejection must be
      // caused by original inode identity, rather than just extra membership.
      const moved = path.join(root, 'original-retained-log'); fs.renameSync(unexpected, moved); unexpected = moved;
    }
    await run(); await run();
    const summary = await withCheckoutMutation(root, session => prepareCheckoutEvidenceRetention(root, session));
    assert.equal(summary.removedRuns, 0); assert.equal(summary.protectedCount, 1);
    assert.equal(fs.existsSync(protectedRun.manifest), true); assert.equal(fs.existsSync(unexpected), true);
    assert.equal(fs.existsSync(protectedRun.logs[0].path), true);
  } else if (mode === 'protected-quota-before-mutation') {
    await withCheckoutMutation(root, () => {});
    const file = path.join(base, 'unregistered-evidence.bin'); fs.writeFileSync(file, 'small fixture with an explicitly injected large stat');
    const lstat = fsPromises.lstat; let entered = false;
    fsPromises.lstat = async (target, ...args) => {
      const stat = await lstat.call(fsPromises, target, ...args);
      if (path.resolve(target) === file) stat.size = typeof stat.size === 'bigint' ? BigInt(CHECKOUT_EVIDENCE_LIMITS.bytes) : CHECKOUT_EVIDENCE_LIMITS.bytes;
      return stat;
    };
    let failure;
    try {
      failure = await withCheckoutMutation(root, session => withCheckoutStageJournal(root, session,
        { root, stages: [{ id: 'never-admitted' }] }, () => { entered = true; })).catch(error => error);
    } finally { fsPromises.lstat = lstat; }
    assert.equal(failure.code, 'ERR_CHECKOUT_EVIDENCE_RETENTION'); assert.equal(entered, false);
    assert.ok(failure.retainedBytes >= CHECKOUT_EVIDENCE_LIMITS.bytes);
    assert.match(fs.readFileSync(file, 'utf8'), /^small fixture/);
    assert.deepEqual(fs.readdirSync(base).filter(name => name.startsWith('j-')), []);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  } else if (mode === 'producer-byte-proof-required') {
    await withCheckoutMutation(root, session => {
      const directory = fs.mkdtempSync(path.join(base, 'j-')), file = path.join(directory, 'stages.jsonl');
      const group = getCheckoutEvidenceFiles(root, session), owner = group.open(file), bytes = Buffer.from('actual original bytes');
      owner.runSync(descriptor => { assert.equal(descriptor.write(bytes, 0, bytes.length, null), bytes.length); });
      assert.throws(() => group.closedFiles(), /producer byte extent and hash/);
      assert.throws(() => group.sealClosed(file, {}), /producer byte extent and hash/);
      assert.throws(() => group.sealClosed(file, { bytes: bytes.length, sha256: '0'.repeat(64) }), /recorded hash/);
      group.sealClosed(file, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      assert.equal(group.closedFiles().files.length, 1);
      fs.writeFileSync(file, Buffer.alloc(bytes.length, 0x62));
      assert.throws(() => group.closedFiles(), /sealed original file|recorded hash/);
      assert.equal(fs.existsSync(file), true);
    });
  } else {
    await withCheckoutMutation(root, async session => {
      const plan = { root, stages: [{ id: 'only' }] };
      await withCheckoutStageJournal(root, session, plan, journal => journal.runStage('only', () => ({ ok: true })));
      let entered = false;
      await assert.rejects(withCheckoutStageJournal(root, session, plan, () => { entered = true; }), /no longer admits borrowed work/);
      assert.equal(entered, false); assert.equal(fs.readdirSync(base).filter(name => name.startsWith('j-')).length, 1);
    });
  }
} finally {
  Date.now = originalNow;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Checkout evidence retention uses closed original producer bytes, bounded inventory and exact registered text files');
