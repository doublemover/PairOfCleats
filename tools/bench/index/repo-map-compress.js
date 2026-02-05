#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { stableOrder } from '../../../src/shared/order.js';
import { orderRepoMapEntries } from '../../../src/shared/order.js';
import { createRepoMapIterator } from '../../../src/index/build/artifacts/writers/repo-map.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const args = parseArgs();
const fileCount = Math.max(1, Number(args.files) || 1500);
const symbolsPerFile = Math.max(1, Number(args.symbols) || 40);
const dupFactor = Math.max(1, Number(args.dup) || 2);
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const buildChunks = () => {
  const chunks = [];
  for (let f = 0; f < fileCount; f += 1) {
    const file = `src/file-${String(f).padStart(5, '0')}.js`;
    for (let s = 0; s < symbolsPerFile; s += 1) {
      const base = {
        file,
        ext: '.js',
        name: `sym_${s}`,
        kind: 'FunctionDeclaration',
        docmeta: { signature: `(${s})` },
        startLine: s * 10 + 1,
        endLine: s * 10 + 2
      };
      for (let d = 0; d < dupFactor; d += 1) {
        chunks.push({ ...base });
      }
    }
  }
  return chunks;
};

const buildBaselineIterator = ({ chunks, fileRelations }) => {
  const fileExportMap = new Map();
  if (fileRelations && fileRelations.size) {
    for (const [file, relations] of fileRelations.entries()) {
      if (!Array.isArray(relations?.exports) || !relations.exports.length) continue;
      fileExportMap.set(file, new Set(relations.exports));
    }
  }
  return function* baselineIterator() {
    const grouped = new Map();
    for (const c of chunks) {
      if (!c?.name) continue;
      const exportsSet = fileExportMap.get(c.file) || null;
      const hasDefault = exportsSet ? exportsSet.has('default') : false;
      const exported = exportsSet
        ? exportsSet.has(c.name)
          || exportsSet.has('*')
          || (hasDefault && (
            c.name === 'default'
            || c.name === 'module.exports'
            || (typeof c.kind === 'string' && c.kind.startsWith('ExportDefault'))
          ))
        : false;
      const entry = {
        file: c.file,
        ext: c.ext,
        name: c.name,
        kind: c.kind,
        signature: c.docmeta?.signature || null,
        startLine: c.startLine,
        endLine: c.endLine,
        exported
      };
      const fileKey = String(entry.file || '');
      const nameKey = String(entry.name || '');
      const kindKey = String(entry.kind || '');
      const groupKey = `${fileKey}\u0000${nameKey}\u0000${kindKey}`;
      let group = grouped.get(groupKey);
      if (!group) {
        group = { file: fileKey, name: nameKey, kind: kindKey, entries: [], seen: new Set() };
        grouped.set(groupKey, group);
      }
      const dedupeKey = [
        fileKey,
        nameKey,
        kindKey,
        entry.signature == null ? '' : String(entry.signature),
        Number.isFinite(entry.startLine) ? entry.startLine : ''
      ].join('::');
      if (group.seen.has(dedupeKey)) continue;
      group.seen.add(dedupeKey);
      group.entries.push(entry);
    }
    const groups = stableOrder(Array.from(grouped.values()), [
      (group) => group.file,
      (group) => group.name,
      (group) => group.kind
    ]);
    for (const group of groups) {
      const orderedEntries = orderRepoMapEntries(group.entries);
      for (const entry of orderedEntries) yield entry;
    }
  };
};

const chunks = buildChunks();
const fileRelations = new Map();

const runIterator = (iteratorFn) => {
  const start = performance.now();
  let count = 0;
  for (const _entry of iteratorFn()) count += 1;
  const durationMs = performance.now() - start;
  const rowsPerSec = durationMs > 0 ? (count / (durationMs / 1000)) : 0;
  return { durationMs, count, rowsPerSec };
};

const printBaseline = (result) => {
  console.log(
    `[bench] baseline rows=${result.count} ms=${result.durationMs.toFixed(1)} rowsPerSec=${Math.round(result.rowsPerSec)}`
  );
};

const printCurrent = (result, baseline = null) => {
  const parts = [
    `rows=${result.count}`,
    `ms=${result.durationMs.toFixed(1)}`,
    `rowsPerSec=${Math.round(result.rowsPerSec)}`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] current ${parts.join(' ')}`);
};

let baseline = null;
if (mode !== 'current') {
  const baselineIterator = buildBaselineIterator({ chunks, fileRelations });
  baseline = runIterator(baselineIterator);
  printBaseline(baseline);
}
if (mode !== 'baseline') {
  const currentIterator = createRepoMapIterator({ chunks, fileRelations });
  const current = runIterator(currentIterator);
  printCurrent(current, baseline);
}

