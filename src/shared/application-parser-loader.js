/** One-time application dependency setup, kept separate from document scan clocks. */
export const createApplicationParserLoader = ({ loadParser, isSupported,
  unsupportedReason = 'parser-unavailable', classifyError = () => 'parser-unavailable',
  now = () => performance.now() }) => {
  let parser;
  let initialization;
  return {
    initialize() {
      if (initialization) return initialization;
      const started = Number(now());
      let reason = 'parser-unavailable';
      try {
        parser = loadParser();
        if (parser) reason = unsupportedReason;
      } catch (error) { reason = classifyError(error); }
      const available = isSupported(parser);
      const elapsed = Number(now()) - started;
      initialization = Object.freeze({ scope: 'application-once', available, reason: available ? null : reason,
        elapsedMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0 });
      return initialization;
    },
    getParser: () => parser
  };
};
