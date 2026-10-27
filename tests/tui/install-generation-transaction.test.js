import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installTuiGeneration, resolveSelectedTuiGeneration } from '../../tools/tui/install-generation.js';
import { resolveTuiInstallLayout } from '../../tools/tui/targets.js';
import { createTuiArtifactBytes } from '../helpers/tui/install-artifact.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { runNode } from '../helpers/run-node.js';
import { ensureTestingEnv } from '../helpers/test-env.js';

ensureTestingEnv(process.env);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const target = { triple: 'x86_64-pc-windows-msvc', platform: 'windows', artifactName: 'fixture-tui.exe' };
const inputFor = (root, installRoot, buildArtifact, buildManifest, selectedTarget = target) => ({ root,
  target: selectedTarget, layout: resolveTuiInstallLayout({ root, installRoot,
    triple: selectedTarget.triple, artifactName: selectedTarget.artifactName }),
  resolveBuild: async () => ({ built: false, buildArtifact, buildManifest }) });

if (process.argv[2] === '--interrupt-staging') {
  const { root, installRoot, buildArtifact, buildManifest } = JSON.parse(process.argv[3]);
  await installTuiGeneration({ ...inputFor(root, installRoot, buildArtifact, buildManifest),
    onPhase: phase => { if (phase === 'promotion-validation') process.exit(73); } });
  throw new Error('Interruption control did not reach original staging.');
} else {
  const temporary = await makeTempDir('tui-generation-transaction-');
  try {
    const root = path.join(temporary, 'package'), installRoot = path.join(temporary, 'custom-install');
    await fsp.mkdir(path.join(root, 'tools', 'tui'), { recursive: true });
    await fsp.writeFile(path.join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    await fsp.writeFile(path.join(root, 'tools', 'tui', 'supervisor.js'), '// exact fixture supervisor');
    const artifact = path.join(root, target.artifactName), bytes = createTuiArtifactBytes(target, 'original');
    await fsp.writeFile(artifact, bytes);
    if (process.platform !== 'win32') await fsp.chmod(artifact, 0o755);
    const buildArtifact = { ...target, absoluteArtifactPath: artifact, artifactPath: target.artifactName,
      exists: true, sha256: sha256(bytes) };
    const buildManifest = { manifestPath: path.join(root, 'build-manifest.json'), manifestChecksum: 'a'.repeat(64) };
    const input = inputFor(root, installRoot, buildArtifact, buildManifest);
    const selected = await installTuiGeneration(input);
    const current = await fsp.readFile(input.layout.metadataPath, 'utf8');
    const assertOriginal = async () => {
      assert.equal(await fsp.readFile(input.layout.metadataPath, 'utf8'), current);
      const resolved = resolveSelectedTuiGeneration({ root, layout: input.layout, target, metadata: JSON.parse(current) });
      assert.equal(resolved.binaryPath, selected.binaryPath);
      assert.deepEqual(await fsp.readFile(resolved.binaryPath), bytes);
    };
    for (const phase of ['source-build', 'staging', 'executable-metadata', 'staged-validation',
      'generation-manifest', 'promotion-validation', 'promotion']) {
      const failure = new Error(`fault:${phase}`);
      await assert.rejects(installTuiGeneration({ ...input, onPhase: currentPhase => {
        if (currentPhase === phase) throw failure;
      } }), error => error === failure && error.tuiInstallPhase === phase);
      await assertOriginal();
    }
    const copy = fsp.copyFile;
    fsp.copyFile = async () => { throw Object.assign(new Error('controlled copy failure'), { code: 'EIO' }); };
    try { await assert.rejects(installTuiGeneration(input), /controlled copy failure/); }
    finally { fsp.copyFile = copy; }
    await assertOriginal();
    const open = fsp.open;
    fsp.open = async (file, flags, ...args) => {
      if (String(file).includes(`${path.sep}generations${path.sep}`)
        && path.basename(String(file)).includes('install-manifest') && String(flags).includes('x')) {
        throw Object.assign(new Error('controlled metadata creation failure'), { code: 'EACCES' });
      }
      return open(file, flags, ...args);
    };
    try { await assert.rejects(installTuiGeneration(input), /controlled metadata creation failure/); }
    finally { fsp.open = open; }
    await assertOriginal();
    await fsp.writeFile(artifact, createTuiArtifactBytes(target, 'changed-with-old-hash'));
    await assert.rejects(installTuiGeneration(input), /staged artifact checksum mismatch/);
    await assertOriginal();
    await fsp.writeFile(artifact, bytes);
    const rename = fsp.rename;
    fsp.rename = async (from, to, ...args) => {
      if (path.resolve(to) === input.layout.metadataPath) {
        throw Object.assign(new Error('controlled Windows sharing refusal'), { code: 'EPERM' });
      }
      return rename(from, to, ...args);
    };
    try { await assert.rejects(installTuiGeneration(input), /controlled Windows sharing refusal/); }
    finally { fsp.rename = rename; }
    await assertOriginal();
    const interrupted = runNode([fileURLToPath(import.meta.url), '--interrupt-staging',
      JSON.stringify({ root, installRoot, buildArtifact, buildManifest })], 'interrupted TUI generation',
    process.cwd(), process.env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    assert.equal(interrupted.status, 73, interrupted.stderr);
    await assertOriginal();
    const recovered = await installTuiGeneration(input);
    assert.notEqual(recovered.metadata.generationId, selected.metadata.generationId);
    assert.deepEqual(await fsp.readFile(selected.binaryPath), bytes, 'recovery retains the previous generation');
    const mismatch = { ...recovered.metadata, binary: { ...recovered.metadata.binary, path: '../unowned.exe' } };
    assert.throws(() => resolveSelectedTuiGeneration({ root, layout: input.layout, target, metadata: mismatch }), /identity mismatch/);

    // Hold A during actual staging. Same-target B cannot enter its source phase;
    // another target completes independently under its own canonical lock.
    let stagingReady, releaseStaging, secondEntered = false;
    const ready = new Promise(resolve => { stagingReady = resolve; });
    const barrier = new Promise(resolve => { releaseStaging = resolve; });
    const first = installTuiGeneration({ ...input, onPhase: async phase => {
      if (phase === 'staged-validation') { stagingReady(); await barrier; }
    } });
    first.catch(() => {});
    await ready;
    const second = installTuiGeneration({ ...input, onPhase: phase => {
      if (phase === 'source-build') secondEntered = true;
    } });
    second.catch(() => {});
    try {
      const otherTarget = { ...target, triple: 'x86_64-unknown-linux-gnu', platform: 'linux', artifactName: 'fixture-other' };
      const otherArtifact = path.join(root, otherTarget.artifactName), otherBytes = createTuiArtifactBytes(otherTarget);
      await fsp.writeFile(otherArtifact, otherBytes);
      if (process.platform !== 'win32') await fsp.chmod(otherArtifact, 0o755);
      const other = await installTuiGeneration(inputFor(root, installRoot, { ...otherTarget,
        absoluteArtifactPath: otherArtifact, artifactPath: otherTarget.artifactName, exists: true,
        sha256: sha256(otherBytes) }, buildManifest, otherTarget));
      assert.equal(other.transaction.state, 'published');
      assert.equal(secondEntered, false);
    } finally { releaseStaging(); await Promise.allSettled([first, second]); }
    const [firstDone, secondDone] = await Promise.all([first, second]);
    assert.notEqual(firstDone.metadata.generationId, secondDone.metadata.generationId);
    const final = JSON.parse(await fsp.readFile(input.layout.metadataPath, 'utf8'));
    assert.equal(final.generationId, secondDone.metadata.generationId);
    assert.equal(fs.existsSync(firstDone.binaryPath), true);
    assert.equal(fs.existsSync(path.join(input.layout.tripleDir, 'install.lock')), false);
    const upgradedBytes = createTuiArtifactBytes(target, 'new-valid-generation');
    await fsp.writeFile(artifact, upgradedBytes);
    const upgraded = await installTuiGeneration({ ...input, resolveBuild: async () => ({ built: false,
      buildArtifact: { ...buildArtifact, sha256: sha256(upgradedBytes) }, buildManifest }) });
    assert.notEqual(upgraded.checksum, selected.checksum, 'a valid changed payload must publish its own checksum');
    const selectedUpgrade = resolveSelectedTuiGeneration({ root, layout: input.layout, target,
      metadata: JSON.parse(await fsp.readFile(input.layout.metadataPath, 'utf8')) });
    assert.equal(selectedUpgrade.binaryPath, upgraded.binaryPath);
    assert.deepEqual(await fsp.readFile(selectedUpgrade.binaryPath), upgradedBytes);
    assert.deepEqual(await fsp.readFile(selected.binaryPath), bytes, 'the original usable payload survives a changed-byte upgrade');
  } finally { await rmDirRecursive(temporary); }
  console.log('TUI staging faults, interrupted recovery and concurrent generation selection preserve complete installs.');
}
