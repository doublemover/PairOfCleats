#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSingleSymbolDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const docText = 'int alpha(void) { return 1; }\n';
await runSingleSymbolDegradedPreflightCase({
  root,
  name: 'clangd-preflight-no-compile-commands-inference-disabled',
  directories: ['src'],
  files: [{ path: 'src/one.c', content: docText }],
  providerId: 'clangd',
  providerConfigKey: 'clangd',
  fixtureCommand: 'clangd',
  providerConfig: {
    autoInferIncludeRoots: false
  },
  input: {
    scenarioName: 'clangd-preflight-no-compile-commands',
    virtualPath: 'src/one.c',
    text: docText,
    languageId: 'c',
    effectiveExt: '.c',
    symbolName: 'alpha'
  },
  expectedReasonCode: 'clangd_compile_commands_missing_inference_disabled',
  expectedCheckName: 'clangd_compile_commands_missing_inference_disabled',
  messages: {
    enrichment: 'expected clangd output even with degraded preflight',
    reasonCode: 'expected compile_commands/inference-disabled reason code',
    check: 'expected compile_commands/inference-disabled warning check'
  }
});

console.log('clangd preflight compile_commands missing with inference disabled test passed');
