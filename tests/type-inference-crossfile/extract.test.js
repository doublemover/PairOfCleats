#!/usr/bin/env node
import { extractParamTypes, extractReturnCalls, extractReturnTypes, inferArgType } from '../../src/index/type-inference-crossfile/extract.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const chunk = {
  name: 'Widget',
  kind: 'class',
  docmeta: {
    returnType: 'Widget',
    returns: ['Widget', 'Gadget'],
    inferredTypes: {
      returns: [{ type: 'Thing' }, { type: 'Widget', source: 'flow' }],
      params: {
        b: [{ type: 'number' }, { type: 'number' }],
        a: [{ type: 'boolean' }]
      }
    },
    params: ['a', 'b'],
    paramTypes: { a: 'string' }
  }
};

const returnTypes = extractReturnTypes(chunk);
const returnSet = new Set(returnTypes);
if (!returnSet.has('Widget') || !returnSet.has('Gadget') || !returnSet.has('Thing')) {
  fail('extractReturnTypes should collect explicit and inferred return types.');
}
if (returnTypes.length !== returnSet.size) {
  fail('extractReturnTypes should dedupe return types.');
}

const { paramNames, paramTypes } = extractParamTypes(chunk);
if (paramNames.join(',') !== 'a,b') {
  fail('extractParamTypes should preserve param name order.');
}
const paramA = new Set(paramTypes.a || []);
const paramB = new Set(paramTypes.b || []);
if (!paramA.has('string') || !paramA.has('boolean')) {
  fail('extractParamTypes should merge declared and inferred param types.');
}
if (!paramB.has('number') || paramB.size !== 1) {
  fail('extractParamTypes should dedupe inferred param types.');
}

const callText = [
  'return createWidget();',
  'return await ns.Factory.build();',
  'return new Widget();'
].join('\n');
const { calls, news } = extractReturnCalls(callText);
if (!calls.has('createWidget') || !calls.has('ns.Factory.build')) {
  fail('extractReturnCalls should collect return call targets.');
}
if (!news.has('Widget') || news.size !== 1) {
  fail('extractReturnCalls should collect return new targets.');
}

const argChecks = [
  ['123', 'number'],
  ['true', 'boolean'],
  ['"hello"', 'string'],
  ['[1, 2]', 'array'],
  ['{ a: 1 }', 'object'],
  ['new Gadget()', 'Gadget'],
  ['fn(...)', 'function']
];
for (const [value, expected] of argChecks) {
  if (inferArgType(value) !== expected) {
    fail(`inferArgType should infer ${expected} from ${value}.`);
  }
}

console.log('type-inference-crossfile extract tests passed');
