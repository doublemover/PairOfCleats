import assert from 'node:assert/strict';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

const cases = [
  ['python', 'sample.py', '# 🙂\r\ndef add(x: int, y=1):\r\n    if x:\r\n        return helper(x)\r\n    return y\r\n'],
  ['clike', 'sample.c', '/* 🙂 */ int add(int x) { if (x) return helper(x); return 0; }'],
  ['swift', 'sample.swift', '// 🙂\r\nfunc add(_ x: Int) -> Int { if x > 0 { return helper(x) }; return 0 }'],
  ['rust', 'sample.rs', '// 🙂\r\nfn add(x: i32) -> i32 { if x > 0 { helper(x) } else { 0 } }']
];
for (const [language, relPath, text] of cases) {
  const fixture = await createRecoveryFixture(text);
  try {
    const policy = normalizeSemanticConfig({ enabled: true, languages: ['python', 'c', 'swift', 'rust'], storage: { batchRows: 7, batchBytes: 8192 } });
    let scheduled = 0;
    const input = { ...fixture.options, text, bytes: fixture.bytes, language, relPath, repositoryNamespace: fixture.root, policy,
      scheduleParse: fn => { scheduled += 1; return fn(); } };
    const facts = await collectFileSemanticFacts(input);
    assert.equal(scheduled, 1, 'native parsing uses the existing scheduler admission');
    assert.equal(facts.coverage.find(row => row.phase === 'syntax').state, 'complete', language);
    assert.equal(facts.source.language, language === 'clike' ? 'c' : language);
    const store = fixture.store([facts.partition]);
    await validateSemanticPartitions({ store, partitions: [facts.partition] });
    const records = [], operands = [];
    for await (const row of store.iterateRows(facts.partition.partitionId, 'semantic_records')) records.push(row);
    for await (const row of store.iterateRows(facts.partition.partitionId, 'semantic_operands')) operands.push(row);
    const sourceText = record => text.slice(...record.span);
    assert.ok(records.some(row => row.kind === 'declaration' && sourceText(row) === 'add'), language + ' function symbol');
    assert.ok(records.some(row => row.kind === 'declaration' && sourceText(row) === 'x'), language + ' parameter symbol');
    const call = records.find(row => row.kind === 'expression' && row.data.invocationKind === 'call');
    assert.ok(call, language + ' call expression');
    assert.equal(call.data.syntacticArgumentCount, 1);
    assert.ok(records.some(row => row.kind === 'occurrence' && sourceText(row) === 'helper' && row.data.roles.includes('call')));
    assert.equal(operands.filter(row => row.parent.localId === call.id && row.slot === 'argument').length, 1);
    assert.ok(records.every(row => !row.span || row.span[1] <= text.length), 'native offsets preserve UTF16 after astral characters');
    const disabled = await collectFileSemanticFacts({ ...input, nativeParserEnabled: false });
    assert.equal(disabled.coverage[0].state, 'disabled');
    assert.match(disabled.coverage[0].reason, /parser_policy_disabled/);
    assert.notEqual(disabled.partition.partitionId, facts.partition.partitionId, 'parser admission is part of extraction identity');
    const analysisOff = await collectFileSemanticFacts({ ...input, policy: normalizeSemanticConfig({ ...policy, enrichment: { ...policy.enrichment, localFlow: 'off' } }) });
    assert.equal(analysisOff.partition.canonicalHash, facts.partition.canonicalHash, 'analysis modes do not change immutable syntax');
  } finally { await fixture.cleanup(); }
}
console.log('Native Python, C, Swift and Rust syntax, symbols, calls and UTF16 spans passed');
