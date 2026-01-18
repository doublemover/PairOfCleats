const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export function getEnvSecrets(env = process.env) {
  return {
    apiToken: normalizeString(env.PAIROFCLEATS_API_TOKEN)
  };
}
