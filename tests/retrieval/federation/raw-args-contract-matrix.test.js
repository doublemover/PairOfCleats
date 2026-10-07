#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildPerRepoArgsFromCli,
  parseFederatedCliRequest
} from '../../../src/retrieval/federation/args.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import {
  createWorkspaceFixture,
  removeWorkspaceFixture,
  writeIndexArtifacts
} from '../../helpers/workspace-fixture.js';

const withWorkspace = async ({ modes, compatibilityKey = 'compat-test' }, run) => {
  const fixture = await createWorkspaceFixture('pairofcleats-fed-rawargs-matrix-');
  try {
    const buildRoot = path.join(fixture.repoCacheRoot, 'builds', 'test-build');
    await fs.mkdir(buildRoot, { recursive: true });
    for (const mode of modes) {
      await writeIndexArtifacts({
        buildRoot,
        mode,
        compatibilityKey: `${compatibilityKey}-${mode}`
      });
    }
    await fs.writeFile(
      path.join(fixture.repoCacheRoot, 'builds', 'current.json'),
      JSON.stringify({
        buildId: 'test-build',
        buildRoot,
        modes
      }, null, 2),
      'utf8'
    );
    await run(fixture);
  } finally {
    await removeWorkspaceFixture(fixture.tempRoot);
  }
};

const cases = [
  {
    name: 'CLI mode forwards into federated request',
    async run() {
      const workspacePath = 'C:\\workspace\\.pairofcleats-workspace.jsonc';
      const request = parseFederatedCliRequest([
        '--workspace',
        workspacePath,
        '--mode',
        'records',
        'find-me'
      ]);
      assert.equal(request.workspacePath, workspacePath);
      assert.equal(request.query, 'find-me');
      assert.equal(request.mode, 'records');
    }
  },
  {
    name: 'per-repo args preserve end-of-options marker and inject json/top once',
    async run() {
      const args = buildPerRepoArgsFromCli({
        rawArgs: [
          'query-token',
          '--workspace',
          'workspace.jsonc',
          '--top',
          '9',
          '--',
          '--tag',
          '--top',
          '-n',
          '--repo-filter'
        ],
        perRepoTop: 7
      });
      const marker = args.indexOf('--');
      assert.ok(marker > -1);
      const optionTokens = args.slice(0, marker);
      const positionalTokens = args.slice(marker + 1);
      assert.equal(optionTokens.includes('--workspace'), false);
      assert.deepEqual(positionalTokens, ['--tag', '--top', '-n', '--repo-filter']);
      assert.equal(optionTokens.filter((token) => token === '--top').length, 1);
      assert.equal(optionTokens[optionTokens.length - 2], '--top');
      assert.equal(optionTokens[optionTokens.length - 1], '7');
      assert.equal(optionTokens.includes('--json'), true);
      assert.doesNotThrow(() => buildPerRepoArgsFromCli({
        rawArgs: [
          'query-token',
          '--workspace',
          'workspace.jsonc',
          '--',
          '--top',
          '--top'
        ],
        perRepoTop: 7
      }));
    }
  },
  {
    name: 'compact top flag rewrites cleanly and still detects duplicates',
    async run() {
      const perRepoTop = 7;
      const args = buildPerRepoArgsFromCli({
        rawArgs: [
          'query-token',
          '--workspace',
          'workspace.jsonc',
          '-n10'
        ],
        perRepoTop
      });
      assert.equal(args.includes('-n10'), false);
      assert.equal(args.filter((token) => token === '--top').length, 1);
      assert.equal(args.includes('--json'), true);
      const topFlagIndex = args.indexOf('--top');
      assert.equal(args[topFlagIndex + 1], String(perRepoTop));
      assert.throws(
        () => buildPerRepoArgsFromCli({
          rawArgs: [
            'query-token',
            '--workspace',
            'workspace.jsonc',
            '-n10',
            '--top',
            '5'
          ],
          perRepoTop
        }),
        /multiple --top values/i
      );
    }
  },
  {
    name: 'query token forwards exactly once in raw-args execution',
    async run() {
      await withWorkspace({ modes: ['code'] }, async ({ workspacePath }) => {
        const queryToken = 'federated-query-token';
        const rawArgs = [
          queryToken,
          '--workspace',
          workspacePath,
          '--mode',
          'code',
          '--top',
          '5'
        ];
        const searchCalls = [];
        await runFederatedSearch({
          workspacePath,
          query: queryToken,
          rawArgs
        }, {
          searchFn: async (_repoRootCanonical, params) => {
            searchCalls.push(params);
            return {
              backend: 'memory',
              code: [],
              prose: [],
              extractedProse: [],
              records: []
            };
          }
        });
        assert.equal(searchCalls.length, 1);
        const [call] = searchCalls;
        assert.equal(String(call?.query || ''), '');
        assert.equal(
          (Array.isArray(call?.args) ? call.args : []).filter((token) => token === queryToken).length,
          1
        );
      });
    }
  },
  {
    name: 'records mode forwards and only merges records hits',
    async run() {
      await withWorkspace({ modes: ['records'] }, async ({ workspacePath }) => {
        const queryToken = 'federated-mode-records-token';
        const rawArgs = [
          queryToken,
          '--workspace',
          workspacePath,
          '--mode',
          'records',
          '--top',
          '5'
        ];
        const request = parseFederatedCliRequest(rawArgs);
        const searchCalls = [];
        const response = await runFederatedSearch(request, {
          searchFn: async (_repoRootCanonical, params) => {
            searchCalls.push(params);
            return {
              backend: 'memory',
              code: [{ id: 'code-1', file: 'src/code.js', start: 1, end: 1, score: 1 }],
              prose: [],
              extractedProse: [],
              records: [{ id: 'record-1', file: 'records/input.json', start: 1, end: 1, score: 1 }]
            };
          }
        });
        assert.equal(searchCalls.length, 1);
        const [call] = searchCalls;
        assert.equal(String(call?.query || ''), '');
        assert.equal(Array.isArray(call?.args) && call.args.includes('records'), true);
        assert.equal(response.records.length, 1);
        assert.equal(response.code.length, 0);
        assert.equal(response.prose.length, 0);
        assert.equal(response.extractedProse.length, 0);
      });
    }
  },
  {
    name: 'top zero survives parse and per-repo forwarding',
    async run() {
      await withWorkspace({ modes: ['code'] }, async ({ workspacePath }) => {
        const request = parseFederatedCliRequest([
          '--workspace',
          workspacePath,
          '--mode',
          'code',
          '--top',
          '0',
          'needle'
        ]);
        assert.equal(request.top, 0);
        assert.equal(request.perRepoTop, 0);
        const searchCalls = [];
        const response = await runFederatedSearch(request, {
          searchFn: async (_repoRootCanonical, params) => {
            searchCalls.push(params);
            return {
              backend: 'memory',
              code: [
                { id: 'hit-1', file: 'src/a.js', start: 1, end: 1, score: 1 },
                { id: 'hit-2', file: 'src/b.js', start: 1, end: 1, score: 1 }
              ],
              prose: [],
              extractedProse: [],
              records: []
            };
          }
        });
        const args = Array.isArray(searchCalls[0]?.args) ? searchCalls[0].args : [];
        const topFlagIndex = args.findIndex((token) => token === '--top');
        assert.notEqual(topFlagIndex, -1);
        assert.equal(args[topFlagIndex + 1], '0');
        assert.equal(response.code.length, 0);
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('federated raw args contract matrix test passed');
