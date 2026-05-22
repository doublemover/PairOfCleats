import assert from 'node:assert/strict';

import { createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';

export function assertRegisteredCommands(registeredCommands, commandIds) {
  for (const commandId of commandIds) {
    assert.ok(registeredCommands.has(commandId), `missing registered command ${commandId}`);
  }
}

export function createResultsExplorerRuntimeHarness(options) {
  const harness = createVsCodeRuntimeHarness(options);
  const openedPaths = [];
  const shownEditors = [];

  harness.fakeVscode.workspace.openTextDocument = async function openTextDocument(uri) {
    openedPaths.push(uri.fsPath);
    const document = { uri };
    harness.openedDocuments.push(document);
    return document;
  };
  harness.fakeVscode.window.showTextDocument = async function showTextDocument(document) {
    const editor = {
      document,
      selection: null,
      revealRange(range) {
        shownEditors.push({ document, range });
      }
    };
    shownEditors.push(editor);
    return editor;
  };

  return {
    ...harness,
    openedPaths,
    shownEditors
  };
}
