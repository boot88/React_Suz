import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../../utils/apiConfig';
import { authFetch } from '../../utils/authFetch';

const isValidDateRange = ({ from, to }) => Boolean(from && to && from <= to);

export default function ChatAuditAdministration({
  AttachmentCard,
  chatAuthHeaders,
  directoryEmployees,
  formatFileSize,
  getMessageAttachments,
  getOriginalAttachmentUrl,
  interfaceLocale,
  isEnglishInterface,
  isVideoAttachment,
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
  const [periodEmployees, setPeriodEmployees] = useState([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [wordSearch, setWordSearch] = useState('');
  const [conversations, setConversations] = useState([]);
  const [feedPosts, setFeedPosts] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messagesBefore, setMessagesBefore] = useState('');
  const [messagesHaveMore, setMessagesHaveMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [periodMode, setPeriodMode] = useState('month');
  const [periods, setPeriods] = useState([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodSource, setPeriodSource] = useState({ totalCount: 0, firstAt: null, lastAt: null, cutoffAt: null });
  const [periodAction, setPeriodAction] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const archiveInputRef = useRef(null);
  const refreshedArchivesRef = useRef(new Set());

  useEffect(() => {
    if (!previewFile) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setPreviewFile(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewFile]);

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/periods?mode=${periodMode}`, { headers: chatAuthHeaders });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить периоды');
      const nextPeriods = Array.isArray(data.periods) ? data.periods : [];
      setPeriods(nextPeriods);
      setPeriodSource({ ...(data.source || {}), cutoffAt: data.cutoffAt || null });
      return nextPeriods;
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить периоды');
      return [];
    } finally { setPeriodsLoading(false); }
  }, [chatAuthHeaders, periodMode]);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);
  useEffect(() => {
    if (!periods.some((period) => period.archiveStatus === 'pending')) return undefined;
    const timer = window.setInterval(loadPeriods, 2000);
    return () => window.clearInterval(timer);
  }, [loadPeriods, periods]);

  useEffect(() => {
    const stale = periods.filter((period) => period.needsRefresh && period.archiveId && !refreshedArchivesRef.current.has(period.archiveId));
    if (!stale.length) return undefined;
    let active = true;
    (async () => {
      for (const period of stale) {
        if (!active) break;
        refreshedArchivesRef.current.add(period.archiveId);
        await authFetch(`${API_BASE_URL}/chat/records/periods/${encodeURIComponent(period.periodKey)}/archive?mode=${periodMode}`, {
          method: 'POST', headers: { ...chatAuthHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: periodMode })
        }).catch(() => null);
      }
      if (active) window.setTimeout(loadPeriods, 1200);
    })();
    return () => { active = false; };
  }, [chatAuthHeaders, loadPeriods, periodMode, periods]);

  const selectPeriod = (period) => {
    if (period.state === 'deleted') return;
    setEmployeeQuery('');
    setEmployeeLogin('');
    setDateRange({ from: period.from, to: period.to });
    clearResults();
  };

  const updatePeriodDate = (field, value) => {
    setEmployeeQuery('');
    setEmployeeLogin('');
    setDateRange((current) => ({ ...current, [field]: value }));
    clearResults();
  };

  const chooseArchiveTarget = async (period) => {
    if (typeof window.showSaveFilePicker !== 'function') return null;
    return window.showSaveFilePicker({
      suggestedName: `Переписки-${period.periodKey}.zip`,
      types: [{ description: 'Архив переписки', accept: { 'application/zip': ['.zip'] } }]
    });
  };

  const waitForPeriodArchive = async (periodKey) => {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const nextPeriods = await loadPeriods();
      const current = nextPeriods.find((period) => period.periodKey === periodKey);
      if (current?.archiveStatus === 'completed') return current;
      if (current?.archiveStatus === 'failed') throw new Error('Не удалось сформировать архив');
    }
    throw new Error('Архив формируется слишком долго. Попробуйте сохранить его позднее.');
  };

  const createPeriodArchive = async (period) => {
    setPeriodAction(`archive:${period.periodKey}`); setError('');
    try {
      let fileHandle = null;
      try { fileHandle = await chooseArchiveTarget(period); }
      catch (pickerError) { if (pickerError?.name === 'AbortError') return; throw pickerError; }
      const response = await authFetch(`${API_BASE_URL}/chat/records/periods/${encodeURIComponent(period.periodKey)}/archive?mode=${periodMode}`, {
        method: 'POST', headers: { ...chatAuthHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: periodMode })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось создать архив');
      const readyPeriod = data?.archive?.status === 'completed'
        ? { ...period, archiveId: data.archive.id, archiveStatus: 'completed' }
        : await waitForPeriodArchive(period.periodKey);
      await downloadPeriodArchive(readyPeriod, fileHandle);
    } catch (requestError) { setError(requestError.message || 'Не удалось создать архив'); }
    finally { setPeriodAction(''); }
  };

  const downloadPeriodArchive = async (period, fileHandle = null) => {
    setPeriodAction(`download:${period.periodKey}`); setError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/archives/${encodeURIComponent(period.archiveId)}/download-token`, { method: 'POST', headers: chatAuthHeaders });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось подготовить скачивание');
      const downloadUrl = `${API_BASE_URL}/chat/records/archives/${encodeURIComponent(period.archiveId)}/download?mt=${encodeURIComponent(data.token)}`;
      if (fileHandle) {
        const fileResponse = await fetch(downloadUrl);
        if (!fileResponse.ok) throw new Error('Не удалось скачать сформированный архив');
        const writable = await fileHandle.createWritable();
        if (fileResponse.body?.pipeTo) await fileResponse.body.pipeTo(writable);
        else { await writable.write(await fileResponse.blob()); await writable.close(); }
      } else {
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = `Переписки-${period.periodKey}.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      }
      window.setTimeout(loadPeriods, 500);
    } catch (requestError) { setError(requestError.message || 'Не удалось скачать архив'); }
    finally { setPeriodAction(''); }
  };

  const purgePeriod = async (period) => {
    const confirmation = window.prompt(`Будут удалены переписки, публикации и файлы за ${period.periodKey}. Введите УДАЛИТЬ`);
    if (confirmation !== 'УДАЛИТЬ') return;
    setPeriodAction(`purge:${period.periodKey}`); setError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/periods/${encodeURIComponent(period.periodKey)}/purge?mode=${periodMode}`, {
        method: 'POST', headers: { ...chatAuthHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: periodMode, confirmation })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить период');
      clearResults(); await loadPeriods();
    } catch (requestError) { setError(requestError.message || 'Не удалось удалить период'); }
    finally { setPeriodAction(''); }
  };

  const importPeriodArchive = async (file) => {
    if (!file) return;
    setPeriodAction('import'); setError('');
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/periods/import`, {
        method: 'POST', headers: { ...chatAuthHeaders, 'Content-Type': 'application/zip' }, body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось добавить архив');
      await loadPeriods();
    } catch (requestError) { setError(requestError.message || 'Не удалось добавить архив'); }
    finally { setPeriodAction(''); if (archiveInputRef.current) archiveInputRef.current.value = ''; }
  };

  const clearResults = useCallback(() => {
    setConversations([]);
    setFeedPosts([]);
    setSelectedConversationId('');
    setMessages([]);
    setMessagesBefore('');
    setMessagesHaveMore(false);
    setError('');
  }, []);

  const employeeOptions = useMemo(() => periodEmployees
    .filter((employee) => employee?.login)
    .map((employee) => {
      const login = String(employee.login).trim();
      const fullName = String(employee.full_name || employee.name || login).trim();
      return { ...employee, login, fullName, optionLabel: fullName === login ? login : `${fullName} (${login})` };
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName, isEnglishInterface ? 'en' : 'ru')),
  [isEnglishInterface, periodEmployees]);

  useEffect(() => {
    if (!isValidDateRange(dateRange)) {
      setPeriodEmployees([]);
      return undefined;
    }
    const controller = new AbortController();
    setParticipantsLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to, periodMode });
    authFetch(`${API_BASE_URL}/chat/audit/participants?${params.toString()}`, { headers: chatAuthHeaders, signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Не удалось загрузить участников периода');
        const next = Array.isArray(data.participants) ? data.participants : [];
        setPeriodEmployees(next);
        if (employeeLogin && !next.some((employee) => sameLogin(employee.login, employeeLogin))) {
          setEmployeeLogin('');
          setEmployeeQuery('');
          clearResults();
        }
      })
      .catch((requestError) => { if (requestError?.name !== 'AbortError') setError(requestError.message); })
      .finally(() => { if (!controller.signal.aborted) setParticipantsLoading(false); });
    return () => controller.abort();
  }, [chatAuthHeaders, clearResults, dateRange, employeeLogin, periodMode, sameLogin]);

  const selectedEmployee = useMemo(() => employeeOptions.find((employee) => sameLogin(employee.login, employeeLogin)) || null,
    [employeeLogin, employeeOptions, sameLogin]);
  const rangeIsValid = isValidDateRange(dateRange);
  const searchReady = Boolean(employeeLogin && rangeIsValid);

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
      setWordSearch('');
      clearResults();
    }
  };

  const selectEmployee = (employee) => {
    setEmployeeQuery(employee.optionLabel);
    setEmployeeLogin(employee.login);
    setWordSearch('');
    clearResults();
  };

  const visibleEmployeeOptions = useMemo(() => {
    const normalized = String(employeeQuery || '').trim().toLowerCase();
    const filtered = normalized
      ? employeeOptions.filter((employee) => `${employee.fullName} ${employee.login}`.toLowerCase().includes(normalized))
      : employeeOptions;
    return filtered.slice(0, 100);
  }, [employeeOptions, employeeQuery]);

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
      params.set('periodMode', periodMode);
      if (wordSearch.trim()) params.set('q', wordSearch.trim());
      const [response, feedResponse] = await Promise.all([
        authFetch(`${API_BASE_URL}/chat/audit/conversations?${params.toString()}`, { headers: chatAuthHeaders, signal }),
        authFetch(`${API_BASE_URL}/chat/audit/feed?${params.toString()}`, { headers: chatAuthHeaders, signal })
      ]);
      const [data, feedData] = await Promise.all([response.json().catch(() => ({})), feedResponse.json().catch(() => ({}))]);
      if (!response.ok) throw new Error(data.message || copy.searchFailed);
      if (!feedResponse.ok) throw new Error(feedData.message || copy.searchFailed);
      const nextConversations = Array.isArray(data?.conversations) ? data.conversations : [];
      setFeedPosts(Array.isArray(feedData?.posts) ? feedData.posts : []);
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
        setFeedPosts([]);
        setSelectedConversationId('');
        setMessages([]);
      }
    } finally {
      if (!signal?.aborted) setSearchLoading(false);
    }
  }, [chatAuthHeaders, copy.searchFailed, dateRange.from, dateRange.to, employeeLogin, periodMode, searchReady, wordSearch]);

  const fetchMessages = useCallback(async (conversationId, { append = false, signal } = {}) => {
    if (!conversationId || !searchReady) return;
    setMessagesLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ employee: employeeLogin, from: dateRange.from, to: dateRange.to, limit: '200' });
      params.set('periodMode', periodMode);
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
  }, [chatAuthHeaders, copy.conversationFailed, dateRange.from, dateRange.to, employeeLogin, messagesBefore, periodMode, searchReady, wordSearch]);

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

  const showPeriodHint = !rangeIsValid;
  const showEmployeeHint = Boolean(rangeIsValid && !employeeLogin);

  return (
    <section className="manager-panel audit-search-panel">
      <div className="audit-search-heading">
        <div>
          <h2>{isEnglishInterface ? 'Document search' : 'Поиск документов'}</h2>
          <p>{isEnglishInterface
            ? 'Select an employee and a period first. Message search becomes available after the conversations are loaded.'
            : 'Сначала выберите период, затем сотрудника из списка участников. После загрузки переписки можно уточнить результат поиском по словам.'}</p>
        </div>
        {selectedEmployee && <span>{copy.selected}: <strong>{selectedEmployee.fullName}</strong></span>}
      </div>

      <div className="archive-periods-panel">
        <div className="archive-periods-title">
          <div><strong>{periodMode === 'day' ? 'Дни старше трёх суток' : 'Доступные периоды'}</strong><span>{periodMode === 'day' ? 'Все диалоги и публикации ленты по дням' : 'Переписка старше одного года'}</span></div>
          <label className="archive-test-switch"><input type="checkbox" checked={periodMode === 'day'} onChange={(event) => { setPeriodMode(event.target.checked ? 'day' : 'month'); setDateRange({ from: '', to: '' }); clearResults(); }} /><i aria-hidden="true" /><span>Тестовый режим: старше 3 дней</span></label>
        </div>
        {periodsLoading && <div className="archive-period-empty">Загружаем периоды…</div>}
        {!periodsLoading && periods.length === 0 && <div className="archive-period-empty">{periodMode === 'day'
          ? <>В базе не найдено сообщений или публикаций старше трёх полных суток.{periodSource.totalCount > 0 && <small>Всего записей: {periodSource.totalCount}. Самая ранняя: {periodSource.firstAt ? new Date(periodSource.firstAt).toLocaleString(interfaceLocale) : '—'}. Граница архива: {periodSource.cutoffAt ? new Date(periodSource.cutoffAt).toLocaleString(interfaceLocale) : '—'}.</small>}</>
          : 'Подходящих периодов пока нет.'}</div>}
        <div className="archive-period-list">
          {periods.map((period) => {
            const deleted = period.state === 'deleted';
            const busy = periodAction.endsWith(`:${period.periodKey}`);
            return <article key={`${period.mode}-${period.periodKey}`} className={`archive-period-card ${deleted ? 'deleted' : ''}`}>
              <button type="button" className="archive-period-select" disabled={deleted} onClick={() => selectPeriod(period)}>
                <b>{deleted ? '✕ ' : ''}Переписки за {new Date(`${period.from}T12:00:00`).toLocaleDateString(interfaceLocale, periodMode === 'day' ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' })}</b>
                <span>{period.messageCount || 0} сообщений · {period.postCount || 0} публикаций · {period.fileCount || 0} файлов · {formatFileSize(period.sourceBytes || 0)}</span>
                {deleted && <em>Удалено с диска — добавьте архив для восстановления</em>}
              </button>
              <div className="archive-period-actions">
                {!deleted && (!period.archiveId || !period.archiveStatus || period.archiveStatus === 'failed') && <button type="button" disabled={busy} onClick={() => createPeriodArchive(period)}>{period.archiveStatus === 'failed' ? 'Повторить создание архива' : (periodMode === 'day' ? 'Создать и сохранить архив дня' : 'Создать и сохранить архив')}</button>}
                {!deleted && period.archiveStatus === 'pending' && <button type="button" disabled>Архив создаётся…</button>}
                {!deleted && period.archiveStatus === 'completed' && <button type="button" disabled={busy} onClick={async () => {
                  try { const fileHandle = await chooseArchiveTarget(period); await downloadPeriodArchive(period, fileHandle); }
                  catch (pickerError) { if (pickerError?.name !== 'AbortError') setError(pickerError.message || 'Не удалось сохранить архив'); }
                }}>Сохранить архив</button>}
                {!deleted && period.archiveStatus === 'completed' && (periodMode === 'day' || period.downloadedAt) && <button type="button" className="danger" disabled={busy} onClick={() => purgePeriod(period)}>Удалить полностью</button>}
              </div>
            </article>;
          })}
        </div>
        <div className="archive-period-footer">
          <input ref={archiveInputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => importPeriodArchive(event.target.files?.[0])} />
          <button type="button" disabled={periodAction === 'import'} onClick={() => archiveInputRef.current?.click()}>{periodAction === 'import' ? 'Восстанавливаем архив…' : 'Загрузить архив'}</button>
          <span>{periodMode === 'day' ? 'Восстановить удалённый день из ранее сохранённого архива.' : 'Восстановить удалённый месяц из ранее сохранённого архива.'}</span>
        </div>
      </div>

      <div className="audit-search-form">
        <label className="audit-search-field">
          <span>1. {copy.from}</span>
          <input type="date" value={dateRange.from} onChange={(event) => updatePeriodDate('from', event.target.value)} />
        </label>
        <label className="audit-search-field">
          <span>{copy.to}</span>
          <input type="date" value={dateRange.to} min={dateRange.from || undefined} onChange={(event) => updatePeriodDate('to', event.target.value)} />
        </label>
        <div className="audit-search-field audit-search-field--employee">
          <span>2. {copy.employee}{rangeIsValid ? ` · ${employeeOptions.length}` : ''}</span>
          <input type="text" list="audit-employee-options" value={employeeQuery} onChange={(event) => handleEmployeeInput(event.target.value)} placeholder={participantsLoading ? 'Загружаем участников…' : (rangeIsValid ? copy.employeePlaceholder : 'Сначала выберите период')} autoComplete="off" disabled={!rangeIsValid || participantsLoading} />
          <datalist id="audit-employee-options">
            {employeeOptions.map((employee) => <option key={employee.login} value={employee.optionLabel}>{[employee.role === 'admin' ? 'Администратор' : '', employee.department || employee.login].filter(Boolean).join(' · ')}</option>)}
          </datalist>
          {rangeIsValid && !participantsLoading && !employeeLogin && visibleEmployeeOptions.length > 0 && <div className="audit-participant-options">
            {visibleEmployeeOptions.map((employee) => <button type="button" key={employee.login} onClick={() => selectEmployee(employee)}><b>{employee.fullName}</b><small>{employee.role === 'admin' ? 'Администратор' : (employee.department || employee.login)}</small></button>)}
          </div>}
        </div>
        <label className="audit-search-field audit-search-field--words">
          <span>3. {copy.words}</span>
          <input type="search" value={wordSearch} onChange={(event) => setWordSearch(event.target.value)} placeholder={copy.wordsPlaceholder} disabled={!searchReady} />
        </label>
      </div>

      {error && <div className="audit-search-error" role="alert">{error}</div>}
      {showPeriodHint && <div className="audit-search-empty"><b>1</b><span>Выберите день или месяц сверху либо укажите даты вручную.</span></div>}
      {showEmployeeHint && <div className="audit-search-empty"><b>2</b><span>{participantsLoading ? 'Загружаем сотрудников выбранного периода…' : `Выберите сотрудника из списка участников периода (${employeeOptions.length}).`}</span></div>}
      {searchReady && searchLoading && conversations.length === 0 && <div className="audit-search-empty"><span>{copy.searching}</span></div>}
      {searchReady && !searchLoading && !error && conversations.length === 0 && feedPosts.length === 0 && <div className="audit-search-empty"><span>{copy.noDialogs}</span></div>}

      {searchReady && feedPosts.length > 0 && <div className="audit-feed-results">
        <div className="audit-results-summary"><strong>Публикации в ленте</strong><span>{feedPosts.length}</span></div>
        <div className="audit-feed-list">{feedPosts.map((post) => {
          const attachments = getMessageAttachments(post);
          return <article key={post.id} className="audit-message">
            <div className="message-meta"><span>{getEmployeeName(post.author || post.authorLogin || employeeLogin)}</span><span>{post.createdAt ? new Date(post.createdAt).toLocaleString(interfaceLocale) : '—'}</span></div>
            {post.text && <div className="audit-message-text">{post.text}</div>}
            {attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${post.id}-feed-audit-${index}`} cardKey={`${post.id}-feed-audit-${index}`} file={file} isEnglish={isEnglishInterface} onOpen={() => setPreviewFile(file)} showActions />)}</div>}
          </article>;
        })}</div>
      </div>}

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
                    {attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${message.id}-audit-${index}`} cardKey={`${message.id}-audit-${index}`} file={file} isEnglish={isEnglishInterface} onOpen={() => setPreviewFile(file)} showActions />)}</div>}
                    {Array.isArray(message.audit) && message.audit.length > 0 && <div className="audit-history"><strong>{t('history')}:</strong>{message.audit.slice(-4).map((entry, index) => <span key={`${message.id}-audit-entry-${index}`}>{entry.action || t('change')} · {getEmployeeName(entry.by)} · {entry.at ? new Date(entry.at).toLocaleString(interfaceLocale) : '—'}</span>)}</div>}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {previewFile && <div className="audit-media-viewer" role="dialog" aria-modal="true" aria-label={previewFile.name || 'Просмотр файла'} onClick={() => setPreviewFile(null)}>
        <div className="audit-media-viewer-panel" onClick={(event) => event.stopPropagation()}>
          <div className="audit-media-viewer-header"><strong>{previewFile.name || 'Вложение'}</strong><button type="button" onClick={() => setPreviewFile(null)} aria-label="Закрыть">×</button></div>
          <div className="audit-media-viewer-stage">
            {isVideoAttachment(previewFile)
              ? <video key={previewFile.id || previewFile.url} src={getOriginalAttachmentUrl(previewFile)} controls playsInline preload="metadata">Ваш браузер не поддерживает видео.</video>
              : <img src={getOriginalAttachmentUrl(previewFile)} alt={previewFile.name || 'Фото'} />}
          </div>
        </div>
      </div>}
    </section>
  );
}
