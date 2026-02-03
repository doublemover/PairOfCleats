import fsSync from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import { parse as parseJsonc } from 'jsonc-parser';

const readJsonc = (filePath, fallback = {}) => {
  try {
    if (!fsSync.existsSync(filePath)) return fallback;
    const raw = fsSync.readFileSync(filePath, 'utf8');
    const parsed = parseJsonc(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const compileRegex = (pattern, label) => {
  const raw = String(pattern || '').trim();
  if (!raw) return null;
  try {
    return new RegExp(raw);
  } catch (error) {
    const message = error?.message || error;
    throw new Error(`Invalid ${label} regex: ${raw}\n${message}`);
  }
};

const compileMatchers = (patterns, label) => {
  if (!Array.isArray(patterns)) return [];
  const matchers = [];
  for (const pattern of patterns) {
    const regex = compileRegex(pattern, label);
    if (regex) matchers.push(regex);
  }
  return matchers;
};

const compileRules = (raw) => {
  const excludedDirs = new Set(Array.isArray(raw?.excludedDirs) ? raw.excludedDirs : []);
  const excludedFiles = new Set(Array.isArray(raw?.excludedFiles) ? raw.excludedFiles : []);
  const knownLanes = new Set(Array.isArray(raw?.knownLanes) ? raw.knownLanes : []);
  const laneRules = Array.isArray(raw?.laneRules)
    ? raw.laneRules
      .map((rule) => ({
        lane: rule?.lane,
        match: compileMatchers(rule?.match, `laneRules.${rule?.lane || 'unknown'}`)
      }))
      .filter((rule) => rule.lane && rule.match.length)
    : [];
  const tagRules = Array.isArray(raw?.tagRules)
    ? raw.tagRules
      .map((rule) => ({
        tag: rule?.tag,
        match: compileMatchers(rule?.match, `tagRules.${rule?.tag || 'unknown'}`)
      }))
      .filter((rule) => rule.tag && rule.match.length)
    : [];
  const outputIgnorePatterns = compileMatchers(raw?.outputIgnorePatterns, 'outputIgnorePatterns');
  return {
    excludedDirs,
    excludedFiles,
    knownLanes,
    laneRules,
    tagRules,
    outputIgnorePatterns
  };
};

export const loadRunConfig = ({ root, configPath } = {}) => {
  const resolved = configPath
    ? (isAbsolutePathNative(configPath) ? configPath : path.resolve(root || process.cwd(), configPath))
    : path.join(root || process.cwd(), 'tests', 'run.config.jsonc');
  return readJsonc(resolved, {});
};

export const loadRunRules = ({ root }) => {
  const rulesPath = path.join(root, 'tests', 'run.rules.jsonc');
  const raw = readJsonc(rulesPath, {});
  return compileRules(raw);
};
