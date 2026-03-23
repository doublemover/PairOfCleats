import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createBenchDiagnosticClassifier } from './logging.js';

const DEFAULT_CANARY_ROOT = path.join(process.cwd(), 'tests', 'fixtures', 'bench-runtime-canaries');

export const resolveBenchRuntimeCanaryRoot = (root = process.cwd()) => (
  path.join(root, 'tests', 'fixtures', 'bench-runtime-canaries')
);

export const loadBenchRuntimeCanaryManifest = async (root = process.cwd()) => {
  const canaryRoot = resolveBenchRuntimeCanaryRoot(root);
  const manifestPath = path.join(canaryRoot, 'manifest.json');
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  return {
    canaryRoot,
    manifestPath,
    manifest
  };
};

export const loadBenchRuntimeCanaryFixture = async (entry, root = process.cwd()) => {
  const canaryRoot = resolveBenchRuntimeCanaryRoot(root);
  const filePath = path.join(canaryRoot, String(entry?.file || ''));
  const content = await fsPromises.readFile(filePath, 'utf8');
  return {
    filePath,
    content
  };
};

const toNonEmptyLines = (content) => String(content || '')
  .split(/\r?\n/u)
  .map((line) => line.trimEnd())
  .filter((line) => line.trim());

export const replayBenchRuntimeCanary = async (entry, root = process.cwd()) => {
  const { filePath, content } = await loadBenchRuntimeCanaryFixture(entry, root);
  const lines = toNonEmptyLines(content);
  const classifier = createBenchDiagnosticClassifier();
  const signals = [];
  const eventTypes = new Set();
  const failureClasses = new Set();

  for (const line of lines) {
    if (entry?.kind === 'structured-stream') {
      const parsed = JSON.parse(line);
      const classified = classifier.classify({ event: parsed, source: 'stream' });
      for (const signal of classified) {
        signals.push(signal);
        if (signal?.eventType) eventTypes.add(signal.eventType);
        if (signal?.failureClass) failureClasses.add(signal.failureClass);
      }
      continue;
    }
    if (entry?.kind === 'log-fragment') {
      const classified = classifier.classify({ line, source: 'log' });
      for (const signal of classified) {
        signals.push(signal);
        if (signal?.eventType) eventTypes.add(signal.eventType);
        if (signal?.failureClass) failureClasses.add(signal.failureClass);
      }
    }
  }

  const requiredPatterns = Array.isArray(entry?.requiredPatterns) ? entry.requiredPatterns : [];
  const matchedPatterns = requiredPatterns.filter((pattern) => String(content).includes(String(pattern)));

  return {
    filePath,
    lineCount: lines.length,
    eventTypes: Array.from(eventTypes).sort((left, right) => left.localeCompare(right)),
    failureClasses: Array.from(failureClasses).sort((left, right) => left.localeCompare(right)),
    matchedPatterns,
    requiredPatterns,
    signals
  };
};

export const DEFAULT_BENCH_RUNTIME_CANARY_ROOT = DEFAULT_CANARY_ROOT;
