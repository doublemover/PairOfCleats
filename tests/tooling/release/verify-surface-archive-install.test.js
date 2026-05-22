#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const verifyScript = path.join(root, 'tools', 'release', 'verify-surface.js');
const { dir: fixtureDir } = await prepareTestCacheDir('release-verify-archive-install');
const archivePath = path.join(root, 'dist', 'vscode', 'pairofcleats.vsix');
const manifestPath = `${archivePath}.manifest.json`;
const backupDir = path.join(fixtureDir, 'backup');
const archiveBackupPath = path.join(backupDir, 'pairofcleats.vsix');
const manifestBackupPath = path.join(backupDir, 'pairofcleats.vsix.manifest.json');
const archiveExisted = fs.existsSync(archivePath);
const manifestExisted = fs.existsSync(manifestPath);
const outPath = path.join(fixtureDir, 'vscode-install-result.json');
const escapedPath = path.join(path.dirname(outPath), 'archive-entry-escape.txt');

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const zipEntryRecords = (zip) => zip.getEntries()
  .filter((entry) => !entry.isDirectory)
  .map((entry) => ({
    path: entry.entryName,
    mode: Math.floor(Number(entry.header?.attr || 0) / 0x10000) || 0o644,
    sizeBytes: Number(entry.header?.size || entry.getData().length),
    mtime: '2000-01-01T00:00:00.000Z'
  }));

const writeManifestForZip = (zip, overrides = {}) => {
  const manifest = {
    schemaVersion: 1,
    generatedAt: '2026-05-21T18:31:24Z',
    archive: path.relative(root, archivePath).replace(/\\/g, '/'),
    checksumSha256: sha256File(archivePath),
    fixedMtime: '2000-01-01T00:00:00.000Z',
    toolchain: {
      node: process.versions.node,
      archive: 'vsix(zip)'
    },
    entries: zipEntryRecords(zip),
    ...overrides
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const backupFile = (sourcePath, backupPath, existed) => {
  if (!existed) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(sourcePath, backupPath);
};

const restoreFile = (targetPath, backupPath, existed) => {
  fs.rmSync(targetPath, { force: true });
  if (!existed) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(backupPath, targetPath);
};

backupFile(archivePath, archiveBackupPath, archiveExisted);
backupFile(manifestPath, manifestBackupPath, manifestExisted);

try {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const zip = new AdmZip();
  zip.addFile('extension/package.json', Buffer.from('{"name":"pairofcleats"}\n'));
  zip.addFile('extension/extension.js', Buffer.from('module.exports = {};\n'));
  zip.addFile('extension/README.md', Buffer.from('# PairOfCleats\n'));
  zip.addFile('archive-entry-escape.txt', Buffer.from('escaped\n'));
  zip.getEntries().at(-1).entryName = '../archive-entry-escape.txt';
  zip.writeZip(archivePath);
  writeManifestForZip(zip);

  const run = runNode(
    [verifyScript, '--surface', 'vscode', '--stage', 'install', '--out', outPath],
    'verify-surface rejects escaping archive entries',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(run.status, 0, 'expected install verification to reject escaping archive entry');
  const payload = JSON.parse(run.stdout || '{}');
  assert.match(
    payload.error || '',
    /archive entry must stay within unpack root/,
    'expected archive validation to explain the unpack-root boundary'
  );
  assert.equal(fs.existsSync(escapedPath), false, 'expected archive install verification not to extract escaping entry');

  const symlinkZip = new AdmZip();
  symlinkZip.addFile('extension/package.json', Buffer.from('{"name":"pairofcleats"}\n'));
  symlinkZip.addFile('extension/extension.js', Buffer.from('module.exports = {};\n'));
  symlinkZip.addFile('extension/README.md', Buffer.from('# PairOfCleats\n'));
  symlinkZip.addFile('extension/symlink-entry', Buffer.from('extension/package.json'));
  symlinkZip.getEntries().at(-1).header.attr = 0o120777 * 0x10000;
  symlinkZip.writeZip(archivePath);
  writeManifestForZip(symlinkZip);

  const symlinkRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-symlink-result.json')
    ],
    'verify-surface rejects symlink archive entries',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(symlinkRun.status, 0, 'expected install verification to reject symlink archive entry');
  const symlinkPayload = JSON.parse(symlinkRun.stdout || '{}');
  assert.match(
    symlinkPayload.error || '',
    /archive entry must not be a symlink/,
    'expected archive validation to reject symlink entries before extraction'
  );

  const validZip = new AdmZip();
  validZip.addFile('extension/package.json', Buffer.from('{"name":"pairofcleats"}\n'));
  validZip.addFile('extension/extension.js', Buffer.from('module.exports = {};\n'));
  validZip.addFile('extension/README.md', Buffer.from('# PairOfCleats\n'));
  validZip.writeZip(archivePath);
  fs.writeFileSync(manifestPath, '{ invalid json');

  const malformedManifestRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-malformed-manifest-result.json')
    ],
    'verify-surface rejects malformed archive manifest',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(malformedManifestRun.status, 0, 'expected install verification to reject malformed manifest');
  const malformedManifestPayload = JSON.parse(malformedManifestRun.stdout || '{}');
  assert.match(
    malformedManifestPayload.error || '',
    /archive manifest is invalid JSON/,
    'expected archive validation to reject malformed manifests'
  );

  writeManifestForZip(validZip, {
    checksumSha256: '0'.repeat(64)
  });
  const staleChecksumRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-stale-checksum-result.json')
    ],
    'verify-surface rejects stale archive manifest checksum',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(staleChecksumRun.status, 0, 'expected install verification to reject stale manifest checksum');
  const staleChecksumPayload = JSON.parse(staleChecksumRun.stdout || '{}');
  assert.match(
    staleChecksumPayload.error || '',
    /archive manifest checksum mismatch/,
    'expected archive validation to reject stale manifest checksums'
  );

  writeManifestForZip(validZip, {
    entries: zipEntryRecords(validZip).filter((entry) => entry.path !== 'extension/README.md')
  });
  const missingEntryRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-missing-entry-manifest-result.json')
    ],
    'verify-surface rejects archive manifest missing required entry',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(missingEntryRun.status, 0, 'expected install verification to reject manifest missing required entry');
  const missingEntryPayload = JSON.parse(missingEntryRun.stdout || '{}');
  assert.match(
    missingEntryPayload.error || '',
    /archive manifest missing archive entry: extension\/README\.md/,
    'expected archive validation to reject manifests that do not match archive entries'
  );

  const sizeMismatchEntries = zipEntryRecords(validZip);
  sizeMismatchEntries[0] = {
    ...sizeMismatchEntries[0],
    sizeBytes: sizeMismatchEntries[0].sizeBytes + 1
  };
  writeManifestForZip(validZip, { entries: sizeMismatchEntries });
  const sizeMismatchRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-size-mismatch-manifest-result.json')
    ],
    'verify-surface rejects archive manifest size mismatch',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(sizeMismatchRun.status, 0, 'expected install verification to reject manifest size mismatch');
  const sizeMismatchPayload = JSON.parse(sizeMismatchRun.stdout || '{}');
  assert.match(
    sizeMismatchPayload.error || '',
    /archive manifest sizeBytes mismatch/,
    'expected archive validation to compare manifest sizeBytes with archive metadata'
  );

  const modeMismatchEntries = zipEntryRecords(validZip);
  modeMismatchEntries[0] = {
    ...modeMismatchEntries[0],
    mode: modeMismatchEntries[0].mode === 0o644 ? 0o755 : 0o644
  };
  writeManifestForZip(validZip, { entries: modeMismatchEntries });
  const modeMismatchRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-mode-mismatch-manifest-result.json')
    ],
    'verify-surface rejects archive manifest mode mismatch',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(modeMismatchRun.status, 0, 'expected install verification to reject manifest mode mismatch');
  const modeMismatchPayload = JSON.parse(modeMismatchRun.stdout || '{}');
  assert.match(
    modeMismatchPayload.error || '',
    /archive manifest mode mismatch/,
    'expected archive validation to compare manifest modes with archive metadata'
  );

  writeManifestForZip(validZip, {
    entries: [
      ...zipEntryRecords(validZip),
      zipEntryRecords(validZip)[0]
    ]
  });
  const duplicateManifestRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-duplicate-manifest-entry-result.json')
    ],
    'verify-surface rejects duplicate archive manifest entries',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(duplicateManifestRun.status, 0, 'expected install verification to reject duplicate manifest entries');
  const duplicateManifestPayload = JSON.parse(duplicateManifestRun.stdout || '{}');
  assert.match(
    duplicateManifestPayload.error || '',
    /archive manifest contains duplicate entry/,
    'expected archive validation to reject duplicate manifest paths'
  );

  const duplicateArchiveZip = new AdmZip();
  duplicateArchiveZip.addFile('extension/package.json', Buffer.from('{"name":"pairofcleats"}\n'));
  duplicateArchiveZip.addFile('extension/extension.js', Buffer.from('module.exports = {};\n'));
  duplicateArchiveZip.addFile('extension/README.md', Buffer.from('# PairOfCleats\n'));
  duplicateArchiveZip.addFile('extension/DUPLICATE.md', Buffer.from('duplicate\n'));
  duplicateArchiveZip.getEntries().at(-1).entryName = 'extension/README.md';
  duplicateArchiveZip.writeZip(archivePath);
  writeManifestForZip(duplicateArchiveZip, { entries: zipEntryRecords(validZip) });
  const duplicateArchiveRun = runNode(
    [
      verifyScript,
      '--surface',
      'vscode',
      '--stage',
      'install',
      '--out',
      path.join(fixtureDir, 'vscode-install-duplicate-archive-entry-result.json')
    ],
    'verify-surface rejects duplicate archive entries',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(duplicateArchiveRun.status, 0, 'expected install verification to reject duplicate archive entries');
  const duplicateArchivePayload = JSON.parse(duplicateArchiveRun.stdout || '{}');
  assert.match(
    duplicateArchivePayload.error || '',
    /archive contains duplicate entry/,
    'expected archive validation to reject duplicate archive paths'
  );
} finally {
  restoreFile(archivePath, archiveBackupPath, archiveExisted);
  restoreFile(manifestPath, manifestBackupPath, manifestExisted);
}

console.log('release verify-surface archive install test passed');
