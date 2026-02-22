#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/plan.js';
import {
  getNativeTreeSitterParser,
  preflightNativeTreeSitterGrammars,
  resolveNativeTreeSitterTarget
} from '../../../src/lang/tree-sitter/native-runtime.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { skipIfNativeGrammarsUnavailable } from './native-availability.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'tree-sitter-scheduler-native-plan-contract', 'index-code');
const jsAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');

await fs.access(jsAbs);
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const target = resolveNativeTreeSitterTarget('javascript', '.js');
assert.ok(target, 'expected native target for javascript');
assert.equal(target.grammarKey, 'native:javascript');
assert.equal(target.runtimeKind, 'native');
assert.equal(target.languageId, 'javascript');

const jsxTarget = resolveNativeTreeSitterTarget('jsx', '.jsx');
assert.ok(jsxTarget, 'expected native target for jsx');
assert.equal(jsxTarget.grammarKey, 'native:javascript');
assert.equal(jsxTarget.runtimeKind, 'native');
assert.equal(jsxTarget.languageId, 'jsx');

const luaTarget = resolveNativeTreeSitterTarget('lua', '.lua');
assert.ok(luaTarget, 'expected native target for lua');
assert.equal(luaTarget.grammarKey, 'native:lua');
assert.equal(luaTarget.runtimeKind, 'native');
assert.equal(luaTarget.languageId, 'lua');

const missingTarget = resolveNativeTreeSitterTarget('this-language-does-not-exist', '.xyz');
assert.equal(missingTarget, null, 'expected null target for unsupported language');

const preflightFail = preflightNativeTreeSitterGrammars(['javascript', 'this-language-does-not-exist']);
assert.equal(preflightFail.ok, false, 'expected preflight failure');
assert.ok(
  Array.isArray(preflightFail.missing) && preflightFail.missing.includes('this-language-does-not-exist'),
  'expected missing language reported in preflight result'
);
if (skipIfNativeGrammarsUnavailable(['javascript', 'lua'], 'tree-sitter scheduler native plan contract')) {
  process.exit(0);
}

const luaPreflight = preflightNativeTreeSitterGrammars(['lua']);
const luaParser = getNativeTreeSitterParser('lua', {
  treeSitter: { enabled: true, nativeOnly: true, strict: true },
  log: () => {}
});
assert.ok(luaParser, 'expected lua parser to activate in native runtime');
assert.ok(
  !luaPreflight.unavailable.includes('lua'),
  'expected lua preflight to stay available when parser activation succeeds'
);

const runtime = {
  root,
  segmentsConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: true
    }
  }
};

const planResult = await buildTreeSitterSchedulerPlan({
  mode: 'code',
  runtime,
  entries: [jsAbs],
  outDir,
  fileTextCache: null,
  abortSignal: null,
  log: () => {}
});

assert.ok(planResult, 'expected scheduler plan result');
assert.ok(planResult.plan, 'expected scheduler plan');
assert.ok(
  Array.isArray(planResult.plan.grammarKeys) && planResult.plan.grammarKeys.includes('native:javascript'),
  'expected native grammar key in plan'
);
assert.ok(
  Array.isArray(planResult.plan.requiredNativeLanguages)
    && planResult.plan.requiredNativeLanguages.includes('javascript'),
  'expected required native language in plan'
);
for (const group of planResult.groups || []) {
  for (const job of group.jobs || []) {
    const signature = job?.fileVersionSignature;
    assert.ok(signature && typeof signature === 'object', 'expected file version signature on scheduler jobs');
    assert.equal(typeof signature.hash, 'string', 'expected file signature hash');
    assert.equal(Number.isFinite(signature.size), true, 'expected file signature size');
    assert.equal(Number.isFinite(signature.mtimeMs), true, 'expected file signature mtimeMs');
  }
}

console.log('tree-sitter scheduler native plan contract ok');

