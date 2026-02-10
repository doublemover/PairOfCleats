import { mergeConfig } from '../../../shared/config.js';

export const storageKey = 'pairofcleats.isometric.config';

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
