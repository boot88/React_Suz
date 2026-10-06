/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useProfilePassword from './useProfilePassword';
import { authFetch } from '../../utils/authFetch';
jest.mock('../../utils/authFetch', () => ({ authFetch: jest.fn() }));
let model, root, container;
const logout = jest.fn();
function Fixture({ role }) { model = useProfilePassword({ english: true, logout }); return <div data-role={role}>{model.passwordError}</div>; }
beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true; authFetch.mockReset(); logout.mockReset();
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); delete window.IS_REACT_ACT_ENVIRONMENT; });
const setup = async role => { await act(async () => root.render(<Fixture role={role} />)); await act(async () => model.setPasswordForm({ currentPassword: 'old-password', newPassword: 'new-password', confirmPassword: 'new-password' })); };
const submit = () => model.changeMyPassword({ preventDefault() {} });
test.each(['employee', 'admin'])('%s confirms a password change once and asks for a new sign-in', async role => {
  await setup(role); let finish;
  authFetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let pending; await act(async () => { pending = submit(); }); await act(async () => submit());
  expect(authFetch).toHaveBeenCalledTimes(1); expect(model.passwordBusy).toBe(true);
  await act(async () => { finish({ ok: true, json: async () => ({ message: 'OK' }) }); await pending; });
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Sign in again'));
  expect(logout).toHaveBeenCalledWith({ reason: 'expired' }); expect(model.passwordForm.newPassword).toBe('');
});
test('mismatching passwords prevent sending and network errors preserve the form for retry', async () => {
  await setup('employee'); await act(async () => model.setPasswordForm(prev => ({ ...prev, confirmPassword: 'different' })));
  await act(async () => submit()); expect(authFetch).not.toHaveBeenCalled(); expect(model.passwordError).toContain('do not match');
  await act(async () => model.setPasswordForm(prev => ({ ...prev, confirmPassword: 'new-password' })));
  authFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await act(async () => submit()); expect(model.passwordError).toContain('Could not confirm'); expect(logout).not.toHaveBeenCalled(); expect(model.passwordForm.newPassword).toBe('new-password');
});
