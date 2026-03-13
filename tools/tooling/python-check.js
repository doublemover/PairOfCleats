#!/usr/bin/env node
import { probeCommand } from '../shared/cli-utils.js';

const args = process.argv.slice(2);
const json = args.includes('--json');

const candidates = [];
if (typeof process.env.PYTHON === 'string' && process.env.PYTHON.trim()) {
  candidates.push(process.env.PYTHON.trim());
}
candidates.push(process.platform === 'win32' ? 'python' : 'python3');
if (!candidates.includes('python')) candidates.push('python');
if (!candidates.includes('python3')) candidates.push('python3');

let selected = null;
let version = null;
let lastError = '';
for (const candidate of candidates) {
  const result = probeCommand(candidate, ['--version'], { timeoutMs: 4000 });
  if (result.ok) {
    selected = candidate;
    version = String(result.stdout || result.stderr || '').trim();
    break;
  }
  const detail = String(result.stderr || result.stdout || result.errorCode || result.outcome || '').trim();
  if (detail) lastError = detail;
}

if (!selected) {
  const message = 'Python runtime is required for tooling workflows but was not found.';
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      code: 'ERR_PYTHON_TOOLCHAIN_MISSING',
      message,
      detail: lastError || null
    })}\n`);
  } else {
    console.error(message);
    if (lastError) console.error(lastError);
  }
  process.exit(1);
}

const payload = {
  ok: true,
  python: selected,
  version
};
if (json) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
} else {
  console.log(`python-check: ok (${selected}${version ? `: ${version}` : ''})`);
}
