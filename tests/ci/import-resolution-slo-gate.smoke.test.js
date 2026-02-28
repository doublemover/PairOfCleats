#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'import-resolution-slo-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-import-resolution-gate-'));

const writeGraph = async (targetPath, payload) => {
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

try {
  const passGraphPath = path.join(tempRoot, 'import_resolution_graph.pass.json');
  const passJsonPath = path.join(tempRoot, 'import-resolution-slo-gate.pass.json');
  await writeGraph(passGraphPath, {
    generatedAt: new Date().toISOString(),
    stats: {
      unresolved: 10,
      unresolvedActionable: 2,
      unresolvedBudgetExhausted: 1,
      unresolvedByResolverStage: {
        filesystem_probe: 2
      },
      resolverPipelineStages: {
        normalize: { attempts: 4, hits: 4, misses: 0, elapsedMs: 3.25 },
        language_resolver: { attempts: 2, hits: 1, misses: 1, elapsedMs: 2.5 },
        filesystem_probe: { attempts: 1, hits: 0, misses: 1, elapsedMs: 1.5 },
        classify: { attempts: 1, hits: 1, misses: 0, elapsedMs: 0.5 }
      },
      unresolvedActionableHotspots: [
        { importer: 'src/main.ts', count: 2 }
      ]
    },
    warnings: [
      {
        importer: 'src/main.ts',
        specifier: './missing.ts',
        reason: 'unresolved',
        reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
        failureCause: 'missing_file',
        disposition: 'actionable',
        resolverStage: 'filesystem_probe'
      },
      {
        importer: 'tests/fixtures/case.ts',
        specifier: './fixture.ts',
        reason: 'unresolved',
        reasonCode: 'IMP_U_FIXTURE_REFERENCE',
        failureCause: 'parser_artifact',
        disposition: 'suppress_live',
        resolverStage: 'classify'
      }
    ]
  });
  const passResult = spawnSync(
    process.execPath,
    [
      gatePath,
      '--mode',
      'ci',
      '--report',
      passGraphPath,
      '--json',
      passJsonPath,
      '--actionable-unresolved-rate-max',
      '0.4'
    ],
    {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
  if (passResult.status !== 0) {
    console.error('import resolution slo gate smoke test failed (pass case)');
    console.error(passResult.stdout || '');
    console.error(passResult.stderr || '');
  }
  assert.equal(passResult.status, 0, `expected pass gate status=0, received ${passResult.status}`);

  const passPayload = JSON.parse(await fs.readFile(passJsonPath, 'utf8'));
  assert.equal(passPayload?.status, 'ok');
  assert.equal(passPayload?.metrics?.unresolved, 10);
  assert.equal(passPayload?.metrics?.actionable, 2);
  assert.equal(passPayload?.metrics?.resolverBudgetExhausted, 1);
  assert.equal(passPayload?.metrics?.resolverBudgetExhaustedRate, 0.1);
  assert.equal(passPayload?.metrics?.gateEligibleUnresolved, 1);
  assert.equal(passPayload?.metrics?.gateEligibleActionable, 1);
  assert.deepEqual(
    passPayload?.actionableHotspots,
    [{ importer: 'src/main.ts', count: 2 }]
  );
  assert.deepEqual(
    passPayload?.resolverStages,
    {
      filesystem_probe: 2
    }
  );
  assert.deepEqual(
    passPayload?.resolverPipelineStages,
    {
      classify: { attempts: 1, hits: 1, misses: 0, elapsedMs: 0.5 },
      filesystem_probe: { attempts: 1, hits: 0, misses: 1, elapsedMs: 1.5 },
      language_resolver: { attempts: 2, hits: 1, misses: 1, elapsedMs: 2.5 },
      normalize: { attempts: 4, hits: 4, misses: 0, elapsedMs: 3.25 }
    }
  );

  const failGraphPath = path.join(tempRoot, 'import_resolution_graph.fail.json');
  const failJsonPath = path.join(tempRoot, 'import-resolution-slo-gate.fail.json');
  await writeGraph(failGraphPath, {
    generatedAt: new Date().toISOString(),
    stats: {
      unresolved: 10,
      unresolvedActionable: 8
    },
    warnings: [
      {
        importer: 'src/main.ts',
        specifier: './missing.ts',
        reason: 'unresolved',
        reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
        failureCause: 'missing_file',
        disposition: 'actionable',
        resolverStage: 'filesystem_probe'
      }
    ]
  });
  const failResult = spawnSync(
    process.execPath,
    [
      gatePath,
      '--mode',
      'ci',
      '--report',
      failGraphPath,
      '--json',
      failJsonPath,
      '--actionable-unresolved-rate-max',
      '0.5'
    ],
    {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
  assert.equal(failResult.status, 3, `expected fail gate status=3, received ${failResult.status}`);
  const failPayload = JSON.parse(await fs.readFile(failJsonPath, 'utf8'));
  assert.equal(failPayload?.status, 'error');
  assert.ok(
    Array.isArray(failPayload?.failures) && failPayload.failures.some((entry) => String(entry).includes('actionable unresolved rate')),
    'expected actionable unresolved rate failure'
  );
  assert.deepEqual(
    failPayload?.actionableHotspots,
    [{ importer: 'src/main.ts', count: 1 }]
  );
  assert.deepEqual(
    failPayload?.resolverStages,
    { filesystem_probe: 1 }
  );
  assert.deepEqual(
    failPayload?.resolverPipelineStages,
    {}
  );

  const fallbackGraphPath = path.join(tempRoot, 'import_resolution_graph.fallback.json');
  const fallbackJsonPath = path.join(tempRoot, 'import-resolution-slo-gate.fallback.json');
  await writeGraph(fallbackGraphPath, {
    generatedAt: new Date().toISOString(),
    warnings: [
      {
        importer: 'tests/fixtures/case.ts',
        specifier: './fixture.ts',
        reason: 'unresolved',
        reasonCode: 'IMP_U_FIXTURE_REFERENCE',
        failureCause: 'parser_artifact',
        disposition: 'suppress_live',
        resolverStage: 'classify'
      },
      {
        importer: 'src/main.ts',
        specifier: './unbounded.ts',
        reason: 'unresolved',
        reasonCode: 'IMP_U_RESOLVER_BUDGET_EXHAUSTED',
        failureCause: 'resolver_gap',
        disposition: 'suppress_gate',
        resolverStage: 'filesystem_probe'
      },
      {
        importer: 'src/main.ts',
        specifier: './missing.ts',
        reason: 'unresolved',
        reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
        failureCause: 'missing_file',
        disposition: 'actionable',
        resolverStage: 'filesystem_probe'
      }
    ]
  });
  const fallbackResult = spawnSync(
    process.execPath,
    [
      gatePath,
      '--mode',
      'ci',
      '--report',
      fallbackGraphPath,
      '--json',
      fallbackJsonPath,
      '--actionable-unresolved-rate-max',
      '0.49'
    ],
    {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
  assert.equal(fallbackResult.status, 3, `expected fallback gate status=3, received ${fallbackResult.status}`);
  const fallbackPayload = JSON.parse(await fs.readFile(fallbackJsonPath, 'utf8'));
  assert.equal(fallbackPayload?.metrics?.unresolved, 2);
  assert.equal(fallbackPayload?.metrics?.actionable, 1);
  assert.equal(fallbackPayload?.metrics?.resolverBudgetExhausted, 1);
  assert.equal(fallbackPayload?.metrics?.resolverBudgetExhaustedRate, 0.5);
  assert.deepEqual(
    fallbackPayload?.actionableHotspots,
    [{ importer: 'src/main.ts', count: 1 }]
  );
  assert.deepEqual(
    fallbackPayload?.resolverStages,
    {
      classify: 1,
      filesystem_probe: 2
    }
  );
  assert.deepEqual(
    fallbackPayload?.resolverPipelineStages,
    {}
  );

  console.log('import resolution slo gate smoke test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
