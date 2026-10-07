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
import AdminBackups from '../components/AdminBackups';
import { compareApplicationPeriods } from '../utils/statisticsComparison';
import { authFetch } from '../utils/authFetch';
import { initializeUserPreferences, userSettingsStorage } from '../utils/userPreferences';
import { translateAdminText, getAdminLocale } from '../utils/adminTranslation';

const mockNavigate = jest.fn();
let mockRouteState = null;
let mockEditId;

jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'admin', name: 'Повисок Евгений Вячеславович', role: 'admin', accessToken: JSON.parse(global.localStorage.getItem('authState') || '{}')?.user?.accessToken }, isLoading: false }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate, useLocation: () => ({ pathname: '/', search: '', state: mockRouteState }), useParams: () => ({ id: mockEditId }) }));
jest.mock('../utils/authFetch', () => ({ authFetch: jest.fn(), withAccessToken: (url) => url }));
jest.mock('recharts', () => {
  const React = require('react');
  const Container = ({ children }) => React.createElement('div', null, children);
  const components = Object.fromEntries(['Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Legend', 'Line', 'LineChart', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, Container]));
  components.LineChart = ({ children, data = [], onMouseMove }) => React.createElement('div', null, children,
    data.filter((point) => point.value > 0).map((point) => React.createElement('button', {
      key: point.day, 'data-chart-day': point.day,
      onMouseEnter: () => onMouseMove?.({ activePayload: [{ payload: point }] })
    }, point.date)));
  return components;
});

let container, root;
const application = { id: 7, name: 'Повисок Евгений Вячеславович', application: 'Все заявки', process: 'Сбросить всё', executor: 'Повисок Е.В.', status: 'new', data: '2026-09-30', created_at: '2026-09-30T07:00:00Z', cabinet: '15', N_tel: '555', fl: false };
const setLanguage = async (language) => act(async () => userSettingsStorage.setItem('adminLanguage', language));
const render = async (page) => act(async () => root.render(page));
const interfaceText = () => [container.textContent, ...Array.from(container.querySelectorAll('[placeholder], [title], [aria-label], [alt]')).flatMap((element) => ['placeholder', 'title', 'aria-label', 'alt'].map((attribute) => element.getAttribute(attribute) || ''))].join(' ').replace(/Повисок Е\.В\.|Андреев Р\.В\.|Польников Д\.В\.|П\.Е\.|А\.Р\.|П\.Д\./g, '');

beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('authState', JSON.stringify({ user: { username: 'admin' } }));
  initializeUserPreferences('admin', { uiLanguage: 'en', requestViewMode: 'table' });
  mockNavigate.mockReset();
  mockRouteState = null; mockEditId = undefined;
  authFetch.mockReset();
  authFetch.mockImplementation(async (url, options) => {
    let data = {};
    if (url.includes('/employees/all') || url.includes('/auth/employees')) data = { employees: [] };
    else if (url.includes('/employees/departments')) data = [];
    else if (url.includes('/application-statistics')) data = { now: Date.now(), groups: [], comparison: null };
    else if (url.includes('/applications')) data = { applications: [], totalPages: 1, total: 0, stats: { total: 0, completed: 0, pending: 0 } };
    else if (url.includes('/knowledge-base')) data = options?.method === 'POST' ? { id: 1, ...JSON.parse(options.body) } : [];
    else if (url.includes('/network-map')) data = { zoneText: '', fetchedAt: '2026-09-30T07:00:00Z' };
    else if (url.includes('/settings/chat-upload-limit')) data = { limitMb: 10 };
    else if (url.endsWith('/backups')) data = [{ key: 'applications', title: 'Заявки', extension: '.sql', tables: ['application'] }, { key: 'knowledge', title: 'База знаний с фотографиями', extension: '.sql', tables: ['knowledge_base'] }];
    return { ok: true, json: async () => data };
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); sessionStorage.clear(); delete window.IS_REACT_ACT_ENVIRONMENT; });

test.each([
  ['dashboard', Dashboard, 'Request queue, deadlines and actions'],
  ['new request', AddApplication, 'Add a new request'],
  ['request editing', EditApplicationsTable, 'Request editing'],
  ['employee directory', EmployeeSearch, 'Employee search'],
  ['knowledge base', KnowledgeBase, 'Knowledge base'],
  ['network diagnostics', NetworkMap, 'IP addresses in the saved directory'],
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
  expect(panel.querySelector('h2').textContent).toBe(application.application);
  expect(panel.querySelector('.side-panel-chronology').open).toBe(false);
  const sections = [...panel.children];
  expect(sections.indexOf(panel.querySelector('.side-panel-actions'))).toBeLessThan(sections.indexOf(panel.querySelector('.side-panel-section')));
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
    expect(alert).not.toHaveBeenCalled();
    expect(container.querySelector('.admin-notice--success').textContent).toContain('Article added successfully!');
  } finally { alert.mockRestore(); }
});

test('settings separate account preferences from shared limits and maintenance', async () => {
  await render(<AdminSettings language="en" theme="light" onLanguageChange={jest.fn()} onThemeChange={jest.fn()} />);
  const scopes = [...container.querySelectorAll('.settings-scope')];
  expect(scopes).toHaveLength(3);
  expect(scopes[0].textContent).toContain('My settings');
  expect(scopes[0].querySelector('.settings-toggle')).not.toBeNull();
  expect(scopes[0].querySelector('#chat-upload-limit')).toBeNull();
  expect(scopes[1].querySelector('#chat-upload-limit')).not.toBeNull();
  expect(scopes[2].textContent).toContain('Backup and restore');
  expect(scopes[2].textContent).toContain('Refresh directory');
});

test('the extra quick-filter row is removed while the original statistics remain', async () => {
  await render(<Dashboard />);
  expect(container.querySelector('.workflow-quick-filters')).toBeNull();
  expect(container.querySelectorAll('.stats-grid .stat-card')).toHaveLength(3);
});

test('employee search combines a department with FIO and also searches a department alone', async () => {
  authFetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.includes('/departments') ? ['Отдел А'] : [{ id: 1, full_name: 'Иванов Иван', department: 'Отдел А' }] }));
  await render(<EmployeeSearch />);
  const query = container.querySelector('#employee-search-query');
  const field = container.querySelector('#employee-search-field');
  await act(async () => Simulate.change(container.querySelector('#employee-search-department'), { target: { value: 'Отдел А' } }));
  expect(query.disabled).toBe(false);
  expect(field.disabled).toBe(false);
  expect(container.textContent).not.toContain('No employees found');
  await act(async () => Simulate.change(query, { target: { value: 'Иванов' } }));
  authFetch.mockClear();
  await act(async () => Simulate.submit(container.querySelector('form')));
  let params = new URL(authFetch.mock.calls[0][0], 'http://localhost').searchParams;
  expect(params.get('field')).toBe('full_name');
  expect(params.get('query')).toBe('Иванов');
  expect(params.get('department')).toBe('Отдел А');
  expect(container.textContent).toContain('Иванов Иван');
  await act(async () => Simulate.change(query, { target: { value: '' } }));
  authFetch.mockClear();
  await act(async () => Simulate.submit(container.querySelector('form')));
  params = new URL(authFetch.mock.calls[0][0], 'http://localhost').searchParams;
  expect(params.get('query')).toBe('');
  expect(params.get('department')).toBe('Отдел А');
});

test('knowledge articles show excerpts first and load full solutions and photos on expansion', async () => {
  const solution = 'Оригинальный русский текст '.repeat(20);
  authFetch.mockResolvedValue({ ok: true, json: async () => [{ id: 1, title: 'Спектрометр', category: 'Оборудование', solution, images: JSON.stringify([{ name: 'Фото.png', data: 'data:image/png;base64,eA==' }]) }] });
  await render(<KnowledgeBase />);
  const card = container.querySelector('.article-card');
  expect(card.querySelector('.article-excerpt').textContent.length).toBeLessThan(190);
  expect(card.querySelector('pre')).toBeNull();
  expect(card.querySelector('img')).toBeNull();
  const button = card.querySelector('.article-expand');
  expect(button.textContent).toContain('Photos: 1');
  await act(async () => Simulate.click(button));
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(card.querySelector('pre').textContent).toBe(solution);
  expect(card.querySelector('img').getAttribute('alt')).toBe('Фото.png');
  await setLanguage('ru');
  expect(button.textContent).toContain('Свернуть статью');
  await act(async () => Simulate.click(button));
  expect(card.querySelector('pre')).toBeNull();
});

test('Excel captions match all filtered rows or the selected page rows and export the matching data', async () => {
  const rows = [application, { ...application, id: 8 }];
  authFetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.includes('/applications/export') ? { applications: rows } : url.includes('/applications') ? { applications: [application], totalPages: 2, stats: { total: 2 } } : { employees: [] }, blob: async () => new Blob(['xlsx']) }));
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:export'); URL.revokeObjectURL = jest.fn();
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await render(<Dashboard />);
    expect(container.querySelector('.export-btn').textContent.trim()).toBe('📥Export to Excel');
    expect(container.querySelector('.compact-reset')).toBeNull();
    await act(async () => Simulate.change(container.querySelector('#dashboard-date-from'), { target: { value: '2026-09-01' } }));
    await act(async () => Simulate.click(container.querySelector('.export-btn')));
    const exportQuery = authFetch.mock.calls.find(([url]) => url.includes('/applications/export-xlsx?'));
    expect(new URL(exportQuery[0], 'http://localhost').searchParams.get('from')).toBeNull();
    let call = authFetch.mock.calls.find(([url]) => url.includes('/export-xlsx?'));
    expect(call[1]).toBeUndefined();
    expect(container.querySelector('.operation-progress .current').textContent).toContain('Done');
    authFetch.mockClear();
    await act(async () => Simulate.change(container.querySelector('tbody input[type="checkbox"]'), { target: { checked: true } }));
    const selectedButton = [...container.querySelectorAll('.bulk-actions-bar button')].find((button) => button.textContent.startsWith('Export selected'));
    expect(selectedButton.textContent).toBe('Export selected — 1 request');
    await act(async () => Simulate.click(selectedButton));
    call = authFetch.mock.calls.find(([url]) => url.includes('/export-xlsx?'));
    expect(new URL(call[0]).searchParams.get('ids')).toBe('7');
    await act(async () => Simulate.change(container.querySelector('input[placeholder="Search requests"]'), { target: { value: 'новый поиск' } }));
    expect(container.querySelector('.bulk-actions-bar')).toBeNull();
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; anchorClick.mockRestore(); }
});

test('restore shows validated backup metadata and only imports after explicit confirmation', async () => {
  const file = { name: 'Заявки.sql', size: 2048 };
  authFetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.endsWith('/inspect') ? { group: 'applications', rows: 12, files: 0, embeddedImages: 0, createdAt: null, tables: [{ name: 'application', rows: 12 }] } : url.endsWith('/import') ? { message: 'Данные восстановлены. Обновите страницу. Копия прежних данных сохранена на сервере.', tables: [{ rows: 12 }], files: 0, recoveryName: '1-applications.sql' } : [{ key: 'applications', title: 'Заявки', extension: '.sql', tables: ['application'] }] }));
  await render(<AdminBackups />);
  await act(async () => Simulate.click(container.querySelector('.backup-import')));
  await act(async () => Simulate.change(container.querySelector('input[type="file"]'), { target: { files: [file], value: '' } }));
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain('Заявки.sql');
  expect(dialog.textContent).toContain('application: 12');
  expect(dialog.textContent).toContain('Not specified in the backup');
  expect(authFetch.mock.calls.some(([url]) => url.endsWith('/import'))).toBe(false);
  await setLanguage('ru');
  expect(dialog.textContent).toContain('Подтверждение восстановления');
  await act(async () => Simulate.click([...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Восстановить данные')));
  const call = authFetch.mock.calls.find(([url]) => url.endsWith('/import'));
  expect(call[1].body).toBe(file);
  expect(call[1].headers['X-Confirm-Restore']).toBe('replace');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('.operation-progress .current').textContent).toContain('Готово');
});

test('invalid backups and cancelled confirmations never import data', async () => {
  authFetch.mockImplementation(async (url) => ({ ok: !url.endsWith('/inspect'), json: async () => url.endsWith('/inspect') ? { message: 'Дамп повреждён или сохранён не полностью' } : [{ key: 'applications', title: 'Заявки', extension: '.sql', tables: ['application'] }] }));
  await render(<AdminBackups />);
  await act(async () => Simulate.click(container.querySelector('.backup-import')));
  await act(async () => Simulate.change(container.querySelector('input[type="file"]'), { target: { files: [{ name: 'broken.sql', size: 10 }], value: '' } }));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(authFetch.mock.calls.some(([url]) => url.endsWith('/import'))).toBe(false);
  authFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ rows: 1, files: 0, embeddedImages: 0, tables: [{ name: 'application', rows: 1 }] }) }));
  await act(async () => Simulate.change(container.querySelector('input[type="file"]'), { target: { files: [{ name: 'valid.sql', size: 10 }], value: '' } }));
  await act(async () => Simulate.click(container.querySelector('[role="dialog"] .backup-import')));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(authFetch.mock.calls.some(([url]) => url.endsWith('/import'))).toBe(false);
});

test('personal preference preview and cancellation do not change stored settings', async () => {
  await render(<AdminBackups />);
  const article = [...container.querySelectorAll('article')].find((item) => item.querySelector('h2').textContent === 'Personal preferences');
  await act(async () => Simulate.click(article.querySelector('.backup-import')));
  const file = { name: 'settings.json', size: 150, text: async () => JSON.stringify({ format: 'React_Suz browser settings', version: 1, settings: { adminLanguage: 'ru' } }) };
  await act(async () => Simulate.change(container.querySelector('input[type="file"]'), { target: { files: [file], value: '' } }));
  expect(userSettingsStorage.getItem('adminLanguage')).toBe('en');
  expect(container.querySelector('[role="dialog"]').textContent).toContain('Your personal preferences');
  await act(async () => Simulate.click(container.querySelector('[role="dialog"] .backup-import')));
  expect(userSettingsStorage.getItem('adminLanguage')).toBe('en');
});

test('statistics compare equal periods, apply the executor filter and retain chart request links', async () => {
  const now = Date.now(), day = 86400000;
  const date = (days) => new Date(now + days * day).toISOString();
  const rows = [
    { ...application, id: 1, created_at: date(-20), fl: true, status: 'done', end_data: date(-1) },
    { ...application, id: 2, created_at: date(-2) },
    { ...application, id: 3, created_at: date(-9), fl: true, status: 'done', end_data: date(-8) },
    { ...application, id: 4, created_at: date(-1), executor: 'Андреев Р.В.' }
  ];
  authFetch.mockImplementation(async (url, options) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const selected = JSON.parse(params.get('executors') || '[]');
    if (url.includes('/day?')) return { ok: true, json: async () => ({ applications: [{ ...application, id: 2 }], hasMore: false }) };
    const days = params.get('days') === 'all' ? NaN : Number(params.get('days'));
    const chosen = rows.filter((row) => !selected.length || selected.includes(row.executor));
    const groups = rows.filter((row) => !Number.isFinite(days) || new Date(row.created_at).getTime() >= now + 1 - days * day).map((row) => ({ day: new Date(new Date(row.created_at).getTime() + 7 * 3600000).toISOString().slice(0, 10), executor: row.executor, status: row.status, count: 1 }));
    return { ok: true, json: async () => ({ now, earliest: date(-20), groups, comparison: compareApplicationPeriods(chosen, days, now) }) };
  });
  await render(<StatisticsOverview />);
  await act(async () => Simulate.change(container.querySelector('.statistics-period select'), { target: { value: '7' } }));
  let comparison = container.querySelector('.statistics-comparison');
  expect(comparison.querySelector('[data-metric="received"] strong').textContent).toBe('2');
  expect(comparison.querySelector('[data-metric="closed"] strong').textContent).toBe('1');
  expect(comparison.querySelector('[data-metric="remaining"] strong').textContent).toBe('2');
  expect(comparison.querySelector('[data-metric="remaining"] b').textContent).toContain('+1');
  await act(async () => Simulate.click(container.querySelector('.statistics-executor-trigger')));
  await act(async () => Simulate.change(container.querySelector('.statistics-executor-option input')));
  comparison = container.querySelector('.statistics-comparison');
  expect(comparison.querySelector('[data-metric="received"] strong').textContent).toBe('1');
  expect(comparison.querySelector('[data-metric="remaining"] strong').textContent).toBe('1');
  await act(async () => Simulate.mouseEnter(container.querySelector('button[data-chart-day]')));
  const requestButton = container.querySelector('.statistics-day-applications button');
  expect(requestButton).not.toBeNull();
  await act(async () => Simulate.click(requestButton));
  expect(mockNavigate).toHaveBeenCalledWith('/?application=2');
  await setLanguage('ru');
  expect(comparison.textContent).toContain('Сравнение с предыдущим периодом');
  await act(async () => Simulate.change(container.querySelector('.statistics-period select'), { target: { value: 'all' } }));
  comparison = container.querySelector('.statistics-comparison');
  expect(comparison.querySelector('[data-metric]')).toBeNull();
  expect(comparison.textContent).toContain('Для сравнения выберите период');
});

test('knowledge validation and request failures use inline warning/error notices without browser alerts', async () => {
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  try {
    await render(<KnowledgeBase />);
    await act(async () => Simulate.change(container.querySelector('input[type="file"]'), { target: { files: [{ name: 'Спектр.zip', type: 'application/zip', size: 12 }], value: '' } }));
    expect(container.querySelector('.admin-notice--warning').textContent).toContain('File "Спектр.zip" is not an image');
    expect(container.querySelector('.admin-notice--warning').getAttribute('role')).toBe('alert');
    await setLanguage('ru');
    expect(container.querySelector('.admin-notice--warning').textContent).toContain('не является изображением');
    act(() => {
      Simulate.change(container.querySelector('input[name="title"]'), { target: { name: 'title', value: 'Статья' } });
      Simulate.change(container.querySelector('textarea[name="solution"]'), { target: { name: 'solution', value: 'Решение' } });
    });
    authFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Ошибка сервера' }), statusText: 'Server error' });
    await act(async () => Simulate.click(container.querySelector('.add-form .add-btn')));
    expect(container.querySelector('.admin-notice--error')).not.toBeNull();
    expect(alert).not.toHaveBeenCalled();
    await act(async () => Simulate.click(container.querySelector('.admin-notice-dismiss')));
    expect(container.querySelector('.admin-notice')).toBeNull();
  } finally { alert.mockRestore(); }
});

test('knowledge saving ignores repeated clicks and unlocks the preserved form after failure', async () => {
  await render(<KnowledgeBase />);
  act(() => {
    Simulate.change(container.querySelector('input[name="title"]'), { target: { name: 'title', value: 'Test article' } });
    Simulate.change(container.querySelector('textarea[name="solution"]'), { target: { name: 'solution', value: 'Solution' } });
  });
  let finish;
  authFetch.mockClear();
  authFetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const button = container.querySelector('.add-btn');
  act(() => { Simulate.click(button); Simulate.click(button); });
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('Saving');
  expect(authFetch).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: false, json: async () => ({ error: 'Failed' }) }));
  expect(button.disabled).toBe(false);
  expect(container.querySelector('input[name="title"]').value).toBe('Test article');
});

test('employee clear aborts the active query and ignores its eventual response', async () => {
  await render(<EmployeeSearch />);
  act(() => Simulate.change(container.querySelector('#employee-search-query'), { target: { value: 'Иван' } }));
  let finish, signal;
  authFetch.mockImplementation((url, options) => { signal = options.signal; return new Promise((resolve) => { finish = resolve; }); });
  act(() => Simulate.submit(container.querySelector('form')));
  act(() => Simulate.click(container.querySelector('.clear-button')));
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ ok: true, json: async () => [{ full_name: 'Устаревший результат' }] }));
  expect(container.textContent).not.toContain('Устаревший результат');
  expect(container.querySelector('.search-button').disabled).toBe(false);
});

test('request search waits 300ms, cancels stale reads, and date drafts do not reload', async () => {
  jest.useFakeTimers();
  try {
    await render(<Dashboard />);
    authFetch.mockClear();
    act(() => Simulate.change(container.querySelector('#dashboard-date-from'), { target: { value: '2026-01-01' } }));
    expect(authFetch.mock.calls.filter(([url]) => url.includes('/applications?page='))).toHaveLength(0);
    const search = container.querySelector('input[placeholder="Search requests"]');
    act(() => Simulate.change(search, { target: { value: 'a' } }));
    await act(async () => jest.advanceTimersByTime(200));
    act(() => Simulate.change(search, { target: { value: 'ab' } }));
    await act(async () => jest.advanceTimersByTime(299));
    expect(authFetch.mock.calls.filter(([url]) => url.includes('/applications?page='))).toHaveLength(0);
    let finish;
    authFetch.mockImplementation((url) => url.includes('/applications?page=') ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ ok: true, json: async () => ({}) }));
    await act(async () => jest.advanceTimersByTime(1));
    const call = authFetch.mock.calls.find(([url]) => url.includes('/applications?page='));
    expect(new URL(call[0], 'http://localhost').searchParams.get('search')).toBe('ab');
    act(() => Simulate.change(search, { target: { value: 'abc' } }));
    expect(call[1].signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, json: async () => ({ applications: [{ ...application, application: 'Stale result' }], stats: {} }) }));
    expect(container.textContent).not.toContain('Stale result');
  } finally { jest.useRealTimers(); }
});

test('bulk assignment reports HTTP/network failures and retries only failed requests', async () => {
  const rows = [application, { ...application, id: 8 }, { ...application, id: 9 }];
  let retry = false;
  const accepted = [];
  authFetch.mockImplementation(async (url, options) => {
    if (url.endsWith('/assign')) {
      const id = Number(url.match(/applications\/(\d+)/)[1]);
      accepted.push(id);
      if (!retry && id === 9) throw new Error('Network failure');
      return { ok: retry || id === 7, status: 500 };
    }
    return { ok: true, json: async () => url.includes('/applications') ? { applications: rows, totalPages: 1, stats: { total: 3 } } : { employees: [] } };
  });
  await render(<Dashboard />);
  act(() => container.querySelectorAll('tbody input[type="checkbox"]').forEach((input) => Simulate.change(input, { target: { checked: true } })));
  act(() => Simulate.click(container.querySelector('.bulk-actions-bar button')));
  act(() => Simulate.change(container.querySelector('.bulk-assign-box input'), { target: { value: 'Повисок Е.В.' } }));
  await act(async () => { Simulate.click(container.querySelector('.bulk-assign-box button')); Simulate.click(container.querySelector('.bulk-assign-box button')); });
  expect(accepted).toEqual([7, 8, 9]);
  expect(container.querySelector('.bulk-assign-result').textContent).toContain('Assigned: 1. Failed: 2.');
  expect(container.querySelector('.bulk-assign-result').textContent).toContain('#8, #9');
  const selected = [...container.querySelectorAll('tbody input[type="checkbox"]')].map((input) => input.checked);
  expect(selected).toEqual([false, true, true]);
  await setLanguage('ru');
  expect(container.querySelector('.bulk-assign-result').textContent).toContain('Назначено: 1. Не удалось: 2.');
  retry = true;
  await act(async () => Simulate.click(container.querySelector('.bulk-assign-result button')));
  expect(accepted).toEqual([7, 8, 9, 8, 9]);
  expect(container.querySelector('.bulk-assign-result').textContent).toContain('Назначено: 2. Не удалось: 0.');
  expect(container.querySelector('.bulk-actions-bar')).toBeNull();
});

test('initial load failure has a retry action and is distinct from a successful empty result', async () => {
  authFetch.mockImplementation(async (url) => ({ ok: !url.includes('/applications?page='), status: 403, json: async () => ({ error: 'Denied', employees: [] }) }));
  await render(<Dashboard />);
  const notice = container.querySelector('.applications-load-error');
  expect(notice.textContent).toContain('Could not load requests.');
  expect(container.querySelector('.no-data').textContent).not.toContain('No requests match this filter');
  authFetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.includes('/applications') ? { applications: [], totalPages: 1, stats: { total: 0 } } : { employees: [] } }));
  await act(async () => Simulate.click(notice.querySelector('button')));
  expect(container.querySelector('.applications-load-error')).toBeNull();
  expect(container.querySelector('.no-data').textContent).toContain('No requests match this filter');
});

test('failed background refresh retains the previous rows and retry clears the warning', async () => {
  authFetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.includes('/applications') ? { applications: [application], totalPages: 1, stats: { total: 1 } } : { employees: [] } }));
  await render(<Dashboard />);
  expect(container.querySelector('tbody').textContent).toContain('Все заявки');
  authFetch.mockImplementation(async (url) => ({ ok: !url.includes('/applications?page='), status: 403, json: async () => ({ error: 'Denied' }) }));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.querySelector('.applications-load-error').textContent).toContain('Previously loaded data is shown.');
  expect(container.querySelector('tbody').textContent).toContain('Все заявки');
  authFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ applications: [{ ...application, application: 'Updated request' }], stats: { total: 1 }, totalPages: 1 }) }));
  await act(async () => Simulate.click(container.querySelector('.applications-load-error button')));
  expect(container.querySelector('.applications-load-error')).toBeNull();
  expect(container.querySelector('tbody').textContent).toContain('Updated request');
});

test('initial 500 response retries twice then shows a load error instead of an empty result', async () => {
  jest.useFakeTimers();
  try {
    authFetch.mockImplementation(async (url) => ({ ok: !url.includes('/applications?page='), status: 500, json: async () => ({ error: 'Server failure', employees: [], stats: {} }) }));
    await render(<Dashboard />);
    expect(container.querySelector('.applications-load-error')).toBeNull();
    await act(async () => jest.advanceTimersByTime(400));
    await act(async () => jest.advanceTimersByTime(800));
    expect(authFetch.mock.calls.filter(([url]) => url.includes('/applications?page='))).toHaveLength(3);
    expect(container.querySelector('.applications-load-error').textContent).toContain('Could not load requests.');
    expect(container.querySelector('.no-data').textContent).not.toContain('No requests match this filter');
  } finally { jest.useRealTimers(); }
});

test('retry after a lost creation response reuses its operation key and preserves plain text', async () => {
  let fail = true;
  const sent = [];
  authFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'POST' && url.endsWith('/applications')) {
      sent.push(JSON.parse(options.body));
      if (fail) throw new Error('Response lost');
      return { ok: true, json: async () => ({ id: 7 }) };
    }
    return { ok: true, json: async () => [] };
  });
  await render(<AddApplication />);
  act(() => {
    for (const [name, value] of Object.entries({ name: 'Иванов Иван', cabinet: '15', application: 'C:\\Temp\\"file" & data' })) Simulate.change(container.querySelector(`[name="${name}"]`), { target: { name, value } });
  });
  await act(async () => Simulate.submit(container.querySelector('form')));
  const stored = JSON.parse(sessionStorage.getItem('draft:admin:new-request'));
  expect(stored.operation.key).toBe(sent[0].idempotency_key);
  await act(async () => root.render(<div />));
  await render(<AddApplication />);
  expect(container.querySelector('[name="application"]').value).toBe('C:\\Temp\\"file" & data');
  fail = false;
  await act(async () => { Simulate.submit(container.querySelector('form')); Simulate.submit(container.querySelector('form')); });
  expect(sent).toHaveLength(2);
  expect(sent[1].idempotency_key).toBe(sent[0].idempotency_key);
  expect(sent[1].application).toBe('C:\\Temp\\"file" & data');
  expect(sessionStorage.getItem('draft:admin:new-request')).toBeNull();
});

test('clicking the already active filter refreshes without leaving a loading indicator', async () => {
  await render(<Dashboard />);
  const button = container.querySelector('.stat-card.stat-active');
  await act(async () => Simulate.click(button));
  expect(container.textContent).not.toContain('Updating requests');
  expect(authFetch.mock.calls.filter(([url]) => url.includes('/applications?page='))).toHaveLength(2);
});

test('bulk closure reports partial success and retries only the failed request', async () => {
  let retry = false;
  const closed = [];
  const rows = [7, 8].map((id) => ({ ...application, id, status: 'waiting_employee_confirmation' }));
  authFetch.mockImplementation(async (url) => {
    if (url.endsWith('/confirm')) {
      const id = Number(url.match(/applications\/(\d+)/)[1]); closed.push(id);
      return { ok: retry || id === 7, status: 500 };
    }
    return { ok: true, json: async () => url.includes('/applications') ? { applications: rows, totalPages: 1, stats: { total: 2 } } : { employees: [] } };
  });
  await render(<Dashboard />);
  act(() => container.querySelectorAll('tbody input[type="checkbox"]').forEach((input) => Simulate.change(input, { target: { checked: true } })));
  act(() => Simulate.click([...container.querySelectorAll('.bulk-actions-bar button')].find((button) => button.textContent.trim() === 'Close')));
  act(() => Simulate.change(container.querySelector('.workflow-modal textarea'), { target: { value: 'Подтверждено' } }));
  await act(async () => { Simulate.submit(container.querySelector('.workflow-modal')); Simulate.submit(container.querySelector('.workflow-modal')); });
  expect(closed).toEqual([7, 8]);
  expect(container.textContent).toContain('Closed: 1. Failed: 1.');
  expect(container.querySelector('.bulk-close-list').textContent).toContain('#8');
  expect(container.querySelector('.bulk-close-list').textContent).not.toContain('#7');
  retry = true;
  await act(async () => Simulate.submit(container.querySelector('.workflow-modal')));
  expect(closed).toEqual([7, 8, 8]); expect(container.querySelector('.workflow-modal')).toBeNull();
});

test('server events preserve the open card and queue a refresh behind an in-flight request', async () => {
  jest.useFakeTimers();
  const previous = global.EventSource;
  const listeners = {};
  global.EventSource = class { addEventListener(name, handler) { listeners[name] = handler; } close() {} };
  localStorage.setItem('authState', JSON.stringify({ user: { username: 'admin', accessToken: 'test-token' } }));
  let finish, updated = false, deferred = false;
  let pageReads = 0;
  const response = (rows) => ({ ok: true, json: async () => ({ applications: rows, totalPages: 1, stats: { total: 1 } }) });
  authFetch.mockImplementation(async (url) => {
    if (url.includes('/applications?page=')) {
      pageReads += 1;
      if (deferred) { deferred = false; return new Promise((resolve) => { finish = resolve; }); }
      return response([{ ...application, revision: updated ? 2 : 1, application: updated ? 'Updated request' : application.application }]);
    }
    return { ok: true, json: async () => ({ employees: [] }) };
  });
  try {
    await render(<Dashboard />);
    await act(async () => Simulate.click(container.querySelector('tbody tr')));
    deferred = true;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    updated = true;
    await act(async () => { listeners.application({ data: JSON.stringify({ application: { ...application, revision: 2, application: 'Updated request' }, eventType: 'manual_update' }) }); jest.advanceTimersByTime(200); });
    expect(container.querySelector('.application-side-panel h2').textContent).toBe('Updated request');
    await act(async () => finish(response([{ ...application, revision: 1 }])));
    // The older HTTP result must not replace the newer card from the event.
    expect(container.querySelector('.application-side-panel h2').textContent).toBe('Updated request');
    await act(async () => jest.advanceTimersByTime(1));
    expect(pageReads).toBe(3);
    expect(container.querySelector('tbody').textContent).toContain('Updated request');
    expect(container.querySelector('.application-side-panel')).not.toBeNull();
  } finally { global.EventSource = previous; jest.useRealTimers(); }
});

test('editing blocks invalid fields and exposes a version conflict without discarding text', async () => {
  let puts = 0;
  const conflict = 'Заявка изменена другим администратором. Загрузите актуальную версию перед сохранением.';
  authFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'PUT') { puts += 1; return { ok: false, status: 409, json: async () => ({ error: conflict }) }; }
    return { ok: true, json: async () => url.includes('/applications') ? { applications: [{ ...application, revision: 2 }], totalPages: 1, stats: { total: 1 } } : [] };
  });
  await render(<EditApplicationsTable />);
  act(() => Simulate.click(container.querySelector('.edit-button')));
  act(() => Simulate.change(container.querySelector('[name="N_tel"]'), { target: { name: 'N_tel', value: 'invalid' } }));
  await act(async () => Simulate.click(container.querySelector('.save-button')));
  expect(puts).toBe(0);
  act(() => {
    Simulate.change(container.querySelector('[name="N_tel"]'), { target: { name: 'N_tel', value: '555' } });
    Simulate.change(container.querySelector('[name="application"]'), { target: { name: 'application', value: 'My unsaved changes' } });
  });
  await act(async () => Simulate.click(container.querySelector('.save-button')));
  expect(puts).toBe(1);
  expect(container.querySelector('.save-button').disabled).toBe(true);
  expect(container.textContent).toContain('Another administrator has changed this request.');
  expect(container.querySelector('[name="application"]').value).toBe('My unsaved changes');
  expect(container.textContent).toContain('Load the current version');
});

test.each(['en', 'ru'])('direct request editing hands a confirmed save to the list in %s and consumes the notification', async language => {
  jest.useFakeTimers();
  try {
    mockEditId = '7';
    await setLanguage(language);
    let finishSave;
    authFetch.mockImplementation(async (url, options) => {
      if (options?.method === 'PUT') return new Promise(resolve => { finishSave = resolve; });
      const data = url.endsWith('/applications/7') ? { application: { ...application, revision: 2 } }
        : url.includes('/applications') ? { applications: [application], totalPages: 1, stats: { total: 1 } } : { employees: [] };
      return { ok: true, json: async () => data };
    });
    await render(<EditApplicationsTable />);
    act(() => Simulate.change(container.querySelector('[name="application"]'), { target: { name: 'application', value: 'Edited description' } }));
    await act(async () => Simulate.click(container.querySelector('.save-button')));
    expect(mockNavigate).not.toHaveBeenCalled(); expect(container.querySelector('.save-button').disabled).toBe(true);
    await act(async () => finishSave({ ok: true, json: async () => ({ application }) }));
    expect(mockNavigate).toHaveBeenCalledWith('/', { state: { savedApplicationId: 7 } });
    mockRouteState = mockNavigate.mock.calls.at(-1)[1].state;
    await render(<Dashboard />);
    const message = language === 'ru' ? 'Изменения заявки #7 успешно сохранены.' : 'Changes to request #7 saved successfully.';
    expect(container.querySelector('.admin-notice--floating[role=status]').textContent).toContain(message);
    expect(mockNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: '/' }), { replace: true, state: null });
    await act(async () => jest.advanceTimersByTime(5000));
    expect(container.querySelector('.admin-notice--floating').textContent).toContain(message);
    if (language === 'ru') {
      await act(async () => Simulate.click(container.querySelector('.admin-notice-dismiss')));
    } else {
      await act(async () => jest.advanceTimersByTime(3000));
    }
    expect(container.querySelector('.admin-notice--floating')).toBeNull();
    // Reopening the list with the consumed navigation state shows no old success.
    mockRouteState = null;
    await render(<div />); await render(<Dashboard />);
    expect(container.querySelector('.admin-notice--floating')).toBeNull();
  } finally { jest.useRealTimers(); }
});

test('a rejected direct edit remains in the form without navigating or showing a successful save', async () => {
  mockEditId = '7';
  authFetch.mockImplementation(async (url, options) => options?.method === 'PUT'
    ? { ok: false, status: 409, json: async () => ({ error: 'Заявка изменена другим администратором. Загрузите актуальную версию перед сохранением.' }) }
    : { ok: true, json: async () => url.endsWith('/applications/7') ? { application: { ...application, revision: 2 } } : { employees: [] } });
  await render(<EditApplicationsTable />);
  act(() => Simulate.change(container.querySelector('[name="application"]'), { target: { name: 'application', value: 'Keep this text' } }));
  await act(async () => Simulate.click(container.querySelector('.save-button')));
  expect(mockNavigate).not.toHaveBeenCalled(); expect(container.querySelector('[name="application"]').value).toBe('Keep this text');
  expect(container.querySelector('.admin-notice--error')).not.toBeNull(); expect(container.querySelector('.admin-notice--success')).toBeNull();
});
