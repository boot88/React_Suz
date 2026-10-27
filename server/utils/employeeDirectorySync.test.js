const test = require('node:test');
const assert = require('node:assert/strict');
const { planDirectorySync, synchronizeDirectory } = require('./employeeDirectorySync');
const { createSourceKey, parsePhoneBookEmployees } = require('./employeeDirectory');
const { planProvisionedUsers } = require('./directoryUsers');
const person = 'Верхов Федор Константинович';
const row = (position = 'инженер', department = 'ГРСА', extra = {}) => ({
  full_name: person, position, department, room: '131', internal_phone: '330-68-59', external_phone: '1-384', email: 'cf3no@nioch.nsc.ru', ...extra
});
const jobs = [row(), row('мнс', 'ЛФМ')];
const persisted = (rows) => rows.map((entry, index) => ({ ...entry, id: index + 1, source_key: createSourceKey(entry), is_active: 1 }));
const applyPlan = (existingRows, plan) => {
  const rows = existingRows.map((entry) => ({ ...entry }));
  for (const entry of plan.deactivatedRows) rows.find((r) => r.id === entry.id).is_active = 0;
  for (const entry of plan.writes) {
    const old = rows.find((r) => entry.id != null && r.id === entry.id);
    if (old) Object.assign(old, entry, { is_active: 1 });
    else rows.push({ ...entry, id: Math.max(0, ...rows.map((r) => r.id)) + 1, is_active: 1 });
  }
  assert.equal(new Set(rows.map((r) => r.source_key)).size, rows.length, 'source keys must remain unique');
  return rows;
};
const noEvents = (plan) => Object.values(plan.groups).every((items) => items.length === 0);

test('initial load counts people, retaining every appointment; repeated reordered loads have no events', () => {
  let rows = [];
  const initial = planDirectorySync({ employees: [...jobs, jobs[0]] });
  assert.equal(initial.groups.initialized.length, 1);
  assert.equal(initial.groups.initialized[0].assignments.length, 2);
  assert.equal(initial.groups.inserted.length, 0);
  rows = applyPlan(rows, initial);
  for (let i = 0; i < 4; i++) {
    const plan = planDirectorySync({ existingRows: rows, employees: i % 2 ? jobs : [...jobs].reverse() });
    assert.ok(noEvents(plan));
    rows = applyPlan(rows, plan);
  }
});

test('two positions in the same department survive parsing and repeated synchronization', () => {
  const sameDepartment = [row(), row('мнс', 'ГРСА')];
  const html = `<table id="cardnList"><tbody>${sameDepartment.map((r) => `<tr>${[r.full_name,r.position,r.department,r.room,r.external_phone,r.internal_phone,r.email].map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const parsed = parsePhoneBookEmployees(html);
  assert.equal(parsed.length, 2);
  const rows = applyPlan([], planDirectorySync({ employees: parsed }));
  assert.ok(noEvents(planDirectorySync({ existingRows: rows, employees: [...parsed].reverse() })));
});

test('contact variants within the same appointment are retained as distinct source rows', () => {
  const variants = [row(), row('инженер', 'ГРСА', { room: '222', internal_phone: '123' })];
  assert.notEqual(createSourceKey(variants[0]), createSourceKey(variants[1]));
  const initial = planDirectorySync({ employees: variants });
  assert.equal(initial.writes.length, 2);
  assert.ok(noEvents(planDirectorySync({ existingRows: applyPlan([], initial), employees: variants.reverse() })));
});

test('removing one job changes one person without firing them or removing their login', () => {
  const plan = planDirectorySync({ existingRows: persisted(jobs), employees: [jobs[1]] });
  assert.equal(plan.groups.updated.length, 1);
  assert.equal(plan.groups.deactivated.length, 0);
  assert.equal(plan.groups.inserted.length, 0);
  assert.equal(plan.deactivatedRows.length, 1);
  const account = { login: 'existing-login', full_name: person, provisioned_from_directory: 1, role: 'employee' };
  const accounts = planProvisionedUsers({ phoneRows: [jobs[1]], existingUsers: [account], minUsers: 1 });
  assert.equal(accounts.desiredUsers[0].login, account.login);
  assert.deepEqual(accounts.deletedLogins, []);
});

test('a full departure is one event, followed by no events; return restores the person', () => {
  let rows = persisted(jobs);
  const departure = planDirectorySync({ existingRows: rows, employees: [] });
  assert.equal(departure.groups.deactivated.length, 1);
  assert.equal(departure.groups.deactivated[0].assignments.length, 2);
  rows = applyPlan(rows, departure);
  assert.ok(noEvents(planDirectorySync({ existingRows: rows, employees: [] })));
  const returned = planDirectorySync({ existingRows: rows, employees: jobs });
  assert.equal(returned.groups.restored.length, 1);
  assert.equal(returned.groups.inserted.length, 0);
  rows = applyPlan(rows, returned);
  assert.ok(noEvents(planDirectorySync({ existingRows: rows, employees: jobs })));
});

test('department and position transfers and contact edits are single person updates', () => {
  for (const incoming of [row('инженер', 'Новый отдел'), row('ведущий инженер'), row('мнс', 'ЛФМ'), row('инженер', 'ГРСА', { room: '222', email: 'new@example.org', internal_phone: '456' })]) {
    const rows = persisted([jobs[0]]);
    const plan = planDirectorySync({ existingRows: rows, employees: [incoming] });
    assert.equal(plan.groups.updated.length, 1);
    assert.equal(plan.groups.inserted.length + plan.groups.deactivated.length, 0);
    assert.equal(plan.writes[0].id, rows[0].id);
    assert.ok(noEvents(planDirectorySync({ existingRows: applyPlan(rows, plan), employees: [incoming] })));
  }
});

test('adding a job to an existing person and repairing legacy collapsed rows never reports a hire', () => {
  const old = [{ ...persisted([jobs[0]])[0], source_key: 'old-name|department' }];
  const plan = planDirectorySync({ existingRows: old, employees: jobs, legacyBaseline: true });
  assert.equal(plan.groups.updated.length, 1);
  assert.equal(plan.groups.updated[0].reason, 'directory_repaired');
  assert.equal(plan.groups.inserted.length, 0);
  assert.equal(plan.writes.length, 2);
  assert.ok(noEvents(planDirectorySync({ existingRows: applyPlan(old, plan), employees: [...jobs].reverse() })));
});

test('appointment pair changes are detected even if aggregate positions and departments are identical', () => {
  const plan = planDirectorySync({ existingRows: persisted(jobs), employees: [row('мнс', 'ГРСА'), row('инженер', 'ЛФМ')] });
  assert.equal(plan.groups.updated.length, 1);
  assert.equal(plan.groups.inserted.length + plan.groups.deactivated.length, 0);
});

test('a former appointment can be added again after transfer without colliding with its old source key', () => {
  let rows = persisted([jobs[0]]);
  rows = applyPlan(rows, planDirectorySync({ existingRows: rows, employees: [jobs[1]] }));
  rows = applyPlan(rows, planDirectorySync({ existingRows: rows, employees: jobs }));
  assert.equal(rows.filter((r) => r.is_active).length, 2);
});

test('ambiguous multi-job changes preserve the sets without consuming the same DB row twice', () => {
  const next = [row('директор', 'А'), row('заместитель', 'Б')];
  const rows = persisted(jobs);
  const plan = planDirectorySync({ existingRows: rows, employees: next });
  assert.equal(plan.groups.updated.length, 1);
  assert.equal(plan.groups.updated[0].before.assignments.length, 2);
  assert.equal(plan.groups.updated[0].after.assignments.length, 2);
  assert.ok(noEvents(planDirectorySync({ existingRows: applyPlan(rows, plan), employees: next })));
});

test('legacy duplicate rows become inactive without a false personnel event', () => {
  const rows = persisted([jobs[0], jobs[0]]); rows[1].source_key = 'duplicate';
  const plan = planDirectorySync({ existingRows: rows, employees: [jobs[0]] });
  assert.ok(noEvents(plan));
  assert.equal(plan.deactivatedRows.length, 1);
});

test('account fields and login stay stable when appointments arrive in reverse order', () => {
  const existingUsers = [{ login: 'old-login', full_name: person }];
  const first = planProvisionedUsers({ phoneRows: jobs, existingUsers }).desiredUsers;
  const second = planProvisionedUsers({ phoneRows: [...jobs].reverse(), existingUsers }).desiredUsers;
  assert.deepEqual(first, second);
});

// Exercise the transactional writer with a SQL adapter that enforces unique
// source keys and rolls back state. Fifty unrelated rows exercise real guards.
const filler = Array.from({ length: 50 }, (_, i) => row('инженер', 'АХО', { full_name: `Контрольный Сотрудник ${i}` }));
const snapshot = (employees, extra = {}) => ({ employees: [...filler, ...employees], pages: [{ start: 0 }], expectedPages: 1, failedStarts: [], ...extra });
const database = (initial = []) => {
  let rows = persisted([...filler, ...initial]);
  let version = 0;
  let saved;
  const calls = [];
  const state = { locked: true, failWrite: false, released: false };
  const connection = {
    beginTransaction: async () => { saved = { rows: structuredClone(rows), version }; calls.push('begin'); },
    commit: async () => { calls.push('commit'); },
    rollback: async () => { rows = saved.rows; version = saved.version; calls.push('rollback'); },
    release: () => { state.released = true; },
    execute: async (sql, args = []) => {
      calls.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: state.locked ? 1 : 0 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.startsWith('SELECT *')) return [structuredClone(rows)];
      if (sql.startsWith('SELECT version')) return [[{ version }]];
      if (sql.startsWith('INSERT INTO phone_book_sync_state')) { version = 2; return [{}]; }
      if (state.failWrite) throw new Error('simulated write failure');
      if (sql.startsWith('UPDATE phone_book SET is_active = 0')) rows.find((r) => r.id === args[0]).is_active = 0;
      else if (sql.startsWith('UPDATE phone_book SET full_name')) {
        const target = rows.find((r) => r.id === args[8]);
        ['full_name','position','department','room','internal_phone','external_phone','email'].forEach((key, i) => target[key] = args[i]); target.is_active = 1;
      } else if (sql.startsWith('INSERT INTO phone_book (')) {
        if (rows.some((r) => r.source_key === args[7])) throw new Error('duplicate source key');
        const entry = Object.fromEntries(['full_name','position','department','room','internal_phone','external_phone','email','source_key'].map((key, i) => [key,args[i]]));
        rows.push({ ...entry, id: Math.max(0, ...rows.map((r) => r.id)) + 1, is_active: 1 });
      } else throw new Error(`unexpected SQL: ${sql}`);
      return [{}];
    }
  };
  return { pool: { getConnection: async () => connection }, state, calls, rows: () => structuredClone(rows), version: () => version };
};

test('writer confirms missing jobs and recovers an intermittently missing row', async () => {
  const db = database(jobs); let calls = 0;
  const result = await synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => snapshot(++calls === 1 ? [jobs[0]] : jobs) });
  assert.equal(calls, 2);
  assert.equal(result.confirmedRemovals, true);
  assert.equal(result.updated + result.deactivated + result.inserted, 0);
  assert.equal(db.rows().filter((r) => r.is_active).length, 52);
  assert.ok(db.state.released);
});

test('writer persists partial and full departures once, with repeat and return', async () => {
  const db = database(jobs);
  let result = await synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => snapshot([jobs[0]]) });
  assert.equal(result.updated, 1); assert.equal(result.deactivated, 0);
  result = await synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => snapshot([jobs[0]]) });
  assert.equal(result.updated + result.deactivated + result.inserted, 0);
  result = await synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => snapshot([]) });
  assert.equal(result.deactivated, 1);
  result = await synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => snapshot([]) });
  assert.equal(result.deactivated, 0);
  result = await synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => snapshot(jobs) });
  assert.equal(result.restored, 1); assert.equal(result.inserted, 0);
});

test('writer refuses an incomplete confirmation before any write and releases its lock', async () => {
  const db = database(jobs); const before = db.rows(); let calls = 0;
  await assert.rejects(synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => ++calls === 1 ? snapshot([jobs[0]]) : snapshot([jobs[0]], { failedStarts: [{ start: 20 }] }) }), /все страницы/);
  assert.deepEqual(db.rows(), before); assert.ok(!db.calls.includes('begin'));
  assert.ok(db.calls.some((sql) => sql.includes('RELEASE_LOCK'))); assert.ok(db.state.released);
});

test('writer rejects a concurrent sync without fetching or writing', async () => {
  const db = database(jobs); db.state.locked = false;
  await assert.rejects(synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => { throw new Error('must not fetch'); } }), (error) => error.status === 409);
  assert.ok(!db.calls.includes('begin')); assert.ok(db.state.released);
});

test('writer rolls back failed writes and does not mark legacy repair as completed', async () => {
  const db = database(jobs); const before = db.rows(); db.state.failWrite = true;
  await assert.rejects(synchronizeDirectory({ pool: db.pool, fetchSnapshot: async () => snapshot([jobs[0]]) }), /simulated write failure/);
  assert.deepEqual(db.rows(), before); assert.equal(db.version(), 0);
  assert.ok(db.calls.includes('rollback')); assert.ok(db.state.released);
});

test('a genuinely new person with two appointments produces one hire followed by no events', () => {
  const original = persisted([row('инженер', 'АХО', { full_name: 'Другой Сотрудник Тестович' })]);
  const plan = planDirectorySync({ existingRows: original, employees: [original[0], ...jobs] });
  assert.equal(plan.groups.inserted.length, 1);
  assert.equal(plan.groups.inserted[0].assignments.length, 2);
  assert.equal(plan.groups.deactivated.length, 0);
  assert.ok(noEvents(planDirectorySync({ existingRows: applyPlan(original, plan), employees: [...jobs, original[0]] })));
});

test('case, repeated spaces, dash placeholders and duplicate rows cannot create repeat events', () => {
  const entry = row('инженер', 'ГРСА', { room: '' });
  const incoming = row('ИНЖЕНЕР', 'ГРСА', { full_name: 'Верхов  Фёдор Константинович', room: '—', email: 'CF3NO@NIOCH.NSC.RU' });
  const plan = planDirectorySync({ existingRows: persisted([entry]), employees: [incoming, incoming] });
  assert.ok(noEvents(plan));
  assert.equal(plan.writes.length, 1);
});

test('a failed initial fetch or too-small snapshot leaves all data unchanged', async () => {
  for (const fetchSnapshot of [async () => { throw new Error('source unavailable'); }, async () => ({ employees: [jobs[0]], failedStarts: [] })]) {
    const db = database(jobs); const before = db.rows();
    await assert.rejects(synchronizeDirectory({ pool: db.pool, fetchSnapshot }));
    assert.deepEqual(db.rows(), before); assert.ok(!db.calls.includes('begin')); assert.ok(db.state.released);
  }
});
