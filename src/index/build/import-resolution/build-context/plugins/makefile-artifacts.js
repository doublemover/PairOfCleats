import path from 'node:path';
import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';
import { IMPORT_RESOLUTION_TRACE_STAGES } from '../../trace-model.js';

const MAKEFILE_BASENAME_RX = /^(?:gnu)?makefile(?:\.(?:am|in))?$/i;
const MAKEFILE_EXTENSION_RX = /\.(?:mk|mak)$/i;
const AUTOTOOLS_GENERATED_TARGETS = new Set([
  'aclocal.m4',
  'config.h',
  'config.log',
  'config.status',
  'configure',
  'makefile.in'
]);
const AUTOTOOLS_GENERATED_PREFIXES = [
  '.deps/',
  '.dirstamp',
  '.libs/',
  '.remake-',
  '.stamp-',
  'stamp-'
];

const normalizeImporterRel = (value) => String(value || '').replace(/\\/g, '/').trim();

const isMakefileFamilyImporter = (importerRel) => {
  const base = path.posix.basename(normalizeImporterRel(importerRel));
  return MAKEFILE_BASENAME_RX.test(base) || MAKEFILE_EXTENSION_RX.test(base);
};

const normalizeTarget = (value) => (
  typeof value === 'string'
    ? normalizeImportSpecifier(value)
    : ''
);

const isAutotoolsGeneratedTarget = (value) => {
  const normalized = normalizeTarget(value).toLowerCase();
  if (!normalized) return false;
  if (AUTOTOOLS_GENERATED_TARGETS.has(normalized)) return true;
  return AUTOTOOLS_GENERATED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

export const createMakefileArtifactsPlugin = () => Object.freeze({
  id: 'makefile-artifacts',
  priority: 16,
  fingerprint: 'v1',
  classify({ importerRel = '', spec = '', rawSpec = '' } = {}) {
    if (!isMakefileFamilyImporter(importerRel)) return null;
    const targetSpecifier = normalizeTarget(spec || rawSpec);
    if (!isAutotoolsGeneratedTarget(targetSpecifier)) return null;
    return {
      reasonCode: IMPORT_REASON_CODES.MAKEFILE_GENERATED_TARGET_MISSING,
      pluginId: 'makefile-artifacts',
      traceStage: IMPORT_RESOLUTION_TRACE_STAGES.GENERATED_ARTIFACT_INTERPRETATION,
      details: {
        importerFamily: 'makefile',
        target: targetSpecifier,
        artifactFamily: 'autotools_generated'
      }
    };
  }
});
