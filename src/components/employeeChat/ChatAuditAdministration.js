import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../../utils/apiConfig';
import { authFetch } from '../../utils/authFetch';

const isValidDateRange = ({ from, to }) => Boolean(from && to && from <= to);

export default function ChatAuditAdministration({
  AttachmentCard,
  chatAuthHeaders,
  directoryEmployees,
  getMessageAttachments,
  interfaceLocale,
  isEnglishInterface,
  sameLogin,
  t
}) {
  const copy = useMemo(() => (isEnglishInterface ? {
    employee: 'Employee surname', employeePlaceholder: 'Start typing a surname', from: 'From', to: 'To',
    words: 'Words in messages', wordsPlaceholder: 'Narrow the result by words',
    firstStep: 'Start by selecting an employee from the directory.', secondStep: 'Now select the start and end dates.',
    invalidRange: 'The end date cannot be earlier than the start date.', searching: 'Searching conversations…',
    noDialogs: 'No conversations were found for this employee and period.', conversations: 'Conversations found',
    messages: 'messages', lastMessage: 'Last message', chooseConversation: 'Select a conversation on the left.',
    noMessages: 'No messages match the selected period and words.', loadPrevious: 'Load previous messages',
    searchFailed: 'Could not search employee conversations', conversationFailed: 'Could not open the conversation',
    selected: 'Selected employee'
  } : {
    employee: 'Фамилия сотрудника', employeePlaceholder: 'Начните вводить фамилию', from: 'С какого числа', to: 'По какое число',
    words: 'Поиск по словам', wordsPlaceholder: 'Сузить найденную переписку по словам',
    firstStep: 'Сначала выберите сотрудника из справочника.', secondStep: 'Теперь укажите начало и конец периода.',
    invalidRange: 'Конечная дата не может быть раньше начальной.', searching: 'Ищем переписку…',
    noDialogs: 'За выбранный период переписки этого сотрудника не найдено.', conversations: 'Найденные переписки',
    messages: 'сообщений', lastMessage: 'Последнее сообщение', chooseConversation: 'Выберите переписку слева.',
    noMessages: 'В выбранном периоде нет сообщений, подходящих под поиск.', loadPrevious: 'Загрузить предыдущие сообщения',
    searchFailed: 'Не удалось найти переписку сотрудника', conversationFailed: 'Не удалось открыть переписку',
    selected: 'Выбран сотрудник'
  }), [isEnglishInterface]);

  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employeeLogin, setEmployeeLogin] = useState('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [wordSearch, setWordSearch] = useState('');
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messagesBefore, setMessagesBefore] = useState('');
  const [messagesHaveMore, setMessagesHaveMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');

  const employeeOptions = useMemo(() => directoryEmployees
    .filter((employee) => employee?.login && String(employee.role || '').toLowerCase() !== 'admin')
    .map((employee) => {
      const login = String(employee.login).trim();
      const fullName = String(employee.full_name || employee.name || login).trim();
      return { ...employee, login, fullName, optionLabel: fullName === login ? login : `${fullName} (${login})` };
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName, isEnglishInterface ? 'en' : 'ru')),
  [directoryEmployees, isEnglishInterface]);

  const selectedEmployee = useMemo(() => employeeOptions.find((employee) => sameLogin(employee.login, employeeLogin)) || null,
    [employeeLogin, employeeOptions, sameLogin]);
  const rangeIsValid = isValidDateRange(dateRange);
  const searchReady = Boolean(employeeLogin && rangeIsValid);

  const clearResults = useCallback(() => {
    setConversations([]);
    setSelectedConversationId('');
    setMessages([]);
    setMessagesBefore('');
    setMessagesHaveMore(false);
    setError('');
  }, []);

  const handleEmployeeInput = (value) => {
    setEmployeeQuery(value);
    const normalized = String(value || '').trim().toLowerCase();
    const match = employeeOptions.find((employee) => (
      employee.optionLabel.toLowerCase() === normalized
      || employee.login.toLowerCase() === normalized
      || employee.fullName.toLowerCase() === normalized
    ));
    const nextLogin = match?.login || '';
    if (!sameLogin(nextLogin, employeeLogin)) {
      setEmployeeLogin(nextLogin);
      setDateRange({ from: '', to: '' });
      setWordSearch('');
      clearResults();
    }
  };

  const getEmployeeName = useCallback((login) => {
    const employee = employeeOptions.find((item) => sameLogin(item.login, login));
    return employee?.fullName || login || '—';
  }, [employeeOptions, sameLogin]);

  const fetchConversations = useCallback(async (signal) => {
    if (!searchReady) return;
    setSearchLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ employee: employeeLogin, from: dateRange.from, to: dateRange.to });
      if (wordSearch.trim()) params.set('q', wordSearch.trim());
      const response = await authFetch(`${API_BASE_URL}/chat/audit/conversations?${params.toString()}`, {
        headers: chatAuthHeaders,
        signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || copy.searchFailed);
      const nextConversations = Array.isArray(data?.conversations) ? data.conversations : [];
      setConversations(nextConversations);
      setSelectedConversationId((current) => (
        nextConversations.some((conversation) => conversation.conversation_id === current)
          ? current
          : (nextConversations[0]?.conversation_id || '')
      ));
      if (nextConversations.length === 0) {
        setMessages([]);
        setMessagesBefore('');
        setMessagesHaveMore(false);
      }
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError.message || copy.searchFailed);
        setConversations([]);
        setSelectedConversationId('');
        setMessages([]);
      }
    } finally {
      if (!signal?.aborted) setSearchLoading(false);
    }
  }, [chatAuthHeaders, copy.searchFailed, dateRange.from, dateRange.to, employeeLogin, searchReady, wordSearch]);

  const fetchMessages = useCallback(async (conversationId, { append = false, signal } = {}) => {
    if (!conversationId || !searchReady) return;
    setMessagesLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ employee: employeeLogin, from: dateRange.from, to: dateRange.to, limit: '200' });
      if (wordSearch.trim()) params.set('q', wordSearch.trim());
      if (append && messagesBefore) params.set('before', messagesBefore);
      const response = await authFetch(
        `${API_BASE_URL}/chat/audit/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
        { headers: chatAuthHeaders, signal }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || copy.conversationFailed);
      const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
      setMessages((current) => append
        ? [...new Map([...nextMessages, ...current].map((message) => [message.id, message])).values()]
        : nextMessages);
      setMessagesBefore(data?.before || '');
      setMessagesHaveMore(Boolean(data?.hasMore));
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError.message || copy.conversationFailed);
        if (!append) setMessages([]);
      }
    } finally {
      if (!signal?.aborted) setMessagesLoading(false);
    }
  }, [chatAuthHeaders, copy.conversationFailed, dateRange.from, dateRange.to, employeeLogin, messagesBefore, searchReady, wordSearch]);

  useEffect(() => {
    if (!employeeLogin || !dateRange.from || !dateRange.to) {
      clearResults();
      return undefined;
    }
    if (!rangeIsValid) {
      clearResults();
      setError(copy.invalidRange);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetchConversations(controller.signal), wordSearch.trim() ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [clearResults, copy.invalidRange, dateRange.from, dateRange.to, employeeLogin, fetchConversations, rangeIsValid, wordSearch]);

  useEffect(() => {
    setMessages([]);
    setMessagesBefore('');
    setMessagesHaveMore(false);
    if (!selectedConversationId || !searchReady) return undefined;
    const controller = new AbortController();
    fetchMessages(selectedConversationId, { signal: controller.signal });
    return () => controller.abort();
  // The message cursor must not retrigger the initial page request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId, employeeLogin, dateRange.from, dateRange.to, wordSearch, searchReady]);

  const showInitialHint = !employeeLogin;
  const showDateHint = Boolean(employeeLogin && (!dateRange.from || !dateRange.to));

  return (
    <section className="manager-panel audit-search-panel">
      <div className="audit-search-heading">
        <div>
          <h2>{t('employeeMessages')}</h2>
          <p>{isEnglishInterface
            ? 'Select an employee and a period first. Message search becomes available after the conversations are loaded.'
            : 'Сначала выберите сотрудника и период. После загрузки переписки можно уточнить результат поиском по словам.'}</p>
        </div>
        {selectedEmployee && <span>{copy.selected}: <strong>{selectedEmployee.fullName}</strong></span>}
      </div>

      <div className="audit-search-form">
        <label className="audit-search-field audit-search-field--employee">
          <span>1. {copy.employee}</span>
          <input type="text" list="audit-employee-options" value={employeeQuery} onChange={(event) => handleEmployeeInput(event.target.value)} placeholder={copy.employeePlaceholder} autoComplete="off" />
          <datalist id="audit-employee-options">
            {employeeOptions.map((employee) => <option key={employee.login} value={employee.optionLabel}>{employee.department || employee.login}</option>)}
          </datalist>
        </label>
        <label className="audit-search-field">
          <span>2. {copy.from}</span>
          <input type="date" value={dateRange.from} disabled={!employeeLogin} onChange={(event) => setDateRange((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label className="audit-search-field">
          <span>{copy.to}</span>
          <input type="date" value={dateRange.to} min={dateRange.from || undefined} disabled={!employeeLogin} onChange={(event) => setDateRange((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <label className="audit-search-field audit-search-field--words">
          <span>3. {copy.words}</span>
          <input type="search" value={wordSearch} onChange={(event) => setWordSearch(event.target.value)} placeholder={copy.wordsPlaceholder} disabled={!searchReady} />
        </label>
      </div>

      {error && <div className="audit-search-error" role="alert">{error}</div>}
      {showInitialHint && <div className="audit-search-empty"><b>1</b><span>{copy.firstStep}</span></div>}
      {showDateHint && <div className="audit-search-empty"><b>2</b><span>{copy.secondStep}</span></div>}
      {searchReady && searchLoading && conversations.length === 0 && <div className="audit-search-empty"><span>{copy.searching}</span></div>}
      {searchReady && !searchLoading && !error && conversations.length === 0 && <div className="audit-search-empty"><span>{copy.noDialogs}</span></div>}

      {searchReady && conversations.length > 0 && (
        <div className="audit-results">
          <div className="audit-results-summary"><strong>{copy.conversations}</strong><span>{conversations.length}</span></div>
          <div className="threads-grid audit-results-grid">
            <div className="threads-list audit-conversation-list">
              {conversations.map((conversation) => {
                const participants = [conversation.participant_a, conversation.participant_b].map(getEmployeeName);
                return (
                  <button key={conversation.conversation_id} type="button" className={`thread-item ${selectedConversationId === conversation.conversation_id ? 'active' : ''}`} onClick={() => setSelectedConversationId(conversation.conversation_id)}>
                    <span className="thread-title">{participants.join(' — ')}</span>
                    <span className="thread-stats"><b>{Number(conversation.message_count) || 0}</b> {copy.messages}{Number(conversation.file_count) > 0 ? ` · 📎 ${conversation.file_count}` : ''}</span>
                    <span className="thread-last">{copy.lastMessage}: {conversation.last_at ? new Date(conversation.last_at).toLocaleString(interfaceLocale) : '—'}</span>
                  </button>
                );
              })}
            </div>
            <div className="threads-messages audit-message-results">
              {!selectedConversationId && <div className="empty-chat">{copy.chooseConversation}</div>}
              {selectedConversationId && messagesHaveMore && <button type="button" className="chat-pagination-button" disabled={messagesLoading} onClick={() => fetchMessages(selectedConversationId, { append: true })}>{copy.loadPrevious}</button>}
              {selectedConversationId && messagesLoading && messages.length === 0 && <div className="empty-chat">{t('loading')}…</div>}
              {selectedConversationId && !messagesLoading && messages.length === 0 && <div className="empty-chat">{copy.noMessages}</div>}
              {messages.map((message) => {
                const isDeleted = Boolean(message.deletedAt);
                const attachments = getMessageAttachments(message);
                return (
                  <article key={message.id} className={`audit-message ${isDeleted ? 'deleted' : ''}`}>
                    <div className="message-meta"><span>{getEmployeeName(message.sender)}</span><span>{message.createdAt ? new Date(message.createdAt).toLocaleString(interfaceLocale) : '—'}</span></div>
                    {isDeleted && <em>{t('deletedMessage')}</em>}
                    {message.text && <div className="audit-message-text">{message.text}</div>}
                    {isDeleted && <div className="audit-history">{t('deletedBy')}: {getEmployeeName(message.deletedBy)} · {message.deletedAt ? new Date(message.deletedAt).toLocaleString(interfaceLocale) : '—'}</div>}
                    {attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${message.id}-audit-${index}`} cardKey={`${message.id}-audit-${index}`} file={file} isEnglish={isEnglishInterface} />)}</div>}
                    {Array.isArray(message.audit) && message.audit.length > 0 && <div className="audit-history"><strong>{t('history')}:</strong>{message.audit.slice(-4).map((entry, index) => <span key={`${message.id}-audit-entry-${index}`}>{entry.action || t('change')} · {getEmployeeName(entry.by)} · {entry.at ? new Date(entry.at).toLocaleString(interfaceLocale) : '—'}</span>)}</div>}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
