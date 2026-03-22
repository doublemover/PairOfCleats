#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildProviderFidelityContract,
  PROVIDER_FIDELITY_STATE
} from '../../../src/index/tooling/provider-contract.js';

const contract = buildProviderFidelityContract({
  providerId: 'sourcekit',
  state: PROVIDER_FIDELITY_STATE.DEGRADED,
  reasonCode: 'sourcekit_preflight_lock_unavailable',
  workspaceKey: 'sourcekit:.',
  runtime: {
    capabilityGate: {
      requested: {
        hover: true,
        semanticTokens: true
      },
      effective: {
        hover: true,
        semanticTokens: false
      }
    },
    requests: {
      byMethod: {
        'textDocument/documentSymbol': { requests: 3, timedOut: 1, failed: 0 },
        'textDocument/hover': { requests: 5, timedOut: 0, failed: 0 }
      }
    }
  },
  blockedWorkspaceRoots: ['svc-bad'],
  byChunkUid: {
    'ck64:v1:test:src/one.swift:provider-fidelity-shape': { types: [] }
  },
  captureDiagnostics: false
});

assert.equal(contract.contractVersion, 1);
assert.equal(contract.providerId, 'sourcekit');
assert.equal(contract.state, 'degraded');
assert.equal(contract.qualityDelta.partialSuccess, true);
assert.equal(contract.blockedPartitions.count, 1);
assert.equal(contract.requestClasses.documentSymbol.timedOut, 1);
assert.equal(contract.requestClasses.hover.requests, 5);
assert.equal(contract.skipped.includes('semanticTokens'), true);
assert.equal(contract.qualityDelta.degradedRequestClasses.includes('documentSymbol'), true);
assert.equal(contract.contributes.typeEnrichment, true);

console.log('LSP provider fidelity contract shape test passed');
