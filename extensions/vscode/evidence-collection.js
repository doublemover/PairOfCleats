const fs = require('node:fs');
const { renderCompositeContextPack } = require('./analysis-renderers.js');

const MAX_SELECTED = 8;
const MAX_EXPORT_BYTES = 256 * 1024;

function evidenceSeed(hit) {
  if (hit?.chunkUid) return `chunk:${hit.chunkUid}`;
  if (hit?.ref?.type === 'chunk' && hit.ref.chunkUid) return `chunk:${hit.ref.chunkUid}`;
  if (hit?.ref?.type === 'symbol' && hit.ref.symbolId) return `symbol:${hit.ref.symbolId}`;
  const file = hit?.file || hit?.path;
  return file ? `file:${file}` : null;
}

function collectEvidenceSources(payload) {
  const rows = [];
  const add = (value, kind) => {
    if (!value || typeof value !== 'object') return;
    const file = value.file || value.path || value.ref?.path;
    if (!file) return;
    rows.push({ ...value, file, kind, startLine: value.startLine || value.range?.startLine,
      endLine: value.endLine || value.range?.endLine });
  };
  add(payload?.primary, 'primary');
  add(payload?.chunk || payload?.subject, 'risk subject');
  for (const node of payload?.graph?.nodes || []) add(node, 'graph node');
  const flows = payload?.risk?.flows || payload?.flows || [];
  for (const flow of flows.slice(0, 32)) {
    for (const step of (flow?.evidence?.callSitesByStep || flow?.callSitesByStep || []).slice(0, 64)) {
      for (const site of (Array.isArray(step) ? step : step?.callSites || step?.sites || []).slice(0, 16)) add(site?.details || site, 'risk call-site witness');
    }
  }
  return rows.slice(0, 128);
}

function renderEvidencePreview(packets, purpose, omitted = []) {
  const json = JSON.stringify(packets, null, 2) + '\n';
  if (Buffer.byteLength(json) > MAX_EXPORT_BYTES) throw new Error('Selected canonical context packets exceed the 256 KiB export bound. Exclude items or narrow their budgets.');
  const escapedPurpose = String(purpose || '').replace(/[\r\n]/g, ' ').slice(0, 512);
  const markdown = [`# Selected source evidence`, '', `Purpose: ${escapedPurpose || '(unspecified)'}`,
    `Selected: ${packets.length} canonical context packet(s). JSON bytes: ${Buffer.byteLength(json)}. Token estimate unavailable.`,
    'Each packet retains its producer provenance, source/current distinction, coverage, confidence and truncation warnings.',
    'This deliberate collection captures current indexed context for the selected seed; it does not refresh or certify the original search generation.',
    'JSON is an array of unchanged canonical packets; purpose and omissions appear in this preview/Markdown.',
    ...omitted.map(reason => `Omitted: ${reason}`), '',
    ...packets.map(packet => renderCompositeContextPack(packet)),
    'Full canonical evidence:', '```json', json, '```'].join('\n\n');
  if (Buffer.byteLength(markdown) > MAX_EXPORT_BYTES) throw new Error('Rendered Markdown exceeds the 256 KiB export bound. Exclude items before exporting.');
  return { json, markdown, bytes: Buffer.byteLength(json) };
}

function createEvidenceCollection({ vscode, operations, getResults, fetchContext }) {
  return async function copyContext(node) {
    return operations.run('evidence-collection', async () => {
      try {
        const resultSet = node?.resultSet || getResults();
        const hits = node?.hit ? [node.hit] : resultSet?.hits || [];
        if (!resultSet || !hits.length) { vscode.window.showInformationMessage('Select a saved search result before creating context.'); return; }
        const selected = await vscode.window.showQuickPick(hits.slice(0, 128).map(hit => ({
          label: hit.name || hit.file, description: `${hit.file}:${hit.startLine || 1}`,
          detail: `Indexed evidence • ${resultSet.repoRoot} • generation ${JSON.stringify(hit.generation || resultSet.pagination?.generation || 'unknown')}`,
          hit, picked: Boolean(node?.hit)
        })), { canPickMany: true, title: 'Select source evidence (at most 8; preview before copying)' });
        if (!selected?.length) return;
        if (selected.length > MAX_SELECTED) throw new Error('Select at most eight evidence items.');
        const purpose = await vscode.window.showInputBox({ prompt: 'Purpose of this context (included in Markdown preview)' });
        if (purpose === undefined) return;
        const packets = [], omitted = [];
        for (const choice of selected) {
          if (!operations.isCurrent()) return;
          const seed = evidenceSeed(choice.hit);
          if (!seed) { omitted.push('Selected item has no canonical file/chunk/symbol seed.'); continue; }
          const packet = await fetchContext(seed, resultSet);
          if (!packet?.version || !packet.primary || !packet.provenance || !packet.evidence) {
            throw new Error('The context owner did not return a canonical context packet.');
          }
          packets.push(packet);
        }
        let initial;
        try { initial = renderEvidencePreview(packets, purpose, omitted); }
        catch { initial = { markdown: 'The current selection exceeds the export bound. Exclude packets in the review picker; the final bounded output will be previewed before copying or saving.' }; }
        const preview = await vscode.workspace.openTextDocument({ content: initial.markdown, language: 'plaintext' });
        await vscode.window.showTextDocument(preview, { preview: true });
        const retained = await vscode.window.showQuickPick(packets.map((packet, index) => ({
          label: packet.primary.file || `Context ${index + 1}`,
          description: `${Buffer.byteLength(JSON.stringify(packet))} JSON bytes • captured source evidence`, packet, picked: true
        })), { canPickMany: true, title: 'Review evidence: exclude any packet before copy/export' });
        if (!retained?.length) return;
        const final = renderEvidencePreview(retained.map(choice => choice.packet), purpose,
          [...omitted, ...(retained.length < packets.length ? [`${packets.length - retained.length} packet(s) excluded by user`] : [])]);
        const finalPreview = await vscode.workspace.openTextDocument({ content: final.markdown, language: 'plaintext' });
        await vscode.window.showTextDocument(finalPreview, { preview: true });
        const action = await vscode.window.showQuickPick(['Copy JSON', 'Copy Markdown', 'Export JSON', 'Export Markdown'],
          { title: `Reviewed context • ${retained.length} item(s) • ${final.bytes} JSON bytes`,
            placeHolder: 'JSON is an array of unchanged canonical context packets; no external transmission' });
        if (!action || !operations.isCurrent()) return;
        const text = action.endsWith('JSON') ? final.json : final.markdown;
        if (action.startsWith('Copy')) await vscode.env.clipboard.writeText(text);
        else {
          const target = await vscode.window.showSaveDialog({ saveLabel: 'Export Reviewed Evidence',
            filters: action.endsWith('JSON') ? { JSON: ['json'] } : { Markdown: ['md'] } });
          if (!target || !operations.isCurrent()) return;
          if (vscode.workspace.fs?.writeFile) await vscode.workspace.fs.writeFile(target, Buffer.from(text));
          else if (target.scheme === 'file') fs.writeFileSync(target.fsPath, text, 'utf8');
          else throw new Error('This destination does not support writing evidence.');
        }
      } catch (error) { if (operations.isCurrent()) vscode.window.showErrorMessage(`PairOfCleats evidence: ${error.message}`); }
    }, { key: 'evidence-collection' });
  };
}

module.exports = { MAX_SELECTED, MAX_EXPORT_BYTES, evidenceSeed, collectEvidenceSources,
  renderEvidencePreview, createEvidenceCollection };
