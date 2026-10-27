/* eslint-disable testing-library/no-node-access, testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AdminSettings, { DirectorySyncReport, NetworkSyncReport } from './AdminSettings';
import { authFetch } from '../utils/authFetch';
import { userSettingsStorage } from '../utils/userPreferences';
jest.mock('../utils/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../components/AdminBackups', () => () => null);
jest.mock('../components/ChatUploadSettings', () => () => null);
jest.mock('../services/employeeService', () => ({ syncEmployees: jest.fn() }));
let root, container;
const person = { full_name: 'Верхов Федор Константинович', source_key: 'person', assignments: [
  { source_key: 'job1', position: 'инженер', department: 'ГРСА', room: '131' },
  { source_key: 'job2', position: 'мнс', department: 'ЛФМ', room: '222' }
] };
beforeEach(() => {
  jest.clearAllMocks();
  window.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('authState', JSON.stringify({ user: { username: 'report-test' } }));
  userSettingsStorage.setItem('adminLanguage', 'ru');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete window.IS_REACT_ACT_ENVIRONMENT; });
test('initial import lists one person with both paired appointments, without calling it a hire', () => {
  act(() => root.render(<DirectorySyncReport report={{ initialized: { count: 1, items: [person] } }} />));
  expect(container.querySelectorAll('article')).toHaveLength(1);
  const jobs = [...container.querySelectorAll('dl')];
  expect(jobs).toHaveLength(2);
  expect(jobs[0].textContent).toContain('инженер'); expect(jobs[0].textContent).toContain('ГРСА');
  expect(jobs[1].textContent).toContain('мнс'); expect(jobs[1].textContent).toContain('ЛФМ');
  expect(container.textContent).toContain('Первичная загрузка справочника');
  expect(container.textContent).not.toContain('Принят на работу');
  expect(container.textContent).not.toContain('Изменений нет');
});
test('partial departure shows the complete before/after sets once without a dismissal', () => {
  const after = { ...person, assignments: [person.assignments[1]] };
  act(() => root.render(<DirectorySyncReport report={{ updated: { count: 1, items: [{ before: person, after, changes: [] }] } }} />));
  expect(container.querySelectorAll('article')).toHaveLength(1);
  const sections = container.querySelectorAll('.directory-assignments-comparison > section');
  expect(sections[0].querySelectorAll('dl')).toHaveLength(2);
  expect(sections[1].querySelectorAll('dl')).toHaveLength(1);
  expect(container.textContent).not.toContain('Уволен');
  expect(container.textContent).not.toContain('Принят на работу');
});
test('return is shown separately and a subsequent empty report says there are no changes', () => {
  act(() => root.render(<DirectorySyncReport report={{ restored: { count: 1, items: [person] } }} />));
  expect(container.textContent).toContain('Восстановленные сотрудники');
  expect(container.textContent).not.toContain('Новые сотрудники');
  act(() => root.render(<DirectorySyncReport report={{}} />));
  expect(container.textContent).toContain('Изменений нет');
  expect(container.querySelectorAll('article')).toHaveLength(0);
});
test('new report labels follow the English interface', () => {
  userSettingsStorage.setItem('adminLanguage', 'en');
  act(() => root.render(<DirectorySyncReport report={{ restored: { count: 1, items: [person] } }} />));
  expect(container.textContent).toContain('Restored employees');
  expect(container.textContent).toContain('Directory entry restored');
});

const networkChanges = {
  initialLoad: false,
  added: { count: 1, items: [{ ip: '10.1.1.4', hosts: ['new-host'], section: 'Lab' }] },
  removed: { count: 1, items: [{ ip: '10.1.1.3', hosts: ['gone-host'], section: 'Lab' }] },
  updated: { count: 1, items: [{ ip: '10.1.1.2', before: { hosts: ['old-host'], section: 'Lab' }, after: { hosts: ['renamed-host'], section: 'Lab' } }] }
};
test('network report lists added and removed IPs and both sides of a changed record', () => {
  act(() => root.render(<NetworkSyncReport report={networkChanges} />));
  expect(container.querySelectorAll('article')).toHaveLength(3);
  for (const value of ['Добавленные IP-адреса', 'Удалённые IP-адреса', 'Изменённые IP-записи', 'old-host', 'renamed-host']) expect(container.textContent).toContain(value);
  act(() => root.render(<NetworkSyncReport report={{ added: { count: 0 }, removed: { count: 0 }, updated: { count: 0 } }} />));
  expect(container.textContent).toContain('Изменений нет. IP-сетка уже актуальна.');
});
test('network report follows the English interface', () => {
  userSettingsStorage.setItem('adminLanguage', 'en');
  act(() => root.render(<NetworkSyncReport report={networkChanges} />));
  expect(container.textContent).toContain('IP directory changes');
  expect(container.textContent).toContain('Added IP addresses');
  expect(container.textContent).toContain('Removed IP addresses');
});
test('settings do not refresh on mount; the network button posts once and shows its report', async () => {
  const originalConfirm = window.confirm; window.confirm = jest.fn(() => true);
  const data = { zoneText: 'new-host A 10.1.1.4', fetchedAt: '2026-10-27T08:00:00Z', sourceUrl: 'source', changes: networkChanges };
  authFetch.mockResolvedValue({ ok: true, json: async () => data });
  try {
    await act(async () => root.render(<AdminSettings />));
    expect(authFetch).not.toHaveBeenCalled();
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Обновить IP-сетку');
    await act(async () => button.click());
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('/network-map/refresh'), { method: 'POST' });
    expect(container.textContent).toContain('Изменения IP-сетки');
    expect(container.textContent).toContain('renamed-host');
    expect(JSON.parse(localStorage.getItem('network-map-cache'))).toEqual({ zoneText: data.zoneText, fetchedAt: data.fetchedAt, sourceUrl: data.sourceUrl });
  } finally { window.confirm = originalConfirm; }
});
