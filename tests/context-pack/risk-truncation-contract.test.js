import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildRiskCallSite, buildRiskFlow, buildRiskPiecesManifestFields, buildRiskStatsFields,
  buildRiskSummary, createRiskRepoIndexFixture, writeJsonl
} from '../helpers/risk-pack-eval.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';
import { createAnalysisSurfaceHarness } from '../helpers/analysis-surface-parity.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream/json-writers.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { CONTEXT_PACK_RISK_TRUNCATION_CAPS } from '../../src/contracts/context-pack-risk-contract.js';
import { truncationRecordSchema } from '../../src/contracts/schemas/analysis/graph.js';
import { parse } from 'acorn';

const emittedCaps = new Set();
for (const file of ['src/context-pack/assemble/budgets.js', 'src/context-pack/assemble/risk-slice.js']) {
  const pending = [parse(await fs.readFile(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'CallExpression' && node.callee?.name === 'recordRiskTruncation') {
      assert.equal(node.arguments[0]?.type, 'Literal', 'truncation emission requires a statically admitted cap');
      emittedCaps.add(node.arguments[0].value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value.filter(entry => entry && typeof entry === 'object'));
      else if (value && typeof value === 'object') pending.push(value);
    }
  }
}
assert.deepEqual([...emittedCaps].sort(), [...CONTEXT_PACK_RISK_TRUNCATION_CAPS].sort(), 'every emitted risk cap has one canonical contract entry');
assert.ok([...emittedCaps].every(cap => truncationRecordSchema.properties.cap.enum.includes(cap)));

const cases = {
  'excerpt-bytes': 'maxCallSiteExcerptBytes', 'excerpt-tokens': 'maxCallSiteExcerptTokens',
  'partial-count': 'maxPartialFlows', 'partial-bytes': 'maxPartialBytes', 'partial-tokens': 'maxPartialTokens'
};
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('context-pack/risk-truncation-contract/')[1];
if (selected) assert.ok(Object.hasOwn(cases, selected));
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./risk-truncation-contract.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases: Object.keys(cases) });
const { dir } = await prepareIsolatedTestCacheDir('risk-truncation-contract');
const cacheRoot = path.join(dir, 'cache');
const env = applyTestEnv({ syncProcess: false, cacheRoot,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_HOME: path.join(dir, 'home') } });
try {
  await withTemporaryEnv(env, async () => {
    for (const name of selected ? [selected] : Object.keys(cases)) {
      const expectedCap = cases[name], repoPath = path.join(dir, name);
      const query = name === 'excerpt-bytes' ? `query('${'x'.repeat(400)}')`
        : name === 'excerpt-tokens' ? `query(${Array(40).fill('a').join(', ')})` : 'query(input)';
      const sourceText = `export function risky(input) {\n  return ${query};\n}\n`;
      const fileRelPath = 'src/risk.js', generatedAt = '2026-10-20T00:00:00.000Z';
      const { finalIndexDir } = await createRiskRepoIndexFixture({ repoPath, cacheRoot, fileRelPath,
        sourceText, alias: name, generatedAt, compatibilityKey: 'compat-risk-caps' });
      const flow = buildRiskFlow({ alias: name, flowId: `sha1:${'1'.repeat(40)}` });
      const partials = [];
      if (name.startsWith('partial-')) {
        for (let index = 0; index < (name === 'partial-count' ? 6 : 1); index += 1) {
          const base = structuredClone(flow);
          delete base.flowId;
          delete base.sink;
          const partial = { ...base, partialFlowId: `sha1:${String(index + 2).repeat(40)}`,
            frontier: { chunkUid: 'chunk-frontier', terminalReason: 'maxDepth', blockedExpansions: [] },
            notes: { ...base.notes, terminalReason: 'maxDepth' } };
          if (name === 'partial-bytes') partial.source.ruleName = 'x'.repeat(25000);
          if (name === 'partial-tokens') partial.source.ruleName = 'word '.repeat(2000);
          partials.push(partial);
        }
      }
      const stats = buildRiskStatsFields({ generatedAt, flowsEmitted: 1, uniqueCallSitesReferenced: 1, maxCallSitesPerEdge: 1 });
      stats.fields.counts.partialFlowsEmitted = partials.length;
      await writeJsonObjectFile(path.join(finalIndexDir, 'risk_interprocedural_stats.json'), stats);
      await writeJsonl(path.join(finalIndexDir, 'risk_summaries.jsonl'), [buildRiskSummary({ fileRelPath,
        languageId: 'javascript', symbolName: 'risky', symbolKind: 'FunctionDeclaration', signature: 'risky(input)' })]);
      await writeJsonl(path.join(finalIndexDir, 'risk_flows.jsonl'), [flow]);
      await writeJsonl(path.join(finalIndexDir, 'risk_partial_flows.jsonl'), partials);
      const callSite = buildRiskCallSite({ callSiteId: `cs-${name}`,
        fileRelPath, languageId: 'javascript', queryOffset: sourceText.indexOf(query), queryExcerpt: query });
      if (name === 'excerpt-tokens') callSite.args = Array(40).fill('a');
      if (name === 'excerpt-bytes') callSite.args = [`'${'x'.repeat(400)}'`];
      await writeJsonl(path.join(finalIndexDir, 'call_sites.jsonl'), [callSite]);
      const manifest = buildRiskPiecesManifestFields({ compatibilityKey: 'compat-risk-caps', generatedAt, stage: name });
      manifest.fields.pieces.push({ name: 'risk_partial_flows', path: 'risk_partial_flows.jsonl', format: 'jsonl' });
      await writeJsonObjectFile(path.join(finalIndexDir, 'pieces', 'manifest.json'), manifest);
      const args = { repoPath, seed: 'chunk:chunk-risk', hops: 0, includeRisk: true, includeRiskPartialFlows: true,
        includeGraph: false, includeImports: false, includeUsages: false, includeCallersCallees: false };
      const cliArgs = ['context-pack', '--json', '--repo', repoPath, '--seed', args.seed, '--hops', '0',
        '--includeRisk', '--includeRiskPartialFlows', '--includeGraph=false', '--includeImports=false',
        '--includeUsages=false', '--includeCallersCallees=false'];
      const harness = await createAnalysisSurfaceHarness({ fixtureRoot: repoPath, env: process.env });
      try {
        const cli = harness.runCli(cliArgs);
        assert.equal(cli.status, 0, `${name}: ${cli.stdout} ${cli.stderr}`);
        const api = await harness.runApi('/analysis/context-pack', args);
        const mcp = await harness.runMcp('context_pack', args);
        assert.equal(api.status, 200, JSON.stringify(api.parsed));
        assert.equal(mcp.ok, true, mcp.error?.message);
        const capRecords = [];
        for (const pack of [cli.parsed, api.parsed.result, mcp.result]) {
          const validation = validateCompositeContextPack(pack);
          assert.equal(validation.ok, true, validation.errors.join('; '));
          assert.ok(pack.risk.caps.hits.includes(expectedCap));
          const record = pack.risk.truncation.find(entry => entry.cap === expectedCap);
          assert.ok(record, `expected ${expectedCap} risk truncation`);
          assert.ok(pack.truncation.some(entry => entry.cap === expectedCap));
          capRecords.push(record);
          assert.equal(pack.risk.flows.length, 1, 'ordinary indexed positive flow stays in the bounded result');
          assert.ok(pack.risk.partialFlows.length <= 5);
          const invalid = structuredClone(pack);
          invalid.risk.truncation[0].cap = 'unknown-risk-cap';
          assert.equal(validateCompositeContextPack(invalid).ok, false, 'unknown cap names remain rejected');
        }
        assert.deepEqual(capRecords[1], capRecords[0]);
        assert.deepEqual(capRecords[2], capRecords[0]);
        const strictCli = harness.runCli([...cliArgs, '--strictRisk']);
        const strictApi = await harness.runApi('/analysis/context-pack', { ...args, strictRisk: true });
        const strictMcp = await harness.runMcp('context_pack', { ...args, strictRisk: true });
        assert.equal(strictCli.status, 1);
        assert.equal(strictApi.status, 500, 'existing API error projection retains its status');
        assert.equal(strictMcp.ok, false);
        assert.match(strictCli.stdout + strictCli.stderr, /Risk slice strict failure: capped/);
        assert.match(JSON.stringify(strictApi.parsed), /Risk slice strict failure: capped/);
        assert.equal(strictMcp.error.code, 'ERR_CONTEXT_PACK_RISK_STRICT');
      } finally { await harness.close(); }
    }
  });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Documented risk caps retain schema-valid bounded evidence and strict rejection across all surfaces');
