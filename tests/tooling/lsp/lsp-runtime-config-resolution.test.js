#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveLspRuntimeConfig } from '../../../src/index/tooling/lsp-runtime-config.js';

const resolved = resolveLspRuntimeConfig({
  providerConfig: {
    timeoutMs: 1500,
    maxRetries: 3,
    hoverEnabled: false,
    signatureHelpEnabled: false,
    hoverRequireMissingReturn: false,
    definitionEnabled: false,
    typeDefinitionEnabled: false,
    definitionTimeoutMs: 3900,
    typeDefinitionTimeoutMs: 4100,
    hoverMaxPerFile: 7,
    hoverDisableAfterTimeouts: 2,
    signatureHelpConcurrency: 6,
    documentSymbolTimeoutMs: 2400,
    lifecycle: {
      restartWindowMs: 2100,
      maxRestartsPerWindow: 4,
      sessionIdleTimeoutMs: 2500
    }
  },
  globalConfigs: [{
    timeoutMs: 31000,
    maxRetries: 9,
    circuitBreakerThreshold: 11,
    hoverTimeoutMs: 3600,
    signatureHelpTimeoutMs: 5100,
    definitionConcurrency: 5,
    typeDefinitionConcurrency: 4,
    hoverEnabled: true,
    signatureHelpEnabled: true,
    lifecycle: {
      lifecycleRestartWindowMs: 9000,
      lifecycleMaxRestartsPerWindow: 8,
      lifecycleFdPressureBackoffMs: 700,
      lifecycleSessionMaxLifetimeMs: 600000
    }
  }],
  defaults: {
    timeoutMs: 45000,
    retries: 2,
    breakerThreshold: 5
  }
});

assert.equal(resolved.timeoutMs, 1500, 'expected provider timeout override');
assert.equal(resolved.retries, 3, 'expected provider retries override');
assert.equal(resolved.breakerThreshold, 11, 'expected global breaker threshold fallback');
assert.equal(resolved.documentSymbolTimeoutMs, 2400, 'expected provider documentSymbol timeout');
assert.equal(resolved.hoverTimeoutMs, 3600, 'expected global hover timeout fallback');
assert.equal(resolved.signatureHelpTimeoutMs, 5100, 'expected global signatureHelp timeout fallback');
assert.equal(resolved.definitionTimeoutMs, 3900, 'expected provider definition timeout');
assert.equal(resolved.typeDefinitionTimeoutMs, 4100, 'expected provider typeDefinition timeout');
assert.equal(resolved.hoverMaxPerFile, 7, 'expected provider hover max-per-file');
assert.equal(resolved.hoverDisableAfterTimeouts, 2, 'expected provider hover timeout-disable threshold');
assert.equal(resolved.signatureHelpConcurrency, 6, 'expected provider signatureHelp concurrency');
assert.equal(resolved.hoverEnabled, false, 'expected provider hover enabled override');
assert.equal(resolved.signatureHelpEnabled, false, 'expected provider signatureHelp enabled override');
assert.equal(resolved.definitionEnabled, false, 'expected provider definition enabled override');
assert.equal(resolved.definitionConcurrency, 5, 'expected global definition concurrency fallback');
assert.equal(resolved.typeDefinitionEnabled, false, 'expected provider typeDefinition enabled override');
assert.equal(resolved.typeDefinitionConcurrency, 4, 'expected global typeDefinition concurrency fallback');
assert.equal(resolved.hoverRequireMissingReturn, false, 'expected provider hover completeness override');
assert.equal(resolved.lifecycleRestartWindowMs, 2100, 'expected provider lifecycle restart window alias');
assert.equal(resolved.lifecycleMaxRestartsPerWindow, 4, 'expected provider lifecycle max restarts alias');
assert.equal(resolved.lifecycleFdPressureBackoffMs, 700, 'expected global lifecycle fd backoff fallback');
assert.equal(resolved.sessionIdleTimeoutMs, 2500, 'expected provider session idle timeout alias');
assert.equal(resolved.sessionMaxLifetimeMs, 600000, 'expected global session max lifetime alias');

const defaultsOnly = resolveLspRuntimeConfig({
  providerConfig: null,
  globalConfigs: [],
  defaults: {
    timeoutMs: 12000,
    retries: 1,
    breakerThreshold: 3
  }
});

assert.equal(defaultsOnly.timeoutMs, 12000, 'expected timeout default');
assert.equal(defaultsOnly.retries, 1, 'expected retries default');
assert.equal(defaultsOnly.breakerThreshold, 3, 'expected breaker default');
assert.equal(defaultsOnly.documentSymbolTimeoutMs, null, 'expected documentSymbol timeout to remain unset');
assert.equal(defaultsOnly.hoverTimeoutMs, null, 'expected hover timeout to remain unset');
assert.equal(defaultsOnly.signatureHelpTimeoutMs, null, 'expected signatureHelp timeout to remain unset');
assert.equal(defaultsOnly.definitionTimeoutMs, null, 'expected definition timeout to remain unset');
assert.equal(defaultsOnly.typeDefinitionTimeoutMs, null, 'expected typeDefinition timeout to remain unset');
assert.equal(defaultsOnly.hoverMaxPerFile, null, 'expected hover max-per-file to remain unset');
assert.equal(defaultsOnly.hoverDisableAfterTimeouts, null, 'expected hover timeout-disable threshold to remain unset');
assert.equal(defaultsOnly.signatureHelpConcurrency, null, 'expected signatureHelp concurrency to remain unset');
assert.equal(defaultsOnly.hoverEnabled, null, 'expected hover enabled to remain unset');
assert.equal(defaultsOnly.signatureHelpEnabled, null, 'expected signatureHelp enabled to remain unset');
assert.equal(defaultsOnly.definitionEnabled, null, 'expected definition enabled to remain unset');
assert.equal(defaultsOnly.definitionConcurrency, null, 'expected definition concurrency to remain unset');
assert.equal(defaultsOnly.typeDefinitionEnabled, null, 'expected typeDefinition enabled to remain unset');
assert.equal(defaultsOnly.typeDefinitionConcurrency, null, 'expected typeDefinition concurrency to remain unset');
assert.equal(defaultsOnly.hoverRequireMissingReturn, null, 'expected hover completeness toggle to remain unset');
assert.equal(defaultsOnly.lifecycleRestartWindowMs, null, 'expected lifecycle restart window to remain unset');
assert.equal(defaultsOnly.lifecycleMaxRestartsPerWindow, null, 'expected lifecycle max restarts to remain unset');
assert.equal(defaultsOnly.lifecycleFdPressureBackoffMs, null, 'expected lifecycle fd backoff to remain unset');
assert.equal(defaultsOnly.sessionIdleTimeoutMs, null, 'expected session idle timeout to remain unset');
assert.equal(defaultsOnly.sessionMaxLifetimeMs, null, 'expected session max lifetime to remain unset');

console.log('LSP runtime config resolution test passed');
