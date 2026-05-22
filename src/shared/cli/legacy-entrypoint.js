import { readFlagValue } from './argv.js';

const JSON_PROGRESS_MODES = new Set(['json', 'jsonl']);
const FALSEY_CI_VALUES = new Set(['', '0', 'false', 'no', 'off']);

export function shouldEmitLegacyCliEntrypointWarning({ args = [], env = process.env } = {}) {
  if (env?.PAIROFCLEATS_TESTING === '1') return false;
  if (env?.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING === '1') return false;
  const ciValue = String(env?.CI || '').trim().toLowerCase();
  if (ciValue && !FALSEY_CI_VALUES.has(ciValue)) return false;
  if (args.includes('--json')) return false;
  if (args.includes('--config-dump')) return false;
  const progressMode = readFlagValue(args, 'progress');
  if (JSON_PROGRESS_MODES.has(String(progressMode || '').trim().toLowerCase())) return false;
  return true;
}

export function emitLegacyCliEntrypointWarning({
  entrypoint,
  replacement,
  args = [],
  env = process.env,
  stderr = process.stderr
} = {}) {
  if (!shouldEmitLegacyCliEntrypointWarning({ args, env })) return false;
  stderr.write(
    `[deprecated] ${entrypoint} is a legacy compatibility entrypoint. `
    + `Use \`${replacement}\` instead.\n`
  );
  return true;
}
