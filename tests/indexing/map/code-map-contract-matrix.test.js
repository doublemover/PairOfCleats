#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();

const createMapFixture = async ({
  tempName,
  files,
  testConfig,
  extraEnv
}) => {
  const tempRoot = resolveTestCachePath(root, tempName);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');

  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, contents);
  }

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig,
    extraEnv
  });

  return { repoRoot, env };
};

const buildCodeIndex = ({ repoRoot, env, extraArgs = [] }) => {
  const buildResult = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage1', '--mode', 'code', '--repo', repoRoot, ...extraArgs],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  assert.equal(buildResult.status, 0, 'expected code-map fixture build to succeed');
};

const runCodeMap = ({ repoRoot, env, args = [], allowFailure = false }) => spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'reports/report-code-map.js'), ...args, '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8', stdio: allowFailure ? 'pipe' : undefined }
);

const defaultConfig = {
  indexing: {
    scm: { provider: 'none' },
    embeddings: { enabled: false },
    typeInference: false,
    typeInferenceCrossFile: false,
    treeSitter: {
      deferMissing: false
    }
  },
  tooling: {
    autoEnableOnDetect: false,
    lsp: { enabled: false }
  }
};

const cases = [
  {
    name: 'basic JSON output includes nodes, members, and contract warnings when metadata is absent',
    async run() {
      const { repoRoot, env } = await createMapFixture({
        tempName: 'code-map-contract-basic',
        files: {
          'src/util.js': 'export function add(a, b) { return a + b; }\nexport function mutate(obj) { obj.count = obj.count + 1; return obj; }\n',
          'src/main.js': 'import { add, mutate } from "./util.js";\nfunction run(x) {\n  if (x > 0) { return add(x, 1); }\n  return add(x, 2);\n}\nasync function go(items) {\n  for (const item of items) {\n    await Promise.resolve(item);\n    mutate(item);\n  }\n}\nexport default function main(items) { return go(items); }\n'
        },
        testConfig: defaultConfig
      });
      buildCodeIndex({ repoRoot, env });
      const mapResult = runCodeMap({ repoRoot, env, args: ['--format', 'json'] });
      assert.equal(mapResult.status, 0);
      const payload = JSON.parse(mapResult.stdout || '{}');
      assert.ok(Array.isArray(payload.nodes) && payload.nodes.length > 0);
      const members = payload.nodes.flatMap((node) => node.members || []);
      assert.ok(members.length > 0);
      const hasControlFlow = members.some((member) => member.controlFlow);
      const hasDataflow = members.some((member) => member.dataflow);
      const warnings = new Set(payload.warnings || []);
      if (!hasDataflow) {
        assert.ok(warnings.has('dataflow metadata missing; map is limited'));
      }
      if (!hasControlFlow) {
        assert.ok(warnings.has('controlFlow metadata missing; map is limited'));
      }
    }
  },
  {
    name: 'JSON output is deterministic across repeated runs',
    async run() {
      const { repoRoot, env } = await createMapFixture({
        tempName: 'code-map-contract-determinism',
        files: {
          'src/one.js': 'export function alpha() { return 1; }\n',
          'src/two.js': 'import { alpha } from "./one.js";\nexport function beta() { return alpha(); }\n'
        },
        testConfig: defaultConfig
      });
      buildCodeIndex({ repoRoot, env });

      const first = runCodeMap({ repoRoot, env, args: ['--format', 'json'] });
      const second = runCodeMap({ repoRoot, env, args: ['--format', 'json'] });
      assert.equal(first.status, 0);
      assert.equal(second.status, 0);

      const strip = (payload) => {
        const clone = JSON.parse(JSON.stringify(payload));
        clone.generatedAt = null;
        if (clone.summary) clone.summary.generatedAt = null;
        if (clone.buildMetrics) clone.buildMetrics = null;
        return clone;
      };

      assert.deepEqual(
        strip(JSON.parse(first.stdout || '{}')),
        strip(JSON.parse(second.stdout || '{}'))
      );
    }
  },
  {
    name: 'dot output emits graph header and ports',
    async run() {
      const { repoRoot, env } = await createMapFixture({
        tempName: 'code-map-contract-dot',
        files: {
          'src/a.js': 'import { add } from "./b.js";\nexport function run(x) { return add(x, 1); }\n',
          'src/b.js': 'export function add(a, b) { return a + b; }\n'
        },
        testConfig: defaultConfig
      });
      buildCodeIndex({ repoRoot, env });
      const mapResult = runCodeMap({
        repoRoot,
        env,
        args: ['--format', 'dot', '--include', 'imports,calls']
      });
      assert.equal(mapResult.status, 0);
      const output = getCombinedOutput(mapResult);
      assert.ok(output.includes('PORT='));
      assert.ok(output.includes('digraph'));
    }
  },
  {
    name: 'svg requests fall back to dot when graphviz is unavailable',
    async run() {
      const { repoRoot, env } = await createMapFixture({
        tempName: 'code-map-contract-graphviz-fallback',
        files: {
          'src/a.js': 'export function alpha() { return 1; }\n'
        },
        testConfig: {
          indexing: {
            scm: { provider: 'none' },
            typeInference: false,
            typeInferenceCrossFile: false
          },
          tooling: {
            autoEnableOnDetect: false,
            lsp: { enabled: false }
          }
        }
      });
      buildCodeIndex({ repoRoot, env });
      const outPath = path.join(path.dirname(repoRoot), 'map.svg');
      const mapResult = runCodeMap({
        repoRoot,
        env: { ...env, PATH: '', Path: '' },
        args: ['--format', 'svg', '--out', outPath, '--json'],
        allowFailure: true
      });
      assert.equal(mapResult.status, 0);
      const payload = JSON.parse(mapResult.stdout || '{}');
      assert.equal(payload.format, 'dot');
      assert.ok(String(payload.outPath || '').endsWith('.dot'));
    }
  },
  {
    name: 'map builder prefers symbolId over chunkUid for member identity',
    async run() {
      const tempRoot = resolveTestCachePath(root, 'code-map-contract-symbol-identity');
      const indexRoot = path.join(tempRoot, 'index');
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
      await fsPromises.mkdir(indexRoot, { recursive: true });

      const chunkMeta = [
        {
          id: 1,
          start: 0,
          end: 10,
          file: 'src/alpha.js',
          name: 'alpha',
          kind: 'function',
          chunkUid: 'uid-alpha',
          metaV2: {
            chunkUid: 'uid-alpha',
            file: 'src/alpha.js',
            name: 'alpha',
            kind: 'function',
            symbol: {
              v: 1,
              scheme: 'heur',
              kindGroup: 'function',
              qualifiedName: 'alpha',
              symbolKey: 'src/alpha.js::alpha::function',
              signatureKey: null,
              scopedId: 'function|src/alpha.js::alpha::function|uid-alpha',
              symbolId: 'sym1:heur:alpha'
            }
          }
        }
      ];

      const { writePiecesManifest } = await import('../../helpers/artifact-io-fixture.js');
      const { buildCodeMap } = await import('../../../src/map/build-map.js');
      await fsPromises.writeFile(path.join(indexRoot, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2));
      await writePiecesManifest(indexRoot, [
        { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }
      ]);

      const mapModel = await buildCodeMap({
        repoRoot: root,
        indexDir: indexRoot,
        options: { include: [], strict: false }
      });

      const member = mapModel.nodes?.[0]?.members?.[0];
      assert.ok(member, 'expected member in map');
      assert.equal(member.id, 'sym1:heur:alpha', 'expected member id to prefer symbolId');
      assert.notEqual(member.id, 'uid-alpha', 'expected member id to differ from chunkUid');
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('code map contract matrix test passed');
