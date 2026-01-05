import { runBinary, resolveBinary } from './binaries.js';
import { parseAstGrep, parseComby, parseSemgrep, readCombyRule } from './parsers.js';

const buildMissingBinaryMessage = (engine, cmd) => {
  const checked = Array.isArray(cmd?.checkedPaths) ? cmd.checkedPaths : [];
  if (!checked.length) return `${engine} binary not found on PATH.`;
  return `${engine} binary not found on PATH. Checked: ${checked.join(', ')}`;
};

const runSemgrep = (repoRoot, pack, rules) => {
  const cmd = resolveBinary('semgrep');
  const args = ['--json'];
  for (const rulePath of rules) args.push('--config', rulePath);
  args.push('--quiet');
  const result = runBinary(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(buildMissingBinaryMessage('semgrep', cmd));
    }
    throw result.error;
  }
  if (result.status !== 0 && !result.stdout) {
    throw new Error(result.stderr || 'semgrep failed');
  }
  return parseSemgrep(result.stdout || '', pack);
};

const runAstGrep = (repoRoot, pack, rules) => {
  const cmd = resolveBinary('ast-grep');
  const results = [];
  for (const rulePath of rules) {
    const args = ['scan', '--json', '--rule', rulePath];
    const result = runBinary(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(buildMissingBinaryMessage('ast-grep', cmd));
      }
      throw result.error;
    }
    if (result.status !== 0 && !result.stdout) {
      throw new Error(result.stderr || 'ast-grep failed');
    }
    results.push(...parseAstGrep(result.stdout || '', pack));
  }
  return results;
};

const runComby = (repoRoot, pack, rules) => {
  const cmd = resolveBinary('comby');
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
    const result = runBinary(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(buildMissingBinaryMessage('comby', cmd));
      }
      throw result.error;
    }
    if (result.status !== 0 && !result.stdout) {
      throw new Error(result.stderr || 'comby failed');
    }
    results.push(...parseComby(result.stdout || '', pack, rule.id, rule.message));
  }
  return results;
};

export const runStructuralSearch = ({ repoRoot, packsToRun }) => {
  const results = [];
  for (const entry of packsToRun) {
    if (!entry.engine) continue;
    if (!entry.rules.length) continue;
    const packMeta = entry.pack
      ? { id: entry.pack.id, tags: entry.pack.tags, severity: entry.pack.severity }
      : null;
    if (entry.engine === 'semgrep') {
      results.push(...runSemgrep(repoRoot, packMeta, entry.rules));
    } else if (entry.engine === 'ast-grep') {
      results.push(...runAstGrep(repoRoot, packMeta, entry.rules));
    } else if (entry.engine === 'comby') {
      results.push(...runComby(repoRoot, packMeta, entry.rules));
    } else {
      throw new Error(`Unsupported engine: ${entry.engine}`);
    }
  }
  return results;
};
