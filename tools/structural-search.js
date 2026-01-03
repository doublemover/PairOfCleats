#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCli } from '../src/shared/cli.js';
import { resolveRepoRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'structural-search',
  options: {
    repo: { type: 'string' },
    engine: { type: 'string' },
    pack: { type: 'array' },
    registry: { type: 'string' },
    rule: { type: 'array' },
    format: { type: 'string', default: 'jsonl' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    'list-packs': { type: 'boolean', default: false }
  }
}).parse();

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const registryPath = argv.registry
  ? path.resolve(argv.registry)
  : path.resolve(scriptRoot, '..', 'rules', 'registry.json');
const outputPath = argv.out ? path.resolve(argv.out) : null;
const format = argv.json ? 'json' : (argv.format || 'jsonl');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const normalizePack = (pack) => ({
  id: String(pack.id || '').trim(),
  label: pack.label || '',
  engine: pack.engine || '',
  rules: Array.isArray(pack.rules) ? pack.rules : [],
  severity: pack.severity || null,
  tags: Array.isArray(pack.tags) ? pack.tags : [],
  description: pack.description || ''
});

const loadRegistry = () => {
  if (!fs.existsSync(registryPath)) return { packs: [] };
  const registry = readJson(registryPath);
  const packs = Array.isArray(registry.packs) ? registry.packs : [];
  return { packs: packs.map(normalizePack) };
};

const registry = loadRegistry();
if (argv['list-packs']) {
  const output = registry.packs.map((pack) => ({
    id: pack.id,
    label: pack.label,
    engine: pack.engine,
    rules: pack.rules
  }));
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

const packIds = (argv.pack || []).map((entry) => String(entry).trim()).filter(Boolean);
const rulePaths = (argv.rule || []).map((entry) => String(entry)).filter(Boolean);
const engineOverride = argv.engine ? String(argv.engine).trim() : '';

const resolvePack = (id) => registry.packs.find((pack) => pack.id === id);
const selectedPacks = packIds.map(resolvePack).filter(Boolean);
const missingPacks = packIds.filter((id) => !resolvePack(id));
if (missingPacks.length) {
  console.error(`Unknown packs: ${missingPacks.join(', ')}`);
}

if (!selectedPacks.length && !engineOverride) {
  console.error('No packs selected and no engine specified.');
  process.exit(1);
}

const resolveRulePath = (rulePath) => {
  if (!rulePath) return null;
  const resolved = path.isAbsolute(rulePath)
    ? rulePath
    : path.resolve(scriptRoot, '..', rulePath);
  return fs.existsSync(resolved) ? resolved : null;
};

const isWindows = process.platform === 'win32';
const runCommand = (resolved, args, options = {}) => {
  const command = resolved?.command || resolved;
  const argsPrefix = resolved?.argsPrefix || [];
  const useShell = isWindows && /\.(cmd|bat)$/i.test(command);
  return spawnSync(command, [...argsPrefix, ...args], { ...options, shell: useShell });
};

const findOnPath = (candidate) => {
  const pathEnv = process.env.PATH || '';
  const paths = pathEnv.split(path.delimiter).filter(Boolean);
  const ext = path.extname(candidate);
  const names = ext
    ? [candidate]
    : [
      candidate,
      `${candidate}.exe`,
      `${candidate}.cmd`,
      `${candidate}.bat`,
      `${candidate}.ps1`
    ];
  for (const dir of paths) {
    for (const name of names) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }
  return null;
};

const resolveBinary = (engine) => {
  const candidates = {
    semgrep: ['semgrep'],
    'ast-grep': ['sg', 'ast-grep'],
    comby: ['comby']
  }[engine] || [];
  if (isWindows) {
    for (const candidate of candidates) {
      const resolved = findOnPath(candidate);
      if (!resolved) continue;
      const ext = path.extname(resolved).toLowerCase();
      if (!ext || ['.js', '.mjs', '.cjs'].includes(ext)) {
        return { command: process.execPath, argsPrefix: [resolved] };
      }
      return { command: resolved, argsPrefix: [] };
    }
    return { command: candidates[0] || engine, argsPrefix: [] };
  }
  for (const candidate of candidates) {
    const result = runCommand(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return { command: candidate, argsPrefix: [] };
    const help = runCommand(candidate, ['--help'], { encoding: 'utf8' });
    if (!help.error && help.status === 0) return { command: candidate, argsPrefix: [] };
  }
  return { command: candidates[0] || engine, argsPrefix: [] };
};

const parseJsonLines = (text) => text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const mergeTags = (tags = [], packTags = []) => {
  const combined = [...tags, ...packTags].map((entry) => String(entry)).filter(Boolean);
  return Array.from(new Set(combined));
};

const normalizeResult = (input) => ({
  engine: input.engine,
  pack: input.pack?.id || null,
  ruleId: input.ruleId || null,
  message: input.message || null,
  severity: input.severity || input.pack?.severity || null,
  tags: mergeTags(input.tags || [], input.pack?.tags || []),
  path: input.path || null,
  startLine: input.startLine ?? null,
  startCol: input.startCol ?? null,
  endLine: input.endLine ?? null,
  endCol: input.endCol ?? null,
  snippet: input.snippet || null,
  metadata: input.metadata || null
});

const parseSemgrep = (output, pack) => {
  if (!output.trim()) return [];
  const payload = JSON.parse(output);
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.map((entry) => normalizeResult({
    engine: 'semgrep',
    pack,
    ruleId: entry.check_id || null,
    message: entry.extra?.message || null,
    severity: entry.extra?.severity || null,
    tags: Array.isArray(entry.extra?.metadata?.category)
      ? entry.extra.metadata.category
      : (Array.isArray(entry.extra?.metadata?.tags) ? entry.extra.metadata.tags : []),
    path: entry.path || null,
    startLine: entry.start?.line ?? null,
    startCol: entry.start?.col ?? null,
    endLine: entry.end?.line ?? null,
    endCol: entry.end?.col ?? null,
    snippet: entry.extra?.lines || null,
    metadata: entry.extra?.metadata || null
  }));
};

const parseAstGrep = (output, pack) => {
  if (!output.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = parseJsonLines(output);
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const results = [];
  for (const entry of entries) {
    if (!entry) continue;
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    const ruleId = entry.ruleId || entry.rule?.id || null;
    for (const match of matches) {
      const range = match.range || {};
      const start = range.start || {};
      const end = range.end || {};
      results.push(normalizeResult({
        engine: 'ast-grep',
        pack,
        ruleId,
        message: match.message || entry.message || null,
        severity: entry.severity || null,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        path: entry.file || entry.path || null,
        startLine: start.line ?? null,
        startCol: start.column ?? null,
        endLine: end.line ?? null,
        endCol: end.column ?? null,
        snippet: match.text || match.matched || null,
        metadata: entry.metadata || null
      }));
    }
  }
  return results;
};

const parseComby = (output, pack, ruleId, message) => {
  const entries = parseJsonLines(output);
  const results = [];
  for (const entry of entries) {
    if (!entry) continue;
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    for (const match of matches) {
      const range = match.range || {};
      const start = range.start || {};
      const end = range.end || {};
      results.push(normalizeResult({
        engine: 'comby',
        pack,
        ruleId,
        message: message || null,
        severity: entry.severity || null,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        path: entry.uri || entry.path || null,
        startLine: start.line ?? null,
        startCol: start.col ?? null,
        endLine: end.line ?? null,
        endCol: end.col ?? null,
        snippet: match.matched || null,
        metadata: entry.metadata || null
      }));
    }
  }
  return results;
};

const runSemgrep = (pack, rules) => {
  const cmd = resolveBinary('semgrep');
  const args = ['--json'];
  for (const rulePath of rules) args.push('--config', rulePath);
  args.push('--quiet');
  const result = runCommand(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !result.stdout) {
    throw new Error(result.stderr || 'semgrep failed');
  }
  return parseSemgrep(result.stdout || '', pack);
};

const runAstGrep = (pack, rules) => {
  const cmd = resolveBinary('ast-grep');
  const results = [];
  for (const rulePath of rules) {
    const args = ['scan', '--json', '--rule', rulePath];
    const result = runCommand(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0 && !result.stdout) {
      throw new Error(result.stderr || 'ast-grep failed');
    }
    results.push(...parseAstGrep(result.stdout || '', pack));
  }
  return results;
};

const readCombyRule = (rulePath) => {
  const payload = readJson(rulePath);
  return {
    id: payload.id || path.basename(rulePath),
    message: payload.message || null,
    language: payload.language || '.',
    pattern: payload.pattern || '',
    rewrite: payload.rewrite || ''
  };
};

const runComby = (pack, rules) => {
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
    const result = runCommand(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0 && !result.stdout) {
      throw new Error(result.stderr || 'comby failed');
    }
    results.push(...parseComby(result.stdout || '', pack, rule.id, rule.message));
  }
  return results;
};

const collectResults = () => {
  const results = [];
  const packsToRun = selectedPacks.map((pack) => ({
    pack,
    engine: pack.engine,
    rules: pack.rules.map(resolveRulePath).filter(Boolean)
  }));
  if (engineOverride || rulePaths.length) {
    packsToRun.push({
      pack: null,
      engine: engineOverride,
      rules: rulePaths.map(resolveRulePath).filter(Boolean)
    });
  }
  for (const entry of packsToRun) {
    if (!entry.engine) continue;
    if (!entry.rules.length) continue;
    const packMeta = entry.pack ? {
      id: entry.pack.id,
      tags: entry.pack.tags,
      severity: entry.pack.severity
    } : null;
    if (entry.engine === 'semgrep') {
      results.push(...runSemgrep(packMeta, entry.rules));
    } else if (entry.engine === 'ast-grep') {
      results.push(...runAstGrep(packMeta, entry.rules));
    } else if (entry.engine === 'comby') {
      results.push(...runComby(packMeta, entry.rules));
    } else {
      throw new Error(`Unsupported engine: ${entry.engine}`);
    }
  }
  return results;
};

const results = collectResults();

const writeJsonl = (items, outPath = null) => {
  const payload = items.map((item) => JSON.stringify(item)).join('\n');
  if (outPath) {
    fs.writeFileSync(outPath, `${payload}${payload ? '\n' : ''}`, 'utf8');
  } else {
    process.stdout.write(`${payload}${payload ? '\n' : ''}`);
  }
};

if (format === 'json') {
  const payload = JSON.stringify({ results }, null, 2);
  if (outputPath) {
    await fsPromises.writeFile(outputPath, payload);
  } else {
    console.log(payload);
  }
} else {
  writeJsonl(results, outputPath);
}
