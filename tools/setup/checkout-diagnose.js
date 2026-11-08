#!/usr/bin/env node
// Dependency-free information front door. No native activation or provisioning.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBootstrapRuntimeContext, inspectBootstrapReadiness } from '../../src/shared/bootstrap-readiness.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { runSetupPreflight } from './preflight.js';
import { inspectCheckoutRecovery } from './checkout-recovery.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const diagnoseCheckout = async ({ root = ROOT, prerequisites = false } = {}) => {
  const bootstrap = await inspectBootstrapReadiness({ root, probeNatives: false });
  const recovery = inspectCheckoutRecovery({ root, readiness: bootstrap });
  let prerequisiteReport = { state: 'not-probed' };
  if (prerequisites) {
    try { prerequisiteReport = { state: 'located', ...runSetupPreflight() }; }
    catch (error) { prerequisiteReport = { state: 'blocked', message: error.message }; }
  }
  return {
    schemaVersion: 1, kind: 'checkout-diagnosis', root: path.resolve(root),
    runtime: getBootstrapRuntimeContext(),
    bootstrap, recovery, prerequisites: prerequisiteReport,
    operationalReadiness: 'not-probed',
    nextCommands: recovery.command ? [recovery.command] : [],
    repairQualification: recovery.reason + ' This read-only metadata selection does not qualify native or target readiness.',
    provisioning: 'Target provisioning is separate: pairofcleats setup --repo <target> --plan. No operation ran.'
  };
};

export const handleCheckoutInformation = async (args, { root = ROOT, stdout = process.stdout, stderr = process.stderr } = {}) => {
  const json = args.includes('--json');
  const command = args[0];
  if (['--version', '-v'].includes(command) && args.every(arg => [command, '--json'].includes(arg))) {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    if (json) stdout.write(JSON.stringify({ schemaVersion: 1, kind: 'version', version, runtime: process.version, operationalReadiness: 'not-probed' }) + '\n');
    else stderr.write(version + '\n');
    return true;
  }
  if (['checkout', 'diagnose-checkout'].includes(command)) {
    const tail = command === 'checkout' && args[1] === 'diagnose' ? args.slice(2) : args.slice(1);
    if (command === 'checkout' && args[1] !== 'diagnose') return false;
    if (tail.some(arg => !['--json', '--prerequisites'].includes(arg))) {
      stderr.write('Usage: pairofcleats checkout diagnose [--json] [--prerequisites]\n');
      process.exitCode = 2;
      return true;
    }
    const report = await diagnoseCheckout({ root, prerequisites: tail.includes('--prerequisites') });
    if (json) stdout.write(JSON.stringify(report, null, 2) + '\n');
    else {
      stderr.write(`Checkout: ${report.root}\nNode: ${report.runtime.actual} (${report.runtime.executable}); required ${report.runtime.required}\n`);
      stderr.write(`Bootstrap metadata: ${report.bootstrap.ready ? 'intact; native probes not run' : report.bootstrap.reason}\n`);
      for (const mismatch of report.bootstrap.mismatches) stderr.write(`- ${mismatch.field}: expected ${mismatch.expected}; receipt ${mismatch.observed}\n`);
      stderr.write(`Next: ${report.nextCommands[0] || report.recovery.action}\n${report.repairQualification}\n${report.provisioning}\n`);
      if (report.prerequisites.state === 'blocked') stderr.write(`Prerequisites: ${report.prerequisites.message}\n`);
    }
    process.exitCode = report.bootstrap.ready && report.prerequisites.state !== 'blocked' ? 0 : 1;
    return true;
  }
  const helpFlags = ['--help', '-h', '--help-all', 'help', 'help-all'];
  const help = args.some(arg => helpFlags.includes(arg));
  if (!help && args.length) return false;
  if (args.some(arg => ![...helpFlags, '--json', 'bootstrap', 'setup'].includes(arg))) return false;
  if (command && ![...helpFlags, 'bootstrap', 'setup'].includes(command)) return false;
  // Prepared checkouts retain canonical detailed help and its registry owner.
  if ((await inspectBootstrapReadiness({ root, probeNatives: false })).ready) return false;
  const lines = [
    'PairOfCleats source-checkout CLI',
    '  pairofcleats checkout diagnose [--json] [--prerequisites]',
    '  pairofcleats --version',
    'Prepare application dependencies in this checkout: npm run bootstrap:ci',
    'Prepare a selected target after bootstrap: pairofcleats setup --repo <target> --plan',
    'Target bootstrap is optional provisioning; it is not locked checkout bootstrap.',
    'Command reference: docs/guides/commands.md. First use: docs/guides/first-search.md.',
    'Detailed operational help is available after verified checkout bootstrap.'
  ];
  if (json) stdout.write(JSON.stringify({ schemaVersion: 1, kind: 'checkout-help', scope: command || 'top-level',
    detailedHelp: 'unavailable-before-bootstrap', operationalReadiness: 'not-probed', lines,
    nextCommand: 'npm run bootstrap:ci' }, null, 2) + '\n');
  else stderr.write(lines.join('\n') + '\n');
  return true;
};

if (isDirectExecution(import.meta.url)) await handleCheckoutInformation(['checkout', 'diagnose', ...process.argv.slice(2)]);
