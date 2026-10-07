const { mergeEmployeeApplications } = require('./employeeApplications');
test('late snapshots and realtime updates cannot restore a cancelled request', () => {
  const current = [{ id: 3, revision: 1 }, { id: 1, revision: 0 }], deleted = new Set(['2']);
  expect(mergeEmployeeApplications(current, [{ id: 3 }, { id: 2 }, { id: 1 }], deleted, true).map(row => row.id)).toEqual([3, 1]);
  expect(mergeEmployeeApplications(current, [{ id: 2, revision: 5 }], deleted)).toEqual(current);
});
test('an old fetch cannot overwrite a newer status received while loading', () => {
  const current = [{ id: 1, revision: 3, status: 'reopened' }, { id: 2, revision: 0 }];
  const merged = mergeEmployeeApplications(current, [{ id: '1', revision: 2, status: 'in_progress' }]);
  expect(merged).toHaveLength(2); expect(merged[0].status).toBe('reopened'); expect(merged[1].id).toBe(2);
});
test('a clean refresh replaces the snapshot and explicit deletion flags are excluded', () => {
  expect(mergeEmployeeApplications([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3, deleted_at: '2026-10-07' }], new Set(), true)).toEqual([{ id: 2 }]);
});
