import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

for (const scenario of ['unchanged', 'replaced-manifest', 'wrong-resolved-chunk', 'wrong-risk-chunk', 'legacy-replay', 'replaced-before-replay']) {
  const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-risk-consumer-' });
  const installation = createVsCodeRuntimeTempRepo({ prefix: 'poc-risk-installation-' });
  const selected = path.join(installation, 'custom-cache', 'builds', 'code-only-generation', 'index-code');
  const manifest = path.join(selected, 'pieces', 'manifest.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true }); fs.writeFileSync(manifest, '{}');
  const stale = path.join(root, 'index-code', 'pieces'); fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'manifest.json'), '{"legacy":true}');
  const cliPath = path.join(installation, 'bin', 'pairofcleats.js');
  const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
    globalConfigValues: { cliPath, cliArgs: ['--trace'] } });
  const source = { primary: { ref: { type: 'chunk', chunkUid: scenario === 'wrong-resolved-chunk' ? 'ck-other' : 'ck-original' } },
    provenance: { repo: root, indexDir: selected, indexSignature: 'opaque-canonical-code-signature' } };
  const risk = { chunk: { chunkUid: scenario === 'wrong-risk-chunk' ? 'ck-other' : 'ck-original', file: 'src/app.ts' }, flows: [] };
  try {
    harness.activate(); harness.inputQueue.push('chunk:ck-original', '3');
    harness.quickPickQueue.push(items => items.find(item => item.value === 'output'));
    harness.queuedResults.push({ code: 0, stdout: JSON.stringify(source) });
    if (scenario !== 'wrong-resolved-chunk') harness.queuedResults.push(scenario === 'replaced-manifest'
      ? { persistent: true } : { code: 0, stdout: JSON.stringify(risk) });
    const running = harness.runCommand('pairofcleats.riskExplain');
    if (scenario === 'replaced-manifest') {
      for (let index = 0; index < 20 && harness.spawnCalls.length < 2; index++) await new Promise(setImmediate);
      assert.equal(harness.spawnCalls.length, 2); fs.writeFileSync(manifest, '{"replacement":true}');
      const child = harness.spawnCalls[1].child; child.stdout.emit('data', Buffer.from(JSON.stringify(risk))); child.emit('close', 0);
    }
    await running;
    assert.equal(harness.spawnCalls[0].args[0], cliPath, 'risk selection uses the configured installation rather than consumer scripts');
    if (scenario === 'wrong-resolved-chunk') {
      assert.equal(harness.spawnCalls.length, 1); assert.match(harness.errorMessages.at(-1), /different chunk/); continue;
    }
    const args = harness.spawnCalls[1].args;
    assert.equal(args[args.indexOf('--index') + 1], selected);
    assert(!args.includes(path.join(root, 'index-code')));
    const saved = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
    if (scenario === 'replaced-manifest' || scenario === 'wrong-risk-chunk') {
      assert.equal(saved.status, 'failed'); assert.equal(fs.existsSync(path.join(root, '.pairofcleats', 'vscode', 'exports')), false);
      assert.match(harness.errorMessages.at(-1), /manifest changed|selected chunk/);
      assert(!harness.infoMessages.some(message => /Risk Explain completed/.test(message)));
    } else {
      assert.equal(saved.status, 'succeeded');
      const qualification = saved.invocation.request.inputContext.sourceQualification;
      assert.match(qualification.manifestHash, /^[a-f0-9]{64}$/);
      assert.equal(qualification.indexSignature, 'opaque-canonical-code-signature', 'canonical signatures remain opaque producer evidence');
      if (scenario === 'legacy-replay' || scenario === 'replaced-before-replay') {
        if (scenario === 'legacy-replay') delete qualification.manifestHash;
        else fs.writeFileSync(manifest, '{"replacement":true}');
        await harness.runCommand('pairofcleats.rerunLastWorkflow');
        assert.equal(harness.spawnCalls.length, 2, 'legacy/replaced generation requires deliberate current-generation selection');
        assert.match(harness.errorMessages.at(-1), /historical workflow|manifest changed|semantic inputs/);
      }
    }
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals();
    for (const directory of [root, installation]) fs.rmSync(directory, { recursive: true, force: true });
  }
}
console.log('Registered risk selected manifest/chunk/replay lifetime controls authored; canonical publisher and host qualification deferred.');
