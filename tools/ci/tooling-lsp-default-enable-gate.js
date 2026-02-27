#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { readJsonFileResolvedSafe, writeJsonFileResolved } from '../shared/json-utils.js';

const DEFAULT_POLICY_PATH = path.join('docs', 'tooling', 'lsp-default-enable-policy.json');

const parseArgs = () => createCli({
  scriptName: 'pairofcleats tooling-lsp-default-enable-gate',
  options: {
    policy: { type: 'string', default: DEFAULT_POLICY_PATH },
    doctor: { type: 'string', default: '' },
    slo: { type: 'string', default: '' },
    json: { type: 'string', default: '' }
  }
})
  .strictOptions()
  .parse();

const normalizeProviderId = (value) => String(value || '').trim().toLowerCase();

const main = async () => {
  const argv = parseArgs();
  const policyPath = path.resolve(argv.policy || DEFAULT_POLICY_PATH);
  const doctorPath = argv.doctor ? path.resolve(argv.doctor) : '';
  const sloPath = argv.slo ? path.resolve(argv.slo) : '';
  const policy = await readJsonFileResolvedSafe(policyPath, null);
  const doctor = await readJsonFileResolvedSafe(doctorPath, null);
  const slo = await readJsonFileResolvedSafe(sloPath, null);

  const failures = [];
  if (!policy || Number(policy.schemaVersion) !== 1 || !Array.isArray(policy.providers)) {
    failures.push('policy file is missing or invalid');
  }
  if (!doctor || typeof doctor !== 'object') {
    failures.push('doctor gate payload is missing or invalid');
  }
  if (!slo || typeof slo !== 'object') {
    failures.push('slo gate payload is missing or invalid');
  }
  if (!failures.length && slo.status !== 'ok') {
    failures.push(`slo gate status is ${String(slo.status)}`);
  }

  const doctorProviders = new Map(
    (Array.isArray(doctor?.providers) ? doctor.providers : [])
      .map((provider) => [normalizeProviderId(provider?.id), provider])
      .filter(([id]) => Boolean(id))
  );

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

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failures.length ? 'error' : 'ok',
    inputs: {
      policyPath,
      doctorPath,
      sloPath
    },
    defaultEnabledProviderCount: defaultEnabledProviders.length,
    checkedProviders,
    failures
  };

  await writeJsonFileResolved(argv.json, payload, { trailingNewline: true });
  console.error('Tooling LSP default-enable gate');
  console.error(`- status: ${payload.status}`);
  console.error(`- default-enabled providers: ${payload.defaultEnabledProviderCount}`);
  if (failures.length) {
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(3);
  }
};

main().catch((error) => {
  console.error(`tooling lsp default-enable gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
