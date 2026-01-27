import { registerToolingProvider } from '../provider-registry.js';
import { createTypeScriptProvider } from '../typescript-provider.js';
import { createClangdProvider } from '../clangd-provider.js';
import { createPyrightProvider } from '../pyright-provider.js';
import { createSourcekitProvider } from '../sourcekit-provider.js';

let registered = false;

export const registerDefaultToolingProviders = () => {
  if (registered) return;
  registered = true;
  registerToolingProvider(createTypeScriptProvider());
  registerToolingProvider(createClangdProvider());
  registerToolingProvider(createPyrightProvider());
  registerToolingProvider(createSourcekitProvider());
};
