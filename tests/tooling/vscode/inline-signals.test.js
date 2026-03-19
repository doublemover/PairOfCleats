#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createVsCodeRuntimeHarness,
  prepareVsCodeFixtureWorkspace
} from '../../helpers/vscode/runtime-harness.js';

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-inline-signals-'
});
const activeFile = workspace.resolvePath('src', 'app.ts');
const symbol = 'WidgetBuilder';
const document = {
  uri: {
    scheme: 'file',
    fsPath: activeFile,
    path: activeFile.replace(/\\/g, '/'),
    toString() {
      return `file:${this.path}`;
    }
  },
  getWordRangeAtPosition() {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: symbol.length }
    };
  },
  getText() {
    return symbol;
  }
};
const activeEditor = {
  document
};

const harness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  activeFile,
  activeEditor,
  configValues: {
    cliArgs: ['--trace'],
    inlineHoverEnabled: true,
    inlineDiagnosticsEnabled: true,
    inlineDecorationsEnabled: true,
    inlineMaxItems: 2
  }
});

try {
  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      risk: {
        status: 'ok',
        analysisStatus: { code: 'ok' },
        flows: [
          { flowId: 'flow-a', confidence: 0.91 },
          { flowId: 'flow-b', confidence: 0.73 },
          { flowId: 'flow-c', confidence: 0.61 }
        ]
      },
      types: {
        facts: [
          { role: 'return', type: 'number' },
          { role: 'param', type: 'string' },
          { role: 'param', type: 'boolean' }
        ]
      },
      warnings: [
        { code: 'PACK_WARN', message: 'warning emitted' },
        { code: 'PACK_WARN_2', message: 'second warning emitted' }
      ],
      truncation: [
        { cap: 'maxFlows', limit: 2, observed: 3 }
      ]
    })
  });

  harness.activate();
  await flush();

  assert.equal(harness.hoverProviders.length, 1, 'expected hover provider registration');
  assert.equal(harness.diagnosticCollections.length, 1, 'expected inline diagnostic collection');
  const diagnostics = harness.diagnosticCollections[0].entries.get(document.uri.toString());
  assert.equal(Array.isArray(diagnostics), true, 'expected diagnostics for active file');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, harness.fakeVscode.DiagnosticSeverity.Warning);
  assert.match(diagnostics[0].message, /3 risk flows/i);
  assert.equal(harness.decorationTypes.length, 1, 'expected inline decoration type');
  assert.equal(harness.decorationApplications.length > 0, true, 'expected decoration application');
  assert.match(harness.decorationTypes[0].options.after.contentText, /PairOfCleats: 3 risk flows/i);

  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      risk: {
        status: 'ok',
        analysisStatus: { code: 'ok' },
        flows: [
          { flowId: 'flow-a', confidence: 0.91 },
          { flowId: 'flow-b', confidence: 0.73 },
          { flowId: 'flow-c', confidence: 0.61 }
        ]
      },
      types: {
        facts: [
          { role: 'return', type: 'number' },
          { role: 'param', type: 'string' },
          { role: 'param', type: 'boolean' }
        ]
      },
      warnings: [
        { code: 'PACK_WARN', message: 'warning emitted' }
      ],
      truncation: [
        { cap: 'maxFlows', limit: 2, observed: 3 }
      ]
    })
  });

  const hover = await harness.hoverProviders[0].provider.provideHover(
    document,
    new harness.fakeVscode.Position(0, 4),
    {}
  );
  assert.ok(hover, 'expected bounded inline hover');
  assert.match(hover.contents.value, /seed: `symbol:WidgetBuilder`/i);
  assert.match(hover.contents.value, /\*\*Risk flows\*\*/);
  assert.match(hover.contents.value, /flow-a/);
  assert.match(hover.contents.value, /flow-b/);
  assert.doesNotMatch(hover.contents.value, /flow-c/, 'expected hover maxItems bound to omit extra risk flows');
  assert.match(hover.contents.value, /\*\*Type facts\*\*/);
  assert.match(hover.contents.value, /return: `number`/);
  assert.match(hover.contents.value, /param: `string`/);
  assert.doesNotMatch(hover.contents.value, /boolean/, 'expected hover maxItems bound to omit extra type facts');

  const hoverArgs = harness.spawnCalls.at(-1)?.args || [];
  assert.deepEqual(hoverArgs, [
    workspace.resolvePath('bin', 'pairofcleats.js'),
    '--trace',
    'context-pack',
    '--json',
    '--repo',
    workspace.root,
    '--seed',
    'symbol:WidgetBuilder',
    '--hops',
    '0',
    '--includeRisk',
    '--includeTypes'
  ]);

  const disabledHarness = createVsCodeRuntimeHarness({
    repoRoot: workspace.root,
    workspaceFolders: [{ name: 'repo', path: workspace.root }],
    activeFile,
    activeEditor,
    configValues: {
      inlineHoverEnabled: false,
      inlineDiagnosticsEnabled: false,
      inlineDecorationsEnabled: false
    }
  });
  try {
    disabledHarness.activate();
    await flush();
    const disabledHover = await disabledHarness.extension._test.provideInlineHoverAtPosition(
      document,
      new disabledHarness.fakeVscode.Position(0, 4)
    );
    assert.equal(disabledHover, null, 'expected disabled inline hover to fail quiet');
    assert.equal(disabledHarness.spawnCalls.length, 0, 'disabled inline settings must not spawn CLI work');
  } finally {
    disabledHarness.restoreGlobals();
  }

  console.log('vscode inline signals test passed');
} finally {
  harness.restoreGlobals();
}
