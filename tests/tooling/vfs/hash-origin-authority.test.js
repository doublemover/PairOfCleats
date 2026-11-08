import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assignChunkUids, computeSegmentUid } from '../../../src/index/identity/chunk-uid.js';
import { buildToolingVirtualDocuments } from '../../../src/index/tooling/vfs.js';
import { createTypeScriptProvider } from '../../../src/index/tooling/typescript-provider.js';
import { buildTargetLookupIndex, findTargetForOffsets } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { shapeDiagnosticsByChunkUid } from '../../../src/integrations/tooling/providers/lsp/diagnostics.js';
import { buildVfsUri } from '../../../src/integrations/tooling/lsp/uris.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-vfs-origin-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const text = 'import { value } from "./dep.js";\nexport function answer() { return value; }\n';
const range = { start: text.indexOf('export function'), end: text.trimEnd().length };
const segmentUid = await computeSegmentUid({ segmentText: text, segmentType: 'embedded', languageId: 'typescript', ext: '.ts' });
try {
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    noLib: true, types: [], strict: true, module: 'NodeNext', moduleResolution: 'NodeNext'
  }, files: ['left/main.ts', 'right/main.ts'] }));
  for (const origin of ['left', 'right']) {
    await fs.mkdir(path.join(root, origin));
    await fs.writeFile(path.join(root, origin, 'main.ts'), text);
    await fs.writeFile(path.join(root, origin, 'dep.ts'), origin === 'left'
      ? 'export const value: number = 1;\n' : 'export const value: string = "right";\n');
  }
  for (const embedded of [false, true]) {
    const chunks = [], files = new Map();
    for (const origin of ['left', 'right']) {
      const file = `${origin}/${embedded ? 'guide.md' : 'main.ts'}`;
      const prefix = embedded ? 'Introduction\n```ts\n' : '';
      const source = embedded ? `${prefix}${text}\x60\x60\x60\n` : text;
      const chunk = { file, ext: embedded ? '.md' : '.ts', lang: 'typescript',
        containerLanguageId: embedded ? 'markdown' : 'typescript', name: 'answer', kind: 'FunctionDeclaration',
        start: prefix.length + range.start, end: prefix.length + range.end,
        ...(embedded ? { segment: { segmentUid, segmentId: 'fixture-segment', start: prefix.length,
          end: prefix.length + text.length, languageId: 'typescript', ext: '.ts' } } : {}) };
      await assignChunkUids({ chunks: [chunk], fileText: source, fileRelPath: file, strict: true });
      chunks.push(chunk); files.set(file, source);
      if (embedded) await fs.writeFile(path.join(root, file), source);
    }
    let baseline = null;
    for (const hashRouting of [false, true]) {
      const inputs = await buildToolingVirtualDocuments({ chunks, fileTextByPath: files, strict: true, hashRouting });
      assert.equal(inputs.documents.length, 2, 'equal text retains both source/container identities');
      assert.equal(new Set(inputs.documents.map(doc => doc.virtualPath)).size, 2);
      assert.equal(new Set(inputs.documents.map(doc => doc.docHash)).size, 1, 'immutable content hashing remains shared');
      assert.equal(inputs.targets.length, 2);
      const targetIndexes = new Map(), openDocs = new Map(), diagnostics = new Map();
      for (const doc of inputs.documents) {
        const targets = inputs.targets.filter(target => target.virtualPath === doc.virtualPath);
        assert.equal(targets.length, 1);
        assert.equal(targets[0].chunkRef.file, doc.containerPath);
        const index = buildTargetLookupIndex(targets);
        assert.equal(findTargetForOffsets(index, range).chunkRef.chunkUid, targets[0].chunkRef.chunkUid);
        targetIndexes.set(doc.virtualPath, index);
        const uri = buildVfsUri(doc.virtualPath);
        openDocs.set(doc.virtualPath, { uri, text: doc.text });
        diagnostics.set(uri, [{ range: { start: { line: 1, character: 16 }, end: { line: 1, character: 22 } },
          severity: 1, code: 'fixture-origin', message: `origin=${doc.containerPath}` }]);
      }
      const shaped = shapeDiagnosticsByChunkUid({ captureDiagnostics: true, diagnosticsByUri: diagnostics,
        docs: inputs.documents, openDocs, targetIndexesByPath: targetIndexes, diskPathMap: new Map(),
        resolvedRoot: root, resolvedScheme: 'poc-vfs', lineIndexFactory: buildLineIndex,
        maxDiagnosticsPerChunk: 10, checks: [], checkFlags: {}, findTargetForOffsets });
      assert.equal(shaped.diagnosticsCount, 2);
      for (const target of inputs.targets) {
        assert.deepEqual(shaped.diagnosticsByChunkUid[target.chunkRef.chunkUid].map(diag => diag.message), [`origin=${target.chunkRef.file}`]);
      }
      const result = await createTypeScriptProvider().run({ repoRoot: root, strict: true,
        toolingConfig: { typescript: { resolveOrder: ['global'], tsconfigPath: 'tsconfig.json' } } }, inputs);
      const payloads = inputs.targets.map(target => {
        const entry = result.byChunkUid[target.chunkRef.chunkUid];
        assert.ok(entry, JSON.stringify(result));
        assert.equal(entry.payload.returnType, target.chunkRef.file.startsWith('left/') ? 'number' : 'string');
        assert.equal(entry.symbolRef.definingChunk.chunkUid, target.chunkRef.chunkUid);
        return [target.chunkRef.file, entry.payload];
      }).sort(([left], [right]) => left.localeCompare(right));
      if (baseline) assert.deepEqual(payloads, baseline, 'routing cannot change complete compiler type payloads');
      else baseline = payloads;
      const repeated = await buildToolingVirtualDocuments({ chunks, fileTextByPath: files, strict: true, hashRouting });
      assert.deepEqual(repeated, inputs, 'routing is deterministic');
    }
    if (embedded) {
      const coalesced = await buildToolingVirtualDocuments({ chunks, fileTextByPath: files, strict: true,
        hashRouting: true, coalesceSegments: true });
      assert.equal(coalesced.documents.length, 2, 'coalescing stays within its source container');
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Equal-text whole/embedded VFS origins retain targets, diagnostics and different real imported types with hash routing on/off.');
