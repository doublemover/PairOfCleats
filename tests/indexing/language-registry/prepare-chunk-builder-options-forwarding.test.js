#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const filePath = path.join(root, 'src', 'index', 'language-registry', 'registry-data.js');
const source = await fs.readFile(filePath, 'utf8');
const lines = source.split(/\r?\n/);

const failures = [];
const spreadNeedle = "...(options && typeof options === 'object' ? options : {})";

let inPrepare = false;
let prepareDepth = 0;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (!inPrepare && /prepare:\s*async\b/.test(line)) {
    inPrepare = true;
    prepareDepth = 0;
  }
  if (!inPrepare) continue;

  const openCount = (line.match(/\{/g) || []).length;
  const closeCount = (line.match(/\}/g) || []).length;
  prepareDepth += openCount - closeCount;

  if (/build[A-Za-z0-9_]*Chunks\(text,\s*\{/.test(line)) {
    const callLines = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      callLines.push(next);
      if (/\}\);\s*$/.test(next)) break;
      j += 1;
    }
    const callText = callLines.join('\n');
    if (!callText.includes(spreadNeedle)) {
      failures.push(`missing options spread in prepare chunk builder near line ${i + 1}`);
    }
    i = j;
    continue;
  }

  if (prepareDepth <= 0) {
    inPrepare = false;
    prepareDepth = 0;
  }
}

assert.equal(failures.length, 0, failures.join('\n'));
console.log('language registry prepare chunk-builder options forwarding ok');
