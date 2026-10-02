/* eslint-disable testing-library/no-unnecessary-act -- Uses ReactDOM directly. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import Dashboard from './Dashboard';
import AddApplication from './AddApplication';
import EditApplicationsTable from './EditApplicationsTable';
import EmployeeSearch from './EmployeeSearch';
import KnowledgeBase from './KnowledgeBase';
import NetworkMap from './NetworkMap';
import StatisticsOverview from './StatisticsOverview';
import AdminSettings from './AdminSettings';
import { authFetch } from '../utils/authFetch';
import { initializeUserPreferences, userSettingsStorage } from '../utils/userPreferences';
import { translateAdminText, getAdminLocale } from '../utils/adminTranslation';

jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'admin', name: 'Повисок Евгений Вячеславович', role: 'admin' }, isLoading: false }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn(), useLocation: () => ({ pathname: '/', search: '' }), useParams: () => ({}) }));
jest.mock('../utils/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('recharts', () => {
  const React = require('react');
  const Container = ({ children }) => React.createElement('div', null, children);
  return Object.fromEntries(['Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Legend', 'Line', 'LineChart', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, Container]));
});

let container, root;
const application = { id: 7, name: 'Повисок Евгений Вячеславович', application: 'Все заявки', process: 'Сбросить всё', executor: 'Повисок Е.В.', status: 'new', data: '2026-09-30', created_at: '2026-09-30T07:00:00Z', cabinet: '15', N_tel: '555', fl: false };
const setLanguage = async (language) => act(async () => userSettingsStorage.setItem('adminLanguage', language));
const render = async (page) => act(async () => root.render(page));
const interfaceText = () => [container.textContent, ...Array.from(container.querySelectorAll('[placeholder], [title], [aria-label], [alt]')).flatMap((element) => ['placeholder', 'title', 'aria-label', 'alt'].map((attribute) => element.getAttribute(attribute) || ''))].join(' ').replace(/Повисок Е\.В\.|Андреев Р\.В\.|Польников Д\.В\.|П\.Е\.|А\.Р\.|П\.Д\./g, '');

beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('authState', JSON.stringify({ user: { username: 'admin' } }));
  initializeUserPreferences('admin', { uiLanguage: 'en', requestViewMode: 'table' });
  authFetch.mockReset();
  authFetch.mockImplementation(async (url) => {
    let data = {};
    if (url.includes('/employees/all') || url.includes('/auth/employees')) data = { employees: [] };
    else if (url.includes('/employees/departments')) data = [];
    else if (url.includes('/applications')) data = { applications: [], totalPages: 1, total: 0, stats: { total: 0, completed: 0, pending: 0 } };
    else if (url.includes('/knowledge-base')) data = [];
    else if (url.includes('/network-map')) data = { zoneText: '', fetchedAt: '2026-09-30T07:00:00Z' };
    else if (url.includes('/settings/chat-upload-limit')) data = { limitMb: 10 };
    else if (url.endsWith('/backups')) data = [{ key: 'applications', title: 'Заявки', extension: '.sql', tables: ['application'] }, { key: 'knowledge', title: 'База знаний с фотографиями', extension: '.sql', tables: ['knowledge_base'] }];
    return { ok: true, json: async () => data };
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); delete window.IS_REACT_ACT_ENVIRONMENT; });

test.each([
  ['dashboard', Dashboard, 'Request queue, deadlines and actions'],
  ['new request', AddApplication, 'Add a new request'],
  ['request editing', EditApplicationsTable, 'Request editing'],
  ['employee directory', EmployeeSearch, 'Employee search'],
  ['knowledge base', KnowledgeBase, 'Knowledge base'],
  ['network diagnostics', NetworkMap, 'Available and occupied IP addresses'],
  ['statistics', StatisticsOverview, 'Request analytics']
])('%s has English text and accessible labels, and switches back to Russian', async (_, Page, caption) => {
  await render(<Page />);
  expect(interfaceText()).toContain(caption);
  expect(interfaceText()).not.toMatch(/[а-яё]/i);
  await setLanguage('ru');
  expect(container.textContent).toMatch(/[а-яё]/i);
  await setLanguage('en');
  expect(interfaceText()).not.toMatch(/[а-яё]/i);
});

test('settings, server backup titles and attachment messages switch without losing the edited limit', async () => {
  await render(<AdminSettings language="en" theme="light" onLanguageChange={jest.fn()} onThemeChange={jest.fn()} />);
  expect(interfaceText()).not.toMatch(/[а-яё]/i);
  const input = container.querySelector('#chat-upload-limit');
  act(() => Simulate.change(input, { target: { value: '150' } }));
  await setLanguage('ru');
  expect(container.textContent).toContain('Резервные копии и восстановление');
  expect(input.value).toBe('150');
  await setLanguage('en');
  expect(container.textContent).toContain('Backup and restore');
  expect(container.textContent).toContain('Knowledge base with photos');
  expect(input.value).toBe('150');
  expect(interfaceText()).not.toMatch(/[а-яё]/i);
});

test('dashboard filters and request details are translated while request text, names and work notes stay original', async () => {
  authFetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.includes('/applications') ? { applications: [application], totalPages: 1, total: 1, stats: { total: 1, completed: 0, pending: 1 } } : { employees: [] } }));
  await render(<Dashboard />);
  expect(container.querySelector('.cell-application')?.textContent || container.querySelector('.cell-request')?.textContent).toContain('Все заявки');
  expect(container.textContent).toContain(application.name);
  const search = container.querySelector('input[placeholder="Search requests"]');
  await act(async () => Simulate.change(search, { target: { value: 'Кабинет Евгения' } }));
  expect(container.textContent).toContain('Active filters:');
  expect(container.textContent).toContain('search: Кабинет Евгения');
  expect(container.textContent).toContain('Clear all');
  await setLanguage('ru');
  expect(container.textContent).toContain('Активные фильтры:');
  expect(search.value).toBe('Кабинет Евгения');
  await setLanguage('en');
  expect(container.textContent).toContain('Active filters:');
});

test('translated UI messages preserve dynamic counts, filenames and names', () => {
  expect(translateAdminText('Сохранено. Теперь можно прикреплять файлы до 150 МБ.', 'en')).toBe('Saved. Files up to 150 MB can now be attached.');
  expect(translateAdminText('Файл "спектр$&.jpg" не является изображением', 'en')).toBe('File "спектр$&.jpg" is not an image');
  expect(translateAdminText('Заявки, где Повисок Е.В. работал один', 'en')).toBe('Requests handled individually by Повисок Е.В.');
  expect(translateAdminText('Список заявок', 'ru')).toBe('Список заявок');
  expect(getAdminLocale()).toBe('en-GB');
});

test('request card UI and deletion confirmation are English, while employee text is preserved', async () => {
  authFetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.includes('/applications') ? { applications: [application], totalPages: 1, total: 1, stats: { total: 1, completed: 0, pending: 1 } } : { employees: [] } }));
  await render(<Dashboard />);
  await act(async () => Simulate.click(container.querySelector('tbody tr')));
  const panel = container.querySelector('.application-side-panel');
  expect(panel.textContent).toContain('Next action');
  expect(panel.textContent).toContain('Work completed');
  expect(panel.textContent).toContain(application.name);
  expect(panel.textContent).toContain(application.application);
  expect(panel.textContent).toContain(application.process);
  const dialog = jest.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    await act(async () => Simulate.click(panel.querySelector('.side-panel-delete')));
    expect(dialog).toHaveBeenCalledWith('Delete request #7? It will be removed from the work list.');
  } finally { dialog.mockRestore(); }
  await setLanguage('ru');
  expect(panel.textContent).toContain('Следующее действие');
  await setLanguage('en');
  expect(panel.textContent).toContain('Next action');
  expect(panel.textContent).toContain(application.process);
});

test('form validation messages translate when language changes without clearing the form', async () => {
  await render(<AddApplication />);
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(container.textContent).toContain('Full name is required');
  expect(container.textContent).toContain('Laboratory / office is required');
  expect(container.textContent).toContain('Please correct the errors in the form');
  expect(interfaceText()).not.toMatch(/[а-яё]/i);
  await setLanguage('ru');
  expect(container.textContent).toContain('ФИО обязательно для заполнения');
  await setLanguage('en');
  expect(container.textContent).toContain('Full name is required');
});

test('knowledge base categories display in English but save their original identifiers and user text', async () => {
  await render(<KnowledgeBase />);
  const option = container.querySelector('option[value="Установка ПО"]');
  expect(option.textContent).toBe('Software installation');
  act(() => {
    Simulate.change(container.querySelector('input[name="title"]'), { target: { name: 'title', value: 'Все заявки' } });
    Simulate.change(container.querySelector('textarea[name="solution"]'), { target: { name: 'solution', value: 'Сохранить' } });
    Simulate.change(option.closest('select'), { target: { name: 'category', value: 'Установка ПО' } });
  });
  await setLanguage('ru');
  expect(option.textContent).toBe('Установка ПО');
  await setLanguage('en');
  expect(option.textContent).toBe('Software installation');
  expect(option.closest('select').value).toBe('Установка ПО');
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  try {
    await act(async () => Simulate.click(container.querySelector('.add-form .save-btn') || Array.from(container.querySelectorAll('.add-form button')).find((button) => button.textContent === 'Add article')));
    expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('/knowledge-base'), expect.objectContaining({ method: 'POST', body: expect.any(String) }));
    const saved = JSON.parse(authFetch.mock.calls.find(([, options]) => options?.method === 'POST')[1].body);
    expect(saved).toMatchObject({ title: 'Все заявки', solution: 'Сохранить', category: 'Установка ПО' });
    expect(alert).toHaveBeenCalledWith('Article added successfully!');
  } finally { alert.mockRestore(); }
});
