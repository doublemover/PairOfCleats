const { readVerifiedSource, createDocumentAuthority, assertQualifiedEditor } = require('./document-authority.js');
const MAX_SOURCE_ROWS_BYTES = 256 * 1024;

function captureRows(rows) {
  const encoded = JSON.stringify(rows);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_SOURCE_ROWS_BYTES) throw new Error('Captured source rows exceed the 256 KiB editor admission bound.');
  const captured = JSON.parse(encoded);
  if (!Array.isArray(captured) || captured.length > 128) throw new Error('Captured evidence requires at most 128 original source rows.');
  for (const row of captured) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.file !== 'string' || !row.file) {
      throw new Error('Captured evidence requires original source rows with file paths.');
    }
  }
  const freeze = (value, depth = 0) => {
    if (!value || typeof value !== 'object') return value;
    if (depth > 64) throw new Error('Captured source rows exceed 64 nesting levels.');
    for (const child of Object.values(value)) freeze(child, depth + 1);
    return Object.freeze(value);
  };
  return freeze(captured);
}

/** Exact original capture/item/source authority survives every native await.
 * A nested current-context collection receives the same revocation predicate. */
function createCapturedEvidenceOpener({ vscode, operations, getEvidence, collectSources, resolveTarget, createContext }) {
  return () => operations.run('captured-evidence-open', async scope => {
    let captured = null, revoked = false, currentFailed = false, currentError;
    const current = () => {
      if (!captured || revoked || !operations.isCurrent(scope)) return false;
      if (currentFailed) throw currentError;
      try { if (getEvidence() !== captured) { revoked = true; return false; } }
      catch (error) { currentFailed = true; currentError = error; throw error; }
      return true;
    };
    try {
      captured = getEvidence();
      if (!captured) { vscode.window.showInformationMessage('Run Context Pack or Risk Explain to capture evidence first.'); return; }
      if (!current()) return;
      const repoSnapshot = { ...captured.repoContext };
      const repoUri = repoSnapshot.repoUri?.toString?.();
      if (typeof repoSnapshot.repoRoot !== 'string' || !repoSnapshot.repoRoot
        || (repoUri != null && typeof repoUri !== 'string')) throw new Error('Captured evidence has no original repository authority.');
      const repoContext = Object.freeze({ ...repoSnapshot, repoUri: repoUri ? vscode.Uri.parse(repoUri) : null });
      const sources = captureRows(collectSources(captured.payload));
      const items = Object.freeze(sources.map(hit => Object.freeze({ label: hit.name || hit.file,
        description: `${hit.kind} • ${hit.file}:${hit.startLine || 1}`, hit })));
      if (!current()) return;
      const selected = await vscode.window.showQuickPick(items,
        { title: 'Open captured context / risk evidence', placeHolder: 'Exact ranges require a captured source hash; unknown freshness is shown explicitly' });
      if (!current() || !items.includes(selected)) return;
      const actions = Object.freeze(['Open Source', 'Create Context from This Evidence']);
      const action = await vscode.window.showQuickPick(actions, { title: selected.label });
      if (!current() || !actions.includes(action)) return;
      const hit = selected.hit;
      if (action === 'Create Context from This Evidence') {
        return await createContext({ hit, resultSet: Object.freeze({ repoRoot: repoContext.repoRoot, repoUri, hits: sources }) }, current);
      }
      const target = resolveTarget(repoContext, hit);
      if (!target.ok) throw new Error(target.message);
      if (!current()) return;
      if (!hit.sourceHash) {
        vscode.window.showInformationMessage('Captured evidence has no full source hash. Opening the file; indexed range freshness is unknown.');
        if (!current()) return;
        const document = await vscode.workspace.openTextDocument(target.targetUri);
        if (!current()) return;
        await vscode.window.showTextDocument(document, { preview: true });
        return;
      }
      const authority = createDocumentAuthority({ workspace: vscode.workspace, isCurrent: current, maxDocuments: 1 });
      const precise = hit.coordinateUnit === 'utf16' && [hit.startLine, hit.startCol, hit.endLine, hit.endCol].every(Number.isSafeInteger);
      let span = null;
      if (!precise) {
        const source = readVerifiedSource({ repoRoot: repoContext.repoRoot, file: target.filePath, sourceHash: hit.sourceHash });
        const offset = source.sourceText.startsWith('\ufeff') ? 1 : 0; span = { start: offset, end: offset };
      }
      const qualified = await authority.qualify({ repoRoot: repoContext.repoRoot, file: target.filePath,
        uri: target.targetUri, sourceHash: hit.sourceHash, ...(precise ? { range: hit } : { span }) });
      if (!qualified || !current()) return;
      await authority.assertCurrent();
      if (!current()) return;
      const editor = await vscode.window.showTextDocument(qualified.document);
      await authority.assertCurrent();
      if (!current()) return;
      assertQualifiedEditor(editor, qualified);
      if (precise) {
        editor.selection = new vscode.Selection(qualified.document.positionAt(qualified.offsets.start), qualified.document.positionAt(qualified.offsets.end));
        editor.revealRange(editor.selection);
      } else vscode.window.showInformationMessage('Evidence source bytes were verified. Its producer supplied no exact UTF-16 range, so only the source file was opened.');
    } catch (error) {
      const inspectionErrors = []; let message = 'Captured evidence range unavailable.';
      try { const value = error?.message; if (typeof value === 'string') message = value; } catch (inspection) { inspectionErrors.push(inspection); }
      let report = false;
      try { report = current(); } catch (inspection) { if (inspection !== error) inspectionErrors.push(inspection); }
      if (report) try { vscode.window.showErrorMessage(`Captured evidence range unavailable: ${message}`); } catch (inspection) { inspectionErrors.push(inspection); }
      return Object.freeze({ ok: false, primaryError: error, inspectionErrors: Object.freeze(inspectionErrors) });
    }
  }, { key: 'captured-evidence-open' });
}

module.exports = { createCapturedEvidenceOpener };
