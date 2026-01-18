#!/usr/bin/env node
import { addInferredParam, addInferredReturn, mergeDiagnostics } from '../../src/index/type-inference-crossfile/apply.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const docmeta = {};
addInferredReturn(docmeta, 'Widget', 'flow', 0.4);
addInferredReturn(docmeta, 'Widget', 'flow', 0.8);
addInferredReturn(docmeta, 'Widget', 'tooling', 0.2);
const returns = docmeta.inferredTypes?.returns || [];
if (returns.length !== 2) {
  fail('addInferredReturn should dedupe entries by type/source.');
}
const flowEntry = returns.find((entry) => entry.source === 'flow');
if (!flowEntry || flowEntry.confidence !== 0.8) {
  fail('addInferredReturn should keep max confidence for repeated entries.');
}

const paramMeta = {};
if (!addInferredParam(paramMeta, 'arg', 'string', 'flow', 0.6)) {
  fail('addInferredParam should accept first param type.');
}
addInferredParam(paramMeta, 'arg', 'string', 'flow', 0.2);
const params = paramMeta.inferredTypes?.params?.arg || [];
if (params.length !== 1) {
  fail('addInferredParam should dedupe entries by type/source.');
}
if (params[0].confidence !== 0.6) {
  fail('addInferredParam should keep max confidence for repeated entries.');
}
if (addInferredParam(paramMeta, 'arg', 'number', 'flow', 0.5, 1)) {
  fail('addInferredParam should respect maxCandidates limit.');
}

const target = new Map([['a', [{ message: 'one' }]]]);
const incoming = new Map([
  ['a', [{ message: 'two' }]],
  ['b', [{ message: 'three' }]]
]);
mergeDiagnostics(target, incoming);
if (target.get('a')?.length !== 2 || target.get('b')?.length !== 1) {
  fail('mergeDiagnostics should append incoming diagnostics.');
}

console.log('type-inference-crossfile apply tests passed');
