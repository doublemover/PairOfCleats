import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const prepareProviderFallbackFixture = async ({
  root = process.cwd(),
  cacheName,
  fileName,
  source
}) => {
  const tempRoot = resolveTestCachePath(root, cacheName);
  const repoRoot = path.join(tempRoot, 'repo');
  const srcDir = path.join(repoRoot, 'src');
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, fileName), source);
  return { repoRoot, tempRoot };
};

export const createProviderFallbackRequest = ({
  fileName,
  docText,
  languageId,
  effectiveExt,
  symbolName = 'greet',
  symbolKind = 'function'
}) => {
  const virtualPath = `.poc-vfs/src/${fileName}#seg:stub${effectiveExt}`;
  return {
    documents: [{
      virtualPath,
      text: docText,
      languageId,
      effectiveExt
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: `ck64:v1:test:src/${fileName}:deadbeef`,
        chunkId: 'chunk_deadbeef',
        file: `src/${fileName}`,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: symbolName, kind: symbolKind }
    }]
  };
};

export const createLogCapture = () => {
  const logs = [];
  const log = (evt) => {
    if (!evt) return;
    logs.push(typeof evt === 'string' ? evt : (evt.message || String(evt)));
  };
  return { log, logs };
};
