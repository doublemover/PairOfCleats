import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Tokenizer } from '@huggingface/tokenizers';
import { assembleCompositeContextPack, buildChunkIndex } from '../../src/context-pack/assemble.js';
import { applyContextEvidenceSelection } from '../../src/context-pack/evidence-selection.js';
import { buildContextEvidenceCandidatePool } from '../../src/context-pack/evidence-candidate-pool.js';
import { resolveEvidenceSelectionPolicy } from '../../src/context-pack/evidence-selection-policy.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { createWorkBudget } from '../../src/graph/work-budget.js';
import { createContextTokenizerProfile } from '../helpers/context-tokenizer-profile.js';
import { summarizeEvidenceControlComparison } from '../../tools/eval/evidence-controls.js';

// UNVALIDATED: real contained files, exact indexed hashes, complete-function
// parser and bounded tokenizer worker. No model download or native fallback.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['source', 'file-units', 'drift', 'aliases', 'duplicate-looking', 'ambiguous-uid', 'ambiguous-primary', 'missing-source',
  'missing-roles', 'pool-cap', 'candidate-cap', 'zero', 'one', 'exact-limit', 'one-under', 'mandatory-overflow',
  'cancelled', 'projection', 'comparison'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'evidence-source-'));
try {
  const texts = { seed: 'export function seed() { return "mandatory"; }',
    a: 'export function first() { return "alpha shared"; }',
    b: selected === 'duplicate-looking' ? 'export function first() { return "alpha shared"; }' : 'export function second() { return "beta unique"; }' };
  const chunkMeta = [];
  for (const [id, text] of Object.entries(texts)) {
    await fs.writeFile(path.join(root, `${id}.js`), text);
    chunkMeta.push({ chunkUid: id, file: `${id}.js`, start: 0, end: text.length, kind: 'FunctionDeclaration',
      fileHash: createHash('sha256').update(text).digest('hex'), fileHashAlgo: 'sha256' });
  }
  if (selected === 'aliases') chunkMeta.push({ ...chunkMeta[1], chunkUid: 'alias-a' });
  if (selected === 'ambiguous-uid') chunkMeta.push({ ...chunkMeta[1], file: 'b.js' });
  if (selected === 'ambiguous-primary') chunkMeta.push({ ...chunkMeta[0], file: 'b.js' });
  const ids = [...new Set(chunkMeta.map(row => row.chunkUid))];
  const graphRelations = { version: 1, callGraph: { nodeCount: ids.length, edgeCount: ids.length - 1,
    nodes: ids.map(id => ({ id, file: chunkMeta.find(row => row.chunkUid === id).file,
      out: id === 'seed' ? ids.filter(value => value !== 'seed') : [], in: id === 'seed' ? [] : ['seed'] })) } };
  const taskPolicy = { schemaVersion: 1, task: 'edit-safe', granularity: selected === 'file-units' ? 'file' : 'function', wholeFileFallback: false };
  const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot: root });
  const payload = assembleCompositeContextPack({ repoRoot: root, seed: { type: 'chunk', chunkUid: 'seed' }, chunkMeta,
    chunkIndex, graphRelations, taskPolicy, includeGraph: true, strictEvidence: true, indexSignature: 'evidence-source-v1',
    now: () => '2026-10-28T00:00:00.000Z' });
  if (selected === 'missing-roles') payload.graph.edges = [];
  if (selected === 'drift') await fs.appendFile(path.join(root, 'a.js'), '\n// actual working tree change');
  if (selected === 'missing-source') await fs.unlink(path.join(root, 'a.js'));
  const input = { schemaVersion: 1, algorithm: 'top-k', maxCandidates: 16, maxSelected: 4, maxMeasurements: 16,
    ...(selected === 'zero' ? { maxSelected: 0 } : {}), ...(selected === 'one' ? { maxSelected: 1 } : {}),
    ...(selected === 'pool-cap' ? { maxPoolBytes: 0 } : {}), ...(selected === 'candidate-cap' ? { maxCandidates: 1 } : {}) };
  const policy = resolveEvidenceSelectionPolicy(input);
  const snapshot = JSON.stringify(payload);
  const pool = buildContextEvidenceCandidatePool({ payload, chunkIndex, repoRoot: root, taskPolicy, policy,
    budget: createWorkBudget({ ...policy, checkEvery: 1 }) });
  assert.equal(Object.isFrozen(pool), true); assert.equal(Object.isFrozen(pool.decisions), true);
  if (selected === 'aliases') { assert.equal(pool.candidates.length, 2); assert.ok(pool.decisions.some(row => row.reason === 'duplicate-intact-unit')); }
  if (selected === 'duplicate-looking') assert.equal(new Set(pool.candidates.map(row => row.entry.unitId)).size, 2,
    'identical-looking text in different source files is distinct evidence');
  if (selected === 'ambiguous-uid') assert.ok(pool.decisions.some(row => row.reason === 'ambiguous-chunk-identity'));
  if (selected === 'missing-source') assert.ok(pool.decisions.some(row => row.reason === 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE'));
  if (selected === 'drift') assert.ok(pool.decisions.some(row => row.reason === 'ERR_CONTEXT_PACK_SOURCE_MISMATCH'));
  const profile = await createContextTokenizerProfile(root);
  const controller = new AbortController(); if (selected === 'cancelled') controller.abort();
  const run = (tokenPolicy = profile.policy, extra = {}) => applyContextEvidenceSelection({ payload, chunkIndex, repoRoot: root,
    taskPolicy, policy, tokenPolicy, signal: controller.signal, ...extra });
  if (selected === 'cancelled') await assert.rejects(run(), error => error.code === 'ABORT_ERR');
  else if (selected === 'ambiguous-primary') await assert.rejects(run(), error => error.code === 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE');
  else if (selected === 'mandatory-overflow') await assert.rejects(run({ ...profile.policy, maxTokens: 0 }),
    error => error.code === 'ERR_CONTEXT_PACK_TOKEN_BUDGET' && error.status === 413);
  else {
    const result = await run(profile.policy, { compareControls: selected === 'comparison' }); result.publish();
    const checked = validateCompositeContextPack(result.payload); assert.equal(checked.ok, true, checked.errors.join('; '));
    const section = result.payload.evidenceSelection;
    assert.equal(result.payload.primary.excerpt, texts.seed);
    assert.equal(result.payload.tokenAccounting.renderedTokens,
      new Tokenizer(profile.tokenizer, profile.config).encode(result.payload.renderedContext, { add_special_tokens: true }).ids.length);
    assert.ok(section.selected.every(row => !['seed'].includes(row.ref.chunkUid)));
    for (const entry of section.selected) {
      assert.equal(entry.excerpt, texts[entry.ref.chunkUid] ?? texts.a); assert.ok(result.payload.renderedContext.includes(entry.excerpt));
      assert.equal(entry.unit.indexSignature, payload.provenance.indexSignature);
    }
    if (['source', 'file-units', 'duplicate-looking'].includes(selected)) assert.equal(section.selected.length, 2);
    if (['zero', 'pool-cap', 'candidate-cap'].includes(selected)) { assert.equal(section.selected.length, 0); assert.equal(section.partial, true); }
    if (selected === 'one') assert.equal(section.selected.length, 1);
    if (selected === 'missing-roles') assert.equal(section.coverage.unknownRoleIds.length, 2);
    if (['exact-limit', 'one-under'].includes(selected)) {
      const tokens = result.payload.tokenAccounting.renderedTokens;
      const bounded = await run({ ...profile.policy, maxTokens: tokens - (selected === 'one-under' ? 1 : 0) }); bounded.publish();
      assert.ok(bounded.payload.tokenAccounting.admittedTokens <= bounded.payload.tokenAccounting.maxTokens);
      assert.equal(bounded.payload.evidenceSelection.selected.length, selected === 'exact-limit' ? 2 : 1);
    }
    if (selected === 'projection') for (const change of [value => { value.evidenceSelection.selected[0].excerpt += '!'; },
      value => { value.evidenceSelection.decisions[0].roles = ['export']; }, value => { value.evidenceSelection.poolDigest = 'f'.repeat(64); },
      value => { value.evidenceSelection.stats.workUnits = value.evidenceSelection.policy.maxWorkUnits + 1; },
      value => { value.evidence.selection.state = 'partial'; }]) {
      const altered = structuredClone(result.payload); change(altered);
      assert.equal(validateCompositeContextPack(altered).ok, false);
    }
    if (selected === 'comparison') {
      assert.equal(result.comparison.length, 4); assert.equal(new Set(result.comparison.map(row => row.payload.evidenceSelection.poolDigest)).size, 1);
      for (const row of result.comparison) {
        const valid = validateCompositeContextPack(row.payload); assert.equal(valid.ok, true, valid.errors.join('; '));
        assert.equal(row.payload.tokenAccounting.maxTokens, profile.policy.maxTokens);
        assert.equal(row.observation.sourceWorkUnits, result.comparison[0].observation.sourceWorkUnits);
      }
      const report = summarizeEvidenceControlComparison(result.comparison, { goldChunkUids: ['seed', 'a', 'b'] });
      assert.equal(report.samePoolIdentity, true); assert.equal(report.controls.length, 4);
      assert.equal(report.taskOutcomes.status, 'not-measured'); assert.equal(report.controls[0].goldEvidenceRecall, 1);
      assert.ok(report.controls.every(row => row.observation.memoryMeaning.includes('not a peak')));
      const altered = structuredClone(result.comparison); altered[1].payload.evidenceSelection.poolDigest = 'f'.repeat(64);
      assert.throws(() => summarizeEvidenceControlComparison(altered), { code: 'ERR_EVIDENCE_CONTROL_COMPARISON' });
    }
  }
  assert.equal(JSON.stringify(payload), snapshot, 'selection cannot mutate the source payload or generation');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log(`Source-qualified evidence selection: ${selected}`);
