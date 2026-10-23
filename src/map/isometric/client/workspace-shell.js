import { createViewerShellLifetime } from './workspace-shell-lifetime.js';

/** Existing controls move into one active task surface. Every mutation and
 * callback remains scoped to the original shell publication until retirement. */
export const initViewerShell = (state, document) => {
  const existing = state.viewerShell;
  if (existing) return existing;
  const lifetime = createViewerShellLifetime(state), { step, wrap, undo } = lifetime;
  let active = null, pinned = false, opener = null, inspectDismissed = false, settingsOwner = null, settingsSession = null;
  let settingsCaptured = false;
  let app, bar, menu, inspector, status, title, panels, triggers;
  const properties = new Map();
  const property = (target, name, value) => {
    let records = properties.get(target);
    if (!records) { records = new Map(); properties.set(target, records); }
    let record = records.get(name);
    if (!record) {
      record = { original: step(() => target[name]), last: value }; records.set(name, record);
      undo(() => { if (lifetime.canRestore() && target[name] === record.last) target[name] = record.original; });
    }
    record.last = value; step(() => { target[name] = value; });
  };
  const ownNode = (node, parent, prepend = false) => {
    const remove = step(() => parent.removeChild), append = step(() => prepend ? parent.prepend : parent.append);
    undo(() => { if (lifetime.canRestore() && node.parentNode === parent) Reflect.apply(remove, parent, [node]); });
    step(() => Reflect.apply(append, parent, [node]));
  };
  const button = (label, action) => {
    const node = step(() => document.createElement('button')), callback = wrap(action);
    node.type = 'button'; node.textContent = label;
    undo(() => { if (node.onclick === callback) node.onclick = null; });
    step(() => { node.onclick = callback; });
    return node;
  };
  const choose = (name, { focus = false } = {}) => {
    if (lifetime.retired) return false;
    active = name; property(menu, 'hidden', !name || name === 'Inspect'); property(inspector, 'hidden', name !== 'Inspect');
    step(() => { title.textContent = name || ''; });
    for (const [task, panel] of Object.entries(panels)) step(() => { panel.hidden = task !== name; });
    for (const [task, trigger] of triggers) step(() => trigger.setAttribute('aria-expanded', String(task === name)));
    const invalidate = step(() => state.invalidateRender);
    if (invalidate != null && typeof invalidate !== 'function') throw new TypeError('Viewer shell invalidate callback must be a function.');
    if (invalidate) step(() => Reflect.apply(invalidate, state, []));
    if (focus) step(() => {
      const target = name === 'Explore' ? document.getElementById('stack-search') : name === 'Inspect' ? inspector : panels[name];
      target?.focus?.({ preventScroll: true });
    });
    return true;
  };
  const close = () => {
    if (lifetime.retired) return;
    const host = active === 'Inspect' ? inspector : menu, restore = host.contains(document.activeElement);
    if (active === 'Inspect') inspectDismissed = true;
    choose(null); if (restore) step(() => opener?.focus?.({ preventScroll: true }));
  };
  const shell = Object.freeze({
    choose: (...args) => lifetime.retired ? false : lifetime.invoke(() => choose(...args)) ?? false,
    close: () => lifetime.invoke(close), dispose: lifetime.dispose,
    setSaveStatus: value => lifetime.invoke(() => { status.textContent = value; }),
    get active() { return active; }, get retired() { return lifetime.retired; },
    get retirementFailures() { return lifetime.failures; }, get pendingOwners() { return lifetime.pendingOwners; },
    get resourceOwner() { return lifetime.owner; },
    adoptSettings(session) {
      if (settingsCaptured && settingsSession !== session) throw new Error('Viewer shell already owns its original settings session.');
      if (!settingsCaptured) {
        settingsCaptured = true; settingsSession = session;
        settingsOwner = lifetime.resource(session, 'original viewer shell settings session');
      }
      try { settingsOwner.assertCaptured(); }
      catch (error) { lifetime.retain(error); lifetime.owner.retainFailure(error); throw error; }
      let current;
      try { current = lifetime.isCurrent(); }
      catch (error) { lifetime.retain(error); lifetime.dispose(); throw error; }
      if (!current) { lifetime.dispose(); lifetime.adoptRetired(settingsOwner); return false; }
      return true;
    }
  });
  return lifetime.construct(shell, () => {
    const view = step(() => document.defaultView);
    lifetime.listen(view, 'pagehide', lifetime.dispose, { once: true });
    app = step(() => document.getElementById('app')); bar = step(() => document.getElementById('stack-bar'));
    menu = step(() => document.getElementById('menu')); inspector = step(() => document.getElementById('hud'));
    const scope = step(() => document.getElementById('summary')), scopeParent = scope.parentNode, scopeNext = scope.nextSibling;
    const insertScope = step(() => scopeParent.insertBefore), scopeClasses = scope.classList;
    const hadScopeClass = step(() => scopeClasses.contains('viewer-scope-chip')), removeScopeClass = step(() => scopeClasses.remove);
    undo(() => {
      if (!lifetime.canRestore()) return;
      if (!hadScopeClass) Reflect.apply(removeScopeClass, scopeClasses, ['viewer-scope-chip']);
    });
    undo(() => {
      if (lifetime.canRestore() && scope.parentNode === bar) Reflect.apply(insertScope, scopeParent, [scope, scopeNext?.parentNode === scopeParent ? scopeNext : null]);
    });
    step(() => scopeClasses.add('viewer-scope-chip')); step(() => bar.append(scope));
    const surface = step(() => document.createElement('div')); surface.className = 'viewer-task-content';
    const heading = step(() => document.createElement('div')); heading.className = 'viewer-task-heading';
    title = step(() => document.createElement('strong')); status = step(() => document.createElement('div'));
    status.id = 'viewer-save-status'; status.setAttribute('role', 'status'); status.textContent = 'Session settings';
    panels = { Explore: document.createElement('section'), Appearance: document.createElement('section'), Performance: document.createElement('section') };
    const movable = step(() => [...menu.childNodes]), insertMenu = step(() => menu.insertBefore), removeMenu = step(() => menu.removeChild);
    undo(() => {
      if (!lifetime.canRestore()) return;
      for (const node of [heading, surface, status]) if (node.parentNode === menu) Reflect.apply(removeMenu, menu, [node]);
      let anchor = null;
      for (const node of [...movable].reverse()) {
        if (node.parentNode === menu || Object.values(panels).includes(node.parentNode)) {
          Reflect.apply(insertMenu, menu, [node, anchor]); anchor = node;
        }
      }
    });
    for (const node of movable) {
      const ids = node.nodeType === 1 ? [node.id, ...[...node.querySelectorAll('[id]')].map(child => child.id)] : [];
      const task = ids.some(id => ['menu-visuals', 'menu-effects', 'menu-actions', 'menu-score', 'menu-colors', 'menu-color-mode'].includes(id)) ? 'Appearance'
        : ids.some(id => ['menu-performance', 'menu-controls'].includes(id)) ? 'Performance' : 'Explore';
      step(() => panels[task].append(node));
    }
    step(() => menu.replaceChildren(heading, surface, status));
    for (const panel of Object.values(panels)) { panel.hidden = true; step(() => surface.append(panel)); }
    triggers = new Map();
    step(() => heading.append(title, button('Close panel', close), button('Pin panel', event => {
      pinned = !pinned; event.currentTarget.setAttribute('aria-pressed', String(pinned)); event.currentTarget.textContent = pinned ? 'Unpin panel' : 'Pin panel';
    })));
    ownNode(button('Close inspector', close), inspector, true); property(inspector, 'tabIndex', -1);
    for (const name of ['Explore', 'Inspect', 'Appearance', 'Performance']) {
      panels[name]?.setAttribute('aria-label', name); if (panels[name]) panels[name].tabIndex = -1;
      const trigger = button(name, () => {
        opener = trigger;
        if (active === name && !pinned) close();
        else { if (name === 'Inspect') inspectDismissed = false; choose(name, { focus: name === 'Explore' }); }
      });
      trigger.setAttribute('aria-expanded', 'false'); triggers.set(name, trigger); ownNode(trigger, bar);
    }
    const help = step(() => document.createElement('dialog')); help.id = 'viewer-help';
    const closeHelp = step(() => help.close), showHelp = step(() => help.showModal);
    undo(() => { if (lifetime.canRestore() && help.open) Reflect.apply(closeHelp, help, []); });
    const helpTitle = document.createElement('h2'); helpTitle.textContent = 'Explore the available map snapshot';
    const helpText = document.createElement('p');
    helpText.textContent = 'Explore searches and pages all available saved files and members. Selection and source inspection work outside drawn scope. Fit all fits represented visible geometry; Detail chooses semantic relationship resolution. Drag or WASD pans, wheel zooms. With the viewport focused: F focuses selection, Home fits, Escape clears, Enter opens configured source. Motion follows your system unless changed. Pipes represent directed source relationships, not runtime execution.';
    step(() => help.append(helpTitle, helpText, button('Close help', () => Reflect.apply(closeHelp, help, []))));
    ownNode(help, app); ownNode(button('Help', () => Reflect.apply(showHelp, help, [])), bar);
    lifetime.listen(document, 'keydown', event => {
      if (event.key === 'Escape' && active && (menu.contains(event.target) || inspector.contains(event.target))) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    });
    const classes = app.classList, hadClass = classes.contains('scene-first-workspace'), removeClass = classes.remove;
    undo(() => { if (lifetime.canRestore() && !hadClass) Reflect.apply(removeClass, classes, ['scene-first-workspace']); });
    step(() => classes.add('scene-first-workspace'));
    const style = app.style, priorHeight = style.getPropertyValue('--viewer-header-height'), priorPriority = style.getPropertyPriority('--viewer-header-height');
    const setHeight = style.setProperty, removeHeight = style.removeProperty; let height;
    undo(() => {
      if (!lifetime.canRestore() || style.getPropertyValue('--viewer-header-height') !== height) return;
      if (priorHeight) Reflect.apply(setHeight, style, ['--viewer-header-height', priorHeight, priorPriority]);
      else Reflect.apply(removeHeight, style, ['--viewer-header-height']);
    });
    const measure = () => {
      height = `${Math.max(56, step(() => bar.getBoundingClientRect().height))}px`;
      step(() => Reflect.apply(setHeight, style, ['--viewer-header-height', height]));
    };
    const ResizeObserver = step(() => view.ResizeObserver);
    if (ResizeObserver) {
      const observer = new ResizeObserver(wrap(measure));
      lifetime.resource(observer, 'original viewer shell resize observation', 'disconnect').assertCaptured();
      const observe = step(() => observer.observe); step(() => Reflect.apply(observe, observer, [bar]));
    }
    measure();
    const detail = step(() => document.getElementById('stack-mode')?.parentElement);
    if (detail?.firstChild?.nodeType === 3) property(detail.firstChild, 'textContent', 'Detail ');
    lifetime.publish('revealInspector', wrap(() => { if (!active && !inspectDismissed && !pinned) choose('Inspect'); }));
    choose(null);
    return shell;
  });
};
