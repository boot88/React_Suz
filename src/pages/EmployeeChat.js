import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { CHAT_THREADS_KEY } from '../config/authConfig';
import './EmployeeChat.css';

const ONLINE_TIMEOUT_MS = 2 * 60 * 1000;

const getConversationId = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('::');

const readThreads = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_THREADS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
};

const EmployeeChat = () => {
  const { user, logout, employeeDirectory } = useAuth();
  const [threads, setThreads] = useState(readThreads);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === CHAT_THREADS_KEY) {
        setThreads(readThreads());
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!selectedEmail && employeeDirectory.length > 0) {
      const fallback = employeeDirectory.find((item) => item.email !== user?.username);
      if (fallback) setSelectedEmail(fallback.email);
    }
  }, [employeeDirectory, selectedEmail, user]);

  const availableEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return employeeDirectory
      .filter((item) => item.email !== user?.username)
      .filter((item) => !normalizedSearch || item.email.toLowerCase().includes(normalizedSearch))
      .sort((a, b) => {
        const aOnline = a.lastSeen && Date.now() - new Date(a.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
        const bOnline = b.lastSeen && Date.now() - new Date(b.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
        if (aOnline !== bOnline) return bOnline - aOnline;
        return a.email.localeCompare(b.email);
      });
  }, [employeeDirectory, search, user]);

  const currentConversationId = selectedEmail ? getConversationId(user.username, selectedEmail) : null;
  const currentMessages = currentConversationId ? (threads[currentConversationId] || []) : [];

  const persistThreads = (nextThreads) => {
    localStorage.setItem(CHAT_THREADS_KEY, JSON.stringify(nextThreads));
    setThreads(nextThreads);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!draft.trim() || !currentConversationId) return;

    const newMessage = {
      id: crypto.randomUUID(),
      sender: user.username,
      text: draft.trim(),
      createdAt: new Date().toISOString(),
      editedAt: null
    };

    const nextThreads = {
      ...threads,
      [currentConversationId]: [...currentMessages, newMessage]
    };

    persistThreads(nextThreads);
    setDraft('');
  };

  const deleteMessage = (messageId) => {
    if (!currentConversationId) return;

    const nextMessages = currentMessages.filter((item) => item.id !== messageId);
    const nextThreads = { ...threads, [currentConversationId]: nextMessages };
    persistThreads(nextThreads);
  };

  const editMessage = (messageId) => {
    const nextText = window.prompt('Изменить сообщение:');
    if (!nextText || !currentConversationId) return;

    const nextMessages = currentMessages.map((item) => {
      if (item.id !== messageId) return item;
      return { ...item, text: nextText.trim(), editedAt: new Date().toISOString() };
    });

    persistThreads({ ...threads, [currentConversationId]: nextMessages });
  };

  const clearConversation = () => {
    if (!currentConversationId) return;
    if (!window.confirm('Удалить всю переписку с этим сотрудником?')) return;

    const nextThreads = { ...threads };
    delete nextThreads[currentConversationId];
    persistThreads(nextThreads);
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
            const isOnline = employee.lastSeen && Date.now() - new Date(employee.lastSeen).getTime() < ONLINE_TIMEOUT_MS;
            return (
              <button
                key={employee.email}
                className={`employee-chat-user ${selectedEmail === employee.email ? 'active' : ''}`}
                onClick={() => setSelectedEmail(employee.email)}
              >
                <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
                <span className="employee-chat-user-email">{employee.email}</span>
                <span className="employee-chat-user-status">{isOnline ? 'online' : 'offline'}</span>
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
                      {isMine && (
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
      </section>
    </div>
  );
};

export default EmployeeChat;
