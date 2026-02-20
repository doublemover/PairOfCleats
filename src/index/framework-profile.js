const toPosixLower = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
const pathHasSegment = (pathLower, segment) => new RegExp(`(^|/)${segment}(/|$)`).test(pathLower);

const JS_FAMILY_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const isJsFamily = (ext) => JS_FAMILY_EXTS.has(ext);

const hasDynamicSegment = (pathLower) => /\[[^/\]]+\]/.test(pathLower);
const NEXT_APP_ROUTE_FILE_RX = /(^|\/)app\/(?:.+\/)?(page|layout|route|template|loading|error|not-found|default|head)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|mdx)$/i;
const NEXT_PAGES_ROUTE_FILE_RX = /(^|\/)pages\/.+\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|mdx)$/i;
const NEXT_CONFIG_FILE_RX = /(^|\/)next\.config\.(js|cjs|mjs|ts)$/i;
const NEXT_IMPORT_SIGNAL_RX = /\bfrom\s+['"]next(?:\/[^'"]*)?['"]|\brequire\(\s*['"]next(?:\/[^'"]*)?['"]\s*\)|\bimport\(\s*['"]next(?:\/[^'"]*)?['"]\s*\)/i;
const hasNextDirectiveSignal = (source) => {
  const text = typeof source === 'string' ? source : String(source || '');
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (text.startsWith('//', cursor)) {
      const nextBreak = text.indexOf('\n', cursor + 2);
      if (nextBreak < 0) return false;
      cursor = nextBreak + 1;
      continue;
    }
    if (text.startsWith('/*', cursor)) {
      const blockEnd = text.indexOf('*/', cursor + 2);
      if (blockEnd < 0) return false;
      cursor = blockEnd + 2;
      continue;
    }
    break;
  }
  return /^['"]use\s+(?:client|server)['"]\s*;?/i.test(text.slice(cursor));
};
const hasNextSourceSignal = (source, getSourceLower) => {
  if (NEXT_IMPORT_SIGNAL_RX.test(source) || hasNextDirectiveSignal(source)) return true;
  const sourceLower = getSourceLower();
  return /\bnextpage\b/.test(sourceLower)
    || /\bgetstaticprops\b/.test(sourceLower)
    || /\bgetserversideprops\b/.test(sourceLower)
    || /\bgeneratestaticparams\b/.test(sourceLower);
};

const buildSignals = (pairs) => {
  const signals = {};
  for (const [key, value] of pairs) {
    if (value === true) signals[key] = true;
  }
  return signals;
};

/**
 * Infer framework profile from path/ext/source heuristics.
 *
 * Path-only signals are intentionally gated for ambiguous frameworks (notably Next.js)
 * to avoid mislabeling repos that use common directory names like `app/` or `pages/`.
 *
 * @param {{relPath?:string,ext?:string,text?:string}} [input]
 * @returns {{id:string,confidence:'heuristic',signals:Record<string,boolean>}|null}
 */
export const detectFrameworkProfile = ({ relPath, ext, text = '' } = {}) => {
  const normalizedPath = toPosixLower(relPath);
  const normalizedExt = String(ext || '').toLowerCase();
  let source = null;
  let sourceLower = null;
  const getSource = () => {
    if (typeof source === 'string') return source;
    source = typeof text === 'string' ? text : String(text || '');
    return source;
  };
  const getSourceLower = () => {
    if (typeof sourceLower === 'string') return sourceLower;
    sourceLower = getSource().toLowerCase();
    return sourceLower;
  };
  const dynamicRoute = hasDynamicSegment(normalizedPath);

  if (normalizedExt === '.astro') {
    const sourceText = getSource();
    const sourceTextLower = getSourceLower();
    const signals = buildSignals([
      ['astroFrontmatterTemplateBridge', sourceText.trimStart().startsWith('---')],
      ['astroIslandHydration', sourceTextLower.includes('client:')],
      ['astroRouteCollection', normalizedPath.includes('/src/pages/')],
      ['dynamicRoute', dynamicRoute]
    ]);
    return { id: 'astro', confidence: 'heuristic', signals };
  }

  if (normalizedExt === '.vue') {
    const sourceTextLower = getSourceLower();
    const isNuxt = pathHasSegment(normalizedPath, 'pages')
      || pathHasSegment(normalizedPath, 'layouts')
      || normalizedPath.includes('server/api/')
      || normalizedPath.includes('nuxt.config.');
    if (isNuxt) {
      const signals = buildSignals([
        ['nuxtPagesRouteParams', pathHasSegment(normalizedPath, 'pages') && dynamicRoute],
        ['nuxtServerRouteMapping', normalizedPath.includes('server/api/')],
        ['nuxtSfcStyleScope', sourceTextLower.includes('<style scoped')],
        ['dynamicRoute', dynamicRoute]
      ]);
      return { id: 'nuxt', confidence: 'heuristic', signals };
    }
    const signals = buildSignals([
      ['vueSfcScriptSetupBindings', sourceTextLower.includes('<script setup')],
      ['vueSfcScopedStyle', sourceTextLower.includes('<style scoped')],
      ['vueRouterDynamicParam', dynamicRoute],
      ['dynamicRoute', dynamicRoute]
    ]);
    return { id: 'vue', confidence: 'heuristic', signals };
  }

  if (normalizedExt === '.svelte') {
    const sourceText = getSource();
    const sourceTextLower = getSourceLower();
    const isSvelteKit = normalizedPath.includes('src/routes/')
      || /\/(\+page|\+layout|\+error|\+server)(\.[a-z0-9._-]+)?$/i.test(normalizedPath);
    if (isSvelteKit) {
      const signals = buildSignals([
        ['sveltekitLoadDataBinding', /\/(\+page|\+layout)(\.[a-z0-9._-]+)?$/i.test(normalizedPath)],
        ['sveltekitRouteParam', dynamicRoute],
        ['sveltekitServerActionRoute', /\/(\+server|\+page\.server)(\.[a-z0-9._-]+)?$/i.test(normalizedPath)],
        ['dynamicRoute', dynamicRoute]
      ]);
      return { id: 'sveltekit', confidence: 'heuristic', signals };
    }
    const signals = buildSignals([
      ['svelteReactiveBinding', sourceText.includes('$:')],
      ['svelteScopedStyle', sourceTextLower.includes('<style')]
    ]);
    return { id: 'svelte', confidence: 'heuristic', signals };
  }

  if (/\.(component|module|directive|pipe)\.(ts|html|scss|sass|css)$/.test(normalizedPath)
    || (normalizedPath.includes('src/app/') && (normalizedExt === '.ts' || normalizedExt === '.html'))) {
    const sourceText = getSource();
    const signals = buildSignals([
      ['angularInputOutputBinding', sourceText.includes('@Input') || sourceText.includes('@Output') || sourceText.includes('[(ngModel)]')],
      ['angularRouteConfigLazy', sourceText.includes('loadChildren')],
      ['angularTemplateStyleEncapsulation', sourceText.includes('ViewEncapsulation') || sourceText.includes('encapsulation:')],
      ['dynamicRoute', dynamicRoute]
    ]);
    return { id: 'angular', confidence: 'heuristic', signals };
  }

  if (isJsFamily(normalizedExt)) {
    const sourceText = getSource();
    const nextAppRouteFile = NEXT_APP_ROUTE_FILE_RX.test(normalizedPath);
    const nextPagesRouteFile = NEXT_PAGES_ROUTE_FILE_RX.test(normalizedPath);
    const nextConfigFile = NEXT_CONFIG_FILE_RX.test(normalizedPath);
    const nextSourceSignal = hasNextSourceSignal(sourceText, getSourceLower);
    // Require source-level Next signals for route-like paths to avoid broad false positives
    // in non-Next repos that happen to use app/pages directory names.
    const isNext = nextConfigFile
      || ((nextAppRouteFile || nextPagesRouteFile) && nextSourceSignal);
    if (isNext) {
      const sourceTextLower = getSourceLower();
      const signals = buildSignals([
        ['nextAppRouterDynamicSegment', nextAppRouteFile && dynamicRoute],
        ['nextClientServerBoundary', sourceTextLower.includes('"use client"') || sourceTextLower.includes("'use client'") || sourceTextLower.includes('"use server"') || sourceTextLower.includes("'use server'")],
        ['nextRouteHandlerRuntime', /(^|\/)app\/(?:.+\/)?route\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|mdx)$/.test(normalizedPath)],
        ['nextPagesRouterRoute', nextPagesRouteFile],
        ['nextConfigFile', nextConfigFile],
        ['dynamicRoute', dynamicRoute]
      ]);
      return { id: 'next', confidence: 'heuristic', signals };
    }
    if (normalizedExt === '.jsx' || normalizedExt === '.tsx' || getSourceLower().includes('react')) {
      const sourceTextLower = getSourceLower();
      const signals = buildSignals([
        ['reactRouteDynamic', dynamicRoute],
        ['reactHydrationBoundary', sourceTextLower.includes('hydrate') || sourceTextLower.includes('suspense')],
        ['reactCssModuleScope', normalizedPath.includes('.module.css') || sourceTextLower.includes('.module.css')],
        ['dynamicRoute', dynamicRoute]
      ]);
      return { id: 'react', confidence: 'heuristic', signals };
    }
  }

  return null;
};
