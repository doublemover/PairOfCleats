import semver from 'semver';
import path from 'node:path';
import { identifyProvisioningExecutable, probeProvisioningCommand } from './provisioning-plan.js';
import { runOperationalChildWithStorage } from './operational-storage.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';

export const identifyOperationalTool = (id, { stdout = '', stderr = '' } = {}) => {
  const output = `${stdout}\n${stderr}`.trim();
  const expressions = {
    graphviz: /^dot - graphviz version (\d+\.\d+(?:\.\d+)?)(?:\s|$)/,
    ripgrep: /^ripgrep (\d+\.\d+\.\d+)(?:\s|$)/,
    scip: /^scip version v?(\d+\.\d+\.\d+)\s*$/,
    'universal-ctags': /^Universal Ctags (\d+\.\d+\.\d+)(?:\s|,|$)/,
    'gnu-global': /^global \(GNU GLOBAL\) (\d+\.\d+(?:\.\d+)?)(?:\s|$)/,
    'git-lfs': /^git-lfs\/(\d+\.\d+\.\d+)(?:\s|$)/,
    'cargo-cyclonedx': /^cargo(?:-| )cyclonedx (\d+\.\d+\.\d+)(?:\s|$)/,
    cargo: /^cargo (\d+\.\d+\.\d+)(?:\s|$)/,
    'npm-sbom': /^(\d+\.\d+\.\d+)\s*$/
  };
  const match = expressions[id]?.exec(output);
  return match && semver.coerce(match[1]) ? { family: id, version: match[1] } : null;
};

export const OPERATIONAL_TOOL_IDS = new Set(['graphviz', 'ripgrep', 'scip', 'universal-ctags', 'gnu-global', 'git-lfs', 'cargo-cyclonedx', 'cargo', 'npm-sbom']);

/** No project scan, login, upload, package restoration or installation belongs
 * to these probes. JSON from a tiny stdin operation must contain its sentinel.
 */
export const verifyOperationalCapability = async ({ id, command, argsPrefix = [], cwd, env, signal = null, expectedVersion = null },
  { probe = probeProvisioningCommand } = {}) => {
  const run = (args, extra = {}) => probe(command, [...argsPrefix, ...args], { cwd, env, signal, timeoutMs: 4000, maxOutputBytes: 65536, ...extra });
  const initialArgs = id === 'graphviz' ? ['-V'] : id === 'git-lfs' ? ['version'] : ['--version'];
  const first = await run(initialArgs);
  const identity = first.ok ? identifyOperationalTool(id, first) : null;
  if (!identity || expectedVersion && identity.version !== expectedVersion) return { ok: false, identity, level: 'executable-identity-rejected' };
  if (id === 'graphviz') {
    const rendered = await run(['-Tsvg'], { input: 'digraph { probe [label="pairofcleats-render-probe"]; }' });
    const ok = rendered.ok && /<svg\b/.test(rendered.stdout) && rendered.stdout.includes('pairofcleats-render-probe') && /<text\b/.test(rendered.stdout);
    return { ok, identity, level: ok ? 'dot-svg-layout-font-and-plugin-operation' : 'dot-svg-operation-rejected' };
  }
  if (id === 'ripgrep') {
    const matched = await run(['--json', '--fixed-strings', 'pairofcleats-rg-probe', '-'], { input: 'pairofcleats-rg-probe\n' });
    let rows = [];
    try { rows = matched.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line)); } catch { /* Incompatible output is a failed capability. */ }
    const ok = matched.ok && rows.some(row => row.type === 'match' && row.data?.lines?.text === 'pairofcleats-rg-probe\n');
    return { ok, identity, level: ok ? 'local-json-stdin-match' : 'local-json-match-rejected' };
  }
  if (id === 'scip') {
    // Index.documents field 2 contains Document.relative_path field 1.
    // https://github.com/scip-code/scip/blob/v0.10.0/scip.proto
    const name = Buffer.from('pairofcleats-probe.js'), document = Buffer.concat([Buffer.from([0x0a, name.length]), name]);
    const printed = await run(['print', '--json', '-'], { input: Buffer.concat([Buffer.from([0x12, document.length]), document]) });
    let index = null;
    try { index = JSON.parse(printed.stdout); } catch { /* Version/help output is not a decoded SCIP index. */ }
    const ok = printed.ok && index?.documents?.length === 1 && (index.documents[0].relative_path || index.documents[0].relativePath) === name.toString();
    return { ok, identity, level: ok ? 'protobuf-stdin-to-json-document' : 'protobuf-json-capability-rejected' };
  }
  if (id === 'universal-ctags') {
    const features = await run(['--options=NONE', '--list-features']);
    const fields = await run(['--options=NONE', '--list-fields']);
    const ok = features.ok && /^json(?:\s|$)/m.test(features.stdout) && fields.ok && /^\s*n\s+line\s/m.test(fields.stdout);
    return { ok, identity, level: ok ? 'universal-ctags-json-and-line-fields' : 'ctags-json-or-fields-unavailable' };
  }
  if (id === 'gnu-global') {
    const help = await run(['--help']);
    const ok = help.ok && /--result\b/.test(help.stdout) && /--encode-path\b/.test(help.stdout) && /--color\b/.test(help.stdout);
    return { ok, identity, level: ok ? 'scoped-cxref-query-options' : 'global-query-options-unavailable' };
  }
  if (id === 'cargo-cyclonedx') {
    const help = await run(['--help']);
    const ok = help.ok && /--format\b/.test(help.stdout) && /--override-filename\b/.test(help.stdout) && /--manifest-path\b/.test(help.stdout);
    return { ok, identity, level: ok ? 'cargo-subcommand-option-contract' : 'cargo-cyclonedx-options-unavailable' };
  }
  if (id === 'npm-sbom') {
    const help = await run(['sbom', '--help']);
    const ok = help.ok && /npm sbom/.test(help.stdout) && /--sbom-format/.test(help.stdout);
    return { ok, identity, level: ok ? 'npm-sbom-command-option-contract' : 'npm-sbom-command-unavailable' };
  }
  return { ok: true, identity, level: 'recognized-executable-version-only' };
};

export const verifyManagedOperationalTool = async (input, { probe = probeProvisioningCommand } = {}) => {
  if (!path.isAbsolute(input.toolingRoot || '') || !path.isAbsolute(input.root || '')) throw new Error('Managed operational verification requires its launch-selected tooling owner and exact generation root.');
  const id = input.descriptor.toolId, identity = identifyProvisioningExecutable(input.command, { signal: input.signal });
  const env = resolveNoProvisionToolingEnvironment(process.env, { command: input.command, providerId: id,
    toolingRoot: input.toolingRoot, cwd: input.root });
  return { ...await verifyOperationalCapability({ id, command: input.command, argsPrefix: input.args || [],
    cwd: input.root, env, signal: input.signal, expectedVersion: input.descriptor.version }, {
    probe: (command, args, options) => runOperationalChildWithStorage({ id, toolingRoot: input.toolingRoot,
      repoRoot: input.toolingRoot, command, identity, env: options.env, cwd: options.cwd }, ({ env: routed }) =>
      probe(command, args, { ...options, env: routed }))
  }), settlement: { resourceId: input.resourceId, settled: true, pending: false } };
};
