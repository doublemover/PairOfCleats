#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs/promises';
const { aggregatePlatformCohorts } = await import('./aggregate-cohorts.js');
const { readCurrentCohortPlan } = await import('./cohort-plan.js');

const [platformName, ...extra] = process.argv.slice(2);
if (extra.length || !['ubuntu', 'windows', 'macos'].includes(platformName)) throw new Error('Expected one OS cohort name.');
const expected = { ubuntu: 'linux', windows: 'win32', macos: 'darwin' };
if (expected[platformName] !== process.platform) throw new Error('OS cohort does not match its actual runner.');
const plan = await readCurrentCohortPlan();
const result = await aggregatePlatformCohorts({ plan, platformName, artifactsRoot: '.tmp/ci-cohort-artifacts' });
const jobs = JSON.parse(process.env.CI_COHORT_JOB_RESULTS || '{}');
for (const key of ['prepare', 'correctness', 'serial', 'tooling']) {
  if (jobs[key]?.result !== 'success') result.errors.push(`Required ${key} jobs: ${jobs[key]?.result || 'missing'}`);
}
result.ok = result.ok && result.errors.length === 0;
await fs.writeFile('.diagnostics/cohort-acceptance.json', JSON.stringify(result, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `correctness-complete=${result.correctnessComplete}\n`);
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
