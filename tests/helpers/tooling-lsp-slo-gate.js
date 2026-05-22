import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyTestEnv } from './test-env.js';
import { runNode } from './run-node.js';

export const ROOT = process.cwd();
export const toolingLspSloGatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-slo-gate.js');

const DEFAULT_LANGUAGES = {
  clangd: ['c', 'cpp'],
  pyright: ['python'],
  sourcekit: ['swift']
};

export const lspProvider = ({
  id,
  available = true,
  enabled = true,
  languages = DEFAULT_LANGUAGES[id] || [],
  latencyMs = available ? 40 : 0,
  ok = available,
  errorCode = ok ? null : 'ERR_MISSING',
  errorMessage = ok ? null : 'missing'
}) => ({
  id,
  enabled,
  available,
  languages,
  handshake: { ok, latencyMs, errorCode, errorMessage }
});

export const doctorReport = (providers) => ({
  schemaVersion: 2,
  providers
});

export const writeJsonFile = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

export const prepareGateFixture = async ({
  prefix,
  doctorPayload,
  doctorFileName = 'tooling-doctor-report.json',
  baselinePayload = null
}) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const jsonPath = path.join(tempRoot, 'tooling-lsp-slo-gate.json');
  const doctorPath = path.join(tempRoot, doctorFileName);
  const baselinePath = baselinePayload ? path.join(tempRoot, 'baseline.json') : null;
  await writeJsonFile(doctorPath, doctorPayload);
  if (baselinePayload) await writeJsonFile(baselinePath, baselinePayload);
  return { tempRoot, jsonPath, doctorPath, baselinePath };
};

export const cleanupGateFixture = async (fixture) => {
  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
};

export const runGate = (args) => runNode(
  [toolingLspSloGatePath, ...args],
  'tooling lsp slo gate',
  ROOT,
  applyTestEnv({ syncProcess: false }),
  { stdio: 'pipe', allowFailure: true }
);

export const readGatePayload = async (jsonPath) => JSON.parse(await fs.readFile(jsonPath, 'utf8'));

export const logGateFailure = (label, result) => {
  if (result.status === 0) return;
  console.error(label);
  console.error(result.stderr || result.stdout || '');
};
