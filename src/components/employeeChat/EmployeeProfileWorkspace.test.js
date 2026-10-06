/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EmployeeProfileWorkspace from './EmployeeProfileWorkspace';
let root, container;
const noop = () => {};
const props = {
  AuthenticatedAvatar: ({ fallback }) => fallback, ChatAppearanceSettings: () => null,
  CHAT_DENSITIES: [], CHAT_TEXT_SIZES: [], CHAT_THEMES: [], avatarInputRef: { current: null }, avatarUrl: '', changeMyPassword: noop,
  chatLocalSettings: {}, getOptionLabel: noop, handleLogout: noop, isAdmin: false, isEnglishInterface: true, passwordForm: {},
  profileForm: { full_name: 'Alice Employee', position: 'Engineer', department: 'Lab', room: '10', phone: '123', external_phone: '456', bio: '', statusText: '' },
  profilePreview: null, profileViewLogin: '', removeAvatar: noop, saveMyProfile: noop, setActiveTab: noop, setPasswordForm: noop,
  setProfileViewLogin: noop, setSelectedEmail: noop, t: value => value, toggleDialogToolSetting: noop, toggleFeedToolSetting: noop,
  updateChatUiSetting: noop, updateProfileField: noop, user: { username: 'alice-login' },
  profileState: { fields: {} }, profileDirty: false, loadProfile: noop, openProfileCard: noop, restoreDraft: noop, discardChanges: noop, resolveConflict: noop
};
beforeEach(() => { window.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); delete window.IS_REACT_ACT_ENVIRONMENT; });
test('directory details are read-only, real login is visible and passwords have labels and autocomplete', async () => {
  await act(async () => root.render(<EmployeeProfileWorkspace {...props} />));
  const serviceInputs = [...container.querySelectorAll('input[readonly]')];
  expect(serviceInputs.map(input => input.value)).toContain('alice-login'); expect(serviceInputs).toHaveLength(7);
  expect(container.textContent).toContain('Contact an administrator');
  const passwords = [...container.querySelectorAll('input[type=password]')]; expect(passwords).toHaveLength(3);
  expect(passwords.map(input => input.autocomplete)).toEqual(['current-password', 'new-password', 'new-password']);
  expect(passwords.every(input => input.closest('label').textContent.length > 0)).toBe(true);
  expect(container.querySelector('textarea').maxLength).toBe(2000);
});
test('loading another employee never displays the own-profile form, and empty status stays empty', async () => {
  await act(async () => root.render(<EmployeeProfileWorkspace {...props} profileViewLogin="bob" profileState={{ previewLoading: true }} />));
  expect(container.querySelector('textarea')).toBeNull(); expect(container.querySelector('[role=status]')).not.toBeNull();
  await act(async () => root.render(<EmployeeProfileWorkspace {...props} profileViewLogin="bob" profilePreview={{ login: 'bob', full_name: 'Bob', statusText: '', bio: 'First\nSecond' }} />));
  expect(container.querySelector('.profile-status-pill')).toBeNull(); expect(container.querySelector('.profile-bio-text').textContent).toBe('First\nSecond');
});
