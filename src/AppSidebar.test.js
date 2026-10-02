/* eslint-disable testing-library/no-node-access, testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from './App';
import { authFetch } from './utils/authFetch';
jest.mock('./utils/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('./context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'admin', name: 'Admin' }, logout: jest.fn() }) }));
jest.mock('./pages/EmployeeChat', () => () => null);
jest.mock('./pages/Statistics', () => () => null);
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));
let root, container, visibility;
beforeEach(() => {
  jest.useFakeTimers();
  window.IS_REACT_ACT_ENVIRONMENT = true;
  visibility = 'visible';
  jest.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); jest.useRealTimers(); delete window.IS_REACT_ACT_ENVIRONMENT;
});
test('sidebar has one initial refresh, pauses hidden polling and refreshes on return', async () => {
  await act(async () => root.render(<Sidebar language="en" />));
  expect(authFetch).toHaveBeenCalledTimes(2);
  await act(async () => jest.advanceTimersByTime(1000));
  expect(authFetch).toHaveBeenCalledTimes(2);
  visibility = 'hidden';
  await act(async () => jest.advanceTimersByTime(15000));
  expect(authFetch).toHaveBeenCalledTimes(2);
  visibility = 'visible';
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(authFetch).toHaveBeenCalledTimes(4);
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
