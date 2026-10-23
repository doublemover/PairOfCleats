import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';
import { installContainedReadFault, containsOriginalFailure } from '../../helpers/contained-read-fault.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';

// Portable read/error-boundary test only. The executable resolver is inert;
// this never runs or qualifies Linux ELF, a Windows native tool, or a compiler.
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/semantic/native-toolchain.js')) return { format: 'module', shortCircuit: true,
    source: `export * from ${JSON.stringify(url + '?original-authority-test')};
      export const resolveNativeExecutable = async () => 'authored-clangd';` };
  return next(url, context);
} });
const fixture = await createSourceLinkedEvidenceFixture([{ filename: 'input.c', text: 'int value(void) { return 1; }', language: 'c' }]);
const database = path.join(fixture.root, 'compile_commands.json'), scopes = [];
const runtime = { ...fixture.runtime, semanticFrontierDatabase: null,
  semanticPolicy: normalizeSemanticConfig({ enabled: true, languages: ['c'],
    enrichment: { bindings: 'deferred', localFlow: 'off', crossFileFlow: 'off' } }) };
try {
  const { collectNativeTaskInventory } = await import('../../../src/index/semantic/native-task-authority.js');
  const { prepareSemanticBindingWork } = await import('../../../src/index/semantic/build-frontier.js');
  await fs.writeFile(database, '[]');
  for (const frontier of [false, true]) {
    for (const cancel of [false, true]) {
      const controller = new AbortController();
      let codeReads = 0;
      const original = Object.freeze(Object.defineProperty(new Error('original compilation read close'), 'code', {
        get() { codeReads++; throw new Error('diagnostic inspection must not precede settlement'); }
      }));
      const scope = installContainedReadFault({ filename: database,
        failClose: () => { if (cancel) controller.abort(); throw original; } }); scopes.push(scope);
      let failure;
      try {
        if (frontier) await prepareSemanticBindingWork({ state: fixture.state, runtime, signal: controller.signal });
        else await collectNativeTaskInventory({ repoRoot: fixture.root, toolingConfig: { clangd: { compileCommandsDir: fixture.root } },
          sources: [...fixture.sources.values()].map(item => item.source), signal: controller.signal });
      } catch (error) { failure = error; }
      assert.ok(failure); assert.equal(containsOriginalFailure(failure, original), true);
      assert.equal(codeReads, 0, 'original pending work is observed before abort/code diagnostics');
      assert.equal(scope.states.length, 1); const state = scope.states[0], reads = state.reads;
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal(fixture.state.semanticFrontierTargets, undefined); assert.equal(fixture.state.semanticPhaseTasks, undefined);
      const session = getContainedFileSession(failure); assert.ok(session);
      state.allowClose = true; assert.equal((await session.releaseAfterClose()).settled, true);
      assert.equal(state.reads, reads); assert.equal(state.closes, 2); assert.equal(state.handle.fd, -1);
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal(fixture.state.semanticFrontierTargets, undefined, 'close-only recovery cannot enqueue deferred work');
      scope.restore();
    }
  }
  // A settled unsupported compilation shape still has the existing deferred
  // policy, independently of the failed-descriptor cases above.
  await assert.rejects(collectNativeTaskInventory({ repoRoot: fixture.root,
    toolingConfig: { clangd: { compileCommandsDir: fixture.root } }, sources: [...fixture.sources.values()].map(item => item.source) }),
  { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
  const deferred = await prepareSemanticBindingWork({ state: fixture.state, runtime });
  assert.equal(deferred.status, 'pending'); assert.equal(deferred.tasks.length, 1);
  assert.equal(deferred.tasks[0].reason, 'native_dependency_unavailable');
} finally {
  for (const scope of scopes) await scope.cleanup();
  await fixture.cleanup(); hook.deregister();
}
console.log('Native discovery and real frontier preserve original pending descriptor ownership before advisory classification.');
