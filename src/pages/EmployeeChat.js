import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { MANAGER_CREDENTIALS } from '../config/authConfig';
import './EmployeeChat.css';

const CHAT_READ_STATE_KEY = 'chatReadState';
const EMPLOYEE_DIRECTORY_CACHE_KEY = 'employeeDirectoryCache';
const MANAGER_TEMPLATE_MESSAGES = ['✅ Принято в работу', '🔧 Проверяю сейчас', '👍 Спасибо, получил', '📌 Уточните, пожалуйста, детали', '⏱️ Вернусь с ответом в течение 15 минут', '🧩 Проблема воспроизведена, исправляю'];
const EMPLOYEE_TEMPLATE_MESSAGES = ['Привет! 👋', 'Как дела? 🙂', 'Спасибо большое! 🙏', 'Отлично, договорились ✅', 'Я на месте, можем созвониться? 📞', 'Хорошего дня! ☀️'];
const REACTION_EMOJIS = ['👍', '✅', '🔧'];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const EMPLOYEE_TABS = [
  { id: 'chat', label: 'Чат' },
  { id: 'request', label: 'Заявка' },
  { id: 'feed', label: 'Лента' },
  { id: 'profile', label: 'Профиль' }
];
const MANAGER_TABS = [
  ...EMPLOYEE_TABS,
  { id: 'employees', label: 'Сотрудники' },
  { id: 'audit', label: 'Аудит' }
];
const REQUEST_CATEGORIES = ['Техника', 'Сеть', 'ПО', 'Доступы', 'Другое'];
const REQUEST_PRIORITIES = ['Обычный', 'Важный', 'Срочный'];

const getConversationId = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('::');
const getParticipantsFromThreadId = (threadId = '') => threadId.split('::').filter(Boolean);
const getAvatarKey = (username = 'unknown') => `employeeAvatar:${username.toLowerCase()}`;
const getGreetingKey = (username = 'unknown') => `employeeGreetingSeen:${username.toLowerCase()}`;
const getProfileDraftKey = (username = 'unknown') => `employeeProfileDraft:${username.toLowerCase()}`;

const createMessageId = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

const readReadState = (username) => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_READ_STATE_KEY) || '{}');
    return all?.[username] && typeof all[username] === 'object' ? all[username] : {};
  } catch {
    return {};
  }
};

const saveReadState = (username, nextState) => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_READ_STATE_KEY) || '{}');
    all[username] = nextState;
    localStorage.setItem(CHAT_READ_STATE_KEY, JSON.stringify(all));
  } catch {
    // noop
  }
};

const readDirectoryCache = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMPLOYEE_DIRECTORY_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveDirectoryCache = (items) => {
  try {
    localStorage.setItem(EMPLOYEE_DIRECTORY_CACHE_KEY, JSON.stringify(items));
  } catch {
    // noop
  }
};

const readProfileDraft = (username) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(getProfileDraftKey(username)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};


const getProfileValue = (profile, fallback, ...keys) => {
  for (const key of keys) {
    const value = profile?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  for (const key of keys) {
    const value = fallback?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const saveProfileDraft = (username, profile) => {
  try {
    localStorage.setItem(getProfileDraftKey(username), JSON.stringify(profile));
  } catch {
    // noop
  }
};

const processAvatar = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const minSide = Math.min(image.width, image.height);
      const sx = (image.width - minSide) / 2;
      const sy = (image.height - minSide) / 2;
      ctx.drawImage(image, sx, sy, minSide, minSide, 0, 0, size, size);

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    image.onerror = reject;
    image.src = String(reader.result || '');
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});


const normalizeText = (value = '') => String(value || '').toLowerCase().trim();

const formatDateLabel = (dateValue) => {
  const date = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const key = date.toDateString();
  if (key === today.toDateString()) return 'Сегодня';
  if (key === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const getDateKey = (dateValue) => new Date(dateValue).toDateString();

const getFileIcon = (type = '') => {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.includes('pdf')) return '📕';
  if (type.includes('word')) return '📘';
  if (type.includes('excel') || type.includes('sheet')) return '📗';
  return '📎';
};

const EmployeeChat = () => {
  const { user, logout, employeeDirectory } = useAuth();
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const baseDisplayName = user?.name || user?.username || 'Сотрудник';
  const isAdmin = user?.role === 'admin';
   
  const avatarInputRef = useRef(null); 
  const profileDirtyRef = useRef(false);
  const profileLoadedForRef = useRef('');
   
  const [threads, setThreads] = useState({});
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draft, setDraft] = useState('');
  const [attachmentDrafts, setAttachmentDrafts] = useState([]);
  const [search, setSearch] = useState('');
  const [dialogSearch, setDialogSearch] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  
  const [replyTo, setReplyTo] = useState(null);
  const [readState, setReadState] = useState(() => readReadState(user?.username || 'guest'));
  const [directoryEmployees, setDirectoryEmployees] = useState(() => readDirectoryCache());
  const [isDirectoryLoaded, setIsDirectoryLoaded] = useState(() => readDirectoryCache().length > 0);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [headerName, setHeaderName] = useState(baseDisplayName);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [profileViewLogin, setProfileViewLogin] = useState('');
  const [profilePreview, setProfilePreview] = useState(null);
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    department: '',
    phone: '',
    room: '',
    position: '',
    bio: '',
    website: '',
    statusText: ''
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [requestText, setRequestText] = useState('');
  const [requestCategory, setRequestCategory] = useState(REQUEST_CATEGORIES[0]);
  const [requestPriority, setRequestPriority] = useState(REQUEST_PRIORITIES[0]);
  const [requestStatus, setRequestStatus] = useState({ state: 'idle', text: 'Черновик', ticketId: '' });
  const [feedPosts, setFeedPosts] = useState([]);
  const [feedDraft, setFeedDraft] = useState('');
  const [feedAttachment, setFeedAttachment] = useState(null);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [modal, setModal] = useState(null);
  const modalResolverRef = useRef(null);
  const messagesWrapRef = useRef(null);
  const forceScrollRef = useRef(false);

  const openModal = useCallback((config) => new Promise((resolve) => {
    modalResolverRef.current = resolve;
    setModal({ value: config.defaultValue || '', ...config });
  }), []);

  const closeModal = useCallback((result) => {
    const resolver = modalResolverRef.current;
    modalResolverRef.current = null;
    setModal(null);
    if (resolver) resolver(result);
  }, []);

  const notify = useCallback((message, title = 'Готово') => {
    setModal({ type: 'info', title, message });
  }, []);

  const confirmAction = useCallback((message, title = 'Подтверждение') => openModal({ type: 'confirm', title, message }), [openModal]);

  const promptAction = useCallback((message, defaultValue = '', title = 'Редактирование') => openModal({
    type: 'prompt',
    title,
    message,
    defaultValue
  }), [openModal]);

  const updateProfileField = useCallback((field, value) => {
    profileDirtyRef.current = true;
    setProfileForm((prev) => {
      const next = { ...prev, [field]: value };
      if (user?.username) {
        saveProfileDraft(user.username, { ...next, avatar: avatarUrl });
      }
      return next;
    });
  }, [avatarUrl, user?.username]);

  const [employeeForm, setEmployeeForm] = useState({
    id: null,
    login: '',
    password: '',
    full_name: '',
    department: '',
    phone: '',
    room: ''
  });


  const currentConversationId = selectedEmail ? getConversationId(user.username, selectedEmail) : null;
  const templateMessages = isManager ? MANAGER_TEMPLATE_MESSAGES : EMPLOYEE_TEMPLATE_MESSAGES;
  const currentMessages = useMemo(() => (
    currentConversationId ? (threads[currentConversationId] || []) : []
  ), [currentConversationId, threads]);
  const selectedThreadMessages = selectedThreadId ? (threads[selectedThreadId] || []) : [];

  const pinnedMessages = useMemo(
    () => currentMessages.filter((message) => message.pinned),
    [currentMessages]
  );

  useEffect(() => {
    setReadState(readReadState(user?.username || 'guest'));
  }, [user?.username]);

  useEffect(() => {
    if (!user?.username) return;
    const cachedAvatar = localStorage.getItem(getAvatarKey(user.username)) || '';
    if (cachedAvatar) {
      setAvatarUrl(cachedAvatar);
    }
    const hasSeenGreeting = sessionStorage.getItem(getGreetingKey(user.username)) === '1';
    if (hasSeenGreeting) {
      setHeaderName(baseDisplayName);
      return undefined;
    }

    const greeting = `Здравствуйте, ${baseDisplayName}!`;
    setHeaderName(greeting);
    sessionStorage.setItem(getGreetingKey(user.username), '1');
    const timer = setTimeout(() => setHeaderName(baseDisplayName), 3000);
    return () => clearTimeout(timer);
  }, [baseDisplayName, user?.username]);

  const handleLogout = () => {
    if (user?.username) {
      sessionStorage.removeItem(getGreetingKey(user.username));
    }
    logout();
  };

  const loadProfile = useCallback(async (login, mode = 'form') => {
    const response = await fetch(`${API_BASE_URL}/auth/profile?login=${encodeURIComponent(login)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Не удалось загрузить анкету');
    }

    const profile = data?.profile || {};
    const cachedProfile = readProfileDraft(login);
    const directoryProfile = directoryEmployees.find((employee) => employee.login === login) || {};
    const mergedProfile = {
      full_name: getProfileValue(profile, cachedProfile, 'full_name', 'fullName', 'name'),
      department: getProfileValue(profile, cachedProfile, 'department'),
      phone: getProfileValue(profile, cachedProfile, 'phone', 'internalPhone', 'internal_phone', 'N_tel'),
      room: getProfileValue(profile, cachedProfile, 'room', 'cabinet'),
      position: getProfileValue(profile, cachedProfile, 'position'),
      bio: getProfileValue(profile, cachedProfile, 'bio'),
      website: getProfileValue(profile, cachedProfile, 'website'),
      statusText: getProfileValue(profile, cachedProfile, 'statusText', 'status_text'),
      avatar: getProfileValue(profile, cachedProfile, 'avatar')
    };

    if (!mergedProfile.full_name) mergedProfile.full_name = directoryProfile.full_name || '';
    if (!mergedProfile.department) mergedProfile.department = directoryProfile.department || '';
    if (!mergedProfile.phone) mergedProfile.phone = directoryProfile.phone || directoryProfile.internal_phone || directoryProfile.N_tel || '';
    if (!mergedProfile.room) mergedProfile.room = directoryProfile.room || directoryProfile.cabinet || '';
    if (mode === 'form') {
      const shouldHydrateForm = !profileDirtyRef.current || profileLoadedForRef.current !== login;

      if (shouldHydrateForm) {
        setProfileForm({
          full_name: mergedProfile.full_name,
          department: mergedProfile.department,
          phone: mergedProfile.phone,
          room: mergedProfile.room,
          position: mergedProfile.position,
          bio: mergedProfile.bio,
          website: mergedProfile.website,
          statusText: mergedProfile.statusText
        });
        profileLoadedForRef.current = login;
        saveProfileDraft(login, mergedProfile);
      }

      const nextAvatar = mergedProfile.avatar || '';
      setAvatarUrl(nextAvatar);
      if (nextAvatar) localStorage.setItem(getAvatarKey(user.username), nextAvatar);
      else localStorage.removeItem(getAvatarKey(user.username));
      return;
    }

    setProfilePreview(profile);
  }, [directoryEmployees, user.username]);

  const fetchThreads = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/threads`);
      if (!response.ok) return;
      const data = await response.json();
      setThreads(data?.threads && typeof data.threads === 'object' ? data.threads : {});
    } catch (error) {
      console.error('Ошибка загрузки переписки:', error);
    }
  }, []);

  const fetchFeed = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить ленту');
      setFeedPosts(Array.isArray(data?.posts) ? data.posts : []);
    } catch (error) {
      console.error('Ошибка загрузки ленты:', error);
      notify(error.message || 'Не удалось загрузить ленту', 'Лента');
    }
  }, [notify]);

  const persistFeedPosts = useCallback(async (nextPosts) => {
    const response = await fetch(`${API_BASE_URL}/chat/feed`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts: nextPosts })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Не удалось сохранить ленту');
    setFeedPosts(Array.isArray(data?.posts) ? data.posts : nextPosts);
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/employees`);
      if (!response.ok) {
        setIsDirectoryLoaded(true);
        return;
      }
      const data = await response.json();
      const employees = Array.isArray(data?.employees) ? data.employees : [];
      setDirectoryEmployees(employees);
      saveDirectoryCache(employees);
    } catch (error) {
      console.error('Ошибка загрузки сотрудников:', error);
    } finally {
      setIsDirectoryLoaded(true);
    }
  }, []);

  const persistThreadMessages = useCallback(async (conversationId, messages) => {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.message || 'Не удалось сохранить сообщение');
        }

        if (data?.threads && typeof data.threads === 'object') {
          setThreads(data.threads);
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await sleep(350);
        }
      }
    }

    throw lastError || new Error('Не удалось сохранить сообщение');
  }, []);

  useEffect(() => {
    fetchThreads();
    fetchEmployees();
    fetchFeed();

    const poller = setInterval(() => {
      fetchThreads();
      fetchEmployees();
      fetchFeed();
    }, 3000);

    return () => clearInterval(poller);
  }, [fetchThreads, fetchEmployees, fetchFeed]);

  useEffect(() => {
    if (!user?.username) return;
    loadProfile(user.username, 'form').catch((error) => {
      console.error('Profile bootstrap error:', error);
    });
  }, [loadProfile, user?.username]);

  useEffect(() => {
    if (!user?.username || activeTab !== 'profile') return;
    loadProfile(user.username, 'form').catch((error) => {
      console.error('Profile panel refresh error:', error);
    });
  }, [activeTab, loadProfile, user?.username]);

  const chatCandidates = useMemo(() => {
    if (!isManager && !isDirectoryLoaded) {
      return [];
    }

    const presenceMap = new Map(employeeDirectory.map((item) => [item.email?.toLowerCase(), item]));
    const sourceEmployees = [...directoryEmployees];

    const shouldInjectManagerFallback = true;
    if (
      shouldInjectManagerFallback
      && !sourceEmployees.some((item) => item.login.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase())
    ) {
      sourceEmployees.push({
        id: 'manager-static',
        login: MANAGER_CREDENTIALS.username,
        full_name: MANAGER_CREDENTIALS.name,
        department: 'Старший сотрудник'
      });
    }

    return sourceEmployees
      .filter((item) => item.login !== user?.username)
      .map((item) => {
        const presence = presenceMap.get(item.login.toLowerCase());
        const computedRole = presence?.role || item.role || (item.login.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase() ? 'manager' : 'employee');
        return {
          email: item.login,
          isOnline: Boolean(presence?.isOnline),
          lastSeen: presence?.lastSeen || null,
          role: computedRole,
          profile: item
        };
      })
      .sort((a, b) => {
        const aIsManager = (a.role || '').toLowerCase() === 'manager' || a.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
        const bIsManager = (b.role || '').toLowerCase() === 'manager' || b.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();

        if (aIsManager !== bIsManager) return aIsManager ? -1 : 1;

        const aOnline = Boolean(a.isOnline);
        const bOnline = Boolean(b.isOnline);
        if (aOnline !== bOnline) return bOnline - aOnline;
        return a.email.localeCompare(b.email);
      });
  }, [directoryEmployees, employeeDirectory, isDirectoryLoaded, isManager, user?.username]);

  const availableEmployees = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    return chatCandidates.filter((item) => {
      if (!normalizedSearch) return true;
      const profile = item.profile || {};
      return [
        item.email,
        item.role,
        profile.full_name,
        profile.department,
        profile.position,
        profile.phone,
        profile.room,
        profile.cabinet,
        profile.N_tel
      ].some((value) => normalizeText(value).includes(normalizedSearch));
    });
  }, [chatCandidates, search]);

  const unreadByEmail = useMemo(() => {
    const map = {};
    chatCandidates.forEach((employee) => {
      const conversationId = getConversationId(user.username, employee.email);
      const lastReadAt = readState[conversationId] ? new Date(readState[conversationId]).getTime() : 0;
      map[employee.email] = (threads[conversationId] || []).filter((message) => (
        message.sender !== user.username && new Date(message.createdAt).getTime() > lastReadAt
      )).length;
    });
    return map;
  }, [chatCandidates, readState, threads, user.username]);

  useEffect(() => {
    if (!selectedEmail) return;
    if (!chatCandidates.some((item) => item.email === selectedEmail)) setSelectedEmail('');
  }, [chatCandidates, selectedEmail]);

  useEffect(() => {
    if (selectedEmail) setActiveTab('chat');
  }, [selectedEmail]);

  useEffect(() => {
    if (!currentConversationId) return;
    const latestIncoming = (threads[currentConversationId] || [])
      .filter((message) => message.sender !== user.username)
      .reduce((latest, message) => {
        if (!latest) return message.createdAt;
        return new Date(message.createdAt).getTime() > new Date(latest).getTime() ? message.createdAt : latest;
      }, null);
    if (!latestIncoming) return;

    setReadState((prev) => {
      const currentRead = prev[currentConversationId];
      if (currentRead && new Date(currentRead).getTime() >= new Date(latestIncoming).getTime()) return prev;
      const next = { ...prev, [currentConversationId]: latestIncoming };
      saveReadState(user.username, next);
      return next;
    });
  }, [currentConversationId, threads, user.username]);


  useEffect(() => {
    const wrap = messagesWrapRef.current;
    if (!wrap) return;
    wrap.scrollTop = wrap.scrollHeight;
  }, [currentConversationId]);

  useEffect(() => {
    const wrap = messagesWrapRef.current;
    if (!wrap) return;

    if (forceScrollRef.current) {
      wrap.scrollTop = wrap.scrollHeight;
      forceScrollRef.current = false;
      return;
    }

    const distanceFromBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
    if (distanceFromBottom < 140) {
      wrap.scrollTop = wrap.scrollHeight;
    }
  }, [currentMessages.length]);

  const handleAvatarUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Разрешены только PNG, JPG, WEBP.', 'Фото профиля');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify('Фото слишком большое. Рекомендуется до 5MB.', 'Фото профиля');
      return;
    }

    try {
      const optimizedAvatar = await processAvatar(file);
      setAvatarUrl(optimizedAvatar);
      const response = await fetch(`${API_BASE_URL}/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: user.username,
          ...profileForm,
          avatar: optimizedAvatar
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Не удалось сохранить аватар');
      }
      localStorage.setItem(getAvatarKey(user.username), optimizedAvatar);
    } catch {
      notify('Не удалось обработать изображение. Попробуйте другое фото.', 'Фото профиля');
    }
  };

  const removeAvatar = async () => {
    const response = await fetch(`${API_BASE_URL}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: user.username,
        ...profileForm,
        avatar: ''
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(data.message || 'Не удалось удалить аватар', 'Фото профиля');
      return;
    }
    setAvatarUrl('');
    localStorage.removeItem(getAvatarKey(user.username));
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if ((!draft.trim() && attachmentDrafts.length === 0) || !currentConversationId) return;

    const newMessage = {
      id: createMessageId(),
      sender: user.username,
      text: draft.trim() || (attachmentDrafts.length ? '📎 Вложения' : ''),
      createdAt: new Date().toISOString(),
      editedAt: null,
      reactions: {},
      pinned: false,
      replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text } : null,
      attachment: attachmentDrafts[0] || null,
      attachments: attachmentDrafts
    };

    try {
      forceScrollRef.current = true;
      await persistThreadMessages(currentConversationId, [...currentMessages, newMessage]);
      setDraft('');
      setAttachmentDrafts([]);
      setReplyTo(null);
    } catch (error) {
      notify(error.message || 'Не удалось отправить сообщение', 'Сообщение');
    }
  };

  const handleAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (tooLarge) {
      notify(`Файл ${tooLarge.name} слишком большой. Максимум 10 МБ.`, 'Вложения');
      return;
    }

    try {
      const preparedFiles = await Promise.all(files.map(async (file) => ({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: await readFileAsDataUrl(file)
      })));
      setAttachmentDrafts((prev) => [...prev, ...preparedFiles]);
    } catch {
      notify('Не удалось прикрепить файл.', 'Вложения');
    }
  };

  const handleAttachmentDrop = (event) => {
    event.preventDefault();
    handleAttachmentChange({
      target: {
        files: event.dataTransfer.files,
        value: ''
      }
    });
  };

  const removeAttachmentDraft = (indexToRemove) => {
    setAttachmentDrafts((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const saveMyProfile = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API_BASE_URL}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: user.username,
        ...profileForm,
        avatar: avatarUrl
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(data.message || 'Не удалось сохранить анкету', 'Профиль');
      return;
    }

    notify('Анкета сохранена', 'Профиль');
    profileDirtyRef.current = false;
    profileLoadedForRef.current = user.username;
    saveProfileDraft(user.username, { ...profileForm, avatar: avatarUrl });
    await fetchEmployees();
    setHeaderName(profileForm.full_name || baseDisplayName);
  };

  const changeMyPassword = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: user.username,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(data.message || 'Не удалось сменить пароль', 'Пароль');
      return;
    }
    notify('Пароль обновлён', 'Пароль');
    setPasswordForm({ currentPassword: '', newPassword: '' });
  };

  const openProfileCard = async (login) => {
    try {
      await loadProfile(login, 'preview');
      setProfileViewLogin(login);
    } catch (error) {
      notify(error.message || 'Не удалось открыть профиль сотрудника', 'Профиль');
    }
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!requestText.trim()) return;
    setRequestStatus({ state: 'sending', text: 'Отправка заявки...', ticketId: '' });
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${API_BASE_URL}/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
            cabinet: profileForm.room || '',
            N_tel: profileForm.phone || '',
            application: `[${requestCategory} / ${requestPriority}] ${requestText.trim()}`,
            category: requestCategory,
            priority: requestPriority,
            process: '',
            executor: '',
            fl: false
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.message || 'Не удалось отправить заявку');
        }
        setRequestStatus({ state: 'sent', text: 'Заявка отправлена. Статус: в работе.', ticketId: data?.id || data?.insertId || createMessageId().slice(0, 8) });
        setRequestText('');
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await sleep(350);
        }
      }
    }

    setRequestStatus({ state: 'error', text: lastError?.message || 'Ошибка сети при отправке заявки. Попробуйте ещё раз.', ticketId: '' });
  };

  const updateMessage = async (messageId, updater, targetConversationId = currentConversationId) => {
    if (!targetConversationId) return;
    const nextMessages = (threads[targetConversationId] || []).map((item) => (item.id === messageId ? updater(item) : item));
    await persistThreadMessages(targetConversationId, nextMessages);
  };

  const toggleReaction = async (messageId, emoji, targetConversationId = currentConversationId) => {
    try {
      await updateMessage(messageId, (item) => {
        const reactions = { ...(item.reactions || {}) };
        const users = new Set(reactions[emoji] || []);
        if (users.has(user.username)) users.delete(user.username);
        else users.add(user.username);
        reactions[emoji] = [...users];
        return { ...item, reactions };
      }, targetConversationId);
    } catch (error) {
      notify(error.message || 'Не удалось поставить реакцию', 'Реакция');
    }
  };

  const togglePinned = async (messageId, targetConversationId = currentConversationId) => {
    try {
      await updateMessage(messageId, (item) => ({ ...item, pinned: !item.pinned }), targetConversationId);
    } catch (error) {
      notify(error.message || 'Не удалось закрепить сообщение', 'Закрепление');
    }
  };

  const deleteMessage = async (messageId, targetConversationId = currentConversationId) => {
    if (!targetConversationId) return;
    const nextMessages = (threads[targetConversationId] || []).filter((item) => item.id !== messageId);
    try {
      await persistThreadMessages(targetConversationId, nextMessages);
    } catch (error) {
      notify(error.message || 'Не удалось удалить сообщение', 'Сообщение');
    }
  };

  const editMessage = async (messageId, targetConversationId = currentConversationId) => {
    const sourceMessage = (threads[targetConversationId] || []).find((item) => item.id === messageId);
    const nextText = await promptAction('Изменить текст сообщения:', sourceMessage?.text || '');
    if (!nextText || !targetConversationId) return;

    try {
      await updateMessage(messageId, (item) => ({ ...item, text: String(nextText).trim(), editedAt: new Date().toISOString() }), targetConversationId);
    } catch (error) {
      notify(error.message || 'Не удалось изменить сообщение', 'Сообщение');
    }
  };

  const clearConversation = async () => {
    if (!currentConversationId) return;
    const confirmed = await confirmAction('Удалить всю переписку с этим сотрудником? Это действие нельзя отменить.', 'Удаление переписки');
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить переписку');
      if (data?.threads) setThreads(data.threads);
    } catch (error) {
      notify(error.message || 'Не удалось удалить переписку', 'Переписка');
    }
  };

  const saveEmployee = async (e) => {
    e.preventDefault();
    if (!employeeForm.login.trim() || (!employeeForm.id && !employeeForm.password.trim())) {
      notify('Укажите логин и пароль (для нового сотрудника).', 'Сотрудники');
      return;
    }

    const payload = {
      login: employeeForm.login,
      password: employeeForm.password,
      full_name: employeeForm.full_name,
      department: employeeForm.department,
      phone: employeeForm.phone,
      room: employeeForm.room
    };

    const isEdit = Boolean(employeeForm.id);
    const url = isEdit ? `${API_BASE_URL}/auth/employees/${employeeForm.id}` : `${API_BASE_URL}/auth/register`;
    const method = isEdit ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(data.message || 'Не удалось сохранить сотрудника', 'Сотрудники');
      return;
    }

    await fetchEmployees();
    setEmployeeForm({ id: null, login: '', password: '', full_name: '', department: '', phone: '', room: '' });
  };

  const deleteEmployee = async (employeeId) => {
    const confirmed = await confirmAction('Удалить сотрудника? Его учётная запись будет удалена.', 'Удаление сотрудника');
    if (!confirmed) return;
    const response = await fetch(`${API_BASE_URL}/auth/employees/${employeeId}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(data.message || 'Не удалось удалить сотрудника', 'Сотрудники');
      return;
    }
    await fetchEmployees();
  };

  const allConversationIds = useMemo(() => Object.keys(threads).sort(), [threads]);

  const typingHint = draft.trim().length > 0 ? 'Вы печатаете…' : '';
  const tabs = isManager ? MANAGER_TABS : EMPLOYEE_TABS;
  const unreadTotal = Object.values(unreadByEmail).reduce((sum, count) => sum + count, 0);
  const feedBadge = feedPosts.filter((post) => post.author !== user?.username).length;
  const requestBadge = requestStatus.state === 'sent' ? 1 : 0;
  const activeContact = chatCandidates.find((item) => item.email === selectedEmail);
  const normalizedDialogSearch = normalizeText(dialogSearch);
  const visibleMessages = useMemo(() => (
    normalizedDialogSearch
      ? currentMessages.filter((message) => [
        message.text,
        message.sender,
        message.attachment?.name,
        ...(message.attachments || []).map((item) => item.name)
      ].some((value) => normalizeText(value).includes(normalizedDialogSearch)))
      : currentMessages
  ), [currentMessages, normalizedDialogSearch]);
  const messagesWithDateSeparators = useMemo(() => {
    let lastDateKey = '';
    return visibleMessages.flatMap((message) => {
      const currentDateKey = getDateKey(message.createdAt);
      const items = [];
      if (currentDateKey !== lastDateKey) {
        items.push({ type: 'date', id: `date-${currentDateKey}`, label: formatDateLabel(message.createdAt) });
        lastDateKey = currentDateKey;
      }
      items.push({ type: 'message', id: message.id, message });
      return items;
    });
  }, [visibleMessages]);

  const addFeedPost = async (event) => {
    event.preventDefault();
    if (!feedDraft.trim() && !feedAttachment) return;
    const post = {
      id: createMessageId(),
      author: user?.username || 'employee',
      authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
      text: feedDraft.trim(),
      attachment: feedAttachment,
      createdAt: new Date().toISOString(),
      comments: []
    };
    try {
      await persistFeedPosts([post, ...feedPosts]);
      setFeedDraft('');
      setFeedAttachment(null);
    } catch (error) {
      notify(error.message || 'Не удалось опубликовать запись', 'Лента');
    }
  };

  const onFeedFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      notify('Файл слишком большой. Максимум 10 МБ.', 'Вложения');
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setFeedAttachment({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl });
  };

  const addCommentToPost = async (postId) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    const comment = {
      id: createMessageId(),
      author: user?.username || 'employee',
      authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
      text,
      createdAt: new Date().toISOString()
    };
    const nextPosts = feedPosts.map((post) => (post.id === postId ? { ...post, comments: [...(post.comments || []), comment] } : post));
    try {
      await persistFeedPosts(nextPosts);
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
    } catch (error) {
      notify(error.message || 'Не удалось добавить комментарий', 'Лента');
    }
  };

  const deleteFeedPost = async (postId) => {
    const post = feedPosts.find((item) => item.id === postId);
    if (!post) return;

    const canDeletePost = isManager || isAdmin || post.author === user?.username;
    if (!canDeletePost) return;
    const confirmed = await confirmAction('Удалить публикацию из общей ленты?', 'Лента');
    if (!confirmed) return;

    try {
      await persistFeedPosts(feedPosts.filter((item) => item.id !== postId));
    } catch (error) {
      notify(error.message || 'Не удалось удалить публикацию', 'Лента');
    }
  };

  const deleteFeedComment = async (postId, commentId) => {
    const post = feedPosts.find((item) => item.id === postId);
    const comment = post?.comments?.find((item) => item.id === commentId);
    if (!post || !comment) return;

    const canDeleteComment = isManager || isAdmin || comment.author === user?.username;
    if (!canDeleteComment) return;

    const nextPosts = feedPosts.map((item) => (
      item.id === postId
        ? { ...item, comments: (item.comments || []).filter((commentItem) => commentItem.id !== commentId) }
        : item
    ));
    try {
      await persistFeedPosts(nextPosts);
    } catch (error) {
      notify(error.message || 'Не удалось удалить комментарий', 'Лента');
    }
  };

  return (
    <div className="employee-chat-layout">
      <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} hidden />
      
      <aside className="employee-chat-sidebar">
        <div className="employee-chat-brand">
          <button type="button" className="employee-avatar-upload" onClick={() => setAvatarViewerOpen(true)}>
            {avatarUrl ? <img src={avatarUrl} alt="avatar" className="employee-avatar-image" /> : <span>{String(baseDisplayName || '?').slice(0, 1).toUpperCase()}</span>}
          </button>
          <div className="employee-brand-meta">
            <strong>{headerName}</strong>
            <span>{profileForm.position || profileForm.department || user?.role || 'Рабочий чат'}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => { setActiveTab('profile'); setProfileViewLogin(''); }}>Профиль</button>
        </div>

        <nav className="employee-chat-tabs" aria-label="Разделы чата">
          {tabs.map((tab) => {
            const badge = tab.id === 'chat' ? unreadTotal : tab.id === 'feed' ? feedBadge : tab.id === 'request' ? requestBadge : 0;
            return (
              <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>
                <span>{tab.label}</span>
                {badge > 0 && <em>{badge}</em>}
              </button>
            );
          })}
        </nav>

        <div className="employee-contact-panel">
          <label className="field-label">Контакты</label>
          <input
            className="employee-chat-search"
            placeholder="ФИО, email, отдел, кабинет, телефон..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className={`employee-chat-list ${isManager ? 'manager-mode' : ''}`}>
            {availableEmployees.length === 0 && <div className="empty-mini">Ничего не найдено</div>}
            {availableEmployees.map((employee) => {
              const isOnline = Boolean(employee.isOnline);
              const isManagerContact = (employee.role || '').toLowerCase() === 'manager' || employee.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
              const profile = employee.profile || {};
              return (
                <div key={employee.email} className={`employee-chat-user ${selectedEmail === employee.email ? 'active' : ''} ${isManagerContact ? 'manager-priority' : ''}`}>
                  <button type="button" className="employee-contact-open" onClick={() => setSelectedEmail(employee.email)}>
                    <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
                    <span className="employee-chat-user-main">
                      <span className="employee-chat-user-email">{profile.full_name || employee.email}</span>
                      <span className="employee-chat-user-extra">{employee.email} · {profile.department || 'отдел —'} · каб. {profile.room || '—'}</span>
                    </span>
                    <span className="employee-chat-user-status">{isManagerContact ? 'manager' : (isOnline ? 'online' : 'offline')}</span>
                    {unreadByEmail[employee.email] > 0 && <span className="employee-chat-user-unread">{unreadByEmail[employee.email]}</span>}
                  </button>
                  <button type="button" className="profile-open-btn" onClick={() => { openProfileCard(employee.email); setActiveTab('profile'); }}>Профиль</button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="employee-chat-actions">
          <button className="clear-btn" onClick={clearConversation} disabled={!selectedEmail}>Удалить переписку</button>
          {!isAdmin && <button className="logout-btn" onClick={handleLogout}>Выход</button>}
        </div>
      </aside>

      <section className="employee-chat-main">
        {activeTab === 'chat' && (
          <div className="chat-workspace">
            {!selectedEmail ? (
              <div className="empty-chat">
                <strong>Выберите диалог</strong>
                <span>Автовыбор убран: откройте нужного сотрудника слева или найдите контакт поиском.</span>
              </div>
            ) : (
              <>
                <header className="conversation-header">
                  <div>
                    <span className="eyebrow">Диалог</span>
                    <h2>{activeContact?.profile?.full_name || selectedEmail}</h2>
                    <p>{selectedEmail}</p>
                  </div>
                  <div className="conversation-tools">
                    <input value={dialogSearch} onChange={(e) => setDialogSearch(e.target.value)} placeholder="Поиск в диалоге..." />
                    <button type="button" onClick={() => { openProfileCard(selectedEmail); setActiveTab('profile'); }}>Профиль</button>
                  </div>
                </header>

                {pinnedMessages.length > 0 && (
                  <div className="pinned-box">
                    <strong>📌 Закреплённые</strong>
                    {pinnedMessages.map((message) => <div key={`pin-${message.id}`}>• {message.text}</div>)}
                  </div>
                )}

                <div className="messages-wrap" ref={messagesWrapRef}>
                  {messagesWithDateSeparators.length === 0 && <div className="empty-chat">{dialogSearch ? 'По запросу ничего не найдено.' : 'Сообщений пока нет.'}</div>}
                  {messagesWithDateSeparators.map((item) => {
                    if (item.type === 'date') return <div key={item.id} className="date-separator"><span>{item.label}</span></div>;

                    const message = item.message;
                    const canEdit = isManager || message.sender === user.username;
                    const isMine = message.sender === user.username;
                    const isRead = isMine && currentMessages.some((row) => row.sender !== user.username && new Date(row.createdAt) > new Date(message.createdAt));
                    const attachments = message.attachments?.length ? message.attachments : message.attachment ? [message.attachment] : [];

                    return (
                      <div key={message.id} className={`message-row ${isMine ? 'mine' : ''}`}>
                        <div className="message-bubble">
                          <div className="message-meta">
                            <span>{isMine ? 'Вы' : message.sender}</span>
                            <span>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>

                          {message.replyTo && <div className="reply-preview">↪ {message.replyTo.sender}: {message.replyTo.text}</div>}
                          <div className="message-text">{message.text}</div>

                          {attachments.length > 0 && (
                            <div className="message-attachments-grid">
                              {attachments.map((file, index) => (
                                <a key={`${message.id}-file-${index}`} className="message-attachment-card" href={file.dataUrl} download={file.name || 'file'} target="_blank" rel="noreferrer">
                                  {String(file.type || '').startsWith('image/') ? <img src={file.dataUrl} alt={file.name || 'attachment'} /> : <span className="file-icon">{getFileIcon(file.type)}</span>}
                                  <small>{file.name || 'Файл'} · {Math.max(1, Math.round((file.size || 0) / 1024))} КБ</small>
                                </a>
                              ))}
                            </div>
                          )}

                          {message.editedAt && <small className="read-state">изменено</small>}
                          {isMine && <small className="read-state">{isRead ? 'прочитано' : 'доставлено'}</small>}

                          <div className="reaction-row">
                            {REACTION_EMOJIS.map((emoji) => {
                              const count = message.reactions?.[emoji]?.length || 0;
                              const active = (message.reactions?.[emoji] || []).includes(user.username);
                              return <button key={emoji} type="button" className={active ? 'active' : ''} onClick={() => toggleReaction(message.id, emoji)}>{emoji} {count > 0 ? count : ''}</button>;
                            })}
                          </div>

                          <div className="message-controls">
                            <button type="button" onClick={() => setReplyTo(message)}>Ответить</button>
                            <button type="button" onClick={() => togglePinned(message.id)}>{message.pinned ? 'Открепить' : 'Закрепить'}</button>
                            {canEdit && <button type="button" onClick={() => editMessage(message.id)}>Изменить</button>}
                            {canEdit && <button type="button" onClick={() => deleteMessage(message.id)}>Удалить</button>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="composer-wrap" onDrop={handleAttachmentDrop} onDragOver={(event) => event.preventDefault()}>
                  <div className="template-row">
                    {templateMessages.map((template) => <button key={template} type="button" onClick={() => setDraft(template)}>{template}</button>)}
                  </div>

                  {replyTo && <div className="reply-preview active-reply">Ответ на: {replyTo.sender}: {replyTo.text}<button type="button" onClick={() => setReplyTo(null)}>×</button></div>}

                  {attachmentDrafts.length > 0 && (
                    <div className="attachment-preview-grid">
                      {attachmentDrafts.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="attachment-preview">
                          <span>{getFileIcon(file.type)} {file.name} ({Math.max(1, Math.round(file.size / 1024))} КБ)</span>
                          <button type="button" onClick={() => removeAttachmentDraft(index)}>Убрать</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {typingHint && <div className="typing-hint">{typingHint}</div>}

                  <form className="message-form" onSubmit={handleSend}>
                    <input placeholder="Введите сообщение или перетащите файлы сюда..." value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} />
                    <label className="attach-file-btn">📎 Файлы<input type="file" hidden multiple onChange={handleAttachmentChange} /></label>
                    <button type="submit">Отправить</button>
                  </form>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'request' && (
          <div className="request-workspace">
            <header className="section-hero">
              <span className="eyebrow">Служебная заявка</span>
              <h2>Сообщить о проблеме</h2>
              <p>Заполните категорию, приоритет и описание — статус заявки появится сразу после отправки.</p>
            </header>
            <div className={`request-status-card ${requestStatus.state}`}>
              <strong>{requestStatus.text}</strong>
              {requestStatus.ticketId && <span>Номер: #{requestStatus.ticketId}</span>}
            </div>
            <form className="employee-request-box" onSubmit={submitRequest}>
              <div className="form-grid two">
                <label>Категория<select value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)}>{REQUEST_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Приоритет<select value={requestPriority} onChange={(e) => setRequestPriority(e.target.value)}>{REQUEST_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
              <textarea rows={7} placeholder="Например: кабинет 204, не работает принтер, требуется проверка подключения..." value={requestText} onChange={(e) => setRequestText(e.target.value)} />
              <button type="submit" disabled={!requestText.trim() || requestStatus.state === 'sending'}>{requestStatus.state === 'sending' ? 'Отправляем...' : 'Отправить заявку'}</button>
            </form>
          </div>
        )}

        {activeTab === 'feed' && (
          <section className="employee-feed-section">
            <header className="employee-feed-header">
              <div><span className="eyebrow">Общая серверная лента</span><h2>Лента сотрудников</h2><p>Публикации сохраняются на сервере и доступны всем пользователям.</p></div>
              <button type="button" onClick={fetchFeed}>Обновить</button>
            </header>
            <form className="employee-feed-composer" onSubmit={addFeedPost}>
              <textarea rows={4} placeholder="Новость, объявление или рабочая заметка..." value={feedDraft} onChange={(e) => setFeedDraft(e.target.value)} />
              {feedAttachment && <div className="employee-feed-attachment-preview"><span>{getFileIcon(feedAttachment.type)} {feedAttachment.name}</span><button type="button" onClick={() => setFeedAttachment(null)}>Убрать</button></div>}
              <div className="employee-feed-composer-actions"><label>📎 Файл<input type="file" hidden onChange={onFeedFileChange} /></label><button type="submit" disabled={!feedDraft.trim() && !feedAttachment}>Опубликовать</button></div>
            </form>
            <div className="employee-feed-list">
              {feedPosts.length === 0 && <div className="empty-chat">Пока нет публикаций.</div>}
              {feedPosts.map((post) => {
                const canDeletePost = isManager || isAdmin || post.author === user?.username;
                return (
                  <article key={post.id} className="employee-feed-post">
                    <header className="employee-feed-post-header"><div><strong>{post.authorName}</strong><span>@{post.author} · {new Date(post.createdAt).toLocaleString('ru-RU')}</span></div>{canDeletePost && <button type="button" className="employee-feed-delete" onClick={() => deleteFeedPost(post.id)}>Удалить</button>}</header>
                    {post.text && <p className="employee-feed-post-text">{post.text}</p>}
                    {post.attachment?.dataUrl && <div className="employee-feed-attachment">{String(post.attachment.type || '').startsWith('image/') ? <img src={post.attachment.dataUrl} alt={post.attachment.name || 'post-image'} /> : <a href={post.attachment.dataUrl} download={post.attachment.name || 'file'}>{getFileIcon(post.attachment.type)} {post.attachment.name || 'Файл'}</a>}</div>}
                    <div className="employee-feed-comments"><div className="employee-feed-comments-title">Комментарии</div>{(post.comments || []).length === 0 && <small className="employee-feed-no-comments">Комментариев пока нет.</small>}{(post.comments || []).map((comment) => { const canDeleteComment = isManager || isAdmin || comment.author === user?.username; return <div key={comment.id} className="employee-feed-comment"><div className="employee-feed-comment-body"><strong>{comment.authorName}</strong><span>{comment.text}</span><small>@{comment.author} · {new Date(comment.createdAt).toLocaleString('ru-RU')}</small></div>{canDeleteComment && <button type="button" onClick={() => deleteFeedComment(post.id, comment.id)}>Удалить</button>}</div>; })}<div className="employee-feed-comment-form"><input placeholder="Оставить комментарий…" value={commentDrafts[post.id] || ''} onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))} /><button type="button" onClick={() => addCommentToPost(post.id)} disabled={!(commentDrafts[post.id] || '').trim()}>Отправить</button></div></div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {activeTab === 'profile' && (
          <div className="profile-workspace">
            {profileViewLogin && profilePreview ? (
              <div className="profile-preview-card"><button type="button" className="back-to-chat-btn" onClick={() => setProfileViewLogin('')}>← Мой профиль</button><div className="profile-preview-head"><div className="profile-preview-avatar">{profilePreview.avatar ? <img src={profilePreview.avatar} alt="profile-avatar" /> : <span>{String(profilePreview.full_name || profilePreview.login || '?').slice(0, 1).toUpperCase()}</span>}</div><div><h3>{profilePreview.full_name || profilePreview.login}</h3><p>@{profilePreview.login}</p><small>{profilePreview.statusText || 'Внутренняя страница сотрудника'}</small></div></div><div className="profile-preview-grid"><div><strong>Должность:</strong> {profilePreview.position || '—'}</div><div><strong>Отдел:</strong> {profilePreview.department || '—'}</div><div><strong>Кабинет:</strong> {profilePreview.room || '—'}</div><div><strong>Телефон:</strong> {profilePreview.phone || '—'}</div><div><strong>Сайт:</strong> {profilePreview.website || '—'}</div><div><strong>О себе:</strong> {profilePreview.bio || '—'}</div></div><button type="button" onClick={() => { setSelectedEmail(profilePreview.login); setProfileViewLogin(''); setActiveTab('chat'); }}>Открыть диалог</button></div>
            ) : (
              <div className="profile-settings-grid">
                <section className="profile-panel"><h3>Мой профиль</h3><form onSubmit={saveMyProfile} className="profile-form"><input placeholder="ФИО" value={profileForm.full_name} onChange={(e) => updateProfileField('full_name', e.target.value)} /><input placeholder="Должность" value={profileForm.position} onChange={(e) => updateProfileField('position', e.target.value)} /><input placeholder="Отдел" value={profileForm.department} onChange={(e) => updateProfileField('department', e.target.value)} /><input placeholder="Кабинет" value={profileForm.room} onChange={(e) => updateProfileField('room', e.target.value)} /><input placeholder="Внутренний телефон" value={profileForm.phone} onChange={(e) => updateProfileField('phone', e.target.value)} /><input placeholder="Сайт / соцссылка" value={profileForm.website} onChange={(e) => updateProfileField('website', e.target.value)} /><input placeholder="Статус" value={profileForm.statusText} onChange={(e) => updateProfileField('statusText', e.target.value)} /><textarea placeholder="О себе" rows={4} value={profileForm.bio} onChange={(e) => updateProfileField('bio', e.target.value)} /><button type="submit">Сохранить анкету</button></form></section>
                <section className="profile-panel"><h3>Безопасность и фото</h3><div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>Изменить фото</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>Удалить фото</button></div><form onSubmit={changeMyPassword} className="profile-password-form"><input type="password" placeholder="Текущий пароль" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))} /><input type="password" placeholder="Новый пароль" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))} /><button type="submit">Обновить пароль</button></form></section>
              </div>
            )}
          </div>
        )}

        {activeTab === 'employees' && isManager && (
          <section className="manager-panel"><h2>Управление сотрудниками</h2><form className="manager-form" onSubmit={saveEmployee}><input placeholder="Логин (email)" value={employeeForm.login} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, login: e.target.value }))} required /><input placeholder={employeeForm.id ? 'Новый пароль (опционально)' : 'Пароль'} value={employeeForm.password} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, password: e.target.value }))} /><input placeholder="ФИО" value={employeeForm.full_name} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, full_name: e.target.value }))} /><input placeholder="Отдел" value={employeeForm.department} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, department: e.target.value }))} /><div className="manager-form-actions"><button type="submit">{employeeForm.id ? 'Сохранить' : 'Добавить'}</button>{employeeForm.id && <button type="button" onClick={() => setEmployeeForm({ id: null, login: '', password: '', full_name: '', department: '', phone: '', room: '' })}>Отмена</button>}</div></form><div className="manager-list">{directoryEmployees.map((employee) => <div className="manager-list-item" key={employee.id}><div><strong>{employee.login}</strong><div>{employee.full_name || '—'}</div></div><div className="manager-list-actions"><button type="button" onClick={() => setEmployeeForm({ id: employee.id, login: employee.login || '', password: '', full_name: employee.full_name || '', department: employee.department || '', phone: employee.phone || '', room: employee.room || '' })}>Редактировать</button><button type="button" onClick={() => deleteEmployee(employee.id)}>Удалить</button></div></div>)}</div></section>
        )}

        {activeTab === 'audit' && isManager && (
          <section className="manager-panel"><h2>Переписка сотрудников</h2><div className="threads-grid"><div className="threads-list">{allConversationIds.map((threadId) => { const participants = getParticipantsFromThreadId(threadId); return <button key={threadId} type="button" className={`thread-item ${selectedThreadId === threadId ? 'active' : ''}`} onClick={() => setSelectedThreadId(threadId)}>{participants.join(' ↔ ')}</button>; })}</div><div className="threads-messages">{!selectedThreadId && <div className="empty-chat">Выберите переписку.</div>}{selectedThreadId && selectedThreadMessages.map((message) => { const attachments = message.attachments?.length ? message.attachments : message.attachment ? [message.attachment] : []; return <div key={message.id} className="audit-message"><div className="message-meta"><span>{message.sender}</span><span>{new Date(message.createdAt).toLocaleString('ru-RU')}</span></div><div>{message.text}</div>{attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <a key={`${message.id}-audit-${index}`} className="message-attachment-card" href={file.dataUrl} download={file.name || 'file'} target="_blank" rel="noreferrer">{String(file.type || '').startsWith('image/') ? <img src={file.dataUrl} alt={file.name || 'attachment'} /> : <span className="file-icon">{getFileIcon(file.type)}</span>}<small>{file.name || 'Файл'}</small></a>)}</div>}<div className="message-controls"><button type="button" onClick={() => editMessage(message.id, selectedThreadId)}>Изменить</button><button type="button" onClick={() => deleteMessage(message.id, selectedThreadId)}>Удалить</button></div></div>; })}</div></div></section>
        )}
      </section>

      {avatarViewerOpen && (
        <div className="app-modal-backdrop" onMouseDown={() => setAvatarViewerOpen(false)}>
          <div className="avatar-viewer" onMouseDown={(event) => event.stopPropagation()}>
            <header><strong>Фото профиля</strong><button type="button" onClick={() => setAvatarViewerOpen(false)}>×</button></header>
            {avatarUrl ? <img src={avatarUrl} alt="Фото профиля" /> : <div className="avatar-full-placeholder">{String(baseDisplayName || user?.username || '?').slice(0, 1).toUpperCase()}</div>}
            <div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>Изменить</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>Удалить</button></div>
          </div>
        </div>
      )}

      {modal && (
        <div className="app-modal-backdrop">
          <div className="app-modal-card">
            <h3>{modal.title}</h3>
            <p>{modal.message}</p>
            {modal.type === 'prompt' && <textarea rows={4} value={modal.value} onChange={(e) => setModal((prev) => ({ ...prev, value: e.target.value }))} />}
            <div className="app-modal-actions">
              {modal.type === 'info' && <button type="button" onClick={() => setModal(null)}>Понятно</button>}
              {modal.type === 'confirm' && <><button type="button" onClick={() => closeModal(false)}>Отмена</button><button type="button" className="danger" onClick={() => closeModal(true)}>Подтвердить</button></>}
              {modal.type === 'prompt' && <><button type="button" onClick={() => closeModal('')}>Отмена</button><button type="button" onClick={() => closeModal(modal.value)}>Сохранить</button></>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeChat;
