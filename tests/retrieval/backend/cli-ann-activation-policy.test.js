#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveAnnActive } from '../../../src/retrieval/cli.js';

assert.equal(
  resolveAnnActive({
    annEnabled: true,
    queryTokens: ['alpha'],
    vectorOnlyModes: []
  }),
  true,
  'expected ANN active when ANN is enabled and query has tokens'
);

assert.equal(
  resolveAnnActive({
    annEnabled: true,
    queryTokens: [],
    vectorOnlyModes: []
  }),
  false,
  'expected ANN inactive for tokenless non-vector-only queries'
);

assert.equal(
  resolveAnnActive({
    annEnabled: true,
    queryTokens: [],
    vectorOnlyModes: ['code']
  }),
  true,
  'expected ANN active for tokenless vector_only queries'
);

assert.equal(
  resolveAnnActive({
    annEnabled: false,
    queryTokens: ['alpha'],
    vectorOnlyModes: ['code']
  }),
  false,
  'expected ANN inactive when ANN is disabled even with vector_only modes'
);

console.log('cli ann activation policy test passed');
