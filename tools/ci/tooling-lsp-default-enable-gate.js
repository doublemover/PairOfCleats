#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { readJsonFileResolvedSafe } from '../shared/json-utils.js';
import {
  emitGateResult,
  mapProvidersById,
  normalizeProviderId,
  resolveDoctorReportInput
} from '../shared/tooling-gate-utils.js';

const DEFAULT_POLICY_PATH = path.join('docs', 'tooling', 'lsp-default-enable-policy.json');

const parseArgs = () => createCli({
  scriptName: 'pairofcleats tooling-lsp-default-enable-gate',
  options: {
    mode: { type: 'string', default: 'ci', choices: ['ci', 'nightly'] },
    policy: { type: 'string', default: DEFAULT_POLICY_PATH },
    doctor: { type: 'string', default: '' },
    slo: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    enforce: { type: 'boolean', default: false }
  }
})
  .strictOptions()
  .parse();

const main = async () => {
  const argv = parseArgs();
  const enforce = argv.enforce === true;
  const policyPath = path.resolve(argv.policy || DEFAULT_POLICY_PATH);
  const doctorPath = argv.doctor ? path.resolve(argv.doctor) : '';
  const sloPath = argv.slo ? path.resolve(argv.slo) : '';
  const policy = await readJsonFileResolvedSafe(policyPath, null);
  let doctor = null;
  let doctorInputError = '';
  if (doctorPath) {
    try {
      const doctorInput = await resolveDoctorReportInput(doctorPath);
      doctor = doctorInput.report;
    } catch (error) {
      doctorInputError = String(error?.message || error);
    }
  }
  const slo = await readJsonFileResolvedSafe(sloPath, null);

  const failures = [];
  const advisories = [];
  if (!policy || Number(policy.schemaVersion) !== 1 || !Array.isArray(policy.providers)) {
    failures.push('policy file is missing or invalid');
  }
  if (!doctor || typeof doctor !== 'object') {
    failures.push(doctorInputError || 'doctor gate payload is missing or invalid');
  }
  if (!slo || typeof slo !== 'object') {
    failures.push('slo gate payload is missing or invalid');
  }
  if (!failures.length && String(slo?.status || '').toLowerCase() !== 'ok') {
    advisories.push(`slo gate status is ${String(slo?.status || 'unknown')} (informational)`);
  }

  const doctorProviders = mapProvidersById(doctor?.providers);

  const defaultEnabledProviders = [];
  const checkedProviders = [];
  for (const entry of (Array.isArray(policy?.providers) ? policy.providers : [])) {
    const providerId = normalizeProviderId(entry?.id);
    if (!providerId || entry?.defaultEnabled !== true) continue;
    defaultEnabledProviders.push(providerId);
    const provider = doctorProviders.get(providerId);
    if (!provider) {
      failures.push(`default-enabled provider missing from doctor report: ${providerId}`);
      continue;
    }
    checkedProviders.push({
      id: providerId,
      enabled: provider.enabled === true,
      available: provider.available !== false,
      status: provider.status || 'unknown'
    });
    if (provider.enabled !== true) {
      failures.push(`default-enabled provider is disabled: ${providerId}`);
      continue;
    }
    if (provider.available === false || provider.status === 'error') {
      failures.push(`default-enabled provider unavailable: ${providerId} (${provider.status || 'unknown'})`);
    }
  }

  const status = failures.length
    ? (enforce ? 'error' : 'warn')
    : 'ok';
  if (failures.length && !enforce) {
    advisories.push('default-enable failures are informational (enforce=off)');
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: argv.mode,
    status,
    enforced: enforce,
    inputs: {
      policyPath,
      doctorPath,
      sloPath
    },
    defaultEnabledProviderCount: defaultEnabledProviders.length,
    checkedProviders,
    advisories,
    failures
  };

  await emitGateResult({
    jsonPath: argv.json,
    payload,
    heading: 'Tooling LSP default-enable gate',
    summaryLines: [
      `- status: ${payload.status}`,
      `- enforce: ${enforce ? 'on' : 'off (informational)'}`,
      `- default-enabled providers: ${payload.defaultEnabledProviderCount}`,
      `- advisories: ${advisories.length}`
    ],
    failures,
    enforceFailureExit: enforce
  });
  for (const advisory of advisories) {
    console.error(`  - advisory: ${advisory}`);
  }
};

main().catch((error) => {
  console.error(`tooling lsp default-enable gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
