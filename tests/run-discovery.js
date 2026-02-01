import fsPromises from 'node:fs/promises';
import path from 'node:path';

export const splitCsv = (values) => values
  .flatMap((value) => String(value).split(','))
  .map((value) => value.trim())
  .filter(Boolean);

const normalizeSegments = (value) => value.split(path.sep).join('/');

const hasExcludedSegment = (relPath, excludedDirs) => {
  const parts = relPath.split('/');
  return parts.some((part) => excludedDirs.has(part));
};

const isExcludedFile = (relPath, excludedDirs, excludedFiles) => {
  if (hasExcludedSegment(relPath, excludedDirs)) return true;
  const base = path.basename(relPath);
  return excludedFiles.has(base);
};

export const discoverTests = async ({ testsDir, excludedDirs, excludedFiles }) => {
  const results = [];
  const walk = async (dir, relDir) => {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (hasExcludedSegment(relPath, excludedDirs)) continue;
        await walk(path.join(dir, entry.name), relPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      if (isExcludedFile(relPath, excludedDirs, excludedFiles)) continue;
      results.push({
        path: path.join(dir, entry.name),
        relPath
      });
    }
  };
  await walk(testsDir, '');
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results.map((entry) => ({
    ...entry,
    id: entry.relPath.replace(/\.js$/, ''),
    relPath: normalizeSegments(entry.relPath)
  }));
};

export const assignLane = (id, laneRules) => {
  for (const rule of laneRules) {
    if (rule.match.some((regex) => regex.test(id))) return rule.lane;
  }
  return 'integration';
};

export const buildTags = (id, lane, tagRules) => {
  const tags = new Set([lane]);
  for (const rule of tagRules) {
    if (rule.match.some((regex) => regex.test(id))) tags.add(rule.tag);
  }
  return Array.from(tags).sort();
};

const parseRegexLiteral = (raw) => {
  if (!raw.startsWith('/')) return null;
  const lastSlash = raw.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return {
    source: raw.slice(1, lastSlash),
    flags: raw.slice(lastSlash + 1)
  };
};

export const compileMatchers = (patterns, label) => {
  const matchers = [];
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern).trim();
    if (!pattern) continue;
    const literal = parseRegexLiteral(pattern);
    if (literal) {
      try {
        const regex = new RegExp(literal.source, literal.flags);
        matchers.push({ raw: pattern, test: (value) => regex.test(value) });
        continue;
      } catch (error) {
        console.error(`Invalid ${label} regex: ${pattern}`);
        console.error(String(error?.message || error));
        process.exit(2);
      }
    }
    const lowered = pattern.toLowerCase();
    matchers.push({ raw: pattern, test: (value) => value.toLowerCase().includes(lowered) });
  }
  return matchers;
};

const matchesAny = (value, matchers) => matchers.some((matcher) => matcher.test(value));

export const applyFilters = ({
  tests,
  lanes,
  includeMatchers,
  excludeMatchers,
  tagInclude,
  tagExclude,
  dropTags = []
}) => {
  let filtered = tests.filter((test) => lanes.has(test.lane));
  if (tagInclude.length) {
    filtered = filtered.filter((test) => tagInclude.some((tag) => test.tags.includes(tag)));
  }
  if (includeMatchers.length) {
    filtered = filtered.filter((test) => (
      matchesAny(test.id, includeMatchers) || matchesAny(test.relPath, includeMatchers)
    ));
  }
  if (excludeMatchers.length) {
    filtered = filtered.filter((test) => !(
      matchesAny(test.id, excludeMatchers) || matchesAny(test.relPath, excludeMatchers)
    ));
  }
  const dropSet = new Set(dropTags);
  if (dropSet.size && tagExclude.length) {
    filtered = filtered.filter((test) => !test.tags.some((tag) => dropSet.has(tag)));
  }
  const hasExcludedTag = (test) => tagExclude.some((tag) => !dropSet.has(tag) && test.tags.includes(tag));
  const skipped = tagExclude.length
    ? filtered.filter((test) => hasExcludedTag(test)).map((test) => ({
      ...test,
      presetStatus: 'skipped',
      skipReason: `excluded tag: ${test.tags.filter((tag) => tagExclude.includes(tag)).join(', ')}`
    }))
    : [];
  const selected = tagExclude.length
    ? filtered.filter((test) => !hasExcludedTag(test))
    : filtered;
  return { selected, skipped };
};

export const resolveLanes = (argvLanes, knownLanes) => {
  let raw = splitCsv(argvLanes.length ? argvLanes : ['ci']);
  if (raw.includes('all')) {
    raw = Array.from(knownLanes);
  }
  for (const lane of raw) {
    if (!knownLanes.has(lane)) {
      console.error(`Unknown lane: ${lane}`);
      process.exit(2);
    }
  }
  const resolved = new Set();
  for (const lane of raw) {
    if (lane === 'ci' || lane === 'ci-long') {
      resolved.add('unit');
      resolved.add('integration');
      resolved.add('services');
      continue;
    }
    resolved.add(lane);
  }
  return resolved;
};

export const listLanes = (runRules) => Array.from(runRules.knownLanes || []).sort();

export const listTags = (runRules) => {
  const tags = new Set();
  for (const rule of runRules.tagRules || []) {
    if (rule.tag) tags.add(rule.tag);
  }
  return Array.from(tags).sort();
};
