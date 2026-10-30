// Fixed configuration boundary for evaluator report tests with inert retrieval.
// Invocation parsing, normalization and private plan capture remain production.
export const loadUserConfig = () => ({});
export const getAutoPolicy = async () => ({ quality: { value: 'balanced' }, retrieval: { backend: 'memory' } });
export const getModelConfig = () => ({ id: 'fixture' });
export const getDictConfig = () => ({});
export const getMetricsDir = () => '.';
