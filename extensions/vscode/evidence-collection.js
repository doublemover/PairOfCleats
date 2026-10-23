const fs = require('node:fs');
const { renderCompositeContextPack } = require('./analysis-renderers.js');
const { assertQualifiedEditor } = require('./document-authority.js');
const { captureEditorFailure, reportEditorFailure, editorFailureEvidence } = require('./editor-failure-evidence.js');

const MAX_SELECTED = 8;
const MAX_EXPORT_BYTES = 256 * 1024;
const previewBudgetErrors = new WeakSet();
const previewBudget = message => { const error = new Error(message); previewBudgetErrors.add(error); return error; };

function originalChoices(selected, items, maximum) {
  if (!Array.isArray(selected) || !selected.length) return null;
  if (selected.length > maximum) throw new Error(`Select at most ${maximum} evidence items.`);
  const choices = [], seen = new Set();
  for (let index = 0; index < selected.length; index++) {
    if (!Object.hasOwn(selected, index)) throw new Error('Evidence choices must be dense original picker items.');
    const choice = selected[index];
    if (seen.has(choice) || !items.includes(choice)) throw new Error('Evidence choices must be distinct original items from this picker.');
    seen.add(choice); choices.push(choice);
  }
  return choices;
}

function capturePacket(packet) {
  const encoded = JSON.stringify(packet);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_EXPORT_BYTES) {
    throw new Error('One canonical context packet exceeds the 256 KiB export bound. Narrow its budgets before collecting.');
  }
  const captured = JSON.parse(encoded);
  const freeze = (value, depth = 0) => {
    if (!value || typeof value !== 'object') return value;
    if (depth > 64) throw new Error('Canonical context packet exceeds the editor nesting bound.');
    for (const child of Object.values(value)) freeze(child, depth + 1);
    return Object.freeze(value);
  };
  return freeze(captured);
}

function evidenceSeed(hit) {
  const chunkUid = hit?.chunkUid;
  if (typeof chunkUid === 'string' && chunkUid) return `chunk:${chunkUid}`;
  const ref = hit?.ref, type = ref?.type;
  if (type === 'chunk') { const id = ref.chunkUid; if (typeof id === 'string' && id) return `chunk:${id}`; }
  if (type === 'symbol') { const id = ref.symbolId; if (typeof id === 'string' && id) return `symbol:${id}`; }
  const file = hit?.file;
  if (typeof file === 'string' && file) return `file:${file}`;
  const sourcePath = hit?.path;
  return typeof sourcePath === 'string' && sourcePath ? `file:${sourcePath}` : null;
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
  if (Buffer.byteLength(json) > MAX_EXPORT_BYTES) throw previewBudget('Selected canonical context packets exceed the 256 KiB export bound. Exclude items or narrow their budgets.');
  const escapedPurpose = String(purpose || '').replace(/[\r\n]/g, ' ').slice(0, 512);
  const markdown = [`# Selected source evidence`, '', `Purpose: ${escapedPurpose || '(unspecified)'}`,
    `Selected: ${packets.length} canonical context packet(s). JSON bytes: ${Buffer.byteLength(json)}. Token estimate unavailable.`,
    'Each packet retains its producer provenance, source/current distinction, coverage, confidence and truncation warnings.',
    'This deliberate collection captures current indexed context for the selected seed; it does not refresh or certify the original search generation.',
    'JSON is an array of unchanged canonical packets; purpose and omissions appear in this preview/Markdown.',
    ...omitted.map(reason => `Omitted: ${reason}`), '',
    ...packets.map(packet => renderCompositeContextPack(packet)),
    'Full canonical evidence:', '```json', json, '```'].join('\n\n');
  if (Buffer.byteLength(markdown) > MAX_EXPORT_BYTES) throw previewBudget('Rendered Markdown exceeds the 256 KiB export bound. Exclude items before exporting.');
  return { json, markdown, bytes: Buffer.byteLength(json) };
}

function createEvidenceCollection({ vscode, operations, getResults, fetchContext }) {
  const showPreview = async (text, isCurrent) => {
    const document = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
    if (!isCurrent()) return null;
    const qualified = { document, version: document.version };
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (!isCurrent()) return null;
    const assertCurrent = () => {
      assertQualifiedEditor(editor, qualified);
      if (document.getText() !== text) throw new Error('Evidence preview changed before the reviewed export action.');
    };
    assertCurrent(); return Object.freeze({ assertCurrent });
  };
  return async function copyContext(node, sourceCurrent = null) {
    return operations.run('evidence-collection', async () => {
      const failures = [];
      let revoked = false, failed = false, sourceError;
      const isCurrent = () => {
        if (!operations.isCurrent() || revoked) return false;
        if (failed) throw sourceError;
        if (sourceCurrent === null) return true;
        try {
          if (typeof sourceCurrent !== 'function') throw new TypeError('Evidence source prerequisite must be an original callback.');
          const accepted = sourceCurrent() === true;
          if (!accepted) revoked = true;
          return accepted;
        } catch (error) { failed = true; sourceError = error; throw error; }
      };
      try {
        if (!isCurrent()) return;
        const resultSet = node?.resultSet || getResults();
        const selectedHit = node?.hit;
        const hits = selectedHit ? [selectedHit] : resultSet?.hits || [];
        if (!resultSet || !hits.length) { await vscode.window.showInformationMessage('Select a saved search result before creating context.'); return; }
        const repoRoot = resultSet.repoRoot, repoUri = resultSet.repoUri;
        if (typeof repoRoot !== 'string' || !repoRoot
          || (repoUri != null && typeof repoUri !== 'string')) throw new Error('Selected evidence has no captured repository authority.');
        const authority = Object.freeze({ repoRoot, repoUri });
        if (!Array.isArray(hits)) throw new Error('Selected evidence requires an original hit array.');
        const candidates = [];
        for (let index = 0; index < Math.min(128, hits.length); index++) {
          if (!Object.hasOwn(hits, index)) throw new Error('Selected evidence requires dense original hit objects.');
          const hit = hits[index];
          if (!hit || typeof hit !== 'object' || Array.isArray(hit)) throw new Error('Selected evidence requires dense original hit objects.');
          candidates.push(hit);
        }
        const seeds = new Map();
        const items = Object.freeze(candidates.map(hit => {
          const item = Object.freeze({
            label: hit.name || hit.file, description: `${hit.file}:${hit.startLine || 1}`,
            detail: `Indexed evidence • ${authority.repoRoot} • generation ${JSON.stringify(hit.generation || resultSet.pagination?.generation || 'unknown')}`,
            picked: Boolean(selectedHit) });
          seeds.set(item, evidenceSeed(hit)); return item;
        }));
        const selected = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Select source evidence (at most 8; preview before copying)' });
        if (!isCurrent()) return;
        const choices = originalChoices(selected, items, MAX_SELECTED);
        if (!choices) return;
        const purpose = await vscode.window.showInputBox({ prompt: 'Purpose of this context (included in Markdown preview)' });
        if (purpose === undefined || !isCurrent()) return;
        if (typeof purpose !== 'string') throw new TypeError('Evidence purpose requires the original text input.');
        const packets = [], omitted = [];
        for (const choice of choices) {
          if (!isCurrent()) return;
          const seed = seeds.get(choice);
          if (!seed) { omitted.push('Selected item has no canonical file/chunk/symbol seed.'); continue; }
          const packet = await fetchContext(seed, authority);
          if (!isCurrent()) return;
          const captured = capturePacket(packet);
          if (!captured?.version || !captured.primary || !captured.provenance || !captured.evidence) {
            throw new Error('The context owner did not return a canonical context packet.');
          }
          packets.push(captured);
        }
        let initial;
        try { initial = renderEvidencePreview(packets, purpose, omitted); }
        catch (primary) {
          if (!previewBudgetErrors.has(primary)) throw primary;
          failures.push(captureEditorFailure(primary));
          initial = { markdown: 'The current selection exceeds the export bound. Exclude packets in the review picker; the final bounded output will be previewed before copying or saving.' };
        }
        if (!await showPreview(initial.markdown, isCurrent)) return;
        const review = Object.freeze(packets.map((packet, index) => Object.freeze({
          label: packet.primary.file || `Context ${index + 1}`,
          description: `${Buffer.byteLength(JSON.stringify(packet))} JSON bytes • captured source evidence`, packet, picked: true
        })));
        const kept = await vscode.window.showQuickPick(review, { canPickMany: true, title: 'Review evidence: exclude any packet before copy/export' });
        if (!isCurrent()) return;
        const retained = originalChoices(kept, review, MAX_SELECTED);
        if (!retained) return;
        const final = renderEvidencePreview(retained.map(choice => choice.packet), purpose,
          [...omitted, ...(retained.length < packets.length ? [`${packets.length - retained.length} packet(s) excluded by user`] : [])]);
        const finalPreview = await showPreview(final.markdown, isCurrent);
        if (!finalPreview) return;
        const actions = Object.freeze(['Copy JSON', 'Copy Markdown', 'Export JSON', 'Export Markdown']);
        const action = await vscode.window.showQuickPick(actions,
          { title: `Reviewed context • ${retained.length} item(s) • ${final.bytes} JSON bytes`,
            placeHolder: 'JSON is an array of unchanged canonical context packets; no external transmission' });
        if (!actions.includes(action) || !isCurrent()) return;
        finalPreview.assertCurrent();
        const text = action.endsWith('JSON') ? final.json : final.markdown;
        if (action.startsWith('Copy')) await vscode.env.clipboard.writeText(text);
        else {
          const target = await vscode.window.showSaveDialog({ saveLabel: 'Export Reviewed Evidence',
            filters: action.endsWith('JSON') ? { JSON: ['json'] } : { Markdown: ['md'] } });
          if (!target || !isCurrent()) return;
          finalPreview.assertCurrent();
          if (vscode.workspace.fs?.writeFile) await vscode.workspace.fs.writeFile(target, Buffer.from(text));
          else if (target.scheme === 'file') fs.writeFileSync(target.fsPath, text, 'utf8');
          else throw new Error('This destination does not support writing evidence.');
        }
        return editorFailureEvidence(failures);
      } catch (error) {
        const original = await reportEditorFailure(error, {
          isCurrent: () => { try { return isCurrent(); } catch (inspection) { if (inspection === error) return false; throw inspection; } },
          notify: message => vscode.window.showErrorMessage(message), prefix: 'PairOfCleats evidence: '
        });
        failures.push(original);
        return Object.freeze({ ok: false, primaryError: error, inspectionErrors: original.inspectionErrors,
          failures: Object.freeze([...failures]) });
      }
    }, { key: 'evidence-collection' });
  };
}

module.exports = { MAX_SELECTED, MAX_EXPORT_BYTES, evidenceSeed, collectEvidenceSources,
  renderEvidencePreview, createEvidenceCollection };
