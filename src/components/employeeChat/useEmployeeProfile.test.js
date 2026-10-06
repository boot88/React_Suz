/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useEmployeeProfile from './useEmployeeProfile';
import { authFetch } from '../../utils/authFetch';
import { readPersonalDraft } from '../../utils/profileDraft';
jest.mock('../../utils/authFetch', () => ({ authFetch: jest.fn(), withAccessToken: url => url }));
const base = { login: 'alice', full_name: 'Alice', position: 'Engineer', bio: 'Original', statusText: 'Work', avatar: '/api/photo?rev=1', version: 0 };
const response = (profile = base) => ({ ok: true, status: 200, json: async () => ({ profile }) });
let root, container, model;
const onProfileSaved = jest.fn();
function Fixture({ role = 'employee' }) {
  model = useEmployeeProfile({ user: { username: 'alice', role }, active: false, english: false, onProfileSaved });
  return <div>{model.profileForm.bio}</div>;
}
beforeEach(() => {
  localStorage.clear(); authFetch.mockReset(); onProfileSaved.mockClear();
  authFetch.mockResolvedValue(response());
  window.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete window.IS_REACT_ACT_ENVIRONMENT; });
const render = async role => { await act(async () => root.render(<Fixture role={role} />)); };
const type = async value => { await act(async () => model.updateProfileField('bio', value)); };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test.each(['employee', 'admin'])('%s saves only changed personal values and preserves typing during a save', async role => {
  await render(role); await type('Sent');
  const pending = defer(); authFetch.mockReturnValueOnce(pending.promise);
  let saving; await act(async () => { saving = model.saveMyProfile(); });
  await act(async () => model.saveMyProfile());
  expect(authFetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT')).toHaveLength(1);
  expect(JSON.parse(authFetch.mock.calls.at(-1)[1].body)).toEqual({ bio: 'Sent', version: 0 });
  await type('Later typing');
  await act(async () => { pending.resolve(response({ bio: 'Sent', statusText: 'Work', version: 1 })); await saving; });
  expect(model.profileForm.bio).toBe('Later typing'); expect(model.dirty).toBe(true);
  expect(readPersonalDraft('alice')).toMatchObject({ version: 1, patch: { bio: 'Later typing' } });
  await act(async () => model.updateProfileField('full_name', 'Forged'));
  expect(model.profileForm.full_name).toBe('Alice');
});

test('refresh and repeat sign-in offer an unsaved draft without automatically overwriting server data', async () => {
  await render(); await type('Unsaved');
  act(() => root.unmount()); root = createRoot(container);
  await render(); expect(model.profileForm.bio).toBe('Original'); expect(model.profileState.draft.patch.bio).toBe('Unsaved');
  await act(async () => model.restoreDraft()); expect(model.profileForm.bio).toBe('Unsaved'); expect(model.dirty).toBe(true);
  await act(async () => model.discardChanges()); expect(readPersonalDraft('alice')).toBeNull(); expect(model.profileForm.bio).toBe('Original');
});

test('network failure keeps the form and draft available for retry', async () => {
  await render(); await type('Offline'); authFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await act(async () => model.saveMyProfile());
  expect(model.profileState.error).toContain('Не удалось сохранить'); expect(model.profileState.saving).toBe(false);
  expect(model.profileForm.bio).toBe('Offline'); expect(readPersonalDraft('alice').patch.bio).toBe('Offline');
});

test('conflict preserves text and requires an explicit choice before a new version can be saved', async () => {
  await render(); await type('Mine');
  authFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ current: { bio: 'Colleague', statusText: 'Away', version: 1 } }) });
  await act(async () => model.saveMyProfile());
  expect(model.profileForm.bio).toBe('Mine'); expect(model.profileState.conflict.bio).toBe('Colleague');
  await act(async () => model.resolveConflict(false));
  authFetch.mockResolvedValueOnce(response({ bio: 'Mine', statusText: 'Away', version: 2 }));
  await act(async () => model.saveMyProfile());
  expect(JSON.parse(authFetch.mock.calls.at(-1)[1].body)).toEqual({ bio: 'Mine', version: 1 });
  expect(model.dirty).toBe(false);
});

test('late profile cards and errors cannot replace the last selected employee', async () => {
  await render(); const first = defer(), second = defer();
  authFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let a, b; await act(async () => { a = model.openProfileCard('bob'); b = model.openProfileCard('carol'); });
  await act(async () => { second.resolve(response({ ...base, login: 'carol' })); await b; });
  await act(async () => { first.resolve(response({ ...base, login: 'bob' })); await a; });
  expect(model.profilePreview.login).toBe('carol'); expect(model.profileViewLogin).toBe('carol');
});

test('an explicit avatar removal on another device clears browser cache on refresh', async () => {
  await render(); expect(model.avatarUrl).toContain('rev=1');
  authFetch.mockResolvedValueOnce(response({ ...base, avatar: '' }));
  await act(async () => model.loadProfile());
  expect(model.avatarUrl).toBe(''); expect(localStorage.getItem('employeeAvatar:alice')).toBeNull();
});

test('an old profile refresh cannot roll back a completed save', async () => {
  await render(); const pending = defer(); authFetch.mockReturnValueOnce(pending.promise);
  let refresh; await act(async () => { refresh = model.loadProfile(); });
  await type('New'); authFetch.mockResolvedValueOnce(response({ bio: 'New', statusText: 'Work', version: 1 }));
  await act(async () => model.saveMyProfile());
  await act(async () => { pending.resolve(response(base)); await refresh; });
  expect(model.profileForm.bio).toBe('New'); expect(model.dirty).toBe(false);
});

test('quota failure is visible and never discards the entered text', async () => {
  await render(); const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  await type('Keep me'); expect(model.profileState.storageError).toBe(true); expect(model.profileForm.bio).toBe('Keep me'); spy.mockRestore();
});

test('photo upload cannot be rolled back by an earlier profile refresh or an unrelated text save', async () => {
  await render(); const old = defer(); authFetch.mockReturnValueOnce(old.promise);
  let refresh; await act(async () => { refresh = model.loadProfile(); });
  authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ avatar: '/api/photo?rev=2' }) });
  await act(async () => model.saveAvatar(new Blob(['photo'], { type: 'image/jpeg' })));
  await act(async () => { old.resolve(response(base)); await refresh; });
  expect(model.avatarUrl).toContain('rev=2');
  expect(onProfileSaved.mock.calls.at(-1)[0].avatar).toContain('rev=2');
  await type('With my photo'); authFetch.mockResolvedValueOnce(response({ bio: 'With my photo', statusText: 'Work', version: 1 }));
  await act(async () => model.saveMyProfile());
  expect(model.avatarUrl).toContain('rev=2');
  expect(JSON.parse(authFetch.mock.calls.at(-1)[1].body)).toEqual({ version: 0, bio: 'With my photo' });
});

test('load errors are visible and an unsaved edit triggers the browser leave warning', async () => {
  authFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await render(); expect(model.profileState.error).toContain('Не удалось загрузить');
  authFetch.mockResolvedValueOnce(response()); await act(async () => model.loadProfile()); await type('Unsaved');
  const leave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(true);
});
