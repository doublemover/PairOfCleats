/** Canonical allocation/endpoint index, scoped to one compiler group. */
export const createCompilerPortPeerIndex = ({ candidates, maxEntries = 32768, onOverflow = () => {} }) => {
  const channels = new WeakMap(), byItem = new Map();
  const stats = { associations: 0, lookups: 0, candidateVisits: 0, fallback: false };
  const unique = value => {
    const result = [];
    for (const port of candidates(value)) if (port.channel && port.port && !result.some(other => other.channel === port.channel && other.port === port.port)) result.push(port);
    return result;
  };
  const set = (item, value) => {
    const next = unique(value), old = byItem.get(item) || [];
    if (stats.associations - old.length + next.length > maxEntries) {
      stats.fallback = true; onOverflow(item); return;
    }
    for (const port of old) { channels.get(port.channel)?.get(port.port)?.delete(item); stats.associations--; }
    byItem.set(item, next);
    for (const port of next) {
      let sides = channels.get(port.channel); if (!sides) { sides = new Map(); channels.set(port.channel, sides); }
      if (!sides.has(port.port)) sides.set(port.port, new Set());
      sides.get(port.port).add(item); stats.associations++;
    }
  };
  const find = (value, { fallback = [], admit = () => true } = {}) => {
    stats.lookups++;
    const result = new Set(), ports = unique(value);
    if (stats.fallback) {
      for (const item of fallback) {
        let matches = false;
        for (const left of ports) {
          for (const right of candidates(item.receiverPort ?? item.endpoint)) {
            if (!admit()) return [...result];
            stats.candidateVisits++;
            if (left.channel === right.channel && left.port !== right.port) { matches = true; break; }
          }
          if (matches) break;
        }
        if (matches) result.add(item);
      }
    } else {
      for (const port of ports) {
        if (!admit()) break;
        const sides = channels.get(port.channel);
        for (const [side, items] of sides || []) if (side !== port.port) for (const item of items) {
          if (!admit()) return [...result];
          stats.candidateVisits++; result.add(item);
        }
      }
    }
    return [...result].sort((a, b) => (a.peerOrdinal ?? 0) - (b.peerOrdinal ?? 0));
  };
  return { set, find, stats };
};
