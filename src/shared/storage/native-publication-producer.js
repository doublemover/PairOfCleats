import { resolveConfiguredNativeStorageSelection } from './configured-native-storage.js';

// Keep producer registration out of the reader dependency graph. Canonical
// outputs incur no registry activation; only exact custom selections reach it.
const selected = input => resolveConfiguredNativeStorageSelection(input.target, {
  repoRoot: input.repoRoot, userConfig: input.userConfig, nativeBackend: input.backend, nativeMode: input.mode
});
export const prepareConfiguredNativePublication = async input => {
  if (!selected(input)) return null;
  const owner = await import('./native-publication.js');
  return owner.prepareConfiguredNativePublication(input);
};
export const commitConfiguredNativePublication = async token => {
  if (token === null) return null;
  const owner = await import('./native-publication.js');
  return owner.commitConfiguredNativePublication(token);
};
export const prepareExistingConfiguredNativePublication = async input => {
  if (!selected(input)) return null;
  const owner = await import('./native-publication.js');
  return owner.prepareExistingConfiguredNativePublication(input);
};
