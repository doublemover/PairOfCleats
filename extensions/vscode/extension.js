const vscode = require('vscode');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return null;
  return folders[0].uri.fsPath;
}

function resolveCli(repoRoot) {
  const config = vscode.workspace.getConfiguration('pairofcleats');
  const configuredPath = String(config.get('cliPath') || '').trim();
  const configuredArgs = config.get('cliArgs') || [];
  const extraArgs = Array.isArray(configuredArgs) ? configuredArgs.map(String) : [];

  if (configuredPath) {
    const resolvedPath = path.isAbsolute(configuredPath) && fs.existsSync(configuredPath)
      ? configuredPath
      : (repoRoot ? path.join(repoRoot, configuredPath) : configuredPath);
    if (resolvedPath.endsWith('.js')) {
      return { command: process.execPath, argsPrefix: [resolvedPath, ...extraArgs] };
    }
    return { command: resolvedPath, argsPrefix: extraArgs };
  }

  if (repoRoot) {
    const localCli = path.join(repoRoot, 'bin', 'pairofcleats.js');
    if (fs.existsSync(localCli)) {
      return { command: process.execPath, argsPrefix: [localCli] };
    }
  }

  return { command: 'pairofcleats', argsPrefix: extraArgs };
}

function buildArgs(query, repoRoot) {
  const config = vscode.workspace.getConfiguration('pairofcleats');
  const mode = String(config.get('searchMode') || 'both');
  const backend = String(config.get('searchBackend') || '').trim();
  const annEnabled = config.get('searchAnn') !== false;
  const maxResults = Number.isFinite(Number(config.get('maxResults')))
    ? Math.max(1, Number(config.get('maxResults')))
    : 25;
  const extraArgs = config.get('extraSearchArgs') || [];
  const extra = Array.isArray(extraArgs) ? extraArgs.map(String) : [];

  const args = ['search', query, '--json', '--top', String(maxResults)];
  if (mode && mode !== 'both') args.push('--mode', mode);
  if (backend) args.push('--backend', backend);
  if (!annEnabled) args.push('--no-ann');
  if (repoRoot) args.push('--repo', repoRoot);
  args.push(...extra);
  return args;
}

async function runSearch() {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    vscode.window.showErrorMessage('PairOfCleats: open a workspace to search.');
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: 'PairOfCleats search query',
    placeHolder: 'e.g. auth token validation'
  });
  if (!query || !query.trim()) return;

  const { command, argsPrefix } = resolveCli(repoRoot);
  const args = [...argsPrefix, ...buildArgs(query.trim(), repoRoot)];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'PairOfCleats search',
      cancellable: false
    },
    () => new Promise((resolve) => {
      cp.execFile(command, args, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 }, async (error, stdout, stderr) => {
        if (error) {
          const message = stderr || error.message;
          vscode.window.showErrorMessage(`PairOfCleats search failed: ${message}`);
          resolve();
          return;
        }

        let payload = null;
        try {
          payload = JSON.parse(stdout || '{}');
        } catch (err) {
          vscode.window.showErrorMessage(`PairOfCleats search returned invalid JSON: ${err.message}`);
          resolve();
          return;
        }

        const hits = [];
        const pushHits = (items, kind) => {
          if (!Array.isArray(items)) return;
          items.forEach((hit) => {
            if (!hit || !hit.file) return;
            hits.push({
              ...hit,
              section: kind
            });
          });
        };
        pushHits(payload.code, 'code');
        pushHits(payload.prose, 'prose');
        pushHits(payload.records, 'records');

        if (!hits.length) {
          vscode.window.showInformationMessage('PairOfCleats: no results.');
          resolve();
          return;
        }

        const items = hits.map((hit) => {
          const line = Number.isFinite(hit.startLine) ? `:${hit.startLine}` : '';
          const fileLabel = `${hit.file}${line}`;
          const scoreLabel = Number.isFinite(hit.score)
            ? `${hit.score.toFixed(2)} ${hit.scoreType || ''}`.trim()
            : 'n/a';
          const label = hit.name || hit.headline || fileLabel;
          return {
            label,
            description: fileLabel,
            detail: `${hit.section} • score ${scoreLabel}`,
            hit
          };
        });

        const selection = await vscode.window.showQuickPick(items, {
          title: `PairOfCleats results (${hits.length})`,
          matchOnDescription: true,
          matchOnDetail: true
        });
        if (!selection) {
          resolve();
          return;
        }

        const selected = selection.hit;
        const filePath = path.isAbsolute(selected.file)
          ? selected.file
          : path.join(repoRoot, selected.file);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const editor = await vscode.window.showTextDocument(document, { preview: true });
        if (Number.isFinite(selected.startLine) && selected.startLine > 0) {
          const line = Math.max(0, Number(selected.startLine) - 1);
          const pos = new vscode.Position(line, 0);
          const range = new vscode.Range(pos, pos);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }

        resolve();
      });
    })
  );
}

function activate(context) {
  const command = vscode.commands.registerCommand('pairofcleats.search', runSearch);
  context.subscriptions.push(command);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
