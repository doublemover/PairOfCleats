/** Phase-owned diagnostics. Overflow is retained as failure evidence rather than
 * silently accepting a page after the bounded detail buffer fills. */
export const classifyQualificationPhase = phase => {
  const expectedCounts = new Map(), unexpected = [];
  for (const event of phase.events) {
    const rule = phase.expected.find(candidate => candidate.type === event.type
      && (!candidate.url || candidate.url === event.url)
      && (!candidate.message || candidate.message === event.message)
      && (!candidate.method || candidate.method === event.method)
      && (!candidate.requestKind || candidate.requestKind === event.requestKind)
      && (!candidate.requestId || candidate.requestId === event.requestId)
      && (!candidate.statuses || candidate.statuses.includes(event.status))
      && (!candidate.messagePattern || new RegExp(candidate.messagePattern).test(event.message || ''))
      && (expectedCounts.get(candidate) || 0) < candidate.maxCount);
    if (rule) { expectedCounts.set(rule, (expectedCounts.get(rule) || 0) + 1); event.expected = true; }
    else { event.expected = false; unexpected.push(event); }
  }
  return { ok: unexpected.length === 0 && phase.overflow === 0, unexpected,
    expected: phase.events.filter(event => event.expected), overflow: phase.overflow };
};

export const attachQualificationDiagnostics = (page, receipt, initialPhase, { limit = 64 } = {}) => {
  const phases = receipt.phases ||= [];
  let phase;
  const begin = (name, expected = []) => {
    phase = { name, url: page.url(), startedAt: new Date().toISOString(), events: [], expected,
      total: 0, overflow: 0, counts: {}, status: 'running' };
    phases.push(phase); return phase;
  };
  begin(initialPhase);
  const emit = event => {
    // A phase is provisional until its page closes. Late callbacks must revoke
    // an earlier clean observation instead of leaving a passing receipt behind.
    if (phase.status === 'passed') { phase.status = 'running'; phase.lateEvents = (phase.lateEvents || 0) + 1; }
    phase.total++; phase.counts[event.type] = (phase.counts[event.type] || 0) + 1;
    if (phase.events.length >= limit) { phase.overflow++; return; }
    let origin = null;
    try { origin = new URL(event.url || page.url()).origin; } catch {}
    phase.events.push({ timestamp: new Date().toISOString(), pageUrl: page.url(), phase: phase.name,
      origin, severity: 'error', ...event });
  };
  const requests = new WeakMap(); let requestSequence = 0;
  const requestFields = request => {
    if (!requests.has(request)) requests.set(request, ++requestSequence);
    let body = null;
    try { const text = request.postData?.(); if (text && text.length <= 4096) body = JSON.parse(text); } catch {}
    return { requestId: requests.get(request), method: request.method?.() || null,
      requestKind: typeof body?.kind === 'string' ? body.kind.slice(0, 64) : null };
  };
  page.on('pageerror', error => emit({ type: 'pageerror', url: page.url(), message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') emit({ type: 'console', url: message.location()?.url || page.url(), message: message.text() });
  });
  page.on('requestfailed', request => emit({ type: 'requestfailed', url: request.url(),
    resourceType: request.resourceType(), ...requestFields(request), message: request.failure()?.errorText || 'request failed' }));
  page.on('response', response => {
    if (response.status() >= 400) emit({ type: 'http', url: response.url(), status: response.status(),
      resourceType: response.request().resourceType(), message: `HTTP ${response.status()}` });
  });
  const assertClean = () => {
    const classified = classifyQualificationPhase(phase);
    phase.status = classified.ok ? 'passed' : 'failed'; phase.endedAt = new Date().toISOString();
    phase.expectedObserved = classified.expected.length;
    if (!classified.ok) throw new Error(`Browser phase ${phase.name} has unexpected errors or overflow: ${JSON.stringify(classified.unexpected)}`);
    return phase;
  };
  return { begin: (name, expected) => { assertClean(); return begin(name, expected); },
    expect: rule => { phase.expected.push(rule); }, assertClean,
    get phase() { return phase; } };
};
