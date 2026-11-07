import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { probeNativePackage } from './native-package-probe.js';
import { buildReadinessReceipt } from '../../tools/setup/readiness.js';
import { CHECKOUT_MUTATION_LOCK, BOOTSTRAP_RECEIPT } from '../../tools/setup/checkout-bootstrap-paths.js';
import { requireCheckoutMutationSession, withCheckoutMutation } from '../../tools/setup/checkout-mutation.js';
import { getCheckoutStageJournal, withCheckoutStageJournal, readCheckoutJournalStatus } from '../../tools/setup/checkout-stage-journal.js';
import { atomicWriteJson } from './io/atomic-write.js';
import { readJsonResourceTextSync } from './file-read-resource.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from './io/file-identity.js';

export { BOOTSTRAP_RECEIPT };
export const BOOTSTRAP_RECEIPT_VERSION = 3;
const VERIFICATION_POLICY = 'original-checkout-session-journal-and-generation-around-complete-native-probes.v2';
const verifications = new WeakMap();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const BOOTSTRAP_INPUTS = Object.freeze(['package.json', 'package-lock.json', '.nvmrc',
  'tools/setup/checkout-bootstrap.js', 'tools/setup/checkout-bootstrap-arguments.js',
  'tools/setup/checkout-bootstrap-paths.js', 'tools/setup/checkout-mutation.js',
  'tools/setup/checkout-stage-journal.js',
  'tools/setup/checkout-evidence-files.js',
  'tools/setup/checkout-evidence-records.js', 'tools/setup/checkout-evidence-retention.js',
  'tools/setup/checkout-recovery.js',
  'tools/setup/patch-stage.js',
  'tools/setup/task-progress.js',
  'tools/setup/task-progress-output.js',
  'tools/setup/summary-output.js',
  'tools/setup/owned-command.js',
  'tools/setup/postinstall.js',
  'src/shared/locks/file-lock-publication.js', 'src/shared/io/file-identity.js',
  'src/shared/file-read-resource.js',
  'src/shared/locks/file-lock-producer-observations.js',
  'src/shared/io/atomic-write.js', 'src/shared/metrics/atomic-persistence.js',
  'tools/setup/preflight.js', 'src/shared/direct-execution.js', 'tools/setup/apply-patches.js', 'tools/setup/rebuild-native.js',
  'tools/setup/rebuild-native-sqlite.js', 'tools/setup/readiness.js', 'src/shared/native-package-probe.js',
  'src/shared/native-onnx-probe.js',
  'tools/setup/bootstrap-tasks.js', 'tools/setup/native-build-plan.js',
  'src/shared/concurrency/scheduler-core/dispatch.js', 'src/shared/concurrency/scheduler-core/shutdown.js',
  'src/shared/concurrency/scheduler-core/index.js',
  'tools/setup/native-command-result.js',
  'tools/setup/rebuild-native-exit.js',
  'tools/setup/native-failure-summary.js',
  'tools/setup/native-diagnostics.js',
  'src/shared/abort.js', 'src/shared/subprocess/errors.js', 'src/shared/subprocess/runner-async.js',
  'tools/setup/windows-capability.js',
  'src/shared/bootstrap-readiness.js', 'src/lang/tree-sitter/native-runtime.js',
  'src/lang/tree-sitter/native-grammar-binding.js']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = () => ({ node: process.version, abi: process.versions.modules,
  platform: process.platform, arch: process.arch });
const supportedNodeRuntime = () => {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  return major === 26 && (minor > 12 || (minor === 12 && patch >= 1));
};
const requireNoCheckoutMutation = root => {
  try { fs.lstatSync(path.join(root, CHECKOUT_MUTATION_LOCK)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Checkout dependency mutation or retained original work is active; wait for the original owner to retire.');
};
const readiness = (ready, reason = null) => ({
  ...buildReadinessReceipt({ items: [{ id: 'bootstrap', required: true,
    state: ready ? 'available-and-verified' : 'unverified', reason,
    verificationLevel: ready ? 'setup-inputs-artifact-metadata-with-explicit-capabilities' : null }] }), reason
});
const signature = file => {
  const stat = fs.statSync(file);
  return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode];
};
const readBounded = (file, limit = MAX_RECEIPT_BYTES) => {
  if (fs.statSync(file).size > limit) throw new Error(`Readiness input exceeds its byte bound: ${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length > limit) throw new Error(`Readiness input exceeds its byte bound: ${file}`);
  return bytes;
};
const inputHashes = root => {
  const files = [...BOOTSTRAP_INPUTS];
  const patches = path.join(root, 'patches');
  if (fs.existsSync(patches)) {
    const names = fs.readdirSync(patches).sort();
    if (names.length > 128) throw new Error('Bootstrap patch inventory exceeds its bound.');
    for (const name of names) if (name.endsWith('.patch')) files.push(`patches/${name}`);
  }
  return files.map(relative => [relative, hash(readBounded(path.join(root, relative)))]);
};
export const captureBootstrapInputs = root => inputHashes(root);
const safeFile = (root, relative) => {
  if (typeof relative !== 'string' || !relative.startsWith('node_modules/')
    || relative.includes('\\') || relative.split('/').some(part => part === '..' || !part)) {
    throw new Error('Invalid bootstrap artifact path.');
  }
  return path.join(root, relative);
};

const captureGeneration = root => {
  root = fs.realpathSync(root);
  const pkg = JSON.parse(readBounded(path.join(root, 'package.json')));
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();
  for (const name of declared) {
    if (!fs.existsSync(path.join(root, 'node_modules', name, 'package.json'))) {
      throw new Error(`Required checkout dependency is missing: ${name}. Run npm run bootstrap:ci.`);
    }
  }
  const inputs = inputHashes(root), artifacts = [], pending = ['node_modules'];
  const addArtifact = relative => {
    if (artifacts.length === 10000) throw new Error('Bootstrap artifact inventory exceeds its bound.');
    artifacts.push([relative, signature(path.join(root, relative))]);
  };
  let visited = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = fs.opendirSync(path.join(root, relative));
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++visited > 500000) throw new Error('Bootstrap inventory exceeds its file bound.');
        if (entry.name === '.cache' || entry.name === '.bin' || entry.name.startsWith('.pairofcleats-bootstrap')) continue;
        const child = relative + '/' + entry.name;
        if (entry.isDirectory()) pending.push(child);
        else if (entry.isFile() && (entry.name === 'package.json' || entry.name === '.package-lock.json'
          || /\.(?:node|dll|dylib|so(?:\.\d+)*)$/.test(entry.name))) {
          addArtifact(child);
        }
      }
    } finally { directory.closeSync(); }
  }
  // Package patch targets are part of readiness even when they are plain JS/C.
  for (const [relative] of inputs) if (relative.startsWith('patches/')) {
    const text = readBounded(path.join(root, relative)).toString('utf8');
    for (const match of text.matchAll(/^\+\+\+ b\/(node_modules\/[^\r\n]+)$/gm)) {
      safeFile(root, match[1]); addArtifact(match[1]);
    }
  }
  return { root, runtime: runtime(), inputs, declared, artifacts: artifacts.sort((a, b) => a[0].localeCompare(b[0])) };
};
const generationId = snapshot => hash(JSON.stringify(snapshot));
const verificationFailure = message => Object.assign(new Error(message), { code: 'ERR_BOOTSTRAP_VERIFICATION_CHANGED' });

/** Capture immediately before the complete native probes. This opaque original
 * handle binds that verifier's generation, never a serialized success claim.
 * Artifact evidence retains the existing metadata contract, not content hashing.
 */
export const captureBootstrapVerification = (root, { session } = {}) => {
  if (!supportedNodeRuntime()) throw new Error('This checkout requires Node.js >=26.12.1 <27.');
  requireCheckoutMutationSession(root, session);
  const journal = getCheckoutStageJournal(session);
  if (!journal) throw verificationFailure('Bootstrap verification requires its original active checkout journal.');
  const snapshot = captureGeneration(root), id = generationId(snapshot);
  const handle = Object.freeze({ kind: 'bootstrap-verification-generation', generationId: id });
  verifications.set(handle, { root: snapshot.root, id, session, journal }); return handle;
};

/** Called only after complete native and patch verification. The publication
 * consumes its original pre-probe capture and rejects any changed generation.
 */
export const recordBootstrapReadiness = async (root, verifiedPackages, { nativeCapabilities = [], verification } = {}) => {
  const expected = verification && verifications.get(verification);
  if (!expected) throw verificationFailure('An original unconsumed pre-probe bootstrap generation is required.');
  verifications.delete(verification);
  const capturedPackages = [...verifiedPackages].sort(), capturedCapabilities = structuredClone(nativeCapabilities);
  requireCheckoutMutationSession(root, expected.session);
  if (getCheckoutStageJournal(expected.session) !== expected.journal) throw verificationFailure('Bootstrap publication lost its original journal.');
  return withCheckoutMutation(root, () => withCheckoutStageJournal(root, expected.session, null, async journal => {
    const checkGeneration = () => {
      requireCheckoutMutationSession(root, expected.session);
      if (getCheckoutStageJournal(expected.session) !== expected.journal || journal !== expected.journal) throw verificationFailure('Bootstrap publication lost its original journal.');
      const snapshot = captureGeneration(root);
      if (expected.root !== snapshot.root || expected.id !== generationId(snapshot)) throw verificationFailure('Bootstrap setup inputs or dependency artifacts changed during verification; re-verify the current generation.');
      return snapshot;
    };
    const current = checkGeneration();
    const receipt = { schemaVersion: BOOTSTRAP_RECEIPT_VERSION, ...current,
      verification: { generationId: expected.id, policy: VERIFICATION_POLICY, checkoutRunId: expected.session.runId, journalPlanId: journal.planId },
      verifiedPackages: capturedPackages, nativeCapabilities: capturedCapabilities };
    if (Buffer.byteLength(JSON.stringify(receipt)) > MAX_RECEIPT_BYTES) throw new Error('Bootstrap receipt exceeds its byte bound.');
    const target = path.join(current.root, BOOTSTRAP_RECEIPT);
    const published = await atomicWriteJson(target, receipt, { mkdir: false, durable: true, spaces: 0, newline: false, beforeCommit: checkGeneration });
    if (published !== target) throw verificationFailure('Bootstrap readiness publication did not confirm its original destination.');
    const identity = persistenceFileIdentity(fs.lstatSync(target, { bigint: true }));
    const actual = readJsonResourceTextSync(target, stat => {
      if (stat.size > MAX_RECEIPT_BYTES) throw verificationFailure('Published bootstrap receipt exceeds its read bound.');
    }, stat => assertPersistenceFileIdentity(stat, identity));
    assertPersistenceFileIdentity(fs.lstatSync(target, { bigint: true }), identity);
    if (actual !== JSON.stringify(receipt)) throw verificationFailure('Published bootstrap receipt differs from its original verified record.');
    requireCheckoutMutationSession(root, expected.session);
    journal.bindVerifiedGeneration(expected.id);
    return receipt;
  }), { session: expected.session });
};

/** Report identity differences independently; executable location is context, not receipt identity. */
export const compareBootstrapIdentity = (receipt, { root, runtime: actual = runtime() }) => {
  const mismatches = [];
  const check = (field, expected, observed) => {
    if (expected !== observed) mismatches.push({ field, expected, observed: observed ?? null });
  };
  check('schemaVersion', BOOTSTRAP_RECEIPT_VERSION, receipt?.schemaVersion);
  check('root', root, receipt?.root);
  for (const field of ['node', 'abi', 'platform', 'arch']) check(`runtime.${field}`, actual[field], receipt?.runtime?.[field]);
  return mismatches;
};

export const inspectBootstrapReadiness = async ({ root = ROOT, probeNatives = true } = {}) => {
  let code = 'ERR_BOOTSTRAP_INSPECTION';
  let mismatches = [];
  try {
    root = fs.realpathSync(root);
    code = 'ERR_BOOTSTRAP_RUNTIME_UNSUPPORTED';
    if (!supportedNodeRuntime()) throw new Error('This checkout requires Node.js >=26.12.1 <27.');
    code = 'ERR_BOOTSTRAP_MUTATION_ACTIVE'; requireNoCheckoutMutation(root);
    const file = path.join(root, BOOTSTRAP_RECEIPT);
    code = 'ERR_BOOTSTRAP_RECEIPT_MISSING';
    if (!fs.existsSync(file)) throw new Error('Verified bootstrap receipt is missing; installation is incomplete or has not been verified.');
    code = 'ERR_BOOTSTRAP_RECEIPT_INVALID';
    const receiptSignature = JSON.stringify(signature(file));
    const receipt = JSON.parse(readBounded(file));
    mismatches = compareBootstrapIdentity(receipt, { root });
    code = 'ERR_BOOTSTRAP_IDENTITY_MISMATCH';
    if (mismatches.length) throw new Error('Bootstrap identity differs: ' + mismatches.map(item => item.field).join(', ') + '.');
    code = 'ERR_BOOTSTRAP_VERIFICATION_INVALID';
    if (receipt.verification?.policy !== VERIFICATION_POLICY || receipt.verification?.generationId !== generationId({
      root: receipt.root, runtime: receipt.runtime, inputs: receipt.inputs, declared: receipt.declared, artifacts: receipt.artifacts
    })) throw new Error('Bootstrap receipt lacks its matching verification-generation evidence; run the native/patch verifier.');
    code = 'ERR_BOOTSTRAP_JOURNAL_INCOMPLETE';
    const journal = readCheckoutJournalStatus(root);
    if (!journal || journal.state !== 'completed' || journal.runId !== receipt.verification.checkoutRunId
      || journal.planId !== receipt.verification.journalPlanId || journal.generationId !== receipt.verification.generationId) throw new Error(
      'Bootstrap readiness is not bound to its completed original checkout journal; run fresh native/patch verification.');
    code = 'ERR_BOOTSTRAP_INPUT_DRIFT';
    if (JSON.stringify(receipt.inputs) !== JSON.stringify(inputHashes(root))) throw new Error('Bootstrap setup inputs, package lock or required patches have changed.');
    code = 'ERR_BOOTSTRAP_EVIDENCE_INCOMPLETE';
    if (!Array.isArray(receipt.artifacts) || !receipt.artifacts.length || receipt.artifacts.length > 10000
      || !Array.isArray(receipt.verifiedPackages) || !receipt.verifiedPackages.includes('tree-sitter')
      || !receipt.verifiedPackages.includes('better-sqlite3')) throw new Error('Bootstrap verification evidence is incomplete.');
    for (const [relative, expected] of receipt.artifacts) {
      code = 'ERR_BOOTSTRAP_ARTIFACT_DRIFT';
      if (JSON.stringify(signature(safeFile(root, relative))) !== JSON.stringify(expected)) {
        throw new Error(`Verified dependency artifact changed: ${relative}`);
      }
    }
    // Load success alone does not detect lazy SQLite binding failures or an
    // unusable tree-sitter grammar. Reuse the actual native activation probes.
    for (const name of probeNatives ? ['better-sqlite3', 'tree-sitter'] : []) {
      code = 'ERR_BOOTSTRAP_NATIVE_UNUSABLE';
      const result = await probeNativePackage(root, name);
      if (!result.ok) throw new Error(`${name} is not usable: ${result.message}`);
    }
    code = 'ERR_BOOTSTRAP_RECEIPT_REPLACED';
    if (JSON.stringify(signature(file)) !== receiptSignature) throw new Error('Bootstrap receipt changed during inspection; retry after the active verifier finishes.');
    code = 'ERR_BOOTSTRAP_MUTATION_ACTIVE'; requireNoCheckoutMutation(root);
    code = 'ERR_BOOTSTRAP_JOURNAL_REPLACED';
    const finalJournal = readCheckoutJournalStatus(root);
    if (!finalJournal || finalJournal.runId !== journal.runId || finalJournal.planId !== journal.planId
      || finalJournal.generationId !== journal.generationId || finalJournal.state !== 'completed') throw new Error('Checkout journal changed during readiness inspection.');
    code = 'ERR_BOOTSTRAP_RECEIPT_REPLACED';
    if (JSON.stringify(signature(file)) !== receiptSignature) throw new Error('Bootstrap receipt changed during journal inspection.');
    code = 'ERR_BOOTSTRAP_MUTATION_ACTIVE'; requireNoCheckoutMutation(root);
    return { ...readiness(true), code: null, mismatches: [], nativeProbes: probeNatives ? 'passed' : 'not-run' };
  } catch (error) {
    return { ...readiness(false, error?.message || String(error)), code, mismatches,
      nativeProbes: probeNatives ? 'incomplete' : 'not-run',
      nextAction: ['ERR_BOOTSTRAP_RECEIPT_REPLACED', 'ERR_BOOTSTRAP_MUTATION_ACTIVE'].includes(code) ? 'retry-after-verifier'
        : code === 'ERR_BOOTSTRAP_IDENTITY_MISMATCH' && mismatches.every(item => item.field.startsWith('runtime.'))
          ? 'verify-natives-and-patches-under-selected-runtime' : 'locked-bootstrap' };
  }
};

export const formatBootstrapRequired = (reason, root = ROOT) => [
  '', '======================================================================',
  'PAIR OF CLEATS CANNOT START: BOOTSTRAP REQUIRED',
  '======================================================================', reason,
  `In the PairOfCleats checkout (${root}), run:`, '', '  npm run bootstrap:ci', '',
  'For intentional dependency-resolution changes only: npm run bootstrap',
  'Use Node.js >=26.12.1 <27. Bootstrap installs dependencies, applies required patches',
  'and rebuilds/verifies native modules. Nothing was installed automatically.',
  '======================================================================', ''
].join('\n');

/** Builtin-only entry gate runs before dependency-heavy dynamic imports. No
 * environment bypass: imported libraries are inert; executable paths are gated.
 */
export const requireBootstrap = async ({ root = ROOT } = {}) => {
  const result = await inspectBootstrapReadiness({ root });
  if (result.ready) return;
  const error = Object.assign(new Error(formatBootstrapRequired(result.reason, root)), { code: 'ERR_BOOTSTRAP_REQUIRED' });
  throw error;
};
export const guardBootstrapEntry = async entryUrl => {
  if (!process.argv[1]) return;
  let direct;
  try { direct = fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(entryUrl)); }
  catch { return; }
  if (!direct) return;
  try { await requireBootstrap(); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exit(1); }
};
