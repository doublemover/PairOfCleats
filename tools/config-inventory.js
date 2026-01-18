#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fdir } from 'fdir';
import { resolveToolRoot } from './dict-utils.js';

const root = resolveToolRoot();
const schemaPath = path.join(root, 'docs', 'config-schema.json');
const outputJsonPath = path.join(root, 'docs', 'config-inventory.json');
const outputMdPath = path.join(root, 'docs', 'config-inventory.md');

const PUBLIC_CONFIG_KEYS = new Set(['cache.root', 'quality']);
const PUBLIC_ENV_VARS = new Set(['PAIROFCLEATS_API_TOKEN']);
const PUBLIC_CLI_FLAGS = new Set([
  'repo',
  'mode',
  'quality',
  'watch',
  'top',
  'json',
  'explain',
  'filter',
  'backend',
  'host',
  'port'
]);
const PUBLIC_FLAG_SOURCES = new Set([
  'bin/pairofcleats.js',
  'src/shared/cli.js'
]);
const BUDGETS = {
  configKeys: 2,
  envVars: 1,
  cliFlags: 25
};

const shouldCheck = process.argv.includes('--check');

const normalizeType = (schema) => {
  if (!schema || typeof schema !== 'object') return null;
  if (Array.isArray(schema.type)) return schema.type.join('|');
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.enum)) return 'enum';
  return null;
};

const normalizeEnum = (schema) => {
  if (!schema || typeof schema !== 'object') return null;
  if (!Array.isArray(schema.enum)) return null;
  return schema.enum.map((value) => String(value));
};

const mergeEntry = (target, incoming) => {
  if (!target.type && incoming.type) target.type = incoming.type;
  if (!target.enum && incoming.enum) target.enum = incoming.enum;
  if (target.type && incoming.type && target.type !== incoming.type) {
    const parts = new Set(String(target.type).split('|'));
    String(incoming.type).split('|').forEach((part) => parts.add(part));
    target.type = Array.from(parts).join('|');
  }
  if (target.enum && incoming.enum) {
    const merged = new Set(target.enum);
    incoming.enum.forEach((value) => merged.add(value));
    target.enum = Array.from(merged);
  }
};

const collectSchemaEntries = (schema, prefix = '', entries = []) => {
  if (!schema || typeof schema !== 'object') return entries;
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : null;
  if (properties) {
    for (const [key, child] of Object.entries(properties)) {
      const pathKey = prefix ? `${prefix}.${key}` : key;
      entries.push({
        path: pathKey,
        type: normalizeType(child),
        enum: normalizeEnum(child)
      });
      collectSchemaEntries(child, pathKey, entries);
    }
  }
  const additional = schema.additionalProperties && typeof schema.additionalProperties === 'object'
    ? schema.additionalProperties
    : null;
  if (additional && additional.properties) {
    const pathKey = prefix ? `${prefix}.*` : '*';
    entries.push({
      path: pathKey,
      type: normalizeType(additional),
      enum: normalizeEnum(additional)
    });
    collectSchemaEntries(additional, pathKey, entries);
  }
  const items = schema.items && typeof schema.items === 'object' ? schema.items : null;
  if (items && items.properties) {
    const pathKey = prefix ? `${prefix}[]` : '[]';
    entries.push({
      path: pathKey,
      type: normalizeType(items),
      enum: normalizeEnum(items)
    });
    collectSchemaEntries(items, pathKey, entries);
  }
  return entries;
};

const getLeafEntries = (entries) => {
  const prefixes = new Set();
  for (const entry of entries) {
    const parts = entry.path.split('.');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
      prefixes.add(prefix);
    }
  }
  return entries.filter((entry) => !prefixes.has(entry.path));
};

const listSourceFiles = async () => {
  const files = await new fdir().withFullPaths().crawl(root).withPromise();
  return files.filter((filePath) => {
    if (!filePath.endsWith('.js')) return false;
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/node_modules/')) return false;
    if (normalized.includes('/.git/')) return false;
    if (normalized.includes('/benchmarks/repos/')) return false;
    if (normalized.includes('/benchmarks/cache/')) return false;
    return true;
  });
};

const findMatchingBrace = (source, startIndex) => {
  let depth = 0;
  let inString = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const extractOptionObjects = (source) => {
  const ranges = [];
  const patterns = [
    /\boptions\s*:\s*\{/g,
    /\.options\s*\(\s*\{/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const braceIndex = source.indexOf('{', match.index);
      if (braceIndex < 0) continue;
      const endIndex = findMatchingBrace(source, braceIndex);
      if (endIndex < 0) continue;
      ranges.push(source.slice(braceIndex, endIndex + 1));
      pattern.lastIndex = endIndex + 1;
    }
  }
  return ranges;
};

const extractStringArray = (source, name) => {
  const regex = new RegExp(`\\b${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm');
  const match = regex.exec(source);
  if (!match) return [];
  const body = match[1] || '';
  const values = new Set();
  const stringRegex = /['"]([^'"\\]+)['"]/g;
  let stringMatch;
  while ((stringMatch = stringRegex.exec(body)) !== null) {
    if (stringMatch[1]) values.add(stringMatch[1]);
  }
  return Array.from(values);
};

const extractTopLevelKeys = (objectText) => {
  const keys = new Set();
  let i = 1;
  const len = objectText.length;
  const skipWhitespace = () => {
    while (i < len && /\s/.test(objectText[i])) i += 1;
  };
  const skipComments = () => {
    while (i < len) {
      if (objectText[i] === '/' && objectText[i + 1] === '/') {
        i += 2;
        while (i < len && objectText[i] !== '\n') i += 1;
        continue;
      }
      if (objectText[i] === '/' && objectText[i + 1] === '*') {
        i += 2;
        while (i < len && !(objectText[i] === '*' && objectText[i + 1] === '/')) i += 1;
        i += 2;
        continue;
      }
      break;
    }
  };
  const parseString = (quote) => {
    let value = '';
    i += 1;
    while (i < len) {
      const ch = objectText[i];
      if (ch === '\\') {
        value += ch;
        i += 2;
        continue;
      }
      if (ch === quote) {
        i += 1;
        break;
      }
      value += ch;
      i += 1;
    }
    return value;
  };
  const parseIdentifier = () => {
    const start = i;
    if (!/[A-Za-z_$]/.test(objectText[i])) return null;
    i += 1;
    while (i < len && /[A-Za-z0-9_$]/.test(objectText[i])) i += 1;
    return objectText.slice(start, i);
  };
  const skipValue = () => {
    let depthBrace = 0;
    let depthBracket = 0;
    let depthParen = 0;
    let inString = null;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (; i < len; i += 1) {
      const ch = objectText[i];
      const next = objectText[i + 1];
      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }
      if (ch === '/' && next === '/') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === '\'' || ch === '`') {
        inString = ch;
        continue;
      }
      if (ch === '{') {
        depthBrace += 1;
        continue;
      }
      if (ch === '}') {
        if (depthBrace > 0) {
          depthBrace -= 1;
          continue;
        }
        return;
      }
      if (ch === '[') {
        depthBracket += 1;
        continue;
      }
      if (ch === ']') {
        if (depthBracket > 0) depthBracket -= 1;
        continue;
      }
      if (ch === '(') {
        depthParen += 1;
        continue;
      }
      if (ch === ')') {
        if (depthParen > 0) depthParen -= 1;
        continue;
      }
      if (depthBrace === 0 && depthBracket === 0 && depthParen === 0 && ch === ',') {
        i += 1;
        return;
      }
    }
  };

  while (i < len - 1) {
    skipWhitespace();
    skipComments();
    skipWhitespace();
    if (objectText[i] === '}') break;
    let key = null;
    if (objectText[i] === '"' || objectText[i] === '\'') {
      key = parseString(objectText[i]);
    } else {
      key = parseIdentifier();
    }
    skipWhitespace();
    skipComments();
    skipWhitespace();
    if (!key || objectText[i] !== ':') {
      i += 1;
      continue;
    }
    keys.add(key);
    i += 1;
    skipValue();
  }
  return Array.from(keys);
};

const buildInventory = async () => {
  const schemaRaw = await fs.readFile(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const entries = collectSchemaEntries(schema);
  const entryMap = new Map();
  for (const entry of entries) {
    if (!entry.path) continue;
    const existing = entryMap.get(entry.path);
    if (!existing) {
      entryMap.set(entry.path, { ...entry });
    } else {
      mergeEntry(existing, entry);
    }
  }
  const configEntries = Array.from(entryMap.values())
    .sort((a, b) => a.path.localeCompare(b.path));
  const configLeafEntries = getLeafEntries(configEntries);
  const topLevel = new Map();
  for (const entry of configEntries) {
    const rootKey = entry.path.split(/[.[\]]/)[0] || entry.path;
    topLevel.set(rootKey, (topLevel.get(rootKey) || 0) + 1);
  }

  const sourceFiles = await listSourceFiles();
  const envVarMap = new Map();
  const cliFlagMap = new Map();
  const cliFlagsByFile = new Map();
  const dynamicOptionFiles = new Set();

  for (const filePath of sourceFiles) {
    const relPath = path.relative(root, filePath).replace(/\\/g, '/');
    const source = await fs.readFile(filePath, 'utf8');

    const envMatches = source.match(/PAIROFCLEATS_[A-Z0-9_]+/g) || [];
    for (const match of envMatches) {
      if (!envVarMap.has(match)) envVarMap.set(match, new Set());
      envVarMap.get(match).add(relPath);
    }

    const optionObjects = extractOptionObjects(source);
    const fileFlags = new Set();
    for (const obj of optionObjects) {
      extractTopLevelKeys(obj).forEach((key) => fileFlags.add(key));
    }
    const boolFlags = extractStringArray(source, 'BOOLEAN_FLAGS');
    const stringFlags = extractStringArray(source, 'STRING_FLAGS');
    boolFlags.forEach((flag) => fileFlags.add(flag));
    stringFlags.forEach((flag) => fileFlags.add(flag));

    if ((source.includes('.options(') || source.includes('options:')) && fileFlags.size === 0) {
      dynamicOptionFiles.add(relPath);
    }

    if (fileFlags.size) {
      const sorted = Array.from(fileFlags).sort((a, b) => a.localeCompare(b));
      cliFlagsByFile.set(relPath, sorted);
      for (const flag of sorted) {
        if (!cliFlagMap.has(flag)) cliFlagMap.set(flag, new Set());
        cliFlagMap.get(flag).add(relPath);
      }
    }
  }

  const envVars = Array.from(envVarMap.entries())
    .map(([name, files]) => ({ name, files: Array.from(files).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const cliFlags = Array.from(cliFlagMap.entries())
    .map(([flag, files]) => ({ flag, files: Array.from(files).sort() }))
    .sort((a, b) => a.flag.localeCompare(b.flag));

  const cliFlagsByFileOutput = Array.from(cliFlagsByFile.entries())
    .map(([file, flags]) => ({ file, flags }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const publicFlagsDetected = new Set();
  for (const entry of cliFlagsByFileOutput) {
    if (!PUBLIC_FLAG_SOURCES.has(entry.file)) continue;
    entry.flags.forEach((flag) => publicFlagsDetected.add(flag));
  }

  const publicConfigLeafKeys = configLeafEntries
    .filter((entry) => PUBLIC_CONFIG_KEYS.has(entry.path))
    .map((entry) => entry.path)
    .sort();
  const unknownConfigLeafKeys = configLeafEntries
    .filter((entry) => !PUBLIC_CONFIG_KEYS.has(entry.path))
    .map((entry) => entry.path)
    .sort();

  const publicEnvVars = envVars
    .filter((entry) => PUBLIC_ENV_VARS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const unknownEnvVars = envVars
    .filter((entry) => !PUBLIC_ENV_VARS.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  const publicFlags = cliFlags
    .filter((entry) => PUBLIC_CLI_FLAGS.has(entry.flag))
    .map((entry) => entry.flag)
    .sort();
  const internalFlags = cliFlags
    .filter((entry) => !PUBLIC_CLI_FLAGS.has(entry.flag))
    .map((entry) => entry.flag)
    .sort();
  const unknownPublicFlags = Array.from(publicFlagsDetected)
    .filter((flag) => !PUBLIC_CLI_FLAGS.has(flag))
    .sort();

  const duplicatedFlags = cliFlags
    .filter((entry) => entry.files.length > 1)
    .map((entry) => ({
      flag: entry.flag,
      count: entry.files.length,
      files: entry.files
    }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));

  const inventory = {
    generatedAt: new Date().toISOString(),
    budgets: { ...BUDGETS },
    allowlists: {
      configKeys: Array.from(PUBLIC_CONFIG_KEYS).sort(),
      envVars: Array.from(PUBLIC_ENV_VARS).sort(),
      cliFlags: Array.from(PUBLIC_CLI_FLAGS).sort()
    },
    configSchema: {
      path: path.relative(root, schemaPath).replace(/\\/g, '/'),
      totalKeys: configEntries.length,
      leafKeys: configLeafEntries.length,
      topLevel: Array.from(topLevel.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => a.key.localeCompare(b.key))
    },
    configKeys: configEntries,
    configKeysPublic: publicConfigLeafKeys,
    configKeysUnknown: unknownConfigLeafKeys,
    envVars,
    envVarsPublic: publicEnvVars,
    envVarsUnknown: unknownEnvVars,
    cliFlags: {
      totalFlags: cliFlags.length,
      publicFlags,
      internalFlags,
      publicDetected: Array.from(publicFlagsDetected).sort(),
      publicUnknown: unknownPublicFlags,
      byFile: cliFlagsByFileOutput,
      duplicated: duplicatedFlags,
      dynamicOptionFiles: Array.from(dynamicOptionFiles).sort()
    }
  };

  await fs.writeFile(outputJsonPath, JSON.stringify(inventory, null, 2));

  const mdLines = [];
  mdLines.push('# Config Inventory');
  mdLines.push('');
  mdLines.push(`Generated: ${inventory.generatedAt}`);
  mdLines.push('');
  mdLines.push('This file is generated by `node tools/config-inventory.js`.');
  mdLines.push('See `docs/config-inventory-notes.md` for ownership and overlap analysis.');
  mdLines.push('');
  mdLines.push('## Summary');
  mdLines.push(`- Config keys: ${inventory.configSchema.totalKeys}`);
  mdLines.push(`- Config leaf keys: ${inventory.configSchema.leafKeys}`);
  mdLines.push(`- Public config keys: ${inventory.configKeysPublic.length}`);
  mdLines.push(`- Env vars: ${inventory.envVars.length}`);
  mdLines.push(`- Public env vars: ${inventory.envVarsPublic.length}`);
  mdLines.push(`- CLI flags: ${inventory.cliFlags.totalFlags}`);
  mdLines.push(`- Public CLI flags: ${inventory.cliFlags.publicFlags.length}`);
  mdLines.push('');
  mdLines.push('## Allowlist drift');
  mdLines.push('');
  mdLines.push(`- Unknown config keys: ${inventory.configKeysUnknown.length}`);
  mdLines.push(`- Unknown env vars: ${inventory.envVarsUnknown.length}`);
  mdLines.push(`- Unknown public CLI flags: ${inventory.cliFlags.publicUnknown.length}`);
  mdLines.push('');
  mdLines.push('## Config keys by top-level namespace');
  mdLines.push('');
  for (const entry of inventory.configSchema.topLevel) {
    mdLines.push(`- ${entry.key}: ${entry.count}`);
  }
  mdLines.push('');
  mdLines.push('## Env vars');
  mdLines.push('');
  if (inventory.envVars.length === 0) {
    mdLines.push('- (none)');
  } else {
    for (const entry of inventory.envVars) {
      mdLines.push(`- ${entry.name} (${entry.files.length} files)`);
    }
  }
  mdLines.push('');
  mdLines.push('## Public CLI flags');
  mdLines.push('');
  mdLines.push(inventory.cliFlags.publicFlags.length
    ? inventory.cliFlags.publicFlags.join(', ')
    : '(none)');
  mdLines.push('');
  mdLines.push('## Internal CLI flags');
  mdLines.push('');
  mdLines.push(inventory.cliFlags.internalFlags.length
    ? inventory.cliFlags.internalFlags.join(', ')
    : '(none)');
  mdLines.push('');
  mdLines.push('## CLI flags (duplicated across files)');
  mdLines.push('');
  if (inventory.cliFlags.duplicated.length === 0) {
    mdLines.push('- (none)');
  } else {
    for (const entry of inventory.cliFlags.duplicated) {
      mdLines.push(`- ${entry.flag} (${entry.count} files)`);
    }
  }
  mdLines.push('');
  mdLines.push('## CLI flags by file');
  mdLines.push('');
  for (const entry of inventory.cliFlags.byFile) {
    mdLines.push(`### ${entry.file}`);
    mdLines.push('');
    mdLines.push(entry.flags.length ? entry.flags.join(', ') : '(none)');
    mdLines.push('');
  }
  mdLines.push('## Config keys (full list)');
  mdLines.push('');
  mdLines.push('```');
  for (const entry of inventory.configKeys) {
    const type = entry.type ? ` (${entry.type})` : '';
    const enumValues = entry.enum && entry.enum.length ? ` enum=${entry.enum.join('|')}` : '';
    mdLines.push(`${entry.path}${type}${enumValues}`.trim());
  }
  mdLines.push('```');
  mdLines.push('');
  if (inventory.cliFlags.dynamicOptionFiles.length) {
    mdLines.push('## Notes');
    mdLines.push('');
    mdLines.push('Dynamic CLI options detected in these files; verify flags manually:');
    mdLines.push('');
    for (const file of inventory.cliFlags.dynamicOptionFiles) {
      mdLines.push(`- ${file}`);
    }
    mdLines.push('');
  }

  await fs.writeFile(outputMdPath, mdLines.join('\n'));

  if (shouldCheck) {
    const errors = [];
    if (unknownConfigLeafKeys.length) {
      errors.push(`Config keys not in allowlist: ${unknownConfigLeafKeys.join(', ')}`);
    }
    if (unknownEnvVars.length) {
      errors.push(`Env vars not in allowlist: ${unknownEnvVars.join(', ')}`);
    }
    if (unknownPublicFlags.length) {
      errors.push(`Public CLI flags not in allowlist: ${unknownPublicFlags.join(', ')}`);
    }
    if (publicConfigLeafKeys.length > BUDGETS.configKeys) {
      errors.push(`Public config keys exceed budget (${publicConfigLeafKeys.length}/${BUDGETS.configKeys}).`);
    }
    if (publicEnvVars.length > BUDGETS.envVars) {
      errors.push(`Public env vars exceed budget (${publicEnvVars.length}/${BUDGETS.envVars}).`);
    }
    if (PUBLIC_CLI_FLAGS.size > BUDGETS.cliFlags) {
      errors.push(`Public CLI flags exceed budget (${PUBLIC_CLI_FLAGS.size}/${BUDGETS.cliFlags}).`);
    }
    if (errors.length) {
      errors.forEach((msg) => console.error(`[config-budget] ${msg}`));
      process.exit(1);
    }
  }
};

await buildInventory();
