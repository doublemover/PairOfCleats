import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { buildSuitePlan } from './run-suite.js';
import { USR_GUARDRAIL_GATES } from './usr/guardrails.js';
import { classifySuiteSteps, extraPlatformSteps, partitionCorrectness, validatePartition, planDigest, plannedRuntimeSkips } from './suite-cohorts.js';

export const suiteArguments = (dryRun = true) => ({ mode: 'ci', lane: 'ci-lite', 'skip-prechecks': true,
  'dry-run': dryRun, diagnostics: '.diagnostics', 'log-dir': '.testLogs', junit: '.testLogs/junit.xml' });
export const cohortRuntime = () => ({ node: process.version, abi: process.versions.modules, arch: process.arch });

export const currentSource = async root => {
  const result = await spawnSubprocess('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: 'pipe', timeoutMs: 4000,
    maxOutputBytes: 4096, rejectOnNonZeroExit: true });
  return result.stdout.trim();
};

export const definitionDigest = async root => {
  const files = ['tools/ci/run-suite.js', 'tools/ci/suite-cohorts.js', 'tools/ci/cohort-plan.js',
    'tools/ci/run-platform-cohort.js', 'tests/run.js', 'tests/runner/run-args.js', 'tests/runner/test-id-selection.js',
    'tests/run.rules.jsonc', 'tests/run.config.jsonc', 'tests/ci-lite/ci-lite.manifest.json',
    'tools/ci/aggregate-cohorts.js', 'tools/testing/coverage/ranges.js',
    '.github/workflows/ci-platform.yml', '.github/actions/ci-dependencies/action.yml', '.github/actions/ci-tooling/action.yml'];
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file); hash.update(await fs.readFile(path.join(root, file))); }
  return hash.digest('hex');
};

export const platformSuite = async (dryRun = true, platform = process.platform) => {
  const suite = await buildSuitePlan(suiteArguments(dryRun));
  return { ...suite, steps: [...classifySuiteSteps(suite.steps, new Set(USR_GUARDRAIL_GATES.map(gate => gate.label))),
    ...extraPlatformSteps(platform)] };
};

export const listStepCases = async (step, env, root) => {
  if (step.args[0] !== 'tests/run.js') return [];
  const result = await spawnSubprocess(process.execPath, [...step.args, '--list', '--json'], { cwd: root, env,
    stdio: 'pipe', timeoutMs: 30000, maxOutputBytes: 32 * 1024 * 1024, rejectOnNonZeroExit: true });
  const report = JSON.parse(result.stdout);
  if (!Array.isArray(report.tests) || !report.tests.length || report.total !== report.tests.length
    || new Set(report.tests.map(test => test.id)).size !== report.tests.length) throw new Error(`Invalid CI selection: ${step.label}`);
  return report.tests;
};

export const validateCohortPlan = plan => {
  if (plan?.schemaVersion !== 1 || plan.digest !== planDigest(plan) || !/^[a-f0-9]{40}$/.test(plan.source)
    || typeof plan.runtime?.node !== 'string' || typeof plan.runtime?.abi !== 'string' || typeof plan.runtime?.arch !== 'string'
    || !['linux', 'win32', 'darwin'].includes(plan.platform) || !Array.isArray(plan.groups)
    || new Set(plan.groups.map(group => group.key)).size !== plan.groups.length) throw new Error('Invalid CI cohort plan identity.');
  const correctness = plan.groups.filter(group => group.cohort === 'correctness');
  if (correctness.length !== 4 || correctness.some((group, index) => group.key !== `correctness-${index + 1}`)) throw new Error('CI correctness shards are incomplete.');
  validatePartition(plan.stepCases['CI test lane'], correctness);
  if (JSON.stringify(plan.runtimeSkips || {}) !== JSON.stringify(plannedRuntimeSkips(plan.platform, Object.values(plan.stepCases).flat()))) {
    throw new Error('CI runtime exclusions differ from their exact platform/optional owners.');
  }
  const labels = plan.groups.flatMap(group => group.labels);
  for (const label of Object.keys(plan.stepCases)) {
    if (labels.filter(actual => actual === label).length !== (label === 'CI test lane' ? 4 : 1)) {
      throw new Error(`CI step has missing or duplicate execution owners: ${label}`);
    }
  }
  for (const group of plan.groups) {
    if (!Array.isArray(group.labels) || !group.labels.length || !Array.isArray(group.ids)
      || group.labels.some(label => !Object.hasOwn(plan.stepCases, label))) throw new Error(`Invalid CI group: ${group.key}`);
    if (group.cohort !== 'correctness') {
      const expected = group.labels.flatMap(label => plan.stepCases[label]);
      if (JSON.stringify(expected) !== JSON.stringify(group.ids)) throw new Error(`CI cohort omits original selections: ${group.key}`);
    }
  }
};

export const buildPlatformCohortPlan = async ({ root = process.cwd(), timings = {} } = {}) => {
  const { steps, env } = await platformSuite();
  const stepCases = {}, presetSkips = {}, grouped = new Map();
  for (const step of steps.filter(step => step.cohort !== 'aggregate')) {
    const cases = await listStepCases(step, env, root);
    stepCases[step.label] = cases.map(test => test.id);
    for (const test of cases) if (test.presetStatus === 'skipped') presetSkips[test.id] = test.skipReason;
    const group = grouped.get(step.cohort) || { key: step.cohort, cohort: step.cohort, labels: [], ids: [] };
    group.labels.push(step.label); group.ids.push(...stepCases[step.label]); grouped.set(step.cohort, group);
  }
  const groups = [];
  for (const group of grouped.values()) {
    if (group.cohort === 'correctness') groups.push(...partitionCorrectness(group.ids, timings).map(shard => ({
      ...shard, cohort: 'correctness', labels: group.labels })));
    else groups.push(group);
  }
  const plan = { schemaVersion: 1, source: await currentSource(root), platform: process.platform, runtime: cohortRuntime(),
    definitions: await definitionDigest(root), groups, stepCases, presetSkips,
    runtimeSkips: plannedRuntimeSkips(process.platform, Object.values(stepCases).flat()) };
  plan.digest = planDigest(plan); validateCohortPlan(plan); return plan;
};

export const readCurrentCohortPlan = async (root = process.cwd()) => {
  const file = path.join(root, '.diagnostics/ci-plan.json'), stat = await fs.stat(file);
  if (stat.size > 8 * 1024 * 1024) throw new Error('CI plan exceeds its byte bound.');
  const plan = JSON.parse(await fs.readFile(file, 'utf8')); validateCohortPlan(plan);
  if (plan.platform !== process.platform || JSON.stringify(plan.runtime) !== JSON.stringify(cohortRuntime()) || plan.source !== await currentSource(root)
    || plan.definitions !== await definitionDigest(root)) throw new Error('CI plan belongs to another platform/source or changed runner.');
  return plan;
};
