import { state } from './state.js';
import { storageKey } from './dom.js';
import {
  applyGlassSettings,
  updateExtraLights,
  updateFileOpacity,
  updateFlowGlow,
  updateFlowLights,
  updateFog,
  updateGridGlow,
  updateMemberOpacity,
  updateWireframes
} from './materials.js';
import { scheduleRebuild } from './rebuild.js';
import { renderSelectionDetails } from './selection.js';
import { clearGroup } from './scene-utils.js';

const getNested = (obj, path) => {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
};

const setNested = (obj, path, value) => {
  const parts = path.split('.');
  let current = obj;
  while (parts.length > 1) {
    const part = parts.shift();
    current[part] = current[part] || {};
    current = current[part];
  }
  current[parts[0]] = value;
};

const createToggle = (container, options) => {
  const wrapper = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = options.checked !== false;
  input.addEventListener('change', () => options.onChange(input.checked));
  wrapper.appendChild(input);
  if (options.swatch) wrapper.appendChild(options.swatch);
  const text = document.createElement('span');
  text.textContent = options.label;
  wrapper.appendChild(text);
  container.appendChild(wrapper);
};

const createSelect = (container, options) => {
  const wrapper = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = options.label;
  const select = document.createElement('select');
  select.style.flex = '1';
  options.options.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    select.appendChild(option);
  });
  select.value = options.value ?? options.defaultValue;
  select.addEventListener('change', () => {
    options.onChange(select.value);
  });
  wrapper.appendChild(text);
  wrapper.appendChild(select);
  container.appendChild(wrapper);
};

const createSlider = (container, options) => {
  const label = document.createElement('div');
  label.textContent = options.label;
  const row = document.createElement('div');
  row.className = 'slider-row';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step || 0.1);
  const currentValue = getNested(state.panelState, options.path);
  input.value = String(Number.isFinite(currentValue) ? currentValue : options.defaultValue);
  const valueLabel = document.createElement('div');
  valueLabel.className = 'value';
  const updateValue = () => {
    const raw = Number(input.value);
    const nextValue = Number.isFinite(raw) ? raw : options.defaultValue;
    setNested(state.panelState, options.path, nextValue);
    valueLabel.textContent = options.format ? options.format(nextValue) : String(nextValue);
    syncStateFromPanel();
    if (typeof options.onInput === 'function') {
      options.onInput(nextValue);
    }
    if (options.rebuild !== false) {
      scheduleRebuild(options.debounceMs);
    }
    persistPanelState();
  };
  input.addEventListener('input', updateValue);
  updateValue();
  row.appendChild(input);
  row.appendChild(valueLabel);
  container.appendChild(label);
  container.appendChild(row);
};

const createButton = (container, label, onClick) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  container.appendChild(button);
};

const persistPanelState = (() => {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const payload = {
        layout: state.panelState.layout,
        scoring: state.panelState.scoring,
        colors: state.panelState.colors,
        controls: state.panelState.controls,
        visuals: state.panelState.visuals
      };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch (err) {
        // ignore storage failures
      }
    }, 200);
  };
})();

export const syncStateFromPanel = () => {
  Object.assign(state.layout, state.panelState.layout || {});
  Object.assign(state.scoring, state.panelState.scoring || {});
  Object.assign(state.colors, state.panelState.colors || {});
  Object.assign(state.controls, state.panelState.controls || {});
  state.controls.wasd = { ...state.controls.wasd, ...(state.panelState.controls?.wasd || {}) };
  Object.assign(state.visuals, state.panelState.visuals || {});
  state.visuals.glass = { ...state.visuals.glass, ...(state.panelState.visuals?.glass || {}) };
  if (state.normalMapState?.texture) {
    state.normalMapState.texture.repeat.set(state.visuals.glass.normalRepeat, state.visuals.glass.normalRepeat);
  }
  updateExtraLights();
};

export const renderEdgeMenu = () => {
  const { dom, edgeTypes, edgeVisibility, edgeTypeGroups, visuals, visualDefaults } = state;
  dom.menuEdges.textContent = '';
  createToggle(dom.menuEdges, {
    label: 'Curve edges',
    checked: visuals.curveEdges ?? visualDefaults.curveEdges,
    onChange: (value) => {
      setNested(state.panelState, 'visuals.curveEdges', value);
      syncStateFromPanel();
      scheduleRebuild();
      persistPanelState();
    }
  });
  if (!edgeTypes.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No edges available';
    dom.menuEdges.appendChild(empty);
    return;
  }
  edgeTypes.forEach((type) => {
    const style = state.map.legend?.edgeStyles?.[type] || {};
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = style.color || '#9aa0a6';
    createToggle(dom.menuEdges, {
      label: type,
      swatch,
      checked: edgeVisibility.has(type)
        ? edgeVisibility.get(type)
        : edgeTypeGroups.get(type)?.visible !== false,
      onChange: (value) => {
        const group = edgeTypeGroups.get(type);
        if (group) group.visible = value;
        edgeVisibility.set(type, value);
      }
    });
  });
};

export const initUi = () => {
  const {
    dom,
    layout,
    scoring,
    controls,
    visuals,
    controlDefaults,
    layoutDefaults,
    scoringDefaults,
    colorDefaults,
    visualDefaults,
    colors,
    fileGroup,
    memberGroup,
    labelGroup,
    wireGroup,
    edgeGroup
  } = state;

  state.panelState = {
    layout: { ...layout },
    scoring: { ...scoring },
    colors: { ...colors },
    controls: { ...controls, wasd: { ...(controls.wasd || {}) } },
    visuals: { ...visuals, glass: { ...visuals.glass } }
  };

  state.edgeVisibility = state.edgeVisibility || new Map();
  state.gridVisible = state.gridVisible ?? true;

  createToggle(dom.menuView, {
    label: 'Grid',
    onChange: (value) => {
      state.gridVisible = value;
      if (state.grid) state.grid.visible = value;
      if (state.gridLines) state.gridLines.visible = value;
    }
  });
  createToggle(dom.menuView, {
    label: 'Files',
    onChange: (value) => {
      fileGroup.visible = value;
    }
  });
  createToggle(dom.menuView, {
    label: 'Members',
    onChange: (value) => {
      memberGroup.visible = value;
    }
  });
  createToggle(dom.menuView, {
    label: 'Labels',
    checked: false,
    onChange: (value) => {
      labelGroup.visible = value;
      if (value) {
        scheduleRebuild(0);
      } else {
        clearGroup(labelGroup);
        state.labelMaterials = [];
      }
    }
  });
  createToggle(dom.menuView, {
    label: 'Wireframes',
    onChange: (value) => {
      wireGroup.visible = value;
    }
  });
  createToggle(dom.menuView, {
    label: 'Edges',
    onChange: (value) => {
      edgeGroup.visible = value;
    }
  });

  createSlider(dom.menuControls, {
    label: 'Pan sensitivity',
    path: 'controls.panSensitivity',
    min: 0.2,
    max: 4,
    step: 0.1,
    defaultValue: controlDefaults.panSensitivity,
    rebuild: false
  });
  createSlider(dom.menuControls, {
    label: 'Zoom damping',
    path: 'controls.zoomDamping',
    min: 0.6,
    max: 0.98,
    step: 0.01,
    defaultValue: controlDefaults.zoomDamping,
    format: (value) => value.toFixed(2),
    rebuild: false
  });
  createSlider(dom.menuControls, {
    label: 'Zoom max',
    path: 'controls.zoomMax',
    min: 4,
    max: 120,
    step: 1,
    defaultValue: controlDefaults.zoomMax,
    rebuild: false
  });
  createSlider(dom.menuControls, {
    label: 'WASD sensitivity',
    path: 'controls.wasd.sensitivity',
    min: 100,
    max: 50000,
    step: 100,
    defaultValue: controlDefaults.wasd.sensitivity,
    rebuild: false
  });
  createSlider(dom.menuControls, {
    label: 'WASD accel',
    path: 'controls.wasd.acceleration',
    min: 100,
    max: 20000,
    step: 100,
    defaultValue: controlDefaults.wasd.acceleration,
    rebuild: false
  });
  createSlider(dom.menuControls, {
    label: 'WASD max',
    path: 'controls.wasd.maxSpeed',
    min: 100,
    max: 60000,
    step: 500,
    defaultValue: controlDefaults.wasd.maxSpeed,
    rebuild: false
  });
  createSlider(dom.menuControls, {
    label: 'WASD drag',
    path: 'controls.wasd.drag',
    min: 1,
    max: 20,
    step: 0.5,
    defaultValue: controlDefaults.wasd.drag,
    rebuild: false
  });

  createSelect(dom.menuLayout, {
    label: 'Layout style',
    value: getNested(state.panelState, 'layout.style'),
    defaultValue: layoutDefaults.style,
    options: [
      { label: 'Clustered', value: 'clustered' },
      { label: 'Flow', value: 'flow' },
      { label: 'Hex grid', value: 'hex' },
      { label: 'Radial', value: 'radial' },
      { label: 'Flat grid', value: 'flat' },
      { label: 'Stream', value: 'stream' }
    ],
    onChange: (value) => {
      setNested(state.panelState, 'layout.style', value);
      syncStateFromPanel();
      scheduleRebuild();
      persistPanelState();
    }
  });

  createSelect(dom.menuLayout, {
    label: 'File shapes',
    value: getNested(state.panelState, 'layout.fileShape'),
    defaultValue: layoutDefaults.fileShape,
    options: [
      { label: 'Category', value: 'category' },
      { label: 'Mixed', value: 'mix' },
      { label: 'Square', value: 'square' },
      { label: 'Circle', value: 'circle' },
      { label: 'Pyramid', value: 'pyramid' },
      { label: 'Pentagon', value: 'pentagon' },
      { label: 'Hexagon', value: 'hexagon' },
      { label: 'Heptagon', value: 'heptagon' },
      { label: 'Octagon', value: 'octagon' },
      { label: 'Pentagon pyramid', value: 'pentagon-pyramid' },
      { label: 'Hexagon pyramid', value: 'hexagon-pyramid' },
      { label: 'Heptagon pyramid', value: 'heptagon-pyramid' },
      { label: 'Octagon pyramid', value: 'octagon-pyramid' },
      { label: 'Pentagon frustum', value: 'pentagon-frustum' },
      { label: 'Hexagon frustum', value: 'hexagon-frustum' },
      { label: 'Heptagon frustum', value: 'heptagon-frustum' },
      { label: 'Octagon frustum', value: 'octagon-frustum' }
    ],
    onChange: (value) => {
      setNested(state.panelState, 'layout.fileShape', value);
      syncStateFromPanel();
      scheduleRebuild();
      persistPanelState();
    }
  });

  createSelect(dom.menuLayout, {
    label: 'Member shapes',
    value: getNested(state.panelState, 'layout.memberShape'),
    defaultValue: layoutDefaults.memberShape,
    options: [
      { label: 'Category', value: 'category' },
      { label: 'Mixed', value: 'mix' },
      { label: 'Square', value: 'square' },
      { label: 'Circle', value: 'circle' },
      { label: 'Pyramid', value: 'pyramid' },
      { label: 'Pentagon', value: 'pentagon' },
      { label: 'Hexagon', value: 'hexagon' },
      { label: 'Heptagon', value: 'heptagon' },
      { label: 'Octagon', value: 'octagon' },
      { label: 'Pentagon pyramid', value: 'pentagon-pyramid' },
      { label: 'Hexagon pyramid', value: 'hexagon-pyramid' },
      { label: 'Heptagon pyramid', value: 'heptagon-pyramid' },
      { label: 'Octagon pyramid', value: 'octagon-pyramid' },
      { label: 'Pentagon frustum', value: 'pentagon-frustum' },
      { label: 'Hexagon frustum', value: 'hexagon-frustum' },
      { label: 'Heptagon frustum', value: 'heptagon-frustum' },
      { label: 'Octagon frustum', value: 'octagon-frustum' }
    ],
    onChange: (value) => {
      setNested(state.panelState, 'layout.memberShape', value);
      syncStateFromPanel();
      scheduleRebuild();
      persistPanelState();
    }
  });

  createSlider(dom.menuLayout, {
    label: 'Group spacing',
    path: 'layout.groupSpacing',
    min: 0,
    max: 16,
    step: 0.5,
    defaultValue: layoutDefaults.groupSpacing
  });
  createSlider(dom.menuLayout, {
    label: 'File spacing',
    path: 'layout.fileSpacing',
    min: 0,
    max: 12,
    step: 0.5,
    defaultValue: layoutDefaults.fileSpacing
  });
  createSlider(dom.menuLayout, {
    label: 'Compactness',
    path: 'layout.compactness',
    min: 0.5,
    max: 1.4,
    step: 0.05,
    defaultValue: layoutDefaults.compactness
  });
  createSlider(dom.menuLayout, {
    label: 'Routing padding',
    path: 'layout.routingPadding',
    min: 0,
    max: 3,
    step: 0.1,
    defaultValue: layoutDefaults.routingPadding
  });
  createSlider(dom.menuLayout, {
    label: 'Routing step',
    path: 'layout.routingStep',
    min: 0.5,
    max: 5,
    step: 0.1,
    defaultValue: layoutDefaults.routingStep
  });
  createSlider(dom.menuLayout, {
    label: 'Edge plane',
    path: 'layout.edgePlane',
    min: -4,
    max: 0.5,
    step: 0.05,
    defaultValue: layoutDefaults.edgePlane
  });
  createSlider(dom.menuLayout, {
    label: 'Label size',
    path: 'layout.labelScale',
    min: 0.01,
    max: 0.04,
    step: 0.002,
    defaultValue: layoutDefaults.labelScale,
    format: (value) => value.toFixed(3)
  });
  createSlider(dom.menuLayout, {
    label: 'Label offset',
    path: 'layout.labelOffset',
    min: 0,
    max: 1.5,
    step: 0.05,
    defaultValue: layoutDefaults.labelOffset
  });

  createSlider(dom.menuScore, {
    label: 'Dataflow weight',
    path: 'scoring.dataflow',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: scoringDefaults.dataflow
  });
  createSlider(dom.menuScore, {
    label: 'Controlflow weight',
    path: 'scoring.controlFlow',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: scoringDefaults.controlFlow
  });
  createSlider(dom.menuScore, {
    label: 'Params weight',
    path: 'scoring.params',
    min: 0,
    max: 1.5,
    step: 0.05,
    defaultValue: scoringDefaults.params
  });
  createSlider(dom.menuScore, {
    label: 'Signature weight',
    path: 'scoring.signature',
    min: 0,
    max: 0.15,
    step: 0.01,
    defaultValue: scoringDefaults.signature,
    format: (value) => value.toFixed(2)
  });
  createSlider(dom.menuScore, {
    label: 'Exported boost',
    path: 'scoring.exported',
    min: 0,
    max: 3,
    step: 0.1,
    defaultValue: scoringDefaults.exported
  });
  createSlider(dom.menuScore, {
    label: 'Modifiers weight',
    path: 'scoring.modifiers',
    min: 0,
    max: 1.5,
    step: 0.05,
    defaultValue: scoringDefaults.modifiers
  });
  createSlider(dom.menuScore, {
    label: 'Type weight',
    path: 'scoring.type',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: scoringDefaults.type
  });
  createSlider(dom.menuScore, {
    label: 'Returns weight',
    path: 'scoring.returns',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: scoringDefaults.returns
  });

  createSlider(dom.menuColors, {
    label: 'Hue start',
    path: 'colors.hueStart',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: colorDefaults.hueStart,
    format: (value) => value.toFixed(2)
  });
  createSlider(dom.menuColors, {
    label: 'Hue end',
    path: 'colors.hueEnd',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: colorDefaults.hueEnd,
    format: (value) => value.toFixed(2)
  });
  createSlider(dom.menuColors, {
    label: 'Saturation',
    path: 'colors.saturation',
    min: 0.2,
    max: 1,
    step: 0.02,
    defaultValue: colorDefaults.saturation,
    format: (value) => value.toFixed(2)
  });
  createSlider(dom.menuColors, {
    label: 'Light min',
    path: 'colors.lightnessMin',
    min: 0.2,
    max: 0.8,
    step: 0.02,
    defaultValue: colorDefaults.lightnessMin,
    format: (value) => value.toFixed(2)
  });
  createSlider(dom.menuColors, {
    label: 'Light max',
    path: 'colors.lightnessMax',
    min: 0.3,
    max: 0.95,
    step: 0.02,
    defaultValue: colorDefaults.lightnessMax,
    format: (value) => value.toFixed(2)
  });

  createSelect(dom.menuColorMode, {
    label: 'Color mode',
    value: getNested(state.panelState, 'colors.mode'),
    defaultValue: colorDefaults.mode || 'score',
    options: [
      { label: 'Score gradient', value: 'score' },
      { label: 'Distinct (hash)', value: 'distinct' }
    ],
    onChange: (value) => {
      setNested(state.panelState, 'colors.mode', value);
      syncStateFromPanel();
      scheduleRebuild();
      persistPanelState();
    }
  });
  createSlider(dom.menuColorMode, {
    label: 'Distinct saturation',
    path: 'colors.distinctSaturation',
    min: 0.2,
    max: 1,
    step: 0.02,
    defaultValue: colorDefaults.distinctSaturation,
    format: (value) => value.toFixed(2)
  });
  createSlider(dom.menuColorMode, {
    label: 'Distinct lightness',
    path: 'colors.distinctLightness',
    min: 0.2,
    max: 0.85,
    step: 0.02,
    defaultValue: colorDefaults.distinctLightness,
    format: (value) => value.toFixed(2)
  });
  createSlider(dom.menuColorMode, {
    label: 'Distinct hue offset',
    path: 'colors.distinctHueOffset',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: colorDefaults.distinctHueOffset,
    format: (value) => value.toFixed(2)
  });

  createSlider(dom.menuVisuals, {
    label: 'File opacity',
    path: 'visuals.fileOpacity',
    min: 0.1,
    max: 1,
    step: 0.05,
    defaultValue: visualDefaults.fileOpacity,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateFileOpacity
  });
  createSlider(dom.menuVisuals, {
    label: 'Member opacity',
    path: 'visuals.memberOpacity',
    min: 0.1,
    max: 1,
    step: 0.05,
    defaultValue: visualDefaults.memberOpacity,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateMemberOpacity
  });
  createSlider(dom.menuVisuals, {
    label: 'Wireframe thickness',
    path: 'visuals.wireframeThickness',
    min: 0.01,
    max: 10,
    step: 0.02,
    defaultValue: visualDefaults.wireframeThickness,
    rebuild: false,
    onInput: updateWireframes
  });
  createSlider(dom.menuVisuals, {
    label: 'Wireframe glow',
    path: 'visuals.wireframeGlow',
    min: 0,
    max: 2.5,
    step: 0.05,
    defaultValue: visualDefaults.wireframeGlow,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateWireframes
  });
  createSlider(dom.menuVisuals, {
    label: 'Wire pulse speed',
    path: 'visuals.wirePulseSpeed',
    min: 0.02,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.wirePulseSpeed,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateWireframes
  });
  createSlider(dom.menuVisuals, {
    label: 'Flow glow base',
    path: 'visuals.flowGlowBase',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: visualDefaults.flowGlowBase,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateFlowGlow
  });
  createSlider(dom.menuVisuals, {
    label: 'Flow glow pulse',
    path: 'visuals.flowGlowRange',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: visualDefaults.flowGlowRange,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateFlowGlow
  });
  createSlider(dom.menuVisuals, {
    label: 'Glow speed',
    path: 'visuals.glowPulseSpeed',
    min: 0.4,
    max: 4,
    step: 0.1,
    defaultValue: visualDefaults.glowPulseSpeed,
    format: (value) => value.toFixed(1),
    rebuild: false
  });
  createSlider(dom.menuVisuals, {
    label: 'Glass roughness',
    path: 'visuals.glass.roughness',
    min: 0,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.glass.roughness,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Glass metalness',
    path: 'visuals.glass.metalness',
    min: 0,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.glass.metalness,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Glass transmission',
    path: 'visuals.glass.transmission',
    min: 0,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.glass.transmission,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Glass IOR',
    path: 'visuals.glass.ior',
    min: 1,
    max: 2.4,
    step: 0.02,
    defaultValue: visualDefaults.glass.ior,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Glass reflectivity',
    path: 'visuals.glass.reflectivity',
    min: 0,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.glass.reflectivity,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Glass thickness',
    path: 'visuals.glass.thickness',
    min: 0.1,
    max: 10,
    step: 0.1,
    defaultValue: visualDefaults.glass.thickness,
    format: (value) => value.toFixed(1),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Env intensity',
    path: 'visuals.glass.envMapIntensity',
    min: 0,
    max: 8,
    step: 0.1,
    defaultValue: visualDefaults.glass.envMapIntensity,
    format: (value) => value.toFixed(1),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Clearcoat',
    path: 'visuals.glass.clearcoat',
    min: 0,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.glass.clearcoat,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Clearcoat rough',
    path: 'visuals.glass.clearcoatRoughness',
    min: 0,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.glass.clearcoatRoughness,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Normal scale',
    path: 'visuals.glass.normalScale',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: visualDefaults.glass.normalScale,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Clearcoat normal',
    path: 'visuals.glass.clearcoatNormalScale',
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: visualDefaults.glass.clearcoatNormalScale,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: applyGlassSettings
  });
  createSlider(dom.menuVisuals, {
    label: 'Normal repeat',
    path: 'visuals.glass.normalRepeat',
    min: 1,
    max: 6,
    step: 1,
    defaultValue: visualDefaults.glass.normalRepeat,
    rebuild: false,
    onInput: applyGlassSettings
  });

  createToggle(dom.menuEffects, {
    label: 'Fog',
    checked: visuals.enableFog !== false,
    onChange: (value) => {
      setNested(state.panelState, 'visuals.enableFog', value);
      syncStateFromPanel();
      updateFog();
      persistPanelState();
    }
  });
  createToggle(dom.menuEffects, {
    label: 'Height fog',
    checked: visuals.enableHeightFog === true,
    onChange: (value) => {
      setNested(state.panelState, 'visuals.enableHeightFog', value);
      syncStateFromPanel();
      updateFog();
      persistPanelState();
    }
  });
  createSlider(dom.menuEffects, {
    label: 'Fog distance',
    path: 'visuals.fogDistance',
    min: 1.2,
    max: 4,
    step: 0.1,
    defaultValue: visualDefaults.fogDistance,
    format: (value) => value.toFixed(1),
    rebuild: false,
    onInput: () => updateFog()
  });
  createSlider(dom.menuEffects, {
    label: 'Fog height',
    path: 'visuals.fogHeight',
    min: 0,
    max: 40,
    step: 0.5,
    defaultValue: visualDefaults.fogHeight,
    format: (value) => value.toFixed(1),
    rebuild: false,
    onInput: () => updateFog()
  });
  createSlider(dom.menuEffects, {
    label: 'Fog height range',
    path: 'visuals.fogHeightRange',
    min: 4,
    max: 40,
    step: 0.5,
    defaultValue: visualDefaults.fogHeightRange,
    format: (value) => value.toFixed(1),
    rebuild: false,
    onInput: () => updateFog()
  });
  createToggle(dom.menuEffects, {
    label: 'Flow lights',
    checked: visuals.enableFlowLights !== false,
    onChange: (value) => {
      setNested(state.panelState, 'visuals.enableFlowLights', value);
      syncStateFromPanel();
      updateFlowLights();
      persistPanelState();
    }
  });
  createToggle(dom.menuEffects, {
    label: 'Extra lights',
    checked: visuals.enableExtraLights !== false,
    onChange: (value) => {
      setNested(state.panelState, 'visuals.enableExtraLights', value);
      syncStateFromPanel();
      updateExtraLights();
      persistPanelState();
    }
  });
  createSlider(dom.menuEffects, {
    label: 'Grid glow base',
    path: 'visuals.gridGlowBase',
    min: 0,
    max: 0.6,
    step: 0.02,
    defaultValue: visualDefaults.gridGlowBase,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateGridGlow
  });
  createSlider(dom.menuEffects, {
    label: 'Grid glow pulse',
    path: 'visuals.gridGlowRange',
    min: 0,
    max: 1,
    step: 0.02,
    defaultValue: visualDefaults.gridGlowRange,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateGridGlow
  });
  createSlider(dom.menuEffects, {
    label: 'Grid glow speed',
    path: 'visuals.gridPulseSpeed',
    min: 0.1,
    max: 1,
    step: 0.05,
    defaultValue: visualDefaults.gridPulseSpeed,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateGridGlow
  });
  createSlider(dom.menuEffects, {
    label: 'Grid line thickness',
    path: 'visuals.gridLineThickness',
    min: 0.02,
    max: 6,
    step: 0.05,
    defaultValue: visualDefaults.gridLineThickness,
    format: (value) => value.toFixed(2),
    rebuild: false,
    onInput: updateGridGlow
  });

  createButton(dom.menuActions, 'Save settings', () => {
    persistPanelState();
  });
  createButton(dom.menuActions, 'Reset to defaults', () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch (err) {
      // ignore storage failures
    }
    window.location.reload();
  });

  state.syncStateFromPanel = syncStateFromPanel;
  state.renderEdgeMenu = renderEdgeMenu;
  renderSelectionDetails(state.selected?.userData || null);
};
