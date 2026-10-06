import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../utils/apiConfig';
import { authFetch } from '../../utils/authFetch';
import { applyProfileSave, personalFields, profilePatch, readPersonalDraft, validatePersonalProfile, writePersonalDraft } from '../../utils/profileDraft';
import { getAvatarKey, readProfileDraft, resolveAttachmentUrl, saveProfileDraft } from './chatPresentation';

export default function useEmployeeProfile({ user, active, english, onProfileSaved }) {
  const initial = { full_name: user?.name || '', position: user?.position || '', department: '', room: '', phone: '', external_phone: '', bio: '', statusText: '' };
  const [profileForm, setForm] = useState(initial);
  const [avatarUrl, setAvatar] = useState('');
  const [profileViewLogin, setProfileViewLogin] = useState('');
  const [profilePreview, setProfilePreview] = useState(null);
  const [profileState, setState] = useState({ loading: true, saving: false, avatarBusy: false, error: '', message: '', fields: {}, conflict: null, draft: null, storageError: false, previewLoading: false, previewError: '' });
  const [pendingAvatar, setPendingAvatar] = useState(null);
  const formRef = useRef(initial), baseRef = useRef(null), saveBusy = useRef(false), avatarBusy = useRef(false);
  const requests = useRef({ own: 0, preview: 0 });
  const controllers = useRef({}), avatarEpoch = useRef(0), mounted = useRef(true), cropUrl = useRef(''), personalEpoch = useRef(0), avatarRef = useRef('');
  const dirty = Boolean(baseRef.current && Object.keys(profilePatch(baseRef.current, profileForm)).length);
  const copy = useCallback((ru, en) => english ? en : ru, [english]);
  const status = useCallback(patch => { if (mounted.current) setState(prev => ({ ...prev, ...patch })); }, []);
  const commitForm = useCallback(next => { formRef.current = next; setForm(next); }, []);
  const persist = useCallback(next => {
    if (!baseRef.current) return;
    status({ storageError: !writePersonalDraft(user.username, baseRef.current, next) });
  }, [status, user.username]);
  const syncAvatar = useCallback(source => {
    const avatar = resolveAttachmentUrl(source || '');
    avatarRef.current = avatar; setAvatar(avatar);
    // Explicit empty server values also clear the old browser cache.
    try { if (avatar) localStorage.setItem(getAvatarKey(user.username), avatar); else localStorage.removeItem(getAvatarKey(user.username)); } catch { status({ storageError: true }); }
    return avatar;
  }, [status, user.username]);
  const requestProfile = useCallback(async (login, mode) => {
    controllers.current[mode]?.abort();
    const controller = new AbortController(); controllers.current[mode] = controller;
    const version = ++requests.current[mode];
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/profile?login=${encodeURIComponent(login)}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Profile load failed');
      if (!data.profile || !Number.isSafeInteger(data.profile.version)) throw new Error('Invalid profile response');
      return mounted.current && version === requests.current[mode] ? { ...data.profile } : null;
    } catch (error) {
      if (!mounted.current || version !== requests.current[mode]) throw Object.assign(new Error('Stale profile request'), { name: 'AbortError' });
      if (timedOut) throw new Error('Profile request timed out');
      throw error;
    } finally { clearTimeout(timeout); }
  }, []);
  const loadProfile = useCallback(async () => {
    status({ loading: true, error: '' });
    const epoch = avatarEpoch.current, revision = personalEpoch.current;
    try {
      const profile = await requestProfile(user.username, 'own');
      if (!profile) return;
      if (revision !== personalEpoch.current || saveBusy.current) { status({ loading: false }); return; }
      const acceptAvatar = epoch === avatarEpoch.current && !avatarBusy.current;
      if (!acceptAvatar) profile.avatar = avatarRef.current;
      const edited = baseRef.current && Object.keys(profilePatch(baseRef.current, formRef.current)).length > 0;
      let next = { ...profile };
      if (edited) next = { ...next, ...personalFields(formRef.current) };
      else {
        baseRef.current = profile;
        let draft = readPersonalDraft(user.username);
        if (!draft) {
          const legacy = readProfileDraft(user.username);
          const patch = profilePatch(profile, { ...profile, ...legacy });
          if (Object.keys(patch).length) draft = { version: profile.version, base: personalFields(profile), patch };
        }
        status({ draft });
      }
      commitForm(next);
      if (acceptAvatar) syncAvatar(profile.avatar);
      saveProfileDraft(user.username, profile);
      onProfileSaved(profile);
      status({ loading: false });
    } catch (error) {
      if (error.name !== 'AbortError') status({ loading: false, error: copy('Не удалось загрузить профиль. Проверьте соединение и повторите попытку.', 'Could not load profile. Check your connection and retry.') });
    }
  }, [commitForm, copy, onProfileSaved, requestProfile, status, syncAvatar, user.username]);
  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => {
    if (!active) return undefined;
    const refresh = () => { if (document.visibilityState !== 'hidden') loadProfile(); };
    refresh();
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    const interval = setInterval(refresh, 60000);
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [active, loadProfile]);
  useEffect(() => {
    mounted.current = true;
    const pending = controllers.current;
    return () => { mounted.current = false; Object.values(pending).forEach(controller => controller.abort()); if (cropUrl.current) URL.revokeObjectURL(cropUrl.current); };
  }, []);
  useEffect(() => {
    const leave = event => {
      if (!baseRef.current || !Object.keys(profilePatch(baseRef.current, formRef.current)).length) return;
      event.preventDefault(); event.returnValue = '';
    };
    const link = event => {
      const anchor = event.target.closest?.('a[href]');
      if (!dirty || !anchor || anchor.target === '_blank' || event.ctrlKey || event.metaKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname && url.origin === window.location.origin) return;
      if (!window.confirm(copy('Есть несохранённые изменения профиля. Уйти со страницы?', 'You have unsaved profile changes. Leave this page?'))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', leave); document.addEventListener('click', link, true);
    return () => { window.removeEventListener('beforeunload', leave); document.removeEventListener('click', link, true); };
  }, [copy, dirty]);
  const updateProfileField = (field, value) => {
    if (!['bio', 'statusText'].includes(field) || !baseRef.current) return;
    const next = { ...formRef.current, [field]: value }; commitForm(next); persist(next); status({ message: '', fields: {} });
  };
  const restoreDraft = () => {
    const draft = profileState.draft;
    if (!draft || !baseRef.current) return;
    const patch = Object.fromEntries(Object.entries(draft.patch).filter(([key, value]) => ['bio', 'statusText'].includes(key) && typeof value === 'string'));
    const next = { ...formRef.current, ...patch }; commitForm(next); persist(next);
    // Reuse the original version: restoring a draft must not silently approve overwrites.
    if (draft.version !== baseRef.current.version) status({ conflict: { ...personalFields(baseRef.current), version: baseRef.current.version } });
    status({ draft: null, message: '' });
  };
  const discardChanges = () => {
    if (!baseRef.current) return;
    commitForm({ ...formRef.current, ...personalFields(baseRef.current) }); persist(baseRef.current); status({ draft: null, conflict: null, error: '', fields: {}, message: '' });
  };
  const resolveConflict = useServer => {
    const current = profileState.conflict;
    if (!current) return;
    const editedFields = profilePatch(baseRef.current, formRef.current);
    baseRef.current = { ...baseRef.current, ...current };
    commitForm({ ...formRef.current, ...personalFields(current), ...(useServer ? {} : editedFields) });
    persist(formRef.current); status({ conflict: null, error: '' });
  };
  const saveMyProfile = async event => {
    event?.preventDefault();
    if (saveBusy.current || !baseRef.current || profileState.conflict) return;
    const fields = validatePersonalProfile(formRef.current, english);
    if (Object.keys(fields).length) { status({ fields }); return; }
    const submitted = { ...formRef.current }, patch = profilePatch(baseRef.current, submitted);
    if (!Object.keys(patch).length) return;
    saveBusy.current = true; personalEpoch.current += 1; status({ saving: true, error: '', message: '' });
    const controller = new AbortController(); controllers.current.save = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...patch, version: baseRef.current.version }), signal: controller.signal });
      const data = await response.json();
      if (response.status === 409) { status({ conflict: data.current || null, error: copy('Профиль изменён в другом окне. Сравните данные перед сохранением.', 'Profile changed in another window. Compare the values before saving.') }); return; }
      if (!response.ok) { const error = new Error('Save failed'); error.fields = data.fields; throw error; }
      if (!data.profile || !Number.isSafeInteger(data.profile.version)) throw new Error('Invalid profile response');
      if (!mounted.current) return;
      baseRef.current = { ...baseRef.current, ...data.profile };
      const next = applyProfileSave(formRef.current, submitted, data.profile); commitForm(next); persist(next);
      saveProfileDraft(user.username, { ...baseRef.current, avatar: avatarRef.current });
      onProfileSaved({ ...baseRef.current, avatar: avatarRef.current });
      status({ message: copy('Личные сведения сохранены.', 'Personal information saved.'), fields: {} });
    } catch (error) { status({ error: copy('Не удалось сохранить профиль. Введённый текст остаётся в форме; повторите попытку.', 'Could not save profile. Your edits remain in the form; retry.'), fields: error.fields ? validatePersonalProfile(submitted, english) : {} }); }
    finally { clearTimeout(timeout); saveBusy.current = false; personalEpoch.current += 1; status({ saving: false }); }
  };
  const openProfileCard = async login => {
    setProfileViewLogin(login); setProfilePreview(null); status({ previewLoading: true, previewError: '' });
    try {
      const profile = await requestProfile(login, 'preview');
      if (profile) { setProfilePreview(profile); status({ previewLoading: false }); }
    } catch (error) { if (error.name !== 'AbortError') status({ previewLoading: false, previewError: copy('Не удалось открыть профиль. Повторите попытку.', 'Could not open profile. Retry.') }); }
  };
  const closePreview = () => { requests.current.preview += 1; controllers.current.preview?.abort(); setProfileViewLogin(''); setProfilePreview(null); };
  const cancelAvatar = () => { if (avatarBusy.current) return; if (cropUrl.current) URL.revokeObjectURL(cropUrl.current); cropUrl.current = ''; setPendingAvatar(null); };
  const handleAvatarUpload = event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || avatarBusy.current) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { status({ error: copy('Выберите PNG, JPG или WEBP размером до 5 МБ.', 'Choose a PNG, JPG or WEBP image up to 5 MB.') }); return; }
    cancelAvatar(); status({ error: '', message: '' }); cropUrl.current = URL.createObjectURL(file); setPendingAvatar({ src: cropUrl.current });
  };
  const saveAvatar = async blob => {
    if (avatarBusy.current || !blob || blob.size > 1024 * 1024) return;
    avatarBusy.current = true; avatarEpoch.current += 1; status({ avatarBusy: true, error: '', message: '' });
    const controller = new AbortController(); controllers.current.avatar = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/profile/avatar`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, signal: controller.signal });
      const data = await response.json(); if (!response.ok || !data.avatar) throw new Error('Avatar upload failed');
      if (!mounted.current) return;
      const avatar = syncAvatar(data.avatar); onProfileSaved({ login: user.username, avatar });
      saveProfileDraft(user.username, { ...baseRef.current, avatar });
      if (cropUrl.current) URL.revokeObjectURL(cropUrl.current); cropUrl.current = ''; setPendingAvatar(null);
      status({ message: copy('Фотография сохранена.', 'Photo saved.') });
    } catch { status({ error: copy('Не удалось сохранить фотографию. Повторите попытку.', 'Could not save photo. Retry.') }); }
    finally { clearTimeout(timeout); avatarBusy.current = false; avatarEpoch.current += 1; status({ avatarBusy: false }); }
  };
  const removeAvatar = async () => {
    if (avatarBusy.current) return;
    avatarBusy.current = true; avatarEpoch.current += 1; status({ avatarBusy: true, error: '', message: '' });
    const controller = new AbortController(); controllers.current.avatar = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/profile/avatar`, { method: 'DELETE', signal: controller.signal });
      if (!response.ok) throw new Error('Avatar delete failed');
      if (!mounted.current) return;
      syncAvatar(''); onProfileSaved({ login: user.username, avatar: '' }); saveProfileDraft(user.username, { ...baseRef.current, avatar: '' });
      status({ message: copy('Фотография удалена.', 'Photo removed.') });
    } catch { status({ error: copy('Не удалось удалить фотографию. Повторите попытку.', 'Could not remove photo. Retry.') }); }
    finally { clearTimeout(timeout); avatarBusy.current = false; avatarEpoch.current += 1; status({ avatarBusy: false }); }
  };
  return { profileForm, avatarUrl, profileViewLogin, profilePreview, profileState, dirty, pendingAvatar, updateProfileField, saveMyProfile, loadProfile, openProfileCard, setProfileViewLogin: closePreview, restoreDraft, discardChanges, resolveConflict, handleAvatarUpload, saveAvatar, removeAvatar, cancelAvatar };
}
