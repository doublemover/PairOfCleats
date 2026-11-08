#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs/promises';
const { buildPlatformCohortPlan } = await import('./cohort-plan.js');

let timings = {};
try { timings = JSON.parse(await fs.readFile('.cache/ci-timings/correctness.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const plan = await buildPlatformCohortPlan({ timings });
await fs.mkdir('.diagnostics', { recursive: true });
await fs.writeFile('.diagnostics/ci-plan.json', JSON.stringify(plan, null, 2) + '\n');
const serial = plan.groups.filter(group => !['correctness', 'tooling'].includes(group.cohort)).map(group => group.key);
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `serial-cohorts=${JSON.stringify(serial)}\n`);
console.log(JSON.stringify({ source: plan.source, digest: plan.digest, platform: plan.platform,
  groups: plan.groups.map(({ key, ids, estimatedMs }) => ({ key, cases: ids.length, estimatedMs })) }));
