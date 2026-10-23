const fs = require('node:fs');
const path = require('node:path');
const { createDocumentAuthority } = require('./document-authority.js');

/** Publish ranges only in the original requesting document. The enclosing and
 * optional identifier ranges share the exact byte/BOM/newline authority used by
 * native definitions/references, with a one-document bound. */
async function qualifyDocumentSymbols({ vscode, repoContext, rows, sourceRequest, isCurrent, symbolKind }) {
  if (!rows.length || !isCurrent() || !sourceRequest.isCurrent()) return [];
  const document = sourceRequest.document;
  const authority = createDocumentAuthority({ workspace: vscode.workspace, requestedDocument: document,
    isCurrent: () => isCurrent() && sourceRequest.isCurrent(), maxDocuments: 1 });
  const sourceArgs = sourceRequest.args(repoContext.repoRoot);
  const hash = sourceArgs[sourceArgs.indexOf('--source-hash') + 1];
  const file = fs.realpathSync(sourceRequest.file), symbols = [];
  for (const entry of rows) {
    if (entry.sourceHash !== hash || entry.coordinateUnit !== 'utf16'
      || !entry.file || fs.realpathSync(path.resolve(repoContext.repoRoot, entry.file)) !== file) {
      throw new Error('Document symbol does not identify the original requested source.');
    }
    const qualify = range => authority.qualify({ repoRoot: repoContext.repoRoot, file,
      uri: document.uri, sourceHash: hash, range });
    const enclosing = await qualify(entry);
    if (!enclosing || !isCurrent() || !sourceRequest.isCurrent()) return [];
    const selected = entry.selectionRange == null ? enclosing : await qualify(entry.selectionRange);
    if (!selected || !isCurrent() || !sourceRequest.isCurrent()) return [];
    if (selected.offsets.start < enclosing.offsets.start || selected.offsets.end > enclosing.offsets.end) {
      throw new Error('Document symbol selection is outside its enclosing source range.');
    }
    if (enclosing.offsets.end <= enclosing.offsets.start || selected.offsets.end <= selected.offsets.start) {
      throw new Error('Document symbol has no located source span.');
    }
    const range = value => new vscode.Range(document.positionAt(value.start), document.positionAt(value.end));
    symbols.push(new vscode.DocumentSymbol(String(entry.name || entry.qualifiedName || 'symbol'),
      String(entry.qualifiedName || entry.kind || ''), symbolKind(entry.kind), range(enclosing.offsets), range(selected.offsets)));
  }
  await authority.assertCurrent();
  sourceRequest.args(repoContext.repoRoot);
  return isCurrent() && sourceRequest.isCurrent() ? symbols : [];
}

module.exports = { qualifyDocumentSymbols };
