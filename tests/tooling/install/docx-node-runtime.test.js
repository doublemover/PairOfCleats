import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const warnings = [];
const observeWarning = warning => warnings.push(warning);
let storageReads = 0;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
  storageReads++;
  throw new Error('Node DOCX generation must not consult browser storage');
} });
process.on('warning', observeWarning);
try {
  const runtimes = [await import('docx'), createRequire(import.meta.url)('docx')];
  for (const { Document, Paragraph, Packer } of runtimes) {
    const marker = 'DOCX stable Node runtime regression';
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(marker)] }] }));
    const zip = new AdmZip(buffer);
    assert.ok(zip.readAsText('word/document.xml').includes(marker));
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(storageReads, 0);
  assert.deepEqual(warnings, []);
} finally {
  process.off('warning', observeWarning);
  if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
  else delete globalThis.localStorage;
}
console.log('ESM and CommonJS DOCX generation preserve content without browser storage or Node warnings');
