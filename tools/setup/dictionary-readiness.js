import fs from 'node:fs';
import path from 'node:path';

const isUsableFile = (file) => {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return false;
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch { return false; }
};

const isEmptyRegularFile = (file) => {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size === 0;
  } catch { return false; }
};

export const hasRequestedDictionaryAssets = (config) => (
  (config.languages?.length || 0) > 0 || (config.files?.length || 0) > 0
  || (config.includeSlang !== false && ((config.slangDirs?.length || 0) > 0 || (config.slangFiles?.length || 0) > 0))
  || config.enableRepoDictionary === true
);

/** Describe effective file readiness, without claiming language or segmentation quality. */
export const resolveDictionarySetupReadiness = ({ dictConfig, dictionaryPaths }) => {
  const applicable = hasRequestedDictionaryAssets(dictConfig);
  const usablePaths = [...new Set(dictionaryPaths || [])].filter(isUsableFile);
  const englishRequested = Array.isArray(dictConfig.languages) && dictConfig.languages.includes('en');
  const englishPath = path.join(dictConfig.dir, 'en.txt');
  const needsEnglish = englishRequested && !isUsableFile(englishPath);
  const present = applicable && usablePaths.length > 0 && !needsEnglish;
  return {
    applicable, present, usablePaths, englishRequested, needsEnglish,
    downloadableLanguages: needsEnglish ? ['en'] : [],
    replaceEmptyEnglish: needsEnglish && isEmptyRegularFile(englishPath),
    verificationLevel: present ? 'nonempty-readable-effective-files' : null,
    reason: !applicable || present ? null : needsEnglish ? 'Configured English dictionary is missing or unreadable.'
      : 'No usable configured dictionary files; no built-in download recipe is selected.'
  };
};
