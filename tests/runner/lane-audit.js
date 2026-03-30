import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { discoverTests } from './run-discovery.js';
import { loadRunRules } from './run-config.js';
import {
  loadLaneManifestConfig,
  loadOrderedLaneManifest
} from './lane-manifests.js';

const parseOrderFile = async (filePath) => {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

export const buildLaneAuditReport = async ({ root = process.cwd(), config } = {}) => {
  const laneConfig = config || await loadLaneManifestConfig({ root });
  const runRules = loadRunRules({ root });
  const discovered = await discoverTests({
    testsDir: path.join(root, 'tests'),
    excludedDirs: runRules.excludedDirs,
    excludedFiles: runRules.excludedFiles
  });
  const knownIds = new Set(discovered.map((entry) => entry.id));

  const lanes = [];
  const ownership = new Map();
  const duplicates = [];
  const missingIds = [];
  const manifestMismatches = [];
  const timingOverruns = [];

  for (const currentLane of laneConfig.orderedLanes.values()) {
    const orderIds = await parseOrderFile(currentLane.orderFilePath);
    const manifest = await loadOrderedLaneManifest({
      root,
      lane: currentLane.lane,
      config: laneConfig
    });
    const manifestIds = Array.isArray(manifest?.tests)
      ? manifest.tests.map((entry) => entry.id)
      : [];

    if (JSON.stringify(orderIds) !== JSON.stringify(manifestIds)) {
      manifestMismatches.push({
        lane: currentLane.lane,
        orderCount: orderIds.length,
        manifestCount: manifestIds.length
      });
    }

    for (const id of orderIds) {
      if (!knownIds.has(id)) {
        missingIds.push({ lane: currentLane.lane, id });
      }
      const existing = ownership.get(id);
      if (existing) {
        duplicates.push({ id, lanes: [existing, currentLane.lane] });
      } else {
        ownership.set(id, currentLane.lane);
      }
    }

    const targetMaxDurationMs = Number(currentLane.targetMaxDurationSeconds) * 1000;
    for (const entry of manifest?.tests || []) {
      if (!Number.isFinite(entry?.durationMs)) continue;
      if (entry.durationMs > targetMaxDurationMs) {
        timingOverruns.push({
          lane: currentLane.lane,
          id: entry.id,
          durationMs: entry.durationMs,
          targetMaxDurationMs
        });
      }
    }

    lanes.push({
      lane: currentLane.lane,
      totalTests: orderIds.length,
      missingIds: missingIds.filter((entry) => entry.lane === currentLane.lane).length,
      duplicates: duplicates.filter((entry) => entry.lanes.includes(currentLane.lane)).length,
      timingOverruns: timingOverruns.filter((entry) => entry.lane === currentLane.lane).length
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      lanes: lanes.length,
      missingIds: missingIds.length,
      duplicateIds: duplicates.length,
      manifestMismatches: manifestMismatches.length,
      timingOverruns: timingOverruns.length
    },
    lanes,
    missingIds,
    duplicates,
    manifestMismatches,
    timingOverruns
  };
};

export const formatLaneAuditReport = (report) => {
  const lines = [
    'Lane audit summary',
    `- lanes: ${report.summary.lanes}`,
    `- missing ids: ${report.summary.missingIds}`,
    `- duplicate ids: ${report.summary.duplicateIds}`,
    `- manifest mismatches: ${report.summary.manifestMismatches}`,
    `- timing overruns: ${report.summary.timingOverruns}`
  ];

  if (report.missingIds.length) {
    lines.push('', 'Missing ids:');
    for (const entry of report.missingIds) {
      lines.push(`- [${entry.lane}] ${entry.id}`);
    }
  }
  if (report.duplicates.length) {
    lines.push('', 'Duplicate ids:');
    for (const entry of report.duplicates) {
      lines.push(`- ${entry.id}: ${entry.lanes.join(', ')}`);
    }
  }
  if (report.manifestMismatches.length) {
    lines.push('', 'Manifest mismatches:');
    for (const entry of report.manifestMismatches) {
      lines.push(`- [${entry.lane}] order=${entry.orderCount} manifest=${entry.manifestCount}`);
    }
  }
  if (report.timingOverruns.length) {
    lines.push('', 'Timing overruns:');
    for (const entry of report.timingOverruns) {
      lines.push(`- [${entry.lane}] ${entry.id}: ${entry.durationMs}ms > ${entry.targetMaxDurationMs}ms`);
    }
  }

  return `${lines.join('\n')}\n`;
};
