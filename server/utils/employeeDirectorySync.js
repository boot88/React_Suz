// A directory row is an appointment, not a person. Compare complete sets before
// writing anything; row/page ordering must never produce personnel events.
const { randomUUID } = require('crypto');
const {
  normalizeValue, normalizeSourceKeyPart, createEmployeeIdentity, createSourceKey,
  assertDirectorySnapshot
} = require('./employeeDirectory');

const FIELDS = ['full_name', 'position', 'department', 'room', 'internal_phone', 'external_phone', 'email'];
const personKey = (row) => normalizeSourceKeyPart(row.full_name).replace(/ё/g, 'е');
const serialize = (row) => Object.fromEntries(FIELDS.map((field) => [field, normalizeValue(row[field] || '')]));
const signature = (row) => JSON.stringify(FIELDS.map((field) => field === 'full_name' ? personKey(row) : normalizeSourceKeyPart(row[field])));
const uniqueRows = (rows) => [...new Map([...rows].sort((a, b) => signature(a).localeCompare(signature(b)))
  .map((row) => [signature(row), row])).values()];
const groupPeople = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const key = personKey(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
};
const LABELS = ['ФИО', 'Должность', 'Отдел', 'Кабинет', 'Телефон вн.', 'Телефон внешний', 'Email'];
const describe = (rows) => uniqueRows(rows).map((row) => FIELDS.slice(1)
  .map((field, index) => `${LABELS[index + 1]}: ${normalizeValue(row[field] || '') || '—'}`).join('; ')).join('\n');
const sameRows = (left, right) => JSON.stringify(uniqueRows(left).map(signature)) === JSON.stringify(uniqueRows(right).map(signature));
const summarizePerson = (rows) => {
  const assignments = uniqueRows(rows).map((row) => ({ ...serialize(row), source_key: row.source_key || createSourceKey(row) }));
  const person = { full_name: assignments[0].full_name, source_key: personKey(assignments[0]), assignments };
  for (const field of FIELDS.filter((field) => field !== 'full_name')) {
    person[field] = [...new Set(assignments.map((row) => row[field]).filter(Boolean))].sort().join(', ');
  }
  return person;
};

const planDirectorySync = ({ existingRows = [], employees = [], legacyBaseline = false } = {}) => {
  const incoming = uniqueRows(employees.filter((row) => personKey(row))).map((row) => ({ ...serialize(row), source_key: createSourceKey(row) }));
  const active = existingRows.filter((row) => Number(row.is_active) === 1);
  const beforePeople = groupPeople(active);
  const historyPeople = groupPeople(existingRows);
  const afterPeople = groupPeople(incoming);
  const writes = [];
  const usedIds = new Set();
  const groups = { inserted: [], updated: [], deactivated: [], restored: [], initialized: [] };
  const initialLoad = existingRows.length === 0;

  for (const [key, afterRows] of afterPeople) {
    const beforeRows = beforePeople.get(key) || [];
    const historyRows = historyPeople.get(key) || [];
    const remaining = new Set(afterRows);
    const available = () => historyRows.filter((row) => !usedIds.has(row.id));
    const match = (after, before) => {
      usedIds.add(before.id);
      remaining.delete(after);
      // Preserve existing row IDs and keys so old references keep working.
      writes.push({ ...after, id: before.id, source_key: before.source_key || after.source_key });
    };
    // Exact matches first, active before historical duplicates. Each DB row may
    // be consumed once, including when repairing old duplicate/collapsed rows.
    for (const after of afterRows) {
      const candidates = available().filter((row) => signature(row) === signature(after))
        .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.id - b.id);
      if (candidates.length) match(after, candidates[0]);
    }
    // Contact edits within the same appointment are updates, not hire/fire.
    // Only match unambiguous pairs; never guess a pairing for several transfers.
    for (const getKey of [createEmployeeIdentity, (row) => normalizeSourceKeyPart(row.department), (row) => normalizeSourceKeyPart(row.position)]) {
      for (const after of [...remaining]) {
        const value = getKey(after);
        if (!value) continue;
        const candidates = available().filter((row) => Number(row.is_active) === 1 && getKey(row) === value);
        const incomingMatches = [...remaining].filter((row) => getKey(row) === value);
        if (candidates.length === 1 && incomingMatches.length === 1) match(after, candidates[0]);
      }
    }
    const unmatchedActive = available().filter((row) => Number(row.is_active) === 1);
    if (remaining.size === 1 && unmatchedActive.length === 1) match([...remaining][0], unmatchedActive[0]);
    for (const after of remaining) writes.push({ ...after, source_key: `appointment:${randomUUID()}` });

    const after = summarizePerson(afterRows);
    if (initialLoad) groups.initialized.push(after);
    else if (!beforeRows.length) (historyRows.length ? groups.restored : groups.inserted).push(after);
    else if (!sameRows(beforeRows, afterRows)) {
      const before = summarizePerson(beforeRows);
      groups.updated.push({ before, after, reason: legacyBaseline ? 'directory_repaired' : 'assignments_changed', changes: [{
        field: 'assignments', label: 'Места работы и контакты', oldValue: describe(beforeRows), newValue: describe(afterRows)
      }] });
    }
  }
  for (const [key, rows] of beforePeople) {
    if (!afterPeople.has(key)) groups.deactivated.push(summarizePerson(rows));
  }
  const deactivatedRows = active.filter((row) => !usedIds.has(row.id));
  // A true transfer consumes an old row. Only disappearing appointments require
  // a second independent source fetch, including partial departures.
  return { writes, deactivatedRows, groups, initialLoad, activePeople: afterPeople.size, previousPeople: beforePeople.size };
};

const snapshotError = (message, status = 503) => Object.assign(new Error(message), { status });
const validateSnapshot = (snapshot, activeCount) => {
  if (snapshot.failedStarts?.length) throw snapshotError('Не удалось загрузить все страницы справочника. Обновление отменено, данные не изменялись.');
  if (snapshot.expectedPages && snapshot.pages?.length !== snapshot.expectedPages) throw snapshotError('Получен неполный набор страниц справочника. Обновление отменено.');
  assertDirectorySnapshot({ incomingCount: snapshot.employees.length, currentActiveCount: activeCount });
};

// The named lock spans source fetch, comparison and transaction across all app
// processes. Rollback leaves both the old snapshot and migration marker intact.
const synchronizeDirectory = async ({ pool, fetchSnapshot, previewLimit = 1000 }) => {
  const connection = await pool.getConnection();
  let locked = false;
  let transaction = false;
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('employee_directory_sync', 0) AS acquired");
    locked = Number(lock.acquired) === 1;
    if (!locked) throw snapshotError('Обновление справочника уже выполняется другим администратором. Повторите позже.', 409);
    let snapshot = await fetchSnapshot();
    const [existingRows] = await connection.execute('SELECT * FROM phone_book ORDER BY id');
    const activeCount = existingRows.filter((row) => Number(row.is_active) === 1).length;
    validateSnapshot(snapshot, activeCount);
    const [state] = await connection.execute('SELECT version FROM phone_book_sync_state WHERE id = 1');
    const legacyBaseline = Number(state[0]?.version || 0) < 2;
    let plan = planDirectorySync({ existingRows, employees: snapshot.employees, legacyBaseline });
    let confirmedRemovals = false;
    if (plan.deactivatedRows.length) {
      const confirmation = await fetchSnapshot();
      validateSnapshot(confirmation, activeCount);
      // Retain anything seen in either complete fetch: an intermittently missed
      // row must not be interpreted as an employment change.
      snapshot = { ...confirmation, employees: uniqueRows([...snapshot.employees, ...confirmation.employees]) };
      plan = planDirectorySync({ existingRows, employees: snapshot.employees, legacyBaseline });
      confirmedRemovals = true;
    }
    await connection.beginTransaction();
    transaction = true;
    const now = new Date();
    for (const row of plan.deactivatedRows) {
      await connection.execute('UPDATE phone_book SET is_active = 0 WHERE id = ?', [row.id]);
    }
    for (const row of plan.writes) {
      const values = FIELDS.map((field) => row[field] || null);
      if (row.id != null) {
        await connection.execute(`UPDATE phone_book SET full_name = ?, position = ?, department = ?, room = ?, internal_phone = ?, external_phone = ?, email = ?, is_active = 1, last_seen_at = ? WHERE id = ?`, [...values, now, row.id]);
      } else {
        await connection.execute(`INSERT INTO phone_book (full_name, position, department, room, internal_phone, external_phone, email, source_key, is_active, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, [...values, row.source_key, now]);
      }
    }
    await connection.execute('INSERT INTO phone_book_sync_state (id, version) VALUES (1, 2) ON DUPLICATE KEY UPDATE version = 2');
    await connection.commit();
    transaction = false;
    const changes = Object.fromEntries(Object.entries(plan.groups).map(([key, items]) => [key, { count: items.length, items: items.slice(0, previewLimit) }]));
    return {
      inserted: changes.inserted.count, updated: changes.updated.count, deactivated: changes.deactivated.count,
      restored: changes.restored.count, initialized: changes.initialized.count,
      previousActive: activeCount, activeAfter: plan.writes.length, activePeople: plan.activePeople,
      initialLoad: plan.initialLoad, confirmedRemovals, updatedAt: now.toISOString(), changes,
      parsed: snapshot.employees.length, pages: snapshot.pages, expectedPages: snapshot.expectedPages,
      lastStart: snapshot.lastStart, sweeps: snapshot.sweeps, stable: snapshot.stable
    };
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally {
    try {
      if (locked) await connection.execute("SELECT RELEASE_LOCK('employee_directory_sync')");
    } finally { connection.release(); }
  }
};

module.exports = { FIELDS, personKey, serialize, signature, uniqueRows, groupPeople, summarizePerson, planDirectorySync, synchronizeDirectory };
