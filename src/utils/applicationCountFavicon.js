// The browser controls tab-title colors; use a red favicon for the notification.
export function createApplicationCountFavicon() {
  const icons = Array.from(document.querySelectorAll('link[rel="icon"]'));
  const createdIcon = icons.length ? null : document.createElement('link');
  if (createdIcon) {
    createdIcon.rel = 'icon';
    document.head.appendChild(createdIcon);
    icons.push(createdIcon);
  }
  const originals = icons.map(icon => ({
    icon,
    attributes: ['href', 'type', 'sizes'].map(name => [name, icon.getAttribute(name)])
  }));
  let previousCount;
  const restore = () => {
    originals.forEach(({ icon, attributes }) => {
      attributes.forEach(([name, value]) => {
        if (value === null) icon.removeAttribute(name);
        else icon.setAttribute(name, value);
      });
    });
    createdIcon?.remove();
    previousCount = undefined;
  };
  return {
    update(count) {
      if (count === previousCount) return;
      if (!count) { restore(); return; }
      if (createdIcon && !createdIcon.isConnected) document.head.appendChild(createdIcon);
      const label = count > 99 ? '99+' : String(count);
      const fontSize = label.length === 1 ? 25 : label.length === 2 ? 22 : 16;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#dc2626" stroke="#fff" stroke-width="2"/><text x="16" y="17" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#fff">${label}</text></svg>`;
      const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      icons.forEach(icon => {
        icon.setAttribute('href', href);
        icon.setAttribute('type', 'image/svg+xml');
        icon.setAttribute('sizes', 'any');
      });
      previousCount = count;
    },
    restore
  };
}
