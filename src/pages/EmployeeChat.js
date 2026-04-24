import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { MANAGER_CREDENTIALS } from '../config/authConfig';
import './EmployeeChat.css';

const ONLINE_TIMEOUT_MS = 2 * 60 * 1000;
const CHAT_READ_STATE_KEY = 'chatReadState';
const MANAGER_TEMPLATE_MESSAGES = ['✅ Принято в работу', '🔧 Проверяю сейчас', '👍 Спасибо, получил', '📌 Уточните, пожалуйста, детали', '⏱️ Вернусь с ответом в течение 15 минут', '🧩 Проблема воспроизведена, исправляю'];
const EMPLOYEE_TEMPLATE_MESSAGES = ['Привет! 👋', 'Как дела? 🙂', 'Спасибо большое! 🙏', 'Отлично, договорились ✅', 'Я на месте, можем созвониться? 📞', 'Хорошего дня! ☀️'];
const REACTION_EMOJIS = ['👍', '✅', '🔧'];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const getConversationId = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('::');
const getParticipantsFromThreadId = (threadId = '') => threadId.split('::').filter(Boolean);
const getAvatarKey = (username = 'unknown') => `employeeAvatar:${username.toLowerCase()}`;

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

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const EmployeeChat = () => {
  const { user, logout, employeeDirectory } = useAuth();
  const isManager = user?.role === 'manager';
  const baseDisplayName = user?.name || user?.username || 'Сотрудник';

  const [threads, setThreads] = useState({});
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draft, setDraft] = useState('');
  const [attachmentDraft, setAttachmentDraft] = useState(null);
  const [search, setSearch] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [readState, setReadState] = useState(() => readReadState(user?.username || 'guest'));
  const [directoryEmployees, setDirectoryEmployees] = useState([]);
  const [isDirectoryLoaded, setIsDirectoryLoaded] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [headerName, setHeaderName] = useState(baseDisplayName);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const messagesWrapRef = useRef(null);
  const forceScrollRef = useRef(false);

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
    const storedAvatar = localStorage.getItem(getAvatarKey(user.username)) || '';
    setAvatarUrl(storedAvatar);

    const greeting = `Здравствуйте, ${baseDisplayName}!`;
    setHeaderName(greeting);
    const timer = setTimeout(() => setHeaderName(baseDisplayName), 3000);
    return () => clearTimeout(timer);
  }, [baseDisplayName, user?.username]);

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
      setDirectoryEmployees(Array.isArray(data?.employees) ? data.employees : []);
    } catch (error) {
      console.error('Ошибка загрузки сотрудников:', error);
    } finally {
      setIsDirectoryLoaded(true);
    }
  }, []);

  const persistThreadMessages = useCallback(async (conversationId, messages) => {
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

  const chatCandidates = useMemo(() => {
    if (!isManager && !isDirectoryLoaded) {
      return [];
    }

    const presenceMap = new Map(employeeDirectory.map((item) => [item.email?.toLowerCase(), item]));
    const sourceEmployees = [...directoryEmployees];

    const shouldInjectManagerFallback = isManager;
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
        if (!isManager) {
          return a.email.localeCompare(b.email);
        }

        const aIsManager = (a.role || '').toLowerCase() === 'manager' || a.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
        const bIsManager = (b.role || '').toLowerCase() === 'manager' || b.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
        if (aIsManager !== bIsManager) return aIsManager ? -1 : 1;

        const aOnline = Boolean(a.isOnline) && a.lastSeen && Date.now() - new Date(a.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
        const bOnline = Boolean(b.isOnline) && b.lastSeen && Date.now() - new Date(b.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
        if (aOnline !== bOnline) return bOnline - aOnline;
        return a.email.localeCompare(b.email);
      });
  }, [directoryEmployees, employeeDirectory, isDirectoryLoaded, isManager, user?.username]);

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
      localStorage.setItem(getAvatarKey(user.username), optimizedAvatar);
    } catch {
      window.alert('Не удалось обработать изображение. Попробуйте другое фото.');
    }
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

  const typingHint = draft.trim().length > 0 ? 'Вы печатаете…' : '';

  return (
    <div className="employee-chat-layout">
      <aside className="employee-chat-sidebar">
        <div className="employee-chat-header">
          <div className="employee-avatar-wrap">
            <button type="button" className="employee-avatar-upload" title="Открыть аватар" onClick={() => avatarUrl && setIsAvatarModalOpen(true)}>
              {avatarUrl ? <img src={avatarUrl} alt="avatar" className="employee-avatar-image" /> : <span>+</span>}
            </button>
            <input id="avatar-upload-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} hidden />

            <div className="employee-header-meta">
              <h2>Чаты сотрудников</h2>
              <p className={headerName.startsWith('Здравствуйте') ? 'greeting' : ''}>{headerName}</p>
              <label htmlFor="avatar-upload-input" className="avatar-edit-btn">Изменить фото</label>
            </div>
          </div>
          <small className="avatar-tip">Фото автоматически приводится к квадрату 256×256 для чёткого вида.</small>
        </div>

        <input
          className="employee-chat-search"
          placeholder="Поиск сотрудника..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="employee-chat-list">
          {availableEmployees.map((employee) => {
            const isOnline = Boolean(employee.isOnline) && employee.lastSeen && Date.now() - new Date(employee.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
            const isManagerContact = (employee.role || '').toLowerCase() === 'manager' || employee.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
            const profile = employee.profile || {};
            return (
              <button
                key={employee.email}
                className={`employee-chat-user ${selectedEmail === employee.email ? 'active' : ''} ${isManagerContact ? 'manager-priority' : ''}`}
                onClick={() => setSelectedEmail(employee.email)}
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

        <div className="employee-chat-actions">
          <button className="clear-btn" onClick={clearConversation} disabled={!selectedEmail}>Удалить переписку</button>
          <button className="logout-btn" onClick={logout}>Выход</button>
        </div>
      </aside>

      <section className="employee-chat-main">
        {!selectedEmail ? (
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
                        {canEdit && <button onClick={() => editMessage(message.id)}>Изменить</button>}
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
        )}


        {isAvatarModalOpen && (
          <div className="avatar-modal" onClick={() => setIsAvatarModalOpen(false)}>
            <img src={avatarUrl} alt="avatar-full" className="avatar-modal-image" />
          </div>
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
