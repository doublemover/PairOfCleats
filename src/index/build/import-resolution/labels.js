import path from 'node:path';

const normalizePathText = (value) => String(value || '').replace(/\\/g, '/');

export const resolveRepoLabelFromReportPath = (reportPath, { unknownLabel = '<unknown>' } = {}) => {
  const normalized = normalizePathText(reportPath);
  if (!normalized) return unknownLabel;
  const parent = path.posix.basename(path.posix.dirname(normalized));
  return parent || unknownLabel;
};

export const resolveLanguageLabelFromImporter = (importer, { unknownLabel = 'unknown' } = {}) => {
  const normalized = normalizePathText(importer);
  if (!normalized) return unknownLabel;
  const ext = path.posix.extname(normalized).toLowerCase();
  if (!ext) return unknownLabel;
  return ext.slice(1) || unknownLabel;
};
