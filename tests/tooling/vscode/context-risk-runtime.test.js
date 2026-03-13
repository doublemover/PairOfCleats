#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-context-risk-'));
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");\n');
fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export function greet() { return 1; }\n');

const activeFile = path.join(repoRoot, 'src', 'app.ts');
const activeEditor = {
  document: {
    uri: { scheme: 'file', fsPath: activeFile, path: activeFile.replace(/\\/g, '/') },
    getText(selection) {
      if (selection?.kind === 'selection') return 'chunk:ck-selection';
      if (selection?.kind === 'word') return 'GreeterSymbol';
      return '';
    },
    getWordRangeAtPosition() {
      return { kind: 'word' };
    }
  },
  selection: {
    kind: 'selection',
    active: { line: 0, character: 0 },
    start: { line: 0, character: 0 },
    end: { line: 0, character: 12 }
  },
  selections: [
    {
      kind: 'selection',
      active: { line: 0, character: 0 },
      start: { line: 0, character: 0 },
      end: { line: 0, character: 12 }
    }
  ]
};

const harness = createVsCodeRuntimeHarness({
  repoRoot,
  activeFile,
  activeEditor,
  configValues: {
    cliArgs: ['--trace']
  }
});

try {
  harness.activate();

  for (const commandId of ['pairofcleats.contextPack', 'pairofcleats.riskExplain']) {
    assert.ok(harness.registeredCommands.has(commandId), `missing registered command ${commandId}`);
  }

  harness.quickPickQueue.push((items) => items.find((item) => item.label === 'Active selection'));
  harness.inputQueue.push('chunk:ck-selection');
  harness.inputQueue.push('2');
  harness.quickPickQueue.push({ label: 'Open Markdown + JSON', value: 'both' });
  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      primary: {
        ref: { type: 'chunk', chunkUid: 'ck-selection' },
        file: 'src/app.ts',
        excerpt: 'export function greet() { return 1; }'
      },
      graph: { summary: { counts: { nodes: 3, edges: 2 } } },
      types: { facts: [{ role: 'return', type: 'number' }] },
      risk: { flows: [{ flowId: 'flow-a', confidence: 0.9, path: { nodes: [] } }] },
      indexDir: 'index-code'
    })
  });

  await harness.runCommand('pairofcleats.contextPack');

  const contextSpawn = harness.spawnCalls[0];
  assert.deepEqual(contextSpawn.args, [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'context-pack',
    '--json',
    '--repo',
    repoRoot,
    '--seed',
    'chunk:ck-selection',
    '--hops',
    '2',
    '--includeRisk',
    '--includeTypes'
  ]);

  const contextExportRoot = path.join(repoRoot, '.pairofcleats', 'vscode', 'exports', 'contextPack');
  const contextExports = fs.readdirSync(contextExportRoot);
  assert.ok(contextExports.some((entry) => entry.endsWith('.json')), 'expected context-pack json export');
  assert.ok(contextExports.some((entry) => entry.endsWith('.md')), 'expected context-pack markdown export');
  assert.ok(harness.executeCommandCalls.some((entry) => entry.id === 'markdown.showPreviewToSide'), 'expected markdown preview command');
  assert.ok(harness.openedDocuments.some((entry) => String(entry.uri?.fsPath || '').endsWith('.json')), 'expected json document open');
  assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Context Pack completed.');

  const relativeSeed = harness.extension._test.resolveRepoRelativePathSeed(activeFile, {
    repoRoot
  });
  assert.equal(relativeSeed, 'src/app.ts');

  harness.openedDocuments.length = 0;
  harness.executeCommandCalls.length = 0;
  harness.fakeVscode.workspace.openTextDocument = async () => {
    throw new Error('json preview open failed');
  };
  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      primary: {
        ref: { type: 'file', path: 'src/app.ts' },
        file: 'src/app.ts',
        excerpt: 'export function greet() { return 1; }'
      },
      graph: { summary: { counts: { nodes: 1, edges: 0 } } },
      indexDir: 'index-code'
    })
  });
  const contextPackSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((entry) => entry.id === 'pairofcleats.contextPack');
  await harness.extension._test.executeOperatorWorkflow(
    contextPackSpec,
    { repoRoot, repoLabel: 'repo' },
    {
      command: process.execPath,
      args: [
        path.join(repoRoot, 'bin', 'pairofcleats.js'),
        '--trace',
        'context-pack',
        '--json',
        '--repo',
        repoRoot,
        '--seed',
        'file:src/app.ts',
        '--hops',
        '1',
        '--includeRisk',
        '--includeTypes'
      ],
      inputContext: { seed: 'file:src/app.ts' }
    }
  );

  assert.deepEqual(harness.spawnCalls.at(-1)?.args, [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'context-pack',
    '--json',
    '--repo',
    repoRoot,
    '--seed',
    'file:src/app.ts',
    '--hops',
    '1',
    '--includeRisk',
    '--includeTypes'
  ]);
  assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Context Pack completed.');
  assert.ok(
    harness.outputEvents.some((entry) => entry.kind === 'append' && /failed to present operator payload/i.test(entry.line)),
    'expected fail-open payload presentation warning'
  );

  harness.quickPickQueue.push((items) => items.find((item) => item.label === 'Active file'));
  harness.inputQueue.push('file:src/app.ts');
  harness.inputQueue.push('3');
  harness.quickPickQueue.push({ label: 'Open Markdown', value: 'markdown' });
  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      primary: { ref: { type: 'file', path: 'src/app.ts' }, file: 'src/app.ts' },
      risk: { anchor: { chunkUid: 'ck-risk-anchor' } },
      indexDir: 'index-code'
    })
  });
  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      chunk: {
        chunkUid: 'ck-risk-anchor',
        file: 'src/app.ts',
        name: 'greet',
        kind: 'function'
      },
      filters: { sourceRule: null, sinkRule: null },
      flows: [{ flowId: 'flow-risk', confidence: 0.8, path: { nodes: [] } }]
    })
  });

  await harness.runCommand('pairofcleats.riskExplain');

  assert.deepEqual(harness.spawnCalls.at(-2)?.args, [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'context-pack',
    '--json',
    '--repo',
    repoRoot,
    '--seed',
    'file:src/app.ts',
    '--hops',
    '0',
    '--includeRisk'
  ]);
  assert.deepEqual(harness.spawnCalls.at(-1)?.args, [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'risk',
    'explain',
    '--json',
    '--index',
    path.join(repoRoot, 'index-code'),
    '--chunk',
    'ck-risk-anchor',
    '--max',
    '3'
  ]);

  const riskExportRoot = path.join(repoRoot, '.pairofcleats', 'vscode', 'exports', 'riskExplain');
  const riskExports = fs.readdirSync(riskExportRoot);
  assert.ok(riskExports.some((entry) => entry.endsWith('.json')), 'expected risk-explain json export');
  assert.ok(riskExports.some((entry) => entry.endsWith('.md')), 'expected risk-explain markdown export');
  assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Risk Explain completed.');
  assert.equal(harness.errorMessages.length, 0, `unexpected errors: ${harness.errorMessages.join('; ')}`);
  assert.ok(harness.outputEvents.some((entry) => entry.kind === 'append' && /exported markdown:/i.test(entry.line)));
  assert.ok(harness.outputEvents.some((entry) => entry.kind === 'append' && /exported json:/i.test(entry.line)));

  console.log('vscode context/risk runtime test passed');
} finally {
  harness.restoreGlobals();
}
