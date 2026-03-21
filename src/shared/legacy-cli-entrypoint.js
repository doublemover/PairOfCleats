const JSON_PROGRESS_MODES = new Set(['json', 'jsonl']);

const readFlagValue = (args, name) => {
  const flag = `--${name}`;
  const flagEq = `${flag}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === flag) {
      const next = args[i + 1];
      return next ? String(next) : null;
    }
    if (arg.startsWith(flagEq)) {
      return arg.slice(flagEq.length);
    }
  }
  return null;
};

export function shouldEmitLegacyCliEntrypointWarning({ args = [], env = process.env } = {}) {
  if (env?.PAIROFCLEATS_TESTING === '1') return false;
  if (env?.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING === '1') return false;
  if (env?.CI === 'true') return false;
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
