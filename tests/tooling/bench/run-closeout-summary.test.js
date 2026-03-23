#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildBenchRunDiagnosticsSummaryLines } from '../../../tools/bench/language/report.js';

const lines = buildBenchRunDiagnosticsSummaryLines({
  tasks: [
    {
      diagnostics: {
        topSignals: [
          {
            eventType: 'artifact_tail_stall',
            failureClass: 'family:chunk-meta',
            count: 2
          },
          {
            eventType: 'artifact_tail_stall',
            failureClass: 'family:field-postings',
            count: 1
          }
        ],
        fidelity: {
          providerId: 'gopls',
          runtimeIssues: ['partial_workspace_coverage', 'blocked_workspace_partitions']
        }
      }
    },
    {
      diagnostics: {
        fidelity: {
          providerId: 'pyright',
          runtimeIssues: ['document_symbol_timeout', 'timeout_storm_truncated']
        }
      }
    }
  ],
  diagnostics: {
    stream: {
      countsByType: {
        provider_request_timeout: 5,
        provider_degraded_mode_entered: 2,
        artifact_tail_stall: 3,
        fallback_used: 8
      },
      countsByFailureClass: {
        provider_unhealthy: 3,
        cache_invalid: 2
      },
      countsBySeverity: {
        warn: 18,
        error: 1
      }
    },
    reuse: {
      countsBySurfaceAndSource: {
        'scm-derived:mixed-fallback': 2,
        'provider-result:cache': 4,
        'provider-result:live': 3
      },
      countsByQualityImpact: {
        none: 2,
        'partial-provider-fidelity': 3
      },
      cost: {
        timeCostMs: 3210,
        fetchedCount: 12,
        chunkCount: 9
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

assert.equal(lines.length, 9, 'expected highlights, artifact families, provider fidelity, fallback causes, reuse, cost, severity, confidence, and crash-retention lines');
assert.match(lines[0], /^\[diagnostics\] run highlights: /);
assert.match(lines[0], /timeouts=5/);
assert.match(lines[0], /degraded=2/);
assert.match(lines[0], /artifact-stalls=3/);
assert.match(lines[0], /fallbacks=8/);
assert.equal(lines[1], '[diagnostics] artifact families: chunk-meta=2 | field-postings=1');
assert.equal(lines[2], '[diagnostics] provider fidelity: gopls.blocked-workspace-partitions=1 | gopls.partial-workspace-coverage=1 | pyright.document-symbol-timeout=1 | pyright.timeout-storm-truncated=1');
assert.equal(lines[3], '[diagnostics] fallback causes: provider-unhealthy=3 | cache-invalid=2');
assert.equal(lines[4], '[diagnostics] reuse surfaces: scm-mixed-fallback=2 | provider-cache=4 | provider-live=3');
assert.equal(lines[5], '[diagnostics] fallback cost: time=3.2s | fetched-files=12 | chunks=9 | quality none=2 | partial-provider-fidelity=3');
assert.equal(lines[6], '[diagnostics] severity: error=1 warn=18');
assert.equal(lines[7], '[diagnostics] progress confidence: low=1 medium=3');
assert.equal(lines[8], '[diagnostics] retained crash bundles: 2');

console.log('bench run closeout summary test passed');
