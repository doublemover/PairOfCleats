import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { exactLspLocationRange, normalizeLspLocations } from '../../../src/index/semantic/lsp-locations.js';
import { createLspObservationCollector } from '../../../src/integrations/tooling/providers/lsp/structured-observations.js';

const text = '😀 function value() {}\r\nother();';
const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'selection-container',
  path: 'input.js', language: 'javascript' }).manifest;
const uri = 'file:///selection-container/input.js';
const range = (start, end) => ({ start: { line: 0, character: start }, end: { line: 0, character: end } });
const selection = range(12, 17), container = range(3, 22);
const identity = { sourceHash: source.byteHash, sourceUnitId: source.sourceUnitId, sessionId: 'session',
  profileId: 'profile', generation: { baseBuildId: 'fixture', semanticRevision: 0 }, contextHash: 'a'.repeat(64), uri };
const collector = createLspObservationCollector({ identity, consumers: ['navigation', 'symbolDetail', 'hierarchyDetail'],
  sourceForUri: value => value === uri ? { source, text } : null, projectReady: 'ready' });
let query = 0;
const record = (requestClass, payload) => collector.record({ requestClass,
  params: { textDocument: { uri }, query: query++ }, response: { attempted: true, payload } });

for (const payload of [
  { targetUri: uri, targetRange: container, targetSelectionRange: selection },
  { uri, range: selection }
]) {
  const [location] = normalizeLspLocations(payload);
  assert.equal(location.valid, true);
  assert.deepEqual(exactLspLocationRange(source, text, location), [12, 17]);
  const result = record('definition', [payload]);
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.facts[0].target.span, [12, 17]);
}
for (const payload of [
  false,
  { targetUri: uri, targetRange: range(3, 12), targetSelectionRange: selection },
  { targetUri: uri, targetRange: container },
  { targetUri: uri, targetSelectionRange: selection },
  { targetUri: null, uri, range: selection },
  { targetUri: uri, uri, range: selection, targetRange: container },
  { uri, range: range(17, 12) },
  { targetUri: uri, targetRange: container, targetSelectionRange: selection, originSelectionRange: range(4, 3) }
]) {
  const [location] = normalizeLspLocations(payload);
  assert.equal(location.valid, false, 'malformed protocol shape or ownership cannot borrow another range');
  assert.equal(exactLspLocationRange(source, text, location), null);
  const result = record('definition', [payload]);
  assert.equal(result.state, 'partial');
  assert.equal(result.exactCount, 0);
  assert.equal(result.facts.length, 0);
  assert.ok(result.omissions.includes('malformed_location'));
}
const invalidContainer = range(3, 999);
for (const badRange of [range(3, 12), invalidContainer, range(1, 22)]) {
  const result = record('documentSymbol', [{ name: 'value', kind: 12, selectionRange: selection, range: badRange }]);
  assert.equal(result.state, 'partial');
  assert.equal(result.facts[0].target.state, 'invalid_range');
  assert.equal(result.facts[0].target.span, null);
  assert.equal(result.exactCount, 0, 'a valid selection cannot qualify an invalid enclosing source range');
}
const flat = record('documentSymbol', [{ name: 'value', kind: 12, location: { uri, range: selection } }]);
assert.equal(flat.state, 'complete', 'flat SymbolInformation does not invent a missing container requirement');
for (const requestClass of ['prepareCallHierarchy', 'incomingCalls', 'outgoingCalls', 'prepareTypeHierarchy', 'supertypes', 'subtypes']) {
  for (const badRange of [range(3, 12), invalidContainer]) {
    const item = { uri, name: 'value', kind: 12, range: badRange, selectionRange: selection };
    const payload = requestClass === 'incomingCalls' ? { from: item, fromRanges: [selection] }
      : requestClass === 'outgoingCalls' ? { to: item, fromRanges: [selection] } : item;
    const before = collector.metrics().retainedItems;
    const result = record(requestClass, [payload]);
    assert.equal(result.state, 'partial');
    assert.equal(result.facts[0].target.state, 'invalid_range');
    assert.equal(result.facts[0].itemToken, null, 'invalid hierarchy selection cannot mint a follow-up request token');
    assert.equal(collector.metrics().retainedItems, before);
  }
}
const invalidOrigin = record('definition', [{ targetUri: uri, targetRange: container,
  targetSelectionRange: selection, originSelectionRange: range(1, 2) }]);
assert.equal(invalidOrigin.state, 'partial', 'split scalar origin is retained as invalid evidence');
assert.equal(invalidOrigin.facts[0].origin.state, 'invalid_range');
assert.deepEqual(invalidOrigin.facts[0].target.span, [12, 17]);
const invalidEnclosure = normalizeLspLocations({ targetUri: uri, targetRange: invalidContainer, targetSelectionRange: selection })[0];
assert.equal(invalidEnclosure.valid, true, 'protocol containment alone does not prove source coordinates');
assert.equal(exactLspLocationRange(source, text, invalidEnclosure), null);
console.log('LSP selection/container protocol and source ownership test passed');
