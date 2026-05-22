import fs from 'node:fs';
import path from 'node:path';

import { getEditorCommandSpecs } from '../../src/shared/runtime-capability-manifest.js';
import { createArgReader, probeCommand } from '../shared/cli-utils.js';
import {
  assertPinnedPackagingToolchain,
  buildDeterministicZip,
  writeArchiveChecksums
} from './archive-determinism.js';

const fail = (message) => {
  throw new Error(message);
};

const readJsonFile = (filePath, failureMessage) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`${failureMessage}: ${err?.message || String(err)}`);
  }
};

const requireExistingFiles = (sourceDir, entries) => {
  for (const [relPath, message] of entries) {
    if (!fs.existsSync(path.join(sourceDir, relPath))) fail(message);
  }
};

const validateVsCodeCommands = (packageManifest) => {
  const expectedEditorCommands = new Map(getEditorCommandSpecs().map((entry) => [entry.id, entry.title]));
  const activationEvents = new Set(packageManifest.activationEvents || []);
  for (const [commandId, title] of expectedEditorCommands.entries()) {
    if (!activationEvents.has(`onCommand:${commandId}`)) {
      fail(`VS Code package manifest missing activation event for ${commandId}.`);
    }
    const command = (packageManifest.contributes?.commands || []).find((entry) => entry.command === commandId);
    if (!command) fail(`VS Code package manifest missing command ${commandId}.`);
    if (command.title !== title) fail(`VS Code package manifest title drifted for ${commandId}.`);
  }
};

const validateVsCodeSource = ({ sourceDir }) => {
  requireExistingFiles(sourceDir, [
    ['package.json', 'VS Code package source missing package.json.'],
    ['extension.js', 'VS Code package source missing extension.js.'],
    ['README.md', 'VS Code package source missing README.md.']
  ]);

  const packageManifest = readJsonFile(
    path.join(sourceDir, 'package.json'),
    'VS Code package manifest is invalid JSON'
  );
  const requiredManifestFields = [
    ['name', packageManifest.name],
    ['displayName', packageManifest.displayName],
    ['description', packageManifest.description],
    ['version', packageManifest.version],
    ['publisher', packageManifest.publisher],
    ['homepage', packageManifest.homepage],
    ['repository.url', packageManifest.repository?.url],
    ['bugs.url', packageManifest.bugs?.url],
    ['engines.vscode', packageManifest.engines?.vscode]
  ];
  for (const [label, value] of requiredManifestFields) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fail(`VS Code package manifest missing required field ${label}.`);
    }
  }
  if (packageManifest.capabilities?.virtualWorkspaces !== false) {
    fail('VS Code package manifest must declare capabilities.virtualWorkspaces=false.');
  }

  validateVsCodeCommands(packageManifest);
  for (const walkthrough of packageManifest.contributes?.walkthroughs || []) {
    for (const step of walkthrough.steps || []) {
      const markdown = step?.media?.markdown;
      if (typeof markdown !== 'string' || markdown.trim().length === 0) {
        fail(`VS Code walkthrough ${step?.id || '<unknown>'} missing markdown media.`);
      }
      if (!fs.existsSync(path.join(sourceDir, markdown))) {
        fail(`VS Code walkthrough markdown missing: ${markdown}`);
      }
    }
  }
};

const checkRequiredCommands = (requiredCommands = []) => {
  for (const commandSpec of requiredCommands) {
    const probe = probeCommand(commandSpec.command, commandSpec.args, {
      stdio: 'ignore',
      timeoutMs: commandSpec.timeoutMs ?? 4000,
      outputEncoding: 'utf8'
    });
    if (!probe.ok) fail(commandSpec.errorMessage);
  }
};

const buildToolchainManifest = (descriptor) => {
  const toolchain = typeof descriptor.manifestToolchain === 'function'
    ? descriptor.manifestToolchain()
    : descriptor.manifestToolchain;
  return toolchain || {};
};

const PACKAGE_DESCRIPTORS = {
  sublime: {
    usage: 'Usage: node tools/package-sublime.js [--out-dir <dir>] [--smoke]',
    label: 'Sublime',
    sourceDir: (root) => path.join(root, 'sublime', 'PairOfCleats'),
    defaultOutDir: path.join('dist', 'sublime'),
    archiveFileName: 'pairofcleats.sublime-package',
    rootPrefix: 'PairOfCleats',
    toolchainRequirements: { requirePython: true },
    manifestToolchain: () => ({
      node: process.versions.node,
      pythonRequired: true,
      archive: 'zip'
    })
  },
  vscode: {
    usage: 'Usage: node tools/package-vscode.js [--out-dir <dir>] [--smoke]',
    label: 'VS Code',
    sourceDir: (root) => path.join(root, 'extensions', 'vscode'),
    defaultOutDir: path.join('dist', 'vscode'),
    archiveFileName: 'pairofcleats.vsix',
    rootPrefix: 'extension',
    toolchainRequirements: { requireNpm: true },
    requiredCommands: [{
      command: 'npm',
      args: ['--version'],
      errorMessage: 'Packaging toolchain error: npm is required for VS Code packaging.'
    }],
    manifestToolchain: () => ({
      node: process.versions.node,
      npmRequired: true,
      archive: 'vsix(zip)'
    }),
    validateSource: validateVsCodeSource
  }
};

const runEditorPackageCli = async (descriptor, argv, options = {}) => {
  const root = options.root || process.cwd();
  const proc = options.process || process;
  const stdout = options.stdout || proc.stdout || process.stdout;
  const stderr = options.stderr || proc.stderr || process.stderr;
  const { hasFlag, readOption } = createArgReader(argv);

  if (hasFlag('--help') || hasFlag('-h')) {
    stderr.write(`${descriptor.usage}\n`);
    proc.exit(0);
    return null;
  }

  const sourceDir = descriptor.sourceDir(root);
  const outDir = path.resolve(root, readOption('out-dir', descriptor.defaultOutDir));
  const archivePath = path.join(outDir, descriptor.archiveFileName);
  const checksumPath = `${archivePath}.sha256`;
  const manifestPath = `${archivePath}.manifest.json`;

  try {
    if (!fs.existsSync(sourceDir)) fail(`${descriptor.label} package source not found: ${sourceDir}`);
    if (typeof descriptor.validateSource === 'function') descriptor.validateSource({ root, sourceDir });
    assertPinnedPackagingToolchain(descriptor.toolchainRequirements);
    checkRequiredCommands(descriptor.requiredCommands);

    const built = await buildDeterministicZip({
      sourceDir,
      archivePath,
      rootPrefix: descriptor.rootPrefix
    });
    const manifest = await writeArchiveChecksums({
      archivePath,
      checksum: built.checksum,
      entries: built.entries,
      checksumPath,
      manifestPath,
      toolchain: buildToolchainManifest(descriptor)
    });

    if (hasFlag('--smoke')) {
      if (!fs.existsSync(archivePath)) {
        fail(`${descriptor.label} smoke packaging failed: archive not created.`);
      }
      if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
        fail(`${descriptor.label} smoke packaging failed: manifest entries missing.`);
      }
    }

    stdout.write(`${JSON.stringify({
      ok: true,
      archive: path.relative(root, archivePath).replace(/\\/g, '/'),
      checksum: built.checksum,
      entries: built.entries.length
    })}\n`);
    return { archivePath, checksumPath, manifestPath, built, manifest };
  } catch (err) {
    stderr.write(`${err?.message || String(err)}\n`);
    proc.exit(1);
    return null;
  }
};

export const runNamedEditorPackageCli = async (packageName, argv = process.argv.slice(2), options = {}) => {
  const descriptor = PACKAGE_DESCRIPTORS[packageName];
  if (!descriptor) throw new Error(`Unknown editor package target: ${packageName}`);
  return runEditorPackageCli(descriptor, argv, options);
};
