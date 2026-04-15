import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { MANAGER_CREDENTIALS } from '../config/authConfig';
import './EmployeeChat.css';

const ONLINE_TIMEOUT_MS = 2 * 60 * 1000;

const getConversationId = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('::');
const createMessageId = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

const getParticipantsFromThreadId = (threadId = '') => threadId.split('::').filter(Boolean);


const CHAT_READ_STATE_KEY = 'chatReadState';

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

const EmployeeChat = () => {
  const { user, logout, employeeDirectory } = useAuth();
  const isManager = user?.role === 'manager';

  const [threads, setThreads] = useState({});
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [readState, setReadState] = useState(() => readReadState(user?.username || 'guest'));

  const [directoryEmployees, setDirectoryEmployees] = useState([]);
  const [employeeForm, setEmployeeForm] = useState({
    id: null,
    login: '',
    password: '',
    full_name: '',
    department: '',
    phone: '',
    room: ''
  });

  const resetEmployeeForm = () => {
    setEmployeeForm({
      id: null,
      login: '',
      password: '',
      full_name: '',
      department: '',
      phone: '',
      room: ''
    });
  };

  const currentConversationId = selectedEmail ? getConversationId(user.username, selectedEmail) : null;
  const currentMessages = currentConversationId ? (threads[currentConversationId] || []) : [];
  const selectedThreadMessages = selectedThreadId ? (threads[selectedThreadId] || []) : [];


  useEffect(() => {
    setReadState(readReadState(user?.username || 'guest'));
  }, [user?.username]);


  const fetchThreads = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/threads`);
      if (!response.ok) return;

      const data = await response.json();
      const nextThreads = data?.threads && typeof data.threads === 'object' ? data.threads : {};
      setThreads(nextThreads);
    } catch (error) {
      console.error('Ошибка загрузки переписки:', error);
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/employees`);
      if (!response.ok) return;

      const data = await response.json();
      setDirectoryEmployees(Array.isArray(data?.employees) ? data.employees : []);
    } catch (error) {
      console.error('Ошибка загрузки сотрудников:', error);
    }
  }, []);

  const persistThreadMessages = useCallback(async (conversationId, messages) => {
    const response = await fetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
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

  const deleteConversationOnServer = useCallback(async (conversationId) => {
    const response = await fetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE'
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Не удалось удалить переписку');
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

  useEffect(() => {
    if (!selectedEmail && directoryEmployees.length > 0) {
      const fallback = directoryEmployees.find((item) => item.login !== user?.username);
      if (fallback) setSelectedEmail(fallback.login);
    }
  }, [directoryEmployees, selectedEmail, user]);

  const availableEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const presenceMap = new Map(
      employeeDirectory.map((item) => [item.email?.toLowerCase(), item])
    );

    const sourceEmployees = [...directoryEmployees];
    const hasManager = sourceEmployees.some((item) => item.login.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase());

    if (!hasManager) {
      sourceEmployees.push({
        id: 'manager-static',
        login: MANAGER_CREDENTIALS.username,
        full_name: MANAGER_CREDENTIALS.name
      });
    }

    return sourceEmployees
      .filter((item) => item.login !== user?.username)
      .filter((item) => !normalizedSearch || item.login.toLowerCase().includes(normalizedSearch))
      .map((item) => {
        const presence = presenceMap.get(item.login.toLowerCase());
        return {
          email: item.login,
          isOnline: Boolean(presence?.isOnline),
          lastSeen: presence?.lastSeen || null
        };
      })
      .sort((a, b) => {
        const aOnline = Boolean(a.isOnline) && a.lastSeen && Date.now() - new Date(a.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
        const bOnline = Boolean(b.isOnline) && b.lastSeen && Date.now() - new Date(b.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
        if (aOnline !== bOnline) return bOnline - aOnline;
        return a.email.localeCompare(b.email);
      });
  }, [directoryEmployees, employeeDirectory, search, user]);

  const allConversationIds = useMemo(() => Object.keys(threads).sort(), [threads]);

  const unreadByEmail = useMemo(() => {
    const map = {};
    availableEmployees.forEach((employee) => {
      const conversationId = getConversationId(user.username, employee.email);
      const lastReadAt = readState[conversationId] ? new Date(readState[conversationId]).getTime() : 0;
      const unreadCount = (threads[conversationId] || []).filter((message) => (
        message.sender !== user.username
        && new Date(message.createdAt).getTime() > lastReadAt
      )).length;
      map[employee.email] = unreadCount;
    });
    return map;
  }, [availableEmployees, readState, threads, user.username]);


  useEffect(() => {
    if (!selectedEmail) return;
    const exists = availableEmployees.some((item) => item.email === selectedEmail);
    if (!exists) {
      setSelectedEmail('');
    }
  }, [availableEmployees, selectedEmail]);


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
      if (currentRead && new Date(currentRead).getTime() >= new Date(latestIncoming).getTime()) {
        return prev;
      }

      const next = { ...prev, [currentConversationId]: latestIncoming };
      saveReadState(user.username, next);
      return next;
    });
  }, [currentConversationId, threads, user.username]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !currentConversationId) return;

    const newMessage = {
      id: createMessageId(),
      sender: user.username,
      text: draft.trim(),
      createdAt: new Date().toISOString(),
      editedAt: null
    };

    const nextMessages = [...currentMessages, newMessage];

    try {
      await persistThreadMessages(currentConversationId, nextMessages);
      setDraft('');
    } catch (error) {
      window.alert(error.message || 'Не удалось отправить сообщение');
    }
  };

  const deleteMessage = async (messageId, targetConversationId = currentConversationId) => {
    if (!targetConversationId) return;

    const sourceMessages = threads[targetConversationId] || [];
    const nextMessages = sourceMessages.filter((item) => item.id !== messageId);
    try {
      await persistThreadMessages(targetConversationId, nextMessages);
    } catch (error) {
      window.alert(error.message || 'Не удалось удалить сообщение');
    }
  };

  const editMessage = async (messageId, targetConversationId = currentConversationId) => {
    const nextText = window.prompt('Изменить сообщение:');
    if (!nextText || !targetConversationId) return;

    const sourceMessages = threads[targetConversationId] || [];
    const nextMessages = sourceMessages.map((item) => {
      if (item.id !== messageId) return item;
      return { ...item, text: nextText.trim(), editedAt: new Date().toISOString() };
    });

    try {
      await persistThreadMessages(targetConversationId, nextMessages);
    } catch (error) {
      window.alert(error.message || 'Не удалось изменить сообщение');
    }
  };

  const clearConversation = async () => {
    if (!currentConversationId) return;
    if (!window.confirm('Удалить всю переписку с этим сотрудником?')) return;

    try {
      await deleteConversationOnServer(currentConversationId);
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
    const url = isEdit
      ? `${API_BASE_URL}/auth/employees/${employeeForm.id}`
      : `${API_BASE_URL}/auth/register`;
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
    resetEmployeeForm();
  };

  const deleteEmployee = async (employeeId) => {
    if (!window.confirm('Удалить сотрудника?')) return;

    const response = await fetch(`${API_BASE_URL}/auth/employees/${employeeId}`, {
      method: 'DELETE'
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(data.message || 'Не удалось удалить сотрудника');
      return;
    }

    await fetchEmployees();
  };

  return (
    <div className="employee-chat-layout">
      <aside className="employee-chat-sidebar">
        <div className="employee-chat-header">
          <h2>Чаты сотрудников</h2>
          <p>{user?.username}</p>
        </div>

        <input
          className="employee-chat-search"
          placeholder="Поиск сотрудника..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="employee-chat-list">
          {availableEmployees.map((employee) => {
            const isOnline = Boolean(employee.isOnline)
              && employee.lastSeen
              && Date.now() - new Date(employee.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
            return (
              <button
                key={employee.email}
                className={`employee-chat-user ${selectedEmail === employee.email ? 'active' : ''}`}
                onClick={() => setSelectedEmail(employee.email)}
              >
                <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
                <span className="employee-chat-user-email">{employee.email}</span>
                <span className="employee-chat-user-status">{isOnline ? 'online' : 'offline'}</span>
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
            <div className="messages-wrap">
              {currentMessages.length === 0 && <div className="empty-chat">Сообщений пока нет.</div>}
              {currentMessages.map((message) => {
                const canEdit = isManager || message.sender === user.username;
                const isMine = message.sender === user.username;
                return (
                  <div key={message.id} className={`message-row ${isMine ? 'mine' : ''}`}>
                    <div className="message-bubble">
                      <div className="message-meta">
                        <span>{isMine ? 'Вы' : message.sender}</span>
                        <span>{new Date(message.createdAt).toLocaleString('ru-RU')}</span>
                      </div>
                      <div>{message.text}</div>
                      {message.editedAt && <small>изменено</small>}
                      {canEdit && (
                        <div className="message-controls">
                          <button onClick={() => editMessage(message.id)}>Изменить</button>
                          <button onClick={() => deleteMessage(message.id)}>Удалить</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="message-form" onSubmit={handleSend}>
              <input
                placeholder="Введите сообщение..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
              />
              <button type="submit">Отправить</button>
            </form>
          </>
        )}

        {isManager && (
          <div className="manager-panels">
            <section className="manager-panel">
              <h3>Управление сотрудниками</h3>
              <form className="manager-form" onSubmit={saveEmployee}>
                <input
                  placeholder="Логин (email)"
                  value={employeeForm.login}
                  onChange={(e) => setEmployeeForm((prev) => ({ ...prev, login: e.target.value }))}
                  required
                />
                <input
                  placeholder={employeeForm.id ? 'Новый пароль (опционально)' : 'Пароль'}
                  value={employeeForm.password}
                  onChange={(e) => setEmployeeForm((prev) => ({ ...prev, password: e.target.value }))}
                />
                <input
                  placeholder="ФИО"
                  value={employeeForm.full_name}
                  onChange={(e) => setEmployeeForm((prev) => ({ ...prev, full_name: e.target.value }))}
                />
                <input
                  placeholder="Отдел"
                  value={employeeForm.department}
                  onChange={(e) => setEmployeeForm((prev) => ({ ...prev, department: e.target.value }))}
                />
                <div className="manager-form-actions">
                  <button type="submit">{employeeForm.id ? 'Сохранить' : 'Добавить'}</button>
                  {employeeForm.id && <button type="button" onClick={resetEmployeeForm}>Отмена</button>}
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
                      <button
                        onClick={() => setEmployeeForm({
                          id: employee.id,
                          login: employee.login || '',
                          password: '',
                          full_name: employee.full_name || '',
                          department: employee.department || '',
                          phone: employee.phone || '',
                          room: employee.room || ''
                        })}
                      >
                        Редактировать
                      </button>
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
                      <button
                        key={threadId}
                        className={`thread-item ${selectedThreadId === threadId ? 'active' : ''}`}
                        onClick={() => setSelectedThreadId(threadId)}
                      >
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
