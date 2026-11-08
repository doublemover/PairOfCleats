#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const env = applyTestEnv({ extraEnv: { NODE_NO_WARNINGS: null, NODE_OPTIONS: null } });
for (const format of ['module', 'commonjs']) {
  for (const guardBrowserStorage of [false, true]) {
    const source = `
      (async () => {
        let storageReads = 0;
        if (${guardBrowserStorage}) Object.defineProperty(globalThis, 'localStorage', {
          configurable: true, get() { storageReads++; throw new Error('Browser storage is unavailable'); }
        });
        const { Document, Packer, Paragraph } = ${format === 'module' ? "await import('docx')" : "require('docx')"};
        const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Node DOCX fixture')] }] }));
        if (storageReads || bytes.length < 100) throw new Error('Node DOCX generation used browser storage or lost its output');
        console.log('docx node compatibility passed');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = runNode(['--input-type=' + format, '--eval', source],
      `docx ${format} storage-guard=${guardBrowserStorage}`, process.cwd(), env,
      { allowFailure: true, stdio: 'pipe', timeoutMs: 5000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '', 'both official Node exports generate real documents without warnings');
    assert.equal(result.stdout.trim(), 'docx node compatibility passed');
  }
}
console.log('Both DOCX Node exports avoid browser storage and preserve real document generation.');
