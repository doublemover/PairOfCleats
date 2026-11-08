#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { platformSuite, readCurrentCohortPlan, listStepCases } = await import('./cohort-plan.js');
const { runSuiteStep } = await import('./run-suite.js');
const { validateCaseReport } = await import('./suite-cohorts.js');

const [key, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Expected one exact CI cohort key.');
const plan = await readCurrentCohortPlan(), group = plan.groups.find(group => group.key === key);
if (!group) throw new Error('Unknown CI cohort.');
const suite = await platformSuite(false), steps = suite.steps.filter(step => step.cohort === group.cohort);
if (JSON.stringify(steps.map(step => step.label)) !== JSON.stringify(group.labels)) throw new Error('CI step owners changed after planning.');
const receipt = { schemaVersion: 1, source: plan.source, planDigest: plan.digest, platform: plan.platform,
  runtime: plan.runtime,
  key, ok: false, startedAt: Date.now(), completed: [], reports: [], outputs: [] };
try {
  for (const step of steps) {
    let expected = plan.stepCases[step.label];
    const invocation = { ...step, args: [...step.args] };
    if (step.cohort === 'correctness') {
      expected = group.ids;
      const selection = '.diagnostics/cohort-selection.json';
      await fs.writeFile(selection, JSON.stringify({ schemaVersion: 1, ids: expected }));
      invocation.args.push('--test-id-file', selection, '--jobs', '2', '--pairofcleats-threads', '1');
    }
    if (invocation.args[0] === 'tests/run.js') {
      const resolved = await listStepCases(invocation, suite.env, process.cwd());
      if (JSON.stringify(resolved.map(test => test.id)) !== JSON.stringify(expected)) throw new Error(`CI selection changed: ${step.label}`);
    }
    await runSuiteStep(invocation, suite.env, false);
    if (invocation.args[0] === 'tests/run.js') {
      const file = invocation.args[invocation.args.indexOf('--report-file') + 1];
      const bytes = await fs.readFile(file), report = JSON.parse(bytes);
      validateCaseReport(expected, report, plan.presetSkips, plan.runtimeSkips);
      const relative = path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/');
      if (!relative.startsWith('.diagnostics/')) throw new Error('CI report is outside its diagnostic directory.');
      receipt.reports.push({ label: step.label, file: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (step.cohort === 'correctness') {
        const coverageFile = '.diagnostics/coverage/test-coverage-ci.json';
        receipt.coverage = { summary: createHash('sha256').update(await fs.readFile(coverageFile)).digest('hex'),
          ranges: createHash('sha256').update(await fs.readFile(coverageFile + '.ranges.json')).digest('hex') };
      }
    } else {
      const files = [];
      for (const flag of ['--json', '--out']) {
        const index = invocation.args.indexOf(flag);
        if (index === -1) continue;
        const relative = path.relative(process.cwd(), path.resolve(invocation.args[index + 1])).replaceAll('\\', '/');
        if (!relative.startsWith('.diagnostics/')) throw new Error('CI gate output is outside its diagnostic directory.');
        const bytes = await fs.readFile(relative); JSON.parse(bytes);
        files.push({ file: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      if (!files.length) throw new Error(`CI gate declares no retained result: ${step.label}`);
      receipt.outputs.push({ label: step.label, files });
    }
    receipt.completed.push(step.label);
  }
  receipt.ok = true;
} catch (error) {
  receipt.error = { message: String(error.message).slice(0, 2048), code: error.code || null };
  console.error(error); process.exitCode = 1;
} finally {
  receipt.finishedAt = Date.now();
  await fs.writeFile('.diagnostics/cohort-result.json', JSON.stringify(receipt, null, 2) + '\n');
}
