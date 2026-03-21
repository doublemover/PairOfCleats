#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildBenchRunDiagnosticsSummaryLines } from '../../../tools/bench/language/report.js';

const lines = buildBenchRunDiagnosticsSummaryLines({
  diagnostics: {
    stream: {
      countsByType: {
        provider_request_timeout: 5,
        provider_degraded_mode_entered: 2,
        artifact_tail_stall: 3,
        fallback_used: 8
      }
    },
    progressConfidence: {
      countsByBucket: {
        high: 7,
        medium: 3,
        low: 1
      }
    },
    crashRetention: {
      retainedCount: 2
    }
  }
});

assert.equal(lines.length, 3, 'expected highlights, confidence, and crash-retention lines');
assert.match(lines[0], /^\[diagnostics\] run highlights: /);
assert.match(lines[0], /timeouts=5/);
assert.match(lines[0], /degraded=2/);
assert.match(lines[0], /artifact-stalls=3/);
assert.match(lines[0], /fallbacks=8/);
assert.equal(lines[1], '[diagnostics] progress confidence: low=1 medium=3');
assert.equal(lines[2], '[diagnostics] retained crash bundles: 2');

console.log('bench run closeout summary test passed');
