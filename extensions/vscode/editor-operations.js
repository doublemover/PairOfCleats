const { AsyncLocalStorage } = require('node:async_hooks');
const cp = require('node:child_process');
const path = require('node:path');

/** One instance belongs to one extension host. Cancellation invalidates UI
 * authority immediately; actual resource settlement is tracked independently. */
function createEditorOperations({ platform = process.platform, spawn = cp.spawn } = {}) {
  const context = new AsyncLocalStorage();
  const scopes = new Set();
  const children = new Map();
  const childTerminations = new WeakMap();
  const pending = new Set();
  const latest = new Map();
  const teardownFailures = [];
  let alive = true;
  let epoch = 0;
  const current = () => context.getStore();
  const isCurrent = (scope = current()) => alive && (!scope || (
    scope.epoch === epoch && !scope.controller.signal.aborted
  ));
  const cancelled = () => ({ ok: false, kind: 'cancelled', message: 'PairOfCleats operation was cancelled.' });
  const normalizeRoot = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

  function releaseScope(scope) {
    if (!scope.finished || scope.resources) return;
    scopes.delete(scope);
    if (scope.key && latest.get(scope.key) === scope) latest.delete(scope.key);
  }

  function bindRepository(root) {
    if (typeof root !== 'string' || !root) return;
    const normalized = normalizeRoot(root);
    for (let scope = current(); scope; scope = scope.parent) scope.repositories?.add(normalized);
  }

  function invalidateRepositories(removedRoots) {
    const roots = removedRoots.filter(root => typeof root === 'string' && root).map(normalizeRoot);
    if (!roots.length) return;
    for (const scope of scopes) {
      if (!scope.repositories?.size || [...scope.repositories].some(repository => roots.some(root => {
        const relative = path.relative(root, repository);
        return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      }))) cancel(scope, 'repository-removed');
    }
  }

  function cancelLabel(label) {
    for (const scope of scopes) if (scope.label === label) cancel(scope, 'surface-invalidated');
  }

  function preserveBackground() {
    for (let scope = current(); scope; scope = scope.parent) scope.background = true;
  }

  function retain(promise) {
    const tracked = Promise.resolve(promise);
    pending.add(tracked);
    tracked.then(() => pending.delete(tracked), () => pending.delete(tracked));
    return tracked;
  }

  function stopChild(child) {
    const record = children.get(child);
    if (!record || record.closed || record.stopping) return record?.stopping
      || Promise.resolve(record?.closed ? { ok: true, alreadyClosed: true }
        : { ok: false, message: 'No live owned process remains to confirm tree termination.' });
    record.stopping = retain(new Promise((resolve) => {
      // Only a still-owned live process may seed taskkill's descendant walk.
      // Never target a saved PID after the child's close/exit observation.
      if (platform !== 'win32' || !Number.isInteger(child.pid) || child.pid <= 0) {
        try {
          const killed = child.kill('SIGKILL');
          if (killed === false) throw new Error('Owned process rejected its termination signal.');
          resolve({ ok: true });
        } catch (error) {
          teardownFailures.push(String(error));
          resolve({ ok: false, message: String(error) });
        }
        return;
      }
      if (child.exitCode != null || child.signalCode != null) {
        resolve({ ok: false, message: 'Owned parent exited before descendant termination could be confirmed.' });
        return;
      }
      let helper;
      let finished = false;
      let timer;
      const finish = (failure) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (failure) {
          teardownFailures.push(failure);
          try { child.kill('SIGKILL'); } catch {}
        }
        resolve(failure ? { ok: false, message: failure } : { ok: true });
      };
      try {
        helper = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, shell: false, stdio: 'ignore'
        });
        timer = setTimeout(() => {
          try { helper.kill('SIGKILL'); } catch {}
          finish(`Owned process-tree termination timed out for PID ${child.pid}.`);
        }, 2000);
        helper.once('error', (error) => finish(`Owned process-tree helper failed: ${error.message}`));
        helper.once('close', (code) => finish(code === 0 ? null : `Owned process-tree helper exited ${code}.`));
      } catch (error) {
        finish(`Owned process-tree helper failed: ${error.message}`);
      }
    }));
    childTerminations.set(child, record.stopping);
    return record.stopping;
  }

  function cancel(scope, reason = 'cancelled') {
    if (!scope || scope.controller.signal.aborted) return;
    scope.controller.abort(reason);
    for (const [child, record] of children) {
      if (record.scope === scope) void stopChild(child);
    }
  }

  async function run(label, callback, { key = null, token = null } = {}) {
    if (!alive || token?.isCancellationRequested) return undefined;
    if (key) cancel(latest.get(key), 'superseded');
    const scope = { label, key, parent: current(), repositories: new Set(), epoch,
      controller: new AbortController(), finished: false, resources: 0 };
    scopes.add(scope);
    if (key) latest.set(key, scope);
    const subscription = token?.onCancellationRequested?.(() => cancel(scope));
    try {
      return await retain(context.run(scope, () => isCurrent(scope) ? callback(scope) : undefined));
    } catch (error) {
      if (isCurrent(scope)) throw error;
      return undefined;
    } finally {
      subscription?.dispose?.();
      scope.finished = true;
      releaseScope(scope);
    }
  }

  function trackChild(child) {
    const scope = current() || { epoch, controller: new AbortController(), resources: 0, finished: true };
    scopes.add(scope);
    const record = { scope, closed: false, stopping: null };
    children.set(child, record);
    scope.resources += 1;
    let release;
    retain(new Promise((resolve) => { release = resolve; }));
    // Bind callbacks without dropping terminal callbacks: their promises and
    // listeners must settle even after publication authority is revoked.
    for (const emitter of [child, child.stdout, child.stderr]) {
      if (!emitter || typeof emitter.emit !== 'function') continue;
      const original = emitter.emit;
      emitter.emit = function(...args) {
        return context.run(scope, () => original.apply(this, args));
      };
    }
    child.once('close', () => {
      record.closed = true;
      children.delete(child);
      scope.resources -= 1;
      releaseScope(scope);
      release();
    });
    if (!isCurrent(scope)) void stopChild(child);
    return child;
  }

  async function request(callback) {
    if (!isCurrent()) return cancelled();
    const scope = current();
    const controller = scope?.controller || new AbortController();
    const unscoped = !scope ? { epoch, controller, resources: 1, finished: true } : null;
    if (unscoped) scopes.add(unscoped);
    try {
      const result = await retain(callback(controller.signal));
      return isCurrent(scope || unscoped) ? result : cancelled();
    } finally {
      if (unscoped) scopes.delete(unscoped);
    }
  }

  function invalidate(reason = 'context-changed', { preserveCurrent = false, preserveBackground = false } = {}) {
    epoch += 1;
    for (const scope of scopes) {
      if (preserveCurrent && scope === current() || preserveBackground && scope.background) scope.epoch = epoch;
      else cancel(scope, reason);
    }
    latest.clear();
  }

  async function dispose(timeoutMs = 5000) {
    alive = false;
    invalidate('disposed');
    let timer;
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })
    ]);
    clearTimeout(timer);
    return {
      ok: pending.size === 0 && children.size === 0 && teardownFailures.length === 0,
      pending: pending.size, children: children.size, failures: [...teardownFailures]
    };
  }

  function wrapVscode(api) {
    const uiCancellation = (scope, inherited) => {
      const subscriptions = new Set();
      return { token: {
        get isCancellationRequested() { return scope.controller.signal.aborted || inherited?.isCancellationRequested === true; },
        onCancellationRequested(listener, thisArg, disposables) {
          let fired = false, active = true;
          const notify = () => { if (active && !fired) { fired = true; listener.call(thisArg); } };
          const previous = inherited?.onCancellationRequested?.(notify);
          scope.controller.signal.addEventListener('abort', notify, { once: true });
          const subscription = { dispose() {
            active = false;
            scope.controller.signal.removeEventListener('abort', notify); previous?.dispose?.(); subscriptions.delete(subscription);
          } };
          subscriptions.add(subscription); disposables?.push?.(subscription);
          if (scope.controller.signal.aborted || inherited?.isCancellationRequested) queueMicrotask(notify);
          return subscription;
        }
      }, dispose() { for (const subscription of [...subscriptions]) subscription.dispose(); } };
    };
    const ownedUi = (object) => !object ? object : new Proxy(object, {
      get(target, name) {
        const value = target[name];
        if (typeof value !== 'function') return value;
        return (...args) => (name === 'dispose' || isCurrent())
          ? value.apply(target, args) : undefined;
      },
      set(target, name, value) {
        if (isCurrent()) target[name] = value;
        return true;
      }
    });
    const guarded = (object, methods) => new Proxy(object || {}, {
      get(target, name) {
        const value = target[name];
        if (typeof value !== 'function') return value;
        if (new Set(['createOutputChannel', 'createStatusBarItem', 'createTreeView', 'createDiagnosticCollection']).has(name)) {
          return (...args) => ownedUi(value.apply(target, args));
        }
        if (!methods.has(name)) return value.bind(target);
        return (...args) => {
          if (!isCurrent()) return undefined;
          const scope = current();
          const tokenIndex = name === 'showQuickPick' ? 2 : name === 'showInputBox' ? 1 : null;
          const cancellation = scope && tokenIndex !== null ? uiCancellation(scope, args[tokenIndex]) : null;
          if (cancellation) args[tokenIndex] = cancellation.token;
          try {
            const result = value.apply(target, args);
            if (result?.then) return result.then((value) => isCurrent(scope) ? value : undefined).finally(() => cancellation?.dispose());
            cancellation?.dispose(); return result;
          } catch (error) { cancellation?.dispose(); throw error; }
        };
      }
    });
    const window = guarded(api.window, new Set([
      'showQuickPick', 'showInputBox', 'showErrorMessage', 'showWarningMessage',
      'showInformationMessage', 'showTextDocument', 'withProgress'
    ]));
    const commands = new Proxy(api.commands || {}, {
      get(target, name) {
        if (name === 'registerCommand') return (id, callback, ...args) => target.registerCommand(
          id, (...values) => run(id, () => callback(...values)), ...args
        );
        if (name === 'executeCommand') return (...args) => isCurrent() ? target.executeCommand(...args) : undefined;
        return typeof target[name] === 'function' ? target[name].bind(target) : target[name];
      }
    });
    const languages = new Proxy(api.languages || {}, {
      get(target, name) {
        const value = target[name];
        if (typeof value !== 'function') return value;
        if (name === 'createDiagnosticCollection') return (...args) => ownedUi(value.apply(target, args));
        if (!/^register.*Provider$/.test(String(name))) return value.bind(target);
        return (selector, provider, ...args) => {
          const wrapped = {};
          for (const [method, callback] of Object.entries(provider)) {
            wrapped[method] = typeof callback !== 'function' ? callback : (...values) => {
              const token = values.find((item) => item && typeof item.onCancellationRequested === 'function');
              return run(method, () => callback(...values), { token });
            };
          }
          return value.call(target, selector, wrapped, ...args);
        };
      }
    });
    const env = new Proxy(api.env || {}, {
      get(target, name) {
        if (name === 'clipboard') return guarded(target[name], new Set(['writeText']));
        if (name === 'openExternal') return (...args) => isCurrent() ? target.openExternal(...args) : undefined;
        return target[name];
      }
    });
    return new Proxy(api, { get: (target, name) => (
      name === 'window' ? window : name === 'commands' ? commands : name === 'languages' ? languages : name === 'env' ? env : target[name]
    ) });
  }

  return {
    run, current, isCurrent, cancelled, trackChild, stopChild, request, invalidate, dispose, wrapVscode,
    bindRepository, invalidateRepositories, cancelLabel,
    preserveBackground, observeTermination: child => childTerminations.get(child) || null,
    terminalState: callback => context.run(undefined, () => alive ? callback() : undefined),
    cancelCurrent: () => cancel(current()), cancelScope: cancel,
    cancelKey: (key) => cancel(latest.get(key)), trackPromise: retain
  };
}

module.exports = { createEditorOperations };
