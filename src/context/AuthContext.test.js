/* eslint-disable testing-library/no-unnecessary-act -- Uses ReactDOM directly. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './AuthContext';
import { initializeUserPreferences, configurePreferenceSync } from '../utils/userPreferences';

jest.mock('../utils/userPreferences', () => ({
  initializeUserPreferences: jest.fn(), configurePreferenceSync: jest.fn(),
  stopPreferenceSync: jest.fn(), flushPreferenceSync: jest.fn().mockResolvedValue()
}));

let container, root;
const originalFetch = global.fetch;
const savedUser = { username: 'admin', name: 'Admin', role: 'admin', accessToken: 'saved-token' };
const Probe = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  return <output>{JSON.stringify({ isAuthenticated, isLoading, username: user?.username || '' })}</output>;
};
const state = () => JSON.parse(container.querySelector('output').textContent);
beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); jest.clearAllMocks();
  localStorage.setItem('authState', JSON.stringify({
    isAuthenticated: true, user: savedUser, expiresAt: Date.now() + 600000
  }));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); localStorage.clear();
  global.fetch = originalFetch; delete window.IS_REACT_ACT_ENVIRONMENT;
});

test('restoration does not reauthenticate a session rejected by the server', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  expect(state()).toEqual({ isAuthenticated: false, isLoading: false, username: '' });
  expect(localStorage.getItem('authState')).toBeNull();
  expect(configurePreferenceSync).not.toHaveBeenCalled();
});

test('a late profile response cannot undo logout while restoring a session', async () => {
  let finishProfile;
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { finishProfile = resolve; }));
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  await act(async () => window.dispatchEvent(new Event('auth:expired')));
  await act(async () => finishProfile({ ok: true, status: 200, json: async () => ({ profile: { preferences: {} } }) }));
  expect(state()).toEqual({ isAuthenticated: false, isLoading: false, username: '' });
  expect(localStorage.getItem('authState')).toBeNull();
  expect(initializeUserPreferences).not.toHaveBeenCalled();
});

test('restoration retains the local account during a temporary server outage', async () => {
  global.fetch.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}), clone: () => ({ json: async () => ({}) }) }));
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  expect(state()).toEqual({ isAuthenticated: true, isLoading: false, username: 'admin' });
  expect(configurePreferenceSync).toHaveBeenCalledWith('admin', 'saved-token');
});
