import { withStructuralBinary } from './execution.js';
import { parseAstGrep, parseComby, parseSemgrep, readCombyRule } from './parsers.js';

const buildMissingBinaryMessage = (engine, cmd) => {
  const checked = Array.isArray(cmd?.checkedPaths) ? cmd.checkedPaths : [];
  if (!checked.length) return `${engine} binary not found on PATH.`;
  return `${engine} binary not found on PATH. Checked: ${checked.join(', ')}`;
};

const assertExitOk = (engine, result) => {
  const status = result?.status;
  if (status === 0) return;
  if (engine === 'semgrep' && status === 1 && result.stdout) return;
  const message = result.stderr || `${engine} failed (status ${status})`;
  const err = new Error(message);
  err.code = 'ERR_STRUCTURAL_TOOL';
  err.exitCode = status;
  throw err;
};

const runSemgrep = async (repoRoot, pack, rules, cmd) => {
  const args = ['--json'];
  for (const rulePath of rules) args.push('--config', rulePath);
  args.push('--quiet');
  const result = await cmd.run(args);
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(buildMissingBinaryMessage('semgrep', cmd));
    }
    throw result.error;
  }
  assertExitOk('semgrep', result);
  return parseSemgrep(result.stdout || '', pack);
};

const runAstGrep = async (repoRoot, pack, rules, cmd) => {
  const results = [];
  for (const rulePath of rules) {
    const args = ['scan', '--json', '--rule', rulePath];
    const result = await cmd.run(args);
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(buildMissingBinaryMessage('ast-grep', cmd));
      }
      throw result.error;
    }
    assertExitOk('ast-grep', result);
    results.push(...parseAstGrep(result.stdout || '', pack));
  }
  return results;
};

const runComby = async (repoRoot, pack, rules, cmd) => {
  const results = [];
  for (const rulePath of rules) {
    const rule = readCombyRule(rulePath);
    const args = [
      '-json-lines',
      '-matcher', rule.language,
      rule.pattern,
      rule.rewrite || rule.pattern,
      repoRoot
    ];
    const result = await cmd.run(args);
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(buildMissingBinaryMessage('comby', cmd));
      }
      throw result.error;
    }
    assertExitOk('comby', result);
    results.push(...parseComby(result.stdout || '', pack, rule.id, rule.message));
  }
  return results;
};

export const runStructuralSearch = async ({ repoRoot, packsToRun, signal = null }, runtime = withStructuralBinary) => {
  const results = [];
  for (const entry of packsToRun) {
    if (!entry.engine) continue;
    if (!entry.rules.length) continue;
    const packMeta = entry.pack
      ? { id: entry.pack.id, tags: entry.pack.tags, severity: entry.pack.severity }
      : null;
    const engine = { semgrep: runSemgrep, 'ast-grep': runAstGrep, comby: runComby }[entry.engine];
    if (!engine) {
      throw new Error(`Unsupported engine: ${entry.engine}`);
    }
    signal?.throwIfAborted();
    results.push(...await runtime(entry.engine, { repoRoot, signal }, cmd => engine(repoRoot, packMeta, entry.rules, cmd)));
  }
  return results;
};
