/* eslint-disable testing-library/no-node-access */
import { createApplicationCountFavicon } from './applicationCountFavicon';

let notification;
afterEach(() => {
  notification?.restore();
  document.querySelectorAll('link[rel="icon"]').forEach(icon => icon.remove());
});

test('shows a red count on all favicon variants and restores their original attributes', () => {
  document.head.insertAdjacentHTML('beforeend', '<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">');
  const icons = Array.from(document.querySelectorAll('link[rel="icon"]'));
  const originals = icons.map(icon => icon.outerHTML);
  notification = createApplicationCountFavicon();
  notification.update(3);
  icons.forEach(icon => {
    expect(icon.type).toBe('image/svg+xml');
    const svg = decodeURIComponent(icon.getAttribute('href').split(',')[1]);
    expect(svg).toContain('fill="#b91c1c"');
    expect(svg).toContain('fill="#fff">3</text>');
  });
  notification.update(120);
  expect(decodeURIComponent(icons[0].href)).toContain('>99+</text>');
  notification.update(0);
  expect(icons.map(icon => icon.outerHTML)).toEqual(originals);
  notification.update(2);
  notification.restore();
  expect(icons.map(icon => icon.outerHTML)).toEqual(originals);
});

test('removes a temporary favicon on zero and on cleanup', () => {
  notification = createApplicationCountFavicon();
  notification.update(0);
  expect(document.querySelector('link[rel="icon"]')).toBeNull();
  notification.update(1);
  expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
  notification.update(0);
  expect(document.querySelector('link[rel="icon"]')).toBeNull();
  notification.update(4);
  notification.restore();
  expect(document.querySelector('link[rel="icon"]')).toBeNull();
});
