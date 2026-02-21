#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { escapeRegex } from '../../src/shared/text/escape-regex.js';
import { isTestingEnv } from '../../src/shared/env.js';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);

const hasOption = (name) => {
  const flag = `--${name}`;
  return args.some((arg) => arg === flag || (typeof arg === 'string' && arg.startsWith(`${flag}=`)));
};

const readOption = (name) => {
  const flag = `--${name}`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag) {
      const next = args[i + 1];
      return typeof next === 'string' ? next : '';
    }
    if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return '';
};

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
const toIso = (value = Date.now()) => new Date(value).toISOString();
const TESTING_ENV_KEY = 'PAIROFCLEATS_TESTING';
const MAX_OUTPUT_CHARS = 4000;

const reportPathArg = readOption('report').trim();
const manifestPathArg = readOption('manifest').trim();
const reportPathInput = reportPathArg || 'release_check_report.json';
const manifestPathInput = manifestPathArg || 'release-manifest.json';
const requireBreaking = hasFlag('--breaking');
const dryRun = hasFlag('--dry-run');
const dryRunFailStep = readOption('dry-run-fail-step').trim();
const blockerFlagsUsed = (
  hasFlag('--blockers-only')
  || hasFlag('--no-blockers')
  || hasFlag('--allow-blocker-override')
  || hasOption('override-id')
  || hasOption('override-ids')
  || hasOption('override-marker')
);

if (blockerFlagsUsed) {
  console.error('release-check: blocker-related flags are no longer supported.');
  process.exit(1);
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.error('Usage: node tools/release/check.js [options]');
  console.error('');
  console.error('Options:');
  console.error('  --breaking                     Require non-empty "### Breaking" notes for current version.');
  console.error('  --report <path>                Release check report output path.');
  console.error('  --manifest <path>              Release manifest output path.');
  console.error('  --dry-run                      Validate flow/order without executing commands.');
  console.error('  --dry-run-fail-step <id>       Force one named step to fail in --dry-run mode.');
  process.exit(0);
}

const root = process.cwd();
const reportPath = path.resolve(root, reportPathInput);
const manifestPath = path.resolve(root, manifestPathInput);

const SMOKE_STEPS = Object.freeze([
  {
    id: 'smoke.version',
    label: 'pairofcleats --version',
    command: [process.execPath, 'bin/pairofcleats.js', '--version']
  },
  {
    id: 'smoke.fixture-index-build',
    label: 'fixture index build',
    command: [process.execPath, 'build_index.js', '--repo', 'tests/fixtures/sample', '--mode', 'code']
  },
  {
    id: 'smoke.fixture-index-validate-strict',
    label: 'fixture index validate --strict',
    command: [process.execPath, 'tools/index/validate.js', '--repo', 'tests/fixtures/sample', '--strict']
  },
  {
    id: 'smoke.fixture-search',
    label: 'fixture search',
    command: [process.execPath, 'search.js', 'sample', '--repo', 'tests/fixtures/sample', '--top', '1', '--json']
  },
  {
    id: 'smoke.editor-sublime',
    label: 'editor package smoke (sublime)',
    command: [process.execPath, 'tools/package-sublime.js', '--smoke'],
    artifacts: ['dist/sublime/pairofcleats.sublime-package', 'dist/sublime/pairofcleats.sublime-package.sha256']
  },
  {
    id: 'smoke.editor-vscode',
    label: 'editor package smoke (vscode)',
    command: [process.execPath, 'tools/package-vscode.js', '--smoke'],
    artifacts: ['dist/vscode/pairofcleats.vsix', 'dist/vscode/pairofcleats.vsix.sha256']
  },
  {
    id: 'smoke.tui-build',
    label: 'tui artifact manifest smoke',
    command: [process.execPath, 'tools/tui/build.js', '--smoke'],
    artifacts: ['dist/tui/tui-artifacts-manifest.json', 'dist/tui/tui-artifacts-manifest.json.sha256']
  },
  {
    id: 'smoke.service-mode',
    label: 'service-mode smoke check',
    command: [process.execPath, 'tools/service/indexer-service.js', 'smoke', '--json']
  }
]);

const trimOutput = (value) => {
  const text = String(value || '').trim();
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(text.length - MAX_OUTPUT_CHARS);
};

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const recordStep = ({
  id,
  phase,
  label,
  command,
  cwd = root,
  env = process.env,
  allowOverride = false,
  owner = null,
  artifacts = []
}) => {
  const startedAtMs = Date.now();
  const startedAt = toIso(startedAtMs);
  if (dryRun) {
    const forcedFailure = Boolean(dryRunFailStep) && dryRunFailStep === id;
    const finishedAtMs = Date.now();
    return {
      id,
      phase,
      label,
      command,
      cwd: normalizePath(path.relative(root, cwd) || '.'),
      status: forcedFailure ? 'failed' : 'passed',
      overridden: false,
      owner,
      startedAt,
      finishedAt: toIso(finishedAtMs),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      exitCode: forcedFailure ? 1 : 0,
      stdoutTail: '',
      stderrTail: forcedFailure ? 'forced dry-run failure' : '',
      artifacts: artifacts.map((item) => normalizePath(item))
    };
  }

  const runEnv = { ...env };
  if (!isTestingEnv(runEnv)) {
    runEnv[TESTING_ENV_KEY] = '1';
  }
  const [binary, ...commandArgs] = command;
  const result = spawnSync(binary, commandArgs, {
    cwd,
    env: runEnv,
    encoding: 'utf8'
  });

  const finishedAtMs = Date.now();
  const failed = result.status !== 0;
  let overridden = false;
  if (failed && allowOverride) {
    const canOverride = allowBlockerOverride && overrideMarker && overrideIds.has(id);
    overridden = Boolean(canOverride);
  }

  return {
    id,
    phase,
    label,
    command,
    cwd: normalizePath(path.relative(root, cwd) || '.'),
    status: failed && !overridden ? 'failed' : 'passed',
    overridden,
    owner,
    startedAt,
    finishedAt: toIso(finishedAtMs),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    exitCode: Number.isFinite(result.status) ? result.status : 1,
    stdoutTail: trimOutput(result.stdout),
    stderrTail: trimOutput(result.stderr),
    artifacts: artifacts.map((item) => normalizePath(item))
  };
};

const validateChangelog = () => {
  const packagePath = path.join(root, 'package.json');
  const changelogPath = path.join(root, 'CHANGELOG.md');

  if (!fs.existsSync(packagePath)) {
    throw new Error('release-check: package.json not found.');
  }
  if (!fs.existsSync(changelogPath)) {
    throw new Error('release-check: CHANGELOG.md not found.');
  }

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const version = pkg?.version ? String(pkg.version).trim() : '';
  if (!version) {
    throw new Error('release-check: package.json version missing.');
  }

  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const headerRe = new RegExp(`^##\\s+v?${escapeRegex(version)}(\\b|\\s)`, 'm');
  const match = headerRe.exec(changelog);
  if (!match) {
    throw new Error(`release-check: CHANGELOG.md missing section for v${version}.`);
  }

  const sectionStart = match.index;
  const nextHeaderMatch = changelog.slice(sectionStart + match[0].length).match(/^##\s+/m);
  const sectionEnd = nextHeaderMatch
    ? sectionStart + match[0].length + nextHeaderMatch.index
    : changelog.length;
  const section = changelog.slice(sectionStart, sectionEnd);

  if (requireBreaking) {
    const breakingHeader = section.match(/^###\s+Breaking\s*$/m);
    if (!breakingHeader) {
      throw new Error(`release-check: missing "### Breaking" section for v${version}.`);
    }
    const afterBreaking = section.slice(breakingHeader.index + breakingHeader[0].length);
    const nextSubsection = afterBreaking.match(/^###\s+/m);
    const breakingBlock = nextSubsection
      ? afterBreaking.slice(0, nextSubsection.index)
      : afterBreaking;
    const bullets = breakingBlock.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('-'));
    const hasRealEntry = bullets.some((line) => !line.toLowerCase().includes('none'));
    if (!bullets.length || !hasRealEntry) {
      throw new Error(`release-check: add breaking change notes under v${version}.`);
    }
  }

  return version;
};

const writeOutputs = (reportPayload, manifestPayload) => {
  ensureParentDir(reportPath);
  ensureParentDir(manifestPath);
  fs.writeFileSync(reportPath, `${JSON.stringify(reportPayload, null, 2)}\n`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifestPayload, null, 2)}\n`);
};

const collectManifestArtifacts = (steps) => {
  const inventory = new Set([
    normalizePath(path.relative(root, reportPath)),
    'docs/tooling/doc-contract-drift.json',
    'docs/tooling/doc-contract-drift.md'
  ]);
  for (const step of steps) {
    for (const artifact of step.artifacts || []) {
      inventory.add(normalizePath(artifact));
    }
  }
  return Array.from(inventory)
    .sort((a, b) => a.localeCompare(b))
    .map((relPath) => {
      const absPath = path.resolve(root, relPath);
      const exists = fs.existsSync(absPath);
      if (!exists) {
        return {
          path: relPath,
          exists: false,
          sizeBytes: null,
          sha256: null
        };
      }
      const stat = fs.statSync(absPath);
      return {
        path: relPath,
        exists: true,
        sizeBytes: stat.size,
        sha256: sha256File(absPath)
      };
    });
};

const main = () => {
  const startedAtMs = Date.now();
  const startedAt = toIso(startedAtMs);
  const steps = [];
  let version = null;
  let ok = true;

  try {
    const changelogStepStart = Date.now();
    version = validateChangelog();
    const changelogStepEnd = Date.now();
    steps.push({
      id: 'changelog.entry',
      phase: 'changelog',
      label: 'validate changelog for package version',
      command: ['internal:changelog-validate'],
      cwd: '.',
      status: 'passed',
      overridden: false,
      owner: null,
      startedAt: toIso(changelogStepStart),
      finishedAt: toIso(changelogStepEnd),
      durationMs: Math.max(0, changelogStepEnd - changelogStepStart),
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      artifacts: []
    });
  } catch (err) {
    const finishedAtMs = Date.now();
    ok = false;
    steps.push({
      id: 'changelog.entry',
      phase: 'changelog',
      label: 'validate changelog for package version',
      command: ['internal:changelog-validate'],
      cwd: '.',
      status: 'failed',
      overridden: false,
      owner: null,
      startedAt: startedAt,
      finishedAt: toIso(finishedAtMs),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      exitCode: 1,
      stdoutTail: '',
      stderrTail: trimOutput(err?.message || String(err)),
      artifacts: []
    });
  }

  const contractDriftStep = recordStep({
    id: 'contracts.drift',
    phase: 'contracts',
    label: 'contract/spec drift check',
    command: [
      process.execPath,
      'tools/docs/contract-drift.js',
      '--fail',
      '--out-json',
      'docs/tooling/doc-contract-drift.json',
      '--out-md',
      'docs/tooling/doc-contract-drift.md'
    ],
    artifacts: ['docs/tooling/doc-contract-drift.json', 'docs/tooling/doc-contract-drift.md']
  });
  steps.push(contractDriftStep);
  if (contractDriftStep.status === 'failed') ok = false;

  const pythonToolchainStep = recordStep({
    id: 'toolchain.python',
    phase: 'toolchain',
    label: 'python toolchain policy check',
    command: [process.execPath, 'tools/tooling/python-check.js', '--json']
  });
  steps.push(pythonToolchainStep);
  if (pythonToolchainStep.status === 'failed') ok = false;

  for (const smokeStep of SMOKE_STEPS) {
    const step = recordStep({
      id: smokeStep.id,
      phase: 'smoke',
      label: smokeStep.label,
      command: smokeStep.command,
      artifacts: smokeStep.artifacts || []
    });
    steps.push(step);
    if (step.status === 'failed') ok = false;
  }

  const finishedAtMs = Date.now();
  const finishedAt = toIso(finishedAtMs);
  const failedCount = steps.filter((step) => step.status === 'failed').length;
  const passedCount = steps.filter((step) => step.status === 'passed').length;

  const report = {
    schemaVersion: 1,
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    root: normalizePath(root),
    releaseVersion: version,
    strict: {
      skipModesDisabled: true,
      requiredChecks: ['changelog', 'contracts', 'toolchain', 'smoke']
    },
    summary: {
      total: steps.length,
      passed: passedCount,
      failed: failedCount
    },
    checks: steps.map((step) => ({
      ...step,
      command: step.command.map((part) => String(part))
    })),
    ok: ok && failedCount === 0
  };

  const manifest = {
    schemaVersion: 1,
    generatedAt: finishedAt,
    reportPath: normalizePath(path.relative(root, reportPath)),
    artifacts: []
  };

  writeOutputs(report, manifest);
  manifest.artifacts = collectManifestArtifacts(steps);
  writeOutputs(report, manifest);

  if (!report.ok) {
    for (const step of report.checks.filter((entry) => entry.status === 'failed')) {
      console.error(`release-check: failed ${step.id}`);
      if (step.stderrTail) console.error(step.stderrTail);
    }
    process.exit(1);
  }
  console.error('release-check: deterministic release validation passed.');
};

main();
