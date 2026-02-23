#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  runSearchCliWithSpawnSync,
  runSearchCliWithSubprocessSync
} from '../../tools/shared/search-cli-harness.js';

const assertSearchExitError = (err, expectedSignal) => {
  assert.equal(err?.code, 'ERR_SEARCH_CLI_EXIT', 'expected search exit error code');
  assert.equal(err?.exitCode, null, 'expected null exitCode for signal exits');
  assert.equal(err?.signal, expectedSignal, 'expected signal to be preserved');
};

{
  const fakeSpawnSync = () => ({
    status: null,
    signal: 'SIGINT',
    stdout: '',
    stderr: 'interrupted',
    error: null
  });
  assert.throws(
    () => runSearchCliWithSpawnSync({
      query: 'needle',
      searchPath: 'search.js',
      spawnSyncImpl: fakeSpawnSync
    }),
    (err) => {
      assertSearchExitError(err, 'SIGINT');
      assert.equal(err.stderr, 'interrupted');
      return true;
    },
    'expected runSearchCliWithSpawnSync to surface signal exits'
  );
}

{
  const fakeSpawnSubprocessSync = () => ({
    exitCode: null,
    signal: 'SIGTERM',
    stdout: '',
    stderr: 'terminated'
  });
  assert.throws(
    () => runSearchCliWithSubprocessSync({
      query: 'needle',
      searchPath: 'search.js',
      spawnSubprocessSyncImpl: fakeSpawnSubprocessSync
    }),
    (err) => {
      assertSearchExitError(err, 'SIGTERM');
      assert.equal(err.stderr, 'terminated');
      return true;
    },
    'expected runSearchCliWithSubprocessSync to surface signal exits'
  );
}

console.log('search CLI harness signal exit contract test passed');
