import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSemanticEvidenceWorkflow } = require('../../../extensions/vscode/semantic-evidence.js');
const generation = { baseBuildId: 'semantic-recovery-build', semanticRevision: 0 };
const ref = { partitionId: 'sy1:' + 'a'.repeat(64), localId: 2 };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-semantic-recovery-'));
const file = path.join(root, 'snow 雪.js');
const raw = '\ufeffa😀z\r\nsecond\r\n';
const payload = { generation, status: 'partial', records: [{ ref, kind: 'operation', span: [7, 13] }],
  edges: [], frontier: [{ reason: 'analysis_incomplete' }], sourceRefs: [{
    ref: { localId: 2, partitionId: ref.partitionId }, sourceUnitId: 'su1:' + 'b'.repeat(64),
    path: 'snow 雪.js', sourceHash: createHash('sha256').update(raw).digest('hex'), coordinateUnit: 'utf16'
  }] };
const seed = { generation, selector: { target: ref } };
const operations = { isCurrent: () => true, run: (_label, callback) => callback() };

function ui(choices, { mutateOnReveal = false } = {}) {
  const errors = [], copied = [], reports = [];
  let selections = 0;
  const document = { version: 1, isDirty: false, getText: () => 'a😀z\nsecond\n', positionAt: offset => ({ offset }) };
  const editor = { revealRange() {}, set selection(_value) { selections += 1; } };
  const vscode = { window: {
    async showQuickPick(items) {
      const choice = choices.shift();
      if (typeof choice === 'function') return choice(items);
      return items.find(item => item.value === choice || item.action === choice);
    },
    async showTextDocument(value) { if (value === document && mutateOnReveal) fs.writeFileSync(file, raw + 'replacement'); return editor; },
    async showErrorMessage(message) { errors.push(message); }
  }, workspace: { async openTextDocument(value) { if (value.fsPath) return document; reports.push(value.content); return value; } },
  env: { clipboard: { async writeText(value) { copied.push(value); } } },
  Uri: { file: fsPath => ({ fsPath }) }, Selection: class Selection { constructor(start, end) { this.start = start; this.end = end; } } };
  return { vscode, errors, copied, reports, selectionCount: () => selections };
}

try {
  fs.writeFileSync(file, raw);
  const requests = [];
  const recovery = ui(['cursor', items => items.find(item => item.record), 'detail', 'copy', 'back']);
  await createSemanticEvidenceWorkflow({ vscode: recovery.vscode, operations,
    resolveRepo: async () => ({ repoRoot: root }), chooseTransport: async () => ({ transport: 'cli' }),
    getCursorSeed: () => seed, execute: async (operation, request) => {
      requests.push({ operation, request });
      if (operation === 'detail') throw new Error('controlled permission failure');
      return payload;
    } })();
  assert.deepEqual(requests.map(row => row.operation), ['find', 'detail'], 'error presentation does not retry a consumer');
  assert.match(recovery.errors[0], /controlled permission failure.*Previous evidence is retained/);
  assert.deepEqual(JSON.parse(recovery.copied[0]), payload, 'native recovery retains the previous partial packet and frontier');

  const source = ui(['cursor', items => items.find(item => item.record), 'open', 'back'], { mutateOnReveal: true });
  await createSemanticEvidenceWorkflow({ vscode: source.vscode, operations,
    resolveRepo: async () => ({ repoRoot: root }), chooseTransport: async () => ({ transport: 'cli' }),
    getCursorSeed: () => seed, execute: async () => payload })();
  assert.equal(source.selectionCount(), 0, 'a replaced disk source cannot reuse an unchanged loaded buffer after reveal');
  assert.ok(source.errors.some(message => /differs|changed/.test(message)));
  assert.ok(source.reports.some(text => /analysis_incomplete/.test(text)));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Semantic native recovery retains prior evidence and rejects source replacement across editor awaits');
