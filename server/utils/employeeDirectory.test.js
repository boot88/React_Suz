const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePhoneBookEmployees,
  findLastStart,
  buildPageStarts,
  fetchAllPhoneBookEmployees,
  assertDirectorySnapshot
} = require('./employeeDirectory');

const buildPage = (rows, paginatorStarts = []) => {
  const table = `<table id="cardnList"><tbody>${
    rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
  const paginator = paginatorStarts
    .map((start) => `<a href="/nioch/index.php/ru/kontakty/telefonnyj-spravochnik?start=${start}">${start}</a>`)
    .join('');
  return `${table}${paginator}`;
};

const employeeRow = (fullName, department = 'ЛЭАСМ') => (
  [fullName, 'снс', department, '312', '330-95-24', '1-286', 'user@nioch.nsc.ru']
);

test('parses employees and drops duplicates inside a page', () => {
  const html = buildPage([
    employeeRow('Олейник Иван Иванович'),
    employeeRow('Олейник Иван Иванович'),
    employeeRow('Олейник Ирина Владимировна')
  ]);

  const employees = parsePhoneBookEmployees(html);

  assert.equal(employees.length, 2);
  assert.deepEqual(employees.map((item) => item.full_name), ['Олейник Иван Иванович', 'Олейник Ирина Владимировна']);
});

test('detects the last start from pagination links instead of an empty page', () => {
  const html = buildPage([employeeRow('Иванов Иван Иванович')], [20, 40, 420]);

  assert.equal(findLastStart(html, { pageSize: 20, maxPages: 25 }), 420);
  assert.equal(findLastStart('', { pageSize: 20, maxPages: 25 }), 480);
  assert.deepEqual(buildPageStarts(40, { pageSize: 20, maxPages: 25 }), [0, 20, 40]);
});

test('unions several sweeps so a row missed by one pass is still synced', () => {
  const pages = {
    0: buildPage([employeeRow('Иванов Иван Иванович')], [20, 40]),
    20: buildPage([employeeRow('Олейник Иван Иванович')]),
    40: buildPage([
      employeeRow('Олейник Ирина Владимировна'),
      // Ключ совпадает с ключом из другого прохода: источник отдаёт
      // перекрывающиеся выборки, из-за чего одиночный проход теряет записи.
      employeeRow('Петров Пётр Петрович')
    ])
  };
  let page40Hits = 0;

  const fetchImpl = async (url) => {
    const start = Number(new URL(url).searchParams.get('start') || 0);
    let html = pages[start] || buildPage([]);
    if (start === 40) {
      page40Hits += 1;
      // Первый проход «теряет» Ирину — воспроизводим поведение источника,
      // который отдаёт перекрывающиеся выборки.
      if (page40Hits === 1) html = buildPage([employeeRow('Петров Пётр Петрович')]);
    }
    return { ok: true, text: async () => html };
  };

  return fetchAllPhoneBookEmployees({ fetchImpl, sweeps: 3, retries: 0 }).then((snapshot) => {
    const names = snapshot.employees.map((item) => item.full_name).sort();
    assert.deepEqual(names, ['Иванов Иван Иванович', 'Олейник Иван Иванович', 'Олейник Ирина Владимировна', 'Петров Пётр Петрович']);
    assert.equal(snapshot.lastStart, 40);
    assert.equal(snapshot.sweeps, 3);
    assert.equal(snapshot.stable, true);
    assert.deepEqual(snapshot.failedStarts, []);
  });
});

test('re-fetches pages with overlapping windows to recover a skipped row', async () => {
  let page20Calls = 0;
  const fetchImpl = async (url) => {
    const start = Number(new URL(url).searchParams.get('start') || 0);
    if (start === 0) {
      return { ok: true, text: async () => buildPage([employeeRow('Иванов Иван Иванович')], [20]) };
    }
    page20Calls += 1;
    // Первые три прохода отдают повтор предыдущей страницы, повторный запрос
    // возвращает запись, которая «проскочила» между окнами выборки.
    const html = page20Calls <= 3
      ? buildPage([employeeRow('Иванов Иван Иванович')])
      : buildPage([employeeRow('Олейник Ирина Владимировна')]);
    return { ok: true, text: async () => html };
  };

  const snapshot = await fetchAllPhoneBookEmployees({ fetchImpl, sweeps: 3, retries: 0 });

  assert.deepEqual(snapshot.retriedStarts, [20]);
  assert.deepEqual(
    snapshot.employees.map((item) => item.full_name).sort(),
    ['Иванов Иван Иванович', 'Олейник Ирина Владимировна']
  );
});

test('reports pages that could not be loaded', async () => {
  const fetchImpl = async (url) => {
    const start = Number(new URL(url).searchParams.get('start') || 0);
    if (start === 20) throw new Error('socket hang up');
    return { ok: true, text: async () => buildPage([employeeRow('Иванов Иван Иванович')], start === 0 ? [20] : []) };
  };

  const snapshot = await fetchAllPhoneBookEmployees({ fetchImpl, sweeps: 3, retries: 1 });

  assert.equal(snapshot.failedStarts.length, 1);
  assert.equal(snapshot.failedStarts[0].start, 20);
});

test('refuses an incomplete directory snapshot', () => {
  assert.throws(
    () => assertDirectorySnapshot({ incomingCount: 10, currentActiveCount: 0, minRows: 50 }),
    (error) => error.status === 422
  );

  assert.throws(
    () => assertDirectorySnapshot({ incomingCount: 120, currentActiveCount: 428, minRows: 50, minRatio: 0.9 }),
    (error) => error.status === 409
  );

  assert.deepEqual(
    assertDirectorySnapshot({ incomingCount: 428, currentActiveCount: 427, minRows: 50, minRatio: 0.9 }),
    { incoming: 428, current: 427 }
  );
});
