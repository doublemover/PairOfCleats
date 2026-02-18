const toPosixLower = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
const pathHasSegment = (pathLower, segment) => new RegExp(`(^|/)${segment}(/|$)`).test(pathLower);

const isJsFamily = (ext) => new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']).has(ext);

const hasDynamicSegment = (pathLower) => /\[[^/\]]+\]/.test(pathLower);
const NEXT_APP_ROUTE_FILE_RX = /(^|\/)app\/(?:.+\/)?(page|layout|route|template|loading|error|not-found|default|head)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|mdx)$/i;
const NEXT_PAGES_ROUTE_FILE_RX = /(^|\/)pages\/.+\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|mdx)$/i;
const NEXT_CONFIG_FILE_RX = /(^|\/)next\.config\.(js|cjs|mjs|ts)$/i;
const hasNextSourceSignal = (sourceLower) => (
  sourceLower.includes("from 'next")
  || sourceLower.includes('from "next')
  || sourceLower.includes('next/link')
  || sourceLower.includes('next/router')
  || sourceLower.includes('next/navigation')
  || sourceLower.includes('next/head')
  || sourceLower.includes('next/image')
  || sourceLower.includes('next/server')
  || /\bnextpage\b/.test(sourceLower)
  || /\bgetstaticprops\b/.test(sourceLower)
  || /\bgetserversideprops\b/.test(sourceLower)
  || /\bgeneratestaticparams\b/.test(sourceLower)
);

const buildSignals = (pairs) => {
  const signals = {};
  for (const [key, value] of pairs) {
    if (value === true) signals[key] = true;
  }
  return signals;
};

export const detectFrameworkProfile = ({ relPath, ext, text = '' } = {}) => {
  const normalizedPath = toPosixLower(relPath);
  const normalizedExt = String(ext || '').toLowerCase();
  const source = String(text || '');
  const sourceLower = source.toLowerCase();
  const dynamicRoute = hasDynamicSegment(normalizedPath);

  if (normalizedExt === '.astro') {
    const signals = buildSignals([
      ['astroFrontmatterTemplateBridge', source.trimStart().startsWith('---')],
      ['astroIslandHydration', sourceLower.includes('client:')],
      ['astroRouteCollection', normalizedPath.includes('/src/pages/')],
      ['dynamicRoute', dynamicRoute]
    ]);
    return { id: 'astro', confidence: 'heuristic', signals };
  }

  if (normalizedExt === '.vue') {
    const isNuxt = pathHasSegment(normalizedPath, 'pages')
      || pathHasSegment(normalizedPath, 'layouts')
      || normalizedPath.includes('server/api/')
      || normalizedPath.includes('nuxt.config.');
    if (isNuxt) {
      const signals = buildSignals([
        ['nuxtPagesRouteParams', pathHasSegment(normalizedPath, 'pages') && dynamicRoute],
        ['nuxtServerRouteMapping', normalizedPath.includes('server/api/')],
        ['nuxtSfcStyleScope', sourceLower.includes('<style scoped')],
        ['dynamicRoute', dynamicRoute]
      ]);
      return { id: 'nuxt', confidence: 'heuristic', signals };
    }
    const signals = buildSignals([
      ['vueSfcScriptSetupBindings', sourceLower.includes('<script setup')],
      ['vueSfcScopedStyle', sourceLower.includes('<style scoped')],
      ['vueRouterDynamicParam', dynamicRoute],
      ['dynamicRoute', dynamicRoute]
    ]);
    return { id: 'vue', confidence: 'heuristic', signals };
  }

  if (normalizedExt === '.svelte') {
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
      ['svelteReactiveBinding', source.includes('$:')],
      ['svelteScopedStyle', sourceLower.includes('<style')]
    ]);
    return { id: 'svelte', confidence: 'heuristic', signals };
  }

  if (/\.(component|module|directive|pipe)\.(ts|html|scss|sass|css)$/.test(normalizedPath)
    || (normalizedPath.includes('src/app/') && (normalizedExt === '.ts' || normalizedExt === '.html'))) {
    const signals = buildSignals([
      ['angularInputOutputBinding', source.includes('@Input') || source.includes('@Output') || source.includes('[(ngModel)]')],
      ['angularRouteConfigLazy', source.includes('loadChildren')],
      ['angularTemplateStyleEncapsulation', source.includes('ViewEncapsulation') || source.includes('encapsulation:')],
      ['dynamicRoute', dynamicRoute]
    ]);
    return { id: 'angular', confidence: 'heuristic', signals };
  }

  if (isJsFamily(normalizedExt)) {
    const nextAppRouteFile = NEXT_APP_ROUTE_FILE_RX.test(normalizedPath);
    const nextPagesRouteFile = NEXT_PAGES_ROUTE_FILE_RX.test(normalizedPath);
    const nextConfigFile = NEXT_CONFIG_FILE_RX.test(normalizedPath);
    const nextSourceSignal = hasNextSourceSignal(sourceLower);
    const isNext = nextConfigFile
      || nextAppRouteFile
      || (nextPagesRouteFile && nextSourceSignal);
    if (isNext) {
      const signals = buildSignals([
        ['nextAppRouterDynamicSegment', nextAppRouteFile && dynamicRoute],
        ['nextClientServerBoundary', sourceLower.includes('"use client"') || sourceLower.includes("'use client'") || sourceLower.includes('"use server"') || sourceLower.includes("'use server'")],
        ['nextRouteHandlerRuntime', /(^|\/)app\/(?:.+\/)?route\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|mdx)$/.test(normalizedPath)],
        ['nextPagesRouterRoute', nextPagesRouteFile],
        ['nextConfigFile', nextConfigFile],
        ['dynamicRoute', dynamicRoute]
      ]);
      return { id: 'next', confidence: 'heuristic', signals };
    }
    if (normalizedExt === '.jsx' || normalizedExt === '.tsx' || sourceLower.includes('react')) {
      const signals = buildSignals([
        ['reactRouteDynamic', dynamicRoute],
        ['reactHydrationBoundary', sourceLower.includes('hydrate') || sourceLower.includes('suspense')],
        ['reactCssModuleScope', normalizedPath.includes('.module.css') || sourceLower.includes('.module.css')],
        ['dynamicRoute', dynamicRoute]
      ]);
      return { id: 'react', confidence: 'heuristic', signals };
    }
  }

  return null;
};
