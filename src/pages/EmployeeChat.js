import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { MANAGER_CREDENTIALS } from '../config/authConfig';
import './EmployeeChat.css';

const CHAT_READ_STATE_KEY = 'chatReadState';
const FEED_READ_STATE_KEY = 'employeeFeedReadState';
const EMPLOYEE_DIRECTORY_CACHE_KEY = 'employeeDirectoryCache';
const MANAGER_TEMPLATE_MESSAGES = ['✅ Принято в работу', '👀 Смотрю сейчас', '🔧 Исправляю', '📌 Уточните кабинет и устройство', '📷 Пришлите фото ошибки', '⏱️ Вернусь с ответом в течение 15 минут', '🧪 Проверяю решение', '✅ Готово, проверьте пожалуйста', '🙏 Спасибо, закрываю обращение'];
const EMPLOYEE_TEMPLATE_MESSAGES = ['👋 Добрый день!', '🆘 Нужна помощь', '📍 Я в кабинете ...', '📷 Сейчас пришлю фото', '✅ Получилось, спасибо!', '❌ Ошибка осталась', '🔁 Повторил действие, результат тот же', '📞 Можем созвониться?', '🙏 Спасибо!'];
const REACTION_EMOJIS = ['👍', '✅', '👀', '🙏', '❤️', '😂', '😮', '🔧', '⏳', '❗'];
const QUICK_EMOJIS = ['😀', '🙂', '😅', '🙏', '👍', '✅', '👀', '📌', '🔧', '⏳', '❗', '❤️'];
const EMPLOYEE_CUSTOM_TEMPLATES_KEY = 'employeeChatCustomTemplates';
const MAX_ATTACHMENT_SIZE_MB = 100;
const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)$/i;
const EMPLOYEE_TABS = [
  { id: 'chat', label: 'Чат' },
  { id: 'request', label: 'Заявка' },
  { id: 'feed', label: 'Лента' },
  { id: 'profile', label: 'Профиль' }
];
const MANAGER_TABS = [
  { id: 'chat', label: 'Чат' },
  { id: 'feed', label: 'Лента' },
  { id: 'profile', label: 'Профиль' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'audit', label: 'Аудит' }
];
const REQUEST_CATEGORIES = ['Техника', 'Сеть', 'ПО', 'Доступы', 'Другое'];
const REQUEST_PRIORITIES = ['Обычный', 'Важный', 'Срочный'];
const APPLICATION_STATUS_META = {
  new: { label: 'Новая', hint: 'Ожидает администратора', tone: 'new' },
  accepted: { label: 'Принята', hint: 'Администратор назначил исполнителя', tone: 'accepted' },
  in_progress: { label: 'В работе', hint: 'Если работа уже выполнена — подтвердите её закрытие', tone: 'confirm' },
  waiting_employee_confirmation: { label: 'Проверьте выполнение', hint: 'Подтвердите, если проблема решена', tone: 'confirm' },
  done: { label: 'Выполнена', hint: 'Заявка закрыта', tone: 'done' },
  reopened: { label: 'Переоткрыта', hint: 'Администратор снова увидит заявку', tone: 'reopened' }
};

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


const readFeedReadAt = (username) => {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_READ_STATE_KEY) || '{}');
    return typeof all?.[username] === 'string' ? all[username] : '';
  } catch {
    return '';
  }
};

const saveFeedReadAt = (username, readAt) => {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_READ_STATE_KEY) || '{}');
    all[username] = readAt;
    localStorage.setItem(FEED_READ_STATE_KEY, JSON.stringify(all));
  } catch {
    // noop
  }
};

const getCustomTemplatesKey = (username = 'guest') => `${EMPLOYEE_CUSTOM_TEMPLATES_KEY}:${username.toLowerCase()}`;

const readCustomTemplates = (username) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(getCustomTemplatesKey(username)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const saveCustomTemplates = (username, templates) => {
  try {
    localStorage.setItem(getCustomTemplatesKey(username), JSON.stringify(templates));
  } catch {
    // noop
  }
};

const getFeedItemTimestamp = (item) => {
  if (!item) return 0;
  return new Date(item.createdAt || item.updatedAt || 0).getTime() || 0;
};

const getFeedLatestTimestamp = (posts = []) => posts.reduce((latest, post) => {
  const postTimestamp = getFeedItemTimestamp(post);
  const latestCommentTimestamp = (post.comments || []).reduce(
    (commentLatest, comment) => Math.max(commentLatest, getFeedItemTimestamp(comment)),
    0
  );
  return Math.max(latest, postTimestamp, latestCommentTimestamp);
}, 0);

const getForwardedMessageText = (text = '') => String(text)
  .replace(/^↪\s*Переслано(?:\s+от\s+[^\n]+)?\n?/i, '')
  .replace(/^Переслано(?:\s+от\s+[^\n]+)?\n?/i, '')
  .replace(/^↪\s*Пересланное вложение\n?/i, '')
  .replace(/^📎\s*Вложения\n?/i, '')
  .trim();

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

const fetchJsonWithRetry = async (url, options = {}, { attempts = 4, retryDelay = 450, fallbackMessage = 'Ошибка сети' } = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || fallbackMessage);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(retryDelay + attempt * 350);
    }
  }

  throw lastError || new Error(fallbackMessage);
};

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

const isVideoAttachment = (file = {}) => String(file.type || '').startsWith('video/') || VIDEO_EXTENSION_PATTERN.test(String(file.name || ''));

const formatFileSize = (size = 0) => {
  const bytes = Number(size) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
};

const getFileIcon = (type = '') => {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.includes('pdf')) return '📕';
  if (type.includes('word')) return '📘';
  if (type.includes('excel') || type.includes('sheet')) return '📗';
  return '📎';
};

const dataUrlToBlob = (dataUrl = '') => {
  const [meta = '', payload = ''] = String(dataUrl).split(',');
  const mimeMatch = meta.match(/data:([^;]+);base64/);
  const mime = mimeMatch?.[1] || 'application/octet-stream';
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
};

const openAttachmentInNewTab = (file = {}) => {
  if (!file.dataUrl) return;
  try {
    const url = file.dataUrl.startsWith('data:') ? URL.createObjectURL(dataUrlToBlob(file.dataUrl)) : file.dataUrl;
    window.open(url, '_blank', 'noopener,noreferrer');
    if (file.dataUrl.startsWith('data:')) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    console.error('Attachment open error:', error);
  }
};


const AttachmentCard = ({ file, cardKey, variant = 'message', onOpen, metaLabel = '', statusLabel = '' }) => {
  const fileName = file?.name || 'Файл';
  const fileType = String(file?.type || '');
  const isImage = fileType.startsWith('image/');
  const isVideo = isVideoAttachment(file);
  const cardClassName = `${variant === 'feed' ? 'employee-feed-attachment-card' : 'message-attachment-card'} ${isVideo ? 'video-attachment' : ''}`;

  if (variant === 'message' && isImage) {
    return (
      <button key={cardKey} type="button" className="message-photo-card" onClick={onOpen} aria-label={`Открыть фото ${fileName}`}>
        <img src={file.dataUrl} alt={fileName} />
        {(metaLabel || statusLabel) && <span className="message-photo-meta">{metaLabel} {statusLabel}</span>}
      </button>
    );
  }

  return (
    <div key={cardKey} className={cardClassName}>
      {isVideo ? (
        <video className="attachment-video-player" src={file.dataUrl} controls preload="metadata" playsInline>
          Ваш браузер не поддерживает просмотр этого видео.
        </video>
      ) : isImage ? (
        <img src={file.dataUrl} alt={fileName} />
      ) : (
        <span className="file-icon">{getFileIcon(fileType)}</span>
      )}
      {(variant !== 'message' || !isImage) && <small>{fileName} · {formatFileSize(file?.size)}</small>}
      {(variant !== 'message' || !isImage) && (
        <div className="attachment-card-actions">
          <a href={file.dataUrl} download={fileName}>Скачать</a>
          <button type="button" onClick={() => openAttachmentInNewTab(file)}>Открыть</button>
        </div>
      )}
    </div>
  );
};

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const rest = safeSeconds % 60;
  return [hours, minutes, rest].map((item) => String(item).padStart(2, '0')).join(':');
};


const hasMessageAttachments = (message = {}) => Boolean(message.attachment)
  || (Array.isArray(message.attachments) && message.attachments.length > 0);

const hasVisibleThreadContent = (messages = []) => messages.some((message) => {
  if (!message || message.deletedAt) return false;
  const hasText = String(message.text || '').trim().length > 0;
  return hasText || hasMessageAttachments(message);
});

const getThreadActivityMeta = (messages = []) => {
  const sortedMessages = [...messages].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const lastMessage = sortedMessages[sortedMessages.length - 1] || null;
  const visibleMessages = messages.filter((message) => !message.deletedAt && (String(message.text || '').trim() || hasMessageAttachments(message)));
  return {
    visible: hasVisibleThreadContent(messages),
    messageCount: visibleMessages.length,
    deletedCount: messages.filter((message) => Boolean(message.deletedAt)).length,
    attachmentsCount: messages.filter((message) => hasMessageAttachments(message)).length,
    lastAt: lastMessage?.createdAt || '',
    lastTimestamp: lastMessage?.createdAt ? new Date(lastMessage.createdAt).getTime() : 0
  };
};

const isThreadInPeriod = (lastTimestamp, period) => {
  if (period === 'all') return true;
  if (!lastTimestamp) return false;
  const now = Date.now();
  if (period === 'today') return new Date(lastTimestamp).toDateString() === new Date(now).toDateString();
  if (period === 'week') return now - lastTimestamp <= 7 * 24 * 60 * 60 * 1000;
  if (period === 'month') return now - lastTimestamp <= 30 * 24 * 60 * 60 * 1000;
  return true;
};

const secondsSince = (dateValue) => {
  if (!dateValue) return 0;
  const startedAt = new Date(dateValue).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
};

const getApplicationStatusMeta = (status) => APPLICATION_STATUS_META[status] || APPLICATION_STATUS_META.new;

const EmployeeChat = () => {
  const { user, logout, employeeDirectory, changeServicePassword } = useAuth();
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
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState(() => readCustomTemplates(user?.username || 'guest'));
  
  const [replyTo, setReplyTo] = useState(null);
  const [selectedMessageId, setSelectedMessageId] = useState('');
  const [messageReactionExpanded, setMessageReactionExpanded] = useState(false);
  const [forwardSourceMessage, setForwardSourceMessage] = useState(null);
  const [forwardingTargetEmail, setForwardingTargetEmail] = useState('');
  const [mediaViewer, setMediaViewer] = useState(null);
  const [readState, setReadState] = useState(() => readReadState(user?.username || 'guest'));
  const [feedReadAt, setFeedReadAt] = useState(() => readFeedReadAt(user?.username || 'guest'));
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
  const [myApplications, setMyApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState('');
  const [clockTick, setClockTick] = useState(0);
  const [feedPosts, setFeedPosts] = useState([]);
  const [feedError, setFeedError] = useState('');
  const [feedDraft, setFeedDraft] = useState('');
  const [feedAttachment, setFeedAttachment] = useState(null);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [modal, setModal] = useState(null);
  const modalResolverRef = useRef(null);
  const messagesWrapRef = useRef(null);
  const feedListRef = useRef(null);
  const forceScrollRef = useRef(false);
  const suppressThreadsRefreshUntilRef = useRef(0);

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

  const appendToDraft = useCallback((text) => {
    setDraft((prev) => {
      const separator = prev && !prev.endsWith(' ') ? ' ' : '';
      return `${prev}${separator}${text}`;
    });
  }, []);

  const addCustomTemplate = useCallback(async () => {
    const nextTemplate = await promptAction('Введите быстрый шаблон:', '', 'Мой шаблон');
    const normalized = String(nextTemplate || '').trim();
    if (!normalized || !user?.username) return;

    setCustomTemplates((prev) => {
      const next = [...prev.filter((item) => item !== normalized), normalized].slice(-12);
      saveCustomTemplates(user.username, next);
      return next;
    });
  }, [promptAction, user?.username]);

  const removeCustomTemplate = useCallback((template) => {
    if (!user?.username) return;
    setCustomTemplates((prev) => {
      const next = prev.filter((item) => item !== template);
      saveCustomTemplates(user.username, next);
      return next;
    });
  }, [user?.username]);

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
  const [showEmployeePassword, setShowEmployeePassword] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilters, setAuditFilters] = useState({
    showEmpty: false,
    attachmentsOnly: false,
    deletedOnly: false,
    period: 'all'
  });


  const currentConversationId = selectedEmail ? getConversationId(user.username, selectedEmail) : null;
  const templateMessages = useMemo(() => [
    ...(isManager ? MANAGER_TEMPLATE_MESSAGES : EMPLOYEE_TEMPLATE_MESSAGES),
    ...customTemplates
  ], [customTemplates, isManager]);
  const currentMessages = useMemo(() => (
    currentConversationId ? (threads[currentConversationId] || []) : []
  ), [currentConversationId, threads]);
  const selectedThreadMessages = selectedThreadId ? (threads[selectedThreadId] || []) : [];

  const pinnedMessages = useMemo(
    () => currentMessages.filter((message) => message.pinned && !message.deletedAt),
    [currentMessages]
  );

  useEffect(() => {
    const username = user?.username || 'guest';
    setReadState(readReadState(username));
    setFeedReadAt(readFeedReadAt(username));
    setCustomTemplates(readCustomTemplates(username));
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
    if (Date.now() < suppressThreadsRefreshUntilRef.current) return;

    try {
      const response = await fetch(`${API_BASE_URL}/chat/threads`);
      if (!response.ok) return;
      const data = await response.json();
      if (Date.now() < suppressThreadsRefreshUntilRef.current) return;
      setThreads(data?.threads && typeof data.threads === 'object' ? data.threads : {});
    } catch (error) {
      console.error('Ошибка загрузки переписки:', error);
    }
  }, []);

  const fetchFeed = useCallback(async ({ silent = true } = {}) => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить ленту');
      const nextPosts = Array.isArray(data?.posts) ? data.posts : [];
      setFeedPosts((currentPosts) => {
        if (silent && currentPosts.length > 0 && nextPosts.length === 0) {
          return currentPosts;
        }
        return nextPosts;
      });
      setFeedError('');
    } catch (error) {
      const message = error.message || 'Не удалось загрузить ленту';
      console.error('Ошибка загрузки ленты:', error);
      if (!silent) {
        setFeedError(message);
        notify(message, 'Лента');
        return;
      }
      // Silent background polling should not leave a scary banner on first page load.
      // The manual refresh button still shows an inline error through the !silent branch above.
    }
  }, [notify]);

  const fetchMyApplications = useCallback(async ({ silent = true } = {}) => {
    if (!user?.username) return;
    if (!silent) setApplicationsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/applications/my?employee_login=${encodeURIComponent(user.username)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось загрузить заявки');
      setMyApplications(Array.isArray(data?.applications) ? data.applications : []);
      setApplicationsError('');
    } catch (error) {
      const message = error.message || 'Не удалось загрузить заявки';
      setApplicationsError(message);
      if (!silent) notify(message, 'Заявки');
    } finally {
      if (!silent) setApplicationsLoading(false);
    }
  }, [notify, user?.username]);

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
    const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    }, { fallbackMessage: 'Не удалось сохранить сообщение' });

    if (data?.threads && typeof data.threads === 'object') {
      setThreads(data.threads);
    }
  }, []);

  const persistNewMessage = useCallback(async (conversationId, message) => {
    const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    }, { fallbackMessage: 'Не удалось сохранить сообщение' });

    if (data?.threads && typeof data.threads === 'object') {
      setThreads(data.threads);
    }
  }, []);

  const persistMessagePatch = useCallback(async (conversationId, messageId, message) => {
    const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    }, { fallbackMessage: 'Не удалось сохранить изменение' });

    if (data?.threads && typeof data.threads === 'object') {
      setThreads(data.threads);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
    fetchEmployees();
    fetchFeed({ silent: true });
    fetchMyApplications({ silent: true });

    const poller = setInterval(() => {
      fetchThreads();
      fetchEmployees();
      fetchMyApplications({ silent: true });
    }, 5000);
    const feedPoller = setInterval(() => {
      fetchFeed({ silent: true });
    }, 30000);

    return () => {
      clearInterval(poller);
      clearInterval(feedPoller);
    };
  }, [fetchThreads, fetchEmployees, fetchFeed, fetchMyApplications]);

  useEffect(() => {
    const timer = setInterval(() => setClockTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dialog = params.get('dialog');
    if (dialog) {
      setSelectedEmail(dialog);
      setActiveTab('chat');
    }
  }, []);

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
        id: 'admin-static',
        login: MANAGER_CREDENTIALS.username,
        full_name: MANAGER_CREDENTIALS.name,
        role: 'admin',
        department: 'Администратор'
      });
    }

    return sourceEmployees
      .filter((item) => item.login !== user?.username)
      .map((item) => {
        const presence = presenceMap.get(item.login.toLowerCase());
        const lastSeen = presence?.lastSeen || null;
        const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
        const isRecentlySeen = Boolean(lastSeenMs) && Date.now() - lastSeenMs < 45000;
        const computedRole = presence?.role || item.role || (item.login.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase() ? 'admin' : 'employee');
        return {
          email: item.login,
          isOnline: Boolean(presence?.isOnline) || isRecentlySeen,
          lastSeen,
          role: computedRole,
          profile: item
        };
      })
      .sort((a, b) => {
        const aIsManager = ['manager', 'admin'].includes((a.role || '').toLowerCase()) || a.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
        const bIsManager = ['manager', 'admin'].includes((b.role || '').toLowerCase()) || b.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();

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
    setSelectedMessageId('');
    setMessageReactionExpanded(false);
  }, [activeTab, selectedEmail]);

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

    const nextMessages = [...currentMessages, newMessage];

    try {
      forceScrollRef.current = true;
      suppressThreadsRefreshUntilRef.current = Date.now() + 8000;
      setThreads((prev) => ({ ...prev, [currentConversationId]: nextMessages }));
      setDraft('');
      setAttachmentDrafts([]);
      setReplyTo(null);
      await persistNewMessage(currentConversationId, newMessage);
    } catch (error) {
      const isNetworkError = error?.message === 'Failed to fetch';
      if (isNetworkError) {
        // Сервер иногда успевает сохранить вложение, но соединение обрывается на ответе.
        // Не откатываем оптимистичное сообщение, чтобы фото не исчезало и не мигало обратно.
        return;
      }
      setThreads((prev) => ({ ...prev, [currentConversationId]: currentMessages }));
      suppressThreadsRefreshUntilRef.current = Date.now();
      notify(error.message || 'Не удалось отправить сообщение', 'Сообщение');
    }
  };

  const addAttachmentFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (tooLarge) {
      notify(`Файл ${tooLarge.name} слишком большой. Максимум ${MAX_ATTACHMENT_SIZE_MB} МБ.`, 'Вложения');
      return;
    }

    try {
      const preparedFiles = await Promise.all(files.map(async (file) => ({
        id: createMessageId(),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: await readFileAsDataUrl(file)
      })));
      setAttachmentDrafts((prev) => [...prev, ...preparedFiles]);
      setActiveTab('chat');
    } catch {
      notify('Не удалось прикрепить файл.', 'Вложения');
    }
  };

  const handleAttachmentChange = async (event) => {
    await addAttachmentFiles(event.target.files);
    event.target.value = '';
  };

  const handleAttachmentDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
    await addAttachmentFiles(event.dataTransfer?.files);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setIsDraggingFiles(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget)) setIsDraggingFiles(false);
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

    if (user?.role === 'manager' || user?.role === 'admin') {
      try {
        await changeServicePassword({
          login: user.username,
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        });
        notify('Пароль обновлён. При следующем входе используйте новый пароль.', 'Пароль');
        setPasswordForm({ currentPassword: '', newPassword: '' });
      } catch (error) {
        notify(error.message || 'Не удалось сменить пароль', 'Пароль');
      }
      return;
    }

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
        const response = await fetch(`${API_BASE_URL}/applications/from-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_login: user?.username || '',
            name: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
            cabinet: profileForm.room || '',
            N_tel: profileForm.phone || '',
            application: requestText.trim(),
            category: requestCategory,
            priority: requestPriority,
            chat_thread_id: currentConversationId || '',
            source_message_id: replyTo?.id || ''
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.message || 'Не удалось отправить заявку');
        }
        const createdTicket = data?.application || null;
        if (createdTicket) setMyApplications((prev) => [createdTicket, ...prev.filter((item) => item.id !== createdTicket.id)]);
        setRequestStatus({ state: 'sent', text: 'Заявка подана. Статус: ожидает администратора.', ticketId: data?.id || data?.insertId || createMessageId().slice(0, 8) });
        setRequestText('');
        fetchMyApplications({ silent: true });
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

  const refreshApplicationInList = (application) => {
    if (!application) return;
    setMyApplications((prev) => [application, ...prev.filter((item) => item.id !== application.id)]);
  };

  const confirmApplicationDone = async (applicationId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/applications/${applicationId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: user?.username || 'employee' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось подтвердить заявку');
      refreshApplicationInList(data.application);
      notify('Спасибо! Заявка закрыта и время выполнения сохранено.', 'Заявка выполнена');
    } catch (error) {
      notify(error.message || 'Не удалось подтвердить заявку', 'Заявка');
    }
  };

  const reopenApplication = async (applicationId) => {
    const comment = await promptAction('Что осталось неисправным? Администратор увидит комментарий.', '', 'Проблема осталась');
    if (!comment) return;
    try {
      const response = await fetch(`${API_BASE_URL}/applications/${applicationId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: user?.username || 'employee', employee_comment: comment })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось переоткрыть заявку');
      refreshApplicationInList(data.application);
      notify('Заявка возвращена администратору.', 'Заявка переоткрыта');
    } catch (error) {
      notify(error.message || 'Не удалось переоткрыть заявку', 'Заявка');
    }
  };

  const updateMessage = async (messageId, updater, targetConversationId = currentConversationId) => {
    if (!targetConversationId) return;
    const previousMessages = threads[targetConversationId] || [];
    const nextMessages = previousMessages.map((item) => (item.id === messageId ? updater(item) : item));
    suppressThreadsRefreshUntilRef.current = Date.now() + 8000;
    setThreads((prev) => ({ ...prev, [targetConversationId]: nextMessages }));

    try {
      await persistMessagePatch(targetConversationId, messageId, nextMessages.find((item) => item.id === messageId));
    } catch (error) {
      const isNetworkError = error?.message === 'Failed to fetch';
      if (isNetworkError) {
        // Как и при отправке вложений, не возвращаем старое состояние, если запись могла сохраниться на сервере.
        return;
      }
      setThreads((prev) => ({ ...prev, [targetConversationId]: previousMessages }));
      suppressThreadsRefreshUntilRef.current = Date.now();
      throw new Error(error.message || 'Не удалось сохранить изменение');
    }
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
    const confirmed = await confirmAction('Удалить сообщение? Вместо полного удаления оно будет скрыто и останется в аудите.', 'Удаление сообщения');
    if (!confirmed) return;
    try {
      await updateMessage(messageId, (item) => ({
        ...item,
        text: '',
        attachment: null,
        attachments: [],
        deletedAt: new Date().toISOString(),
        deletedBy: user.username,
        audit: [...(item.audit || []), { action: 'delete', by: user.username, at: new Date().toISOString(), previousText: item.text }]
      }), targetConversationId);
    } catch (error) {
      notify(error.message || 'Не удалось удалить сообщение', 'Сообщение');
    }
  };

  const editMessage = async (messageId, targetConversationId = currentConversationId) => {
    const sourceMessage = (threads[targetConversationId] || []).find((item) => item.id === messageId);
    const nextText = await promptAction('Изменить текст сообщения:', sourceMessage?.text || '');
    if (!nextText || !targetConversationId) return;

    try {
      await updateMessage(messageId, (item) => ({
        ...item,
        text: String(nextText).trim(),
        editedAt: new Date().toISOString(),
        editedBy: user.username,
        audit: [...(item.audit || []), { action: 'edit', by: user.username, at: new Date().toISOString(), previousText: item.text }]
      }), targetConversationId);
    } catch (error) {
      notify(error.message || 'Не удалось изменить сообщение', 'Сообщение');
    }
  };

  const copyMessageText = async (message) => {
    const text = String(message?.text || '').trim();
    if (!text) {
      notify('В сообщении нет текста для копирования', 'Копирование');
      return;
    }

    const copyFallback = () => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (!copied) throw new Error('copy command failed');
    };

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        copyFallback();
      }
      notify('Текст сообщения скопирован', 'Копирование');
    } catch {
      try {
        copyFallback();
        notify('Текст сообщения скопирован', 'Копирование');
      } catch {
        notify('Не удалось скопировать текст', 'Копирование');
      }
    }
  };

  const openForwardMessagePicker = (message) => {
    if (!message || message.deletedAt) return;
    setForwardSourceMessage(message);
    setSelectedMessageId('');
    setMessageReactionExpanded(false);
  };

  const openChatMediaViewer = (message, file, fileIndex) => {
    if (!file?.dataUrl) return;
    setMediaViewer({ message, file, fileIndex });
    setSelectedMessageId('');
    setMessageReactionExpanded(false);
  };

  const replyToViewedMedia = () => {
    if (!mediaViewer?.message) return;
    setReplyTo(mediaViewer.message);
    setMediaViewer(null);
  };

  const shareViewedMedia = () => {
    if (!mediaViewer?.message) return;
    openForwardMessagePicker(mediaViewer.message);
    setMediaViewer(null);
  };

  const deleteViewedMedia = async () => {
    if (!mediaViewer?.message?.id) return;
    const messageId = mediaViewer.message.id;
    setMediaViewer(null);
    await deleteMessage(messageId);
  };

  const forwardMessageToContact = async (targetEmail) => {
    if (!forwardSourceMessage || !targetEmail || forwardingTargetEmail) return;

    const sourceMessage = forwardSourceMessage;
    const targetConversationId = getConversationId(user.username, targetEmail);
    const previousMessages = threads[targetConversationId] || [];
    const attachments = sourceMessage.attachments?.length
      ? sourceMessage.attachments
      : sourceMessage.attachment ? [sourceMessage.attachment] : [];
    const forwardedText = getForwardedMessageText(sourceMessage.text);
    const newMessage = {
      id: createMessageId(),
      sender: user.username,
      text: forwardedText,
      forwardedFrom: sourceMessage.forwardedFrom || sourceMessage.sender,
      createdAt: new Date().toISOString(),
      editedAt: null,
      reactions: {},
      pinned: false,
      replyTo: null,
      attachment: attachments[0] || null,
      attachments
    };
    const nextMessages = [...previousMessages, newMessage];

    setForwardingTargetEmail(targetEmail);
    setForwardSourceMessage(null);
    suppressThreadsRefreshUntilRef.current = Date.now() + 8000;
    setThreads((prev) => ({ ...prev, [targetConversationId]: nextMessages }));
    notify('Сообщение переслано', 'Переслать');

    try {
      await persistNewMessage(targetConversationId, newMessage);
    } catch (error) {
      const isNetworkError = error?.message === 'Failed to fetch';
      if (!isNetworkError) {
        setThreads((prev) => ({ ...prev, [targetConversationId]: previousMessages }));
        suppressThreadsRefreshUntilRef.current = Date.now();
        notify(error.message || 'Не удалось переслать сообщение', 'Переслать');
      }
    } finally {
      setForwardingTargetEmail('');
    }
  };


  const clearConversation = async () => {
    if (!currentConversationId) return;
    const messageCount = currentMessages.length;
    const attachmentCount = currentMessages.reduce((sum, message) => sum + (message.attachments?.length || (message.attachment ? 1 : 0)), 0);
    const confirmed = await confirmAction(
      `Очистить диалог с ${selectedEmail}? Будет скрыто сообщений: ${messageCount}, вложений: ${attachmentCount}. Действие останется в аудите.`,
      'Очистка диалога'
    );
    if (!confirmed) return;

    const typed = await promptAction('Для подтверждения введите УДАЛИТЬ:', '', 'Финальное подтверждение');
    if (String(typed || '').trim().toUpperCase() !== 'УДАЛИТЬ') return;

    try {
      const now = new Date().toISOString();
      const nextMessages = currentMessages.map((message) => ({
        ...message,
        text: '',
        attachment: null,
        attachments: [],
        deletedAt: message.deletedAt || now,
        deletedBy: message.deletedBy || user.username,
        audit: [...(message.audit || []), { action: 'conversation_clear', by: user.username, at: now, previousText: message.text }]
      }));
      await persistThreadMessages(currentConversationId, nextMessages);
    } catch (error) {
      notify(error.message || 'Не удалось очистить переписку', 'Переписка');
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
    setShowEmployeePassword(false);
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

  const activeApplications = useMemo(() => myApplications.filter((item) => item.status !== 'done'), [myApplications]);
  const completedApplications = useMemo(() => myApplications.filter((item) => item.status === 'done'), [myApplications]);
  const threadActivityById = useMemo(() => Object.fromEntries(
    Object.entries(threads).map(([threadId, messages]) => [threadId, getThreadActivityMeta(messages || [])])
  ), [threads]);

  const allConversationIds = useMemo(() => Object.keys(threads).filter((threadId) => {
    const messages = threads[threadId] || [];
    const meta = threadActivityById[threadId] || getThreadActivityMeta(messages);
    if (!auditFilters.showEmpty && !meta.visible) return false;
    if (auditFilters.attachmentsOnly && meta.attachmentsCount === 0) return false;
    if (auditFilters.deletedOnly && meta.deletedCount === 0) return false;
    if (!isThreadInPeriod(meta.lastTimestamp, auditFilters.period)) return false;

    const query = auditSearch.trim().toLowerCase();
    if (!query) return true;
    const participantsText = getParticipantsFromThreadId(threadId).join(' ').toLowerCase();
    const messagesText = messages.map((message) => [message.sender, message.text, message.deletedBy].filter(Boolean).join(' ')).join(' ').toLowerCase();
    return `${participantsText} ${messagesText}`.includes(query);
  }).sort((a, b) => (threadActivityById[b]?.lastTimestamp || 0) - (threadActivityById[a]?.lastTimestamp || 0)), [auditFilters, auditSearch, threadActivityById, threads]);

  const typingHint = draft.trim().length > 0 ? 'Вы печатаете…' : '';
  const tabs = isManager ? MANAGER_TABS : EMPLOYEE_TABS;
  const unreadTotal = Object.values(unreadByEmail).reduce((sum, count) => sum + count, 0);
  const feedReadTimestamp = feedReadAt ? new Date(feedReadAt).getTime() : 0;
  const feedBadge = feedPosts.reduce((count, post) => {
    const postUnread = post.author !== user?.username && getFeedItemTimestamp(post) > feedReadTimestamp ? 1 : 0;
    const commentsUnread = (post.comments || []).filter((comment) => (
      comment.author !== user?.username && getFeedItemTimestamp(comment) > feedReadTimestamp
    )).length;
    return count + postUnread + commentsUnread;
  }, 0);
  const requestBadge = activeApplications.filter((item) => ['in_progress', 'waiting_employee_confirmation', 'reopened'].includes(item.status)).length || (requestStatus.state === 'sent' ? 1 : 0);
  const activeContact = chatCandidates.find((item) => item.email === selectedEmail);
  void clockTick;
  const normalizedDialogSearch = normalizeText(dialogSearch);
  const visibleMessages = useMemo(() => {
    const notDeletedMessages = currentMessages.filter((message) => !message.deletedAt);
    if (!normalizedDialogSearch) return notDeletedMessages;

    return notDeletedMessages.filter((message) => [
      message.text,
      message.sender,
      message.attachment?.name,
      ...(message.attachments || []).map((item) => item.name)
    ].some((value) => normalizeText(value).includes(normalizedDialogSearch)));
  }, [currentMessages, normalizedDialogSearch]);
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

  useEffect(() => {
    if (activeTab !== 'feed' || !user?.username) return;
    const latestTimestamp = getFeedLatestTimestamp(feedPosts);
    if (!latestTimestamp) return;

    const latestReadTimestamp = feedReadAt ? new Date(feedReadAt).getTime() : 0;
    if (latestReadTimestamp >= latestTimestamp) return;

    const nextReadAt = new Date(latestTimestamp).toISOString();
    setFeedReadAt(nextReadAt);
    saveFeedReadAt(user.username, nextReadAt);
  }, [activeTab, feedPosts, feedReadAt, user?.username]);

  const addFeedPost = async (event) => {
    event.preventDefault();
    if (!feedDraft.trim() && !feedAttachment) return;

    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: user?.username || 'employee',
          authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
          text: feedDraft.trim(),
          attachment: feedAttachment,
          category: 'Объявление'
        })
      }, { fallbackMessage: 'Не удалось опубликовать запись' });
      setFeedPosts(Array.isArray(data?.posts) ? data.posts : [data.post, ...feedPosts].filter(Boolean));
      window.requestAnimationFrame(() => {
        feedListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
      setFeedDraft('');
      setFeedAttachment(null);
    } catch (error) {
      const isNetworkError = error?.message === 'Failed to fetch';
      notify(isNetworkError ? 'Сервер временно недоступен. Запись не опубликована, попробуйте ещё раз.' : (error.message || 'Не удалось опубликовать запись'), 'Лента');
    }
  };

  const onFeedFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      notify(`Файл слишком большой. Максимум ${MAX_ATTACHMENT_SIZE_MB} МБ.`, 'Вложения');
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setFeedAttachment({ id: createMessageId(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl });
  };

  const addCommentToPost = async (postId) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: user?.username || 'employee',
          authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
          text
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось добавить комментарий');
      setFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts.map((post) => (
        post.id === postId ? { ...post, comments: [...(post.comments || []), data.comment].filter(Boolean), updatedAt: new Date().toISOString() } : post
      )));
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
    const confirmed = await confirmAction('Скрыть публикацию из общей ленты? Запись останется в журнале как удалённая.', 'Лента');
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}?deletedBy=${encodeURIComponent(user?.username || 'employee')}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить публикацию');
      setFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts.map((item) => (
        item.id === postId ? { ...item, deletedAt: data.deletedAt || new Date().toISOString(), deletedBy: data.deletedBy || user?.username } : item
      )));
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

    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}?deletedBy=${encodeURIComponent(user?.username || 'employee')}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить комментарий');
      setFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts.map((item) => (
        item.id === postId
          ? {
            ...item,
            comments: (item.comments || []).map((row) => (
              row.id === commentId ? { ...row, deletedAt: data.deletedAt || new Date().toISOString(), deletedBy: data.deletedBy || user?.username } : row
            ))
          }
          : item
      )));
    } catch (error) {
      notify(error.message || 'Не удалось удалить комментарий', 'Лента');
    }
  };

  const toggleFeedReaction = async (postId, emoji) => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji, login: user?.username || 'employee' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось обновить реакцию');
      setFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts);
    } catch (error) {
      notify(error.message || 'Не удалось обновить реакцию', 'Лента');
    }
  };

  const toggleFeedPinned = async (postId, pinned) => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось закрепить публикацию');
      setFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts);
    } catch (error) {
      notify(error.message || 'Не удалось закрепить публикацию', 'Лента');
    }
  };

  return (
    <div className={`employee-chat-layout ${isDraggingFiles ? 'dragging-files' : ''}`} onDrop={handleAttachmentDrop} onDragOver={handleDragOver} onDragEnter={handleDragOver} onDragLeave={handleDragLeave}>
      {isDraggingFiles && <div className="drop-zone-overlay"><strong>📎 Отпустите файлы</strong><span>Добавим их в текущее сообщение</span></div>}
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
              const isManagerContact = ['manager', 'admin'].includes((employee.role || '').toLowerCase()) || employee.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
              const profile = employee.profile || {};
              return (
                <div key={employee.email} className={`employee-chat-user ${selectedEmail === employee.email ? 'active' : ''} ${isManagerContact ? 'manager-priority' : ''}`}>
                  <button type="button" className="employee-contact-open" onClick={() => setSelectedEmail(employee.email)}>
                    <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
                    <span className="employee-chat-user-main">
                      <span className="employee-chat-user-email">{profile.full_name || employee.email}</span>
                      <span className="employee-chat-user-extra">{employee.email} · {profile.department || 'отдел —'} · каб. {profile.room || '—'}</span>
                    </span>
                    <span className="employee-chat-user-status">{isManagerContact ? 'admin' : (isOnline ? 'online' : 'offline')}</span>
                    {unreadByEmail[employee.email] > 0 && <span className="employee-chat-user-unread">{unreadByEmail[employee.email]}</span>}
                  </button>
                  <button type="button" className="profile-open-btn" onClick={() => { openProfileCard(employee.email); setActiveTab('profile'); }}>Профиль</button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="employee-chat-actions">
          {!isAdmin && <button className="logout-btn" onClick={handleLogout}>Выход</button>}
        </div>
      </aside>

      <section className="employee-chat-main">
        {activeTab === 'chat' && (
          <div
            className="chat-workspace"
            onClick={() => {
              if (selectedMessageId && messageReactionExpanded) setMessageReactionExpanded(false);
              else if (selectedMessageId) setSelectedMessageId('');
            }}
          >
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
                    <details className="conversation-menu">
                      <summary aria-label="Действия с диалогом">⋯</summary>
                      <div className="conversation-menu-popover">
                        <button type="button" className="danger-action" onClick={clearConversation}>Удалить переписку</button>
                      </div>
                    </details>
                  </div>
                </header>

                {pinnedMessages.length > 0 && (
                  <div className="pinned-box">
                    <strong>📌 Закреплённые</strong>
                    {pinnedMessages.map((message) => <div key={`pin-${message.id}`}>• {message.text}</div>)}
                  </div>
                )}

                <div
                  className="messages-wrap"
                  ref={messagesWrapRef}
                  onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (selectedMessageId && messageReactionExpanded) setMessageReactionExpanded(false);
                    else if (selectedMessageId) setSelectedMessageId('');
                  }}
                >
                  {messagesWithDateSeparators.length === 0 && <div className="empty-chat">{dialogSearch ? 'По запросу ничего не найдено.' : 'Сообщений пока нет.'}</div>}
                  {messagesWithDateSeparators.map((item) => {
                    if (item.type === 'date') return <div key={item.id} className="date-separator"><span>{item.label}</span></div>;

                    const message = item.message;
                    const canEdit = isManager || message.sender === user.username;
                    const isMine = message.sender === user.username;
                    const isRead = isMine && currentMessages.some((row) => row.sender !== user.username && new Date(row.createdAt) > new Date(message.createdAt));
                    const isDeleted = Boolean(message.deletedAt);
                    const attachments = !isDeleted && message.attachments?.length ? message.attachments : !isDeleted && message.attachment ? [message.attachment] : [];
                    const hasTextContent = !isDeleted && String(message.text || '').trim() && message.text !== '📎 Вложения';
                    const photoMetaLabel = new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    const statusLabel = isMine ? (isRead ? '✓✓' : '✓') : '';
                    const isPhotoCollage = attachments.length > 1 && attachments.every((file) => String(file?.type || '').startsWith('image/'));

                    const isSelected = selectedMessageId === message.id;
                    const visibleReactions = messageReactionExpanded ? REACTION_EMOJIS : REACTION_EMOJIS.slice(0, 7);
                    const messageReactionBadges = REACTION_EMOJIS.filter((emoji) => (message.reactions?.[emoji] || []).length > 0);

                    return (
                      <div key={message.id} className={`message-row ${isMine ? 'mine' : ''} ${isSelected ? 'selected' : ''}`}>
                        <div
                          role="button"
                          tabIndex={0}
                          className="message-bubble"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (isSelected && messageReactionExpanded) setMessageReactionExpanded(false);
                            else {
                              setSelectedMessageId(message.id);
                              setMessageReactionExpanded(false);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            event.stopPropagation();
                            setSelectedMessageId(message.id);
                            setMessageReactionExpanded(false);
                          }}
                        >
                          <div className="message-meta">
                            <span>{isMine ? 'Вы' : message.sender}</span>
                            <span>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>

                          {message.forwardedFrom && <div className="forwarded-preview">Переслано от {message.forwardedFrom}</div>}
                          {message.replyTo && <div className="reply-preview">↪ {message.replyTo.sender}: {message.replyTo.text}</div>}
                          {isDeleted ? (
                            <div className="message-deleted">Сообщение удалено {message.deletedBy ? `· ${message.deletedBy}` : ''}</div>
                          ) : hasTextContent ? (
                            <div className="message-text">{message.text}</div>
                          ) : null}

                          {attachments.length > 0 && (
                            <div className={`message-attachments-grid ${isPhotoCollage ? 'photo-collage' : ''}`}>
                              {attachments.map((file, index) => (
                                <AttachmentCard
                                  key={`${message.id}-file-${index}`}
                                  cardKey={`${message.id}-file-${index}`}
                                  file={file}
                                  metaLabel={photoMetaLabel}
                                  statusLabel={statusLabel}
                                  onOpen={() => openChatMediaViewer(message, file, index)}
                                />
                              ))}
                            </div>
                          )}

                          {messageReactionBadges.length > 0 && (
                            <div className="message-reactions-inline" aria-label="Реакции сообщения">
                              {messageReactionBadges.map((emoji) => {
                                const active = (message.reactions?.[emoji] || []).includes(user.username);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={active ? 'active' : ''}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleReaction(message.id, emoji);
                                    }}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          <small className="read-state message-status-line">
                            {message.editedAt && !isDeleted ? 'изменено · ' : ''}
                            {statusLabel}
                          </small>
                        </div>

                        {isSelected && !isDeleted && (
                          <div className={`selected-message-menu ${isMine ? 'mine' : ''}`} onClick={(event) => event.stopPropagation()}>
                            <div className="selected-reaction-row">
                              {visibleReactions.map((emoji) => {
                                const active = (message.reactions?.[emoji] || []).includes(user.username);
                                return <button key={emoji} type="button" className={active ? 'active' : ''} onClick={() => { toggleReaction(message.id, emoji); setSelectedMessageId(''); setMessageReactionExpanded(false); }}>{emoji}</button>;
                              })}
                              {!messageReactionExpanded && <button type="button" className="more-reactions" onClick={() => setMessageReactionExpanded(true)}>⌄</button>}
                            </div>

                            {!messageReactionExpanded && (
                              <div className="selected-actions-row">
                                <button type="button" onClick={() => { setReplyTo(message); setSelectedMessageId(''); }}>Ответить</button>
                                <button type="button" onClick={() => { copyMessageText(message); setSelectedMessageId(''); }}>Копировать</button>
                                <button type="button" onClick={() => openForwardMessagePicker(message)}>Переслать</button>
                                <button type="button" onClick={() => { togglePinned(message.id); setSelectedMessageId(''); }}>{message.pinned ? 'Открепить' : 'Закрепить'}</button>
                                {canEdit && <button type="button" onClick={() => { editMessage(message.id); setSelectedMessageId(''); }}>Изменить</button>}
                                {canEdit && <button type="button" className="danger-action" onClick={() => { deleteMessage(message.id); setSelectedMessageId(''); }}>Удалить</button>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="composer-wrap" onDrop={handleAttachmentDrop} onDragOver={handleDragOver} onDragEnter={handleDragOver}>
                  <details className="template-toolbar template-menu">
                    <summary>Шаблоны и смайлы</summary>
                    <div className="template-menu-panel">
                      <div className="template-row">
                        {templateMessages.map((template) => (
                          <span key={template} className="template-chip-wrap">
                            <button type="button" onClick={() => appendToDraft(template)}>{template}</button>
                            {customTemplates.includes(template) && <button type="button" className="template-remove" onClick={() => removeCustomTemplate(template)}>×</button>}
                          </span>
                        ))}
                      </div>
                      <div className="composer-extra-actions">
                        <button type="button" onClick={addCustomTemplate}>+ Мой шаблон</button>
                        <button type="button" onClick={() => setIsEmojiOpen((prev) => !prev)}>😊 Смайлы</button>
                      </div>
                      {isEmojiOpen && (
                        <div className="emoji-picker">
                          {QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => appendToDraft(emoji)}>{emoji}</button>)}
                        </div>
                      )}
                    </div>
                  </details>

                  {replyTo && <div className="reply-preview active-reply">Ответ на: {replyTo.sender}: {replyTo.text}<button type="button" onClick={() => setReplyTo(null)}>×</button></div>}

                  {attachmentDrafts.length > 0 && (
                    <div className="attachment-preview-grid">
                      {attachmentDrafts.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="attachment-preview">
                          <span>{getFileIcon(file.type)} {file.name} ({formatFileSize(file.size)})</span>
                          <button type="button" onClick={() => removeAttachmentDraft(index)}>Убрать</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {typingHint && <div className="typing-hint">{typingHint}</div>}

                  <form className="message-form" onSubmit={handleSend}>
                    <input placeholder="Введите сообщение или перетащите файлы сюда..." value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} />
                    <label className="attach-file-btn">📎 Фото/видео/файлы<input type="file" hidden multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z" onChange={handleAttachmentChange} /></label>
                    <button type="submit">Отправить</button>
                  </form>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'request' && !isManager && (
          <div className="request-workspace">
            <header className="section-hero">
              <span className="eyebrow">Служебная заявка</span>
              <h2>Сообщить о проблеме</h2>
              <p>Заполните категорию, приоритет и описание — статус заявки появится сразу после отправки.</p>
            </header>
            <div className={`request-status-card ${requestStatus.state}`}>
              <strong>{requestStatus.text}</strong>
              {requestStatus.ticketId && <span>Номер: #{requestStatus.ticketId}</span>}
              {applicationsError && <small>Заявки временно недоступны: {applicationsError}</small>}
            </div>
            <form className="employee-request-box" onSubmit={submitRequest}>
              <div className="form-grid two">
                <label>Категория<select value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)}>{REQUEST_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Приоритет<select value={requestPriority} onChange={(e) => setRequestPriority(e.target.value)}>{REQUEST_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
              <textarea rows={7} placeholder="Например: кабинет 204, не работает принтер, требуется проверка подключения..." value={requestText} onChange={(e) => setRequestText(e.target.value)} />
              <div className="request-form-actions"><button type="submit" disabled={!requestText.trim() || requestStatus.state === 'sending'}>{requestStatus.state === 'sending' ? 'Отправляем...' : 'Отправить заявку'}</button><button type="button" onClick={() => fetchMyApplications({ silent: false })}>{applicationsLoading ? 'Обновляем...' : 'Обновить статусы'}</button></div>
            </form>

            <section className="employee-ticket-board">
              <div className="ticket-board-head"><h3>Мои активные заявки</h3><span>{activeApplications.length}</span></div>
              {activeApplications.length === 0 && <div className="empty-mini">Активных заявок нет — новые появятся здесь сразу после отправки.</div>}
              {activeApplications.map((ticket) => {
                const meta = getApplicationStatusMeta(ticket.status);
                const waitingStartedAt = ticket.created_at || ticket.data;
                const waitingSeconds = ticket.waiting_seconds ?? (ticket.status === 'new' || ticket.status === 'reopened' ? secondsSince(waitingStartedAt) : 0);
                const workSeconds = ticket.work_seconds ?? (['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(ticket.status) ? secondsSince(ticket.work_started_at || ticket.accepted_at) : 0);
                return (
                  <article key={ticket.id} className={`employee-ticket-card ${meta.tone}`}>
                    <header><div><strong>#{ticket.id} · {meta.label}</strong><span>{ticket.category || 'Другое'} · {ticket.priority || 'Обычный'}</span></div><em>{meta.hint}</em></header>
                    <p>{ticket.application}</p>
                    <div className="ticket-metrics"><span>Ожидание: {formatDuration(waitingSeconds)}</span><span>В работе: {formatDuration(workSeconds)}</span>{ticket.eta_minutes && <span>Подойдут через: {ticket.eta_minutes} мин.</span>}</div>
                    {(ticket.executor || ticket.accepted_by || ticket.admin_comment) && <div className="ticket-admin-note"><strong>{ticket.executor || ticket.accepted_by || 'Администратор'}</strong><span>{ticket.admin_comment || 'Заявка принята, ожидайте исполнителя.'}</span></div>}
                    {ticket.process && <div className="ticket-admin-note"><strong>Что сделано</strong><span>{ticket.process}</span></div>}
                    {['in_progress', 'waiting_employee_confirmation'].includes(ticket.status) && <div className="ticket-actions"><button type="button" onClick={() => confirmApplicationDone(ticket.id)}>✅ Заявка выполнена</button><button type="button" onClick={() => reopenApplication(ticket.id)}>Проблема осталась</button></div>}
                  </article>
                );
              })}
              {completedApplications.length > 0 && <details className="ticket-history"><summary>История выполненных заявок ({completedApplications.length})</summary>{completedApplications.slice(0, 10).map((ticket) => <div key={ticket.id} className="ticket-history-row"><span>#{ticket.id}</span><span>{ticket.application}</span><strong>{formatDuration(ticket.waiting_seconds || 0)} / {formatDuration(ticket.work_seconds || 0)}</strong></div>)}</details>}
            </section>
          </div>
        )}

        {activeTab === 'feed' && (
          <section className="employee-feed-section">
            <header className="employee-feed-header">
              <div><span className="eyebrow">Общая серверная лента</span><h2>Лента сотрудников</h2><p>Публикации сохраняются на сервере и доступны всем пользователям.</p></div>
              <button type="button" onClick={() => fetchFeed({ silent: false })}>Обновить</button>
            </header>
            {feedError && <div className="feed-status-warning">Лента временно недоступна: {feedError}</div>}
            <form className="employee-feed-composer" onSubmit={addFeedPost}>
              <textarea rows={4} placeholder="Новость, объявление или рабочая заметка..." value={feedDraft} onChange={(e) => setFeedDraft(e.target.value)} />
              {feedAttachment && <div className="employee-feed-attachment-preview"><span>{getFileIcon(feedAttachment.type)} {feedAttachment.name}</span><button type="button" onClick={() => setFeedAttachment(null)}>Убрать</button></div>}
              <div className="employee-feed-composer-actions"><label>📎 Фото/видео/файл<input type="file" hidden accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z" onChange={onFeedFileChange} /></label><button type="submit" disabled={!feedDraft.trim() && !feedAttachment}>Опубликовать</button></div>
            </form>
            <div className="employee-feed-list" ref={feedListRef}>
              {feedPosts.length === 0 && <div className="empty-chat">Пока нет публикаций.</div>}
              {feedPosts.filter((post) => !post.deletedAt).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))).map((post) => {
                const canDeletePost = isManager || isAdmin || post.author === user?.username;
                return (
                  <article key={post.id} className="employee-feed-post">
                    <header className="employee-feed-post-header"><div><strong>{post.pinned ? '📌 ' : ''}{post.authorName}</strong><span>@{post.author} · {new Date(post.createdAt).toLocaleString('ru-RU')}</span></div><div className="feed-post-actions">{isManager && <button type="button" onClick={() => toggleFeedPinned(post.id, !post.pinned)}>{post.pinned ? 'Открепить' : 'Закрепить'}</button>}{canDeletePost && <button type="button" className="employee-feed-delete" onClick={() => deleteFeedPost(post.id)}>Удалить</button>}</div></header>
                    {post.text && <p className="employee-feed-post-text">{post.text}</p>}
                    {post.attachment?.dataUrl && <div className="employee-feed-attachment"><AttachmentCard cardKey={`${post.id}-attachment`} file={post.attachment} variant="feed" /></div>}
                    <div className="feed-reaction-row">{REACTION_EMOJIS.slice(0, 6).map((emoji) => { const count = post.reactions?.[emoji]?.length || 0; const active = (post.reactions?.[emoji] || []).includes(user?.username); return <button key={emoji} type="button" className={active ? 'active' : ''} onClick={() => toggleFeedReaction(post.id, emoji)}>{emoji} {count > 0 ? count : ''}</button>; })}</div>
                    <div className="employee-feed-comments"><div className="employee-feed-comments-title">Комментарии</div>{(post.comments || []).filter((comment) => !comment.deletedAt).length === 0 && <small className="employee-feed-no-comments">Комментариев пока нет.</small>}{(post.comments || []).filter((comment) => !comment.deletedAt).map((comment) => { const canDeleteComment = isManager || isAdmin || comment.author === user?.username; return <div key={comment.id} className="employee-feed-comment"><div className="employee-feed-comment-body"><strong>{comment.authorName}</strong><span>{comment.text}</span><small>@{comment.author} · {new Date(comment.createdAt).toLocaleString('ru-RU')}</small></div>{canDeleteComment && <button type="button" onClick={() => deleteFeedComment(post.id, comment.id)}>Удалить</button>}</div>; })}<div className="employee-feed-comment-form"><input placeholder="Оставить комментарий…" value={commentDrafts[post.id] || ''} onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))} /><button type="button" onClick={() => addCommentToPost(post.id)} disabled={!(commentDrafts[post.id] || '').trim()}>Отправить</button></div></div>
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
                <section className="profile-panel"><h3>Мой профиль</h3><form onSubmit={saveMyProfile} className="profile-form profile-form-labeled"><label><span>ФИО</span><input placeholder="Иванов Иван Иванович" value={profileForm.full_name} onChange={(e) => updateProfileField('full_name', e.target.value)} /></label><label><span>Логин</span><input value={user?.username || ''} disabled /></label><label><span>Должность</span><input placeholder="Например: инженер" value={profileForm.position} onChange={(e) => updateProfileField('position', e.target.value)} /></label><label><span>Отдел</span><input placeholder="Название отдела" value={profileForm.department} onChange={(e) => updateProfileField('department', e.target.value)} /></label><label><span>Кабинет</span><input placeholder="Например: 214" value={profileForm.room} onChange={(e) => updateProfileField('room', e.target.value)} /></label><label><span>Внутренний телефон</span><input placeholder="Например: 12-34" value={profileForm.phone} onChange={(e) => updateProfileField('phone', e.target.value)} /></label><label><span>Сайт / соцссылка</span><input placeholder="https://..." value={profileForm.website} onChange={(e) => updateProfileField('website', e.target.value)} /></label><label><span>Статус</span><input placeholder="Короткий статус" value={profileForm.statusText} onChange={(e) => updateProfileField('statusText', e.target.value)} /></label><label className="profile-field-wide"><span>О себе</span><textarea placeholder="Кратко о себе" rows={4} value={profileForm.bio} onChange={(e) => updateProfileField('bio', e.target.value)} /></label><button type="submit">Сохранить анкету</button></form></section>
                <section className="profile-panel"><h3>Безопасность и фото</h3><div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>Изменить фото</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>Удалить фото</button></div><form onSubmit={changeMyPassword} className="profile-password-form"><input type="password" placeholder="Текущий пароль" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))} /><input type="password" placeholder="Новый пароль" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))} /><button type="submit">Обновить пароль</button></form></section>
              </div>
            )}
          </div>
        )}

        {activeTab === 'employees' && isManager && (
          <section className="manager-panel"><h2>Управление сотрудниками</h2><form className="manager-form manager-form-labeled" onSubmit={saveEmployee}><label><span>Логин (email)</span><input placeholder="ivanov@example.local" value={employeeForm.login} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, login: e.target.value }))} required /></label><label><span>{employeeForm.id ? 'Новый пароль' : 'Пароль'}</span><input type={showEmployeePassword ? 'text' : 'password'} placeholder={employeeForm.id ? 'Оставьте пустым, если не менять' : 'Пароль для входа'} value={employeeForm.password} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, password: e.target.value }))} /><small>{employeeForm.id ? 'Оставьте поле пустым, если пароль менять не нужно.' : 'Минимум 8 символов.'}</small></label><label><span>ФИО</span><input placeholder="Иванов Иван Иванович" value={employeeForm.full_name} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, full_name: e.target.value }))} /></label><label><span>Отдел</span><input placeholder="Отдел сотрудника" value={employeeForm.department} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, department: e.target.value }))} /></label><label className="manager-password-toggle"><input type="checkbox" checked={showEmployeePassword} onChange={(e) => setShowEmployeePassword(e.target.checked)} />Показать пароль</label><div className="manager-form-actions"><button type="submit">{employeeForm.id ? 'Сохранить' : 'Добавить'}</button>{employeeForm.id && <button type="button" onClick={() => { setEmployeeForm({ id: null, login: '', password: '', full_name: '', department: '', phone: '', room: '' }); setShowEmployeePassword(false); }}>Отмена</button>}</div></form><div className="manager-list">{directoryEmployees.map((employee) => <div className="manager-list-item" key={employee.id}><div><strong>{employee.login}</strong><div>{employee.full_name || '—'}</div></div><div className="manager-list-actions"><button type="button" onClick={() => { setEmployeeForm({ id: employee.id, login: employee.login || '', password: '', full_name: employee.full_name || '', department: employee.department || '', phone: employee.phone || '', room: employee.room || '' }); setShowEmployeePassword(false); }}>Редактировать</button><button type="button" onClick={() => deleteEmployee(employee.id)}>Удалить</button></div></div>)}</div></section>
        )}

        {activeTab === 'audit' && isManager && (
          <section className="manager-panel"><h2>Переписка сотрудников</h2><div className="audit-toolbar"><input type="search" placeholder="Поиск по участникам и тексту" value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} /><div className="audit-filter-row"><label><input type="checkbox" checked={auditFilters.showEmpty} onChange={(e) => setAuditFilters((prev) => ({ ...prev, showEmpty: e.target.checked }))} />Показывать пустые/архивные</label><label><input type="checkbox" checked={auditFilters.attachmentsOnly} onChange={(e) => setAuditFilters((prev) => ({ ...prev, attachmentsOnly: e.target.checked }))} />Только с вложениями</label><label><input type="checkbox" checked={auditFilters.deletedOnly} onChange={(e) => setAuditFilters((prev) => ({ ...prev, deletedOnly: e.target.checked }))} />Только удалённые</label></div><div className="audit-periods">{[['all', 'Все'], ['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц']].map(([value, label]) => <button key={value} type="button" className={auditFilters.period === value ? 'active' : ''} onClick={() => setAuditFilters((prev) => ({ ...prev, period: value }))}>{label}</button>)}</div></div><div className="threads-grid"><div className="threads-list">{allConversationIds.length === 0 && <div className="empty-chat">Диалогов по фильтрам нет.</div>}{allConversationIds.map((threadId) => { const participants = getParticipantsFromThreadId(threadId); const meta = threadActivityById[threadId] || getThreadActivityMeta(threads[threadId] || []); return <button key={threadId} type="button" className={`thread-item ${selectedThreadId === threadId ? 'active' : ''}`} onClick={() => setSelectedThreadId(threadId)}><span className="thread-title">{participants.join(' ↔ ')}</span><span className="thread-stats"><b>{meta.messageCount}</b> сообщ. {meta.attachmentsCount > 0 ? ` · 📎 ${meta.attachmentsCount}` : ''}{meta.deletedCount > 0 ? ` · удалено ${meta.deletedCount}` : ''}</span><span className="thread-last">{meta.lastAt ? `последнее: ${new Date(meta.lastAt).toLocaleString('ru-RU')}` : 'без сообщений'}</span></button>; })}</div><div className="threads-messages">{!selectedThreadId && <div className="empty-chat">Выберите переписку.</div>}{selectedThreadId && selectedThreadMessages.map((message) => { const isDeleted = Boolean(message.deletedAt); const attachments = !isDeleted && message.attachments?.length ? message.attachments : !isDeleted && message.attachment ? [message.attachment] : []; return <div key={message.id} className={`audit-message ${isDeleted ? 'deleted' : ''}`}><div className="message-meta"><span>{message.sender}</span><span>{new Date(message.createdAt).toLocaleString('ru-RU')}</span></div><div>{isDeleted ? <em>Сообщение удалено</em> : message.text}</div>{isDeleted && <div className="audit-history">Удалил: {message.deletedBy || '—'} · {message.deletedAt ? new Date(message.deletedAt).toLocaleString('ru-RU') : '—'}</div>}{attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${message.id}-audit-${index}`} cardKey={`${message.id}-audit-${index}`} file={file} />)}</div>}{Array.isArray(message.audit) && message.audit.length > 0 && <div className="audit-history"><strong>История:</strong>{message.audit.slice(-4).map((entry, index) => <span key={`${message.id}-audit-entry-${index}`}>{entry.action || 'изменение'} · {entry.by || '—'} · {entry.at ? new Date(entry.at).toLocaleString('ru-RU') : '—'}</span>)}</div>}<div className="message-controls"><button type="button" onClick={() => editMessage(message.id, selectedThreadId)}>Изменить</button><button type="button" onClick={() => deleteMessage(message.id, selectedThreadId)}>Удалить</button></div></div>; })}</div></div></section>
        )}
      </section>

      {mediaViewer && (
        <div className="photo-viewer-backdrop" onMouseDown={() => setMediaViewer(null)}>
          <header className="photo-viewer-header" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="photo-viewer-back" onClick={() => setMediaViewer(null)}>← Назад</button>
            <details className="photo-viewer-menu">
              <summary aria-label="Действия с фото">⋯</summary>
              <div className="photo-viewer-menu-popover">
                <a href={mediaViewer.file.dataUrl} download={mediaViewer.file.name || 'photo'}>Сохранить</a>
                <button type="button" onClick={replyToViewedMedia}>Ответить</button>
                <button type="button" onClick={shareViewedMedia}>Переслать</button>
                {(isManager || mediaViewer.message?.sender === user.username) && <button type="button" className="danger-action" onClick={deleteViewedMedia}>Удалить</button>}
              </div>
            </details>
          </header>
          <div className="photo-viewer-stage" onMouseDown={(event) => event.stopPropagation()}>
            <img src={mediaViewer.file.dataUrl} alt={mediaViewer.file.name || 'Фото'} />
          </div>
        </div>
      )}

      {forwardSourceMessage && (
        <div className="app-modal-backdrop" onMouseDown={() => setForwardSourceMessage(null)}>
          <div className="app-modal-card forward-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
            <h3>Переслать сообщение</h3>
            <p>Выберите сотрудника или администратора, кому отправить копию сообщения.</p>
            <div className="forward-source-preview">
              <strong>{forwardSourceMessage.sender}</strong>
              <span>{forwardSourceMessage.text || 'Вложение без текста'}</span>
            </div>
            <div className="forward-contact-list">
              {chatCandidates.length === 0 && <div className="empty-mini">Нет доступных получателей</div>}
              {chatCandidates.map((employee) => (
                <button
                  key={`forward-${employee.email}`}
                  type="button"
                  disabled={Boolean(forwardingTargetEmail)}
                  onClick={() => forwardMessageToContact(employee.email)}
                >
                  <span className="contact-avatar small">{(employee.profile?.full_name || employee.email).slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{employee.profile?.full_name || employee.email}</strong>
                    <small>{employee.email}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="app-modal-actions">
              <button type="button" onClick={() => setForwardSourceMessage(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

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
