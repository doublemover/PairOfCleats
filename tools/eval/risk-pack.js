#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCli } from '../../src/shared/cli.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';

const average = (values) => {
  const list = values.filter((value) => Number.isFinite(value));
  if (!list.length) return null;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
};

const toSortedStrings = (value) => (
  Array.isArray(value)
    ? value.map((entry) => String(entry || '')).filter(Boolean).sort((left, right) => left.localeCompare(right))
    : []
);

const deepSubsetEqual = (actual, expected) => {
  if (expected == null) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((entry, index) => deepSubsetEqual(actual[index], entry));
  }
  if (typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) => deepSubsetEqual(actual[key], value));
  }
  return actual === expected;
};

const computeSetPrecisionRecall = (actualIds, expectedIds) => {
  const actual = new Set(toSortedStrings(actualIds));
  const expected = new Set(toSortedStrings(expectedIds));
  if (!expected.size) {
    return {
      precision: actual.size ? 0 : 1,
      recall: 1,
      f1: actual.size ? 0 : 1
    };
  }
  const truePositive = Array.from(actual).filter((entry) => expected.has(entry)).length;
  const precision = actual.size ? truePositive / actual.size : 0;
  const recall = expected.size ? truePositive / expected.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const compareGate = (actual, operator, value) => {
  if (!Number.isFinite(actual) || !Number.isFinite(value)) return false;
  if (operator === '>=') return actual >= value;
  if (operator === '<=') return actual <= value;
  if (operator === '>') return actual > value;
  if (operator === '<') return actual < value;
  if (operator === '==') return actual === value;
  return false;
};

export const evaluateRiskPackDataset = async ({
  datasetPath,
  gatesPath = null
}) => {
  const dataset = await readJson(datasetPath);
  const gates = gatesPath ? await readJson(gatesPath) : null;
  const cases = Array.isArray(dataset) ? dataset : [];
  const results = [];

  for (const caseDef of cases) {
    const startedAt = Date.now();
    const payload = await buildCompositeContextPackPayload({
      repoRoot: caseDef.repoPath,
      seed: caseDef.seed,
      hops: caseDef.hops,
      ...caseDef.request
    });
    const elapsedMs = Number(payload?.stats?.timing?.elapsedMs ?? (Date.now() - startedAt));
    const peakRssMb = Number(payload?.stats?.memory?.peak?.rss ?? 0) / (1024 * 1024);
    const actualFlowIds = Array.isArray(payload?.risk?.flows) ? payload.risk.flows.map((flow) => flow.flowId) : [];
    const metrics = computeSetPrecisionRecall(actualFlowIds, caseDef.expected?.flowIds || []);
    const summaryExact = deepSubsetEqual(payload?.risk?.summary, caseDef.expected?.summary || null);
    const actualCaps = toSortedStrings(payload?.risk?.caps?.hits || []);
    const expectedCaps = toSortedStrings(caseDef.expected?.capBehavior?.capsHit || []);
    const capBehaviorMatch = (
      String(payload?.risk?.analysisStatus?.code || payload?.risk?.status || '') === String(caseDef.expected?.capBehavior?.status || '')
      && actualFlowIds.length === Number(caseDef.expected?.capBehavior?.flowCount ?? actualFlowIds.length)
      && JSON.stringify(actualCaps) === JSON.stringify(expectedCaps)
    );

    results.push({
      id: caseDef.id,
      repoAlias: caseDef.repoAlias,
      languageId: caseDef.languageId,
      elapsedMs,
      peakRssMb,
      summaryExact,
      capBehaviorMatch,
      actual: {
        status: payload?.risk?.analysisStatus?.code || payload?.risk?.status || null,
        flowIds: actualFlowIds,
        capsHit: actualCaps
      },
      expected: {
        flowIds: caseDef.expected?.flowIds || [],
        capsHit: expectedCaps
      },
      metrics
    });
  }

  const summary = {
    cases: results.length,
    flowPrecisionAvg: average(results.map((entry) => entry.metrics.precision)),
    flowRecallAvg: average(results.map((entry) => entry.metrics.recall)),
    flowF1Avg: average(results.map((entry) => entry.metrics.f1)),
    summaryExactRate: average(results.map((entry) => (entry.summaryExact ? 1 : 0))),
    capBehaviorRate: average(results.map((entry) => (entry.capBehaviorMatch ? 1 : 0))),
    avgElapsedMs: average(results.map((entry) => entry.elapsedMs)),
    maxPeakRssMb: results.reduce((max, entry) => Math.max(max, entry.peakRssMb), 0),
    cappedCases: results.filter((entry) => entry.actual.status === 'capped').length
  };

  const thresholdDefs = Array.isArray(gates?.thresholds) ? gates.thresholds : [];
  const gateResults = thresholdDefs.map((gate) => {
    const actual = Number(summary?.[gate.metric]);
    const pass = compareGate(actual, gate.operator, Number(gate.value));
    return {
      id: gate.id,
      metric: gate.metric,
      operator: gate.operator,
      expected: gate.value,
      actual,
      blocking: gate.blocking === true,
      pass
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    datasetPath: path.resolve(datasetPath),
    gatesPath: gatesPath ? path.resolve(gatesPath) : null,
    summary,
    gates: gateResults,
    results
  };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = createCli({
    scriptName: 'eval-risk-pack',
    options: {
      dataset: { type: 'string' },
      gates: { type: 'string' },
      pretty: { type: 'boolean', default: false },
      out: { type: 'string' },
      'enforce-gates': { type: 'boolean', default: false }
    }
  }).parse();

  if (!argv.dataset) {
    console.error('risk-pack eval requires --dataset.');
    process.exit(2);
  }

  const output = await evaluateRiskPackDataset({
    datasetPath: path.resolve(argv.dataset),
    gatesPath: argv.gates ? path.resolve(argv.gates) : null
  });

  if (argv.out) {
    await fs.writeFile(path.resolve(argv.out), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  const hasBlockingFailures = output.gates.some((gate) => gate.blocking && gate.pass !== true);
  console.log(argv.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output));
  if (argv['enforce-gates'] === true && hasBlockingFailures) {
    process.exit(1);
  }
}
