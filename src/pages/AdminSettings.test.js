/* eslint-disable testing-library/no-node-access, testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectorySyncReport } from './AdminSettings';
import { userSettingsStorage } from '../utils/userPreferences';
jest.mock('../components/AdminBackups', () => () => null);
jest.mock('../components/ChatUploadSettings', () => () => null);
jest.mock('../services/employeeService', () => ({ syncEmployees: jest.fn() }));
let root, container;
const person = { full_name: 'Верхов Федор Константинович', source_key: 'person', assignments: [
  { source_key: 'job1', position: 'инженер', department: 'ГРСА', room: '131' },
  { source_key: 'job2', position: 'мнс', department: 'ЛФМ', room: '222' }
] };
beforeEach(() => {
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
