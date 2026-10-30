import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { admitCompilationDatabase, revalidateCompilationDatabase } from '../../../src/index/tooling/compile-commands.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { resolveLspFixtureCommand } from '../../helpers/lsp-fixture-command.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('compilation-database-admission/')[1];
assert.ok(['missing', 'wrong-kind', 'malformed', 'empty', 'unrelated', 'mixed', 'partial', 'ambiguous',
  'required', 'response', 'response-changed', 'database-changed', 'launch-changed', 'explicit-invalid',
  'over-budget', 'command-text', 'nested-response', 'argument-selection', 'argument-conflict', 'source-escape',
  'unreadable', 'empty-selection', 'duplicate-identical', 'source-replaced', 'response-missing'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`compilation-admission-${selected}`);
const repoRoot = path.join(dir, 'repo'); await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null
} });
const documents = ['src/main.cc', 'include/main.h', 'third_party/vendor.h'].map((virtualPath, id) => ({
  virtualPath, containerPath: virtualPath, languageId: 'cpp', effectiveExt: path.extname(virtualPath),
  text: 'int alpha(void) { return 1; }\n', docHash: `requested-source-${id}`
}));
for (const doc of documents) {
  const filename = path.join(repoRoot, doc.virtualPath);
  await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, doc.text);
}
const targets = documents.map((doc, id) => ({ virtualPath: doc.virtualPath, languageId: 'cpp',
  chunkRef: { chunkUid: `ck:compile-context:${id}`, chunkId: `chunk_${id}`, file: doc.virtualPath,
    start: 0, end: doc.text.length }, virtualRange: { start: 0, end: doc.text.length }, symbolHint: { name: 'alpha', kind: 'function' } }));
const file = path.join(repoRoot, 'compile_commands.json'), response = path.join(repoRoot, 'flags.rsp');
const row = (source = 'include/main.h', extra = []) => ({ directory: repoRoot, file: source, arguments: ['clang++', ...extra, '-c', source] });
const save = async value => fs.writeFile(file, JSON.stringify(value));
const config = { cmd: resolveLspFixtureCommand('clangd'), args: ['--background-index=false', '--log=error'],
  maxDocsWithoutCompileCommands: 1, autoInferIncludeRoots: false };
if (selected === 'wrong-kind') await fs.mkdir(file);
else if (selected === 'malformed') await fs.writeFile(file, '{broken');
else if (selected === 'empty' || selected === 'required') await save([]);
else if (selected === 'unrelated') await save([row('other.cc')]);
else if (selected === 'partial') await save([row(), {}]);
else if (selected === 'ambiguous') await save([row('src/main.cc', ['-DMODE=1']), row('src/main.cc', ['-DMODE=2'])]);
else if (['response', 'response-changed', 'nested-response'].includes(selected)) {
  await fs.writeFile(response, selected === 'nested-response' ? '"@nested.rsp"' : '-DMODE=1');
  await save([row('include/main.h', ['@flags.rsp'])]);
} else if (selected === 'response-missing') await save([row('include/main.h', ['@missing.rsp'])]);
else if (selected === 'duplicate-identical') await save([row(), row()]);
else if (selected === 'command-text') await save([{ directory: repoRoot, file: 'include/main.h', command: 'clang++ -c include/main.h' }]);
else if (selected === 'explicit-invalid') {
  await save([row()]);
  config.compileCommandsDir = 'explicit'; await fs.mkdir(path.join(repoRoot, 'explicit'));
  await fs.writeFile(path.join(repoRoot, 'explicit', 'compile_commands.json'), '{broken');
} else if (selected === 'over-budget') await fs.writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1, 32));
else if (selected === 'argument-selection') {
  await save([]); const alternate = path.join(repoRoot, 'build'); await fs.mkdir(alternate);
  await fs.writeFile(path.join(alternate, 'compile_commands.json'), JSON.stringify([row()]));
  config.args.push(`--compile-commands-dir=${alternate}`);
} else if (selected === 'argument-conflict') {
  await save([row()]); config.compileCommandsDir = repoRoot;
  config.args.push(`--compile-commands-dir=${path.join(repoRoot, 'other')}`);
} else if (selected === 'empty-selection') {
  await save([row()]); config.compileCommandsDir = '';
} else if (selected === 'source-escape') {
  await fs.writeFile(path.join(dir, 'outside.cc'), documents[0].text);
  documents[0].virtualPath = '../outside.cc'; documents[0].containerPath = '../outside.cc';
  await save([row('../outside.cc')]);
} else if (selected !== 'missing') await save([row()]);
if (selected === 'required') config.requireCompilationDatabase = true;
const originalStat = fsSync.lstatSync;
if (selected === 'unreadable') fsSync.lstatSync = (filename, ...args) => {
  if (filename === file) throw Object.assign(new Error('controlled unreadable compilation database'), { code: 'EACCES' });
  return originalStat(filename, ...args);
};
try {
  const admission = await admitCompilationDatabase({ rootDir: repoRoot, config, documents });
  assert.equal(Object.values(admission.counts).reduce((sum, count) => sum + count, 0), documents.length);
  const expectedStatus = { missing: 'missing', 'wrong-kind': 'wrong-kind', malformed: 'malformed', empty: 'empty',
    required: 'empty', partial: 'partially-valid', 'explicit-invalid': 'malformed', 'over-budget': 'over-budget',
    'argument-conflict': 'conflicting-selection', unreadable: 'unreadable', 'empty-selection': 'invalid-selection' }[selected] || 'usable';
  assert.equal(admission.status, expectedStatus);
  if (selected === 'source-escape') {
    assert.equal(admission.counts.exact, 0); assert.equal(admission.documents[0].status, 'unknown');
  } else {
    const exact = ['mixed', 'partial', 'response', 'response-changed', 'database-changed', 'launch-changed', 'command-text', 'argument-selection', 'duplicate-identical', 'source-replaced'].includes(selected);
    assert.equal(admission.counts.exact, exact ? 1 : 0);
    if (selected === 'ambiguous') assert.equal(admission.counts.ambiguous, 1);
    const calls = [];
    globalThis.__compileContextCollect = async options => {
      calls.push(options);
      return { byChunkUid: Object.fromEntries(options.targets.map(target => [target.chunkRef.chunkUid, { returnType: 'int' }])), checks: [] };
    };
    globalThis.__compileContextAfterPreflight = async () => {
      if (selected === 'response-changed') await fs.writeFile(response, '-DMODE=2');
      if (selected === 'database-changed') await save([row('src/main.cc')]);
      if (selected === 'launch-changed') config.args.push('--offset-encoding=utf-16');
      if (selected === 'source-replaced') {
        const filename = path.join(repoRoot, 'include/main.h');
        await fs.rename(filename, `${filename}.old`); await fs.writeFile(filename, documents[1].text);
      }
    };
    const manager = new URL('../../../src/index/tooling/preflight-manager.js', import.meta.url).href;
    const hooks = registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL?.endsWith('/tooling/clangd-provider.js')) {
        if (specifier.endsWith('/providers/lsp.js')) return { url: 'compile-context:collector', shortCircuit: true };
        if (specifier === './preflight-manager.js') return { url: 'compile-context:preflight', shortCircuit: true };
      }
      return next(specifier, context);
    }, load(url, context, next) {
      if (url === 'compile-context:collector') return { format: 'module', shortCircuit: true,
        source: 'export const collectLspTypes = options => globalThis.__compileContextCollect(options);' };
      if (url === 'compile-context:preflight') return { format: 'module', shortCircuit: true,
        source: `import {awaitToolingProviderPreflight as run} from ${JSON.stringify(manager)};
        export const awaitToolingProviderPreflight=async(...args)=>{const result=await run(...args);await globalThis.__compileContextAfterPreflight();return result;};` };
      return next(url, context);
    } });
    const restore = grantFixtureRepositoryExecution(repoRoot);
    try {
      const { createClangdProvider } = await import('../../../src/index/tooling/clangd-provider.js');
      const output = await createClangdProvider().run({ repoRoot, buildRoot: repoRoot, toolingConfig: { clangd: config }, logger() {}, strict: true }, { documents, targets });
      const checks = output.diagnostics.checks;
      assert.ok(checks.some(check => check.name === 'clangd_compilation_context'));
      const blocked = ['required', 'argument-conflict', 'response-changed', 'database-changed', 'launch-changed',
        'source-replaced', 'empty-selection', 'wrong-kind', 'unreadable', 'malformed', 'explicit-invalid', 'over-budget'].includes(selected);
      assert.equal(calls.length, blocked ? 0 : 1,
        `actual provider dispatch must follow its captured database/launch receipt: ${JSON.stringify(checks)}`);
      if (blocked) {
        if (selected.endsWith('-changed') || selected === 'source-replaced') assert.ok(checks.some(check => check.name === 'clangd_compilation_context_changed'));
        assert.deepEqual(output.byChunkUid, {});
      } else {
        const dispatched = calls[0], paths = dispatched.documents.map(doc => doc.virtualPath);
        assert.deepEqual(paths, exact ? ['include/main.h', 'src/main.cc'] : ['src/main.cc']);
        assert.deepEqual(dispatched.targets.map(target => target.virtualPath).sort(), [...paths].sort());
        assert.equal(dispatched.documentRequestPolicies['src/main.cc'].hoverEnabled, false);
        assert.equal(dispatched.documentRequestPolicies['src/main.cc'].hoverMaxPerFile, 8);
        assert.equal(output.byChunkUid[targets[0].chunkRef.chunkUid].returnType, 'int');
        if (exact) {
          assert.equal(dispatched.documentRequestPolicies['include/main.h'].hoverEnabled, true);
          assert.equal(dispatched.documentUris['include/main.h'], pathToFileURL(path.join(repoRoot, 'include/main.h')).href);
          assert.equal(output.byChunkUid[targets[1].chunkRef.chunkUid].returnType, 'int');
          assert.ok(dispatched.args.some(argument => argument.includes('compile-commands-dir')));
        }
        assert.equal(Object.hasOwn(dispatched.documentUris, 'src/main.cc'), false, 'weak context must not borrow exact physical URI authority');
      }
    } finally { restore(); hooks.deregister(); delete globalThis.__compileContextCollect; delete globalThis.__compileContextAfterPreflight; }
    if (selected.endsWith('-changed')) assert.equal(await revalidateCompilationDatabase(admission, { rootDir: repoRoot, config, documents }), false);
  }
} finally { fsSync.lstatSync = originalStat; }
console.log(`Compilation database ${selected}: bounded read-only admission and actual provider planning; no compiler build or native clangd qualification.`);
