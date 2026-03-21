#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isTestingEnv } from '../../src/shared/env.js';
import { getReleaseCheckSurfacePhases, getReleaseCheckSurfaceSteps, loadShippedSurfaces } from './surfaces.js';
import { extractChangelogSection, readPackageVersion, toIso } from './metadata-support.js';

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
const TESTING_ENV_KEY = 'PAIROFCLEATS_TESTING';
const MAX_OUTPUT_CHARS = 4000;
const BASELINE_PHASES = ['changelog', 'contracts', 'toolchain'];

const reportPathArg = readOption('report').trim();
const manifestPathArg = readOption('manifest').trim();
const surfacesArg = readOption('surfaces').trim();
const phasesArg = readOption('phases').trim();
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
  console.error('  --surfaces <ids>               Restrict release-check to selected shipped surface ids.');
  console.error('  --phases <names>               Restrict release-check to selected phases.');
  console.error('  --dry-run                      Validate flow/order without executing commands.');
  console.error('  --dry-run-fail-step <id>       Force one named step to fail in --dry-run mode.');
  process.exit(0);
}

const root = process.cwd();
const reportPath = path.resolve(root, reportPathInput);
const manifestPath = path.resolve(root, manifestPathInput);

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

const parseSelectorSet = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const entries = text
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return entries.length ? new Set(entries) : null;
};

/**
 * Execute one release-check step and capture normalized result metadata.
 *
 * In dry-run mode, returns synthetic success/failure without spawning.
 *
 * @param {object} input
 * @returns {object}
 */
const recordStep = ({
  id,
  phase,
  label,
  command,
  cwd = root,
  env = process.env,
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
  const overridden = false;

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

/**
 * Validate CHANGELOG presence and ensure current package version entry exists.
 *
 * Optionally enforces a populated `### Breaking` subsection.
 *
 * @returns {string}
 */
const validateChangelog = () => {
  const { version } = readPackageVersion(root);
  const { section } = extractChangelogSection(root, version);
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

/**
 * Collect deterministic release-manifest artifact metadata.
 *
 * @param {object[]} steps
 * @returns {Array<{path:string,exists:boolean,type:string,sizeBytes:number|null,sha256:string|null}>}
 */
const collectManifestArtifacts = (steps) => {
  const inventory = new Set([
    normalizePath(path.relative(root, reportPath)),
    'docs/tooling/shipped-surfaces.json',
    'docs/guides/release-surfaces.md',
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
          type: 'missing',
          sizeBytes: null,
          sha256: null
        };
      }
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        return {
          path: relPath,
          exists: true,
          type: 'directory',
          sizeBytes: null,
          sha256: null
        };
      }
      return {
        path: relPath,
        exists: true,
        type: 'file',
        sizeBytes: stat.size,
        sha256: sha256File(absPath)
      };
    });
};

/**
 * Execute release-check workflow and emit report/manifest outputs.
 *
 * @returns {void}
 */
const main = () => {
  const startedAtMs = Date.now();
  const startedAt = toIso(startedAtMs);
  const steps = [];
  const shippedSurfaceRegistry = loadShippedSurfaces(root);
  const selectedSurfaces = parseSelectorSet(surfacesArg);
  const selectedPhases = parseSelectorSet(phasesArg);
  const knownSurfaceIds = new Set(shippedSurfaceRegistry.surfaces.map((surface) => surface.id.toLowerCase()));
  for (const surfaceId of selectedSurfaces || []) {
    if (!knownSurfaceIds.has(surfaceId)) {
      throw new Error(`release-check: unknown surface id ${surfaceId}.`);
    }
  }
  const availableSurfacePhases = getReleaseCheckSurfacePhases(root);
  const knownPhases = new Set([...BASELINE_PHASES, ...availableSurfacePhases]);
  for (const phase of selectedPhases || []) {
    if (!knownPhases.has(phase)) {
      throw new Error(`release-check: unknown phase ${phase}.`);
    }
  }
  const selectedSurfacePhases = selectedPhases
    ? availableSurfacePhases.filter((phase) => selectedPhases.has(phase))
    : null;
  const releaseSteps = getReleaseCheckSurfaceSteps(root, {
    surfaceIds: selectedSurfaces ? Array.from(selectedSurfaces) : null,
    phases: selectedSurfacePhases
  });
  const executedPhases = [];
  const includePhase = (phase) => !selectedPhases || selectedPhases.has(phase);
  let version = null;
  let ok = true;

  if (includePhase('changelog')) {
    executedPhases.push('changelog');
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
  }

  if (includePhase('contracts')) {
    executedPhases.push('contracts');
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
  }

  if (includePhase('toolchain')) {
    executedPhases.push('toolchain');
    const pythonToolchainStep = recordStep({
      id: 'toolchain.python',
      phase: 'toolchain',
      label: 'python toolchain policy check',
      command: [process.execPath, 'tools/tooling/python-check.js', '--json']
    });
    steps.push(pythonToolchainStep);
    if (pythonToolchainStep.status === 'failed') ok = false;
  }

  for (const stepPhase of availableSurfacePhases) {
    if (includePhase(stepPhase) && !executedPhases.includes(stepPhase)) {
      executedPhases.push(stepPhase);
    }
  }

  for (const smokeStep of releaseSteps) {
    const step = recordStep({
      id: smokeStep.id,
      phase: smokeStep.phase,
      label: smokeStep.label,
      command: smokeStep.command,
      owner: smokeStep.owner || null,
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
    scope: {
      surfaces: selectedSurfaces ? Array.from(selectedSurfaces).sort() : null,
      phases: selectedPhases ? Array.from(selectedPhases).sort() : null
    },
    strict: {
      skipModesDisabled: true,
      requiredChecks: executedPhases
    },
    shippedSurfaces: shippedSurfaceRegistry.surfaces.map((surface) => ({
      id: surface.id,
      name: surface.name,
      owner: surface.owner,
      supportLevel: surface.supportLevel,
      packagingBoundary: surface.packagingBoundary,
      publishBoundary: surface.publishBoundary,
      versionSource: surface.versionSource,
      releaseCheckEnabled: surface.releaseCheck.enabled,
      releaseCheckStepIds: surface.releaseCheck.steps.map((step) => step.id),
      releaseCheckStepsByPhase: Object.fromEntries(
        ['build', 'install', 'boot', 'smoke']
          .map((phase) => [
            phase,
            surface.releaseCheck.steps
              .filter((step) => step.phase === phase)
              .map((step) => step.id)
          ])
          .filter(([, ids]) => ids.length > 0)
      )
    })),
    summary: {
      total: steps.length,
      passed: passedCount,
      failed: failedCount,
      byPhase: Object.fromEntries(
        executedPhases.map((phase) => [
          phase,
          steps.filter((step) => step.phase === phase).length
        ])
      )
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
    shippedSurfacesRegistryPath: normalizePath(
      path.relative(root, shippedSurfaceRegistry.registryPath)
    ),
    surfaces: shippedSurfaceRegistry.surfaces.map((surface) => ({
      id: surface.id,
      name: surface.name,
      owner: surface.owner,
      supportLevel: surface.supportLevel,
      packagingBoundary: surface.packagingBoundary,
      publishBoundary: surface.publishBoundary,
      versionSource: surface.versionSource,
      runtimeTargets: surface.runtimeTargets,
      platforms: surface.platforms,
      build: surface.build,
      install: surface.install,
      smoke: surface.smoke,
      releaseCheckEnabled: surface.releaseCheck.enabled,
      releaseCheckStepIds: surface.releaseCheck.steps.map((step) => step.id),
      releaseCheckStepsByPhase: Object.fromEntries(
        ['build', 'install', 'boot', 'smoke']
          .map((phase) => [
            phase,
            surface.releaseCheck.steps
              .filter((step) => step.phase === phase)
              .map((step) => step.id)
          ])
          .filter(([, ids]) => ids.length > 0)
      )
    })),
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
