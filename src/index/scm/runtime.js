let activeConfig = {};

export const setScmRuntimeConfig = (config) => {
  activeConfig = config && typeof config === 'object' ? { ...config } : {};
};

export const getScmRuntimeConfig = () => activeConfig;
