/* eslint-disable testing-library/no-unnecessary-act -- Uses ReactDOM directly. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import Login from './Login';
import { useAuth } from '../context/AuthContext';
jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn(), useLocation: () => ({}), Link: ({ children, to }) => require('react').createElement('a', { href: to }, children) }));
let root;
let container;
let login;
const originalFetch = global.fetch;
beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear();
  localStorage.setItem('loginDesign', 'current'); localStorage.setItem('loginLanguage', 'ru');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) });
  login = jest.fn().mockResolvedValue({ role: 'employee' });
  useAuth.mockReturnValue({ login, logout: jest.fn(), isAuthenticated: false, isLoading: false, user: null });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); global.fetch = originalFetch; delete window.IS_REACT_ACT_ENVIRONMENT; });

test.each(['employee', 'admin'])('the %s login starts with Service/English and passes an explicit Russian selection into the account', async (mode) => {
  if (mode === 'admin') login.mockResolvedValue({ role: 'admin' });
  await act(async () => root.render(<Login mode={mode} />));
  expect(container.querySelector('.jp-wrapper').className).toContain('jp-wrapper--design-service');
  expect(container.querySelector('.jp-wrapper').getAttribute('lang')).toBe('en');
  await act(async () => Simulate.click(container.querySelectorAll('.jp-language-switch button')[1]));
  expect(container.querySelector('.jp-wrapper').getAttribute('lang')).toBe('ru');
  act(() => {
    Simulate.change(container.querySelector('input[type="text"]'), { target: { value: 'employee' } });
    Simulate.change(container.querySelector('input[type="password"]'), { target: { value: 'password' } });
  });
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(login).toHaveBeenCalledWith('employee', 'password', expect.objectContaining({ scope: mode, language: 'ru' }));
});
