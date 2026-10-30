const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

// Runs inside the actual editor host. Only inspect the already activated,
// installed module; never load a checkout copy or replace any VS Code API.
exports.run = async () => {
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  const directory = path.dirname(vscode.workspace.workspaceFolders[0].uri.fsPath);
  const input = JSON.parse(await fs.readFile(path.join(directory, 'probe-input.json'), 'utf8'));
  try {
    assert.equal(vscode.workspace.isTrusted, true, 'this explicit positive fixture selects a trusted test workspace');
    if (input.mode === 'absent') {
      assert.equal(vscode.extensions.getExtension(input.extensionId), undefined, 'a fresh host must not discover the uninstalled extension');
      const commands = await vscode.commands.getCommands(true);
      assert.ok(input.commands.every(command => !commands.includes(command)), 'uninstall must remove all registered commands');
      await fs.writeFile(path.join(directory, 'probe-absent-result.json'), JSON.stringify({ vscode: vscode.version,
        extensionAbsent: true, registeredTargetCommands: 0, verifiedCommands: input.commands.length }, null, 2));
      return;
    }
    const extension = vscode.extensions.getExtension(input.extensionId);
    assert.ok(extension, 'VSIX installation must be discovered by the actual extension registry');
    const installedRelative = path.relative(path.resolve(input.extensionsDirectory), path.resolve(extension.extensionPath));
    assert.ok(installedRelative && !path.isAbsolute(installedRelative) && installedRelative.split(path.sep)[0] !== '..');
    await extension.activate();
    assert.equal(extension.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    for (const entry of extension.packageJSON.contributes.commands) assert.ok(commands.includes(entry.command), entry.command);
    const main = path.resolve(extension.extensionPath, extension.packageJSON.main);
    const loaded = process.platform === 'win32'
      ? Object.values(require.cache).find(module => typeof module.filename === 'string'
        && path.resolve(module.filename).toLowerCase() === main.toLowerCase())
      : require.cache[main];
    assert.ok(loaded, 'the actual host must load the installed entry point');
    const observe = loaded.exports._test.buildResultsTree;
    const document = await vscode.workspace.openTextDocument(path.join(input.repo, 'needle.js'));
    const editor = await vscode.window.showTextDocument(document);
    const start = document.getText().indexOf(input.query);
    assert.ok(start >= 0);
    editor.selection = new vscode.Selection(document.positionAt(start), document.positionAt(start + input.query.length));
    const search = vscode.commands.executeCommand('pairofcleats.searchSelection');
    let finished = false, failed = false, failure;
    search.then(() => { finished = true; }, error => { failed = true; failure = error; });
    const until = Date.now() + 6000;
    const hits = () => observe().flatMap(group => group.children || []).filter(node => node.kind === 'hit');
    while (!hits().some(node => node.hit.file === 'needle.js')) {
      if (failed) throw failure;
      assert.equal(finished, false, 'public search cannot finish without its expected source');
      assert.ok(Date.now() < until, 'public search must return the indexed source within six seconds');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    // The real command owns a results picker after recording its original hit
    // set. Close that picker through the workbench, then join command completion.
    // Result persistence precedes the asynchronous picker registration. Close
    // only that UI while joining this same command; never repeat the search.
    while (!finished) {
      if (failed) throw failure;
      assert.ok(Date.now() < until, 'the original search command must settle after its picker closes');
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await search;
    const original = hits().find(node => node.hit.file === 'needle.js');
    assert.equal(original.resultSet.query, input.query);
    assert.equal(original.resultSet.invocation.kind, 'cli-search');
    assert.equal(path.resolve(original.resultSet.invocation.command), path.resolve(input.node));
    assert.ok(original.resultSet.invocation.args.includes(input.cli), 'actual search must use the separately installed CLI');
    const result = { vscode: vscode.version, hostNode: process.version, extensionId: extension.id,
      extensionPath: extension.extensionPath, version: extension.packageJSON.version,
      registeredCommands: extension.packageJSON.contributes.commands.map(entry => entry.command),
      query: original.resultSet.query, invocation: original.resultSet.invocation,
      hits: hits().map(node => ({ file: node.hit.file, startLine: node.hit.startLine, name: node.hit.name })) };
    await fs.writeFile(path.join(directory, 'probe-result.json'), JSON.stringify(result, null, 2));
  } catch (error) {
    await fs.writeFile(path.join(directory, 'probe-failure.json'), JSON.stringify({ message: error?.message, stack: error?.stack }, null, 2));
    throw error;
  }
};
