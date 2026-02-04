export const storageKey = 'pairofcleats.isometric.config';

export const mergeConfig = (base, override) => {
  if (!override || typeof override !== 'object') return base;
  const merged = { ...base, ...override };
  merged.layout = { ...(base.layout || {}), ...(override.layout || {}) };
  merged.controls = { ...(base.controls || {}), ...(override.controls || {}) };
  merged.colors = { ...(base.colors || {}), ...(override.colors || {}) };
  merged.scoring = { ...(base.scoring || {}), ...(override.scoring || {}) };
  merged.visuals = { ...(base.visuals || {}), ...(override.visuals || {}) };
  merged.assets = { ...(base.assets || {}), ...(override.assets || {}) };
  merged.performance = { ...(base.performance || {}), ...(override.performance || {}) };
  merged.performance.displayLimits = {
    ...(base.performance?.displayLimits || {}),
    ...(override.performance?.displayLimits || {})
  };
  merged.performance.drawCaps = {
    ...(base.performance?.drawCaps || {}),
    ...(override.performance?.drawCaps || {})
  };
  merged.performance.lod = {
    ...(base.performance?.lod || {}),
    ...(override.performance?.lod || {})
  };
  merged.performance.hud = {
    ...(base.performance?.hud || {}),
    ...(override.performance?.hud || {})
  };
  return merged;
};

export const loadDomConfig = () => {
  const map = JSON.parse(document.getElementById('map-data').textContent || '{}');
  let config = JSON.parse(document.getElementById('viewer-config').textContent || '{}');
  const dom = {
    app: document.getElementById('app'),
    selectionBody: document.getElementById('selection-body'),
    summary: document.getElementById('summary'),
    menuView: document.getElementById('menu-view'),
    menuEdges: document.getElementById('menu-edges'),
    menuControls: document.getElementById('menu-controls'),
    menuLayout: document.getElementById('menu-layout'),
    menuScore: document.getElementById('menu-score'),
    menuColors: document.getElementById('menu-colors'),
    menuColorMode: document.getElementById('menu-color-mode'),
    menuVisuals: document.getElementById('menu-visuals'),
    menuEffects: document.getElementById('menu-effects'),
    menuPerformance: document.getElementById('menu-performance'),
    menuActions: document.getElementById('menu-actions'),
    perfHud: document.getElementById('perf-hud')
  };

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      config = mergeConfig(config, JSON.parse(stored));
    }
  } catch (err) {
    // ignore storage failures
  }

  return { map, config, dom };
};
