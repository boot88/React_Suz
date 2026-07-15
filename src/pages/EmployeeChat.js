import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { MANAGER_CREDENTIALS } from '../config/authConfig';
import './EmployeeChat.css';

const CHAT_READ_STATE_KEY = 'chatReadState';
const CHAT_DRAFTS_KEY = 'chatDrafts';
const CHAT_LOCAL_SETTINGS_KEY = 'chatLocalSettings';
const CHAT_PENDING_MESSAGES_KEY = 'chatPendingMessages';
const FEED_READ_STATE_KEY = 'employeeFeedReadState';
const FEED_DRAFT_KEY = 'employeeFeedDraft';
const FEED_HIDDEN_POSTS_KEY = 'employeeFeedHiddenPosts';
const EMPLOYEE_DIRECTORY_CACHE_KEY = 'employeeDirectoryCache';
const MANAGER_TEMPLATE_MESSAGES = ['✅ Принято в работу', '👀 Смотрю сейчас', '🔧 Исправляю', '📌 Уточните кабинет и устройство', '📷 Пришлите фото ошибки', '⏱️ Вернусь с ответом в течение 15 минут', '🧪 Проверяю решение', '✅ Готово, проверьте пожалуйста', '🙏 Спасибо, закрываю обращение'];
const EMPLOYEE_TEMPLATE_MESSAGES = ['👋 Добрый день!', '🆘 Нужна помощь', '📍 Я в кабинете ...', '📷 Сейчас пришлю фото', '✅ Получилось, спасибо!', '❌ Ошибка осталась', '🔁 Повторил действие, результат тот же', '📞 Можем созвониться?', '🙏 Спасибо!'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🙏', '🎉', '🤩', '👌', '💯', '💪', '🤝', '✨', '👀'];
const QUICK_EMOJIS = ['😀', '🙂', '😅', '🙏', '👍', '✅', '👀', '📌', '🔧', '⏳', '❗', '❤️'];
const EMPLOYEE_CUSTOM_TEMPLATES_KEY = 'employeeChatCustomTemplates';
const MAX_ATTACHMENT_SIZE_MB = 100;
const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)$/i;
const EMPLOYEE_TABS = [
  { id: 'feed', label: 'Лента' },
  { id: 'chat', label: 'Чат' },
  { id: 'request', label: 'Заявка' }
];
const MANAGER_TABS = [
  { id: 'chat', label: 'Чат' },
  { id: 'feed', label: 'Лента' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'audit', label: 'Аудит' }
];
const REQUEST_CATEGORIES = ['Техника', 'Сеть', 'ПО', 'Доступы', 'Другое'];
const REQUEST_PRIORITIES = ['Обычный', 'Важный', 'Срочный'];
const FEED_CATEGORIES = ['Объявление', 'Новость', 'Вопрос', 'Важно', 'Фотоотчёт', 'Потеряно/найдено', 'Заявка', 'Поздравление'];
const CHAT_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'mine', label: 'Мои' },
  { id: 'peer', label: 'Собеседник' },
  { id: 'files', label: 'С файлами' },
  { id: 'photo', label: 'Фото' },
  { id: 'today', label: 'Сегодня' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' }
];
const CONTACT_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'online', label: 'Онлайн' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'managers', label: 'Менеджеры' },
  { id: 'department', label: 'Мой отдел' },
  { id: 'favorites', label: 'Избранные' },
  { id: 'recent', label: 'Недавние' },
  { id: 'attachments', label: 'С вложениями' },
  { id: 'tickets', label: 'С заявками' }
];
const CHAT_MEDIA_TABS = [
  { id: 'media', label: 'Медиа' },
  { id: 'files', label: 'Файлы' },
  { id: 'links', label: 'Ссылки' }
];
const CHAT_THEMES = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' }
];
const CHAT_DENSITIES = [
  { id: 'regular', label: 'Обычная' },
  { id: 'compact', label: 'Компактная' }
];
const CHAT_TEXT_SIZES = [
  { id: 'small', label: 'Меньше' },
  { id: 'medium', label: 'Обычно' },
  { id: 'large', label: 'Больше' }
];
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

const readChatDrafts = (username = 'guest') => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY) || '{}');
    return all?.[username] && typeof all[username] === 'object' ? all[username] : {};
  } catch {
    return {};
  }
};

const saveChatDrafts = (username = 'guest', drafts = {}) => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY) || '{}');
    all[username] = drafts;
    localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(all));
  } catch {
    // noop
  }
};

const readChatLocalSettings = (username = 'guest') => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_LOCAL_SETTINGS_KEY) || '{}');
    return {
      archived: [],
      hidden: [],
      pinned: [],
      muted: [],
      favorites: [],
      uiTheme: 'light',
      uiDensity: 'regular',
      uiTextSize: 'medium',
      showChatTemplates: false,
      showExtraMessageActions: false,
      showDialogMediaPanel: false,
      showDialogFilters: false,
      showDialogDateJump: false,
      showFeedCategorySelect: false,
      showFeedFilters: false,
      ...(all?.[username] || {})
    };
  } catch {
    return { archived: [], hidden: [], pinned: [], muted: [], favorites: [], uiTheme: 'light', uiDensity: 'regular', uiTextSize: 'medium', showChatTemplates: false, showExtraMessageActions: false, showDialogMediaPanel: false, showDialogFilters: false, showDialogDateJump: false, showFeedCategorySelect: false, showFeedFilters: false };
  }
};

const saveChatLocalSettings = (username = 'guest', settings = {}) => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_LOCAL_SETTINGS_KEY) || '{}');
    all[username] = settings;
    localStorage.setItem(CHAT_LOCAL_SETTINGS_KEY, JSON.stringify(all));
  } catch {
    // noop
  }
};

const readPendingMessages = (username = 'guest') => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_PENDING_MESSAGES_KEY) || '{}');
    return Array.isArray(all?.[username]) ? all[username] : [];
  } catch {
    return [];
  }
};

const savePendingMessages = (username = 'guest', messages = []) => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_PENDING_MESSAGES_KEY) || '{}');
    all[username] = messages;
    localStorage.setItem(CHAT_PENDING_MESSAGES_KEY, JSON.stringify(all));
  } catch {
    // noop
  }
};

const getMessageAttachments = (message = {}) => (message.attachments?.length ? message.attachments : message.attachment ? [message.attachment] : []).filter(Boolean);
const getMessageMediaAttachments = (message = {}) => getMessageAttachments(message).filter(isMediaAttachment);
const extractLinks = (text = '') => String(text || '').match(/https?:\/\/\S+/gi) || [];
const getLinkPreview = (url = '') => {
  try {
    const parsed = new URL(url);
    return {
      url,
      domain: parsed.hostname.replace(/^www\./, ''),
      title: parsed.hostname.replace(/^www\./, ''),
      description: parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : 'Ссылка из сообщения',
      favicon: `${parsed.origin}/favicon.ico`
    };
  } catch {
    return null;
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

const isNetworkFailure = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network error');
};

const getFriendlyNetworkMessage = (fallback = 'Не удалось выполнить действие') => `${fallback}. Проверьте соединение и попробуйте ещё раз.`;

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

const createImageThumbnailDataUrl = (file, maxSize = 480) => new Promise((resolve) => {
  if (!String(file?.type || '').startsWith('image/')) {
    resolve('');
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => resolve('');
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => resolve('');
    image.onload = () => {
      const ratio = Math.min(1, maxSize / Math.max(image.width || maxSize, image.height || maxSize));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((image.width || maxSize) * ratio));
      canvas.height = Math.max(1, Math.round((image.height || maxSize) * ratio));
      const context = canvas.getContext('2d');
      if (!context) {
        resolve('');
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.76));
    };
    image.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
});

const createVideoThumbnailDataUrl = (file, maxSize = 640) => new Promise((resolve) => {
  if (!isVideoAttachment(file)) {
    resolve('');
    return;
  }

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  let settled = false;
  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
  };
  const finish = (value = '') => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(value);
  };

  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.onloadedmetadata = () => {
    try {
      video.currentTime = Math.min(0.25, Math.max(0, (video.duration || 1) / 20));
    } catch {
      finish('');
    }
  };
  video.onseeked = () => {
    const width = video.videoWidth || maxSize;
    const height = video.videoHeight || maxSize;
    const ratio = Math.min(1, maxSize / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) {
      finish('');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    finish(canvas.toDataURL('image/jpeg', 0.78));
  };
  video.onerror = () => finish('');
  window.setTimeout(() => finish(''), 3500);
  video.src = objectUrl;
});

const createAttachmentThumbnailDataUrl = async (file) => {
  if (String(file?.type || '').startsWith('image/')) return createImageThumbnailDataUrl(file);
  if (isVideoAttachment(file)) return createVideoThumbnailDataUrl(file);
  return '';
};

const nudgeVideoToFirstFrame = (event) => {
  const video = event.currentTarget;
  if (!video || video.dataset.firstFrameReady === '1') return;
  video.dataset.firstFrameReady = '1';
  try {
    if ((video.currentTime || 0) < 0.05) video.currentTime = Math.min(0.25, Math.max(0, (video.duration || 1) / 20));
  } catch {
    // noop: some browsers restrict seeking before metadata is fully ready
  }
};


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
  const sourceUrl = getOriginalAttachmentUrl(file);
  if (!sourceUrl) return;
  try {
    const url = sourceUrl.startsWith('data:') ? URL.createObjectURL(dataUrlToBlob(sourceUrl)) : sourceUrl;
    window.open(url, '_blank', 'noopener,noreferrer');
    if (sourceUrl.startsWith('data:')) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    console.error('Attachment open error:', error);
  }
};

const formatFeedLogin = (login = '') => String(login || '').replace(/^@+/, '');

const getFeedAttachments = (post = {}) => {
  const attachments = Array.isArray(post.attachments) ? post.attachments.filter(Boolean) : [];
  if (attachments.length) return attachments;
  return post.attachment ? [post.attachment] : [];
};

const getFeedPostsSignature = (posts = []) => JSON.stringify((Array.isArray(posts) ? posts : []).map((post) => ({
  id: post?.id,
  updatedAt: post?.updatedAt,
  editedAt: post?.editedAt,
  deletedAt: post?.deletedAt,
  comments: Array.isArray(post?.comments) ? post.comments.length : 0,
  attachments: getFeedAttachments(post).length,
  reactions: post?.reactions ? Object.values(post.reactions).map((items) => Array.isArray(items) ? items.length : 0).join(',') : ''
})));

const getVisibleFeedPosts = (posts = []) => (Array.isArray(posts) ? posts.filter((post) => post && !post.deletedAt) : []);

const sameLogin = (left = '', right = '') => formatFeedLogin(left).trim().toLowerCase() === formatFeedLogin(right).trim().toLowerCase();

const getFeedDraftKey = (username = 'guest') => `${FEED_DRAFT_KEY}:${username || 'guest'}`;
const getHiddenFeedPostsKey = (username = 'guest') => `${FEED_HIDDEN_POSTS_KEY}:${username || 'guest'}`;

const readSavedFeedDraft = (username = 'guest') => {
  try {
    const saved = JSON.parse(localStorage.getItem(getFeedDraftKey(username)) || '{}');
    return {
      text: String(saved.text || ''),
      category: FEED_CATEGORIES.includes(saved.category) ? saved.category : FEED_CATEGORIES[0]
    };
  } catch {
    return { text: '', category: FEED_CATEGORIES[0] };
  }
};

const saveFeedDraft = (username = 'guest', draft = {}) => {
  localStorage.setItem(getFeedDraftKey(username), JSON.stringify({ text: draft.text || '', category: draft.category || FEED_CATEGORIES[0] }));
};

const clearSavedFeedDraft = (username = 'guest') => localStorage.removeItem(getFeedDraftKey(username));

const readHiddenFeedPosts = (username = 'guest') => {
  try {
    const saved = JSON.parse(localStorage.getItem(getHiddenFeedPostsKey(username)) || '[]');
    return Array.isArray(saved) ? saved.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const saveHiddenFeedPosts = (username = 'guest', postIds = []) => {
  localStorage.setItem(getHiddenFeedPostsKey(username), JSON.stringify([...new Set(postIds.filter(Boolean))]));
};

const isImageAttachment = (file = {}) => String(file.type || '').startsWith('image/');
const isMediaAttachment = (file = {}) => isImageAttachment(file) || isVideoAttachment(file);
const resolveAttachmentUrl = (url = '') => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:') || /^https?:\/\//i.test(url)) return url;
  const fileBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${fileBaseUrl}${url.startsWith('/') ? url : `/${url}`}`;
};
const getAttachmentUrl = (file = {}) => resolveAttachmentUrl(file.thumbnailUrl || file.previewUrl || file.url || file.dataUrl || '');
const getOriginalAttachmentUrl = (file = {}) => resolveAttachmentUrl(file.url || file.dataUrl || file.previewUrl || file.thumbnailUrl || '');
const getVideoPosterUrl = (file = {}) => resolveAttachmentUrl(file.posterUrl || file.thumbnailUrl || file.previewUrl || '');
const getPostShareUrl = (postId = '') => `${window.location.origin}${window.location.pathname}?feedPost=${encodeURIComponent(postId)}`;
const isPostAuthor = (post = {}, currentUser = {}) => sameLogin(post.author, currentUser?.username || '') || sameLogin(post.login, currentUser?.username || '') || sameLogin(post.sender, currentUser?.username || '');


const canManageFeedPost = (post = {}, currentUser = {}, isManager = false, isAdmin = false) => {
  if (isManager || isAdmin) return true;
  const username = currentUser?.username || '';
  if (!username) return false;
  return sameLogin(post.author, username)
    || sameLogin(post.login, username)
    || sameLogin(post.sender, username);
};

const AttachmentCard = ({ file, cardKey, variant = 'message', onOpen, onSelect, onQuickReaction, metaLabel = '', statusLabel = '' }) => {
  const fileName = file?.name || 'Файл';
  const fileType = String(file?.type || '');
  const isImage = fileType.startsWith('image/');
  const isVideo = isVideoAttachment(file);
  const cardClassName = `${variant === 'feed' ? 'employee-feed-attachment-card' : 'message-attachment-card'} ${isVideo ? 'video-attachment' : ''}`;

  if (variant === 'message' && isImage) {
    return (
      <button
        key={cardKey}
        type="button"
        className="message-photo-card"
        onClick={(event) => {
          event.stopPropagation();
          onOpen?.(event);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onQuickReaction?.(event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect?.(event);
        }}
        aria-label={`Открыть фото ${fileName}`}
      >
        <img src={getAttachmentUrl(file)} alt={fileName} />
        {(metaLabel || statusLabel) && <span className="message-photo-meta">{metaLabel} {statusLabel}</span>}
      </button>
    );
  }

  return (
    <div
      key={cardKey}
      className={cardClassName}
      onClick={isVideo ? (event) => {
        event.stopPropagation();
        onOpen?.(event);
      } : undefined}
    >
      {isVideo ? (
        <video
          className="attachment-video-player"
          src={getOriginalAttachmentUrl(file)}
          poster={getVideoPosterUrl(file) || getAttachmentUrl(file)}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={nudgeVideoToFirstFrame}
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.(event);
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          Ваш браузер не поддерживает просмотр этого видео.
        </video>
      ) : isImage ? (
        <img src={getAttachmentUrl(file)} alt={fileName} />
      ) : (
        <span className="file-icon">{getFileIcon(fileType)}</span>
      )}
      {(variant !== 'message' || !isImage) && <small>{fileName} · {formatFileSize(file?.size)}</small>}
      {variant !== 'message' && (
        <div className="attachment-card-actions">
          <a href={getOriginalAttachmentUrl(file)} download={fileName}>Скачать</a>
          <button type="button" onClick={() => openAttachmentInNewTab(file)}>Открыть</button>
        </div>
      )}
      {variant === 'message' && !isVideo && !isImage && (
        <div className="attachment-card-actions">
          <a href={getOriginalAttachmentUrl(file)} download={fileName}>Скачать</a>
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
  const messageTextareaRef = useRef(null);
  const profileDirtyRef = useRef(false);
  const profileLoadedForRef = useRef('');
   
  const [threads, setThreads] = useState({});
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draft, setDraft] = useState('');
  const [attachmentDrafts, setAttachmentDrafts] = useState([]);
  const [pendingMessages, setPendingMessages] = useState(() => readPendingMessages(user?.username || 'guest'));
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [search, setSearch] = useState('');
  const [dialogSearch, setDialogSearch] = useState('');
  const [dialogSearchIndex, setDialogSearchIndex] = useState(0);
  const [dialogFilter, setDialogFilter] = useState('all');
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [mediaPanelTab, setMediaPanelTab] = useState('media');
  const [mediaPanelSearch, setMediaPanelSearch] = useState('');
  const [contactFilter, setContactFilter] = useState('all');
  const [chatDrafts, setChatDrafts] = useState(() => readChatDrafts(user?.username || 'guest'));
  const [chatLocalSettings, setChatLocalSettings] = useState(() => readChatLocalSettings(user?.username || 'guest'));
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [inlineEditMessageId, setInlineEditMessageId] = useState('');
  const [inlineEditText, setInlineEditText] = useState('');
  const [pinnedMessageIndex, setPinnedMessageIndex] = useState(0);
  const [peerTypingUntil, setPeerTypingUntil] = useState(0);
  const [activeTab, setActiveTab] = useState('chat');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isPublishingFeed, setIsPublishingFeed] = useState(false);
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState(() => readCustomTemplates(user?.username || 'guest'));
  
  const [replyTo, setReplyTo] = useState(null);
  const [selectedMessageId, setSelectedMessageId] = useState('');
  const [selectedMessageMenuPlacement, setSelectedMessageMenuPlacement] = useState('above');
  const [selectedMessageMenuStyle, setSelectedMessageMenuStyle] = useState({});
  const [messageReactionExpanded, setMessageReactionExpanded] = useState(false);
  const [selectedFeedPostId, setSelectedFeedPostId] = useState('');
  const [feedReactionExpanded, setFeedReactionExpanded] = useState(false);
  const [openFeedMenuId, setOpenFeedMenuId] = useState('');
  const [feedSearch, setFeedSearch] = useState('');
  const [feedFilter, setFeedFilter] = useState('all');
  const [feedCategory, setFeedCategory] = useState(() => readSavedFeedDraft(user?.username || 'guest').category);
  const [editingFeedPostId, setEditingFeedPostId] = useState('');
  const [editingFeedText, setEditingFeedText] = useState('');
  const [hiddenFeedPostIds, setHiddenFeedPostIds] = useState(() => readHiddenFeedPosts(user?.username || 'guest'));
  const commentSort = 'old';
  const [expandedCommentPosts, setExpandedCommentPosts] = useState({});
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [viewerTouchStart, setViewerTouchStart] = useState(null);
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
  const [feedDraft, setFeedDraft] = useState(() => readSavedFeedDraft(user?.username || 'guest').text);
  const [feedAttachments, setFeedAttachments] = useState([]);
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
    setChatDrafts(readChatDrafts(username));
    setChatLocalSettings(readChatLocalSettings(username));
    setPendingMessages(readPendingMessages(username));
    setFeedReadAt(readFeedReadAt(username));
    const savedFeedDraft = readSavedFeedDraft(username);
    setFeedDraft(savedFeedDraft.text);
    setFeedCategory(savedFeedDraft.category);
    setHiddenFeedPostIds(readHiddenFeedPosts(username));
    setCustomTemplates(readCustomTemplates(username));
  }, [user?.username]);

  useEffect(() => {
    saveFeedDraft(user?.username || 'guest', { text: feedDraft, category: feedCategory });
  }, [feedCategory, feedDraft, user?.username]);

  useEffect(() => {
    if (!openFeedMenuId || typeof document === 'undefined') return undefined;

    const closeFeedMenuOnOutsideClick = (event) => {
      const target = event.target;
      if (target?.closest?.('.feed-post-menu, .feed-post-menu-button')) return;
      setOpenFeedMenuId('');
    };

    document.addEventListener('mousedown', closeFeedMenuOnOutsideClick);
    document.addEventListener('touchstart', closeFeedMenuOnOutsideClick);
    return () => {
      document.removeEventListener('mousedown', closeFeedMenuOnOutsideClick);
      document.removeEventListener('touchstart', closeFeedMenuOnOutsideClick);
    };
  }, [openFeedMenuId]);

  useEffect(() => {
    if (!selectedFeedPostId || typeof document === 'undefined') return undefined;

    const closeFeedReactionsOnOutsideClick = (event) => {
      const target = event.target;
      if (target?.closest?.('.employee-feed-post, .feed-selected-menu')) return;
      setSelectedFeedPostId('');
      setFeedReactionExpanded(false);
    };

    document.addEventListener('mousedown', closeFeedReactionsOnOutsideClick);
    document.addEventListener('touchstart', closeFeedReactionsOnOutsideClick);
    return () => {
      document.removeEventListener('mousedown', closeFeedReactionsOnOutsideClick);
      document.removeEventListener('touchstart', closeFeedReactionsOnOutsideClick);
    };
  }, [selectedFeedPostId]);

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
    const initialLoad = !silent && feedPosts.length === 0;
    if (initialLoad) setFeedLoading(true);
    else if (!silent) setFeedRefreshing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить ленту');
      const nextPosts = getVisibleFeedPosts(data?.posts);
      setFeedPosts((current) => (getFeedPostsSignature(current) === getFeedPostsSignature(nextPosts) ? current : nextPosts));
      setFeedError('');
    } catch (error) {
      const message = isNetworkFailure(error) ? getFriendlyNetworkMessage('Лента временно недоступна') : (error.message || 'Не удалось загрузить ленту');
      console.error('Ошибка загрузки ленты:', error);
      if (!silent && feedPosts.length === 0) {
        setFeedError(message);
        notify(message, 'Лента');
        return;
      }
    } finally {
      if (initialLoad) setFeedLoading(false);
      if (!silent) setFeedRefreshing(false);
    }
  }, [feedPosts.length, notify]);

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
      if (!silent) {
        setApplicationsError(message);
        notify(message, 'Заявки');
      }
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
    }, { attempts: 1, fallbackMessage: 'Не удалось сохранить сообщение' });

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
    if (activeTab !== 'feed') return;
    fetchFeed({ silent: false });
  }, [activeTab, fetchFeed]);

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
      const conversationId = getConversationId(user.username, item.email);
      const messages = threads[conversationId] || [];
      const lastReadAt = readState[conversationId] ? new Date(readState[conversationId]).getTime() : 0;
      const unread = messages.filter((message) => message.sender !== user.username && new Date(message.createdAt).getTime() > lastReadAt).length;
      const profile = item.profile || {};
      if (contactFilter === 'online' && !item.isOnline) return false;
      if (contactFilter === 'unread' && unread === 0) return false;
      if (contactFilter === 'managers' && !['manager', 'admin'].includes((item.role || '').toLowerCase())) return false;
      if (contactFilter === 'department' && profile.department && profile.department !== profileForm.department) return false;
      if (contactFilter === 'favorites' && !(chatLocalSettings.favorites || []).includes(item.email)) return false;
      if (contactFilter === 'attachments' && !messages.some(hasMessageAttachments)) return false;
      if (contactFilter === 'tickets' && !myApplications.some((ticket) => ticket.chat_thread_id === conversationId)) return false;
      if (contactFilter === 'recent' && messages.length === 0) return false;
      if (!normalizedSearch) return true;
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
    }).sort((a, b) => {
      const aConversationId = getConversationId(user.username, a.email);
      const bConversationId = getConversationId(user.username, b.email);
      const aPinned = (chatLocalSettings.pinned || []).includes(aConversationId);
      const bPinned = (chatLocalSettings.pinned || []).includes(bConversationId);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aLastReadAt = readState[aConversationId] ? new Date(readState[aConversationId]).getTime() : 0;
      const bLastReadAt = readState[bConversationId] ? new Date(readState[bConversationId]).getTime() : 0;
      const aUnread = (threads[aConversationId] || []).filter((message) => message.sender !== user.username && new Date(message.createdAt).getTime() > aLastReadAt).length;
      const bUnread = (threads[bConversationId] || []).filter((message) => message.sender !== user.username && new Date(message.createdAt).getTime() > bLastReadAt).length;
      if (aUnread !== bUnread) return bUnread - aUnread;
      const aLast = getThreadActivityMeta(threads[aConversationId] || []).lastTimestamp || 0;
      const bLast = getThreadActivityMeta(threads[bConversationId] || []).lastTimestamp || 0;
      if (aLast !== bLast) return bLast - aLast;
      return a.email.localeCompare(b.email);
    });
  }, [chatCandidates, search, contactFilter, readState, threads, user.username, chatLocalSettings.favorites, chatLocalSettings.pinned, myApplications, profileForm.department]);

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
    const saved = chatDrafts[currentConversationId] || {};
    setDraft(saved.text || '');
    setAttachmentDrafts(Array.isArray(saved.attachments) ? saved.attachments : []);
  }, [currentConversationId]);

  useEffect(() => {
    if (!currentConversationId) return;
    const next = { ...chatDrafts, [currentConversationId]: { text: draft, attachments: attachmentDrafts } };
    setChatDrafts(next);
    saveChatDrafts(user?.username || 'guest', next);
  }, [attachmentDrafts, draft]);

  useEffect(() => {
    savePendingMessages(user?.username || 'guest', pendingMessages);
  }, [pendingMessages, user?.username]);

  useEffect(() => {
    const textarea = messageTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  const queuePendingMessage = (conversationId, message) => {
    setPendingMessages((prev) => {
      if (prev.some((item) => item.message?.id === message.id)) return prev;
      return [...prev, { conversationId, message: { ...message, deliveryStatus: 'waiting' } }];
    });
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (isSendingMessage || (!draft.trim() && attachmentDrafts.length === 0) || !currentConversationId) return;
    setIsSendingMessage(true);
    if (attachmentDrafts.length > 1) {
      const confirmed = await confirmAction(`Отправить ${attachmentDrafts.length} файлов одним сообщением?`, 'Подтверждение отправки');
      if (!confirmed) {
        setIsSendingMessage(false);
        return;
      }
    }

    const newMessage = {
      id: createMessageId(),
      sender: user.username,
      text: draft.trim() || (attachmentDrafts.length ? '📎 Вложения' : ''),
      createdAt: new Date().toISOString(),
      editedAt: null,
      reactions: {},
      pinned: false,
      deliveryStatus: isOnline ? 'sending' : 'waiting',
      readAt: null,
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
      if (!isOnline) {
        queuePendingMessage(currentConversationId, newMessage);
        notify('Нет соединения. Сообщение ожидает отправки.', 'Офлайн');
        return;
      }
      await persistNewMessage(currentConversationId, { ...newMessage, deliveryStatus: 'sent' });
      setThreads((prev) => ({
        ...prev,
        [currentConversationId]: (prev[currentConversationId] || []).map((item) => (item.id === newMessage.id ? { ...item, deliveryStatus: 'sent' } : item))
      }));
    } catch (error) {
      const isNetworkError = isNetworkFailure(error);
      if (isNetworkError) {
        queuePendingMessage(currentConversationId, newMessage);
        setThreads((prev) => ({
          ...prev,
          [currentConversationId]: (prev[currentConversationId] || []).map((item) => (item.id === newMessage.id ? { ...item, deliveryStatus: 'waiting' } : item))
        }));
        notify('Нет соединения. Сообщение отправится автоматически.', 'Офлайн');
        return;
      }
      setThreads((prev) => ({ ...prev, [currentConversationId]: currentMessages }));
      suppressThreadsRefreshUntilRef.current = Date.now();
      notify(error.message || 'Не удалось отправить сообщение', 'Сообщение');
    } finally {
      setIsSendingMessage(false);
    }
  };


  const uploadAttachmentFile = async (file, scope = 'chat') => {
    const dataUrl = await readFileAsDataUrl(file);
    const thumbnailDataUrl = await createAttachmentThumbnailDataUrl(file);
    const response = await fetch(`${API_BASE_URL}/chat/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl,
        thumbnailDataUrl
      })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Не удалось загрузить файл');
    }
    const data = await response.json();
    return data.file;
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
      const preparedFiles = await Promise.all(files.map((file) => uploadAttachmentFile(file, 'chat')));
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

  const handleComposerPaste = async (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length > 0) {
      event.preventDefault();
      await addAttachmentFiles(files);
      notify(files.some((file) => String(file.type || '').startsWith('image/')) ? 'Скриншот прикреплён' : 'Файл прикреплён', 'Вложения');
    }
  };

  const handleComposerKeyDown = (event) => {
    const enterToSend = chatLocalSettings.enterToSend !== false;
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!enterToSend) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const jumpToMessageDate = (dateValue) => {
    if (!dateValue) return;
    const target = currentMessages.find((message) => {
      const messageDate = new Date(message.createdAt);
      if (Number.isNaN(messageDate.getTime())) return false;
      return messageDate.toISOString().slice(0, 10) === dateValue;
    });
    if (target) document.querySelector(`[data-message-id="${target.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else notify('В этот день сообщений нет', 'Календарь');
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


  const removeAttachmentDraft = (attachmentId) => {
    setAttachmentDrafts((prev) => prev.filter((file, index) => (file.id || `${file.name}-${index}`) !== attachmentId));
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

  const openEmployeeProfile = (login, event) => {
    event?.stopPropagation?.();
    const normalizedLogin = formatFeedLogin(login);
    if (!normalizedLogin) return;
    setActiveTab('profile');
    openProfileCard(normalizedLogin);
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!requestText.trim()) {
      setRequestStatus({ state: 'error', text: 'Заполните описание заявки.', ticketId: '' });
      return;
    }
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
    const employeeComment = await promptAction('Если хотите, оставьте комментарий к закрытию заявки. Можно оставить пустым.', '', 'Комментарий к закрытию');
    if (employeeComment === '') {
      const confirmed = await confirmAction('Закрыть заявку без комментария?', 'Заявка выполнена');
      if (!confirmed) return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/applications/${applicationId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: user?.username || 'employee', employee_comment: String(employeeComment || '').trim() })
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


  const updateChatLocalSettings = (updater) => {
    setChatLocalSettings((prev) => {
      const next = updater(prev);
      saveChatLocalSettings(user?.username || 'guest', next);
      return next;
    });
  };

  const toggleLocalListValue = (key, value) => {
    updateChatLocalSettings((prev) => {
      const current = new Set(prev[key] || []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      return { ...prev, [key]: [...current] };
    });
  };

  const updateChatUiSetting = (key, value) => {
    updateChatLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleDialogToolSetting = (key) => {
    updateChatLocalSettings((prev) => {
      const enabled = prev[key] === true;
      if (key === 'showDialogMediaPanel' && enabled) setMediaPanelOpen(false);
      return { ...prev, [key]: !enabled };
    });
  };

  const toggleFeedToolSetting = (key) => {
    updateChatLocalSettings((prev) => {
      const enabled = prev[key] === true;
      if (key === 'showFeedFilters' && enabled) setFeedFilter('all');
      return { ...prev, [key]: !enabled };
    });
  };

  const clearCurrentDraft = () => {
    if (!currentConversationId) return;
    setDraft('');
    setAttachmentDrafts([]);
    const next = { ...chatDrafts };
    delete next[currentConversationId];
    setChatDrafts(next);
    saveChatDrafts(user?.username || 'guest', next);
  };

  const getConversationMediaItems = (scope = 'message', sourceMessage = null) => {
    const sourceMessages = scope === 'dialog' ? currentMessages : sourceMessage ? [sourceMessage] : [];
    return sourceMessages.flatMap((message) => getMessageMediaAttachments(message).map((file, index) => ({ file, message, fileIndex: index })));
  };

  const retryMessageSend = async (message) => {
    if (!currentConversationId || !message?.id) return;
    setThreads((prev) => ({ ...prev, [currentConversationId]: (prev[currentConversationId] || []).map((item) => (item.id === message.id ? { ...item, deliveryStatus: 'sending' } : item)) }));
    try {
      await persistNewMessage(currentConversationId, { ...message, deliveryStatus: 'sent' });
      setThreads((prev) => ({ ...prev, [currentConversationId]: (prev[currentConversationId] || []).map((item) => (item.id === message.id ? { ...item, deliveryStatus: 'sent' } : item)) }));
    } catch (error) {
      setThreads((prev) => ({ ...prev, [currentConversationId]: (prev[currentConversationId] || []).map((item) => (item.id === message.id ? { ...item, deliveryStatus: isNetworkFailure(error) ? 'waiting' : 'error' } : item)) }));
      if (!isNetworkFailure(error)) notify(error.message || 'Не удалось отправить сообщение', 'Сообщение');
    }
  };

  useEffect(() => {
    if (!isOnline || pendingMessages.length === 0) return undefined;
    let cancelled = false;
    const flushPendingMessages = async () => {
      const remaining = [];
      for (const item of pendingMessages) {
        try {
          await persistNewMessage(item.conversationId, { ...item.message, deliveryStatus: 'sent' });
          if (cancelled) return;
          setThreads((prev) => ({
            ...prev,
            [item.conversationId]: (prev[item.conversationId] || []).map((message) => (
              message.id === item.message.id ? { ...message, deliveryStatus: 'sent' } : message
            ))
          }));
        } catch (error) {
          if (isNetworkFailure(error)) remaining.push(item);
          else {
            setThreads((prev) => ({
              ...prev,
              [item.conversationId]: (prev[item.conversationId] || []).map((message) => (
                message.id === item.message.id ? { ...message, deliveryStatus: 'error' } : message
              ))
            }));
          }
        }
      }
      if (!cancelled) setPendingMessages(remaining);
    };
    flushPendingMessages();
    return () => {
      cancelled = true;
    };
  }, [isOnline, pendingMessages, persistNewMessage]);

  const startInlineEditMessage = (message) => {
    setInlineEditMessageId(message.id);
    setInlineEditText(message.text || '');
    setSelectedMessageId('');
  };

  const saveInlineEditMessage = async (message) => {
    if (!inlineEditText.trim() && getMessageAttachments(message).length === 0) {
      notify('Нельзя сохранить пустое сообщение без вложений', 'Сообщение');
      return;
    }
    try {
      await updateMessage(message.id, (item) => ({
        ...item,
        text: inlineEditText.trim(),
        editedAt: new Date().toISOString(),
        editedBy: user.username,
        audit: [...(item.audit || []), { action: 'edit', by: user.username, at: new Date().toISOString(), previousText: item.text, nextText: inlineEditText.trim() }]
      }));
      setInlineEditMessageId('');
      setInlineEditText('');
    } catch (error) {
      notify(error.message || 'Не удалось изменить сообщение', 'Сообщение');
    }
  };

  const createRequestFromMessage = (message) => {
    setRequestText(`${message.text || 'Сообщение с вложением'}\n\nИсточник: ${message.sender}, ${new Date(message.createdAt).toLocaleString('ru-RU')}`);
    setReplyTo(message);
    setSelectedMessageId('');
    setActiveTab('request');
  };


  const getMessageMenuPlacement = (event) => {
    const rowElement = event?.currentTarget?.closest?.('.message-row') || event?.target?.closest?.('.message-row');
    const wrapElement = messagesWrapRef.current;
    if (!rowElement || !wrapElement) return 'above';
    const rowRect = rowElement.getBoundingClientRect();
    const wrapRect = wrapElement.getBoundingClientRect();
    const spaceBelow = wrapRect.bottom - rowRect.bottom;
    const estimatedMenuHeight = 320;
    return spaceBelow >= estimatedMenuHeight ? 'below' : 'above';
  };

  const getMessageMenuStyle = (event, placement) => {
    const rowElement = event?.currentTarget?.closest?.('.message-row') || event?.target?.closest?.('.message-row');
    const bubbleElement = rowElement?.querySelector?.('.message-bubble') || rowElement;
    const wrapElement = messagesWrapRef.current;
    if (!bubbleElement || !wrapElement) return {};
    const bubbleRect = bubbleElement.getBoundingClientRect();
    const wrapRect = wrapElement.getBoundingClientRect();
    const menuWidth = 300;
    const menuHeight = 340;
    const edgeGap = 10;
    const rawTop = placement === 'below' ? bubbleRect.bottom + 8 : bubbleRect.top - menuHeight - 8;
    const minTop = wrapRect.top + edgeGap;
    const maxTop = Math.max(minTop, wrapRect.bottom - menuHeight - edgeGap);
    const top = Math.min(Math.max(rawTop, minTop), maxTop);
    const rawLeft = rowElement?.classList?.contains('mine') ? bubbleRect.right - menuWidth : bubbleRect.left;
    const minLeft = wrapRect.left + edgeGap;
    const maxLeft = Math.max(minLeft, wrapRect.right - menuWidth - edgeGap);
    const left = Math.min(Math.max(rawLeft, minLeft), maxLeft);
    return { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` };
  };

  const openSelectedMessageMenu = (messageId, event) => {
    const placement = getMessageMenuPlacement(event);
    setSelectedMessageMenuPlacement(placement);
    setSelectedMessageMenuStyle(getMessageMenuStyle(event, placement));
    setSelectedMessageId(messageId);
    setMessageReactionExpanded(false);
  };

  const toggleSelectedMessage = (messageId) => {
    setSelectedMessageIds((prev) => (prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]));
  };

  const getSelectedMessages = () => currentMessages.filter((message) => selectedMessageIds.includes(message.id));

  const clearSelectedMessages = () => {
    setSelectedMessageIds([]);
    setMultiSelectMode(false);
  };

  const copySelectedMessages = async () => {
    const text = getSelectedMessages().map((message) => `${message.sender}: ${message.text || '[вложение]'}`).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      notify('Выбранные сообщения скопированы', 'Копирование');
    } catch {
      notify('Не удалось скопировать выбранные сообщения', 'Копирование');
    }
  };

  const deleteSelectedMessages = async () => {
    const confirmed = await confirmAction(`Удалить выбранные сообщения: ${selectedMessageIds.length}?`, 'Удаление сообщений');
    if (!confirmed) return;
    await Promise.all(getSelectedMessages().map((message) => deleteMessage(message.id)));
    clearSelectedMessages();
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
      const isNetworkError = isNetworkFailure(error);
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
    if (!getOriginalAttachmentUrl(file)) return;
    setMediaViewer({ message, file, fileIndex, scope: 'message' });
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

  const shareViewedFeedMedia = () => {
    if (mediaViewer?.source !== 'feed' || !mediaViewer?.file) return;
    const sourcePost = mediaViewer.post || {};
    openForwardMessagePicker({
      id: sourcePost.id || createMessageId(),
      sender: sourcePost.authorName || sourcePost.author || 'Лента',
      text: sourcePost.text || 'Вложение из ленты',
      attachment: mediaViewer.file,
      attachments: [mediaViewer.file],
      createdAt: sourcePost.createdAt || new Date().toISOString(),
      reactions: {},
      pinned: false
    });
    setMediaViewer(null);
  };



  const getViewerFiles = () => {
    if (!mediaViewer) return [];
    if (mediaViewer.source === 'feed') return getFeedAttachments(mediaViewer.post).filter(isMediaAttachment);
    if (mediaViewer.message && mediaViewer.scope === 'dialog') return getConversationMediaItems('dialog').map((item) => item.file);
    if (mediaViewer.message) return getMessageMediaAttachments(mediaViewer.message);
    return [mediaViewer.file].filter(Boolean);
  };

  const moveMediaViewer = useCallback((direction) => {
    setMediaViewer((current) => {
      if (!current) return current;
      const items = current.message && current.scope === 'dialog' ? getConversationMediaItems('dialog') : [];
      const files = current.source === 'feed'
        ? getFeedAttachments(current.post).filter(isMediaAttachment)
        : current.message ? (current.scope === 'dialog' ? items.map((item) => item.file) : getMessageMediaAttachments(current.message)) : [current.file].filter(Boolean);
      if (files.length < 2) return current;
      const currentIndex = Math.max(0, Math.min(files.length - 1, current.fileIndex || 0));
      const nextIndex = (currentIndex + direction + files.length) % files.length;
      return { ...current, file: files[nextIndex], fileIndex: nextIndex };
    });
  }, []);

  useEffect(() => {
    if (!mediaViewer) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMediaViewer(null);
      if (event.key === 'ArrowLeft') moveMediaViewer(-1);
      if (event.key === 'ArrowRight') moveMediaViewer(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mediaViewer, moveMediaViewer]);

  const deleteChatAttachment = async (messageId, fileIndex = 0, targetConversationId = currentConversationId) => {
    if (!messageId || !targetConversationId) return;
    const confirmed = await confirmAction('Удалить только это вложение?', 'Удаление вложения');
    if (!confirmed) return;

    await updateMessage(messageId, (item) => {
      const currentAttachments = item.attachments?.length ? item.attachments : item.attachment ? [item.attachment] : [];
      const nextAttachments = currentAttachments.filter((_, index) => index !== fileIndex);
      const hasText = String(item.text || '').trim() && item.text !== '📎 Вложения';
      const auditEntry = {
        action: 'delete_attachment',
        by: user.username,
        at: new Date().toISOString(),
        fileName: currentAttachments[fileIndex]?.name || ''
      };

      if (!nextAttachments.length && !hasText) {
        return {
          ...item,
          text: '',
          attachment: null,
          attachments: [],
          deletedAt: new Date().toISOString(),
          deletedBy: user.username,
          audit: [...(item.audit || []), auditEntry]
        };
      }

      return {
        ...item,
        text: hasText ? item.text : '📎 Вложения',
        attachment: nextAttachments[0] || null,
        attachments: nextAttachments,
        audit: [...(item.audit || []), auditEntry]
      };
    }, targetConversationId);
  };

  const deleteViewedMedia = async () => {
    if (mediaViewer?.source === 'feed') {
      const { post, fileIndex = 0 } = mediaViewer;
      if (!post?.id) return;
      const currentAttachments = getFeedAttachments(post);
      const targetFile = currentAttachments[fileIndex] || {};
      const nextAttachments = currentAttachments.filter((_, index) => index !== fileIndex);
      const fileLabel = targetFile.name || (isVideoAttachment(targetFile) ? 'видео' : 'фото');
      const postHasText = Boolean(String(post.text || '').trim());
      let confirmed = await confirmAction(`Удалить ${isVideoAttachment(targetFile) ? 'видео' : 'фото'} ${fileLabel} из публикации?`, 'Удаление вложения');
      if (!confirmed) return;
      if (!nextAttachments.length && !postHasText) {
        confirmed = await confirmAction('Это последнее вложение. Удалить всю публикацию?', 'Удаление публикации');
        if (!confirmed) return;
        setMediaViewer(null);
        await deleteFeedPost(post.id, { skipConfirm: true });
        return;
      }
      const previousPosts = feedPosts;
      setMediaViewer(null);
      setFeedPosts((current) => current.map((item) => (
        item.id === post.id
          ? { ...item, attachment: nextAttachments[0] || null, attachments: nextAttachments, updatedAt: new Date().toISOString() }
          : item
      )));
      try {
        await patchFeedPost(post.id, { attachment: nextAttachments[0] || null, attachments: nextAttachments, editedAt: new Date().toISOString() });
        notify(`${isVideoAttachment(targetFile) ? 'Видео' : 'Фото'} удалено`, 'Лента');
      } catch (error) {
        if (isNetworkFailure(error)) {
          fetchFeed({ silent: true });
          return;
        }
        setFeedPosts(previousPosts);
        notify(error.message || 'Не удалось удалить вложение', 'Лента');
      }
      return;
    }
    if (!mediaViewer?.message?.id) return;
    const { message, fileIndex = 0 } = mediaViewer;
    setMediaViewer(null);
    try {
      await deleteChatAttachment(message.id, fileIndex);
    } catch (error) {
      notify(error.message || 'Не удалось удалить вложение', 'Вложение');
    }
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
      deliveryStatus: 'sending',
      readAt: null,
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
      const isNetworkError = isNetworkFailure(error);
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
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const notDeletedMessages = currentMessages.filter((message) => !message.deletedAt);
    return notDeletedMessages.filter((message) => {
      const attachments = getMessageAttachments(message);
      if (normalizedDialogSearch && ![
        message.text,
        message.sender,
        message.attachment?.name,
        ...attachments.map((item) => item.name)
      ].some((value) => normalizeText(value).includes(normalizedDialogSearch))) return false;
      const timestamp = new Date(message.createdAt || 0).getTime();
      if (dialogFilter === 'mine') return message.sender === user.username;
      if (dialogFilter === 'peer') return message.sender !== user.username;
      if (dialogFilter === 'files') return attachments.length > 0;
      if (dialogFilter === 'photo') return attachments.some(isImageAttachment);
      if (dialogFilter === 'today') return now - timestamp <= day;
      if (dialogFilter === 'week') return now - timestamp <= 7 * day;
      if (dialogFilter === 'month') return now - timestamp <= 31 * day;
      return true;
    });
  }, [currentMessages, dialogFilter, normalizedDialogSearch, user.username]);
  const dialogSearchResults = useMemo(() => (
    normalizedDialogSearch ? visibleMessages.filter((message) => normalizeText(`${message.text || ''} ${message.sender || ''} ${getMessageAttachments(message).map((file) => file.name).join(' ')}`).includes(normalizedDialogSearch)) : []
  ), [normalizedDialogSearch, visibleMessages]);
  const activeDialogSearchResult = dialogSearchResults[dialogSearchIndex] || null;
  const highlightText = (text = '') => {
    if (!normalizedDialogSearch) return text;
    const source = String(text || '');
    const lower = source.toLowerCase();
    const needle = normalizedDialogSearch.toLowerCase();
    const index = lower.indexOf(needle);
    if (index < 0) return source;
    return <>{source.slice(0, index)}<mark>{source.slice(index, index + needle.length)}</mark>{source.slice(index + needle.length)}</>;
  };
  const dialogMediaItems = useMemo(() => currentMessages.flatMap((message) => [
    ...getMessageAttachments(message).map((file, index) => ({ message, file, fileIndex: index, type: isMediaAttachment(file) ? 'media' : 'file' })),
    ...extractLinks(message.text).map((link, index) => ({ message, file: { id: `${message.id}-link-${index}`, name: link, dataUrl: link, type: 'text/link' }, fileIndex: index, type: 'link' }))
  ]), [currentMessages]);
  const filteredDialogMediaItems = useMemo(() => dialogMediaItems.filter(({ message, file, type }) => {
    const query = normalizeText(mediaPanelSearch);
    if (query && !normalizeText(`${file.name || ''} ${message.text || ''}`).includes(query)) return false;
    if (mediaPanelTab === 'media') return type === 'media';
    if (mediaPanelTab === 'files') return type === 'file';
    if (mediaPanelTab === 'links') return type === 'link';
    return true;
  }), [dialogMediaItems, mediaPanelSearch, mediaPanelTab]);

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


  const visibleFeedPosts = useMemo(() => {
    const query = feedSearch.trim().toLowerCase();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    return getVisibleFeedPosts(feedPosts)
      .filter((post) => !hiddenFeedPostIds.includes(post.id))
      .filter((post) => {
        const attachments = getFeedAttachments(post);
        const text = [post.text, post.authorName, post.author, post.category, ...attachments.map((file) => file.name)].filter(Boolean).join(' ').toLowerCase();
        if (query && !text.includes(query)) return false;
        const timestamp = getFeedItemTimestamp(post);
        if (feedFilter === 'mine') return isPostAuthor(post, user);
        if (feedFilter === 'photo') return attachments.some(isImageAttachment);
        if (feedFilter === 'video') return attachments.some(isVideoAttachment);
        if (feedFilter === 'pinned') return Boolean(post.pinned);
        if (feedFilter === 'unread') return post.author !== user?.username && timestamp > feedReadTimestamp;
        if (feedFilter === 'today') return now - timestamp <= day;
        if (feedFilter === 'week') return now - timestamp <= 7 * day;
        if (feedFilter === 'month') return now - timestamp <= 31 * day;
        return true;
      })
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || getFeedItemTimestamp(b) - getFeedItemTimestamp(a));
  }, [feedFilter, feedPosts, feedReadTimestamp, feedSearch, hiddenFeedPostIds, user]);

  const pinnedFeedPosts = useMemo(() => visibleFeedPosts.filter((post) => post.pinned), [visibleFeedPosts]);
  const regularFeedPosts = useMemo(() => visibleFeedPosts.filter((post) => !post.pinned), [visibleFeedPosts]);

  const sortComments = (comments = []) => {
    const visible = comments.filter((comment) => !comment.deletedAt);
    if (commentSort === 'new') return [...visible].sort((a, b) => getFeedItemTimestamp(b) - getFeedItemTimestamp(a));
    if (commentSort === 'popular') return [...visible].sort((a, b) => Object.values(b.reactions || {}).flat().length - Object.values(a.reactions || {}).flat().length);
    return visible;
  };

  const getEmployeeAvatar = useCallback((login = '', ...candidates) => {
    const normalizedLogin = formatFeedLogin(login);
    const directAvatar = candidates.find((value) => typeof value === 'string' && value.trim());
    if (directAvatar) return directAvatar;

    if (sameLogin(normalizedLogin, user?.username || '')) return avatarUrl || '';

    const cachedProfile = normalizedLogin ? readProfileDraft(normalizedLogin) : {};
    if (cachedProfile.avatar) return cachedProfile.avatar;

    const directoryProfile = directoryEmployees.find((employee) => sameLogin(employee.login, normalizedLogin)) || {};
    return directoryProfile.avatar || directoryProfile.photo || directoryProfile.photo_url || '';
  }, [avatarUrl, directoryEmployees, user?.username]);

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
    if (isPublishingFeed || (!feedDraft.trim() && feedAttachments.length === 0)) return;
    setIsPublishingFeed(true);
    if (feedAttachments.length > 1) {
      const confirmed = await confirmAction(`Опубликовать ${feedAttachments.length} файлов одной записью?`, 'Подтверждение публикации');
      if (!confirmed) {
        setIsPublishingFeed(false);
        return;
      }
    }

    const previousDraft = feedDraft;
    const previousAttachments = feedAttachments;
    const optimisticPost = {
      id: createMessageId(),
      author: user?.username || 'employee',
      authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
      text: previousDraft.trim(),
      attachment: previousAttachments[0] || null,
      attachments: previousAttachments,
      category: feedCategory,
      reactions: {},
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deliveryStatus: 'sending'
    };

    setFeedPosts((current) => [optimisticPost, ...current.filter((post) => post.id !== optimisticPost.id)]);
    setFeedDraft('');
    setFeedAttachments([]);
    clearSavedFeedDraft(user?.username || 'guest');

    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(optimisticPost)
      }, { attempts: 2, fallbackMessage: 'Не удалось опубликовать запись' });

      const serverPosts = Array.isArray(data?.posts) ? getVisibleFeedPosts(data.posts) : null;
      const serverPost = data?.post ? { ...data.post, deliveryStatus: 'sent' } : null;
      setFeedPosts((current) => {
        const nextPosts = serverPosts || current.map((post) => (post.id === optimisticPost.id ? (serverPost || { ...post, deliveryStatus: 'sent' }) : post));
        return getFeedPostsSignature(current) === getFeedPostsSignature(nextPosts) ? current : nextPosts;
      });
      window.requestAnimationFrame(() => {
        feedListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } catch (error) {
      if (isNetworkFailure(error)) {
        setFeedPosts((current) => current.map((post) => (
          post.id === optimisticPost.id ? { ...post, deliveryStatus: 'waiting' } : post
        )));
        fetchFeed({ silent: true });
        return;
      }
      setFeedPosts((current) => current.filter((post) => post.id !== optimisticPost.id));
      setFeedDraft(previousDraft);
      setFeedAttachments(previousAttachments);
      notify(error.message || 'Не удалось опубликовать запись', 'Лента');
    } finally {
      setIsPublishingFeed(false);
    }
  };

  const onFeedFileChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (tooLarge) {
      notify(`Файл ${tooLarge.name} слишком большой. Максимум ${MAX_ATTACHMENT_SIZE_MB} МБ.`, 'Вложения');
      return;
    }
    try {
      const preparedFiles = await Promise.all(files.map((file) => uploadAttachmentFile(file, 'feed')));
      setFeedAttachments((prev) => [...prev, ...preparedFiles]);
    } catch {
      notify('Не удалось прикрепить файл.', 'Вложения');
    }
  };

  const removeFeedAttachment = (attachmentId) => {
    setFeedAttachments((prev) => prev.filter((file, index) => (file.id || `${file.name}-${index}`) !== attachmentId));
  };

  const openFeedMediaViewer = (post, file, fileIndex) => {
    if (!getAttachmentUrl(file)) return;
    setMediaViewer({ source: 'feed', post, file, fileIndex });
    setSelectedFeedPostId('');
    setFeedReactionExpanded(false);
  };

  const patchFeedPost = async (postId, patch) => {
    const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }, { fallbackMessage: 'Не удалось обновить публикацию' });
    setFeedPosts(getVisibleFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts.map((post) => (post.id === postId ? { ...post, ...data.post } : post))));
    return data.post;
  };

  const addCommentToPost = async (postId) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;

    const optimisticComment = {
      id: createMessageId(),
      author: user?.username || 'employee',
      authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
      text,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const previousPosts = feedPosts;

    setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
    setFeedPosts((current) => current.map((post) => (
      post.id === postId
        ? { ...post, comments: [...(post.comments || []), optimisticComment], updatedAt: optimisticComment.updatedAt }
        : post
    )));

    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: optimisticComment.id,
          author: optimisticComment.author,
          authorName: optimisticComment.authorName,
          text
        })
      }, { attempts: 1, fallbackMessage: 'Не удалось добавить комментарий' });
      setFeedPosts(getVisibleFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts.map((post) => (
        post.id === postId
          ? { ...post, comments: [...(post.comments || []), data.comment || optimisticComment].filter(Boolean), updatedAt: new Date().toISOString() }
          : post
      ))));
    } catch (error) {
      if (isNetworkFailure(error)) {
        fetchFeed({ silent: true });
        return;
      }
      setFeedPosts(previousPosts);
      setCommentDrafts((prev) => ({ ...prev, [postId]: text }));
      notify(error.message || 'Не удалось добавить комментарий', 'Лента');
    }
  };

  const startEditFeedPost = (post) => {
    setEditingFeedPostId(post.id);
    setEditingFeedText(post.text || '');
    setOpenFeedMenuId('');
  };

  const saveFeedPostEdit = async (postId) => {
    const text = editingFeedText.trim();
    const previousPosts = feedPosts;
    setFeedPosts((current) => current.map((post) => (post.id === postId ? { ...post, text, editedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : post)));
    setEditingFeedPostId('');
    try {
      await patchFeedPost(postId, { text, editedAt: new Date().toISOString() });
      notify('Публикация изменена', 'Лента');
    } catch (error) {
      setFeedPosts(previousPosts);
      notify(error.message || 'Не удалось изменить публикацию', 'Лента');
    }
  };

  const hideFeedPost = (postId) => {
    setHiddenFeedPostIds((prev) => {
      const next = [...new Set([...prev, postId])];
      saveHiddenFeedPosts(user?.username || 'guest', next);
      return next;
    });
    setOpenFeedMenuId('');
  };

  const reportFeedPost = (postId) => {
    notify('Жалоба отправлена модератору', 'Лента');
    setOpenFeedMenuId('');
    void postId;
  };

  const copyFeedPostLink = async (postId) => {
    const url = getPostShareUrl(postId);
    try {
      await navigator.clipboard?.writeText(url);
      notify('Ссылка скопирована', 'Лента');
    } catch {
      window.prompt('Скопируйте ссылку на публикацию', url);
    }
    setOpenFeedMenuId('');
  };

  const shareFeedPostToChat = (post) => {
    const attachments = getFeedAttachments(post);
    openForwardMessagePicker({
      id: post.id || createMessageId(),
      sender: post.authorName || post.author || 'Лента',
      text: post.text || 'Публикация из ленты',
      attachment: attachments[0] || null,
      attachments,
      createdAt: post.createdAt || new Date().toISOString(),
      reactions: {},
      pinned: false
    });
    setOpenFeedMenuId('');
  };

  const quoteFeedPost = (post) => {
    setFeedDraft((prev) => `${prev ? `${prev}

` : ''}> ${post.text || 'Публикация из ленты'}
`);
    setOpenFeedMenuId('');
  };


  const deleteFeedPost = async (postId, options = {}) => {
    const post = feedPosts.find((item) => item.id === postId);
    if (!post) return;

    const canDeletePost = canManageFeedPost(post, user, isManager, isAdmin);
    if (!canDeletePost) return;
    if (!options.skipConfirm) {
      const confirmed = await confirmAction('Удалить публикацию из ленты?', 'Лента');
      if (!confirmed) return;
    }

    const previousPosts = feedPosts;
    setFeedPosts((current) => current.filter((item) => item.id !== postId));

    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}?deletedBy=${encodeURIComponent(user?.username || 'employee')}`, { method: 'DELETE' }, { attempts: 4, fallbackMessage: 'Не удалось удалить публикацию' });
      setFeedPosts(getVisibleFeedPosts(Array.isArray(data?.posts) ? data.posts : previousPosts.filter((item) => item.id !== postId)));
    } catch (error) {
      if (isNetworkFailure(error)) {
        fetchFeed({ silent: true });
        return;
      }
      setFeedPosts(previousPosts);
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
      setFeedPosts(getVisibleFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts.map((item) => (
        item.id === postId
          ? {
            ...item,
            comments: (item.comments || []).map((row) => (
              row.id === commentId ? { ...row, deletedAt: data.deletedAt || new Date().toISOString(), deletedBy: data.deletedBy || user?.username } : row
            ))
          }
          : item
      ))));
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
      setFeedPosts(getVisibleFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts));
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
      setFeedPosts(getVisibleFeedPosts(Array.isArray(data?.posts) ? data.posts : feedPosts));
    } catch (error) {
      notify(error.message || 'Не удалось закрепить публикацию', 'Лента');
    }
  };

  return (
    <div
      className={`employee-chat-layout theme-${chatLocalSettings.uiTheme || 'light'} density-${chatLocalSettings.uiDensity || 'regular'} text-${chatLocalSettings.uiTextSize || 'medium'} ${isDraggingFiles ? 'dragging-files' : ''}`}
      onDrop={handleAttachmentDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
    >
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
          <div className="brand-actions"><button type="button" className="icon-btn" onClick={() => { setActiveTab('profile'); setProfileViewLogin(''); }}>Профиль</button></div>
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

          <label className="contact-filter-select"><span>Фильтр</span><select value={contactFilter} onChange={(e) => setContactFilter(e.target.value)}>{CONTACT_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}</select></label><div className={`employee-chat-list ${isManager ? 'manager-mode' : ''}`}>
            {availableEmployees.length === 0 && <div className="empty-mini">Ничего не найдено</div>}
            {availableEmployees.map((employee) => {
              const isOnline = Boolean(employee.isOnline);
              const isManagerContact = ['manager', 'admin'].includes((employee.role || '').toLowerCase()) || employee.email.toLowerCase() === MANAGER_CREDENTIALS.username.toLowerCase();
              const profile = employee.profile || {};
              return (
                <div key={employee.email} className={`employee-chat-user ${selectedEmail === employee.email ? 'active' : ''} ${isManagerContact ? 'manager-priority' : ''} ${(chatLocalSettings.favorites || []).includes(employee.email) ? 'favorite' : ''} ${(chatLocalSettings.pinned || []).includes(getConversationId(user.username, employee.email)) ? 'pinned-dialog' : ''}`}>
                  <button type="button" className="employee-contact-open" onClick={() => setSelectedEmail(employee.email)}>
                    <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
                    <span className="employee-chat-user-main">
                      <span className="employee-chat-user-email">{profile.full_name || employee.email}</span>
                      <span className="employee-chat-user-extra">{employee.email} · {profile.department || 'отдел —'} · каб. {profile.room || '—'}</span>
                    </span>
                    <span className="employee-chat-user-status">{isManagerContact ? 'admin' : (isOnline ? 'online' : 'offline')}</span>
                    {unreadByEmail[employee.email] > 0 && <span className="employee-chat-user-unread">{unreadByEmail[employee.email]}</span>}
                  </button>
                  <span className="contact-card-actions"><button type="button" className="profile-open-btn" onClick={() => { openProfileCard(employee.email); setActiveTab('profile'); }}>Профиль</button><button type="button" className="favorite-contact-btn" aria-label="Закрепить диалог" onClick={() => toggleLocalListValue('pinned', getConversationId(user.username, employee.email))}>{(chatLocalSettings.pinned || []).includes(getConversationId(user.username, employee.email)) ? '📌' : '📍'}</button><button type="button" className="favorite-contact-btn" aria-label="Избранное" onClick={() => toggleLocalListValue('favorites', employee.email)}>{(chatLocalSettings.favorites || []).includes(employee.email) ? '★' : '☆'}</button></span>
                </div>
              );
            })}
          </div>
        </div>

      </aside>

      <section className="employee-chat-main">
        {activeTab === 'chat' && (
          <div
            className="chat-workspace"
            onClick={() => {
              setConversationMenuOpen(false);
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
                    <input value={dialogSearch} onChange={(e) => { setDialogSearch(e.target.value); setDialogSearchIndex(0); }} placeholder="Поиск в диалоге..." />{normalizedDialogSearch && <span className="dialog-search-count">{dialogSearchResults.length ? dialogSearchIndex + 1 : 0} из {dialogSearchResults.length}</span>}<button type="button" disabled={!dialogSearchResults.length} onClick={() => setDialogSearchIndex((prev) => Math.max(0, prev - 1))}>↑</button><button type="button" disabled={!dialogSearchResults.length} onClick={() => setDialogSearchIndex((prev) => Math.min(dialogSearchResults.length - 1, prev + 1))}>↓</button>{chatLocalSettings.showDialogMediaPanel === true && <button type="button" onClick={() => setMediaPanelOpen((prev) => !prev)}>Медиа / Файлы</button>}
                    <details className="conversation-menu" open={conversationMenuOpen} onClick={(event) => event.stopPropagation()}>
                      <summary aria-label="Действия с диалогом" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConversationMenuOpen((prev) => !prev); }}>⋯</summary>
                      <div className="conversation-menu-popover">
                        <button type="button" onClick={() => { toggleLocalListValue('archived', currentConversationId); setConversationMenuOpen(false); }}>Архивировать диалог</button><button type="button" onClick={() => { toggleLocalListValue('hidden', currentConversationId); setConversationMenuOpen(false); }}>Скрыть диалог</button><button type="button" onClick={() => { toggleLocalListValue('pinned', currentConversationId); setConversationMenuOpen(false); }}>Закрепить диалог</button><button type="button" onClick={() => { setReadState((prev) => ({ ...prev, [currentConversationId]: '' })); setConversationMenuOpen(false); }}>Пометить непрочитанным</button><button type="button" onClick={() => { toggleLocalListValue('muted', currentConversationId); setConversationMenuOpen(false); }}>Отключить уведомления</button><button type="button" onClick={() => { clearCurrentDraft(); setConversationMenuOpen(false); }}>Очистить черновик</button><button type="button" className="danger-action" onClick={() => { clearConversation(); setConversationMenuOpen(false); }}>Удалить переписку</button>
                      </div>
                    </details>
                  </div>
                </header>

	                {chatLocalSettings.showDialogFilters === true && <div className="dialog-filter-row">{CHAT_FILTERS.map((filter) => <button key={filter.id} type="button" className={dialogFilter === filter.id ? 'active' : ''} onClick={() => setDialogFilter(filter.id)}>{filter.label}</button>)}</div>}
	                {chatLocalSettings.showDialogDateJump === true && <div className="date-jump-row"><label>Перейти к дате <input type="date" onChange={(event) => jumpToMessageDate(event.target.value)} /></label></div>}
                {chatLocalSettings.showDialogMediaPanel === true && mediaPanelOpen && <div className="dialog-media-panel"><div className="dialog-media-tabs">{CHAT_MEDIA_TABS.map((tab) => <button key={tab.id} type="button" className={mediaPanelTab === tab.id ? 'active' : ''} onClick={() => setMediaPanelTab(tab.id)}>{tab.label}</button>)}</div><input type="search" placeholder="Поиск по имени файла или ссылке..." value={mediaPanelSearch} onChange={(e) => setMediaPanelSearch(e.target.value)} /><button type="button" onClick={() => notify('Скачивание архива будет доступно после серверного zip-метода', 'Медиа')}>Скачать всё архивом</button><div className="dialog-media-grid">{filteredDialogMediaItems.length === 0 && <small>Ничего не найдено</small>}{filteredDialogMediaItems.map(({ message, file, fileIndex, type }, index) => <button key={`${message.id}-${file.name}-${index}`} type="button" onClick={() => type === 'link' ? window.open(file.dataUrl, '_blank', 'noopener,noreferrer') : isMediaAttachment(file) ? setMediaViewer({ message, file, fileIndex, scope: 'dialog' }) : openAttachmentInNewTab(file)}>{type === 'link' ? <span>🔗 {file.name}</span> : isMediaAttachment(file) ? (isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name || 'Медиа'} />) : <span>{getFileIcon(file.type)} {file.name}</span>}<em>{new Date(message.createdAt).toLocaleDateString('ru-RU')}</em></button>)}</div></div>}

                {pinnedMessages.length > 0 && (
                  <div className="pinned-box">
                    <strong>📌 Закреплённые {pinnedMessageIndex + 1} из {pinnedMessages.length}</strong><div className="pinned-controls"><button type="button" onClick={() => setPinnedMessageIndex((prev) => Math.max(0, prev - 1))}>‹</button><button type="button" onClick={() => setPinnedMessageIndex((prev) => Math.min(pinnedMessages.length - 1, prev + 1))}>›</button></div>{pinnedMessages[pinnedMessageIndex] && <button type="button" onClick={() => document.querySelector(`[data-message-id="${pinnedMessages[pinnedMessageIndex].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>• {pinnedMessages[pinnedMessageIndex].text || (getMessageAttachments(pinnedMessages[pinnedMessageIndex]).some(isImageAttachment) ? '📷 Фото' : '📎 Документ')}</button>}
                  </div>
                )}

                {multiSelectMode && <div className="multi-select-toolbar"><strong>Выбрано: {selectedMessageIds.length}</strong><button type="button" onClick={copySelectedMessages}>Копировать</button><button type="button" onClick={() => { const selected = getSelectedMessages(); if (selected[0]) openForwardMessagePicker({ ...selected[0], text: selected.map((msg) => `${msg.sender}: ${msg.text || '[вложение]'}`).join('\n') }); }}>Переслать</button><button type="button" onClick={() => { const selected = getSelectedMessages(); setRequestText(selected.map((msg) => `${msg.sender}: ${msg.text || '[вложение]'}`).join('\n')); setActiveTab('request'); }}>Создать заявку</button><button type="button" onClick={() => notify('Архив вложений будет доступен после серверного zip-метода', 'Вложения')}>Скачать вложения</button><button type="button" className="danger-action" onClick={deleteSelectedMessages}>Удалить</button><button type="button" onClick={clearSelectedMessages}>Отмена</button></div>}
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
                    const isDeleted = Boolean(message.deletedAt);
                    const attachments = !isDeleted && message.attachments?.length ? message.attachments : !isDeleted && message.attachment ? [message.attachment] : [];
                    const hasTextContent = !isDeleted && String(message.text || '').trim() && message.text !== '📎 Вложения';
                    const photoMetaLabel = new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    const statusLabel = isMine ? '✓✓' : '';
                    const photoStatusLabel = isMine ? '✓' : '';
                    const messageTimeLabel = new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    const deliveryLabel = message.deliveryStatus === 'sending' ? 'Отправляется…' : message.deliveryStatus === 'waiting' ? 'Ожидает сети' : message.deliveryStatus === 'error' ? 'Ошибка' : statusLabel;
                    const isPhotoCollage = attachments.length > 1 && attachments.every((file) => String(file?.type || '').startsWith('image/'));
                    const isMediaOnly = attachments.length > 0
                      && !hasTextContent
                      && !message.replyTo
                      && !message.forwardedFrom
                      && attachments.every((file) => String(file?.type || '').startsWith('image/') || isVideoAttachment(file));

                    const isSelected = selectedMessageId === message.id;
                    const visibleReactions = messageReactionExpanded ? REACTION_EMOJIS : REACTION_EMOJIS.slice(0, 7);
                    const messageReactionBadges = REACTION_EMOJIS.filter((emoji) => (message.reactions?.[emoji] || []).length > 0);
                    const linkPreviews = extractLinks(message.text).map(getLinkPreview).filter(Boolean);
                    const messageSenderLogin = formatFeedLogin(message.sender);
                    const messageSenderProfile = directoryEmployees.find((employee) => sameLogin(employee.login, messageSenderLogin)) || {};
                    const messageSenderName = isMine
                      ? (profileForm.full_name || user?.name || user.username)
                      : (messageSenderProfile.full_name || message.sender);
                    const messageSenderAvatar = getEmployeeAvatar(messageSenderLogin, message.avatar, message.senderAvatar, message.senderPhoto, messageSenderProfile.avatar);

                    return (
                      <div key={message.id} data-message-id={message.id} className={`message-row ${isMine ? 'mine' : ''} ${isSelected ? 'selected' : ''} ${selectedMessageIds.includes(message.id) ? 'multi-selected' : ''} ${activeDialogSearchResult?.id === message.id ? 'search-current' : ''}`}>
                        <div
                          role="button"
                          tabIndex={0}
                          className={`message-bubble ${isMediaOnly ? 'media-only' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (multiSelectMode) { toggleSelectedMessage(message.id); return; }
                            if (isSelected && messageReactionExpanded) setMessageReactionExpanded(false);
                            else {
                              openSelectedMessageMenu(message.id, event);
                            }
                          }}
                          onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleReaction(message.id, '👍'); }}
	                          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openSelectedMessageMenu(message.id, event); }}
	                          onTouchStart={(event) => { event.currentTarget.dataset.touchX = String(event.touches[0]?.clientX || 0); }}
	                          onTouchEnd={(event) => {
	                            const startX = Number(event.currentTarget.dataset.touchX || 0);
	                            const endX = event.changedTouches[0]?.clientX || startX;
	                            const deltaX = endX - startX;
	                            if (Math.abs(deltaX) < 70) return;
	                            event.stopPropagation();
	                            if (deltaX > 0) setReplyTo(message);
	                            else openForwardMessagePicker(message);
	                          }}
	                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            event.stopPropagation();
                            openSelectedMessageMenu(message.id, event);
                          }}
                        >
                          {!isDeleted && messageSenderLogin && (
                            <button type="button" className="message-author-link" onClick={(event) => openEmployeeProfile(messageSenderLogin, event)}>
                              <span className="feed-avatar comment-avatar">{messageSenderAvatar ? <img src={messageSenderAvatar} alt={messageSenderName} /> : <span>{String(messageSenderName || messageSenderLogin || '?').slice(0, 1).toUpperCase()}</span>}</span>
                              <span>{messageSenderName}</span>
                            </button>
                          )}
                          {message.forwardedFrom && <div className="forwarded-preview">Переслано от {message.forwardedFrom}</div>}
                          {message.replyTo && <button type="button" className="reply-preview reply-jump" onClick={(event) => { event.stopPropagation(); document.querySelector(`[data-message-id="${message.replyTo.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>↪ {message.replyTo.sender}: {message.replyTo.text || 'Исходное сообщение удалено'}</button>}
                          {isDeleted ? (
                            <div className="message-deleted">Сообщение удалено {message.deletedBy ? `· ${message.deletedBy}` : ''}</div>
                          ) : hasTextContent ? (
                            inlineEditMessageId === message.id ? <div className="inline-message-editor"><textarea value={inlineEditText} onChange={(e) => setInlineEditText(e.target.value)} /><button type="button" onClick={() => saveInlineEditMessage(message)}>Сохранить</button><button type="button" onClick={() => setInlineEditMessageId('')}>Отмена</button></div> : <div className="message-text">{highlightText(message.text)}</div>
                          ) : null}

                          {linkPreviews.length > 0 && !isDeleted && (
                            <div className="link-preview-list">
                              {linkPreviews.map((preview) => (
                                <a key={preview.url} className="link-preview-card" href={preview.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                                  <img src={preview.favicon} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                                  <span><strong>{preview.title}</strong><small>{preview.description}</small><em>{preview.domain}</em></span>
                                  <b>Открыть</b>
                                </a>
                              ))}
                            </div>
                          )}

                          {attachments.length > 0 && (
                            <div className={`message-attachments-grid ${isPhotoCollage ? 'photo-collage' : ''}`}>
                              {attachments.map((file, index) => (
                                <AttachmentCard
                                  key={`${message.id}-file-${index}`}
                                  cardKey={`${message.id}-file-${index}`}
                                  file={file}
                                  metaLabel={photoMetaLabel}
                                  statusLabel={photoStatusLabel}
                                  onSelect={(event) => {
                                    openSelectedMessageMenu(message.id, event);
                                  }}
                                  onOpen={() => openChatMediaViewer(message, file, index)}
                                  onQuickReaction={() => toggleReaction(message.id, '❤️')}
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
                                    title={(message.reactions?.[emoji] || []).join(', ')}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {!isMediaOnly && (
                            <small className="read-state message-status-line">
                              {message.editedAt && !isDeleted ? <span>изменено</span> : null}
                              <span>{messageTimeLabel}</span>
                              {isMine && deliveryLabel && <span className={`message-checks ${['sending', 'waiting', 'error'].includes(message.deliveryStatus) ? 'textual' : ''}`}>{deliveryLabel}</span>}
                            </small>
                          )}
                        </div>

                        {isSelected && !isDeleted && typeof document !== 'undefined' && createPortal((
                          <div className={`selected-message-menu message-action-popover floating ${isMine ? 'mine' : ''} ${selectedMessageMenuPlacement === 'below' ? 'open-below' : ''}`} style={selectedMessageMenuStyle} onClick={(event) => event.stopPropagation()}>
                            <div className="selected-reaction-row compact-reaction-row">
                              {visibleReactions.map((emoji) => {
                                const active = (message.reactions?.[emoji] || []).includes(user.username);
                                return <button key={emoji} type="button" className={active ? 'active' : ''} onClick={() => { toggleReaction(message.id, emoji); setSelectedMessageId(''); setMessageReactionExpanded(false); }}>{emoji}</button>;
                              })}
                              {!messageReactionExpanded && <button type="button" className="more-reactions" onClick={() => setMessageReactionExpanded(true)}>⌄</button>}
                            </div>

                            {!messageReactionExpanded && (
                              <>
                                <div className="message-action-grid primary-actions compact-message-actions">
                                  <button type="button" onClick={() => { setReplyTo(message); setSelectedMessageId(''); }}><span className="message-action-icon">↩</span>Ответить</button>
                                  <button type="button" onClick={() => { copyMessageText(message); setSelectedMessageId(''); }}><span className="message-action-icon">⧉</span>Копировать</button>
                                  <button type="button" onClick={() => openForwardMessagePicker(message)}><span className="message-action-icon">↷</span>Переслать</button>
                                  <button type="button" onClick={() => { togglePinned(message.id); setSelectedMessageId(''); }}><span className="message-action-icon">⌖</span>{message.pinned ? 'Открепить' : 'Закрепить'}</button>
                                  {canEdit && <button type="button" className="danger-action" onClick={() => { deleteMessage(message.id); setSelectedMessageId(''); }}><span className="message-action-icon">×</span>Удалить</button>}
                                </div>
                                {chatLocalSettings.showExtraMessageActions === true && (
                                  <>
                                    <div className="message-action-grid secondary-actions">
                                      {canEdit && <button type="button" onClick={() => startInlineEditMessage(message)}>Изменить</button>}
                                      <button type="button" onClick={() => { setMultiSelectMode(true); toggleSelectedMessage(message.id); setSelectedMessageId(''); }}>Выбрать несколько</button>
                                      <button type="button" onClick={() => createRequestFromMessage(message)}>Создать заявку</button>
                                      <button type="button" onClick={() => notify('Добавление к существующей заявке будет доступно после выбора заявки', 'Заявка')}>Добавить к заявке</button>
                                      <button type="button" onClick={() => notify('Задача создана как черновик после подключения задач', 'Задачи')}>Создать задачу</button>
                                      <button type="button" onClick={() => notify('Назначение исполнителя появится в модуле задач', 'Задачи')}>Назначить исполнителя</button>
                                      <button type="button" onClick={() => notify('Срок можно будет поставить после подключения задач', 'Задачи')}>Поставить срок</button>
                                      <button type="button" onClick={() => getMessageAttachments(message).forEach(openAttachmentInNewTab)}>Скачать вложения</button>
                                    </div>
                                    <div className="message-action-grid danger-actions">
                                      {isMine && ['waiting', 'error'].includes(message.deliveryStatus) && <button type="button" onClick={() => retryMessageSend(message)}>Повторить отправку</button>}
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        ), document.body)}
                      </div>
                    );
                  })}
                </div>

                <div className="composer-wrap" onDrop={handleAttachmentDrop} onDragOver={handleDragOver} onDragEnter={handleDragOver}>
                  {chatLocalSettings.showChatTemplates === true && (
                    <details className="template-toolbar template-menu">
                      <summary>Шаблоны</summary>
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
                        </div>
                      </div>
                    </details>
                  )}

                  {replyTo && <div className="reply-preview active-reply">Ответ на: {replyTo.sender}: {replyTo.text}<button type="button" onClick={() => setReplyTo(null)}>×</button></div>}

                  {attachmentDrafts.length > 0 && (
                    <div className="attachment-preview-grid media-draft-grid">
                      {attachmentDrafts.map((file, index) => {
                        const mediaFile = String(file.type || '').startsWith('image/') || isVideoAttachment(file);
                        return (
                          <div key={file.id || `${file.name}-${index}`} className={`attachment-preview media-draft-tile ${mediaFile ? 'is-media' : ''}`}>
                            {mediaFile ? (
                              <button type="button" className="media-draft-thumb" onClick={() => setMediaViewer({ source: 'chat-draft', file, fileIndex: index })}>
                                {isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name} />}
                              </button>
                            ) : <span className="media-draft-file-icon">{getFileIcon(file.type)}</span>}
                            <span>{file.name} · {formatFileSize(file.size)}</span>
                            <button type="button" className="media-draft-remove" onClick={() => removeAttachmentDraft(file.id || `${file.name}-${index}`)}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {pendingMessages.length > 0 && <div className="offline-status">{isOnline ? `Отправляем ожидающие: ${pendingMessages.length}` : `Ожидает отправки: ${pendingMessages.length}`}</div>}
                  {!isOnline && <div className="offline-status warning">Нет соединения. Сообщения сохраняются локально.</div>}
                  {typingHint && <div className="typing-hint">{typingHint}</div>}{Date.now() < peerTypingUntil && <div className="typing-hint peer-typing">{activeContact?.profile?.full_name || selectedEmail} печатает<span>•••</span></div>}

                  <form className="message-form" onSubmit={handleSend}>
                    <div className="composer-textarea-box">
                      <div className="composer-input-shell">
                        <button type="button" className="composer-emoji-btn" aria-label="Выбрать смайлик" onClick={() => setIsEmojiOpen((prev) => !prev)}>☺</button>
                        {isEmojiOpen && (
                          <div className="emoji-picker composer-emoji-picker">
                            {QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => { appendToDraft(emoji); setIsEmojiOpen(false); }}>{emoji}</button>)}
                          </div>
                        )}
                        <textarea
                          ref={messageTextareaRef}
                          placeholder="Введите сообщение или перетащите файлы сюда... @username"
                          value={draft}
                          onChange={(e) => { setDraft(e.target.value); setPeerTypingUntil(Date.now() + 1800); }}
                          onKeyDown={handleComposerKeyDown}
                          onPaste={handleComposerPaste}
                          maxLength={2000}
                          rows={1}
                        />
                      </div>
                      <div className="composer-hints">
                        <label><input type="checkbox" checked={chatLocalSettings.enterToSend !== false} onChange={() => updateChatLocalSettings((prev) => ({ ...prev, enterToSend: prev.enterToSend === false }))} /> Enter отправляет</label>
                        {draft.length > 1600 && <span className={draft.length > 1900 ? 'limit-warning' : ''}>{draft.length}/2000</span>}
                        <span>Shift+Enter — новая строка · Ctrl+V — скриншот/файл</span>
                      </div>
                    </div>
                    <label className="attach-file-btn" aria-label="Прикрепить файлы" title="Прикрепить файлы">📎<input type="file" hidden multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z" onChange={handleAttachmentChange} /></label>
                    <button type="submit" disabled={isSendingMessage}>{isSendingMessage ? 'Отправляем...' : isOnline ? 'Отправить' : 'В очередь'}</button>
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
            {requestStatus.state !== 'idle' && (
              <div className={`request-status-card ${requestStatus.state}`}>
                <strong>{requestStatus.text}</strong>
                {requestStatus.ticketId && <span>Номер: #{requestStatus.ticketId}</span>}
              </div>
            )}
            <form className="employee-request-box" onSubmit={submitRequest}>
              <div className="form-grid two">
                <label>Категория<select value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)}>{REQUEST_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Приоритет<select value={requestPriority} onChange={(e) => setRequestPriority(e.target.value)}>{REQUEST_PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
              <textarea rows={7} placeholder="Например: кабинет 204, не работает принтер, требуется проверка подключения..." value={requestText} onChange={(e) => setRequestText(e.target.value)} />
              <div className="request-form-actions"><button type="submit" disabled={requestStatus.state === 'sending'}>{requestStatus.state === 'sending' ? 'Отправляем...' : 'Отправить заявку'}</button><button type="button" onClick={() => fetchMyApplications({ silent: false })}>{applicationsLoading ? 'Обновляем...' : 'Обновить статусы'}</button></div>
              {applicationsError && <div className="request-inline-error">Заявки временно недоступны: {applicationsError}</div>}
            </form>

            <section className="employee-ticket-board">
              <div className="ticket-board-head"><h3>Мои активные заявки</h3>{activeApplications.length > 0 && <span>{activeApplications.length}</span>}</div>
              {activeApplications.length === 0 && <div className="empty-mini">Активных заявок нет — новые появятся здесь сразу после отправки.</div>}
              {activeApplications.map((ticket) => {
                const meta = getApplicationStatusMeta(ticket.status);
                const waitingStartedAt = ticket.created_at || ticket.data;
                const waitingSeconds = ticket.waiting_seconds ?? (ticket.status === 'new' || ticket.status === 'reopened' ? secondsSince(waitingStartedAt) : null);
                const workSeconds = ticket.work_seconds != null
                  ? Number(ticket.work_seconds || 0) + (['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(ticket.status) ? secondsSince(ticket.resolved_at || ticket.work_started_at || ticket.accepted_at) : 0)
                  : (['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(ticket.status) ? secondsSince(ticket.work_started_at || ticket.accepted_at) : null);
                return (
                  <article key={ticket.id} className={`employee-ticket-card ${meta.tone}`}>
                    <header><div><strong>#{ticket.id} · {meta.label}</strong><span>{ticket.category || 'Другое'} · {ticket.priority || 'Обычный'}</span></div><em>{meta.hint}</em></header>
                    <p>{ticket.application}</p>
                    <div className="ticket-metrics">{waitingSeconds != null && <span>Ожидание: {formatDuration(waitingSeconds)}</span>}{workSeconds != null && workSeconds > 0 && <span>В работе: {formatDuration(workSeconds)}</span>}</div>
                    {(ticket.executor || ticket.accepted_by || ticket.admin_comment || ticket.eta_minutes) && <div className="ticket-admin-note"><strong>{ticket.executor || ticket.accepted_by || 'Администратор'}</strong><span>{ticket.admin_comment || (ticket.eta_minutes ? `К вам подойдут через ${ticket.eta_minutes} минут` : 'Заявка принята, ожидайте исполнителя.')}</span></div>}
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
            <div className="feed-toolbar compact-feed-toolbar sticky-feed-search"><div className="feed-search-shell"><span className="feed-search-icon">🔍</span><input type="search" placeholder="Поиск по ленте" value={feedSearch} onChange={(e) => setFeedSearch(e.target.value)} />{feedSearch && <button type="button" className="feed-search-clear" onClick={() => setFeedSearch('')} aria-label="Очистить поиск">×</button>}</div></div>
            <div className="employee-feed-list" ref={feedListRef} onClick={(event) => { if (event.target === event.currentTarget) { setSelectedFeedPostId(''); setFeedReactionExpanded(false); } }}>
              <article className="employee-feed-post feed-composer-post">
                <header className="employee-feed-header compact-feed-header feed-composer-post-header">
                  <div><h2>Лента сотрудников</h2><p>Объявления, новости и фотоотчёты.</p></div>
                  <button type="button" onClick={() => fetchFeed({ silent: false })}>{feedRefreshing ? 'Обновляем…' : 'Обновить'}</button>
                </header>
                {feedError && <div className="feed-status-warning">Лента временно недоступна: {feedError}</div>}
                <form className="employee-feed-composer compact-feed-composer vk-feed-composer" onSubmit={addFeedPost}>
                  <div className="feed-composer-body"><div className="feed-avatar feed-avatar-current">{avatarUrl ? <img src={avatarUrl} alt="Мой аватар" /> : <span>{String(profileForm.full_name || user?.name || user?.username || '?').slice(0, 1).toUpperCase()}</span>}</div><div className={`feed-composer-line ${chatLocalSettings.showFeedCategorySelect === true ? 'has-category' : 'without-category'}`}>{chatLocalSettings.showFeedCategorySelect === true && <select value={feedCategory} onChange={(e) => setFeedCategory(e.target.value)}>{FEED_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select>}<textarea rows={2} placeholder="Что у вас нового?" value={feedDraft} onChange={(e) => setFeedDraft(e.target.value)} /></div></div>
                  {feedAttachments.length > 0 && (
                    <div className="employee-feed-attachment-preview-grid media-draft-grid">
                      {feedAttachments.map((file, index) => {
                        const mediaFile = String(file.type || '').startsWith('image/') || isVideoAttachment(file);
                        return (
                          <div key={file.id || `${file.name}-${index}`} className={`employee-feed-attachment-preview media-draft-tile ${mediaFile ? 'is-media' : ''}`}>
                            {mediaFile ? (
                              <button type="button" className="media-draft-thumb" onClick={() => setMediaViewer({ source: 'feed-draft', file, fileIndex: index })}>
                                {isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name} />}
                              </button>
                            ) : <span className="media-draft-file-icon">{getFileIcon(file.type)}</span>}
                            <span>{file.name} · {formatFileSize(file.size)}</span>
                            <button type="button" className="media-draft-remove" onClick={() => removeFeedAttachment(file.id || `${file.name}-${index}`)}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="employee-feed-composer-actions"><label>📎 Фото/видео<input type="file" multiple hidden accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z" onChange={onFeedFileChange} /></label><button type="submit" disabled={isPublishingFeed || (!feedDraft.trim() && feedAttachments.length === 0)}>{isPublishingFeed ? 'Публикуем...' : 'Опубликовать'}</button></div>
                </form>
              </article>
              {feedLoading && <div className="feed-skeleton-list"><div /><div /><div /></div>}
              {!feedLoading && feedError && <button type="button" className="feed-retry" onClick={() => fetchFeed({ silent: false })}>Повторить загрузку</button>}
              {!feedLoading && visibleFeedPosts.length === 0 && <div className="feed-empty-card"><strong>{feedSearch.trim() ? 'Ничего не найдено' : 'Пока нет публикаций'}</strong><span>{feedSearch.trim() ? 'Попробуйте другой запрос' : 'Будьте первым, кто поделится новостью, фото или объявлением.'}</span></div>}
              {pinnedFeedPosts.length > 0 && <div className="feed-pinned-title">📌 Закреплено</div>}
              {[...pinnedFeedPosts, ...regularFeedPosts].map((post) => {
                const canDeletePost = canManageFeedPost(post, user, isManager, isAdmin);
                const authorLogin = formatFeedLogin(post.author);
                const authorProfile = directoryEmployees.find((employee) => sameLogin(employee.login, authorLogin)) || {};
                const authorName = post.authorName || authorProfile.full_name || authorLogin || 'Сотрудник';
                const authorMeta = [post.category || 'Объявление', authorProfile.position || authorProfile.department || (authorLogin ? `@${authorLogin}` : ''), new Date(post.createdAt).toLocaleString('ru-RU')].filter(Boolean).join(' · ');
                const authorInitial = String(authorName || authorLogin || '?').slice(0, 1).toUpperCase();
                const authorAvatar = getEmployeeAvatar(authorLogin, post.avatar, post.authorAvatar, post.authorPhoto, post.author_photo, authorProfile.avatar);
                const sortedPostComments = sortComments(post.comments || []);
                const previewComments = expandedCommentPosts[post.id]
                  ? sortedPostComments
                  : (commentSort === 'old' ? sortedPostComments.slice(-2) : sortedPostComments.slice(0, 2));
                const hiddenCommentsCount = Math.max(0, sortedPostComments.length - previewComments.length);
                return (
                  <article
                    key={post.id}
                    className={`employee-feed-post ${post.pinned ? 'pinned-feed-post' : ''} ${selectedFeedPostId === post.id ? 'selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (selectedFeedPostId === post.id && feedReactionExpanded) setFeedReactionExpanded(false);
                      else {
                        setSelectedFeedPostId(post.id);
                        setFeedReactionExpanded(false);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setSelectedFeedPostId(post.id);
                      setFeedReactionExpanded(false);
                    }}
                  >
                    <header className="employee-feed-post-header vk-feed-post-header">
                      <button type="button" className="feed-avatar profile-link-avatar" onClick={(event) => openEmployeeProfile(authorLogin, event)}>{authorAvatar ? <img src={authorAvatar} alt={authorName} /> : <span>{authorInitial}</span>}</button>
                      <button type="button" className="feed-post-author-block profile-link-name" onClick={(event) => openEmployeeProfile(authorLogin, event)}>
                        <strong>{post.pinned && <span className="feed-pinned-badge">📌</span>}{authorName}</strong>
                        <span>{authorMeta}{post.editedAt && ' · изменено'}</span>
                      </button>
                      <button type="button" className="feed-post-menu-button" onClick={(event) => { event.stopPropagation(); setOpenFeedMenuId(openFeedMenuId === post.id ? '' : post.id); }}>⋯</button>
                      {openFeedMenuId === post.id && <div className="feed-post-menu" onClick={(event) => event.stopPropagation()}>{canDeletePost && <button type="button" onClick={() => startEditFeedPost(post)}>Редактировать текст</button>}{isManager && <button type="button" onClick={() => toggleFeedPinned(post.id, !post.pinned)}>{post.pinned ? 'Открепить' : 'Закрепить'}</button>}<button type="button" onClick={() => copyFeedPostLink(post.id)}>Скопировать ссылку</button><button type="button" onClick={() => shareFeedPostToChat(post)}>Поделиться постом в чат</button><button type="button" onClick={() => quoteFeedPost(post)}>Цитировать пост</button><button type="button" onClick={() => hideFeedPost(post.id)}>Скрыть пост</button>{!isPostAuthor(post, user) && <button type="button" onClick={() => reportFeedPost(post.id)}>Пожаловаться</button>}{(isManager || isAdmin) && <button type="button" onClick={() => notify((post.audit || []).length ? 'История есть в аудите' : 'История изменений пуста', 'Лента')}>История изменений</button>}{canDeletePost && <button type="button" className="danger-action" onClick={() => deleteFeedPost(post.id)}>Удалить</button>}</div>}
                    </header>
                    {editingFeedPostId === post.id ? <div className="feed-edit-box"><textarea rows={3} value={editingFeedText} onChange={(e) => setEditingFeedText(e.target.value)} /><div><button type="button" onClick={() => saveFeedPostEdit(post.id)}>Сохранить</button><button type="button" onClick={() => setEditingFeedPostId('')}>Отмена</button></div></div> : post.text && <p className="employee-feed-post-text">{post.text}</p>}
                    {getFeedAttachments(post).length > 0 && <div className="employee-feed-media-grid">{getFeedAttachments(post).map((file, index) => { const isMedia = String(file.type || '').startsWith('image/') || isVideoAttachment(file); return isMedia ? <button key={file.id || `${post.id}-feed-media-${index}`} type="button" className={`employee-feed-media-tile ${isVideoAttachment(file) ? 'video' : ''}`} onClick={(event) => { event.stopPropagation(); openFeedMediaViewer(post, file, index); }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleFeedReaction(post.id, '👍'); }} aria-label={`Открыть вложение ${file.name || 'медиа'}`}>{isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} preload="metadata" muted playsInline onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name || 'Вложение'} loading="lazy" />}<span>{file.name} · {formatFileSize(file.size)}</span></button> : <AttachmentCard key={file.id || `${post.id}-feed-file-${index}`} cardKey={`${post.id}-feed-file-${index}`} file={file} variant="feed" />; })}</div>}
                    <div className="message-reactions-inline feed-reactions-inline">{REACTION_EMOJIS.filter((emoji) => (post.reactions?.[emoji] || []).length > 0).map((emoji) => { const active = (post.reactions?.[emoji] || []).includes(user?.username); return <button key={emoji} type="button" className={active ? 'active' : ''} onClick={(event) => { event.stopPropagation(); toggleFeedReaction(post.id, emoji); }} title={(post.reactions?.[emoji] || []).join(', ')}>{emoji} {(post.reactions?.[emoji] || []).length}</button>; })}</div>
                    {selectedFeedPostId === post.id && (
                      <div className="feed-selected-menu compact-feed-selected-menu" onClick={(event) => event.stopPropagation()}>
                        <div className="selected-reaction-row feed-reaction-picker">{(feedReactionExpanded ? REACTION_EMOJIS : REACTION_EMOJIS.slice(0, 7)).map((emoji) => { const active = (post.reactions?.[emoji] || []).includes(user?.username); return <button key={emoji} type="button" className={active ? 'active' : ''} onClick={() => toggleFeedReaction(post.id, emoji)}>{emoji}</button>; })}{!feedReactionExpanded && <button type="button" className="more-reactions" onClick={() => setFeedReactionExpanded(true)}>⌄</button>}</div>
                        <div className="selected-actions-row feed-actions-row">{isManager && <button type="button" onClick={() => toggleFeedPinned(post.id, !post.pinned)}>{post.pinned ? 'Открепить' : 'Закрепить'}</button>}</div>
                      </div>
                    )}
                    <div className="employee-feed-comments">
                      <div className="employee-feed-comments-title">Комментарии</div>
                      {sortedPostComments.length === 0 && <small className="employee-feed-no-comments">Комментариев пока нет.</small>}
                      {previewComments.map((comment) => { const canDeleteComment = isManager || isAdmin || comment.author === user?.username; const commentInitial = String(comment.authorName || comment.author || '?').slice(0, 1).toUpperCase(); const commentAvatar = getEmployeeAvatar(comment.author, comment.avatar, comment.authorAvatar, comment.authorPhoto, comment.author_photo); return <div key={comment.id} className="employee-feed-comment"><button type="button" className="feed-avatar comment-avatar profile-link-avatar" onClick={(event) => openEmployeeProfile(comment.author, event)}>{commentAvatar ? <img src={commentAvatar} alt={comment.authorName || comment.author || 'Комментарий'} /> : <span>{commentInitial}</span>}</button><div className="employee-feed-comment-body"><button type="button" className="comment-author-link" onClick={(event) => openEmployeeProfile(comment.author, event)}>{comment.authorName || formatFeedLogin(comment.author)}</button><span>{comment.text}</span><small>{formatFeedLogin(comment.author)} · {new Date(comment.createdAt).toLocaleString('ru-RU')}</small><div className="feed-comment-actions"><button type="button" onClick={() => setCommentDrafts((prev) => ({ ...prev, [post.id]: `@${formatFeedLogin(comment.author)} ` }))}>Ответить</button><button type="button" onClick={() => notify('Реакция на комментарий сохранится после подключения серверного метода', 'Лента')}>👍</button>{canDeleteComment && <button type="button" onClick={() => deleteFeedComment(post.id, comment.id)}>Удалить</button>}</div></div></div>; })}
                      {hiddenCommentsCount > 0 && !expandedCommentPosts[post.id] && <button type="button" className="feed-show-more-comments" onClick={() => setExpandedCommentPosts((prev) => ({ ...prev, [post.id]: true }))}>Показать все комментарии ({sortedPostComments.length})</button>}
                      <div className="employee-feed-comment-form"><div className="feed-avatar comment-avatar feed-avatar-current">{avatarUrl ? <img src={avatarUrl} alt="Мой аватар" /> : <span>{String(profileForm.full_name || user?.name || user?.username || '?').slice(0, 1).toUpperCase()}</span>}</div><input placeholder="Написать комментарий…" value={commentDrafts[post.id] || ''} onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))} />{(commentDrafts[post.id] || '').trim() && <button type="button" onClick={() => addCommentToPost(post.id)}>Отправить</button>}</div>
                    </div>
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
                <section className="profile-panel"><h3>Безопасность и фото</h3><div className="profile-appearance-settings"><h4>Вид интерфейса</h4><div className="chat-appearance-controls profile-appearance-controls"><label><span>Тема</span><select value={chatLocalSettings.uiTheme || 'light'} onChange={(e) => updateChatUiSetting('uiTheme', e.target.value)}>{CHAT_THEMES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Плотность</span><select value={chatLocalSettings.uiDensity || 'regular'} onChange={(e) => updateChatUiSetting('uiDensity', e.target.value)}>{CHAT_DENSITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Текст</span><select value={chatLocalSettings.uiTextSize || 'medium'} onChange={(e) => updateChatUiSetting('uiTextSize', e.target.value)}>{CHAT_TEXT_SIZES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div></div><div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>Изменить фото</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>Удалить фото</button></div><div className="profile-chat-tools"><strong>Дополнительные инструменты диалога</strong><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showExtraMessageActions === true} onChange={() => toggleDialogToolSetting('showExtraMessageActions')} /><span><strong>Показывать дополнительные действия сообщений</strong><small>Редактирование, выбор нескольких, заявки, задачи и скачивание вложений. По умолчанию скрыто.</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showChatTemplates === true} onChange={() => toggleDialogToolSetting('showChatTemplates')} /><span><strong>Показывать шаблоны сообщений</strong><small>По умолчанию скрыто. Включите, если нужны быстрые текстовые шаблоны.</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogMediaPanel === true} onChange={() => toggleDialogToolSetting('showDialogMediaPanel')} /><span><strong>Показывать “Медиа / Файлы” в диалоге</strong><small>По умолчанию скрыто. Включите, если нужна правая панель медиа, файлов и ссылок.</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogDateJump === true} onChange={() => toggleDialogToolSetting('showDialogDateJump')} /><span><strong>Показывать “Перейти к дате”</strong><small>По умолчанию скрыто, чтобы верх чата был компактнее.</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogFilters === true} onChange={() => toggleDialogToolSetting('showDialogFilters')} /><span><strong>Показывать фильтры сообщений</strong><small>Все, мои, собеседник, с файлами, фото, сегодня, неделя и месяц.</small></span></label></div><div className="profile-chat-tools"><strong>Дополнительные инструменты ленты</strong><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showFeedCategorySelect === true} onChange={() => toggleFeedToolSetting('showFeedCategorySelect')} /><span><strong>Показывать выбор категории публикации</strong><small>Объявление, новость, вопрос, поздравление и другие категории. По умолчанию скрыто.</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showFeedFilters === true} onChange={() => toggleFeedToolSetting('showFeedFilters')} /><span><strong>Показывать фильтры ленты</strong><small>Кнопка фильтров справа от поиска по ленте. По умолчанию скрыто.</small></span></label></div><form onSubmit={changeMyPassword} className="profile-password-form"><input type="password" placeholder="Текущий пароль" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))} /><input type="password" placeholder="Новый пароль" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))} /><button type="submit">Обновить пароль</button></form>{!isAdmin && <button type="button" className="profile-logout-btn" onClick={handleLogout}>Выйти из аккаунта</button>}</section>
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

      {mediaViewer && (() => {
        const viewerFiles = getViewerFiles();
        const viewerIndex = Math.max(0, Math.min(viewerFiles.length - 1, mediaViewer.fileIndex || 0));
        const hasManyViewerFiles = viewerFiles.length > 1;
        return (
          <div
            className="photo-viewer-backdrop"
            onMouseDown={() => setMediaViewer(null)}
            onTouchStart={(event) => setViewerTouchStart({ x: event.touches[0]?.clientX || 0, y: event.touches[0]?.clientY || 0 })}
            onTouchEnd={(event) => {
              if (!viewerTouchStart) return;
              const touch = event.changedTouches[0];
              const dx = (touch?.clientX || 0) - viewerTouchStart.x;
              const dy = (touch?.clientY || 0) - viewerTouchStart.y;
              if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx)) setMediaViewer(null);
              else if (Math.abs(dx) > 60) moveMediaViewer(dx > 0 ? -1 : 1);
              setViewerTouchStart(null);
            }}
          >
          <header className="photo-viewer-header" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="photo-viewer-back" onClick={() => setMediaViewer(null)}>← Назад</button>
            <strong className="photo-viewer-counter">{viewerIndex + 1} из {viewerFiles.length || 1}</strong>
            <details className="photo-viewer-menu">
              <summary aria-label="Действия с фото">⋯</summary>
              <div className="photo-viewer-menu-popover">
                <a href={getOriginalAttachmentUrl(mediaViewer.file)} download={mediaViewer.file.name || 'photo'}>Сохранить</a>
                {mediaViewer.message && mediaViewer.source !== 'feed' && <button type="button" onClick={replyToViewedMedia}>Ответить</button>}
                {mediaViewer.message && mediaViewer.source !== 'feed' && <button type="button" onClick={shareViewedMedia}>Поделиться</button>}
                {mediaViewer.source === 'feed' && <button type="button" onClick={shareViewedFeedMedia}>Поделиться</button>}
                {mediaViewer.source === 'feed' && canManageFeedPost(mediaViewer.post, user, isManager, isAdmin) && <button type="button" className="danger-action" onClick={deleteViewedMedia}>Удалить</button>}
                {mediaViewer.message && mediaViewer.source !== 'feed' && (isManager || mediaViewer.message?.sender === user.username) && <button type="button" className="danger-action" onClick={deleteViewedMedia}>Удалить</button>}
              </div>
            </details>
          </header>
          <div className="photo-viewer-stage" onMouseDown={(event) => event.stopPropagation()}>
            {hasManyViewerFiles && <button type="button" className="photo-viewer-nav prev" onClick={() => moveMediaViewer(-1)}>‹</button>}
            {isVideoAttachment(mediaViewer.file) ? (
              <video src={getOriginalAttachmentUrl(mediaViewer.file)} controls playsInline poster={getVideoPosterUrl(mediaViewer.file) || getAttachmentUrl(mediaViewer.file)} onLoadedMetadata={nudgeVideoToFirstFrame}>Ваш браузер не поддерживает просмотр видео.</video>
            ) : (
              <img src={getOriginalAttachmentUrl(mediaViewer.file)} alt={mediaViewer.file.name || 'Фото'} />
            )}
            {hasManyViewerFiles && <button type="button" className="photo-viewer-nav next" onClick={() => moveMediaViewer(1)}>›</button>}
          </div>
          {hasManyViewerFiles && <div className="photo-viewer-thumbs" onMouseDown={(event) => event.stopPropagation()}>{viewerFiles.map((file, index) => <button key={file.id || `${file.name}-${index}`} type="button" className={index === viewerIndex ? 'active' : ''} onClick={() => setMediaViewer((current) => ({ ...current, file, fileIndex: index }))}>{isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name || 'Миниатюра'} loading="lazy" />}</button>)}</div>}
        </div>
        );
      })()}

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
