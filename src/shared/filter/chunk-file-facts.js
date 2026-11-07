import path from 'node:path';

export const resolveFilterExtension = chunk => chunk?.ext || path.extname(chunk?.file || '');
export const resolveFilterLanguage = chunk => {
  for (const value of [chunk?.metaV2?.lang, chunk?.metaV2?.effective?.languageId, chunk?.lang]) {
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return 'unknown';
};
