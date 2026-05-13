import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { MANAGER_CREDENTIALS } from '../config/authConfig';
import './EmployeeChat.css';

const CHAT_READ_STATE_KEY = 'chatReadState';
const EMPLOYEE_DIRECTORY_CACHE_KEY = 'employeeDirectoryCache';
const EMPLOYEE_FEED_KEY = 'employeeSocialFeed';
const MANAGER_TEMPLATE_MESSAGES = ['✅ Принято в работу', '🔧 Проверяю сейчас', '👍 Спасибо, получил', '📌 Уточните, пожалуйста, детали', '⏱️ Вернусь с ответом в течение 15 минут', '🧩 Проблема воспроизведена, исправляю'];
const EMPLOYEE_TEMPLATE_MESSAGES = ['Привет! 👋', 'Как дела? 🙂', 'Спасибо большое! 🙏', 'Отлично, договорились ✅', 'Я на месте, можем созвониться? 📞', 'Хорошего дня! ☀️'];
const REACTION_EMOJIS = ['👍', '✅', '🔧'];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

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

const readFeedPosts = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMPLOYEE_FEED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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

const EmployeeChat = () => {
  const { user, logout, employeeDirectory } = useAuth();
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const baseDisplayName = user?.name || user?.username || 'Сотрудник';
  const isAdmin = user?.role === 'admin';
  const isEmployee = user?.role === 'employee';
   
  const avatarInputRef = useRef(null); 
  const profileDirtyRef = useRef(false);
  const profileLoadedForRef = useRef('');
   
  const [threads, setThreads] = useState({});
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draft, setDraft] = useState('');
  const [attachmentDraft, setAttachmentDraft] = useState(null);
  const [search, setSearch] = useState('');
  
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAvatarFull, setIsAvatarFull] = useState(false);
  
  const [replyTo, setReplyTo] = useState(null);
  const [readState, setReadState] = useState(() => readReadState(user?.username || 'guest'));
  const [directoryEmployees, setDirectoryEmployees] = useState(() => readDirectoryCache());
  const [isDirectoryLoaded, setIsDirectoryLoaded] = useState(() => readDirectoryCache().length > 0);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [headerName, setHeaderName] = useState(baseDisplayName);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(false);
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
  const [requestStatus, setRequestStatus] = useState('');
  const [isRequestPanelOpen, setIsRequestPanelOpen] = useState(false);
  const [feedPosts, setFeedPosts] = useState(() => readFeedPosts());
  const [feedDraft, setFeedDraft] = useState('');
  const [feedAttachment, setFeedAttachment] = useState(null);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [isFeedOpen, setIsFeedOpen] = useState(false);
  const messagesWrapRef = useRef(null);
  const forceScrollRef = useRef(false);

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

    const poller = setInterval(() => {
      fetchThreads();
      fetchEmployees();
    }, 3000);

    return () => clearInterval(poller);
  }, [fetchThreads, fetchEmployees]);

  useEffect(() => {
    if (!user?.username) return;
    loadProfile(user.username, 'form').catch((error) => {
      console.error('Profile bootstrap error:', error);
    });
  }, [loadProfile, user?.username]);

  useEffect(() => {
    if (!user?.username || (!isProfileOpen && !isProfilePanelOpen)) return;
    loadProfile(user.username, 'form').catch((error) => {
      console.error('Profile panel refresh error:', error);
    });
  }, [isProfileOpen, isProfilePanelOpen, loadProfile, user?.username]);

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
  }, [directoryEmployees, employeeDirectory, isDirectoryLoaded, user?.username]);

  const availableEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return chatCandidates.filter((item) => !normalizedSearch || item.email.toLowerCase().includes(normalizedSearch));
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
    if (!selectedEmail && chatCandidates.length > 0) setSelectedEmail(chatCandidates[0].email);
  }, [chatCandidates, selectedEmail]);

  useEffect(() => {
    if (!selectedEmail) return;
    if (!chatCandidates.some((item) => item.email === selectedEmail)) setSelectedEmail('');
  }, [chatCandidates, selectedEmail]);

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
      window.alert('Разрешены только PNG, JPG, WEBP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      window.alert('Фото слишком большое. Рекомендуется до 5MB.');
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
      window.alert('Не удалось обработать изображение. Попробуйте другое фото.');
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
      window.alert(data.message || 'Не удалось удалить аватар');
      return;
    }
    setAvatarUrl('');
    localStorage.removeItem(getAvatarKey(user.username));
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if ((!draft.trim() && !attachmentDraft) || !currentConversationId) return;

    const newMessage = {
      id: createMessageId(),
      sender: user.username,
      text: draft.trim() || (attachmentDraft ? '📎 Файл' : ''),
      createdAt: new Date().toISOString(),
      editedAt: null,
      reactions: {},
      pinned: false,
      replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text } : null,
      attachment: attachmentDraft
    };

    try {
      forceScrollRef.current = true;
      await persistThreadMessages(currentConversationId, [...currentMessages, newMessage]);
      setDraft('');
      setAttachmentDraft(null);
      setReplyTo(null);
    } catch (error) {
      window.alert(error.message || 'Не удалось отправить сообщение');
    }
  };

  const handleAttachmentChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_SIZE) {
      window.alert('Файл слишком большой. Максимум 10 МБ.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAttachmentDraft({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl
      });
    } catch {
      window.alert('Не удалось прикрепить файл.');
    }
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
      window.alert(data.message || 'Не удалось сохранить анкету');
      return;
    }

    window.alert('Анкета сохранена');
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
      window.alert(data.message || 'Не удалось сменить пароль');
      return;
    }
    window.alert('Пароль обновлён');
    setPasswordForm({ currentPassword: '', newPassword: '' });
  };

  const openProfileCard = async (login) => {
    try {
      await loadProfile(login, 'preview');
      setProfileViewLogin(login);
    } catch (error) {
      window.alert(error.message || 'Не удалось открыть профиль сотрудника');
    }
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!requestText.trim()) return;
    setRequestStatus('Отправка...');
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
            application: requestText.trim(),
            process: '',
            executor: '',
            fl: false
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.message || 'Не удалось отправить заявку');
        }
        setRequestStatus('Заявка отправлена. Статус: в работе.');
        setRequestText('');
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await sleep(350);
        }
      }
    }

    setRequestStatus(lastError?.message || 'Ошибка сети при отправке заявки. Попробуйте ещё раз.');
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
      window.alert(error.message || 'Не удалось поставить реакцию');
    }
  };

  const togglePinned = async (messageId, targetConversationId = currentConversationId) => {
    try {
      await updateMessage(messageId, (item) => ({ ...item, pinned: !item.pinned }), targetConversationId);
    } catch (error) {
      window.alert(error.message || 'Не удалось закрепить сообщение');
    }
  };

  const deleteMessage = async (messageId, targetConversationId = currentConversationId) => {
    if (!targetConversationId) return;
    const nextMessages = (threads[targetConversationId] || []).filter((item) => item.id !== messageId);
    try {
      await persistThreadMessages(targetConversationId, nextMessages);
    } catch (error) {
      window.alert(error.message || 'Не удалось удалить сообщение');
    }
  };

  const editMessage = async (messageId, targetConversationId = currentConversationId) => {
    const nextText = window.prompt('Изменить сообщение:');
    if (!nextText || !targetConversationId) return;

    try {
      await updateMessage(messageId, (item) => ({ ...item, text: nextText.trim(), editedAt: new Date().toISOString() }), targetConversationId);
    } catch (error) {
      window.alert(error.message || 'Не удалось изменить сообщение');
    }
  };

  const clearConversation = async () => {
    if (!currentConversationId || !window.confirm('Удалить всю переписку с этим сотрудником?')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить переписку');
      if (data?.threads) setThreads(data.threads);
    } catch (error) {
      window.alert(error.message || 'Не удалось удалить переписку');
    }
  };

  const saveEmployee = async (e) => {
    e.preventDefault();
    if (!employeeForm.login.trim() || (!employeeForm.id && !employeeForm.password.trim())) {
      window.alert('Укажите логин и пароль (для нового сотрудника).');
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
      window.alert(data.message || 'Не удалось сохранить сотрудника');
      return;
    }

    await fetchEmployees();
    setEmployeeForm({ id: null, login: '', password: '', full_name: '', department: '', phone: '', room: '' });
  };

  const deleteEmployee = async (employeeId) => {
    if (!window.confirm('Удалить сотрудника?')) return;
    const response = await fetch(`${API_BASE_URL}/auth/employees/${employeeId}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(data.message || 'Не удалось удалить сотрудника');
      return;
    }
    await fetchEmployees();
  };

  const allConversationIds = useMemo(() => Object.keys(threads).sort(), [threads]);
  const persistFeed = useCallback((updater) => {
    setFeedPosts((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem(EMPLOYEE_FEED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const typingHint = draft.trim().length > 0 ? 'Вы печатаете…' : '';

  const addFeedPost = (event) => {
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
    persistFeed((prev) => [post, ...prev]);
    setFeedDraft('');
    setFeedAttachment(null);
  };

  const onFeedFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      window.alert('Файл слишком большой. Максимум 10 МБ.');
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setFeedAttachment({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl });
  };

  const addCommentToPost = (postId) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    const comment = {
      id: createMessageId(),
      author: user?.username || 'employee',
      authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
      text,
      createdAt: new Date().toISOString()
    };
    persistFeed((prev) => prev.map((post) => (post.id === postId ? { ...post, comments: [...(post.comments || []), comment] } : post)));
    setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
  };

  const isProfileMode = isProfileOpen || isProfilePanelOpen;

  return (
    <div className="employee-chat-layout">
      <aside className={`employee-chat-sidebar ${isProfileMode ? 'profile-mode' : ''}`}>
        <div className="employee-chat-header">
          <div className={`employee-profile-stack ${isProfileMode ? 'open' : ''}`}>
          <div className={`employee-avatar-wrap ${isProfileOpen ? 'open' : ''}`}>

  {isProfileOpen && (
    <button
      className="profile-back"
      onClick={() => {
        setIsProfileOpen(false);
        setIsProfilePanelOpen(false);
        setIsAvatarFull(false);
      }}
    >
      ← Профиль
    </button>
  )}

  <button
    type="button"
    className="employee-avatar-upload"
    onClick={() => {
      if (isProfileOpen) {
        setIsAvatarFull(true);
      } else {
        setIsProfileOpen(true);
        setIsProfilePanelOpen(true);
      }
    }}
  >
    {avatarUrl
      ? <img src={avatarUrl} alt="avatar" className="employee-avatar-image" />
      : <span>+</span>
    }
  </button>

 <input
  ref={avatarInputRef}
  type="file"
  accept="image/png,image/jpeg,image/webp"
  onChange={handleAvatarUpload}
  style={{ display: 'none' }}
/>

  {!isProfileOpen && (
    <div className="employee-header-meta">
      <p className={headerName.startsWith('Здравствуйте') ? 'greeting' : ''}>
        {headerName}
      </p>
    </div>
  )}

  {isProfileOpen && (
    <div className="avatar-profile-actions">
      <button
  className="avatar-edit-btn"
  onClick={() => avatarInputRef.current?.click()}
>
  Изменить
</button>

    </div>
  )}

</div>


          
          
          <button
            type="button"
            className="profile-panel-toggle"
            onClick={() => setIsProfilePanelOpen((prev) => !prev)}
          >
            Настройки профиля
          </button>
          {(isProfileOpen || isProfilePanelOpen) && (
            <div className="profile-panel">
              <form onSubmit={saveMyProfile} className="profile-form">
                <input placeholder="ФИО" value={profileForm.full_name} onChange={(e) => updateProfileField('full_name', e.target.value)} />
                <input placeholder="Должность" value={profileForm.position} onChange={(e) => updateProfileField('position', e.target.value)} />
                <input placeholder="Отдел" value={profileForm.department} onChange={(e) => updateProfileField('department', e.target.value)} />
                <input placeholder="Кабинет" value={profileForm.room} onChange={(e) => updateProfileField('room', e.target.value)} />
                <input placeholder="Внутренний телефон" value={profileForm.phone} onChange={(e) => updateProfileField('phone', e.target.value)} />
                <input placeholder="Сайт / соцссылка" value={profileForm.website} onChange={(e) => updateProfileField('website', e.target.value)} />
                <input placeholder="Статус (как в соцсети)" value={profileForm.statusText} onChange={(e) => updateProfileField('statusText', e.target.value)} />
                <textarea placeholder="О себе" rows={3} value={profileForm.bio} onChange={(e) => updateProfileField('bio', e.target.value)} />
                <button type="submit">Сохранить анкету</button>
              </form>
              <form onSubmit={changeMyPassword} className="profile-password-form">
                <input type="password" placeholder="Текущий пароль" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))} />
                <input type="password" placeholder="Новый пароль" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))} />
                <button type="submit">Обновить пароль</button>
              </form>
            </div>
          )}
          </div>
        </div>



        {/* 🔥 СКРЫВАЕМ ПОИСК И СПИСОК ПРИ ОТКРЫТОЙ АНКЕТЕ */}
{!isProfileMode && (
  <>
    <input
      className="employee-chat-search"
      placeholder="Поиск сотрудника..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />

    <div className={`employee-chat-list ${isManager ? 'manager-mode' : ''}`}>
        
        
        
        
          {availableEmployees.map((employee) => {
            const isOnline = Boolean(employee.isOnline);
            const isManagerContact = (employee.role || '').toLowerCase() === 'manager' || employee.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
            const profile = employee.profile || {};
            return (
              <button
                key={employee.email}
                className={`employee-chat-user ${selectedEmail === employee.email ? 'active' : ''} ${isManagerContact ? 'manager-priority' : ''}`}
                onClick={() => setSelectedEmail(employee.email)}
                onDoubleClick={() => openProfileCard(employee.email)}
              >
                <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
                <span className="employee-chat-user-main">
                  <span className="employee-chat-user-email">{employee.email}</span>
                  <span className="employee-chat-user-extra">{profile.full_name || 'Сотрудник'} · каб. {profile.room || '—'}</span>
                </span>
                <span className="employee-chat-user-status">{isManagerContact ? 'manager' : (isOnline ? 'online' : 'offline')}</span>
                {unreadByEmail[employee.email] > 0 && (
                  <span className="employee-chat-user-unread">{unreadByEmail[employee.email]}</span>
                )}
              </button>
            );
          })}
        </div>
        
          </>
)}

        {isEmployee && !isProfileMode && (
          <div className="employee-request-wrapper">
            <button
              type="button"
              className="request-panel-toggle request-primary-toggle"
              onClick={() => setIsRequestPanelOpen((prev) => !prev)}
            >
              {isRequestPanelOpen ? 'Скрыть заявку' : 'Сообщить о проблеме'}
            </button>
            {isRequestPanelOpen && (
              <form className="employee-request-box" onSubmit={submitRequest}>
                <h4>🛠Подать заявку</h4>
                <textarea
                  rows={3}
                  placeholder="Описание неисправности..."
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                />
                <button type="submit" disabled={!requestText.trim()}>Отправить</button>
                {requestStatus && <small>{requestStatus}</small>}
              </form>
            )}
          </div>
        )}

        {!isProfileMode && (
          <div className="employee-chat-actions">
            <button
              type="button"
              className="request-panel-toggle feed-toggle"
              onClick={() => setIsFeedOpen((prev) => !prev)}
            >
              {isFeedOpen ? 'Закрыть ленту' : 'Открыть ленту'}
            </button>
            <button className="clear-btn" onClick={clearConversation} disabled={!selectedEmail}>Удалить переписку</button>
            {!isAdmin && <button className="logout-btn" onClick={handleLogout}>Выход</button>}
          </div>
        )}
      </aside>

      <section className="employee-chat-main">
        {profileViewLogin && profilePreview && (
          <div className="profile-preview-card">
            <button type="button" className="back-to-chat-btn" onClick={() => setProfileViewLogin('')}>← Вернуться в чат</button>
            <div className="profile-preview-head">
              <div className="profile-preview-avatar">
                {profilePreview.avatar ? <img src={profilePreview.avatar} alt="profile-avatar" /> : <span>{String(profilePreview.full_name || profilePreview.login || '?').slice(0, 1).toUpperCase()}</span>}
              </div>
              <div>
                <h3>{profilePreview.full_name || profilePreview.login}</h3>
                <p>@{profilePreview.login}</p>
                <small>{profilePreview.statusText || 'Внутренняя страница сотрудника'}</small>
              </div>
            </div>
            <div className="profile-preview-grid">
              <div><strong>Должность:</strong> {profilePreview.position || '—'}</div>
              <div><strong>Отдел:</strong> {profilePreview.department || '—'}</div>
              <div><strong>Кабинет:</strong> {profilePreview.room || '—'}</div>
              <div><strong>Телефон:</strong> {profilePreview.phone || '—'}</div>
              <div><strong>Сайт:</strong> {profilePreview.website || '—'}</div>
              <div><strong>О себе:</strong> {profilePreview.bio || '—'}</div>
            </div>
            <button type="button" onClick={() => { setSelectedEmail(profilePreview.login); setProfileViewLogin(''); }}>Открыть диалог</button>
          </div>
        )}

        {!isFeedOpen && !profileViewLogin && (
          !selectedEmail ? (
            <div className="empty-chat">Выберите сотрудника слева, чтобы начать переписку.</div>
          ) : (
            <>
            <div className="conversation-header">Диалог с {selectedEmail}</div>

            {pinnedMessages.length > 0 && (
              <div className="pinned-box">
                <strong>📌 Закреплённые:</strong>
                {pinnedMessages.map((message) => (
                  <div key={`pin-${message.id}`}>• {message.text}</div>
                ))}
              </div>
            )}

            <div className="messages-wrap" ref={messagesWrapRef}>
              {currentMessages.length === 0 && <div className="empty-chat">Сообщений пока нет.</div>}
              {currentMessages.map((message) => {
                const canEdit = isManager || message.sender === user.username;
                const isMine = message.sender === user.username;
                const isRead = isMine && currentMessages.some((item) => item.sender !== user.username && new Date(item.createdAt) > new Date(message.createdAt));

                return (
                  <div key={message.id} className={`message-row ${isMine ? 'mine' : ''}`}>
                    <div className="message-bubble">
                      <div className="message-meta">
                        <span>{isMine ? 'Вы' : message.sender}</span>
                        <span>{new Date(message.createdAt).toLocaleString('ru-RU')}</span>
                      </div>

                      {message.replyTo && (
                        <div className="reply-preview">
                          ↪ {message.replyTo.sender}: {message.replyTo.text}
                        </div>
                      )}

                      <div>{message.text}</div>
                      {message.attachment?.dataUrl && (
                        <div className="message-attachment">
                          {String(message.attachment.type || '').startsWith('image/') ? (
                            <a href={message.attachment.dataUrl} target="_blank" rel="noreferrer">
                              <img src={message.attachment.dataUrl} alt={message.attachment.name || 'attachment'} />
                            </a>
                          ) : (
                            <a href={message.attachment.dataUrl} download={message.attachment.name || 'file'} target="_blank" rel="noreferrer">
                              📎 {message.attachment.name || 'Файл'} ({Math.max(1, Math.round((message.attachment.size || 0) / 1024))} КБ)
                            </a>
                          )}
                        </div>
                      )}
                      {message.editedAt && <small>изменено</small>}
                      {isMine && <small className="read-state">{isRead ? 'прочитано' : 'доставлено'}</small>}

                      <div className="reaction-row">
                        {REACTION_EMOJIS.map((emoji) => {
                          const count = message.reactions?.[emoji]?.length || 0;
                          const active = (message.reactions?.[emoji] || []).includes(user.username);
                          return (
                            <button key={emoji} className={active ? 'active' : ''} onClick={() => toggleReaction(message.id, emoji)}>
                              {emoji} {count > 0 ? count : ''}
                            </button>
                          );
                        })}
                      </div>

                      <div className="message-controls">
                        <button onClick={() => setReplyTo(message)}>Ответить</button>
                        <button onClick={() => togglePinned(message.id)}>{message.pinned ? 'Открепить' : 'Закрепить'}</button>
                        {canEdit && <button onClick={() => editMessage(message.id)}></button>}
                        {canEdit && <button onClick={() => deleteMessage(message.id)}>Удалить</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="composer-wrap">
              <div className="template-row">
                {templateMessages.map((template) => (
                  <button key={template} type="button" onClick={() => setDraft(template)}>{template}</button>
                ))}
              </div>

              {replyTo && (
                <div className="reply-preview active-reply">
                  Ответ на: {replyTo.sender}: {replyTo.text}
                  <button type="button" onClick={() => setReplyTo(null)}>×</button>
                </div>
              )}

              {attachmentDraft && (
                <div className="attachment-preview">
                  <span>📎 {attachmentDraft.name} ({Math.max(1, Math.round(attachmentDraft.size / 1024))} КБ)</span>
                  <button type="button" onClick={() => setAttachmentDraft(null)}>Убрать</button>
                </div>
              )}

              {typingHint && <div className="typing-hint">{typingHint}</div>}

              <form className="message-form" onSubmit={handleSend}>
                <input
                  placeholder="Введите сообщение..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={2000}
                />
                <label className="attach-file-btn">
                  📎 Файл
                  <input type="file" hidden onChange={handleAttachmentChange} />
                </label>
                <button type="submit">Отправить</button>
              </form>
            </div>
            </>
          )
        )}

        
        
        {isAvatarFull && (
  <div className="avatar-fullscreen">

    <div className="avatar-full-header">
      <button onClick={() => setIsAvatarFull(false)}>
        ← Фото профиля
      </button>

      <button
        className="avatar-edit-icon"
        onClick={() => avatarInputRef.current?.click()}
      >
        ✏️
      </button>
    </div>

    {avatarUrl ? (
      <img src={avatarUrl} alt="Фото профиля" className="avatar-full-image" />
    ) : (
      <div className="avatar-full-placeholder" aria-label="Фото профиля отсутствует">
        {String(baseDisplayName || user?.username || '?').slice(0, 1).toUpperCase()}
      </div>
    )}

    {avatarUrl && (
      <button
        className="avatar-delete-btn"
        onClick={removeAvatar}
      >
        Удалить фото
      </button>
    )}
  </div>
)}
       

        {isAvatarModalOpen && (
          <div className="avatar-modal" onClick={() => setIsAvatarModalOpen(false)}>
            <img src={avatarUrl} alt="avatar-full" className="avatar-modal-image" />
          </div>
        )}

        {isFeedOpen && (
        <section className="employee-feed-section">
          <h3>Лента сотрудников</h3>
          <form className="employee-feed-composer" onSubmit={addFeedPost}>
            <textarea
              rows={3}
              placeholder="Поделитесь новостью, как в твиттере…"
              value={feedDraft}
              onChange={(e) => setFeedDraft(e.target.value)}
            />
            {feedAttachment && (
              <div className="employee-feed-attachment-preview">
                📎 {feedAttachment.name} ({Math.max(1, Math.round(feedAttachment.size / 1024))} КБ)
                <button type="button" onClick={() => setFeedAttachment(null)}>Убрать</button>
              </div>
            )}
            <div className="employee-feed-composer-actions">
              <label>
                📎 Файл/Фото/Видео
                <input type="file" hidden onChange={onFeedFileChange} />
              </label>
              <button type="submit">Опубликовать</button>
            </div>
          </form>

          <div className="employee-feed-list">
            {feedPosts.length === 0 && <div className="empty-chat">Пока нет публикаций.</div>}
            {feedPosts.map((post) => (
              <article key={post.id} className="employee-feed-post">
                <header>
                  <strong>{post.authorName}</strong>
                  <small>@{post.author} · {new Date(post.createdAt).toLocaleString('ru-RU')}</small>
                </header>
                {post.text && <p>{post.text}</p>}
                {post.attachment?.dataUrl && (
                  <div className="employee-feed-attachment">
                    {String(post.attachment.type || '').startsWith('image/') && <img src={post.attachment.dataUrl} alt={post.attachment.name || 'post-image'} />}
                    {String(post.attachment.type || '').startsWith('video/') && <video controls src={post.attachment.dataUrl} />}
                    {!String(post.attachment.type || '').startsWith('image/') && !String(post.attachment.type || '').startsWith('video/') && (
                      <a href={post.attachment.dataUrl} download={post.attachment.name || 'file'}>📎 {post.attachment.name || 'Файл'}</a>
                    )}
                  </div>
                )}
                <div className="employee-feed-comments">
                  {(post.comments || []).map((comment) => (
                    <div key={comment.id} className="employee-feed-comment">
                      <strong>{comment.authorName}</strong>: {comment.text}
                    </div>
                  ))}
                  <div className="employee-feed-comment-form">
                    <input
                      placeholder="Оставить комментарий…"
                      value={commentDrafts[post.id] || ''}
                      onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                    />
                    <button type="button" onClick={() => addCommentToPost(post.id)}>Отправить</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
        )}

        {isManager && (
          <div className="manager-panels">
            <section className="manager-panel">
              <h3>Управление сотрудниками</h3>
              <form className="manager-form" onSubmit={saveEmployee}>
                <input placeholder="Логин (email)" value={employeeForm.login} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, login: e.target.value }))} required />
                <input placeholder={employeeForm.id ? 'Новый пароль (опционально)' : 'Пароль'} value={employeeForm.password} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, password: e.target.value }))} />
                <input placeholder="ФИО" value={employeeForm.full_name} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, full_name: e.target.value }))} />
                <input placeholder="Отдел" value={employeeForm.department} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, department: e.target.value }))} />
                <div className="manager-form-actions">
                  <button type="submit">{employeeForm.id ? 'Сохранить' : 'Добавить'}</button>
                  {employeeForm.id && <button type="button" onClick={() => setEmployeeForm({ id: null, login: '', password: '', full_name: '', department: '', phone: '', room: '' })}>Отмена</button>}
                </div>
              </form>

              <div className="manager-list">
                {directoryEmployees.map((employee) => (
                  <div className="manager-list-item" key={employee.id}>
                    <div>
                      <strong>{employee.login}</strong>
                      <div>{employee.full_name || '—'}</div>
                    </div>
                    <div className="manager-list-actions">
                      <button onClick={() => setEmployeeForm({
                        id: employee.id,
                        login: employee.login || '',
                        password: '',
                        full_name: employee.full_name || '',
                        department: employee.department || '',
                        phone: employee.phone || '',
                        room: employee.room || ''
                      })}
                      >Редактировать</button>
                      <button onClick={() => deleteEmployee(employee.id)}>Удалить</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="manager-panel">
              <h3>Переписка сотрудников</h3>
              <div className="threads-grid">
                <div className="threads-list">
                  {allConversationIds.map((threadId) => {
                    const participants = getParticipantsFromThreadId(threadId);
                    return (
                      <button key={threadId} className={`thread-item ${selectedThreadId === threadId ? 'active' : ''}`} onClick={() => setSelectedThreadId(threadId)}>
                        {participants.join(' ↔ ')}
                      </button>
                    );
                  })}
                </div>

                <div className="threads-messages">
                  {!selectedThreadId && <div className="empty-chat">Выберите переписку.</div>}
                  {selectedThreadId && selectedThreadMessages.map((message) => (
                    <div key={message.id} className="audit-message">
                      <div className="message-meta">
                        <span>{message.sender}</span>
                        <span>{new Date(message.createdAt).toLocaleString('ru-RU')}</span>
                      </div>
                      <div>{message.text}</div>
                      {message.attachment?.dataUrl && (
                        <div className="message-attachment">
                          {String(message.attachment.type || '').startsWith('image/') ? (
                            <a href={message.attachment.dataUrl} target="_blank" rel="noreferrer">
                              <img src={message.attachment.dataUrl} alt={message.attachment.name || 'attachment'} />
                            </a>
                          ) : (
                            <a href={message.attachment.dataUrl} download={message.attachment.name || 'file'} target="_blank" rel="noreferrer">
                              📎 {message.attachment.name || 'Файл'} ({Math.max(1, Math.round((message.attachment.size || 0) / 1024))} КБ)
                            </a>
                          )}
                        </div>
                      )}
                      <div className="message-controls">
                        <button onClick={() => editMessage(message.id, selectedThreadId)}>Изменить</button>
                        <button onClick={() => deleteMessage(message.id, selectedThreadId)}>Удалить</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
};

export default EmployeeChat;
