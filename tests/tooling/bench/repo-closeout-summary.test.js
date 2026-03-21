#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildBenchRepoCloseoutSummaryLines } from '../../../tools/bench/language-repos/run-loop.js';

const lines = buildBenchRepoCloseoutSummaryLines({
  repoLabel: 'python pallets/jinja',
  outcome: 'failed',
  failureReason: 'bench',
  diagnostics: {
    countsByType: {
      provider_request_timeout: 4,
      provider_degraded_mode_entered: 1,
      artifact_tail_stall: 2
    },
    topSignals: [
      {
        summaryLabel: 'provider_request_timeout pyright textDocument/documentSymbol timeout',
        count: 4
      },
      {
        summaryLabel: 'artifact_tail_stall field_tokens',
        count: 2
      }
    ]
  },
  progressConfidence: {
    bucket: 'low',
    score: 0.42
  },
  crashRetention: {
    bundlePath: 'C:\\cache\\bundle.json'
  }
});

assert.equal(lines.length, 2, 'expected headline and top-signal lines');
assert.match(lines[0], /\[repo-summary\] python pallets\/jinja failed \(bench\)/);
assert.match(lines[0], /timeouts=4/);
assert.match(lines[0], /degraded=1/);
assert.match(lines[0], /artifact-stalls=2/);
assert.match(lines[0], /confidence=low:0\.42/);
assert.match(lines[0], /crash-bundle=yes/);
assert.match(lines[1], /pyright textDocument\/documentSymbol timeout x4/);
assert.match(lines[1], /artifact_tail_stall field_tokens x2/);

console.log('bench repo closeout summary test passed');
