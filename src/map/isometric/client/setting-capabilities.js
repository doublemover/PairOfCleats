export const settingSupported = (path, layoutStyle) => {
  if (layoutStyle !== 'stacks') return true;
  if (/^(scoring|colors)\./.test(path) || /^controls\.wasd\./.test(path)) return false;
  if (path.startsWith('layout.')) return ['layout.style','layout.groupDepth'].includes(path);
  if (/^visuals\.(glass\.|wire|flow|glow)/.test(path)) return false;
  return true;
};

export const controlSupported = (label, layoutStyle) => layoutStyle !== 'stacks'
  || !['Wireframes','Flow lights','File shapes','Member shapes','Color mode'].includes(label);
