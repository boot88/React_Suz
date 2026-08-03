Warning: truncated output (original token count: 74326)
Total output lines: 5840

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch, withAccessToken } from '../utils/authFetch';
import {
  readCachedConversation,
  writeCachedConversation,
  removeCachedConversation
} from '../utils/chatMessageCache';
import { readCachedFeed, writeCachedFeed } from '../utils/feedCache';
import ChatComposerForm from '../components/employeeChat/ChatComposerForm';
import ChatDialogHeader from '../components/employeeChat/ChatDialogHeader';
import ChatLoadingOverlay from '../components/employeeChat/ChatLoadingOverlay';
import ContactsWorkspace from '../components/employeeChat/ContactsWorkspace';
import FeedComposer from '../components/employeeChat/FeedComposer';
import FeedPostCard from '../components/employeeChat/FeedPostCard';
import RequestTimerMetrics from '../components/employeeChat/RequestTimerMetrics';
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
const MANAGER_TEMPLATE_MESSAGES_EN = ['✅ Accepted', '👀 Reviewing now', '🔧 Working on it', '📌 Please confirm the room and device', '📷 Please send a photo of the error', '⏱️ I will respond within 15 minutes', '🧪 Testing the solution', '✅ Done, please check', '🙏 Thank you, closing the request'];
const EMPLOYEE_TEMPLATE_MESSAGES_EN = ['👋 Hello!', '🆘 I need help', '📍 I am in room ...', '📷 I will send a photo now', '✅ It works, thank you!', '❌ The error remains', '🔁 I repeated the step with the same result', '📞 Can we have a call?', '🙏 Thank you!'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🙏', '🎉', '🤩', '👌', '💯', '💪', '🤝', '✨', '👀'];
const QUICK_EMOJIS = ['😀', '🙂', '😅', '🙏', '👍', '✅', '👀', '📌', '🔧', '⏳', '❗', '❤️'];
const EMPLOYEE_CUSTOM_TEMPLATES_KEY = 'employeeChatCustomTemplates';
const MAX_ATTACHMENT_SIZE_MB = 50;
const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
const UPLOAD_CONCURRENCY = 2;
const mapWithConcurrency = async (items, worker, concurrency = UPLOAD_CONCURRENCY) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
};
const CHAT_MESSAGES_PAGE_SIZE = 50;
const FEED_POSTS_PAGE_SIZE = 50;
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

const PROFILE_WEBSITE_BY_LANGUAGE = {
  en: 'http://web3.nioch.nsc.ru/nioch/index.php/en/',
  ru: 'http://web3.nioch.nsc.ru/nioch/index.php/ru/'
};
const DEFAULT_PROFILE_WEBSITE_LANGUAGE = 'en';
const PROFILE_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' }
];


const RUSSIAN_LABELS = {
  workingChat: 'Рабочий чат',
  profile: 'Профиль',
  chatSections: 'Разделы чата',
  contacts: 'Контакты',
  contactSearch: 'ФИО, login, отдел, кабинет, телефон...',
  filter: 'Фильтр',
  noResults: 'Ничего не найдено',
  departmentMissing: 'отдел —',
  cabinetShort: 'каб',
  admin: 'admin',
  online: 'online',
  offline: 'offline',
  pinDialog: 'Закрепить диалог',
  favorite: 'Избранное',
  chooseDialog: 'Выберите диалог',
  chooseDialogHint: 'Автовыбор убран: откройте нужного сотрудника слева или найдите контакт поиском.',
  dialog: 'Диалог',
  dialogSearch: 'Поиск в диалоге...',
  loadPreviousMessages: 'Показать предыдущие сообщения',
  showingLatestMessages: 'Показаны последние {shown} из {total}',
  loadMoreFeed: 'Показать ещё записи',
  loading: 'Загрузка',
  of: 'из',
  mediaFiles: 'Медиа / Файлы',
  dialogActions: 'Действия с диалогом',
  archiveDialog: 'Архивировать диалог',
  hideDialog: 'Скрыть диалог',
  pinDialogAction: 'Закрепить диалог',
  markUnread: 'Пометить непрочитанным',
  muteNotifications: 'Отключить уведомления',
  clearDraft: 'Очистить черновик',
  deleteConversation: 'Удалить переписку',
  sendingPending: 'Отправляем ожидающие',
  waitingToSend: 'Ожидает отправки',
  offlineWarning: 'Нет соединения. Сообщения сохраняются локально.',
  typing: 'печатает',
  emoji: 'Выбрать смайлик',
  messagePlaceholder: 'Введите сообщение или перетащите файлы сюда... @username',
  enterSends: 'Enter отправляет',
  composerHint: 'Shift+Enter — новая строка · Ctrl+V — скриншот/файл',
  attachFiles: 'Прикрепить файлы',
  sending: 'Отправляем...',
  send: 'Отправить',
  queue: 'В очередь',
  myProfile: 'Мой профиль',
  internalProfile: 'Внутренняя страница сотрудника',
  position: 'Должность',
  department: 'Отдел',
  room: 'Кабинет',
  phone: 'Телефон',
  website: 'Сайт',
  bio: 'О себе',
  openDialog: 'Открыть диалог',
  fullName: 'ФИО',
  login: 'Логин',
  websiteVersion: 'Версия сайта',
  status: 'Статус',
  securityPhoto: 'Безопасность и фото',
  profileTabProfile: 'Профиль',
  profileTabAppearance: 'Внешний вид',
  profileTabChat: 'Чат',
  profileTabFeed: 'Лента',
  profileTabSecurity: 'Безопасность',
  appearance: 'Вид интерфейса',
  theme: 'Тема',
  density: 'Плотность',
  textSize: 'Текст',
  changePhoto: 'Изменить фото',
  removePhoto: 'Удалить фото',
  dialogTools: 'Дополнительные инструменты диалога',
  feedTools: 'Дополнительные инструменты ленты',
  currentPassword: 'Текущий пароль',
  newPassword: 'Новый пароль',
  updatePassword: 'Обновить пароль',
  logout: 'Выйти из аккаунта',
  requestHint: 'Заполните категорию, приоритет и описание — статус заявки появится сразу после отправки.',
  ticketNumber: 'Номер',
  techSupportContacts: 'Контакты технической поддержки',
  techSupport: 'Техническая поддержка',
  techSupportDepartment: 'Отдел программно-технического обеспечения средств вычислительной техники',
  techSupportText: 'По всем вопросам работы компьютеров, программ, доступа к сервисам и другой техники обращайтесь в техподдержку. Чтобы обращение не потерялось и быстрее попало в работу, заявки лучше отправлять через форму на сайте ниже.',
  leadSpecialist: 'Ведущий специалист',
  internalPhone: 'Внутренний телефон',
  mobile: 'Мобильный',
  requestEyebrow: 'Служебная заявка',
  requestTitle: 'Сообщить о проблеме',
  category: 'Категория',
  priority: 'Приоритет',
  requestPlaceholder: 'Например: кабинет 204, не работает принтер, требуется проверка подключения...',
  sendingRequest: 'Отправляем...',
  sendRequest: 'Отправить заявку',
  refreshing: 'Обновляем...',
  refreshStatuses: 'Обновить статусы',
  requestsUnavailable: 'Заявки временно недоступны',
  feedTitle: 'Лента сотрудников',
  feedSubtitle: 'Объявления, новости и фотоотчёты.',
  feedUnavailable: 'Лента временно недоступна',
  photoVideo: 'Фото/видео',
  publishing: 'Публикуем...',
  publish: 'Опубликовать',
  searchFeed: 'Поиск по ленте',
  clearSearch: 'Очистить поиск',
  refresh: 'Обновить',
  whatsNew: 'Что у вас нового?',
  noPosts: 'Пока нет публикаций',
  tryAnotherSearch: 'Попробуйте другой запрос',
  firstPostHint: 'Будьте первым, кто поделится новостью, фото или объявлением.',
  back: 'Назад',
  youTyping: 'Вы печатаете…',
  confirm: 'Подтверждение',
  deleteAttachmentConfirm: 'Удалить только это вложение?',
  deleteAttachmentTitle: 'Удаление вложения',
  deleteMediaFromPost: 'Удалить {type} {name} из публикации?',
  deleteLastPostAttachment: 'Это последнее вложение. Удалить всю публикацию?',
  deletePostTitle: 'Удаление публикации',
  deletePhotoType: 'фото',
  deleteVideoType: 'видео',
  showExtraMessageActionsTitle: 'Показывать дополнительные действия сообщений',
  showExtraMessageActionsHint: 'Редактирование, выбор нескольких, заявки, задачи и скачивание вложений. По умолчанию скрыто.',
  showChatTemplatesTitle: 'Показывать шаблоны сообщений',
  showChatTemplatesHint: 'По умолчанию скрыто. Включите, если нужны быстрые текстовые шаблоны.',
  showDialogMediaPanelTitle: 'Показывать “Медиа / Файлы” в диалоге',
  showDialogMediaPanelHint: 'По умолчанию скрыто. Включите, если нужна правая панель медиа, файлов и ссылок.',
  showDialogDateJumpTitle: 'Показывать “Перейти к дате”',
  showDialogDateJumpHint: 'По умолчанию скрыто, чтобы верх чата был компактнее.',
  showConversationMenuTitle: 'Показывать меню действий диалога',
  showConversationMenuHint: 'Архивировать, скрыть, закрепить, пометить непрочитанным и удалить переписку. По умолчанию скрыто.',
  showDialogFiltersTitle: 'Показывать фильтры сообщений',
  showDialogFiltersHint: 'Все, мои, собеседник, с файлами, фото, сегодня, неделя и месяц.',
  showFeedCategorySelectTitle: 'Показывать выбор категории публикации',
  showFeedCategorySelectHint: 'Объявление, новость, вопрос, поздравление и другие категории. По умолчанию скрыто.',
  showFeedFiltersTitle: 'Показывать фильтры ленты',
  showFeedFiltersHint: 'Кнопка фильтров справа от поиска по ленте. По умолчанию скрыто.',
  edit: 'Изменить',
  selectMultiple: 'Выбрать несколько',
  createRequest: 'Создать заявку',
  addToRequest: 'Добавить к заявке',
  createTask: 'Создать задачу',
  assignExecutor: 'Назначить исполнителя',
  setDeadline: 'Поставить срок',
  downloadAttachments: 'Скачать вложения',
  cancel: 'Отмена',
  openAttachment: 'Открыть вложение',
  media: 'медиа',
  attachmentAlt: 'Вложение',
  copy: 'Копировать',
  forward: 'Переслать',
  pin: 'Закрепить',
  unpin: 'Открепить',
  editText: 'Редактировать текст',
  copyLink: 'Скопировать ссылку',
  sharePost: 'Поделиться постом в чат',
  quotePost: 'Цитировать пост',
  hidePost: 'Скрыть пост',
  selectPost: 'Выбрать публикацию',
  selectedPost: 'Публикация выбрана',
  save: 'Сохранить',
  share: 'Поделиться',
  unsupportedVideo: 'Ваш браузер не поддерживает просмотр видео.',
  photoAlt: 'Фото',
  reply: 'Ответить',
  delete: 'Удалить',
  sendComment: 'Отправить',
  showAllComments: 'Показать все комментарии',
  hideComments: 'Скрыть комментарии',
  comments: 'Комментарии',
  noComments: 'Комментариев пока нет.',
  writeComment: 'Написать комментарий…',
  saveProfile: 'Сохранить анкету',
  dropFiles: 'Отпустите файлы',
  dropFilesHint: 'Добавим их в текущее сообщение',
  jumpToDate: 'Перейти к дате',
  mediaSearch: 'Поиск по имени файла или ссылке...',
  downloadArchive: 'Скачать всё архивом',
  archiveUnavailable: 'Скачивание архива будет доступно после подключения серверного архива.',
  pinnedMessages: 'Закреплённые',
  selectedCount: 'Выбрано',
  photo: 'Фото',
  document: 'Документ',
  attachmentPlaceholder: 'вложение',
  noMessageSearchResults: 'По запросу ничего не найдено.',
  loadMoreSearchResults: 'Показать ещё результаты',
  searchingMessages: 'Ищем по всей переписке…',
  noMessages: 'Сообщений пока нет.',
  deliverySending: 'Отправляется…',
  deliveryWaiting: 'Ожидает сети',
  deliveryError: 'Ошибка',
  forwardedFrom: 'Переслано от',
  originalMessageDeleted: 'Исходное сообщение удалено',
  deletedMessage: 'Сообщение удалено',
  changed: 'изменено',
  retrySend: 'Повторить отправку',
  templates: 'Шаблоны',
  myTemplate: 'Мой шаблон',
  replyTo: 'Ответ на',
  myAvatar: 'Мой аватар',
  retryLoad: 'Повторить загрузку',
  pinned: 'Закреплено',
  activeRequests: 'Мои активные заявки',
  noActiveRequests: 'Активных заявок нет — новые появятся здесь сразу после отправки.',
  waitingTime: 'Ожидание',
  workTime: 'В работе',
  administrator: 'Администратор',
  administratorAccepted: 'Заявка принята, ожидайте исполнителя.',
  administratorEta: 'К вам подойдут через {minutes} минут',
  workCompleted: 'Что сделано',
  requestDone: 'Заявка выполнена',
  issueRemains: 'Проблема осталась',
  completedHistory: 'История выполненных заявок',
  requestFillDescription: 'Заполните описание заявки.',
  requestSubmitted: 'Заявка подана. Статус: ожидает администратора.',
  requestNetworkError: 'Ошибка сети при отправке заявки. Попробуйте ещё раз.',
  profilePhoto: 'Фото профиля',
  understood: 'Понятно',
  confirmActionButton: 'Подтвердить',
  saveActionButton: 'Сохранить',
  viewerActions: 'Действия с фото',
  thumbnailAlt: 'Миниатюра',
  forwardMessageTitle: 'Переслать сообщение',
  forwardMessageHint: 'Выберите сотрудника или администратора, кому отправить копию сообщения.',
  attachmentWithoutText: 'Вложение без текста',
  noRecipients: 'Нет доступных получателей',
  employeeManagement: 'Управление сотрудниками',
  employeeLogin: 'Логин (email)',
  password: 'Пароль',
  newPasswordLabel: 'Новый пароль',
  passwordKeepHint: 'Оставьте поле пустым, если пароль менять не нужно.',
  passwordKeepPlaceholder: 'Оставьте пустым, если не менять',
  loginPasswordPlaceholder: 'Пароль для входа',
  passwordMinHint: 'Минимум 8 символов.',
  employeeDepartmentPlaceholder: 'Отдел сотрудника',
  showPassword: 'Показать пароль',
  add: 'Добавить',
  employeeMessages: 'Переписка сотрудников',
  auditSearch: 'Поиск по участникам и тексту',
  showEmptyArchived: 'Показывать пустые/архивные',
  attachmentsOnly: 'Только с вложениями',
  deletedOnly: 'Только удалённые',
  noAuditDialogs: 'Диалогов по фильтрам нет.',
  chooseConversation: 'Выберите переписку.',
  messagesShort: 'сообщ.',
  deletedShort: 'удалено',
  lastMessage: 'последнее',
  noMessagesShort: 'без сообщений',
  deletedBy: 'Удалил',
  history: 'История',
  change: 'изменение',
  profileNamePlaceholder: 'Иванов Иван Иванович',
  positionPlaceholder: 'Например: инженер',
  departmentPlaceholder: 'Название отдела',
  roomPlaceholder: 'Например: 214',
  phonePlaceholder: 'Например: 12-34',
  statusPlaceholder: 'Короткий статус',
  bioPlaceholder: 'Кратко о себе',
  themeLight: 'Светлая — текущая',
  themeDark: 'Новая — служебная',
  densityRegular: 'Обычная',
  densityCompact: 'Компактная',
  textSmall: 'Меньше',
  textMedium: 'Обычно',
  textLarge: 'Больше'
};

const ENGLISH_LABELS = {
  workingChat: 'Work chat',
  profile: 'Profile',
  chatSections: 'Chat sections',
  contacts: 'Contacts',
  contactSearch: 'Name, login, department, room, phone...',
  filter: 'Filter',
  noResults: 'Nothing found',
  departmentMissing: 'department —',
  cabinetShort: 'room',
  admin: 'admin',
  online: 'online',
  offline: 'offline',
  pinDialog: 'Pin dialog',
  favorite: 'Favorite',
  chooseDialog: 'Choose a dialog',
  chooseDialogHint: 'Auto-select is disabled: open an employee on the left or find a contact with search.',
  dialog: 'Dialog',
  dialogSearch: 'Search in dialog...',
  loadPreviousMessages: 'Show previous messages',
  showingLatestMessages: 'Showing latest {shown} of {total}',
  loadMoreFeed: 'Show more posts',
  loading: 'Loading',
  of: 'of',
  mediaFiles: 'Media / Files',
  dialogActions: 'Dialog actions',
  archiveDialog: 'Archive dialog',
  hideDialog: 'Hide dialog',
  pinDialogAction: 'Pin dialog',
  markUnread: 'Mark as unread',
  muteNotifications: 'Mute notifications',
  clearDraft: 'Clear draft',
  deleteConversation: 'Delete conversation',
  sendingPending: 'Sending pending',
  waitingToSend: 'Waiting to send',
  offlineWarning: 'No connection. Messages are saved locally.',
  typing: 'is typing',
  emoji: 'Choose emoji',
  messagePlaceholder: 'Type a message or drop files here... @username',
  enterSends: 'Enter sends',
  composerHint: 'Shift+Enter — new line · Ctrl+V — screenshot/file',
  attachFiles: 'Attach files',
  sending: 'Sending...',
  send: 'Send',
  queue: 'Queue',
  myProfile: 'My profile',
  internalProfile: 'Employee internal page',
  position: 'Position',
  department: 'Department',
  room: 'Room',
  phone: 'Phone',
  website: 'Website',
  bio: 'About',
  openDialog: 'Open dialog',
  fullName: 'Full name',
  login: 'Login',
  websiteVersion: 'Website version',
  status: 'Status',
  securityPhoto: 'Security and photo',
  profileTabProfile: 'Profile',
  profileTabAppearance: 'Appearance',
  profileTabChat: 'Chat',
  profileTabFeed: 'Feed',
  profileTabSecurity: 'Security',
  appearance: 'Appearance',
  theme: 'Theme',
  density: 'Density',
  textSize: 'Text',
  changePhoto: 'Change photo',
  removePhoto: 'Remove photo',
  dialogTools: 'Additional dialog tools',
  feedTools: 'Additional feed tools',
  currentPassword: 'Current password',
  newPassword: 'New password',
  updatePassword: 'Update password',
  logout: 'Log out',
  requestHint: 'Fill in category, priority and description — the request status will appear right after sending.',
  ticketNumber: 'Number',
  techSupportContacts: 'Technical support contacts',
  techSupport: 'Technical support',
  techSupportDepartment: 'Software and technical support department for computing equipment',
  techSupportText: 'For computer, software, service access and equipment issues, contact technical support. To keep the request visible and route it faster, please submit it through the form below.',
  leadSpecialist: 'Lead specialist',
  internalPhone: 'Internal phone',
  mobile: 'Mobile',
  requestEyebrow: 'Service request',
  requestTitle: 'Report a problem',
  category: 'Category',
  priority: 'Priority',
  requestPlaceholder: 'Example: room 204, printer is not working, connection check required...',
  sendingRequest: 'Sending...',
  sendRequest: 'Send request',
  refreshing: 'Refreshing...',
  refreshStatuses: 'Refresh statuses',
  requestsUnavailable: 'Requests are temporarily unavailable',
  feedTitle: 'Employee feed',
  feedSubtitle: 'Announcements, news and photo reports.',
  feedUnavailable: 'Feed is temporarily unavailable',
  photoVideo: 'Photo/video',
  publishing: 'Publishing...',
  publish: 'Publish',
  searchFeed: 'Search feed',
  clearSearch: 'Clear search',
  refresh: 'Refresh',
  whatsNew: 'What’s new?',
  noPosts: 'No posts yet',
  tryAnotherSearch: 'Try another search',
  firstPostHint: 'Be the first to share news, photos or an announcement.',
  back: 'Back',
  youTyping: 'You are typing…',
  confirm: 'Confirmation',
  deleteAttachmentConfirm: 'Delete this attachment only?',
  deleteAttachmentTitle: 'Delete attachment',
  deleteMediaFromPost: 'Delete {type} {name} from the post?',
  deleteLastPostAttachment: 'This is the last attachment. Delete the entire post?',
  deletePostTitle: 'Delete post',
  deletePhotoType: 'photo',
  deleteVideoType: 'video',
  showExtraMessageActionsTitle: 'Show additional message actions',
  showExtraMessageActionsHint: 'Editing, multi-select, requests, tasks and attachment downloads. Hidden by default.',
  showChatTemplatesTitle: 'Show message templates',
  showChatTemplatesHint: 'Hidden by default. Enable if you need quick text templates.',
  showDialogMediaPanelTitle: 'Show “Media / Files” in dialog',
  showDialogMediaPanelHint: 'Hidden by default. Enable if you need the right panel with media, files and links.',
  showDialogDateJumpTitle: 'Show “Jump to date”',
  showDialogDateJumpHint: 'Hidden by default to keep the chat header compact.',
  showConversationMenuTitle: 'Show dialog actions menu',
  showConversationMenuHint: 'Archive, hide, pin, mark unread and delete conversation. Hidden by default.',
  showDialogFiltersTitle: 'Show message filters',
  showDialogFiltersHint: 'All, mine, peer, with files, photo, today, week and month.',
  showFeedCategorySelectTitle: 'Show post category selector',
  showFeedCategorySelectHint: 'Announcement, news, question, greeting and other categories. Hidden by default.',
  showFeedFiltersTitle: 'Show feed filters',
  showFeedFiltersHint: 'Filter button to the right of feed search. Hidden by default.',
  edit: 'Edit',
  selectMultiple: 'Select multiple',
  createRequest: 'Create request',
  addToRequest: 'Add to request',
  createTask: 'Create task',
  assignExecutor: 'Assign executor',
  setDeadline: 'Set deadline',
  downloadAttachments: 'Download attachments',
  cancel: 'Cancel',
  openAttachment: 'Open attachment',
  media: 'media',
  attachmentAlt: 'Attachment',
  copy: 'Copy',
  forward: 'Forward',
  pin: 'Pin',
  unpin: 'Unpin',
  editText: 'Edit text',
  copyLink: 'Copy link',
  sharePost: 'Share post to chat',
  quotePost: 'Quote post',
  hidePost: 'Hide post',
  selectPost: 'Select post',
  selectedPost: 'Post selected',
  save: 'Save',
  share: 'Share',
  unsupportedVideo: 'Your browser does not support video playback.',
  photoAlt: 'Photo',
  reply: 'Reply',
  delete: 'Delete',
  sendComment: 'Send',
  showAllComments: 'Show all comments',
  hideComments: 'Hide comments',
  comments: 'Comments',
  noComments: 'No comments yet.',
  writeComment: 'Write a comment…',
  saveProfile: 'Save profile',
  dropFiles: 'Drop files here',
  dropFilesHint: 'They will be added to the current message',
  jumpToDate: 'Jump to date',
  mediaSearch: 'Search by file name or link...',
  downloadArchive: 'Download all as archive',
  archiveUnavailable: 'Archive download will be available after the server archive service is connected.',
  pinnedMessages: 'Pinned',
  selectedCount: 'Selected',
  photo: 'Photo',
  document: 'Document',
  attachmentPlaceholder: 'attachment',
  noMessageSearchResults: 'Nothing matched your search.',
  loadMoreSearchResults: 'Show more results',
  searchingMessages: 'Searching the full conversation…',
  noMessages: 'No messages yet.',
  deliverySending: 'Sending…',
  deliveryWaiting: 'Waiting for connection',
  deliveryError: 'Error',
  forwardedFrom: 'Forwarded from',
  originalMessageDeleted: 'Original message was deleted',
  deletedMessage: 'Message deleted',
  changed: 'edited',
  retrySend: 'Retry sending',
  templates: 'Templates',
  myTemplate: 'My template',
  replyTo: 'Reply to',
  myAvatar: 'My avatar',
  retryLoad: 'Retry loading',
  pinned: 'Pinned',
  activeRequests: 'My active requests',
  noActiveRequests: 'There are no active requests. New ones will appear here after submission.',
  waitingTime: 'Waiting',
  workTime: 'In progress',
  administrator: 'Administrator',
  administratorAccepted: 'The request has been accepted. Please wait for the assigned specialist.',
  administratorEta: 'A specialist will arrive in {minutes} minutes',
  workCompleted: 'Work completed',
  requestDone: 'Request completed',
  issueRemains: 'Issue remains',
  completedHistory: 'Completed request history',
  requestFillDescription: 'Please enter a request description.',
  requestSubmitted: 'Request submitted. Status: waiting for an administrator.',
  requestNetworkError: 'A network error prevented submission. Please try again.',
  profilePhoto: 'Profile photo',
  understood: 'Got it',
  confirmActionButton: 'Confirm',
  saveActionButton: 'Save',
  viewerActions: 'Photo actions',
  thumbnailAlt: 'Thumbnail',
  forwardMessageTitle: 'Forward message',
  forwardMessageHint: 'Choose an employee or administrator to receive a copy of this message.',
  attachmentWithoutText: 'Attachment without text',
  noRecipients: 'No recipients available',
  employeeManagement: 'Employee management',
  employeeLogin: 'Login (email)',
  password: 'Password',
  newPasswordLabel: 'New password',
  passwordKeepHint: 'Leave this field blank to keep the current password.',
  passwordKeepPlaceholder: 'Leave blank to keep unchanged',
  loginPasswordPlaceholder: 'Login password',
  passwordMinHint: 'At least 8 characters.',
  employeeDepartmentPlaceholder: 'Employee department',
  showPassword: 'Show password',
  add: 'Add',
  employeeMessages: 'Employee conversations',
  auditSearch: 'Search participants and messages',
  showEmptyArchived: 'Show empty or archived',
  attachmentsOnly: 'Attachments only',
  deletedOnly: 'Deleted only',
  noAuditDialogs: 'No conversations match the filters.',
  chooseConversation: 'Choose a conversation.',
  messagesShort: 'msg.',
  deletedShort: 'deleted',
  lastMessage: 'last',
  noMessagesShort: 'no messages',
  deletedBy: 'Deleted by',
  history: 'History',
  change: 'change',
  profileNamePlaceholder: 'Ivan Ivanov',
  positionPlaceholder: 'Example: engineer',
  departmentPlaceholder: 'Department name',
  roomPlaceholder: 'Example: 214',
  phonePlaceholder: 'Example: 12-34',
  statusPlaceholder: 'Short status',
  bioPlaceholder: 'A few words about yourself',
  themeLight: 'Light — current',
  themeDark: 'New — service',
  densityRegular: 'Regular',
  densityCompact: 'Compact',
  textSmall: 'Smaller',
  textMedium: 'Regular',
  textLarge: 'Larger'
};
const ENGLISH_TAB_LABELS = { feed: 'Feed', chat: 'Chat', request: 'Request', employees: 'Employees', audit: 'Audit' };
const ENGLISH_CONTACT_FILTER_LABELS = { all: 'All', online: 'Online', unread: 'Unread', managers: 'Managers', department: 'My department', favorites: 'Favorites', recent: 'Recent', attachments: 'With attachments', tickets: 'With requests' };
const RUNTIME_TEXT_EN = {
  'Готово': 'Done',
  'Подтверждение': 'Confirmation',
  'Редактирование': 'Edit',
  'Мой шаблон': 'My template',
  'Введите быстрый шаблон:': 'Enter a quick template:',
  'Чат': 'Chat',
  'Лента': 'Feed',
  'Заявки': 'Requests',
  'Фото профиля': 'Profile photo',
  'Подтверждение отправки': 'Send confirmation',
  'Офлайн': 'Offline',
  'Сообщение': 'Message',
  'Вложения': 'Attachments',
  'Календарь': 'Calendar',
  'Профиль': 'Profile',
  'Пароль': 'Password',
  'Заявка': 'Request',
  'Заявка выполнена': 'Request completed',
  'Комментарий к закрытию': 'Completion comment',
  'Проблема осталась': 'Issue remains',
  'Заявка переоткрыта': 'Request reopened',
  'Копирование': 'Copy',
  'Удаление сообщений': 'Delete messages',
  'Реакция': 'Reaction',
  'Закрепление': 'Pin',
  'Удаление сообщения': 'Delete message',
  'Переслать': 'Forward',
  'Очистка диалога': 'Clear conversation',
  'Финальное подтверждение': 'Final confirmation',
  'Переписка': 'Conversation',
  'Сотрудники': 'Employees',
  'Удаление сотрудника': 'Delete employee',
  'Подтверждение публикации': 'Publish confirmation',
  'Вложение': 'Attachment',
  'Не удалось загрузить анкету': 'Could not load the profile',
  'Не удалось загрузить предыдущие сообщения': 'Could not load previous messages',
  'Не удалось загрузить ленту': 'Could not load the feed',
  'Лента временно недоступна': 'The feed is temporarily unavailable',
  'Не удалось загрузить заявки': 'Could not load requests',
  'Не удалось сохранить сообщение': 'Could not save the message',
  'Не удалось сохранить изменение': 'Could not save the change',
  'Разрешены только PNG, JPG, WEBP.': 'Only PNG, JPG and WEBP files are allowed.',
  'Фото слишком большое. Рекомендуется до 5MB.': 'The photo is too large. Use a file up to 5 MB.',
  'Не удалось сохранить аватар': 'Could not save the profile photo',
  'Не удалось обработать изображение. Попробуйте другое фото.': 'Could not process the image. Please choose another photo.',
  'Не удалось удалить аватар': 'Could not remove the profile photo',
  'Нет соединения. Сообщение ожидает отправки.': 'No connection. The message is waiting to be sent.',
  'Нет соединения. Сообщение отправится автоматически.': 'No connection. The message will be sent automatically.',
  'Не удалось отправить сообщение': 'Could not send the message',
  'Не удалось загрузить файл': 'Could not upload the file',
  'Не удалось прикрепить файл.': 'Could not attach the file.',
  'Скриншот прикреплён': 'Screenshot attached',
  'Файл прикреплён': 'File attached',
  'В этот день сообщений нет': 'There are no messages on this date',
  'Не удалось сохранить анкету': 'Could not save the profile',
  'Анкета сохранена': 'Profile saved',
  'Пароль обновлён. При следующем входе используйте новый пароль.': 'Password updated. Use the new password next time you sign in.',
  'Не удалось сменить пароль': 'Could not change the password',
  'Пароль обновлён': 'Password updated',
  'Не удалось открыть профиль сотрудника': 'Could not open the employee profile',
  'Отправка заявки...': 'Sending request...',
  'Если хотите, оставьте комментарий к закрытию заявки. Можно оставить пустым.': 'Optionally add a completion comment. You may leave it blank.',
  'Закрыть заявку без комментария?': 'Close the request without a comment?',
  'Не удалось подтвердить заявку': 'Could not confirm the request',
  'Спасибо! Заявка закрыта и время выполнения сохранено.': 'Thank you. The request is closed and its completion time was saved.',
  'Что осталось неисправным? Администратор увидит комментарий.': 'What is still not working? The administrator will see your comment.',
  'Не удалось переоткрыть заявку': 'Could not reopen the request',
  'Заявка возвращена администратору.': 'The request was returned to the administrator.',
  'Нельзя сохранить пустое сообщение без вложений': 'A message must contain text or an attachment',
  'Не удалось изменить сообщение': 'Could not edit the message',
  'Выбранные сообщения скопированы': 'Selected messages copied',
  'Не удалось скопировать выбранные сообщения': 'Could not copy the selected messages',
  'Не удалось поставить реакцию': 'Could not add the reaction',
  'Не удалось закрепить сообщение': 'Could not pin the message',
  'Удалить сообщение? Вместо полного удаления оно будет скрыто и останется в аудите.': 'Delete this message? It will be hidden but retained in the audit log.',
  'Не удалось удалить сообщение': 'Could not delete the message',
  'Изменить текст сообщения:': 'Edit message text:',
  'В сообщении нет текста для копирования': 'This message has no text to copy',
  'Текст сообщения скопирован': 'Message text copied',
  'Не удалось скопировать текст': 'Could not copy the text',
  'Сообщение переслано': 'Message forwarded',
  'Не удалось переслать сообщение': 'Could not forward the message',
  'Для подтверждения введите УДАЛИТЬ:': 'Type DELETE to confirm:',
  'Не удалось очистить переписку': 'Could not clear the conversation',
  'Укажите логин и пароль (для нового сотрудника).': 'Enter a login and password for the new employee.',
  'Не удалось сохранить сотрудника': 'Could not save the employee',
  'Удалить сотрудника? Его учётная запись будет удалена.': 'Delete this employee account?',
  'Не удалось удалить сотрудника': 'Could not delete the employee',
  'Не удалось опубликовать запись': 'Could not publish the post',
  'Не удалось обновить публикацию': 'Could not update the post',
  'Не удалось загрузить комментарии': 'Could not load comments',
  'Не удалось загрузить сообщения': 'Could not load messages',
  'Хранилище сообщений временно недоступно': 'Message storage is temporarily unavailable',
  'Для доступа к переписке требуется вход': 'Please sign in again to access this conversation',
  'Нет доступа к этой переписке': 'You do not have access to this conversation',
  'Некорректный курсор пагинации сообщений': 'The message pagination cursor is invalid',
  'Не удалось загрузить ленту: сервер вернул страницу сайта вместо данных API': 'Could not load the feed because the server returned the website page instead of API data.',
  'Не удалось загрузить сообщения: сервер вернул страницу сайта вместо данных API': 'Could not load messages because the server returned the website page instead of API data.',
  'Не удалось добавить комментарий': 'Could not add the comment',
  'Публикация изменена': 'Post updated',
  'Не удалось изменить публикацию': 'Could not update the post',
  'Жалоба отправлена модератору': 'Report sent to the moderator',
  'Ссылка скопирована': 'Link copied',
  'Скопируйте ссылку на публикацию': 'Copy the post link',
  'Удалить публикацию из ленты?': 'Delete this post from the feed?',
  'Не удалось удалить публикацию': 'Could not delete the post',
  'Не удалось удалить комментарий': 'Could not delete the comment',
  'Не удалось обновить реакцию': 'Could not update the reaction',
  'Не удалось закрепить публикацию': 'Could not pin the post',
  'Не удалось удалить вложение': 'Could not delete the attachment',
  'Фото удалено': 'Photo deleted',
  'Видео удалено': 'Video deleted',
  'История есть в аудите': 'Change history is available in the audit log',
  'История изменений пуста': 'There is no change history'
};

const translateRuntimeText = (value, isEnglish = false) => {
  const text = String(value || '');
  if (!isEnglish || !text) return text;
  if (RUNTIME_TEXT_EN[text]) return RUNTIME_TEXT_EN[text];
  const networkSuffix = '. Проверьте соединение и попробуйте ещё раз.';
  if (text.endsWith(networkSuffix)) {
    const translatedBase = RUNTIME_TEXT_EN[text.slice(0, -networkSuffix.length)];
    return translatedBase
      ? `${translatedBase}. Check your connection and try again.`
      : 'The action could not be completed. Check your connection and try again.';
  }

  const dynamicPatterns = [
    [/^Отправить (\d+) файлов одним сообщением\?$/, 'Send $1 files in one message?'],
    [/^Опубликовать (\d+) файлов одной записью\?$/, 'Publish $1 files in one post?'],
    [/^Удалить выбранные сообщения: (\d+)\?$/, 'Delete $1 selected messages?'],
    [/^Файл (.+) слишком большой\. Максимум (\d+) МБ\.$/, 'File $1 is too large. Maximum size is $2 MB.'],
    [/^Очистить диалог с (.+)\? Будет скрыто сообщений: (\d+), вложений: (\d+)\. Действие останется в аудите\.$/, 'Clear the conversation with $1? Messages hidden: $2; attachments hidden: $3. The action will remain in the audit log.']
  ];
  for (const [pattern, replacement] of dynamicPatterns) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }

  return /[А-Яа-яЁё]/.test(text) ? 'The action could not be completed. Please try again.' : text;
};
const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};
const FEED_CATEGORIES = ['Объявление', 'Новость', 'Вопрос', 'Важно', 'Фотоотчёт', 'Потеряно/найдено', 'Заявка', 'Поздравление'];
const ENGLISH_FEED_CATEGORY_LABELS = {
  Объявление: 'Announcement',
  Новость: 'News',
  Вопрос: 'Question',
  Важно: 'Important',
  Фотоотчёт: 'Photo report',
  'Потеряно/найдено': 'Lost and found',
  Заявка: 'Request',
  Поздравление: 'Greeting'
};
const ENGLISH_REQUEST_CATEGORY_LABELS = {
  Техника: 'Equipment',
  Сеть: 'Network',
  ПО: 'Software',
  Доступы: 'Access',
  Другое: 'Other'
};
const ENGLISH_REQUEST_PRIORITY_LABELS = {
  Обычный: 'Normal',
  Важный: 'Important',
  Срочный: 'Urgent'
};
const CHAT_FILTERS = [
  { id: 'all', label: 'Все', labelEn: 'All' },
  { id: 'mine', label: 'Мои', labelEn: 'Mine' },
  { id: 'peer', label: 'Собеседник', labelEn: 'Peer' },
  { id: 'files', label: 'С файлами', labelEn: 'With files' },
  { id: 'photo', label: 'Фото', labelEn: 'Photo' },
  { id: 'today', label: 'Сегодня', labelEn: 'Today' },
  { id: 'week', label: 'Неделя', labelEn: 'Week' },
  { id: 'month', label: 'Месяц', labelEn: 'Month' }
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
  { id: 'media', label: 'Медиа', labelEn: 'Media' },
  { id: 'files', label: 'Файлы', labelEn: 'Files' },
  { id: 'links', label: 'Ссылки', labelEn: 'Links' }
];
const AUDIT_PERIODS = [
  { id: 'all', label: 'Все', labelEn: 'All' },
  { id: 'today', label: 'Сегодня', labelEn: 'Today' },
  { id: 'week', label: 'Неделя', labelEn: 'Week' },
  { id: 'month', label: 'Месяц', labelEn: 'Month' }
];
const CHAT_THEMES = [
  { id: 'light', labelKey: 'themeLight' },
  { id: 'dark', labelKey: 'themeDark' }
];
const CHAT_DENSITIES = [
  { id: 'regular', labelKey: 'densityRegular' },
  { id: 'compact', labelKey: 'densityCompact' }
];
const CHAT_TEXT_SIZES = [
  { id: 'small', labelKey: 'textSmall' },
  { id: 'medium', labelKey: 'textMedium' },
  { id: 'large', labelKey: 'textLarge' }
];
const APPLICATION_STATUS_META = {
  new: { label: 'Новая', labelEn: 'New', hint: 'Ожидает администратора', hintEn: 'Waiting for an administrator', tone: 'new' },
  accepted: { label: 'Принята', labelEn: 'Accepted', hint: 'Администратор назначил исполнителя', hintEn: 'An administrator assigned a specialist', tone: 'accepted' },
  in_progress: { label: 'В работе', labelEn: 'In progress', hint: 'Если работа уже выполнена — подтвердите её закрытие', hintEn: 'Confirm completion if the work is already done', tone: 'confirm' },
  waiting_employee_confirmation: { label: 'Проверьте выполнение', labelEn: 'Check completion', hint: 'Подтвердите, если проблема решена', hintEn: 'Confirm if the issue is resolved', tone: 'confirm' },
  done: { label: 'Выполнена', labelEn: 'Completed', hint: 'Заявка закрыта', hintEn: 'Request closed', tone: 'done' },
  reopened: { label: 'Переоткрыта', labelEn: 'Reopened', hint: 'Администратор снова увидит заявку', hintEn: 'An administrator will see the request again', tone: 'reopened' }
};


const transliterateCyrillic = (value = '') => String(value)
  .split('')
  .map((char) => CYRILLIC_TO_LATIN[char.toLowerCase()] ?? char)
  .join('');

const formatEnglishProfileLogin = (value = '') => {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  const [surname = '', ...restParts] = normalized.split(' ');
  const surnameLatin = transliterateCyrillic(surname).toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  const initials = restParts.join(' ').replace(/\s+/g, '').split('.').filter(Boolean)
    .map((part) => transliterateCyrillic(part).charAt(0).toUpperCase())
    .join('.');
  return initials ? `${surnameLatin} ${initials}` : surnameLatin;
};

const getWebsiteByLanguage = (language = DEFAULT_PROFILE_WEBSITE_LANGUAGE) => PROFILE_WEBSITE_BY_LANGUAGE[language] || PROFILE_WEBSITE_BY_LANGUAGE[DEFAULT_PROFILE_WEBSITE_LANGUAGE];

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

const getReadTimestamp = (value) => {
  const dateValue = value && typeof value === 'object'
    ? (value.lastReadAt || value.updatedAt)
    : value;
  const timestamp = dateValue ? new Date(dateValue).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getReadMessageId = (value) => (
  value && typeof value === 'object' ? String(value.lastReadMessageId || '') : ''
);

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
      showConversationMenu: false,
      showFeedCategorySelect: false,
      showFeedFilters: false,
      ...(all?.[username] || {})
    };
  } catch {
    return { archived: [], hidden: [], pinned: [], muted: [], favorites: [], uiTheme: 'light', uiDensity: 'regular', uiTextSize: 'medium', showChatTemplates: false, showExtraMessageActions: false, showDialogMediaPanel: false, showDialogFilters: false, showDialogDateJump: false, showConversationMenu: false, showFeedCategorySelect: false, showFeedFilters: false };
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
const getSafeExternalUrl = (value = '') => {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
};
const getLinkPreview = (url = '') => {
  try {
    const parsed = new URL(url);
    return {
      url,
      domain: parsed.hostname.replace(/^www\./, ''),
      title: parsed.hostname.replace(/^www\./, ''),
      description: parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : parsed.hostname.replace(/^www\./, '')
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
    if (Object.prototype.hasOwnProperty.call(profile || {}, key)) {
      const value = profile?.[key];
      return value === undefined || value === null ? '' : value;
    }
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

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Не удалось подготовить изображение'));
      }, 'image/jpeg', 0.92);
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

const readApiJson = async (response, fallbackMessage = 'Ошибка API') => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    const error = new Error(`${fallbackMessage}: сервер вернул страницу сайта вместо данных API`);
    error.status = response.status;
    error.code = 'INVALID_API_RESPONSE';
    throw error;
  }

  const data = await response.json().catch(() => {
    const error = new Error(`${fallbackMessage}: сервер вернул повреждённый JSON`);
    error.status = response.status;
    error.code = 'INVALID_API_JSON';
    throw error;
  });

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || fallbackMessage);
    error.status = response.status;
    error.code = data?.code || '';
    throw error;
  }

  return data;
};

const fetchJsonWithRetry = async (url, options = {}, { attempts = 4, retryDelay = 450, fallbackMessage = 'Ошибка сети' } = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await authFetch(url, options);
      return await readApiJson(response, fallbackMessage);
    } catch (error) {
      lastError = error;
      const retryable = isNetworkFailure(error) || Number(error?.status || 0) >= 500;
      if (!retryable || attempt >= attempts - 1) break;
      await sleep(retryDelay + attempt * 350);
    }
  }

  throw lastError || new Error(fallbackMessage);
};

const createImageThumbnailDataUrl = (file, maxSize = 480) => new Promise((resolve) => {
  if (!String(file?.type || '').startsWith('image/')) {
    resolve({ thumbnailDataUrl: '', width: 0, height: 0, aspectRatio: 0, duration: 0 });
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => resolve({ thumbnailDataUrl: '', width: 0, height: 0, aspectRatio: 0, duration: 0 });
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => resolve({ thumbnailDataUrl: '', width: 0, height: 0, aspectRatio: 0, duration: 0 });
    image.onload = () => {
      const width = image.naturalWidth || image.width || maxSize;
      const height = image.naturalHeight || image.height || maxSize;
      const ratio = Math.min(1, maxSize / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const context = canvas.getContext('2d');
      if (!context) {
        resolve({ thumbnailDataUrl: '', width, height, aspectRatio: width / Math.max(1, height), duration: 0 });
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({
        thumbnailDataUrl: canvas.toDataURL('image/jpeg', 0.76),
        width,
        height,
        aspectRatio: width / Math.max(1, height),
        duration: 0
      });
    };
    image.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
});

const createVideoThumbnailDataUrl = (file, maxSize = 640) => new Promise((resolve) => {
  if (!isVideoAttachment(file)) {
    resolve({ thumbnailDataUrl: '', width: 0, height: 0, aspectRatio: 0, duration: 0 });
    return;
  }

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  let settled = false;
  let mediaMetadata = { width: 0, height: 0, aspectRatio: 0, duration: 0 };
  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
  };
  const finish = (thumbnailDataUrl = '') => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve({ thumbnailDataUrl, ...mediaMetadata });
  };

  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.onloadedmetadata = () => {
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    mediaMetadata = {
      width,
      height,
      aspectRatio: width / Math.max(1, height),
      duration: Number.isFinite(video.duration) ? video.duration : 0
    };
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
  return { thumbnailDataUrl: '', width: 0, height: 0, aspectRatio: 0, duration: 0 };
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

const formatDateLabel = (dateValue, isEnglish = false) => {
  const date = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const key = date.toDateString();
  if (key === today.toDateString()) return isEnglish ? 'Today' : 'Сегодня';
  if (key === yesterday.toDateString()) return isEnglish ? 'Yesterday' : 'Вчера';
  return date.toLocaleDateString(isEnglish ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const getDateKey = (dateValue) => new Date(dateValue).toDateString();

const isVideoAttachment = (file = {}) => String(file.type || '').startsWith('video/') || VIDEO_EXTENSION_PATTERN.test(String(file.name || ''));

const formatFileSize = (size = 0) => {
  const bytes = Number(size) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  author: post?.author,
  authorName: post?.authorName,
  text: post?.text,
  category: post?.category,
  pinned: Boolean(post?.pinned),
  updatedAt: post?.updatedAt,
  editedAt: post?.editedAt,
  deletedAt: post?.deletedAt,
  comments: Array.isArray(post?.comments) ? post.comments.map((comment) => `${comment?.id}:${comment?.updatedAt || ''}:${comment?.deletedAt || ''}`).join('|') : '',
  commentCount: Number(post?.commentCount) || 0,
  attachments: getFeedAttachments(post).map((file) => file?.id || file?.url || file?.name || '').join('|'),
  reactions: post?.reactions
    ? Object.entries(post.reactions).sort(([left], [right]) => left.localeCompare(right)).map(([emoji, items]) => `${emoji}:${Array.isArray(items) ? [...items].sort().join(',') : ''}`).join('|')
    : ''
})));

const getVisibleFeedPosts = (posts = []) => (Array.isArray(posts) ? posts.filter((post) => post && !post.deletedAt) : []);
const sortFeedPosts = (posts = []) => [...posts].sort((a, b) => (
  Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
  || new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  || String(b.id || '').localeCompare(String(a.id || ''))
));

const setFeedReactionForUser = (post = {}, emoji, login, active) => {
  const reactions = { ...(post.reactions || {}) };
  const users = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji] : []);
  if (active) users.add(login);
  else users.delete(login);
  if (users.size) reactions[emoji] = [...users];
  else delete reactions[emoji];
  return { ...post, reactions };
};

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
const getCurrentAttachmentIdentity = () => {
  try {
    const authState = JSON.parse(localStorage.getItem('authState') || 'null');
    return {
      login: String(authState?.user?.username || '').trim(),
      accessToken: String(authState?.user?.accessToken || '').trim()
    };
  } catch {
    return { login: '', accessToken: '' };
  }
};

const appendAttachmentLogin = (url = '') => {
  const { accessToken } = getCurrentAttachmentIdentity();
  if (
    !accessToken
    || (!url.includes('/api/chat/files/') && !url.includes('/api/auth/profile/'))
  ) return url;
  return withAccessToken(url);
};

const resolveAttachmentUrl = (url = '') => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (/^https?:\/\//i.test(url)) return appendAttachmentLogin(url);
  const fileBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
  return appendAttachmentLogin(`${fileBaseUrl}${url.startsWith('/') ? url : `/${url}`}`);
};
const getAttachmentUrl = (file = {}) => resolveAttachmentUrl(file.thumbnailUrl || file.previewUrl || file.url || file.dataUrl || '');
const getOriginalAttachmentUrl = (file = {}) => resolveAttachmentUrl(file.url || file.dataUrl || file.previewUrl || file.thumbnailUrl || '');
const getVideoPosterUrl = (file = {}) => {
  const originalSources = new Set([file.url, file.dataUrl].filter(Boolean));
  const posterSource = [file.posterUrl, file.thumbnailUrl, file.previewUrl]
    .find((source) => source && !originalSources.has(source));
  return resolveAttachmentUrl(posterSource || '');
};
const getAttachmentAspectRatio = (file = {}, fallback = 4 / 3) => {
  const storedRatio = Number(file.aspectRatio)
    || (Number(file.width) / Math.max(1, Number(file.height)));
  if (!Number.isFinite(storedRatio) || storedRatio <= 0) return fallback;
  return Math.min(3, Math.max(0.35, storedRatio));
};
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

const AttachmentPreviewImage = React.memo(function AttachmentPreviewImage({ file, alt, useOriginal = false, eager = false, isEnglish = false }) {
  const preferredSource = useOriginal ? getOriginalAttachmentUrl(file) : getAttachmentUrl(file);
  const fallbackSource = getOriginalAttachmentUrl(file);
  const [source, setSource] = useState(preferredSource || fallbackSource);
  const [state, setState] = useState('loading');

  useEffect(() => {
    setSource(preferredSource || fallbackSource);
    setState('loading');
  }, [fallbackSource, preferredSource]);

  const handleError = () => {
    if (fallbackSource && source !== fallbackSource) {
      setSource(fallbackSource);
      setState('loading');
      return;
    }
    setState('error');
  };

  return (
    <span className={`attachment-image-shell is-${state}`}>
      {source && state !== 'error' && (
        <img
          src={source}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('ready')}
          onError={handleError}
        />
      )}
      {state !== 'ready' && (
        <span className="attachment-image-placeholder" aria-hidden="true">
          <span>{state === 'error' ? '🖼' : ''}</span>
          <small>{state === 'error' ? (isEnglish ? 'Preview unavailable' : 'Превью недоступно') : ''}</small>
        </span>
      )}
    </span>
  );
});

const PlayableVideo = React.memo(function PlayableVideo({ file, className = '', onExpand, isEnglish = false, variant = 'message' }) {
  const storedRatio = getAttachmentAspectRatio(file, 16 / 9);
  const getOrientation = (ratio) => ratio < 0.82 ? 'portrait' : ratio > 1.2 ? 'landscape' : 'square';
  const [orientation, setOrientation] = useState(() => getOrientation(storedRatio));

  useEffect(() => {
    setOrientation(getOrientation(getAttachmentAspectRatio(file, 16 / 9)));
  }, [file]);

  const handleMetadata = (event) => {
    const video = event.currentTarget;
    const ratio = Number(video.videoWidth || 0) / Math.max(1, Number(video.videoHeight || 0));
    setOrientation(ratio < 0.82 ? 'portrait' : ratio > 1.2 ? 'landscape' : 'square');
    nudgeVideoToFirstFrame(event);
  };

  return (
    <div className={`playable-video-shell ${variant} is-${orientation} ${className}`} style={{ aspectRatio: storedRatio }}>
      <video
        className="attachment-video-player"
        src={getOriginalAttachmentUrl(file)}
        poster={getVideoPosterUrl(file) || undefined}
        controls
        preload="metadata"
        playsInline
        onLoadedMetadata={handleMetadata}
        onClick={(event) => event.stopPropagation()}
      >
        {isEnglish ? 'Your browser does not support video playback.' : 'Ваш браузер не поддерживает просмотр этого видео.'}
      </video>
      {onExpand && (
        <button
          type="button"
          className="media-expand-button"
          aria-label={isEnglish ? 'Open video viewer' : 'Открыть видео на весь экран'}
          title={isEnglish ? 'Open viewer' : 'Развернуть'}
          onClick={(event) => {
            event.stopPropagation();
            onExpand(event);
          }}
        >
          ⛶
        </button>
      )}
    </div>
  );
});

const AttachmentCard = React.memo(function AttachmentCard({ file, cardKey, variant = 'message', onOpen, onSelect, onQuickReaction, metaLabel = '', statusLabel = '', isEnglish = false }) {
  const fileName = file?.name || (isEnglish ? 'File' : 'Файл');
  const fileType = String(file?.type || '');
  const isImage = fileType.startsWith('image/');
  const isVideo = isVideoAttachment(file);
  const cardClassName = `${variant === 'feed' ? 'employee-feed-attachment-card' : 'message-attachment-card'} ${isVideo ? 'video-attachment' : ''}`;

  if (variant === 'message' && isImage) {
    return (
      <div key={cardKey} className="message-photo-card" style={{ aspectRatio: getAttachmentAspectRatio(file) }}>
        <button
          type="button"
          className="message-photo-open"
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
          aria-label={`${isEnglish ? 'Open photo' : 'Открыть фото'} ${fileName}`}
        >
          <AttachmentPreviewImage file={file} alt={fileName} eager isEnglish={isEnglish} />
          {(metaLabel || statusLabel) && <span className="message-photo-meta">{metaLabel} {statusLabel}</span>}
        </button>
        {onSelect && (
          <button
            type="button"
            className="media-reaction-trigger"
            aria-label={isEnglish ? 'Open photo reactions' : 'Открыть реакции к фото'}
            title={isEnglish ? 'Reactions' : 'Реакции'}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(event);
            }}
          >
            ♡
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      key={cardKey}
      className={cardClassName}
      onClick={isVideo ? (event) => event.stopPropagation() : undefined}
    >
      {isVideo ? (
        <PlayableVideo file={file} onExpand={onOpen} isEnglish={isEnglish} variant={variant} />
      ) : isImage ? (
        <AttachmentPreviewImage file={file} alt={fileName} useOriginal={variant === 'feed'} isEnglish={isEnglish} />
      ) : (
        <span className="file-icon">{getFileIcon(fileType)}</span>
      )}
      {variant === 'message' && isVideo ? (
        <button
          type="button"
          className="media-attachment-reaction-zone"
          aria-label={isEnglish ? `Open reactions for ${fileName}` : `Открыть реакции к ${fileName}`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(event);
          }}
        >
          <span>{fileName} · {formatFileSize(file?.size)}</span>
          <b aria-hidden="true">☺</b>
        </button>
      ) : (variant !== 'message' || !isImage) && <small>{fileName} · {formatFileSize(file?.size)}</small>}
      {variant !== 'message' && (
        <div className="attachment-card-actions">
          <a href={getOriginalAttachmentUrl(file)} download={fileName}>{isEnglish ? 'Download' : 'Скачать'}</a>
          <button type="button" onClick={() => openAttachmentInNewTab(file)}>{isEnglish ? 'Open' : 'Открыть'}</button>
        </div>
      )}
      {variant === 'message' && !isVideo && !isImage && (
        <div className="attachment-card-actions">
          <a href={getOriginalAttachmentUrl(file)} download={fileName}>{isEnglish ? 'Download' : 'Скачать'}</a>
          <button type="button" onClick={() => openAttachmentInNewTab(file)}>{isEnglish ? 'Open' : 'Открыть'}</button>
        </div>
      )}
    </div>
  );
});

const FeedMediaCard = React.memo(function FeedMediaCard({ file, onOpen, onQuickReaction, isEnglish = false }) {
  const isVideo = isVideoAttachment(file);
  const fileName = file?.name || (isEnglish ? 'Media' : 'Медиа');

  return (
    <div className={`employee-feed-media-tile ${isVideo ? 'video' : 'photo'}`}>
      {isVideo ? (
        <PlayableVideo file={file} onExpand={onOpen} isEnglish={isEnglish} variant="feed" />
      ) : (
        <button
          type="button"
          className="feed-media-open"
          style={{ aspectRatio: getAttachmentAspectRatio(file) }}
          aria-label={`${isEnglish ? 'Open photo' : 'Открыть фото'} ${fileName}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.(event);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onQuickReaction?.(event);
          }}
        >
          <AttachmentPreviewImage file={file} alt={fileName} useOriginal isEnglish={isEnglish} />
        </button>
      )}
      <span className="feed-media-caption">{fileName} · {formatFileSize(file?.size)}</span>
    </div>
  );
});

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

const getApplicationStatusMeta = (status, isEnglish = false) => {
  const meta = APPLICATION_STATUS_META[status] || APPLICATION_STATUS_META.new;
  return {
    ...meta,
    label: isEnglish ? meta.labelEn : meta.label,
    hint: isEnglish ? meta.hintEn : meta.hint
  };
};

const EmployeeChat = () => {
  const { user, logout, employeeDirectory, changeServicePassword } = useAuth();
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const baseDisplayName = user?.name || user?.username || 'Сотрудник';
  const isAdmin = user?.serverRole === 'admin' || user?.role === 'admin';
  const chatAuthHeaders = useMemo(() => ({
    ...(user?.accessToken ? { Authorization: `Bearer ${user.accessToken}` } : {})
  }), [user?.accessToken]);
   
  const avatarInputRef = useRef(null); 
  const messageTextareaRef = useRef(null);
  const profileDirtyRef = useRef(false);
  const profileLoadedForRef = useRef('');
  const notifyRef = useRef(() => {});
  const directoryEmployeesRef = useRef([]);
   
  const [threads, setThreads] = useState({});
  const [threadSummaries, setThreadSummaries] = useState({});
  const [threadHasMore, setThreadHasMore] = useState({});
  const [isLoadingOlderDialog, setIsLoadingOlderDialog] = useState(false);
  const [loadingConversationIds, setLoadingConversationIds] = useState({});
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draft, setDraft] = useState('');
  const [attachmentDrafts, setAttachmentDrafts] = useState([]);
  const [chatUploadQueue, setChatUploadQueue] = useState([]);
  const [pendingMessages, setPendingMessages] = useState(() => readPendingMessages(user?.username || 'guest'));
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [dialogSearch, setDialogSearch] = useState('');
  const [dialogSearchIndex, setDialogSearchIndex] = useState(0);
  const [serverDialogSearchResults, setServerDialogSearchResults] = useState([]);
  const [dialogSearchLoading, setDialogSearchLoading] = useState(false);
  const [dialogSearchHasMore, setDialogSearchHasMore] = useState(false);
  const [dialogSearchBefore, setDialogSearchBefore] = useState('');
  const [dialogFilter, setDialogFilter] = useState('all');
  const [visibleDialogMessageCount, setVisibleDialogMessageCount] = useState(CHAT_MESSAGES_PAGE_SIZE);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [mediaPanelTab, setMediaPanelTab] = useState('media');
  const [mediaPanelSearch, setMediaPanelSearch] = useState('');
  const [chatDrafts, setChatDrafts] = useState(() => readChatDrafts(user?.username || 'guest'));
  const chatDraftsRef = useRef(chatDrafts);
  const skipDraftSaveRef = useRef(false);
  const [chatLocalSettings, setChatLocalSettings] = useState(() => readChatLocalSettings(user?.username || 'guest'));
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [inlineEditMessageId, setInlineEditMessageId] = useState('');
  const [inlineEditText, setInlineEditText] = useState('');
  const [pinnedMessageIndex, setPinnedMessageIndex] = useState(0);
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
  const [visibleFeedPostCount, setVisibleFeedPostCount] = useState(FEED_POSTS_PAGE_SIZE);
  const [feedCategory, setFeedCategory] = useState(() => readSavedFeedDraft(user?.username || 'guest').category);
  const [editingFeedPostId, setEditingFeedPostId] = useState('');
  const [editingFeedText, setEditingFeedText] = useState('');
  const [hiddenFeedPostIds, setHiddenFeedPostIds] = useState(() => readHiddenFeedPosts(user?.username || 'guest'));
  const commentSort = 'old';
  const [expandedCommentPosts, setExpandedCommentPosts] = useState({});
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedBefore, setFeedBefore] = useState('');
  const [viewerTouchStart, setViewerTouchStart] = useState(null);
  const [forwardSourceMessage, setForwardSourceMessage] = useState(null);
  const [forwardingTargetEmail, setForwardingTargetEmail] = useState('');
  const [mediaViewer, setMediaViewer] = useState(null);
  const [readState, setReadState] = useState(() => readReadState(user?.username || 'guest'));
  const [feedReadAt, setFeedReadAt] = useState(() => readFeedReadAt(user?.username || 'guest'));
  const [directoryEmployees, setDirectoryEmployees] = useState(() => readDirectoryCache());
  const [isDirectoryLoaded, setIsDirectoryLoaded] = useState(() => readDirectoryCache().length > 0);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [welcomeNotice, setWelcomeNotice] = useState('');
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [profileViewLogin, setProfileViewLogin] = useState('');
  const [profileSettingsTab, setProfileSettingsTab] = useState('profile');
  const [profilePreview, setProfilePreview] = useState(null);
  const [profileForm, setProfileForm] = useState({
    full_name: user?.name || '',
    department: '',
    phone: '',
    room: '',
    position: user?.position || '',
    bio: '',
    websiteLanguage: DEFAULT_PROFILE_WEBSITE_LANGUAGE,
    website: getWebsiteByLanguage(),
    statusText: ''
  });
  const isEnglishInterface = (profileForm.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE) === 'en';
  const interfaceLocale = isEnglishInterface ? 'en-US' : 'ru-RU';
  const t = useCallback((key) => (isEnglishInterface ? ENGLISH_LABELS[key] : RUSSIAN_LABELS[key]) || key, [isEnglishInterface]);
  const getTabLabel = useCallback((tab) => (isEnglishInterface ? ENGLISH_TAB_LABELS[tab.id] : tab.label) || tab.label, [isEnglishInterface]);
  const getContactFilterLabel = useCallback((filter) => (isEnglishInterface ? ENGLISH_CONTACT_FILTER_LABELS[filter.id] : filter.label) || filter.label, [isEnglishInterface]);
  const getOptionLabel = useCallback((item) => item?.labelKey ? t(item.labelKey) : (isEnglishInterface ? item?.labelEn : item?.label) || item?.label || item?.id, [isEnglishInterface, t]);
  const getRequestCategoryLabel = useCallback((value) => isEnglishInterface ? (ENGLISH_REQUEST_CATEGORY_LABELS[value] || value) : value, [isEnglishInterface]);
  const getRequestPriorityLabel = useCallback((value) => isEnglishInterface ? (ENGLISH_REQUEST_PRIORITY_LABELS[value] || value) : value, [isEnglishInterface]);
  const getFeedCategoryLabel = useCallback((value) => isEnglishInterface ? (ENGLISH_FEED_CATEGORY_LABELS[value] || value) : value, [isEnglishInterface]);
  const formatVisibleLogin = useCallback((login = '') => (isEnglishInterface ? formatEnglishProfileLogin(login) : login), [isEnglishInterface]);
  const localizeRuntimeText = useCallback((value) => translateRuntimeText(value, isEnglishInterface), [isEnglishInterface]);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [requestText, setRequestText] = useState('');
  const [requestCategory, setRequestCategory] = useState(REQUEST_CATEGORIES[0]);
  const [requestPriority, setRequestPriority] = useState(REQUEST_PRIORITIES[0]);
  const [requestStatus, setRequestStatus] = useState({ state: 'idle', text: 'Черновик', ticketId: '' });
  const [myApplications, setMyApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState('');
  const [remoteTypingByConversation, setRemoteTypingByConversation] = useState({});
  const [feedPosts, setFeedPosts] = useState([]);
  const [pendingFeedActions, setPendingFeedActions] = useState([]);
  const [feedError, setFeedError] = useState('');
  const [feedDraft, setFeedDraft] = useState(() => readSavedFeedDraft(user?.username || 'guest').text);
  const [feedAttachments, setFeedAttachments] = useState([]);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [modal, setModal] = useState(null);
  const modalResolverRef = useRef(null);
  const messagesWrapRef = useRef(null);
  const feedListRef = useRef(null);
  const feedPostsRef = useRef([]);
  const threadsRef = useRef({});
  const pendingFeedActionsRef = useRef(new Set());
  const pendingFeedPostIdsRef = useRef(new Set());
  const feedMutationVersionRef = useRef(0);
  const feedFetchSequenceRef = useRef(0);
  const feedFetchControllerRef = useRef(null);
  const conversationFetchControllerRef = useRef(null);
  const forceScrollRef = useRef(false);
  const typingRequestControllerRef = useRef(null);
  const typingActiveConversationRef = useRef('');
  const uploadControllersRef = useRef(new Map());
  const seenStreamEventIdsRef = useRef(new Set());
  const settingsSyncTimerRef = useRef(null);

  const openModal = useCallback((config) => new Promise((resolve) => {
    modalResolverRef.current = resolve;
    setModal({
      value: config.defaultValue || '',
      ...config,
      title: localizeRuntimeText(config.title),
      message: localizeRuntimeText(config.message)
    });
  }), [localizeRuntimeText]);

  const closeModal = useCallback((result) => {
    const resolver = modalResolverRef.current;
    modalResolverRef.current = null;
    setModal(null);
    if (resolver) resolver(result);
  }, []);

  useEffect(() => {
    const selector = '.app-modal-card, .avatar-viewer, .photo-viewer-backdrop';
    const container = document.querySelector(selector);
    if (!container) return undefined;
    const previousFocus = document.activeElement;
    const getFocusable = () => [...container.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute('hidden'));
    const focusable = getFocusable();
    (focusable[0] || container).focus?.();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (modal) closeModal(false);
        else if (forwardSourceMessage) setForwardSourceMessage(null);
        else if (avatarViewerOpen) setAvatarViewerOpen(false);
        else if (mediaViewer) setMediaViewer(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, [avatarViewerOpen, closeModal, forwardSourceMessage, mediaViewer, modal]);

  const notify = useCallback((message, title = 'Готово') => {
    setModal({ type: 'info', title: localizeRuntimeText(title), message: localizeRuntimeText(message) });
  }, [localizeRuntimeText]);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const queueChatSettingsSync = useCallback((settings) => {
    const login = user?.username;
    if (!login) return;
    if (settingsSyncTimerRef.current) clearTimeout(settingsSyncTimerRef.current);
    settingsSyncTimerRef.current = setTimeout(async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/auth/profile/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: settings }),
          keepalive: true
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Не удалось синхронизировать настройки');
        }
      } catch (error) {
        console.error('Chat settings sync error:', error);
      }
    }, 350);
  }, [user?.username]);

  useEffect(() => () => {
    if (settingsSyncTimerRef.current) clearTimeout(settingsSyncTimerRef.current);
  }, []);

  useEffect(() => () => {
    uploadControllersRef.current.forEach((controller) => controller.abort());
    uploadControllersRef.current.clear();
  }, []);

  const beginFeedAction = useCallback((key, postId = '') => {
    if (
      !key
      || pendingFeedActionsRef.current.has(key)
      || (postId && pendingFeedPostIdsRef.current.has(postId))
    ) return false;
    pendingFeedActionsRef.current.add(key);
    if (postId) pendingFeedPostIdsRef.current.add(postId);
    feedMutationVersionRef.current += 1;
    setPendingFeedActions([...pendingFeedActionsRef.current]);
    return true;
  }, []);

  const endFeedAction = useCallback((key, postId = '') => {
    pendingFeedActionsRef.current.delete(key);
    if (postId) pendingFeedPostIdsRef.current.delete(postId);
    setPendingFeedActions([...pendingFeedActionsRef.current]);
  }, []);

  const isFeedPostPending = (postId) => pendingFeedPostIdsRef.current.has(postId);

  const updateFeedPostFromServer = useCallback((postId, serverPost) => {
    if (!postId || !serverPost) return;
    setFeedPosts((current) => current.map((post) => (
      post.id === postId ? { ...post, ...serverPost } : post
    )));
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
      const next = {
        ...prev,
        [field]: value,
        ...(field === 'websiteLanguage' ? { website: getWebsiteByLanguage(value) } : {})
      };
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
    role: 'employee',
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
    ...(isEnglishInterface
      ? (isManager ? MANAGER_TEMPLATE_MESSAGES_EN : EMPLOYEE_TEMPLATE_MESSAGES_EN)
      : (isManager ? MANAGER_TEMPLATE_MESSAGES : EMPLOYEE_TEMPLATE_MESSAGES)),
    ...customTemplates
  ], [customTemplates, isEnglishInterface, isManager]);
  const currentMessages = useMemo(() => (
    currentConversationId ? (threads[currentConversationId] || []) : []
  ), [currentConversationId, threads]);
  const isCurrentConversationLoading = Boolean(currentConversationId && (
    loadingConversationIds[currentConversationId]
    || !Object.prototype.hasOwnProperty.call(threads, currentConversationId)
  ));
  const selectedThreadMessages = selectedThreadId ? (threads[selectedThreadId] || []) : [];

  useEffect(() => {
    setVisibleDialogMessageCount(CHAT_MESSAGES_PAGE_SIZE);
  }, [currentConversationId, dialogFilter, dialogSearch]);

  useEffect(() => {
    setVisibleFeedPostCount(FEED_POSTS_PAGE_SIZE);
  }, [feedFilter, feedSearch]);

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
    feedPostsRef.current = feedPosts;
  }, [feedPosts]);

  useEffect(() => {
    if (!user?.username || feedPosts.length === 0) return;
    writeCachedFeed(user.username, {
      posts: feedPosts,
      cursor: feedBefore,
      hasMore: feedHasMore
    });
  }, [feedBefore, feedHasMore, feedPosts, user?.username]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    directoryEmployeesRef.current = directoryEmployees;
  }, [directoryEmployees]);

  useEffect(() => () => {
    feedFetchControllerRef.current?.abort();
  }, []);

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
      document.removeEventListene…24326 tokens truncated…) => {
      document.querySelector(`[data-message-id="${activeDialogSearchResult.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [activeDialogSearchResult?.id]);

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

  const paginatedVisibleMessages = useMemo(() => {
    const startIndex = Math.max(0, visibleMessages.length - visibleDialogMessageCount);
    return visibleMessages.slice(startIndex);
  }, [visibleMessages, visibleDialogMessageCount]);
  const hiddenDialogMessagesCount = Math.max(0, visibleMessages.length - paginatedVisibleMessages.length);

  const messagesWithDateSeparators = useMemo(() => {
    let lastDateKey = '';
    return paginatedVisibleMessages.flatMap((message) => {
      const currentDateKey = getDateKey(message.createdAt);
      const items = [];
      if (currentDateKey !== lastDateKey) {
        items.push({ type: 'date', id: `date-${currentDateKey}`, label: formatDateLabel(message.createdAt, isEnglishInterface) });
        lastDateKey = currentDateKey;
      }
      items.push({ type: 'message', id: message.id, message });
      return items;
    });
  }, [isEnglishInterface, paginatedVisibleMessages]);


  const visibleFeedPosts = useMemo(() => {
    const query = feedSearch.trim().toLowerCase();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    return sortFeedPosts(getVisibleFeedPosts(feedPosts)
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
      }));
  }, [feedFilter, feedPosts, feedReadTimestamp, feedSearch, hiddenFeedPostIds, user]);

  const pinnedFeedPosts = useMemo(() => visibleFeedPosts.filter((post) => post.pinned), [visibleFeedPosts]);
  const regularFeedPosts = useMemo(() => visibleFeedPosts.filter((post) => !post.pinned), [visibleFeedPosts]);
  const paginatedRegularFeedPosts = useMemo(() => regularFeedPosts.slice(0, visibleFeedPostCount), [regularFeedPosts, visibleFeedPostCount]);
  const hiddenFeedPostsCount = Math.max(0, regularFeedPosts.length - paginatedRegularFeedPosts.length);

  const sortComments = (comments = []) => {
    const visible = comments.filter((comment) => !comment.deletedAt);
    if (commentSort === 'new') return [...visible].sort((a, b) => getFeedItemTimestamp(b) - getFeedItemTimestamp(a));
    if (commentSort === 'popular') return [...visible].sort((a, b) => Object.values(b.reactions || {}).flat().length - Object.values(a.reactions || {}).flat().length);
    return visible;
  };

  const getEmployeeAvatar = useCallback((login = '', ...candidates) => {
    const normalizedLogin = formatFeedLogin(login);
    const directAvatar = candidates.find((value) => typeof value === 'string' && value.trim());
    if (directAvatar) return resolveAttachmentUrl(directAvatar);

    if (sameLogin(normalizedLogin, user?.username || '')) return resolveAttachmentUrl(avatarUrl || '');

    const cachedProfile = normalizedLogin ? readProfileDraft(normalizedLogin) : {};
    if (cachedProfile.avatar) return resolveAttachmentUrl(cachedProfile.avatar);

    const directoryProfile = directoryEmployees.find((employee) => sameLogin(employee.login, normalizedLogin)) || {};
    return resolveAttachmentUrl(directoryProfile.avatar || directoryProfile.photo || directoryProfile.photo_url || '');
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
    const actionKey = `post-create:${optimisticPost.id}`;
    beginFeedAction(actionKey, optimisticPost.id);

    setFeedPosts((current) => [optimisticPost, ...current.filter((post) => post.id !== optimisticPost.id)]);
    setFeedDraft('');
    setFeedAttachments([]);
    clearSavedFeedDraft(user?.username || 'guest');

    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: optimisticPost.text,
          attachment: optimisticPost.attachment,
          attachments: optimisticPost.attachments,
          category: optimisticPost.category
        })
      }, { attempts: 2, fallbackMessage: 'Не удалось опубликовать запись' });

      const serverPost = data?.post ? { ...data.post, deliveryStatus: 'sent' } : null;
      setFeedPosts((current) => {
        const nextPosts = serverPost
          ? sortFeedPosts([
            serverPost,
            ...current.filter((post) => post.id !== optimisticPost.id && post.id !== serverPost.id)
          ])
          : current.map((post) => (
            post.id === optimisticPost.id ? { ...post, deliveryStatus: 'sent' } : post
          ));
        return getFeedPostsSignature(current) === getFeedPostsSignature(nextPosts) ? current : nextPosts;
      });
      window.requestAnimationFrame(() => {
        feedListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } catch (error) {
      setFeedPosts((current) => current.filter((post) => post.id !== optimisticPost.id));
      setFeedDraft(previousDraft);
      setFeedAttachments(previousAttachments);
      notify(
        isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось опубликовать запись') : (error.message || 'Не удалось опубликовать запись'),
        'Лента'
      );
    } finally {
      endFeedAction(actionKey, optimisticPost.id);
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
      const preparedFiles = await mapWithConcurrency(files, (file) => uploadAttachmentFile(file, 'feed'));
      setFeedAttachments((prev) => [...prev, ...preparedFiles]);
    } catch {
      notify('Не удалось прикрепить файл.', 'Вложения');
    }
  };

  const removeFeedAttachment = (attachmentId) => {
    setFeedAttachments((prev) => prev.filter((file, index) => (file.id || `${file.name}-${index}`) !== attachmentId));
  };

  const openFeedMediaViewer = (post, file) => {
    if (!getOriginalAttachmentUrl(file)) return;
    const mediaFiles = getFeedAttachments(post).filter(isMediaAttachment);
    const fileIndex = Math.max(0, mediaFiles.findIndex((item) => item === file || (item.id && item.id === file.id)));
    setMediaViewer({ source: 'feed', post, file, fileIndex });
    setSelectedFeedPostId('');
    setFeedReactionExpanded(false);
  };

  const patchFeedPost = async (postId, patch) => {
    const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }, { attempts: 2, fallbackMessage: 'Не удалось обновить публикацию' });
    updateFeedPostFromServer(postId, {
      ...patch,
      updatedAt: data?.post?.updatedAt || new Date().toISOString()
    });
    return data.post;
  };

  const loadFeedComments = async (postId) => {
    const hasPendingCommentChange = [...pendingFeedActionsRef.current].some((key) => (
      key === `comment-add:${postId}` || key.startsWith(`comment-delete:${postId}:`)
    ));
    const actionKey = `comments-load:${postId}`;
    if (hasPendingCommentChange || !beginFeedAction(actionKey, postId)) return;
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments?limit=50`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить комментарии');
      const comments = Array.isArray(data?.comments) ? data.comments : [];
      setFeedPosts((current) => current.map((post) => (
        post.id === postId ? { ...post, comments, commentCount: Math.max(Number(post.commentCount) || 0, comments.length) } : post
      )));
      setExpandedCommentPosts((prev) => ({ ...prev, [postId]: true }));
    } catch (error) {
      notify(
        isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось загрузить комментарии') : (error.message || 'Не удалось загрузить комментарии'),
        'Лента'
      );
    } finally {
      endFeedAction(actionKey, postId);
    }
  };

  const addCommentToPost = async (postId) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    const actionKey = `comment-add:${postId}`;
    if (!beginFeedAction(actionKey, postId)) return;

    const optimisticComment = {
      id: createMessageId(),
      author: user?.username || 'employee',
      authorName: profileForm.full_name || user?.name || user?.username || 'Сотрудник',
      text,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const previousPost = feedPostsRef.current.find((post) => post.id === postId);
    const previousCommentCount = Math.max(
      Number(previousPost?.commentCount) || 0,
      (previousPost?.comments || []).filter((comment) => !comment.deletedAt).length
    );

    setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
    setFeedPosts((current) => current.map((post) => (
      post.id === postId
        ? {
          ...post,
          comments: [...(post.comments || []), optimisticComment],
          commentCount: previousCommentCount + 1,
          updatedAt: optimisticComment.updatedAt
        }
        : post
    )));

    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      }, { attempts: 4, fallbackMessage: 'Не удалось добавить комментарий' });
      const savedComment = data.comment || optimisticComment;
      setFeedPosts((current) => current.map((post) => (
        post.id !== postId ? post : (() => {
          const comments = [
            ...(post.comments || []).filter((comment) => (
              comment.id !== optimisticComment.id && comment.id !== savedComment.id
            )),
            savedComment
          ].filter(Boolean);
          return {
            ...post,
            comments,
            commentCount: Number(data?.post?.commentCount) || Math.max(previousCommentCount + 1, comments.filter((comment) => !comment.deletedAt).length),
            updatedAt: data?.post?.updatedAt || savedComment.updatedAt || new Date().toISOString()
          };
        })()
      )));
    } catch (error) {
      setFeedPosts((current) => current.map((post) => (
        post.id === postId
          ? {
            ...post,
            comments: (post.comments || []).filter((comment) => comment.id !== optimisticComment.id),
            commentCount: previousCommentCount,
            updatedAt: previousPost?.updatedAt || post.updatedAt
          }
          : post
      )));
      setCommentDrafts((prev) => ({ ...prev, [postId]: text }));
      notify(
        isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось добавить комментарий') : (error.message || 'Не удалось добавить комментарий'),
        'Лента'
      );
    } finally {
      endFeedAction(actionKey, postId);
    }
  };

  const startEditFeedPost = (post) => {
    setEditingFeedPostId(post.id);
    setEditingFeedText(post.text || '');
    setOpenFeedMenuId('');
  };

  const saveFeedPostEdit = async (postId) => {
    const text = editingFeedText.trim();
    const previousPost = feedPostsRef.current.find((post) => post.id === postId);
    if (!previousPost) return;
    const actionKey = `post-edit:${postId}`;
    if (!beginFeedAction(actionKey, postId)) return;
    const editedAt = new Date().toISOString();
    setFeedPosts((current) => current.map((post) => (post.id === postId ? { ...post, text, editedAt, updatedAt: editedAt } : post)));
    setEditingFeedPostId('');
    try {
      await patchFeedPost(postId, { text, editedAt });
      notify('Публикация изменена', 'Лента');
    } catch (error) {
      setFeedPosts((current) => current.map((post) => (
        post.id === postId
          ? { ...post, text: previousPost.text, editedAt: previousPost.editedAt, updatedAt: previousPost.updatedAt }
          : post
      )));
      notify(error.message || 'Не удалось изменить публикацию', 'Лента');
    } finally {
      endFeedAction(actionKey, postId);
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

  const copyFeedPostLink = async (postId) => {
    const url = getPostShareUrl(postId);
    try {
      await navigator.clipboard?.writeText(url);
      notify('Ссылка скопирована', 'Лента');
    } catch {
      window.prompt(isEnglishInterface ? 'Copy the post link' : 'Скопируйте ссылку на публикацию', url);
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
    const currentPosts = feedPostsRef.current;
    const postIndex = currentPosts.findIndex((item) => item.id === postId);
    const post = currentPosts[postIndex];
    if (!post) return;

    const canDeletePost = canManageFeedPost(post, user, isManager, isAdmin);
    if (!canDeletePost) return;
    if (!options.skipConfirm) {
      const confirmed = await confirmAction('Удалить публикацию из ленты?', 'Лента');
      if (!confirmed) return;
    }

    const actionKey = `post-delete:${postId}`;
    if (!beginFeedAction(actionKey, postId)) return;
    setFeedPosts((current) => current.filter((item) => item.id !== postId));

    try {
      await fetchJsonWithRetry(
        `${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}`,
        { method: 'DELETE' },
        { attempts: 2, fallbackMessage: 'Не удалось удалить публикацию' }
      );
    } catch (error) {
      setFeedPosts((current) => {
        if (current.some((item) => item.id === postId)) return current;
        const next = [...current];
        next.splice(Math.max(0, Math.min(postIndex, next.length)), 0, post);
        return next;
      });
      notify(
        isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось удалить публикацию') : (error.message || 'Не удалось удалить публикацию'),
        'Лента'
      );
    } finally {
      endFeedAction(actionKey, postId);
    }
  };

  const deleteFeedComment = async (postId, commentId) => {
    const post = feedPostsRef.current.find((item) => item.id === postId);
    const comment = post?.comments?.find((item) => item.id === commentId);
    if (!post || !comment) return;

    const canDeleteComment = isManager || isAdmin || comment.author === user?.username;
    if (!canDeleteComment) return;

    const actionKey = `comment-delete:${postId}:${commentId}`;
    if (!beginFeedAction(actionKey, postId)) return;
    const optimisticDeletedAt = new Date().toISOString();
    setFeedPosts((current) => current.map((item) => (
      item.id === postId
        ? {
          ...item,
          comments: (item.comments || []).map((row) => (
            row.id === commentId
              ? { ...row, deletedAt: optimisticDeletedAt, deletedBy: user?.username, updatedAt: optimisticDeletedAt }
              : row
          )),
          commentCount: Math.max(0, Number(item.commentCount || 0) - 1)
        }
        : item
    )));

    try {
      const data = await fetchJsonWithRetry(
        `${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
        { method: 'DELETE' },
        { attempts: 4, fallbackMessage: 'Не удалось удалить комментарий' }
      );
      setFeedPosts((current) => current.map((item) => (
        item.id === postId
          ? {
            ...item,
            comments: (item.comments || []).map((row) => (
              row.id === commentId
                ? { ...row, deletedAt: data.deletedAt || optimisticDeletedAt, deletedBy: data.deletedBy || user?.username }
                : row
            ))
          }
          : item
      )));
    } catch (error) {
      setFeedPosts((current) => current.map((item) => (
        item.id === postId
          ? {
            ...item,
            comments: (item.comments || []).map((row) => (row.id === commentId ? comment : row)),
            commentCount: Number(post.commentCount) || (post.comments || []).filter((row) => !row.deletedAt).length
          }
          : item
      )));
      notify(
        isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось удалить комментарий') : (error.message || 'Не удалось удалить комментарий'),
        'Лента'
      );
    } finally {
      endFeedAction(actionKey, postId);
    }
  };

  const toggleFeedReaction = async (postId, emoji) => {
    const login = user?.username || 'employee';
    const post = feedPostsRef.current.find((item) => item.id === postId);
    if (!post) return;
    const actionKey = `reaction:${postId}:${emoji}`;
    if (!beginFeedAction(actionKey, postId)) return;
    const wasActive = (post.reactions?.[emoji] || []).includes(login);
    const active = !wasActive;
    setFeedPosts((current) => current.map((item) => (
      item.id === postId ? setFeedReactionForUser(item, emoji, login, active) : item
    )));

    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji, active })
      }, { attempts: 4, fallbackMessage: 'Не удалось обновить реакцию' });
      setFeedPosts((current) => current.map((item) => (
        item.id === postId
          ? { ...item, reactions: data?.reactions || data?.post?.reactions || item.reactions }
          : item
      )));
    } catch (error) {
      setFeedPosts((current) => current.map((item) => (
        item.id === postId ? setFeedReactionForUser(item, emoji, login, wasActive) : item
      )));
      notify(
        isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось обновить реакцию') : (error.message || 'Не удалось обновить реакцию'),
        'Лента'
      );
    } finally {
      endFeedAction(actionKey, postId);
    }
  };

  const toggleFeedPinned = async (postId, pinned) => {
    const post = feedPostsRef.current.find((item) => item.id === postId);
    if (!post) return;
    const actionKey = `pin:${postId}`;
    if (!beginFeedAction(actionKey, postId)) return;
    setFeedPosts((current) => current.map((item) => (item.id === postId ? { ...item, pinned } : item)));
    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned })
      }, { attempts: 2, fallbackMessage: 'Не удалось закрепить публикацию' });
      updateFeedPostFromServer(postId, data?.post ? { pinned: data.post.pinned, updatedAt: data.post.updatedAt } : { pinned });
    } catch (error) {
      setFeedPosts((current) => current.map((item) => (item.id === postId ? { ...item, pinned: post.pinned } : item)));
      notify(
        isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось закрепить публикацию') : (error.message || 'Не удалось закрепить публикацию'),
        'Лента'
      );
    } finally {
      endFeedAction(actionKey, postId);
    }
  };

  const handleOpenContactProfile = useCallback((email) => {
    openProfileCard(email);
    setActiveTab('profile');
  }, [openProfileCard]);

  const handleTogglePinnedContact = useCallback((conversationId) => {
    toggleLocalListValue('pinned', conversationId);
  }, [toggleLocalListValue]);

  const handleToggleFavoriteContact = useCallback((email) => {
    toggleLocalListValue('favorites', email);
  }, [toggleLocalListValue]);

  return (
    <div
      className={`employee-chat-layout theme-${chatLocalSettings.uiTheme || 'light'} density-${chatLocalSettings.uiDensity || 'regular'} text-${chatLocalSettings.uiTextSize || 'medium'} ${isDraggingFiles ? 'dragging-files' : ''}`}
      onDrop={handleAttachmentDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {isDraggingFiles && <div className="drop-zone-overlay"><strong>📎 {t('dropFiles')}</strong><span>{t('dropFilesHint')}</span></div>}
      {welcomeNotice && (
        <div className="chat-welcome-notice" role="status">
          <span>
            <small>{isEnglishInterface ? 'Welcome back' : 'С возвращением'}</small>
            <strong>{welcomeNotice}</strong>
          </span>
        </div>
      )}
      <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} hidden />
      
      <aside className="employee-chat-sidebar">
        <div className="employee-chat-brand">
          <button type="button" className="employee-avatar-upload" onClick={() => setAvatarViewerOpen(true)}>
            {avatarUrl ? <img src={avatarUrl} alt="avatar" className="employee-avatar-image" /> : <span>{String(baseDisplayName || '?').slice(0, 1).toUpperCase()}</span>}
          </button>
          <div className="employee-brand-meta">
            <strong>{profileForm.full_name || baseDisplayName}</strong>
            <span>{profileForm.position || user?.position || profileForm.department || t('workingChat')}</span>
          </div>
          <div className="brand-actions"><button type="button" className="icon-btn" onClick={() => { setActiveTab('profile'); setProfileViewLogin(''); }}>{t('profile')}</button></div>
        </div>

        <nav className="employee-chat-tabs" aria-label={t('chatSections')}>
          {tabs.map((tab) => {
            const badge = tab.id === 'chat' ? unreadTotal : tab.id === 'feed' ? feedBadge : tab.id === 'request' ? requestBadge : 0;
            return (
              <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>
                <span>{getTabLabel(tab)}</span>
                {badge > 0 && <em>{badge}</em>}
              </button>
            );
          })}
        </nav>


        <ContactsWorkspace
          employees={chatCandidates}
          selectedEmail={selectedEmail}
          currentLogin={user.username}
          managerLogin={managerLogin}
          isManager={isManager}
          unreadByEmail={unreadByEmail}
          favorites={chatLocalSettings.favorites}
          pinnedDialogs={chatLocalSettings.pinned}
          threadSummaries={threadSummaries}
          threads={threads}
          applications={myApplications}
          department={profileForm.department}
          filters={CONTACT_FILTERS}
          getFilterLabel={getContactFilterLabel}
          getConversationId={getConversationId}
          formatVisibleLogin={formatVisibleLogin}
          t={t}
          onSelect={setSelectedEmail}
          onOpenProfile={handleOpenContactProfile}
          onTogglePinned={handleTogglePinnedContact}
          onToggleFavorite={handleToggleFavoriteContact}
        />

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
                <strong>{t('chooseDialog')}</strong>
                <span>{t('chooseDialogHint')}</span>
              </div>
            ) : (
              <>
                <ChatDialogHeader
                  t={t}
                  contactName={activeContact?.profile?.full_name || selectedEmail}
                  visibleLogin={formatVisibleLogin(selectedEmail)}
                  search={dialogSearch}
                  hasSearch={Boolean(normalizedDialogSearch)}
                  searchIndex={dialogSearchIndex}
                  searchCount={dialogSearchResults.length}
                  showMediaPanel={chatLocalSettings.showDialogMediaPanel === true}
                  showConversationMenu={chatLocalSettings.showConversationMenu === true}
                  conversationMenuOpen={conversationMenuOpen}
                  onSearch={(value) => {
                    setDialogSearch(value);
                    setDialogSearchIndex(0);
                  }}
                  onPreviousResult={() => setDialogSearchIndex((prev) => Math.max(0, prev - 1))}
                  onNextResult={() => setDialogSearchIndex((prev) => Math.min(dialogSearchResults.length - 1, prev + 1))}
                  onToggleMediaPanel={() => setMediaPanelOpen((prev) => !prev)}
                  onToggleMenu={() => setConversationMenuOpen((prev) => !prev)}
                  onArchive={() => {
                    toggleLocalListValue('archived', currentConversationId);
                    setConversationMenuOpen(false);
                  }}
                  onHide={() => {
                    toggleLocalListValue('hidden', currentConversationId);
                    setConversationMenuOpen(false);
                  }}
                  onPin={() => {
                    toggleLocalListValue('pinned', currentConversationId);
                    setConversationMenuOpen(false);
                  }}
                  onMarkUnread={() => {
                    setReadState((prev) => ({ ...prev, [currentConversationId]: '' }));
                    setConversationMenuOpen(false);
                  }}
                  onMute={() => {
                    toggleLocalListValue('muted', currentConversationId);
                    setConversationMenuOpen(false);
                  }}
                  onClearDraft={() => {
                    clearCurrentDraft();
                    setConversationMenuOpen(false);
                  }}
                  onDeleteConversation={() => {
                    clearConversation();
                    setConversationMenuOpen(false);
                  }}
                />

                {isCurrentConversationLoading && <ChatLoadingOverlay label={t('loading')} />}

	                {chatLocalSettings.showDialogFilters === true && <div className="dialog-filter-row">{CHAT_FILTERS.map((filter) => <button key={filter.id} type="button" className={dialogFilter === filter.id ? 'active' : ''} onClick={() => setDialogFilter(filter.id)}>{getOptionLabel(filter)}</button>)}</div>}
	                {chatLocalSettings.showDialogDateJump === true && <div className="date-jump-row"><label>{t('jumpToDate')} <input type="date" onChange={(event) => jumpToMessageDate(event.target.value)} /></label></div>}
                {chatLocalSettings.showDialogMediaPanel === true && mediaPanelOpen && <div className="dialog-media-panel"><div className="dialog-media-tabs">{CHAT_MEDIA_TABS.map((tab) => <button key={tab.id} type="button" className={mediaPanelTab === tab.id ? 'active' : ''} onClick={() => setMediaPanelTab(tab.id)}>{getOptionLabel(tab)}</button>)}</div><input type="search" placeholder={t('mediaSearch')} value={mediaPanelSearch} onChange={(e) => setMediaPanelSearch(e.target.value)} /><button type="button" onClick={() => notify(t('archiveUnavailable'), t('mediaFiles'))}>{t('downloadArchive')}</button><div className="dialog-media-grid">{filteredDialogMediaItems.length === 0 && <small>{t('noResults')}</small>}{filteredDialogMediaItems.map(({ message, file, fileIndex, type }, index) => <button key={`${message.id}-${file.name}-${index}`} type="button" onClick={() => type === 'link' ? window.open(file.dataUrl, '_blank', 'noopener,noreferrer') : isMediaAttachment(file) ? setMediaViewer({ message, file, fileIndex, scope: 'dialog' }) : openAttachmentInNewTab(file)}>{type === 'link' ? <span>🔗 {file.name}</span> : isMediaAttachment(file) ? (isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name || t('media')} loading="lazy" decoding="async" />) : <span>{getFileIcon(file.type)} {file.name}</span>}<em>{new Date(message.createdAt).toLocaleDateString(interfaceLocale)}</em></button>)}</div></div>}

                {pinnedMessages.length > 0 && (
                  <div className="pinned-box">
                    <strong>📌 {t('pinnedMessages')} {pinnedMessageIndex + 1} {t('of')} {pinnedMessages.length}</strong><div className="pinned-controls"><button type="button" onClick={() => setPinnedMessageIndex((prev) => Math.max(0, prev - 1))}>‹</button><button type="button" onClick={() => setPinnedMessageIndex((prev) => Math.min(pinnedMessages.length - 1, prev + 1))}>›</button></div>{pinnedMessages[pinnedMessageIndex] && <button type="button" onClick={() => document.querySelector(`[data-message-id="${pinnedMessages[pinnedMessageIndex].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>• {pinnedMessages[pinnedMessageIndex].text || (getMessageAttachments(pinnedMessages[pinnedMessageIndex]).some(isImageAttachment) ? `📷 ${t('photo')}` : `📎 ${t('document')}`)}</button>}
                  </div>
                )}

                {multiSelectMode && <div className="multi-select-toolbar"><strong>{t('selectedCount')}: {selectedMessageIds.length}</strong><button type="button" onClick={copySelectedMessages}>{t('copy')}</button><button type="button" onClick={() => { const selected = getSelectedMessages(); if (selected[0]) openForwardMessagePicker({ ...selected[0], text: selected.map((msg) => `${msg.sender}: ${msg.text || `[${t('attachmentPlaceholder')}]`}`).join('\n') }); }}>{t('forward')}</button><button type="button" onClick={() => { const selected = getSelectedMessages(); setRequestText(selected.map((msg) => `${msg.sender}: ${msg.text || `[${t('attachmentPlaceholder')}]`}`).join('\n')); setActiveTab('request'); }}>{t('createRequest')}</button><button type="button" onClick={() => notify(t('archiveUnavailable'), t('mediaFiles'))}>{t('downloadAttachments')}</button><button type="button" className="danger-action" onClick={deleteSelectedMessages}>{t('delete')}</button><button type="button" onClick={clearSelectedMessages}>{t('cancel')}</button></div>}
                <div
                  className="messages-wrap"
                  ref={messagesWrapRef}
                  onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (selectedMessageId && messageReactionExpanded) setMessageReactionExpanded(false);
                    else if (selectedMessageId) setSelectedMessageId('');
                  }}
                  onScroll={(event) => {
                    if (event.currentTarget.scrollTop > 32 || hiddenDialogMessagesCount > 0 || !threadHasMore[currentConversationId]) return;
                    loadOlderDialogMessages();
                  }}
                >
                  {normalizedDialogSearch.length >= 2 && dialogSearchLoading && (
                    <div className="chat-search-status">{t('searchingMessages')}</div>
                  )}
                  {normalizedDialogSearch.length >= 2 && dialogSearchHasMore && (
                    <button
                      type="button"
                      className="chat-pagination-button"
                      disabled={dialogSearchLoading}
                      onClick={() => fetchDialogSearchPage({ append: true, before: dialogSearchBefore })}
                    >
                      {t('loadMoreSearchResults')}
                    </button>
                  )}
                  {(hiddenDialogMessagesCount > 0 || threadHasMore[currentConversationId]) && <button type="button" className="chat-pagination-button" disabled={isLoadingOlderDialog} onClick={() => hiddenDialogMessagesCount > 0 ? setVisibleDialogMessageCount((prev) => prev + CHAT_MESSAGES_PAGE_SIZE) : loadOlderDialogMessages()}>{t('loadPreviousMessages')} · {t('showingLatestMessages').replace('{shown}', String(paginatedVisibleMessages.length)).replace('{total}', String(threadHasMore[currentConversationId] ? `${visibleMessages.length}+` : visibleMessages.length))}</button>}
                  {!isCurrentConversationLoading && messagesWithDateSeparators.length === 0 && <div className="empty-chat">{dialogSearch ? t('noMessageSearchResults') : t('noMessages')}</div>}
                  {messagesWithDateSeparators.map((item) => {
                    if (item.type === 'date') return <div key={item.id} className="date-separator"><span>{item.label}</span></div>;

                    const message = item.message;
                    const canEdit = isManager || message.sender === user.username;
                    const isMine = message.sender === user.username;
                    const isDeleted = Boolean(message.deletedAt);
                    const attachments = !isDeleted && message.attachments?.length ? message.attachments : !isDeleted && message.attachment ? [message.attachment] : [];
                    const hasTextContent = !isDeleted && String(message.text || '').trim() && message.text !== '📎 Вложения';
                    const photoMetaLabel = new Date(message.createdAt).toLocaleTimeString(interfaceLocale, { hour: '2-digit', minute: '2-digit' });
                    const statusLabel = isMine ? '✓✓' : '';
                    const photoStatusLabel = isMine ? '✓' : '';
                    const messageTimeLabel = new Date(message.createdAt).toLocaleTimeString(interfaceLocale, { hour: '2-digit', minute: '2-digit' });
                    const deliveryLabel = message.deliveryStatus === 'sending' ? t('deliverySending') : message.deliveryStatus === 'waiting' ? t('deliveryWaiting') : message.deliveryStatus === 'error' ? t('deliveryError') : statusLabel;
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
	                          {message.forwardedFrom && <div className="forwarded-preview">{t('forwardedFrom')} {message.forwardedFrom}</div>}
	                          {message.replyTo && <button type="button" className="reply-preview reply-jump" onClick={(event) => { event.stopPropagation(); document.querySelector(`[data-message-id="${message.replyTo.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>↪ {message.replyTo.sender}: {message.replyTo.text || t('originalMessageDeleted')}</button>}
	                          {isDeleted ? (
	                            <div className="message-deleted">{t('deletedMessage')} {message.deletedBy ? `· ${message.deletedBy}` : ''}</div>
	                          ) : hasTextContent ? (
	                            inlineEditMessageId === message.id ? <div className="inline-message-editor"><textarea value={inlineEditText} onChange={(e) => setInlineEditText(e.target.value)} /><button type="button" onClick={() => saveInlineEditMessage(message)}>{t('saveActionButton')}</button><button type="button" onClick={() => setInlineEditMessageId('')}>{t('cancel')}</button></div> : <div className="message-text">{highlightText(message.text)}</div>
                          ) : null}

                          {linkPreviews.length > 0 && !isDeleted && (
                            <div className="link-preview-list">
	                              {linkPreviews.map((preview) => (
	                                <a key={preview.url} className="link-preview-card" href={preview.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
	                                  <span className="link-preview-icon" aria-hidden="true">↗</span>
	                                  <span><strong>{preview.title}</strong><small>{preview.description}</small><em>{preview.domain}</em></span>
	                                  <b>{t('openAttachment')}</b>
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
	                                  isEnglish={isEnglishInterface}
	                                />
                              ))}
                            </div>
                          )}

                          {messageReactionBadges.length > 0 && (
	                            <div className="message-reactions-inline" aria-label={t('emoji')}>
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
	                              {message.editedAt && !isDeleted ? <span>{t('changed')}</span> : null}
                              <span>{messageTimeLabel}</span>
                              {isMine && deliveryLabel && <span className={`message-checks ${['sending', 'waiting', 'error'].includes(message.deliveryStatus) ? 'textual' : ''}`}>{deliveryLabel}</span>}
                            </small>
                          )}
                        </div>

                        {isSelected && !isDeleted && typeof document !== 'undefined' && createPortal((
                          <div className={`selected-message-menu message-action-popover floating theme-${chatLocalSettings.uiTheme || 'light'} ${isMine ? 'mine' : ''} ${selectedMessageMenuPlacement === 'below' ? 'open-below' : ''}`} style={selectedMessageMenuStyle} onClick={(event) => event.stopPropagation()}>
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
                                  <button type="button" onClick={() => { setReplyTo(message); setSelectedMessageId(''); }}><span className="message-action-icon">↩</span>{t('reply')}</button>
                                  <button type="button" onClick={() => { copyMessageText(message); setSelectedMessageId(''); }}><span className="message-action-icon">⧉</span>{t('copy')}</button>
                                  <button type="button" onClick={() => openForwardMessagePicker(message)}><span className="message-action-icon">↷</span>{t('forward')}</button>
                                  <button type="button" onClick={() => { togglePinned(message.id); setSelectedMessageId(''); }}><span className="message-action-icon">⌖</span>{message.pinned ? t('unpin') : t('pin')}</button>
                                  {canEdit && <button type="button" className="danger-action" onClick={() => { deleteMessage(message.id); setSelectedMessageId(''); }}><span className="message-action-icon">×</span>{t('delete')}</button>}
                                </div>
                                {chatLocalSettings.showExtraMessageActions === true && (
                                  <>
                                    <div className="message-action-grid secondary-actions">
                                      {canEdit && <button type="button" onClick={() => startInlineEditMessage(message)}>{t('edit')}</button>}
                                      <button type="button" onClick={() => { setMultiSelectMode(true); toggleSelectedMessage(message.id); setSelectedMessageId(''); }}>{t('selectMultiple')}</button>
                                      <button type="button" onClick={() => createRequestFromMessage(message)}>{t('createRequest')}</button>
	                                      <button type="button" onClick={() => notify(isEnglishInterface ? 'Adding to an existing request will be available after a request is selected.' : 'Добавление к существующей заявке будет доступно после выбора заявки', t('createRequest'))}>{t('addToRequest')}</button>
	                                      <button type="button" onClick={() => notify(isEnglishInterface ? 'A draft task will be created after the task module is connected.' : 'Задача создана как черновик после подключения задач', t('createTask'))}>{t('createTask')}</button>
	                                      <button type="button" onClick={() => notify(isEnglishInterface ? 'Executor assignment will be available in the task module.' : 'Назначение исполнителя появится в модуле задач', t('createTask'))}>{t('assignExecutor')}</button>
	                                      <button type="button" onClick={() => notify(isEnglishInterface ? 'A deadline can be set after the task module is connected.' : 'Срок можно будет поставить после подключения задач', t('createTask'))}>{t('setDeadline')}</button>
                                      <button type="button" onClick={() => getMessageAttachments(message).forEach(openAttachmentInNewTab)}>{t('downloadAttachments')}</button>
                                    </div>
                                    <div className="message-action-grid danger-actions">
	                                      {isMine && ['waiting', 'error'].includes(message.deliveryStatus) && <button type="button" onClick={() => retryMessageSend(message)}>{t('retrySend')}</button>}
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
	                      <summary>{t('templates')}</summary>
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
	                          <button type="button" onClick={addCustomTemplate}>+ {t('myTemplate')}</button>
                        </div>
                      </div>
                    </details>
                  )}

	                  {replyTo && <div className="reply-preview active-reply">{t('replyTo')}: {replyTo.sender}: {replyTo.text}<button type="button" onClick={() => setReplyTo(null)}>×</button></div>}

                  {chatUploadQueue.length > 0 && (
                    <div className="chat-upload-queue" aria-live="polite">
                      {chatUploadQueue.map((item) => (
                        <div key={item.id} className={`chat-upload-item ${item.status}`}>
                          <span>{item.name}</span>
                          <progress max="100" value={item.progress || 0} />
                          <small>{item.status === 'error' ? item.error : `${item.progress || 0}%`}</small>
                          {item.status === 'error' ? (
                            <button type="button" onClick={() => uploadQueuedChatFile(item)}>{t('retryLoad')}</button>
                          ) : (
                            <button type="button" onClick={() => cancelChatUpload(item.id)}>{t('cancel')}</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {attachmentDrafts.length > 0 && (
                    <div className="attachment-preview-grid media-draft-grid">
                      {attachmentDrafts.map((file, index) => {
                        const mediaFile = String(file.type || '').startsWith('image/') || isVideoAttachment(file);
                        return (
                          <div key={file.id || `${file.name}-${index}`} className={`attachment-preview media-draft-tile ${mediaFile ? 'is-media' : ''}`}>
                            {mediaFile ? (
                              <button type="button" className="media-draft-thumb" onClick={() => setMediaViewer({ source: 'chat-draft', file, fileIndex: index })}>
                                {isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name} loading="lazy" decoding="async" />}
                              </button>
                            ) : <span className="media-draft-file-icon">{getFileIcon(file.type)}</span>}
                            <span>{file.name} · {formatFileSize(file.size)}</span>
                            <button type="button" className="media-draft-remove" onClick={() => removeAttachmentDraft(file.id || `${file.name}-${index}`)}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {pendingMessages.length > 0 && <div className="offline-status">{isOnline ? `${t('sendingPending')}: ${pendingMessages.length}` : `${t('waitingToSend')}: ${pendingMessages.length}`}</div>}
                  {!isOnline && <div className="offline-status warning">{t('offlineWarning')}</div>}
                  {typingHint && <div className="typing-hint">{typingHint}</div>}

                  <ChatComposerForm
                    t={t}
                    draft={draft}
                    textareaRef={messageTextareaRef}
                    emojiOptions={QUICK_EMOJIS}
                    isEmojiOpen={isEmojiOpen}
                    enterToSend={chatLocalSettings.enterToSend !== false}
                    isSending={isSendingMessage}
                    isOnline={isOnline}
                    onSubmit={handleSend}
                    onDraftChange={setDraft}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={handleComposerPaste}
                    onToggleEmoji={() => setIsEmojiOpen((prev) => !prev)}
                    onAppendEmoji={(emoji) => {
                      appendToDraft(emoji);
                      setIsEmojiOpen(false);
                    }}
                    onToggleEnterToSend={() => updateChatLocalSettings((prev) => ({
                      ...prev,
                      enterToSend: prev.enterToSend === false
                    }))}
                    onAttachmentChange={handleAttachmentChange}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'request' && !isManager && (
          <div className="request-workspace">
            <header className="section-hero">
              <span className="eyebrow">{t('requestEyebrow')}</span>
              <h2>{t('requestTitle')}</h2>
              <p>{t('requestHint')}</p>
            </header>
            {requestStatus.state !== 'idle' && (
              <div className={`request-status-card ${requestStatus.state}`}>
                <strong>{requestStatus.textKey ? t(requestStatus.textKey) : localizeRuntimeText(requestStatus.text)}</strong>
                {requestStatus.ticketId && <span>{t('ticketNumber')}: #{requestStatus.ticketId}</span>}
              </div>
            )}
            <section className="request-support-card" aria-label={t('techSupportContacts')}>
              <div>
                <span className="eyebrow">{t('techSupport')}</span>
                <h3>{t('techSupportDepartment')}</h3>
                <p>{t('techSupportText')}</p>
              </div>
              <div className="request-support-contact">
                <strong>Повисок Евгений Вячеславович</strong>
                <span>{t('leadSpecialist')}</span>
                <a href="tel:1380">{t('internalPhone')}: 1-380</a>
                <a href="mailto:povisok@nioch.nsc.ru">povisok@nioch.nsc.ru</a>
                <a href="tel:+79130080146">{t('mobile')}: 8-913-008-01-46</a>
              </div>
            </section>
            <form className="employee-request-box" onSubmit={submitRequest}>
              <div className="form-grid two">
                <label>{t('category')}<select value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)}>{REQUEST_CATEGORIES.map((item) => <option key={item}>{getRequestCategoryLabel(item)}</option>)}</select></label>
                <label>{t('priority')}<select value={requestPriority} onChange={(e) => setRequestPriority(e.target.value)}>{REQUEST_PRIORITIES.map((item) => <option key={item}>{getRequestPriorityLabel(item)}</option>)}</select></label>
              </div>
              <textarea rows={7} placeholder={t('requestPlaceholder')} value={requestText} onChange={(e) => setRequestText(e.target.value)} />
              <div className="request-form-actions"><button type="submit" disabled={requestStatus.state === 'sending'}>{requestStatus.state === 'sending' ? t('sendingRequest') : t('sendRequest')}</button><button type="button" onClick={() => fetchMyApplications({ silent: false })}>{applicationsLoading ? t('refreshing') : t('refreshStatuses')}</button></div>
              {applicationsError && <div className="request-inline-error">{t('requestsUnavailable')}: {localizeRuntimeText(applicationsError)}</div>}
            </form>

            <section className="employee-ticket-board">
              <div className="ticket-board-head"><h3>{t('activeRequests')}</h3>{activeApplications.length > 0 && <span>{activeApplications.length}</span>}</div>
              {activeApplications.length === 0 && <div className="empty-mini">{t('noActiveRequests')}</div>}
              {activeApplications.map((ticket) => {
                const meta = getApplicationStatusMeta(ticket.status, isEnglishInterface);
                return (
                  <article key={ticket.id} className={`employee-ticket-card ${meta.tone}`}>
                    <header><div><strong>#{ticket.id} · {meta.label}</strong><span>{getRequestCategoryLabel(ticket.category || 'Другое')} · {getRequestPriorityLabel(ticket.priority || 'Обычный')}</span></div><em>{meta.hint}</em></header>
                    <p>{ticket.application}</p>
                    <RequestTimerMetrics ticket={ticket} t={t} />
                    {(ticket.executor || ticket.accepted_by || ticket.admin_comment || ticket.eta_minutes) && <div className="ticket-admin-note"><strong>{ticket.executor || ticket.accepted_by || t('administrator')}</strong><span>{ticket.admin_comment || (ticket.eta_minutes ? t('administratorEta').replace('{minutes}', ticket.eta_minutes) : t('administratorAccepted'))}</span></div>}
                    {Array.isArray(ticket.timeline) && <ol className="ticket-timeline" aria-label={isEnglishInterface ? 'Request progress' : 'Ход заявки'}>{ticket.timeline.map((step) => <li key={step.key} className={step.completed ? 'completed' : ''}><span>{step.label}</span>{step.at && <time>{new Date(step.at).toLocaleString(isEnglishInterface ? 'en-US' : 'ru-RU')}</time>}</li>)}</ol>}
                    {ticket.process && <div className="ticket-admin-note"><strong>{t('workCompleted')}</strong><span>{ticket.process}</span></div>}
                    {['in_progress', 'waiting_employee_confirmation'].includes(ticket.status) && <div className="ticket-actions"><button type="button" onClick={() => confirmApplicationDone(ticket.id)}>✅ {t('requestDone')}</button><button type="button" onClick={() => reopenApplication(ticket.id)}>{t('issueRemains')}</button></div>}
                  </article>
                );
              })}
              {completedApplications.length > 0 && <details className="ticket-history"><summary>{t('completedHistory')} ({completedApplications.length})</summary>{completedApplications.slice(0, 10).map((ticket) => <div key={ticket.id} className="ticket-history-row"><span>#{ticket.id}</span><span>{ticket.application}</span><strong>{formatDuration(ticket.waiting_seconds || 0)} / {formatDuration(ticket.work_seconds || 0)}</strong></div>)}</details>}
            </section>
          </div>
        )}

        {activeTab === 'feed' && (
          <section className="employee-feed-section">
            <div className="feed-toolbar compact-feed-toolbar sticky-feed-search"><div className="feed-search-shell"><span className="feed-search-icon">🔍</span><input type="search" placeholder={t('searchFeed')} value={feedSearch} onChange={(e) => setFeedSearch(e.target.value)} />{feedSearch && <button type="button" className="feed-search-clear" onClick={() => setFeedSearch('')} aria-label={t('clearSearch')}>×</button>}</div></div>
            <div className="employee-feed-list" ref={feedListRef} onClick={(event) => { if (event.target === event.currentTarget) { setSelectedFeedPostId(''); setFeedReactionExpanded(false); } }}>
              <FeedComposer
                t={t}
                error={feedError ? localizeRuntimeText(feedError) : ''}
                refreshing={feedRefreshing}
                busy={pendingFeedActions.length > 0}
                avatarUrl={avatarUrl}
                currentName={profileForm.full_name || user?.name || user?.username}
                showCategory={chatLocalSettings.showFeedCategorySelect === true}
                category={feedCategory}
                categories={FEED_CATEGORIES}
                getCategoryLabel={getFeedCategoryLabel}
                draft={feedDraft}
                attachments={feedAttachments}
                publishing={isPublishingFeed}
                isVideoAttachment={isVideoAttachment}
                getOriginalAttachmentUrl={getOriginalAttachmentUrl}
                getVideoPosterUrl={getVideoPosterUrl}
                getAttachmentUrl={getAttachmentUrl}
                nudgeVideoToFirstFrame={nudgeVideoToFirstFrame}
                formatFileSize={formatFileSize}
                getFileIcon={getFileIcon}
                onRefresh={() => fetchFeed({ silent: false })}
                onSubmit={addFeedPost}
                onCategoryChange={setFeedCategory}
                onDraftChange={setFeedDraft}
                onOpenAttachment={(file, fileIndex) => setMediaViewer({ source: 'feed-draft', file, fileIndex })}
                onRemoveAttachment={removeFeedAttachment}
                onFileChange={onFeedFileChange}
              />
              {feedLoading && <div className="feed-skeleton-list"><div /><div /><div /></div>}
              {!feedLoading && feedError && <button type="button" className="feed-retry" onClick={() => fetchFeed({ silent: false })}>{t('retryLoad')}</button>}
              {!feedLoading && visibleFeedPosts.length === 0 && <div className="feed-empty-card"><strong>{feedSearch.trim() ? t('noResults') : t('noPosts')}</strong><span>{feedSearch.trim() ? t('tryAnotherSearch') : t('firstPostHint')}</span></div>}
              {pinnedFeedPosts.length > 0 && <div className="feed-pinned-title">📌 {t('pinned')}</div>}
              {[...pinnedFeedPosts, ...paginatedRegularFeedPosts].map((post) => {
                const canDeletePost = canManageFeedPost(post, user, isManager, isAdmin);
                const authorLogin = formatFeedLogin(post.author);
                const authorProfile = directoryEmployees.find((employee) => sameLogin(employee.login, authorLogin)) || {};
                const authorName = post.authorName || authorProfile.full_name || authorLogin || (isEnglishInterface ? 'Employee' : 'Сотрудник');
                const authorMeta = [getFeedCategoryLabel(post.category || 'Объявление'), authorProfile.position || authorProfile.department || (authorLogin ? `@${authorLogin}` : ''), new Date(post.createdAt).toLocaleString(interfaceLocale)].filter(Boolean).join(' · ');
                const authorInitial = String(authorName || authorLogin || '?').slice(0, 1).toUpperCase();
                const authorAvatar = getEmployeeAvatar(authorLogin, post.avatar, post.authorAvatar, post.authorPhoto, post.author_photo, authorProfile.avatar);
                const sortedPostComments = sortComments(post.comments || []);
                const previewComments = expandedCommentPosts[post.id]
                  ? sortedPostComments
                  : (commentSort === 'old' ? sortedPostComments.slice(-2) : sortedPostComments.slice(0, 2));
                const totalPostComments = Math.max(Number(post.commentCount) || 0, sortedPostComments.length);
                const hiddenCommentsCount = Math.max(0, totalPostComments - previewComments.length);
                const postAttachments = getFeedAttachments(post);
                const postMediaAttachments = postAttachments.filter(isMediaAttachment);
                const singlePhotoPost = postMediaAttachments.length === 1 && isImageAttachment(postMediaAttachments[0]);
                const postMutationPending = isFeedPostPending(post.id);
                return (
                  <FeedPostCard
                    key={post.id}
                    post={post}
                    selected={selectedFeedPostId === post.id}
                    menuOpen={openFeedMenuId === post.id}
                    mutationPending={postMutationPending}
                    canManage={canDeletePost}
                    canPin={isManager}
                    authorLogin={authorLogin}
                    authorName={authorName}
                    authorMeta={authorMeta}
                    authorAvatar={authorAvatar}
                    authorInitial={authorInitial}
                    editing={editingFeedPostId === post.id}
                    editingText={editingFeedText}
                    attachments={postAttachments}
                    mediaAttachmentCount={postMediaAttachments.length}
                    singlePhoto={singlePhotoPost}
                    reactionEmojis={REACTION_EMOJIS}
                    reactionExpanded={feedReactionExpanded}
                    comments={previewComments}
                    totalComments={totalPostComments}
                    hiddenCommentsCount={hiddenCommentsCount}
                    commentsExpanded={Boolean(expandedCommentPosts[post.id])}
                    commentDraft={commentDrafts[post.id] || ''}
                    currentLogin={user?.username || ''}
                    currentAvatar={avatarUrl}
                    currentName={profileForm.full_name || user?.name || user?.username}
                    isManager={isManager}
                    isAdmin={isAdmin}
                    isEnglish={isEnglishInterface}
                    interfaceLocale={interfaceLocale}
                    t={t}
                    getEmployeeAvatar={getEmployeeAvatar}
                    formatLogin={formatFeedLogin}
                    isMediaAttachment={isMediaAttachment}
                    MediaCard={FeedMediaCard}
                    AttachmentCard={AttachmentCard}
                    onOpenProfile={openEmployeeProfile}
                    onToggleMenu={(postId) => setOpenFeedMenuId((current) => (current === postId ? '' : postId))}
                    onStartEdit={startEditFeedPost}
                    onEditText={setEditingFeedText}
                    onSaveEdit={saveFeedPostEdit}
                    onCancelEdit={() => setEditingFeedPostId('')}
                    onPin={toggleFeedPinned}
                    onCopyLink={copyFeedPostLink}
                    onShare={shareFeedPostToChat}
                    onQuote={quoteFeedPost}
                    onHide={hideFeedPost}
                    onDelete={deleteFeedPost}
                    onOpenMedia={openFeedMediaViewer}
                    onToggleReaction={toggleFeedReaction}
                    onSelect={(postId) => {
                      if (selectedFeedPostId === postId && feedReactionExpanded) {
                        setFeedReactionExpanded(false);
                        return;
                      }
                      setSelectedFeedPostId((current) => (current === postId ? '' : postId));
                      setFeedReactionExpanded(false);
                    }}
                    onExpandReactions={() => setFeedReactionExpanded(true)}
                    onReplyComment={(postId, author) => setCommentDrafts((current) => ({
                      ...current,
                      [postId]: `@${formatFeedLogin(author)} `,
                    }))}
                    onDeleteComment={deleteFeedComment}
                    onToggleComments={(postId, expanded) => {
                      if (expanded) {
                        setExpandedCommentPosts((current) => ({ ...current, [postId]: false }));
                        return;
                      }
                      loadFeedComments(postId);
                    }}
                    onCommentDraftChange={(postId, value) => setCommentDrafts((current) => ({
                      ...current,
                      [postId]: value,
                    }))}
                    onSubmitComment={addCommentToPost}
                  />
                );
              })}
              {(hiddenFeedPostsCount > 0 || feedHasMore) && <button type="button" className="chat-pagination-button feed-pagination-button" disabled={feedLoadingMore || pendingFeedActions.length > 0} onClick={() => { if (hiddenFeedPostsCount > 0) setVisibleFeedPostCount((prev) => prev + FEED_POSTS_PAGE_SIZE); else loadMoreFeedPosts(); }}>{feedLoadingMore ? t('loading') : t('loadMoreFeed')} · {paginatedRegularFeedPosts.length}/{regularFeedPosts.length}{feedHasMore ? '+' : ''}</button>}
            </div>
          </section>
        )}

        {activeTab === 'profile' && (
          <div className="profile-workspace">
            {profileViewLogin && profilePreview ? (
              <div className="profile-preview-card">
                <button type="button" className="back-to-chat-btn profile-preview-back" onClick={() => setProfileViewLogin('')}>← {t('myProfile')}</button>
                <div className="profile-preview-hero">
                  <div className="profile-preview-avatar">{profilePreview.avatar ? <img src={profilePreview.avatar} alt="profile-avatar" /> : <span>{String(profilePreview.full_name || profilePreview.login || '?').slice(0, 1).toUpperCase()}</span>}</div>
                  <div className="profile-preview-identity">
                    <span className="profile-preview-kicker">{t('internalProfile')}</span>
                    <h3>{profilePreview.full_name || profilePreview.login}</h3>
                    <p>{formatVisibleLogin(profilePreview.login)}</p>
                    <div className="profile-preview-badges">
                      <span className="profile-status-pill">● {profilePreview.statusText || 'Work'}</span>
                      {profilePreview.department && <span>{profilePreview.department}</span>}
                      {profilePreview.room && <span>{t('room')} {profilePreview.room}</span>}
                    </div>
                  </div>
                </div>
                <div className="profile-preview-grid">
                  <div><span>💼</span><strong>{t('position')}</strong><p>{profilePreview.position || '—'}</p></div>
                  <div><span>🏢</span><strong>{t('department')}</strong><p>{profilePreview.department || '—'}</p></div>
                  <div><span>🚪</span><strong>{t('room')}</strong><p>{profilePreview.room || '—'}</p></div>
                  <div><span>☎️</span><strong>{t('phone')}</strong><p>{profilePreview.phone ? <a href={`tel:${profilePreview.phone}`}>{profilePreview.phone}</a> : '—'}</p></div>
                  <div className="profile-preview-wide"><span>🌐</span><strong>{t('website')}</strong><p>{getSafeExternalUrl(profilePreview.website) ? <a href={getSafeExternalUrl(profilePreview.website)} target="_blank" rel="noopener noreferrer">{profilePreview.website}</a> : (profilePreview.website || '—')}</p></div>
                  <div className="profile-preview-wide"><span>📝</span><strong>{t('bio')}</strong><p>{profilePreview.bio || '—'}</p></div>
                </div>
                <div className="profile-preview-actions">
                  <button type="button" onClick={() => { setSelectedEmail(profilePreview.login); setProfileViewLogin(''); setActiveTab('chat'); }}>{t('openDialog')}</button>
                </div>
              </div>
            ) : (
              <div className="profile-settings-grid">
                <section className="profile-panel profile-settings-panel">
                  <div className="profile-settings-tabs" role="tablist" aria-label={t('myProfile')}>
                    {['profile', 'appearance', 'chat', 'feed', 'security'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={profileSettingsTab === tab} className={profileSettingsTab === tab ? 'active' : ''} onClick={() => setProfileSettingsTab(tab)}>{t(`profileTab${tab[0].toUpperCase()}${tab.slice(1)}`)}</button>)}
                  </div>
                  {profileSettingsTab === 'profile' && <><h3>{t('myProfile')}</h3><form onSubmit={saveMyProfile} className="profile-form profile-form-labeled"><label><span>{t('fullName')}</span><input value={profileForm.full_name} disabled /></label><label><span>{t('login')}</span><input value={user?.username || ''} disabled /></label><label><span>{t('position')}</span><input value={profileForm.position} disabled /></label><label><span>{t('department')}</span><input value={profileForm.department} disabled /></label><label><span>{t('room')}</span><input value={profileForm.room} disabled /></label><label><span>{t('phone')}</span><input value={profileForm.phone} disabled /></label><label><span>{t('websiteVersion')}</span><select value={profileForm.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE} onChange={(e) => updateProfileField('websiteLanguage', e.target.value)}>{PROFILE_LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>{t('website')}</span><input placeholder="https://..." value={profileForm.website} onChange={(e) => updateProfileField('website', e.target.value)} /></label><label><span>{t('status')}</span><input placeholder={t('statusPlaceholder')} value={profileForm.statusText} onChange={(e) => updateProfileField('statusText', e.target.value)} /></label><label className="profile-field-wide"><span>{t('bio')}</span><textarea placeholder={t('bioPlaceholder')} rows={4} value={profileForm.bio} onChange={(e) => updateProfileField('bio', e.target.value)} /></label><button type="submit">{t('saveProfile')}</button></form></>}
                  {profileSettingsTab === 'appearance' && <><h3>{t('appearance')}</h3><div className="chat-appearance-controls profile-appearance-controls"><label><span>{t('theme')}</span><select value={chatLocalSettings.uiTheme || 'light'} onChange={(e) => updateChatUiSetting('uiTheme', e.target.value)}>{CHAT_THEMES.map((item) => <option key={item.id} value={item.id}>{getOptionLabel(item)}</option>)}</select></label><label><span>{t('density')}</span><select value={chatLocalSettings.uiDensity || 'regular'} onChange={(e) => updateChatUiSetting('uiDensity', e.target.value)}>{CHAT_DENSITIES.map((item) => <option key={item.id} value={item.id}>{getOptionLabel(item)}</option>)}</select></label><label><span>{t('textSize')}</span><select value={chatLocalSettings.uiTextSize || 'medium'} onChange={(e) => updateChatUiSetting('uiTextSize', e.target.value)}>{CHAT_TEXT_SIZES.map((item) => <option key={item.id} value={item.id}>{getOptionLabel(item)}</option>)}</select></label></div></>}
                  {profileSettingsTab === 'chat' && <><h3>{t('dialogTools')}</h3><div className="profile-chat-tools"><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showConversationMenu === true} onChange={() => toggleDialogToolSetting('showConversationMenu')} /><span><strong>{t('showConversationMenuTitle')}</strong><small>{t('showConversationMenuHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showExtraMessageActions === true} onChange={() => toggleDialogToolSetting('showExtraMessageActions')} /><span><strong>{t('showExtraMessageActionsTitle')}</strong><small>{t('showExtraMessageActionsHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showChatTemplates === true} onChange={() => toggleDialogToolSetting('showChatTemplates')} /><span><strong>{t('showChatTemplatesTitle')}</strong><small>{t('showChatTemplatesHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogMediaPanel === true} onChange={() => toggleDialogToolSetting('showDialogMediaPanel')} /><span><strong>{t('showDialogMediaPanelTitle')}</strong><small>{t('showDialogMediaPanelHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogDateJump === true} onChange={() => toggleDialogToolSetting('showDialogDateJump')} /><span><strong>{t('showDialogDateJumpTitle')}</strong><small>{t('showDialogDateJumpHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogFilters === true} onChange={() => toggleDialogToolSetting('showDialogFilters')} /><span><strong>{t('showDialogFiltersTitle')}</strong><small>{t('showDialogFiltersHint')}</small></span></label></div></>}
                  {profileSettingsTab === 'feed' && <><h3>{t('feedTools')}</h3><div className="profile-chat-tools"><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showFeedCategorySelect === true} onChange={() => toggleFeedToolSetting('showFeedCategorySelect')} /><span><strong>{t('showFeedCategorySelectTitle')}</strong><small>{t('showFeedCategorySelectHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showFeedFilters === true} onChange={() => toggleFeedToolSetting('showFeedFilters')} /><span><strong>{t('showFeedFiltersTitle')}</strong><small>{t('showFeedFiltersHint')}</small></span></label></div></>}
                  {profileSettingsTab === 'security' && <><h3>{t('securityPhoto')}</h3><div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>{t('changePhoto')}</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>{t('removePhoto')}</button></div><form onSubmit={changeMyPassword} className="profile-password-form"><input type="password" placeholder={t('currentPassword')} value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))} /><input type="password" placeholder={t('newPassword')} value={passwordForm.newPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))} /><button type="submit">{t('updatePassword')}</button></form>{!isAdmin && <button type="button" className="profile-logout-btn" onClick={handleLogout}>{t('logout')}</button>}</>}
                </section>
              </div>
            )}
          </div>
        )}

        {activeTab === 'employees' && isAdmin && (
          <section className="manager-panel">
            <h2>{t('employeeManagement')}</h2>
            <form className="manager-form manager-form-labeled" onSubmit={saveEmployee}>
              <label><span>{t('employeeLogin')}</span><input placeholder="ivanov@example.local" value={employeeForm.login} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, login: e.target.value }))} required /></label>
              <label>
                <span>{employeeForm.id ? t('newPasswordLabel') : t('password')}</span>
                <input type={showEmployeePassword ? 'text' : 'password'} placeholder={employeeForm.id ? t('passwordKeepPlaceholder') : t('loginPasswordPlaceholder')} value={employeeForm.password} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, password: e.target.value }))} />
                <small>{employeeForm.id ? t('passwordKeepHint') : t('passwordMinHint')}</small>
              </label>
              <label><span>Account role</span><select value={employeeForm.role} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, role: e.target.value }))}><option value="employee">Employee</option><option value="manager">Manager</option></select></label>
              <label><span>{t('fullName')}</span><input placeholder={t('profileNamePlaceholder')} value={employeeForm.full_name} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, full_name: e.target.value }))} /></label>
              <label><span>{t('department')}</span><input placeholder={t('employeeDepartmentPlaceholder')} value={employeeForm.department} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, department: e.target.value }))} /></label>
              <label className="manager-password-toggle"><input type="checkbox" checked={showEmployeePassword} onChange={(e) => setShowEmployeePassword(e.target.checked)} />{t('showPassword')}</label>
              <div className="manager-form-actions">
                <button type="submit">{employeeForm.id ? t('saveActionButton') : t('add')}</button>
                {employeeForm.id && <button type="button" onClick={() => { setEmployeeForm({ id: null, login: '', password: '', role: 'employee', full_name: '', department: '', phone: '', room: '' }); setShowEmployeePassword(false); }}>{t('cancel')}</button>}
              </div>
            </form>
            <div className="manager-list">
              {directoryEmployees.map((employee) => (
                <div className="manager-list-item" key={employee.id}>
                  <div><strong>{employee.login}</strong><div>{employee.full_name || '—'}</div></div>
                  <div className="manager-list-actions">
                    <button type="button" onClick={() => { setEmployeeForm({ id: employee.id, login: employee.login || '', password: '', role: employee.role === 'manager' ? 'manager' : 'employee', full_name: employee.full_name || '', department: employee.department || '', phone: employee.phone || '', room: employee.room || '' }); setShowEmployeePassword(false); }}>{t('edit')}</button>
                    <button type="button" onClick={() => deleteEmployee(employee.id)}>{t('delete')}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'audit' && isManager && (
          <section className="manager-panel">
            <h2>{t('employeeMessages')}</h2>
            <div className="audit-toolbar">
              <input type="search" placeholder={t('auditSearch')} value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} />
              <div className="audit-filter-row">
                <label><input type="checkbox" checked={auditFilters.showEmpty} onChange={(e) => setAuditFilters((prev) => ({ ...prev, showEmpty: e.target.checked }))} />{t('showEmptyArchived')}</label>
                <label><input type="checkbox" checked={auditFilters.attachmentsOnly} onChange={(e) => setAuditFilters((prev) => ({ ...prev, attachmentsOnly: e.target.checked }))} />{t('attachmentsOnly')}</label>
                <label><input type="checkbox" checked={auditFilters.deletedOnly} onChange={(e) => setAuditFilters((prev) => ({ ...prev, deletedOnly: e.target.checked }))} />{t('deletedOnly')}</label>
              </div>
              <div className="audit-periods">
                {AUDIT_PERIODS.map((period) => <button key={period.id} type="button" className={auditFilters.period === period.id ? 'active' : ''} onClick={() => setAuditFilters((prev) => ({ ...prev, period: period.id }))}>{getOptionLabel(period)}</button>)}
              </div>
            </div>
            <div className="threads-grid">
              <div className="threads-list">
                {allConversationIds.length === 0 && <div className="empty-chat">{t('noAuditDialogs')}</div>}
                {allConversationIds.map((threadId) => {
                  const participants = getParticipantsFromThreadId(threadId);
                  const meta = threadActivityById[threadId] || getThreadActivityMeta(threads[threadId] || []);
                  return (
                    <button key={threadId} type="button" className={`thread-item ${selectedThreadId === threadId ? 'active' : ''}`} onClick={() => setSelectedThreadId(threadId)}>
                      <span className="thread-title">{participants.join(' ↔ ')}</span>
                      <span className="thread-stats"><b>{meta.messageCount}</b> {t('messagesShort')} {meta.attachmentsCount > 0 ? ` · 📎 ${meta.attachmentsCount}` : ''}{meta.deletedCount > 0 ? ` · ${t('deletedShort')} ${meta.deletedCount}` : ''}</span>
                      <span className="thread-last">{meta.lastAt ? `${t('lastMessage')}: ${new Date(meta.lastAt).toLocaleString(interfaceLocale)}` : t('noMessagesShort')}</span>
                    </button>
                  );
                })}
              </div>
              <div className="threads-messages">
                {!selectedThreadId && <div className="empty-chat">{t('chooseConversation')}</div>}
                {selectedThreadId && loadingConversationIds[selectedThreadId] && <div className="empty-chat">{t('loading')}…</div>}
                {selectedThreadId && !loadingConversationIds[selectedThreadId] && selectedThreadMessages.map((message) => {
                  const isDeleted = Boolean(message.deletedAt);
                  const attachments = !isDeleted && message.attachments?.length ? message.attachments : !isDeleted && message.attachment ? [message.attachment] : [];
                  return (
                    <div key={message.id} className={`audit-message ${isDeleted ? 'deleted' : ''}`}>
                      <div className="message-meta"><span>{message.sender}</span><span>{new Date(message.createdAt).toLocaleString(interfaceLocale)}</span></div>
                      <div>{isDeleted ? <em>{t('deletedMessage')}</em> : message.text}</div>
                      {isDeleted && <div className="audit-history">{t('deletedBy')}: {message.deletedBy || '—'} · {message.deletedAt ? new Date(message.deletedAt).toLocaleString(interfaceLocale) : '—'}</div>}
                      {attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${message.id}-audit-${index}`} cardKey={`${message.id}-audit-${index}`} file={file} isEnglish={isEnglishInterface} />)}</div>}
                      {Array.isArray(message.audit) && message.audit.length > 0 && <div className="audit-history"><strong>{t('history')}:</strong>{message.audit.slice(-4).map((entry, index) => <span key={`${message.id}-audit-entry-${index}`}>{entry.action || t('change')} · {entry.by || '—'} · {entry.at ? new Date(entry.at).toLocaleString(interfaceLocale) : '—'}</span>)}</div>}
                      <div className="message-controls"><button type="button" onClick={() => editMessage(message.id, selectedThreadId)}>{t('edit')}</button><button type="button" onClick={() => deleteMessage(message.id, selectedThreadId)}>{t('delete')}</button></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </section>

      {mediaViewer && (() => {
        const viewerFiles = getViewerFiles();
        const viewerIndex = Math.max(0, Math.min(viewerFiles.length - 1, mediaViewer.fileIndex || 0));
        const hasManyViewerFiles = viewerFiles.length > 1;
        return (
          <div
            className="photo-viewer-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={t('media')}
            tabIndex={-1}
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
            <button type="button" className="photo-viewer-back" onClick={() => setMediaViewer(null)}>← {t('back')}</button>
            <strong className="photo-viewer-counter">{viewerIndex + 1} {t('of')} {viewerFiles.length || 1}</strong>
            <details className="photo-viewer-menu">
              <summary aria-label={t('viewerActions')}>⋯</summary>
              <div className="photo-viewer-menu-popover">
                <a href={getOriginalAttachmentUrl(mediaViewer.file)} download={mediaViewer.file.name || 'photo'}>{t('save')}</a>
                {mediaViewer.message && mediaViewer.source !== 'feed' && <button type="button" onClick={replyToViewedMedia}>{t('reply')}</button>}
                {mediaViewer.message && mediaViewer.source !== 'feed' && <button type="button" onClick={shareViewedMedia}>{t('share')}</button>}
                {mediaViewer.source === 'feed' && <button type="button" onClick={shareViewedFeedMedia}>{t('share')}</button>}
                {mediaViewer.source === 'feed' && canManageFeedPost(mediaViewer.post, user, isManager, isAdmin) && <button type="button" className="danger-action" disabled={isFeedPostPending(mediaViewer.post?.id)} onClick={deleteViewedMedia}>{t('delete')}</button>}
                {mediaViewer.message && mediaViewer.source !== 'feed' && (isManager || mediaViewer.message?.sender === user.username) && <button type="button" className="danger-action" onClick={deleteViewedMedia}>{t('delete')}</button>}
              </div>
            </details>
          </header>
          <div className="photo-viewer-stage" onMouseDown={(event) => event.stopPropagation()}>
            {hasManyViewerFiles && <button type="button" className="photo-viewer-nav prev" onClick={() => moveMediaViewer(-1)}>‹</button>}
            {isVideoAttachment(mediaViewer.file) ? (
              <video src={getOriginalAttachmentUrl(mediaViewer.file)} controls playsInline poster={getVideoPosterUrl(mediaViewer.file) || getAttachmentUrl(mediaViewer.file)} onLoadedMetadata={nudgeVideoToFirstFrame}>{t('unsupportedVideo')}</video>
            ) : (
              <img src={getOriginalAttachmentUrl(mediaViewer.file)} alt={mediaViewer.file.name || t('photoAlt')} decoding="async" />
            )}
            {hasManyViewerFiles && <button type="button" className="photo-viewer-nav next" onClick={() => moveMediaViewer(1)}>›</button>}
          </div>
          {hasManyViewerFiles && <div className="photo-viewer-thumbs" onMouseDown={(event) => event.stopPropagation()}>{viewerFiles.map((file, index) => <button key={file.id || `${file.name}-${index}`} type="button" className={index === viewerIndex ? 'active' : ''} onClick={() => setMediaViewer((current) => ({ ...current, file, fileIndex: index }))}>{isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name || t('thumbnailAlt')} loading="lazy" decoding="async" />}</button>)}</div>}
        </div>
        );
      })()}

      {forwardSourceMessage && (
        <div className="app-modal-backdrop" onMouseDown={() => setForwardSourceMessage(null)}>
          <div className="app-modal-card forward-picker-modal" role="dialog" aria-modal="true" aria-label={t('forwardMessageTitle')} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <h3>{t('forwardMessageTitle')}</h3>
            <p>{t('forwardMessageHint')}</p>
            <div className="forward-source-preview">
              <strong>{forwardSourceMessage.sender}</strong>
              <span>{forwardSourceMessage.text || t('attachmentWithoutText')}</span>
            </div>
            <div className="forward-contact-list">
              {chatCandidates.length === 0 && <div className="empty-mini">{t('noRecipients')}</div>}
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
                    <small>{formatVisibleLogin(employee.email)}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="app-modal-actions">
              <button type="button" onClick={() => setForwardSourceMessage(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {avatarViewerOpen && (
        <div className="app-modal-backdrop" onMouseDown={() => setAvatarViewerOpen(false)}>
          <div className="avatar-viewer" role="dialog" aria-modal="true" aria-label={t('profilePhoto')} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <header><strong>{t('profilePhoto')}</strong><button type="button" onClick={() => setAvatarViewerOpen(false)}>×</button></header>
            {avatarUrl ? <img src={avatarUrl} alt={t('profilePhoto')} decoding="async" /> : <div className="avatar-full-placeholder">{String(baseDisplayName || user?.username || '?').slice(0, 1).toUpperCase()}</div>}
            <div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>{t('edit')}</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>{t('delete')}</button></div>
          </div>
        </div>
      )}

      {modal && (
        <div className="app-modal-backdrop">
          <div className="app-modal-card" role="dialog" aria-modal="true" aria-labelledby="employee-chat-modal-title" tabIndex={-1}>
            <h3 id="employee-chat-modal-title">{modal.title}</h3>
            <p>{modal.message}</p>
            {modal.type === 'prompt' && <textarea rows={4} value={modal.value} onChange={(e) => setModal((prev) => ({ ...prev, value: e.target.value }))} />}
            <div className="app-modal-actions">
              {modal.type === 'info' && <button type="button" onClick={() => setModal(null)}>{t('understood')}</button>}
              {modal.type === 'confirm' && <><button type="button" onClick={() => closeModal(false)}>{t('cancel')}</button><button type="button" className="danger" onClick={() => closeModal(true)}>{t('confirmActionButton')}</button></>}
              {modal.type === 'prompt' && <><button type="button" onClick={() => closeModal('')}>{t('cancel')}</button><button type="button" onClick={() => closeModal(modal.value)}>{t('saveActionButton')}</button></>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeChat;
