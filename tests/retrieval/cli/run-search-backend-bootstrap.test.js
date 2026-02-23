#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRunSearchBackendContext } from '../../../src/retrieval/cli/run-search/backend-bootstrap.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const selectionError = await resolveRunSearchBackendContext({
  selectionInput: { backendArg: 'auto' },
  contextInput: {},
  dependencies: {
    resolveAutoSqliteEligibility: () => ({
      autoBackendRequested: true,
      autoSqliteAllowed: false,
      autoSqliteReason: 'missing sqlite'
    }),
    resolveRunSearchBackendSelection: async () => ({
      error: { message: 'selection failed', code: 'ERR_SELECTION' }
    }),
    initializeBackendContext: async () => {
      throw new Error('should not initialize context on selection failure');
    }
  }
});

assert.equal(selectionError.error.message, 'selection failed');
assert.equal(selectionError.error.code, 'ERR_SELECTION');

let observedSelectionInput = null;
let observedContextInput = null;
const success = await resolveRunSearchBackendContext({
  selectionInput: {
    backendArg: 'auto',
    sqliteAvailable: true
  },
  contextInput: {
    rootDir: '/repo'
  },
  dependencies: {
    resolveAutoSqliteEligibility: () => ({
      autoBackendRequested: true,
      autoSqliteAllowed: true,
      autoSqliteReason: 'eligible'
    }),
    resolveRunSearchBackendSelection: async (input) => {
      observedSelectionInput = input;
      return {
        backendPolicy: 'sqlite',
        useSqliteSelection: true,
        useLmdbSelection: false,
        sqliteFtsEnabled: true,
        backendForcedSqlite: true,
        backendForcedLmdb: false,
        backendForcedTantivy: false
      };
    },
    initializeBackendContext: async (input) => {
      observedContextInput = input;
      return {
        buildBackendContextInput: { stage: 'bootstrap' },
        backendContext: {
          useSqlite: true,
          useLmdb: false,
          backendLabel: 'sqlite',
          backendPolicyInfo: 'policy-info',
          vectorAnnState: null,
          vectorAnnUsed: false,
          sqliteHelpers: {},
          lmdbHelpers: {}
        }
      };
    }
  }
});

assert.equal(observedSelectionInput.autoBackendRequested, true);
assert.equal(observedSelectionInput.autoSqliteAllowed, true);
assert.equal(observedSelectionInput.autoSqliteReason, 'eligible');
assert.equal(observedContextInput.backendPolicy, 'sqlite');
assert.equal(observedContextInput.useSqliteSelection, true);
assert.equal(observedContextInput.sqliteFtsEnabled, true);
assert.equal(success.backendContext.backendLabel, 'sqlite');
assert.equal(success.backendPolicy, 'sqlite');
assert.deepEqual(success.buildBackendContextInput, { stage: 'bootstrap' });

console.log('run-search backend bootstrap test passed');
