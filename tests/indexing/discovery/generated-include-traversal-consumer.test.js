import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { buildGeneratedPolicyConfig, resolveGeneratedPolicyDecision } from '../../../src/index/build/generated-policy.js';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';
import { createWatchPathClassifier } from '../../../src/index/build/watch/classify-path.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { compileGeneratedIncludeTraversal } from '../../../src/index/build/generated-policy-traversal.js';
applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('generated-include-traversal-consumer');
const files = ['node_modules/pkg/keep.js', 'node_modules/pkg/deny.js', 'nested/node_modules/pkg/keep.js',
  'private/deep/keep.js', 'private/deep/deny.js', 'literal/keep.js', 'literal/deny.js', 'UPPER/pkg/keep.js', 'UPPER/pkg/deny.js'];
try {
  for (const file of files) { const abs = path.join(root, file); await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, 'export const selected = 1;'); }
  const include = ['**/node_modules/pkg/keep.js', 'private/*/keep.js', 'literal/keep.js', 'upper/pkg/keep.js'];
  const config = { useDefaultSkips: true, useGitignore: false, usePairofcleatsIgnore: false,
    extraIgnore: ['private/', 'literal/', 'UPPER/'], indexing: { generatedPolicy: { include } } };
  const policy = buildGeneratedPolicyConfig(config.indexing);
  const { ignoreMatcher } = await buildIgnoreMatcher({ root, userConfig: config, generatedPolicy: policy });
  const expected = files.filter(file => file.endsWith('/keep.js')).sort();
  const discover = async (extra = {}) => (await discoverFilesForModes({ root, modes: ['code'], ignoreMatcher,
    generatedPolicy: policy, scmProvider: 'none', skippedByMode: { code: [] }, ...extra })).code;
  assert.deepEqual((await discover()).map(row => row.rel.replaceAll('\\', '/')).sort(), expected);
  for (const file of expected) {
    const decision = resolveGeneratedPolicyDecision({ generatedPolicy: policy, relPath: file });
    assert.equal(decision.policy, 'include'); assert.equal(decision.indexMode, 'full'); assert.ok(include.includes(decision.matchedPattern));
    assert.equal(decision.selectionContract, 'explicit-leaf-and-bounded-ancestor-v1');
    assert.equal(ignoreMatcher.ignores(file), false);
  }
  for (const file of files.filter(file => !expected.includes(file))) assert.equal(ignoreMatcher.ignores(file), true);
  assert.equal(ignoreMatcher.shouldTraverseIgnoredDirectory('node_modules'), true);
  assert.equal(ignoreMatcher.shouldTraverseIgnoredDirectory('private/deep'), true);
  assert.equal(ignoreMatcher.shouldTraverseIgnoredDirectory('literal/other'), true, 'the global globstar can still reach a later node_modules/pkg/keep.js descendant');
  assert.equal(compileGeneratedIncludeTraversal(['literal/keep.js'])('literal/other'), false, 'a fully literal selector does not reopen unrelated descendants');
  assert.equal(compileGeneratedIncludeTraversal(['upper/pkg/keep.js'])('UPPER/pkg'), true,
    'ancestor reachability agrees with the canonical node-ignore case-insensitive leaf matcher');
  const watch = createWatchPathClassifier({ root, canonicalRoot: toRealPathSync(root), ignoreMatcher, generatedPolicy: policy });
  for (const file of files) assert.equal((await watch(path.join(root, file))).skip, !expected.includes(file), file);
  assert.ok((await discover({ maxDepth: 1 })).every(row => row.rel.replaceAll('\\', '/').split('/').length <= 2));
  assert.equal((await discover({ maxFiles: 1 })).length, 1);
  const excludedPolicy = buildGeneratedPolicyConfig({ generatedPolicy: { include, exclude: ['**/keep.js'] } });
  const excluded = await buildIgnoreMatcher({ root, userConfig: config, generatedPolicy: excludedPolicy });
  const deniedWatch = createWatchPathClassifier({ root, canonicalRoot: toRealPathSync(root), ignoreMatcher: excluded.ignoreMatcher,
    generatedPolicy: excludedPolicy });
  for (const file of expected) assert.equal((await deniedWatch(path.join(root, file))).skip, true, 'explicit generated exclusions retain precedence');
  const changed = await buildIgnoreMatcher({ root, userConfig: { ...config, indexing: { generatedPolicy: { include: ['literal/keep.js'] } } } });
  assert.notEqual(changed.ignoreMatcher.policyFingerprint, ignoreMatcher.policyFingerprint, 'selection policy changes invalidate admission reuse');
  for (const source of ['.gitignore', '.pairofcleatsignore', 'custom.ignore', 'extraIgnore']) {
    const rules = ['private/', '!private/deep/keep.js', 'private/deep/keep.js'];
    const cfg = { useDefaultSkips: false, useGitignore: source === '.gitignore', usePairofcleatsIgnore: source === '.pairofcleatsignore',
      ...(source === 'extraIgnore' ? { extraIgnore: rules } : source === 'custom.ignore' ? { ignoreFiles: [source] } : {}) };
    if (source !== 'extraIgnore') await fs.writeFile(path.join(root, source), rules.join('\n'));
    const ordinary = (await buildIgnoreMatcher({ root, userConfig: cfg })).ignoreMatcher;
    assert.equal(ordinary.ignores('private/deep/keep.js'), true, 'later ordinary exclusions remain ordered');
    assert.equal(ordinary.ignores('private/deep/deny.js'), true, 'traversal permission never admits an unselected sibling');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Globbed generated includes reach exact selected leaves through actual discovery/watch while preserving siblings, exclusions and caps.');
