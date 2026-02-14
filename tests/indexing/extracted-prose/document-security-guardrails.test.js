#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extractPdf } from '../../../src/index/extractors/pdf.js';
import { extractDocx, loadDocxExtractorRuntime } from '../../../src/index/extractors/docx.js';
import { buildEncryptedDocxBuffer, buildMinimalDocxBuffer, buildMinimalPdfBuffer } from '../../helpers/document-fixtures.js';

const root = process.cwd();

const runPdfStubCase = ({ payload, timeoutMs, delayMs }) => {
  const moduleUrl = pathToFileURL(path.join(root, 'src', 'index', 'extractors', 'pdf.js')).href;
  const script = `
import { extractPdf } from ${JSON.stringify(moduleUrl)};
const result = await extractPdf({
  buffer: Buffer.from(${JSON.stringify(payload)}, 'utf8'),
  policy: { maxBytesPerFile: 1024, maxPages: 10, extractTimeoutMs: ${Number(timeoutMs)} }
});
process.stdout.write(JSON.stringify(result));
`;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      cwd: root,
      env: {
        ...process.env,
        PAIROFCLEATS_TESTING: '1',
        PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1',
        PAIROFCLEATS_TEST_STUB_PDF_EXTRACT_DELAY_MS: String(delayMs)
      },
      stdio: ['ignore', 'pipe', 'inherit']
    }
  );
  assert.equal(child.status, 0, 'expected subprocess extraction to succeed');
  return JSON.parse(String(child.stdout || '{}'));
};

const oversizePdf = await extractPdf({
  buffer: buildMinimalPdfBuffer('oversize fixture'),
  policy: { maxBytesPerFile: 32, maxPages: 5000, extractTimeoutMs: 15000 }
});
assert.equal(oversizePdf?.ok, false, 'expected pdf oversize result to fail');
assert.equal(oversizePdf?.reason, 'oversize', 'expected pdf oversize reason');

const oversizeDocx = await extractDocx({
  buffer: buildMinimalDocxBuffer(['oversize fixture']),
  policy: { maxBytesPerFile: 32, maxPages: 5000, extractTimeoutMs: 15000 }
});
assert.equal(oversizeDocx?.ok, false, 'expected docx oversize result to fail');
assert.equal(oversizeDocx?.reason, 'oversize', 'expected docx oversize reason');

const docxRuntime = await loadDocxExtractorRuntime({ refresh: true });
if (docxRuntime?.ok) {
  const encryptedDocx = await extractDocx({
    buffer: buildEncryptedDocxBuffer()
  });
  assert.equal(encryptedDocx?.ok, false, 'expected encrypted docx to fail');
  assert.equal(encryptedDocx?.reason, 'unsupported_encrypted', 'expected encrypted docx reason');

  const scannedDocx = await extractDocx({
    buffer: buildMinimalDocxBuffer(['   ', '\n'])
  });
  assert.equal(scannedDocx?.ok, false, 'expected scanned docx to fail');
  assert.equal(scannedDocx?.reason, 'unsupported_scanned', 'expected scanned docx reason');
}

const timeoutPdf = runPdfStubCase({
  payload: 'timeout case text',
  timeoutMs: 10,
  delayMs: 50
});
assert.equal(timeoutPdf?.ok, false, 'expected timeout pdf to fail');
assert.equal(timeoutPdf?.reason, 'extract_timeout', 'expected timeout pdf reason');

const scannedPdf = runPdfStubCase({
  payload: '   ',
  timeoutMs: 50,
  delayMs: 0
});
assert.equal(scannedPdf?.ok, false, 'expected scanned pdf to fail');
assert.equal(scannedPdf?.reason, 'unsupported_scanned', 'expected scanned pdf reason');

console.log('document security guardrails test passed');
