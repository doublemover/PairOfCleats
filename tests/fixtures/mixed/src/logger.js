export function createLogger(scope) {
  return (message) => `[${scope}] ${message}`;
}
