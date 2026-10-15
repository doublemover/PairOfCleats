import { createRequire } from 'node:module';
import path from 'node:path';

export const resolveGrammarLanguageExport = (grammarModule, grammarSpec) => {
  const preferredKey = typeof grammarSpec?.exportKey === 'string' && grammarSpec.exportKey
    ? grammarSpec.exportKey
    : null;
  if (preferredKey && grammarModule?.[preferredKey]) {
    return { language: grammarModule[preferredKey], source: preferredKey };
  }

  const fallbackKeys = Array.isArray(grammarSpec?.fallbackExportKeys)
    ? grammarSpec.fallbackExportKeys
    : [];
  for (const key of fallbackKeys) {
    if (typeof key !== 'string' || !key) continue;
    if (grammarModule?.[key]) {
      return { language: grammarModule[key], source: key };
    }
  }

  if (grammarModule?.default) {
    return { language: grammarModule.default, source: 'default' };
  }

  if (preferredKey && grammarModule && typeof grammarModule === 'object') {
    return { language: grammarModule, source: 'module' };
  }

  if (!preferredKey) {
    return { language: grammarModule, source: null };
  }
  return { language: null, source: preferredKey };
};

export const normalizeLanguageBinding = (languageValue, grammarModule) => {
  if (languageValue?.default && languageValue.default !== languageValue) {
    const nested = normalizeLanguageBinding(languageValue.default, grammarModule);
    if (nested) return nested;
  }
  if (!languageValue || typeof languageValue !== 'object') return null;
  if (
    languageValue.nodeTypeInfo
    && (typeof languageValue.fieldIdForName === 'function' || typeof languageValue.name === 'string')
  ) {
    return languageValue;
  }
  if (languageValue.language && languageValue.nodeTypeInfo) return languageValue;
  if (grammarModule && grammarModule.nodeTypeInfo && languageValue === grammarModule.language) {
    return grammarModule;
  }
  return null;
};

export const loadGrammarModule = (grammarSpec, require) => {
  if (grammarSpec?.nodeGypBinding) {
    // Recent C# wrappers use top-level await to import a synchronous N-API
    // binding. Load that binding through the grammar's own declared loader,
    // preserving synchronous parser APIs and source-build/prebuild fallback.
    // Resolution stays anchored to this installed package, never the input repo.
    const packagePath = require.resolve(`${grammarSpec.moduleName}/package.json`);
    const grammarRequire = createRequire(packagePath);
    const binding = grammarRequire('node-gyp-build')(path.dirname(packagePath));
    binding.nodeTypeInfo = grammarRequire('./src/node-types.json');
    return binding;
  }
  if (grammarSpec?.prebuildBinary) {
    const prebuildId = `${process.platform}-${process.arch}`;
    const bindingPath = `${grammarSpec.moduleName}/prebuilds/${prebuildId}/${grammarSpec.prebuildBinary}`;
    try {
      const binding = require(bindingPath);
      try {
        binding.nodeTypeInfo = require(`${grammarSpec.moduleName}/src/node-types.json`);
      } catch {
        // ignore missing node-types metadata
      }
      return binding;
    } catch (prebuildErr) {
      try {
        return require(grammarSpec.moduleName);
      } catch (moduleErr) {
        if (moduleErr && typeof moduleErr === 'object' && moduleErr.cause == null) {
          moduleErr.cause = prebuildErr;
        }
        throw moduleErr;
      }
    }
  }
  return require(grammarSpec.moduleName);
};
