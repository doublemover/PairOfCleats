import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createReleaseAssetPlan, stageReleaseAssets, validateReleaseAssetNames } from '../../../tools/release/publish-assets.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-release-assets-'));
const files = new Map([
  ['downloads/release-prepare/release_check_report.json', 'prepare report'],
  ['downloads/release-verify-runtime/release_check_report.json', 'runtime report'],
  ['downloads/release-tui-windows/release-manifest.json', 'windows manifest'],
  ['downloads/release-tui-macos/release-manifest.json', 'macos manifest'],
  ['downloads/release-tui-ubuntu/release-manifest.json', 'ubuntu manifest'],
  ['bundle/release-manifest.json', 'bundle manifest'],
  ['trust/release-manifest.json', 'trust manifest'],
  ['downloads/a--b/report.json', 'flat-path collision control'],
  ['downloads/a/b--report.json', 'different path collision control'],
  ['downloads/odd # % café/package.vsix', 'editor package']
]);
try {
  for (const [relative, text] of files) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), text);
  }
  const plan = createReleaseAssetPlan(root);
  assert.equal(plan.entries.length, files.size);
  assert.equal(new Set(plan.entries.map(entry => entry.assetName.toLowerCase())).size, files.size);
  assert.deepEqual(plan, createReleaseAssetPlan(root), 'planning has stable names, hashes and ordering');
  assert.throws(() => createReleaseAssetPlan(root, ['downloads', 'downloads']), /Duplicate/);
  assert.throws(() => validateReleaseAssetNames([{ assetName: 'same.json' }, { assetName: 'SAME.json' }]), /Duplicate/);
  for (const assetName of ['../escape', 'bad#label', 'release-asset-map.json', 'RELEASE-ASSET-MAP.JSON', '', '.']) {
    assert.throws(() => validateReleaseAssetNames([{ assetName }]), /unsafe/);
  }
  assert.throws(() => createReleaseAssetPlan(root, ['../outside']), /within repo root/);
  assert.ok(!fs.readdirSync(root).some(name => name.startsWith('publish-staging-')), 'all invalid plans fail before staging');
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const staged = stageReleaseAssets(root), mapping = JSON.parse(fs.readFileSync(staged.mappingPath, 'utf8'));
    assert.deepEqual(mapping, plan, 'reruns retain the complete original-path/checksum mapping');
    assert.equal(staged.uploadPaths.length, files.size + 1);
    assert.equal(new Set(staged.uploadPaths.map(filename => path.basename(filename))).size, files.size + 1);
    for (const entry of mapping.entries) {
      const filename = staged.uploadPaths.find(candidate => path.basename(candidate) === entry.assetName);
      const bytes = fs.readFileSync(filename);
      assert.equal(bytes.toString(), files.get(entry.originalPath));
      assert.equal(bytes.length, entry.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    }
  }
  for (const [relative, text] of files) assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), text);
  assert.equal(plan.entries.find(entry => entry.originalPath.endsWith('.vsix')).assetName.endsWith('.vsix'), true);
  const copyFile = fs.copyFileSync;
  try {
    fs.copyFileSync = (...args) => { copyFile(...args); fs.appendFileSync(args[1], 'changed bytes'); };
    assert.throws(() => stageReleaseAssets(root), /changed during staging/, 'mismatched staged bytes cannot produce an upload plan');
  } finally { fs.copyFileSync = copyFile; }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Release promotion stages every original asset with stable unique names, matching bytes and a complete checksum map before publication.');
