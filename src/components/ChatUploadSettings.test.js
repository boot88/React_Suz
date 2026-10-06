/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM createRoot needs act; this test does not use Testing Library. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import ChatUploadSettings from './ChatUploadSettings';
import { initializeUserPreferences } from '../utils/userPreferences';
import { authFetch } from '../utils/authFetch';

jest.mock('../utils/authFetch', () => ({ authFetch: jest.fn() }));

test('editing the limit leaves it unchanged until a successful Save', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('authState', JSON.stringify({ user: { username: 'admin' } }));
  initializeUserPreferences('admin', { chatAppearanceVersion: 1, uiLanguage: 'ru' });
  authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ limitMb: 10 }) });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<ChatUploadSettings />); });
    const input = container.querySelector('input');
    act(() => { Simulate.change(input, { target: { value: '150' } }); });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Сейчас действует: 10 МБ');
    authFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Ошибка сохранения' }) });
    await act(async () => { Simulate.submit(container.querySelector('form')); });
    expect(container.textContent).toContain('Сейчас действует: 10 МБ');
    expect(container.textContent).toContain('Ошибка сохранения');
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ limitMb: 150 }) });
    await act(async () => { Simulate.submit(container.querySelector('form')); });
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining('/settings/chat-upload-limit'), expect.objectContaining({ method: 'PUT', body: JSON.stringify({ limitMb: 150 }) }));
    expect(container.textContent).toContain('Сейчас действует: 150 МБ');
  } finally {
    act(() => { root.unmount(); });
    container.remove();
    localStorage.clear();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
