#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { ARTIFACT_SCHEMA_DEFS } from '../../src/contracts/registry.js';
import { readJsoncFile } from '../../src/shared/jsonc.js';
import { resolveToolRoot } from '../shared/dict-utils.js';

const ROOT = resolveToolRoot();

const parseArgs = () => createCli({
  scriptName: 'pairofcleats doc-contract-drift',
  options: {
    root: { type: 'string' },
    'out-json': { type: 'string', default: 'docs/tooling/doc-contract-drift.json' },
    'out-md': { type: 'string', default: 'docs/tooling/doc-contract-drift.md' },
    fail: { type: 'boolean', default: false }
  }
})
  .strictOptions()
  .parse();

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const toSortedArray = (set) => Array.from(set).sort((a, b) => a.localeCompare(b));

const diffSets = (source, doc) => ({
  missingInDocs: toSortedArray(new Set([...source].filter((item) => !doc.has(item)))),
  extraInDocs: toSortedArray(new Set([...doc].filter((item) => !source.has(item))))
});

const extractOptionsKeys = (text) => {
  const marker = 'const options = {';
  const start = text.indexOf(marker);
  if (start < 0) return [];
  const openIndex = text.indexOf('{', start);
  if (openIndex < 0) return [];
  let depth = 0;
  let endIndex = -1;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }
  if (endIndex < 0) return [];
  const block = text.slice(openIndex + 1, endIndex);
  const keys = new Set();
  const keyRegex = /(^|\n)\s*(['"]?)([A-Za-z0-9_-]+)\2\s*:\s*\{/g;
  let match = null;
  while ((match = keyRegex.exec(block)) !== null) {
    keys.add(match[3]);
  }
  return toSortedArray(keys);
};

const extractAliases = (text) => {
  const aliases = new Set();
  const aliasMatch = text.match(/alias\(\s*\{([^}]+)\}\s*\)/m);
  if (!aliasMatch) return aliases;
  const pairs = aliasMatch[1].split(',');
  for (const pair of pairs) {
    const [rawKey] = pair.split(':');
    const key = rawKey ? rawKey.trim().replace(/['"]/g, '') : '';
    if (key) aliases.add(`-${key}`);
  }
  return aliases;
};

const extractFlagsFromDoc = (text) => {
  const flags = new Set();
  const matches = text.match(/--[a-z0-9-]+/gi) || [];
  for (const match of matches) flags.add(match);
  const shortMatches = text.match(/(?:^|\s|`)-[a-z]\b/g) || [];
  for (const match of shortMatches) {
    const cleaned = match.trim().replace(/^`/, '');
    flags.add(cleaned);
  }
  return flags;
};

const normalizeDocFlags = (docFlags, sourceFlags) => {
  const normalized = new Set(docFlags);
  for (const flag of docFlags) {
    if (!flag.startsWith('--no-')) continue;
    const base = `--${flag.slice(5)}`;
    if (sourceFlags.has(base)) normalized.delete(flag);
  }
  return normalized;
};

const extractDocSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  if (start < 0) return '';
  const end = endMarker ? text.indexOf(endMarker, start) : -1;
  return text.slice(start, end > start ? end : text.length);
};

const extractScoreBreakdownKeysFromCode = (text) => {
  const marker = 'const scoreBreakdown';
  const start = text.indexOf(marker);
  if (start < 0) return new Set();
  const openIndex = text.indexOf('{', start);
  if (openIndex < 0) return new Set();
  let depth = 0;
  let endIndex = -1;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }
  if (endIndex < 0) return new Set();
  const block = text.slice(openIndex + 1, endIndex);
  const keys = new Set();
  const lines = block.split('\n');
  const keyLines = lines
    .map((line) => line.match(/^(\s+)([a-zA-Z0-9_]+)\s*:/))
    .filter(Boolean);
  if (!keyLines.length) return keys;
  const baseIndent = Math.min(...keyLines.map((match) => match[1].length));
  for (const match of keyLines) {
    if (match[1].length === baseIndent) keys.add(match[2]);
  }
  return keys;
};

const extractScoreBreakdownKeysFromDoc = (text) => {
  const section = extractDocSection(text, '## Explain schema', '## Phase 11');
  const matches = section.match(/- `([a-zA-Z0-9_]+)`/g) || [];
  const keys = new Set();
  for (const match of matches) {
    const key = match.replace(/- `/, '').replace(/`/, '').trim();
    if (key) keys.add(key);
  }
  return keys;
};

const extractArtifactsFromDoc = (text) => {
  const registrySection = extractDocSection(text, '## Artifact registry', '### Phase 11');
  const artifacts = new Set();
  for (const line of registrySection.split('\n')) {
    if (!line.trim().startsWith('-')) continue;
    const parenIndex = line.indexOf('(');
    const colonIndex = line.indexOf(':');
    let cutIndex = line.length;
    if (parenIndex !== -1) cutIndex = Math.min(cutIndex, parenIndex);
    if (colonIndex !== -1) cutIndex = Math.min(cutIndex, colonIndex);
    const head = line.slice(0, cutIndex);
    const matches = head.match(/`([a-z0-9_]+)`/gi) || [];
    for (const match of matches) {
      const name = match.replace(/`/g, '').trim();
      if (name) artifacts.add(name);
    }
  }
  const shardedMetaLine = text.split('\n').find((line) => line.includes('Sharded meta is defined for:')) || '';
  const shardedMatches = shardedMetaLine.match(/`([a-z0-9_]+)`/gi) || [];
  for (const match of shardedMatches) {
    const name = match.replace(/`/g, '').trim();
    if (name) artifacts.add(name);
  }
  const apiContractsMatch = text.match(/- `api_contracts`/);
  if (apiContractsMatch) artifacts.add('api_contracts');
  return artifacts;
};

const extractLaneMentions = (text, lanes) => {
  const found = new Set();
  for (const lane of lanes) {
    const escaped = lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRegex = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, 'i');
    if (tokenRegex.test(text)) found.add(lane);
  }
  return found;
};

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || ROOT);
  const outJsonPath = path.resolve(root, argv['out-json']);
  const outMdPath = path.resolve(root, argv['out-md']);

  const searchCliText = readText(path.join(root, 'docs', 'contracts', 'search-cli.md'));
  const searchContractText = readText(path.join(root, 'docs', 'contracts', 'search-contract.md'));
  const artifactSchemasText = readText(path.join(root, 'docs', 'contracts', 'artifact-schemas.md'));
  const runnerDocText = readText(path.join(root, 'docs', 'testing', 'test-runner-interface.md'));
  const regroupingDocText = readText(path.join(root, 'docs', 'testing', 'test-decomposition-regrouping.md'));

  const searchArgsText = readText(path.join(root, 'src', 'retrieval', 'cli-args.js'));
  const pipelineText = readText(path.join(root, 'src', 'retrieval', 'pipeline.js'));

  const searchOptionKeys = extractOptionsKeys(searchArgsText);
  const optionKeySet = new Set(searchOptionKeys);
  const searchFlags = new Set(searchOptionKeys.map((key) => `--${key}`));
  const aliasFlags = extractAliases(searchArgsText);
  for (const alias of aliasFlags) searchFlags.add(alias);
  for (const alias of aliasFlags) {
    const longForm = `--${alias.replace(/^-/, '')}`;
    if (!optionKeySet.has(alias.replace(/^-/, ''))) {
      searchFlags.delete(longForm);
    }
  }

  const docFlagsRaw = extractFlagsFromDoc(searchCliText);
  const docFlags = normalizeDocFlags(docFlagsRaw, searchFlags);

  const searchCliDiff = diffSets(searchFlags, docFlags);

  const contractFlagsRaw = extractFlagsFromDoc(searchContractText);
  const contractFlags = normalizeDocFlags(contractFlagsRaw, searchFlags);
  const searchContractDiff = diffSets(searchFlags, contractFlags);

  const artifactsSource = new Set(Object.keys(ARTIFACT_SCHEMA_DEFS));
  const artifactsDoc = extractArtifactsFromDoc(artifactSchemasText);
  const artifactDiff = diffSets(artifactsSource, artifactsDoc);

  const scoreKeysSource = extractScoreBreakdownKeysFromCode(pipelineText);
  const scoreKeysDoc = extractScoreBreakdownKeysFromDoc(searchContractText);
  const scoreDiff = diffSets(scoreKeysSource, scoreKeysDoc);

  const rules = readJsoncFile(path.join(root, 'tests', 'run.rules.jsonc'));
  const knownLanes = Array.isArray(rules?.knownLanes) ? rules.knownLanes : [];
  const runnerLanes = extractLaneMentions(runnerDocText, knownLanes);
  const regroupingLanes = extractLaneMentions(regroupingDocText, knownLanes);
  const runnerDiff = diffSets(new Set(knownLanes), runnerLanes);
  const regroupingDiff = diffSets(new Set(knownLanes), regroupingLanes);

  const checks = {
    searchCliFlags: {
      doc: 'docs/contracts/search-cli.md',
      source: 'src/retrieval/cli-args.js',
      sourceCount: searchFlags.size,
      docCount: docFlags.size,
      ...searchCliDiff
    },
    searchContractFlags: {
      doc: 'docs/contracts/search-contract.md',
      source: 'src/retrieval/cli-args.js',
      sourceCount: searchFlags.size,
      docCount: contractFlags.size,
      nonBlocking: true,
      ...searchContractDiff
    },
    artifactSchemas: {
      doc: 'docs/contracts/artifact-schemas.md',
      source: 'src/contracts/schemas/artifacts.js',
      sourceCount: artifactsSource.size,
      docCount: artifactsDoc.size,
      ...artifactDiff
    },
    scoreBreakdown: {
      doc: 'docs/contracts/search-contract.md',
      source: 'src/retrieval/pipeline.js',
      sourceCount: scoreKeysSource.size,
      docCount: scoreKeysDoc.size,
      ...scoreDiff
    },
    testRunnerLanes: {
      doc: 'docs/testing/test-runner-interface.md',
      source: 'tests/run.rules.jsonc',
      sourceCount: knownLanes.length,
      docCount: runnerLanes.size,
      ...runnerDiff
    },
    testRegroupingLanes: {
      doc: 'docs/testing/test-decomposition-regrouping.md',
      source: 'tests/run.rules.jsonc',
      sourceCount: knownLanes.length,
      docCount: regroupingLanes.size,
      ...regroupingDiff
    }
  };

  const hasDrift = Object.entries(checks).some(([name, check]) => {
    if (check.nonBlocking) return false;
    return (check.missingInDocs && check.missingInDocs.length)
      || (check.extraInDocs && check.extraInDocs.length);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    ok: !hasDrift,
    checks
  };

  const mdLines = [
    '# Doc Contract Drift',
    '',
    `Status: ${payload.ok ? 'OK' : 'DRIFT'}`,
    ''
  ];
  for (const [name, check] of Object.entries(checks)) {
    mdLines.push(`## ${name}`);
    mdLines.push(`- doc: ${check.doc}`);
    mdLines.push(`- source: ${check.source}`);
    if (check.nonBlocking) {
      mdLines.push('- note: non-blocking drift (informational)');
    }
    if (check.missingInDocs.length) {
      mdLines.push(`- missing in docs (${check.missingInDocs.length}): ${check.missingInDocs.slice(0, 10).join(', ')}`);
    } else {
      mdLines.push('- missing in docs: none');
    }
    if (check.extraInDocs.length) {
      mdLines.push(`- extra in docs (${check.extraInDocs.length}): ${check.extraInDocs.slice(0, 10).join(', ')}`);
    } else {
      mdLines.push('- extra in docs: none');
    }
    mdLines.push('');
  }

  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(outMdPath, `${mdLines.join('\n')}\n`);

  if (argv.fail && hasDrift) {
    process.exit(1);
  }
};

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
