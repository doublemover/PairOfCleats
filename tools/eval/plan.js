#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
import { readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';
import { createCli } from '../../src/shared/cli.js';
import { EVAL_OPTIONS } from '../shared/operator-cli-options.js';
import { captureEvaluationDatasetCases } from './dataset-admission.js';
import { resolveEvaluationCohorts } from './cohorts.js';
import { createEvaluationDepthPlan } from './depth-plan.js';
import { captureLiveEvaluationInput } from '../shared/retrieval-execution-evidence.js';
import { resolveMatchMode } from './match.js';
import { captureEvaluationSearchPlan } from './search-plan.js';

// Internal bakeoff preflight: admit the complete selected input and current
// effective query policy in the exact child environment, without searching.
const argv = createCli({ scriptName: 'eval-plan', options: EVAL_OPTIONS, aliases: { n: 'top' } }).parse();
const repoRoot = path.resolve(argv.repo || process.cwd()), dataset = path.resolve(argv.dataset);
const read = readVerifiedContainedFileSync(path.dirname(dataset), dataset, { maxBytes: 32 * 1024 * 1024 });
const all = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
if (!Array.isArray(all)) throw new Error('Evaluation dataset must be an array.');
const limit = Math.max(0, parseInt(argv.limit, 10) || 0), topN = Math.max(1, parseInt(argv.top, 10) || 10);
const selected = limit > 0 ? all.slice(0, limit) : all;
if (!selected.length) throw new Error('Evaluation preflight requires selected cases.');
const captured = captureEvaluationDatasetCases(selected).map(row => ({ ...row,
  selection: resolveEvaluationCohorts(row.mode, [...row.silver, ...row.gold]) }));
const { cases, identity } = captureLiveEvaluationInput(captured, createEvaluationDepthPlan(topN, resolveMatchMode(argv['match-mode'])), limit);
const plan = await captureEvaluationSearchPlan({ repoRoot, cases, evaluationInput: identity, topN,
  backend: argv.backend || 'auto', annFlag: typeof argv.ann === 'boolean' ? argv.ann : null });
console.log(JSON.stringify({ evaluationInput: identity, evaluationSearchPlan: plan.receipt }));
