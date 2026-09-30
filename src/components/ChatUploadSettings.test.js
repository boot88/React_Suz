/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM createRoot needs act; this test does not use Testing Library. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import ChatUploadSettings from './ChatUploadSettings';
import { authFetch } from '../utils/authFetch';

jest.mock('../utils/authFetch', () => ({ authFetch: jest.fn() }));

test('editing the limit leaves it unchanged until a successful Save', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ limitMb: 50 }) });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<ChatUploadSettings />); });
    const input = container.querySelector('input');
    act(() => { Simulate.change(input, { target: { value: '128' } }); });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Сейчас действует: 50 МБ');
    authFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Ошибка сохранения' }) });
    await act(async () => { Simulate.submit(container.querySelector('form')); });
    expect(container.textContent).toContain('Сейчас действует: 50 МБ');
    expect(container.textContent).toContain('Ошибка сохранения');
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ limitMb: 128 }) });
    await act(async () => { Simulate.submit(container.querySelector('form')); });
    expect(authFetch).toHaveBeenLastCalledWith(expect.stringContaining('/settings/chat-upload-limit'), expect.objectContaining({ method: 'PUT', body: JSON.stringify({ limitMb: 128 }) }));
    expect(container.textContent).toContain('Сейчас действует: 128 МБ');
  } finally {
    act(() => { root.unmount(); });
    container.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
