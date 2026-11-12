const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clip,
  normalizeIp,
  parseUserAgent,
  detectSource,
  cleanPath,
  normalizeUtm,
  getVisitorDay,
  getVisitorDayStart
} = require('./visitorTracking');

test('user agent parser recognises desktop, mobile and tablet systems', () => {
  assert.deepEqual(
    parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'),
    { os: 'windows', browser: 'edge', device: 'desktop', isBot: false }
  );
  assert.deepEqual(
    parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
    { os: 'ios', browser: 'safari', device: 'mobile', isBot: false }
  );
  assert.deepEqual(
    parseUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'),
    { os: 'android', browser: 'chrome', device: 'tablet', isBot: false }
  );
  assert.deepEqual(
    parseUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.4.0.0 Safari/537.36'),
    { os: 'linux', browser: 'yandex', device: 'desktop', isBot: false }
  );
});

test('known crawlers are marked as bots and do not invent an operating system', () => {
  const parsed = parseUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
  assert.equal(parsed.isBot, true);
  assert.equal(parsed.device, 'bot');
  assert.equal(parseUserAgent('curl/8.5.0').isBot, true);
  assert.equal(parseUserAgent('').isBot, false);
});

test('source detection separates search, social, direct and internal transitions', () => {
  assert.deepEqual(detectSource(''), { source: 'direct', kind: 'direct' });
  assert.deepEqual(detectSource('https://yandex.ru/search/?text=test'), { source: 'yandex', kind: 'search' });
  assert.deepEqual(detectSource('https://www.google.com/url?q=test'), { source: 'google', kind: 'search' });
  assert.deepEqual(detectSource('https://vk.com/wall-1_2'), { source: 'vk', kind: 'social' });
  assert.deepEqual(detectSource('https://t.me/some_channel'), { source: 'telegram', kind: 'social' });
  assert.deepEqual(detectSource('https://web3.nioch.nsc.ru/nioch/'), { source: 'nioch', kind: 'external' });
  assert.deepEqual(detectSource('http://192.168.1.35:3100/employee', '192.168.1.35:3100'), { source: 'internal', kind: 'internal' });
  assert.deepEqual(detectSource('https://example.org/page'), { source: 'site:example.org', kind: 'external' });
  assert.deepEqual(detectSource('not a url'), { source: 'direct', kind: 'direct' });
});

test('paths and IP addresses are normalised without leaking access tokens', () => {
  assert.equal(normalizeIp('::ffff:192.168.1.35'), '192.168.1.35');
  assert.equal(normalizeIp('::1'), '127.0.0.1');
  assert.equal(normalizeIp(''), '');
  assert.equal(cleanPath('/employee?tab=chat&access_token=secret#top'), '/employee?tab=chat');
  assert.equal(cleanPath('/network-map?mt=media-token'), '/network-map');
  assert.equal(cleanPath('statistics'), '/statistics');
  assert.equal(cleanPath(''), '/');
  assert.equal(clip('  a\u0000 b  ', 10), 'a b');
});

test('utm values are clipped and the local visitor day uses Novosibirsk time', () => {
  assert.deepEqual(normalizeUtm({ source: 'newsletter', medium: 'email', campaign: 'autumn' }), {
    source: 'newsletter', medium: 'email', campaign: 'autumn'
  });
  assert.deepEqual(normalizeUtm({}), { source: null, medium: null, campaign: null });
  assert.equal(getVisitorDay(new Date('2026-11-09T18:30:00Z')), '2026-11-10');
  assert.equal(getVisitorDay(new Date('2026-11-09T16:59:00Z')), '2026-11-09');
  assert.equal(
    new Date(getVisitorDayStart(new Date('2026-11-09T18:30:00Z'))).toISOString(),
    '2026-11-09T17:00:00.000Z'
  );
  assert.equal(
    new Date(getVisitorDayStart(new Date('2026-11-09T16:59:00Z'))).toISOString(),
    '2026-11-08T17:00:00.000Z'
  );
  assert.ok(Number.isNaN(getVisitorDayStart('invalid')));
});
