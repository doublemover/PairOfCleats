#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createFsExistsIndex,
  createImportResolutionBudgetPolicy,
  resolveImportLinks
} from '../../../src/index/build/import-resolution.js';
import {
  enrichUnresolvedImportSamples,
  sortImportScanItems
} from '../../../src/index/build/imports.js';
import { collectLanguageImports } from '../../../src/index/language-registry.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';

const cases = [
  {
    name: 'adaptive budget policy shifts and respects explicit overrides',
    async run() {
      const defaultPolicy = createImportResolutionBudgetPolicy();
      assert.equal(defaultPolicy.maxFilesystemProbesPerSpecifier, 32);
      assert.equal(defaultPolicy.maxFallbackCandidatesPerSpecifier, 48);
      assert.equal(defaultPolicy.maxFallbackDepth, 16);
      assert.equal(defaultPolicy.adaptiveEnabled, true);
      assert.equal(defaultPolicy.adaptiveProfile, 'normal');
      assert.equal(defaultPolicy.adaptiveScale, 1);

      const pressurePolicy = createImportResolutionBudgetPolicy({
        runtimeSignals: {
          scheduler: {
            utilizationOverall: 0.5,
            pending: 128,
            running: 4,
            memoryPressure: 0.95,
            fdPressure: 0.4
          },
          envelope: {
            cpuConcurrency: 8,
            ioConcurrency: 8
          }
        }
      });
      assert.equal(pressurePolicy.adaptiveProfile, 'pressure_critical');
      assert.equal(pressurePolicy.maxFilesystemProbesPerSpecifier, 16);
      assert.equal(pressurePolicy.maxFallbackCandidatesPerSpecifier, 24);
      assert.equal(pressurePolicy.maxFallbackDepth, 12);
      assert.notEqual(pressurePolicy.fingerprint, defaultPolicy.fingerprint);

      const headroomPolicy = createImportResolutionBudgetPolicy({
        runtimeSignals: {
          scheduler: {
            utilizationOverall: 0.9,
            pending: 4,
            running: 2,
            memoryPressure: 0.2,
            fdPressure: 0.2
          },
          envelope: {
            cpuConcurrency: 16,
            ioConcurrency: 12
          }
        }
      });
      assert.equal(headroomPolicy.adaptiveProfile, 'capacity_headroom');
      assert.ok(headroomPolicy.maxFilesystemProbesPerSpecifier > defaultPolicy.maxFilesystemProbesPerSpecifier);
      assert.ok(headroomPolicy.maxFallbackCandidatesPerSpecifier > defaultPolicy.maxFallbackCandidatesPerSpecifier);
      assert.ok(headroomPolicy.maxFallbackDepth > defaultPolicy.maxFallbackDepth);

      const explicitPolicy = createImportResolutionBudgetPolicy({
        resolverPlugins: {
          budgets: {
            maxFilesystemProbesPerSpecifier: 10,
            maxFallbackCandidatesPerSpecifier: 20,
            maxFallbackDepth: 5
          }
        },
        runtimeSignals: {
          scheduler: {
            utilizationOverall: 0.2,
            pending: 512,
            running: 1,
            memoryPressure: 0.99,
            fdPressure: 0.99
          },
          envelope: {
            cpuConcurrency: 16,
            ioConcurrency: 16
          }
        }
      });
      assert.equal(explicitPolicy.maxFilesystemProbesPerSpecifier, 10);
      assert.equal(explicitPolicy.maxFallbackCandidatesPerSpecifier, 20);
      assert.equal(explicitPolicy.maxFallbackDepth, 5);

      const disabledAdaptivePolicy = createImportResolutionBudgetPolicy({
        resolverPlugins: {
          budgets: {
            adaptive: false
          }
        },
        runtimeSignals: {
          scheduler: {
            utilizationOverall: 0.2,
            pending: 512,
            running: 1,
            memoryPressure: 0.99,
            fdPressure: 0.99
          },
          envelope: {
            cpuConcurrency: 16,
            ioConcurrency: 16
          }
        }
      });
      assert.equal(disabledAdaptivePolicy.adaptiveEnabled, false);
      assert.equal(disabledAdaptivePolicy.adaptiveProfile, 'disabled');
      assert.equal(disabledAdaptivePolicy.adaptiveScale, 1);
      assert.equal(disabledAdaptivePolicy.maxFilesystemProbesPerSpecifier, 32);
      assert.equal(disabledAdaptivePolicy.maxFallbackCandidatesPerSpecifier, 48);
      assert.equal(disabledAdaptivePolicy.maxFallbackDepth, 16);
    }
  },
  {
    name: 'scan priority prefers cached coverage and smaller files',
    async run() {
      const items = [
        { relKey: 'a', stat: { size: 100 }, index: 0 },
        { relKey: 'b', stat: { size: 1000 }, index: 1 },
        { relKey: 'c', stat: { size: 2000 }, index: 2 },
        { relKey: 'd', stat: { size: 150 }, index: 3 }
      ];
      const counts = new Map([
        ['a', 10],
        ['b', 5],
        ['d', 10]
      ]);

      sortImportScanItems(items, counts);
      assert.equal(items.map((item) => item.relKey).join(','), 'd,a,b,c');
    }
  },
  {
    name: 'flow mode forwarding enables Flow import collection only when requested',
    async run() {
      const text = [
        "import type { Foo } from 'flow-lib';",
        'type Foo = { value: string };'
      ].join('\n');

      const withFlow = collectLanguageImports({
        ext: '.js',
        relPath: 'src/flow.js',
        text,
        mode: 'code',
        options: { flowMode: 'on' }
      });
      assert.ok(withFlow.includes('flow-lib'));

      const withoutFlow = collectLanguageImports({
        ext: '.js',
        relPath: 'src/flow.js',
        text,
        mode: 'code'
      });
      assert.ok(!withoutFlow.includes('flow-lib'));
    }
  },
  {
    name: 'filesystem probe exhaustion reports budgeted unresolved samples',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-budget-exhaustion');
      const srcRoot = path.join(tempRoot, 'src');
      await fs.mkdir(srcRoot, { recursive: true });
      await fs.writeFile(
        path.join(srcRoot, 'main.js'),
        "import './missing-a';\nimport './missing-b';\n",
        'utf8'
      );

      const entries = [{ abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }];
      const importsByFile = { 'src/main.js': ['./missing-a', './missing-b'] };
      const relations = new Map([
        ['src/main.js', { imports: importsByFile['src/main.js'].slice() }]
      ]);

      const result = resolveImportLinks({
        root: tempRoot,
        entries,
        importsByFile,
        fileRelations: relations,
        enableGraph: true,
        resolverPlugins: {
          budgets: {
            maxFilesystemProbesPerSpecifier: 0,
            maxFallbackCandidatesPerSpecifier: 8
          }
        }
      });

      const unresolved = enrichUnresolvedImportSamples(result?.unresolvedSamples || []);
      assert.equal(unresolved.length, 2);
      for (const sample of unresolved) {
        assert.equal(sample.reasonCode, 'IMP_U_RESOLVER_BUDGET_EXHAUSTED');
        assert.equal(sample.failureCause, 'resolver_gap');
        assert.equal(sample.disposition, 'suppress_gate');
        assert.equal(sample.resolverStage, 'filesystem_probe');
      }

      assert.equal(result?.stats?.unresolvedBudgetExhausted, 2);
      assert.deepEqual(
        Object.fromEntries(Object.entries(result?.stats?.unresolvedBudgetExhaustedByType || {})),
        { filesystem_probe: 2 }
      );
      assert.equal(result?.stats?.resolverPipelineStages?.filesystem_probe?.budgetExhausted || 0, 2);
      assert.equal(result?.stats?.resolverPipelineStages?.filesystem_probe?.degraded || 0, 2);
      assert.equal(result?.graph?.stats?.unresolvedBudgetExhausted, 2);
      assert.deepEqual(
        Object.fromEntries(Object.entries(result?.graph?.stats?.unresolvedBudgetExhaustedByType || {})),
        { filesystem_probe: 2 }
      );
    }
  },
  {
    name: 'fallback depth budgets are reported independently from filesystem probe budgets',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-fallback-depth');
      const nestedRoot = path.join(tempRoot, 'src', 'nested');
      await fs.mkdir(nestedRoot, { recursive: true });
      await fs.writeFile(path.join(nestedRoot, 'main.js'), "import '../../../missing';\n", 'utf8');

      const entries = [{ abs: path.join(nestedRoot, 'main.js'), rel: 'src/nested/main.js' }];
      const importsByFile = { 'src/nested/main.js': ['../../../missing'] };
      const relations = new Map([
        ['src/nested/main.js', { imports: importsByFile['src/nested/main.js'].slice() }]
      ]);

      const result = resolveImportLinks({
        root: tempRoot,
        entries,
        importsByFile,
        fileRelations: relations,
        enableGraph: true,
        resolverPlugins: {
          budgets: {
            maxFilesystemProbesPerSpecifier: 32,
            maxFallbackCandidatesPerSpecifier: 32,
            maxFallbackDepth: 1
          }
        }
      });

      const unresolved = enrichUnresolvedImportSamples(result?.unresolvedSamples || []);
      assert.equal(unresolved.length, 1);
      assert.equal(unresolved[0].reasonCode, 'IMP_U_RESOLVER_BUDGET_EXHAUSTED');
      assert.equal(unresolved[0].failureCause, 'resolver_gap');
      assert.equal(unresolved[0].resolverStage, 'filesystem_probe');
      assert.equal(result?.stats?.unresolvedBudgetExhausted, 1);
      assert.deepEqual(
        Object.fromEntries(Object.entries(result?.stats?.unresolvedBudgetExhaustedByType || {})),
        { fallback_depth: 1 }
      );
      assert.equal(result?.graph?.stats?.unresolvedBudgetExhausted, 1);
      assert.deepEqual(
        Object.fromEntries(Object.entries(result?.graph?.stats?.unresolvedBudgetExhaustedByType || {})),
        { fallback_depth: 1 }
      );
    }
  },
  {
    name: 'fs-exists index exact hits bypass exhausted filesystem probe budgets',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-fs-index-shortcircuit');
      const srcRoot = path.join(tempRoot, 'src');
      const depsRoot = path.join(tempRoot, 'deps');
      await fs.mkdir(srcRoot, { recursive: true });
      await fs.mkdir(depsRoot, { recursive: true });
      await fs.writeFile(path.join(srcRoot, 'main.js'), "import '../deps/local.js';\n", 'utf8');
      await fs.writeFile(path.join(depsRoot, 'local.js'), 'export const local = true;\n', 'utf8');

      const entries = [{ abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }];
      const importsByFile = { 'src/main.js': ['../deps/local.js'] };

      const baselineRelations = new Map([['src/main.js', { imports: ['../deps/local.js'] }]]);
      const baseline = resolveImportLinks({
        root: tempRoot,
        entries,
        importsByFile,
        fileRelations: baselineRelations,
        enableGraph: true,
        resolverPlugins: {
          budgets: {
            maxFilesystemProbesPerSpecifier: 0,
            maxFallbackCandidatesPerSpecifier: 16
          }
        }
      });
      const baselineUnresolved = enrichUnresolvedImportSamples(baseline?.unresolvedSamples || []);
      assert.equal(baselineRelations.get('src/main.js')?.externalImports?.length || 0, 0);
      assert.equal(baseline?.stats?.unresolvedBudgetExhausted, 1);
      assert.equal(baselineUnresolved[0]?.reasonCode, 'IMP_U_RESOLVER_BUDGET_EXHAUSTED');

      const fsExistsIndex = await createFsExistsIndex({ root: tempRoot, entries });
      const acceleratedRelations = new Map([['src/main.js', { imports: ['../deps/local.js'] }]]);
      const accelerated = resolveImportLinks({
        root: tempRoot,
        entries,
        importsByFile,
        fileRelations: acceleratedRelations,
        enableGraph: true,
        fsExistsIndex,
        resolverPlugins: {
          budgets: {
            maxFilesystemProbesPerSpecifier: 0,
            maxFallbackCandidatesPerSpecifier: 16
          }
        }
      });
      assert.deepEqual(acceleratedRelations.get('src/main.js')?.externalImports || [], ['../deps/local.js']);
      assert.equal(accelerated?.stats?.unresolvedBudgetExhausted, 0);
      assert.equal(accelerated?.stats?.resolverFsExistsIndex?.exactHits, 1);
      assert.equal(accelerated?.stats?.resolverFsExistsIndex?.negativeSkips, 0);
    }
  },
  {
    name: 'stage pipeline counters reflect successful and unresolved build-system passes',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-stage-pipeline');
      await fs.mkdir(path.join(tempRoot, 'go'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'MODULE.bazel'), 'module(name = "demo")\n', 'utf8');
      await fs.writeFile(path.join(tempRoot, 'go', 'extensions.bzl'), 'def go_deps():\n  pass\n', 'utf8');

      const entries = [
        { abs: path.join(tempRoot, 'MODULE.bazel'), rel: 'MODULE.bazel' },
        { abs: path.join(tempRoot, 'go', 'extensions.bzl'), rel: 'go/extensions.bzl' }
      ];
      const importsByFile = {
        'MODULE.bazel': ['//go:extensions.bzl', '//go:missing_extension.bzl']
      };
      const fileRelations = new Map([
        ['MODULE.bazel', { imports: importsByFile['MODULE.bazel'].slice() }]
      ]);

      const resolution = resolveImportLinks({
        root: tempRoot,
        entries,
        importsByFile,
        fileRelations,
        enableGraph: true
      });

      const stages = resolution?.stats?.resolverPipelineStages || {};
      assert.equal((stages.normalize?.attempts || 0) >= 2, true);
      assert.equal((stages.language_resolver?.attempts || 0) >= 2, true);
      assert.equal((stages.build_system_resolver?.attempts || 0) >= 1, true);
      assert.equal((stages.classify?.attempts || 0) >= 1, true);
      assert.equal((stages.filesystem_probe?.attempts || 0) >= 1, true);
      assert.equal(Number.isFinite(Number(stages.classify?.elapsedMs)), true);
      assert.equal(Number.isFinite(Number(stages.classify?.budgetExhausted)), true);
      assert.equal(Number.isFinite(Number(stages.classify?.degraded)), true);

      const warnings = Array.isArray(resolution?.unresolvedSamples) ? resolution.unresolvedSamples : [];
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].reasonCode, 'IMP_U_BAZEL_LABEL_TARGET_MISSING');
      assert.equal(warnings[0].resolverStage, 'build_system_resolver');
      assert.equal(warnings[0].resolverAdapter, 'bazel-label');
      assert.equal(Array.isArray(warnings[0].resolverTrace), true);
      assert.equal((stages.build_system_resolver?.reasonCodes?.IMP_U_BAZEL_LABEL_TARGET_MISSING || 0) >= 1, true);
      assert.deepEqual(resolution?.graph?.stats?.resolverPipelineStages || {}, stages);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('import resolution policy contract matrix test passed');
