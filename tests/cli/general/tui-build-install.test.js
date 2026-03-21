#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveHostTargetTriple, readTargetsManifestSync, resolveTargetForTriple } from '../../../tools/tui/targets.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-cli-tui-build-'));
const distDir = path.join(tempRoot, 'dist');
const targetDir = path.join(tempRoot, 'cargo-target');
const installRoot = path.join(tempRoot, 'install');
const fakeCargoPath = path.join(tempRoot, 'fake-cargo.mjs');
const triple = resolveHostTargetTriple({ platform: process.platform, arch: os.arch() });
const { targets } = readTargetsManifestSync({ root });
const target = resolveTargetForTriple(targets, triple);
assert.ok(target, `expected TUI target for ${triple}`);

await fsPromises.writeFile(
  fakeCargoPath,
  `import fs from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const targetFlagIndex = args.indexOf('--target');
if (targetFlagIndex === -1 || !args[targetFlagIndex + 1]) {
  throw new Error('fake cargo expected --target');
}
const targetTriple = args[targetFlagIndex + 1];
const targetDir = process.env.CARGO_TARGET_DIR;
if (!targetDir) {
  throw new Error('fake cargo expected CARGO_TARGET_DIR');
}
const suffix = targetTriple.includes('windows') ? '.exe' : '';
const outputPath = path.join(targetDir, targetTriple, 'release', \`pairofcleats-tui\${suffix}\`);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, suffix ? 'MZFAKE-TUI-BINARY' : '#!/usr/bin/env node\\nconsole.log("fake tui");\\n', 'utf8');
if (!suffix) {
  await fs.chmod(outputPath, 0o755);
}
`,
  'utf8'
);

const env = applyTestEnv({
  syncProcess: false,
  extraEnv: {
    PAIROFCLEATS_TUI_CARGO: fakeCargoPath,
    PAIROFCLEATS_TUI_DIST_DIR: distDir,
    CARGO_TARGET_DIR: targetDir
  }
});

const buildResult = spawnSync(
  process.execPath,
  [binPath, 'tui', 'build', '--target', triple, '--smoke'],
  {
    cwd: root,
    encoding: 'utf8',
    env
  }
);
assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout || 'expected tui build to succeed');
assert.equal(fs.existsSync(path.join(distDir, target.artifactName)), true, 'expected tui build to stage the target artifact');

const installResult = spawnSync(
  process.execPath,
  [binPath, 'tui', 'install', '--target', triple, '--install-root', installRoot, '--json'],
  {
    cwd: root,
    encoding: 'utf8',
    env
  }
);
assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout || 'expected tui install to succeed');
const installPayload = JSON.parse(installResult.stdout || '{}');
assert.equal(installPayload.ok, true, 'expected tui install to report ok=true');
assert.equal(fs.existsSync(path.join(installRoot, triple, 'bin', target.artifactName)), true, 'expected tui install to place the built artifact');

console.log('tui build/install CLI test passed');
