/* eslint-disable testing-library/no-node-access, testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from './App';
import { authFetch } from './utils/authFetch';
jest.mock('./utils/authFetch', () => ({ authFetch: jest.fn() }));
let mockUser;
jest.mock('./context/AuthContext', () => ({ useAuth: () => ({ user: mockUser, logout: jest.fn() }) }));
jest.mock('./pages/EmployeeChat', () => () => null);
jest.mock('./pages/Statistics', () => () => null);
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));
let root, container, visibility;
const originalEventSource = window.EventSource;
beforeEach(() => {
  jest.useFakeTimers();
  window.IS_REACT_ACT_ENVIRONMENT = true;
  document.title = 'НИОХ Система — центр управления';
  mockUser = { username: 'admin', name: 'Admin' };
  visibility = 'visible';
  jest.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  window.EventSource = originalEventSource;
  act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); jest.useRealTimers(); delete window.IS_REACT_ACT_ENVIRONMENT;
});
test('sidebar pauses chat polling but keeps request notifications active in a background tab', async () => {
  await act(async () => root.render(<Sidebar language="en" />));
  expect(authFetch).toHaveBeenCalledTimes(2);
  await act(async () => jest.advanceTimersByTime(1000));
  expect(authFetch).toHaveBeenCalledTimes(2);
  visibility = 'hidden';
  await act(async () => jest.advanceTimersByTime(15000));
  expect(authFetch.mock.calls.filter(([url]) => url.includes('/chat/threads/unread-count'))).toHaveLength(1);
  expect(authFetch.mock.calls.length).toBeGreaterThan(2);
  const callsBeforeVisible = authFetch.mock.calls.length;
  visibility = 'visible';
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(authFetch).toHaveBeenCalledTimes(callsBeforeVisible + 2);
});
test('sidebar coalesces overlapping refreshes without concurrent requests for a counter', async () => {
  const finish = [];
  authFetch.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  await act(async () => root.render(<Sidebar language="en" />));
  act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('applications:refresh')); jest.advanceTimersByTime(5000); });
  expect(authFetch).toHaveBeenCalledTimes(2);
  await act(async () => finish[0]({ ok: true, json: async () => ({ count: 1 }) }));
  expect(authFetch).toHaveBeenCalledTimes(3);
  await act(async () => finish[1]({ ok: true, json: async () => ({ count: 2 }) }));
  expect(authFetch).toHaveBeenCalledTimes(4);
});

test('server events update the badge and browser title while hidden, and zero restores the title', async () => {
  mockUser.accessToken = 'test-token';
  const listeners = {};
  const stream = { addEventListener: (name, listener) => { listeners[name] = listener; }, close: jest.fn() };
  window.EventSource = jest.fn(() => stream);
  let count = 0;
  authFetch.mockImplementation(async url => ({ ok: true, json: async () => ({ count: url.includes('unseen-count') ? count : 0 }) }));
  await act(async () => root.render(<Sidebar language="en" />));
  expect(document.title).toBe('НИОХ Система — центр управления');
  visibility = 'hidden'; count = 3;
  await act(async () => listeners.application());
  expect(document.title).toBe('(3) НИОХ Система — центр управления');
  expect(container.querySelector('.nav-badge').textContent).toBe('3');
  count = 2;
  await act(async () => listeners.application());
  expect(document.title).toBe('(2) НИОХ Система — центр управления');
  count = 0;
  await act(async () => listeners.application());
  expect(document.title).toBe('НИОХ Система — центр управления');
  expect(container.querySelector('.nav-badge')).toBeNull();
});

test('late responses from a previous account cannot restore its title notification', async () => {
  let finish;
  authFetch.mockImplementation(url => url.includes('unseen-count') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ count: 0 }) }));
  await act(async () => root.render(<Sidebar language="en" />));
  const finishOld = finish;
  mockUser = { username: 'another-admin', name: 'Admin' };
  await act(async () => root.render(<Sidebar language="en" />));
  await act(async () => finishOld({ ok: true, json: async () => ({ count: 9 }) }));
  expect(document.title).toBe('НИОХ Система — центр управления');
  await act(async () => finish({ ok: true, json: async () => ({ count: 1 }) }));
  expect(document.title).toBe('(1) НИОХ Система — центр управления');
});
