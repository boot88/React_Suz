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
    expect(alert).toHaveBeenCalledWith('Article added successfully!');
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
    expect(container.querySelector('.export-btn').textContent).toContain('Export matching — 2 requests');
    await act(async () => Simulate.change(container.querySelector('#dashboard-date-from'), { target: { value: '2026-09-01' } }));
    await act(async () => Simulate.click(container.querySelector('.export-btn')));
    const exportQuery = authFetch.mock.calls.find(([url]) => url.includes('/applications/export?') || url.endsWith('/applications/export'));
    expect(new URL(exportQuery[0], 'http://localhost').searchParams.get('from')).toBeNull();
    let call = authFetch.mock.calls.find(([url]) => url.endsWith('/export-xlsx'));
    expect(JSON.parse(call[1].body).applications).toHaveLength(2);
    expect(container.querySelector('.operation-progress .current').textContent).toContain('Done');
    authFetch.mockClear();
    await act(async () => Simulate.change(container.querySelector('tbody input[type="checkbox"]'), { target: { checked: true } }));
    const selectedButton = [...container.querySelectorAll('.bulk-actions-bar button')].find((button) => button.textContent.startsWith('Export selected'));
    expect(selectedButton.textContent).toBe('Export selected — 1 request');
    await act(async () => Simulate.click(selectedButton));
    call = authFetch.mock.calls.find(([url]) => url.endsWith('/export-xlsx'));
    expect(JSON.parse(call[1].body).applications.map((row) => row.id)).toEqual([7]);
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
