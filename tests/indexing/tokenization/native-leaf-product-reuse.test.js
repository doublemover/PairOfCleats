import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';
import { getNativeTreeSitterParser, getNativeTreeSitterIdentity } from '../../../src/lang/tree-sitter/native-runtime.js';
import { createNativeLeafProduct, readNativeLeafProduct, NATIVE_LEAF_PRODUCT_LIMITS } from '../../../src/lang/tree-sitter/leaf-product.js';
import { attachSegmentMeta } from '../../../src/index/segments/chunk-meta.js';
import { createTokenizationContext, createTokenClassificationRuntime, tokenizeChunkText } from '../../../src/index/build/tokenization.js';

applyTestEnv({ testing: '1' });
const treeSitter = { enabled: true, strict: true, adaptive: false, chunkCache: false, languages: { javascript: true } };
const parser = getNativeTreeSitterParser('javascript', { treeSitter });
assert.ok(parser, 'the actual prepared native runtime is required; no optional skip qualifies reuse');
const originalParse = parser.parse;
let parses = 0;
parser.parse = function (...args) { parses++; return originalParse.apply(this,args); };
const contextFor = (words = []) => {
  const context = createTokenizationContext({ dictWords: new Set(words), dictConfig: {},
    postingsConfig: { tokenClassification: { enabled: true } }, treeSitter });
  context.tokenClassificationRuntime = createTokenClassificationRuntime({ context, fileBytes: 1024 });
  return context;
};
const buckets = value => Object.fromEntries(['tokens','identifierTokens','keywordTokens','operatorTokens','literalTokens'].map(key => [key,value[key]]));
const classify = (text, product, context = contextFor()) => tokenizeChunkText({ text,
  mode: 'code', ext: '.js', languageId: 'javascript', context, nativeClassificationLeaves: product });
try {
  const text = 'function parseHTTPResponse(世界) { return "hé😀" + 世界; }';
  const chunks = buildTreeSitterChunks({ text, languageId: 'javascript', ext: '.js', options: { treeSitter } });
  const owned = chunks.find(chunk => chunk.nativeClassificationLeaves);
  assert.ok(owned, 'the real native chunk owner emits a whole-input leaf product');
  const product = owned.nativeClassificationLeaves, identity = getNativeTreeSitterIdentity('javascript');
  assert.ok(Object.isFrozen(product) && Object.isFrozen(product.leaves) && product.leaves.every(Object.isFrozen));
  assert.ok(Buffer.byteLength(JSON.stringify(product)) <= NATIVE_LEAF_PRODUCT_LIMITS.encodedBytes);
  assert.ok(readNativeLeafProduct({ product, text, languageId: 'javascript', parserIdentity: identity }));
  const afterOwner = parses, context = contextFor(['http','response']);
  const reused = classify(text,product,context);
  assert.equal(parses,afterOwner,'reuse performs no second native parse');
  assert.equal(context.tokenClassificationRuntime.nativeLeafProductsReused,1);
  assert.equal(context.tokenClassificationRuntime.remainingChunks,95,'reuse consumes the same existing successful-classification chunk allowance');
  assert.equal(context.tokenClassificationRuntime.remainingBytes,384 * 1024 - Buffer.byteLength(text));
  const standalone = classify(text,null,contextFor(['http','response']));
  assert.equal(parses,afterOwner + 1);
  assert.deepEqual(buckets(reused),buckets(standalone));
  const changedDictionary = classify(text,product,contextFor(['parse','httpresponse']));
  assert.deepEqual(buckets(changedDictionary),buckets(classify(text,null,contextFor(['parse','httpresponse']))),
    'each consumer rebuilds leaf tokens under its actual dictionary instead of sharing normalized results');

  const serialized = JSON.parse(JSON.stringify(owned));
  const embedded = attachSegmentMeta({ chunk: serialized, segment: { segmentId:'embedded',type:'code',languageId:'javascript' },
    segmentUid:'embedded-source',segmentExt:'.js',segmentStart:17,segmentEnd:17 + text.length,segmentStartLine:2,segmentEndLine:2 });
  assert.equal(embedded.start,17);
  const afterBaseline = parses;
  assert.deepEqual(buckets(classify(text,embedded.nativeClassificationLeaves)),buckets(classify(text,product)));
  assert.equal(parses,afterBaseline,'JSON and segment rebasing carry ordinary spans without native handles');

  const tampered = JSON.parse(JSON.stringify(product)); tampered.leaves[0][1]++;
  const wrongBinding = JSON.parse(JSON.stringify(product)); wrongBinding.parserIdentity.parserArtifact = '0'.repeat(64);
  for (const [input, candidate] of [[text,tampered],[text,wrongBinding],[text.replace('世界','other'),product],
    [text.slice(9),product],[text.replace('return','/* removed */ return'),product]]) {
    const before = parses, fallback = classify(input,candidate);
    assert.equal(parses,before + 1,'mismatched source/range/binding/product retains standalone parsing');
    assert.deepEqual(buckets(fallback),buckets(classify(input,null)));
  }
  assert.equal(readNativeLeafProduct({ product,text,languageId:'typescript',parserIdentity:identity }),null);
  let getters = 0, enumerations = 0;
  const active = { ...product, get leaves() { getters++; return product.leaves; } };
  assert.equal(readNativeLeafProduct({ product:active,text,languageId:'javascript',parserIdentity:identity }),null);
  assert.equal(getters,0);
  const huge = { ...product, leaves:new Proxy(new Array(1000000),{ownKeys() { enumerations++; throw new Error('Oversized leaves enumerated.'); }}) };
  assert.equal(readNativeLeafProduct({ product:huge,text,languageId:'javascript',parserIdentity:identity }),null);
  assert.equal(enumerations,0,'bounded product capture denies huge array cardinality before enumeration');
  const disabled = contextFor(); disabled.tokenClassificationRuntime.remainingChunks = 0;
  const beforeDisabled = parses;
  classify(text,product,disabled);
  assert.equal(parses,beforeDisabled);
  assert.equal(disabled.tokenClassificationRuntime.nativeLeafProductsReused,undefined,'a product cannot bypass exhausted classification allowance');
  assert.equal(disabled.tokenClassificationRuntime.treeSitterDisabledReason,'chunk-budget');

  for (const count of [32,96]) {
    const many = Array.from({ length:count },(_,index)=>`function item${index}() { return ${index}; }`).join('\n');
    const ranges = buildTreeSitterChunks({ text:many,languageId:'javascript',ext:'.js',options:{treeSitter} });
    assert.ok(ranges.length >= count);
    assert.ok(ranges.every(chunk => !chunk.nativeClassificationLeaves),'narrower chunks have no whole-input context proof');
  }
  const malformed = 'function broken( {';
  const broken = buildTreeSitterChunks({ text:malformed,languageId:'javascript',ext:'.js',options:{treeSitter} });
  assert.ok(broken.every(chunk => !chunk.nativeClassificationLeaves),'recovery context cannot authorize this initial reuse profile');
  const tree = originalParse.call(parser,text);
  assert.equal(createNativeLeafProduct({ text,root:tree.rootNode,languageId:'javascript',parserIdentity:identity,maxWork:1 }),null);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => createNativeLeafProduct({ text,root:tree.rootNode,languageId:'javascript',parserIdentity:identity,signal:controller.signal }),{name:'AbortError'});
} finally { parser.parse = originalParse; }
console.log('native owner leaf products preserve classification, dictionary, budget and fallback boundaries');
