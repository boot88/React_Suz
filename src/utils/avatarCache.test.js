import { createAvatarCache } from './avatarCache';
test('avatar cache limits memory, removes old photo versions and rejects in-flight data after logout', () => {
  const cache = createAvatarCache(2, 16);
  cache.set('/alice?rev=1', 'old'); cache.set('/alice?rev=2', 'new');
  expect(cache.get('/alice?rev=1')).toBeUndefined(); expect(cache.size).toBe(1);
  cache.set('/bob', '12345'); cache.set('/carol', '12345');
  expect(cache.bytes).toBeLessThanOrEqual(16); expect(cache.size).toBeLessThanOrEqual(2);
  const epoch = cache.generation; cache.clear(); cache.set('/alice?rev=3', 'late', epoch);
  expect(cache.size).toBe(0);
});
