#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildMetaV2 } from '../src/index/metadata-v2.js';

const chunk = {
  file: 'src/example.ts',
  ext: '.ts',
  start: 0,
  end: 10,
  startLine: 1,
  endLine: 1
};

const docmeta = {
  inferredTypes: {
    params: {
      opts: [
        { type: 'WidgetOpts', source: 'tooling', confidence: 0.9 },
        { type: 'WidgetOptsLocal', source: 'inferred', confidence: 0.6 }
      ]
    }
  }
};

const meta = buildMetaV2({ chunk, docmeta, toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' } });

assert.ok(meta?.types?.tooling?.params?.opts?.some((entry) => entry.type === 'WidgetOpts'));
assert.ok(meta?.types?.inferred?.params?.opts?.some((entry) => entry.type === 'WidgetOptsLocal'));

console.log('metadata v2 param map tooling split test passed');
