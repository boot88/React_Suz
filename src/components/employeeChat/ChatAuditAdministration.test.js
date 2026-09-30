/* eslint-disable testing-library/no-unnecessary-act -- Uses ReactDOM directly. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import ChatAuditAdministration from './ChatAuditAdministration';
import { authFetch } from '../../utils/authFetch';
import { initializeUserPreferences } from '../../utils/userPreferences';

jest.mock('../../utils/authFetch', () => ({ authFetch: jest.fn() }));
const ready = { periodKey: '2025-01', mode: 'month', state: 'active', from: '2025-01-01', to: '2025-01-31', archiveId: 'a1', archiveStatus: 'completed', downloadedAt: '2025-02-01', messageCount: 20, postCount: 3, fileCount: 2, sourceBytes: 1024 };
const periods = [ready,
  { ...ready, periodKey: '2025-02', from: '2025-02-01', archiveStatus: 'pending' },
  { ...ready, periodKey: '2025-03', from: '2025-03-01', archiveStatus: 'failed' },
  { ...ready, periodKey: '2025-04', from: '2025-04-01', state: 'deleted' }];
const employee = { login: 'evgeny', full_name: 'Повисок Евгений Вячеславович', role: 'admin' };
const file = { id: 'f1', name: 'спектр.jpg', mimeType: 'image/jpeg', url: '' };
const props = {
  chatAuthHeaders: {}, directoryEmployees: [employee],
  formatFileSize: (bytes) => `${bytes} B`, getMessageAttachments: (message) => message.files || [],
  getOriginalAttachmentUrl: (attachment) => attachment.url,
  isVideoAttachment: () => false, sameLogin: (a, b) => a === b,
  AttachmentCard: ({ onOpen, file }) => <button type="button" className="test-attachment" onClick={onOpen}>{file.name}</button>
};
let root, container;
const render = async (isEnglishInterface = true) => act(async () => root.render(<ChatAuditAdministration {...props} interfaceLocale={isEnglishInterface ? 'en-GB' : 'ru-RU'} isEnglishInterface={isEnglishInterface} t={(key) => ({ loading: isEnglishInterface ? 'Loading' : 'Загрузка', deletedMessage: 'Deleted', history: 'History' })[key] || key} />));
const uiText = () => [container.textContent, ...Array.from(container.querySelectorAll('[placeholder], [aria-label], [alt]')).flatMap((element) => ['placeholder', 'aria-label', 'alt'].map((key) => element.getAttribute(key) || ''))].join(' ');
const mockApi = async (url) => {
  let data = {};
  if (url.includes('/records/periods?')) data = { periods, source: { totalCount: 25, firstAt: '2025-01-01T12:00:00Z' } };
  else if (url.includes('/audit/participants?')) data = { participants: [employee] };
  else if (url.includes('/audit/feed?')) data = { posts: [{ id: 'post1', author: 'evgeny', text: 'Все заявки', createdAt: '2025-01-03T12:00:00Z', files: [file] }] };
  else if (url.includes('/audit/conversations?')) data = { conversations: [] };
  return { ok: true, json: async () => data };
};
beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); localStorage.clear();
  initializeUserPreferences('admin', { uiLanguage: 'en' });
  localStorage.setItem('authState', JSON.stringify({ user: { username: 'admin' } }));
  authFetch.mockReset(); authFetch.mockImplementation(mockApi);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllTimers(); jest.useRealTimers(); localStorage.clear(); delete window.IS_REACT_ACT_ENVIRONMENT; });

test('periods, counters, archive states and controls translate EN/RU without resetting selected dates', async () => {
  await render();
  expect(uiText()).not.toMatch(/[а-яё]/i);
  expect(uiText()).toContain('Available periods');
  expect(uiText()).toContain('20 messages · 3 posts · 2 files');
  expect(uiText()).toContain('Retry creating archive');
  expect(uiText()).toContain('Creating archive…');
  expect(uiText()).toContain('Deleted from disk');
  await act(async () => Simulate.click(container.querySelector('.archive-period-select')));
  expect(container.querySelector('input[type="date"]').value).toBe('2025-01-01');
  expect(container.querySelector('datalist').textContent).toContain('Administrator');
  await render(false);
  expect(container.textContent).toContain('Доступные периоды');
  expect(container.querySelector('input[type="date"]').value).toBe('2025-01-01');
  await render();
  expect(container.textContent).toContain('Available periods');
  expect(uiText().replaceAll(employee.full_name, '').replaceAll(employee.login, '')).not.toMatch(/[а-яё]/i);
});

test('test-mode empty state with counts and earliest date is fully English', async () => {
  initializeUserPreferences('admin', { auditTestMode: true });
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ periods: [], source: { totalCount: 5, firstAt: '2025-01-01T12:00:00Z' } }) });
  await render();
  expect(uiText()).toContain('Test months, including the current month');
  expect(uiText()).toContain('Total records: 5. Earliest:');
  expect(uiText()).not.toMatch(/[а-яё]/i);
});

test('server error is translated at render and switches back to Russian', async () => {
  authFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Не удалось загрузить периоды' }) });
  await render();
  expect(container.querySelector('[role="alert"]').textContent).toBe('Could not load periods');
  await render(false);
  expect(container.querySelector('[role="alert"]').textContent).toBe('Не удалось загрузить периоды');
});

test('English delete confirmation uses DELETE and preserves the server confirmation contract', async () => {
  await render();
  const prompt = jest.spyOn(window, 'prompt').mockReturnValue('wrong');
  try {
    const button = container.querySelector('.archive-period-actions .danger');
    await act(async () => Simulate.click(button));
    expect(prompt).toHaveBeenCalledWith('Conversations, posts and files for 2025-01 will be deleted. Type DELETE');
    expect(authFetch.mock.calls.some(([url]) => url.includes('/purge'))).toBe(false);
    prompt.mockReturnValue('DELETE');
    await act(async () => Simulate.click(button));
    expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('/2025-01/purge'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'month', confirmation: 'УДАЛИТЬ' }) }));
  } finally { prompt.mockRestore(); }
});

test('search result text and filename stay original while the media viewer and error translate', async () => {
  await render();
  await act(async () => Simulate.click(container.querySelector('.archive-period-select')));
  await act(async () => Simulate.click(container.querySelector('.audit-participant-options button')));
  await act(async () => jest.advanceTimersByTime(0));
  expect(container.textContent).toContain('Feed posts');
  expect(container.querySelector('.audit-message-text').textContent).toBe('Все заявки');
  await act(async () => Simulate.click(container.querySelector('.test-attachment')));
  const viewer = container.querySelector('[role="dialog"]');
  expect(viewer.textContent).toContain('спектр.jpg');
  expect(viewer.textContent).toContain('The file is unavailable for preview');
  expect(viewer.querySelector('button').getAttribute('aria-label')).toBe('Close');
  await render(false);
  expect(viewer.textContent).toContain('Файл недоступен для просмотра');
  expect(container.querySelector('.audit-message-text').textContent).toBe('Все заявки');
});
