/** Lazy, paged evidence inspection: no recursive walk or unbounded DOM creation. */
export function inspectValue(value, { pageSize = 40, depth = 0 } = {}) {
  const root = document.createElement('div'); root.className = 'evidence';
  if (value === null || typeof value !== 'object') {
    root.textContent = value == null ? 'Unknown / not supplied' : String(value); return root;
  }
  const keys = Object.keys(value); let offset = 0;
  const more = document.createElement('button'); more.className = 'more';
  const append = () => {
    more.remove();
    for (const key of keys.slice(offset, offset + pageSize)) {
      const child = value[key];
      const row = document.createElement('details'); const heading = document.createElement('summary');
      heading.textContent = `${key}: ${child === null ? 'unknown' : typeof child === 'object' ? Array.isArray(child) ? `${child.length} items` : `${Object.keys(child).length} fields` : String(child).slice(0, 180)}`;
      row.append(heading); let loaded = false;
      row.addEventListener('toggle', () => { if (row.open && !loaded) { loaded = true;
        row.append(depth < 32 ? inspectValue(child, { pageSize, depth: depth + 1 }) : document.createTextNode('Depth limit. Export the original evidence for deeper inspection.'));
      } }); root.append(row);
    }
    offset += pageSize;
    if (offset < keys.length) { more.textContent = `Show next ${Math.min(pageSize, keys.length - offset)} of ${keys.length - offset} remaining fields`; root.append(more); }
  };
  more.onclick = append; append(); return root;
}
export function button(text, onClick, className = '') {
  const node = document.createElement('button'); node.textContent = text; node.onclick = onClick; node.className = className; return node;
}
export function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type })); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
