/** Shared admission contract for service handlers and documentation recipes. */
export const assertServiceIndexerSelection = ({ command, job, all = false } = {}) => {
  if (command === 'purge' && !String(job || '').trim() && all !== true) throw new Error('Provide --job <id> or --all for purge.');
};
