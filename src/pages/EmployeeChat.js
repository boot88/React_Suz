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
const MANAGER_TEMPLATE_MESSAGES_EN = ['✅ Accepted', '👀 Reviewing now', '🔧 Working on it', '📌 Please confirm the room and device', '📷 Please send a photo of the error', '⏱️ I will respond within 15 minutes', '🧪 Testing the solution', '✅ Done, please check', '🙏 Thank you, closing the request'];
const EMPLOYEE_TEMPLATE_MESSAGES_EN = ['👋 Hello!', '🆘 I need help', '📍 I am in room ...', '📷 I will send a photo now', '✅ It works, thank you!', '❌ The error remains', '🔁 I repeated the step with the same result', '📞 Can we have a call?', '🙏 Thank you!'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🙏', '🎉', '🤩', '👌', '💯', '💪', '🤝', '✨', '👀'];
const QUICK_EMOJIS = ['😀', '🙂', '😅', '🙏', '👍', '✅', '👀', '📌', '🔧', '⏳', '❗', '❤️'];
const EMPLOYEE_CUSTOM_TEMPLATES_KEY = 'employeeChatCustomTemplates';
const MAX_ATTACHMENT_SIZE_MB = 100;
const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
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
  report: 'Пожаловаться',
  changeHistory: 'История изменений',
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
  report: 'Report',
  changeHistory: 'Change history',
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
    throw error;
  }

  return data;
};

const fetchJsonWithRetry = async (url, options = {}, { attempts = 4, retryDelay = 450, fallbackMessage = 'Ошибка сети' } = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
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
const getCurrentAttachmentLogin = () => {
  try {
    const authState = JSON.parse(localStorage.getItem('authState') || 'null');
    return String(authState?.user?.username || '').trim();
  } catch {
    return '';
  }
};

const appendAttachmentLogin = (url = '') => {
  const login = getCurrentAttachmentLogin();
  if (!login || !url.includes('/api/chat/files/')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}login=${encodeURIComponent(login)}`;
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

const AttachmentPreviewImage = ({ file, alt, useOriginal = false, eager = false, isEnglish = false }) => {
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
};

const PlayableVideo = ({ file, className = '', onExpand, isEnglish = false, variant = 'message' }) => {
  const [orientation, setOrientation] = useState('unknown');

  const handleMetadata = (event) => {
    const video = event.currentTarget;
    const ratio = Number(video.videoWidth || 0) / Math.max(1, Number(video.videoHeight || 0));
    setOrientation(ratio < 0.82 ? 'portrait' : ratio > 1.2 ? 'landscape' : 'square');
    nudgeVideoToFirstFrame(event);
  };

  return (
    <div className={`playable-video-shell ${variant} is-${orientation} ${className}`}>
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
};

const AttachmentCard = ({ file, cardKey, variant = 'message', onOpen, onSelect, onQuickReaction, metaLabel = '', statusLabel = '', isEnglish = false }) => {
  const fileName = file?.name || (isEnglish ? 'File' : 'Файл');
  const fileType = String(file?.type || '');
  const isImage = fileType.startsWith('image/');
  const isVideo = isVideoAttachment(file);
  const cardClassName = `${variant === 'feed' ? 'employee-feed-attachment-card' : 'message-attachment-card'} ${isVideo ? 'video-attachment' : ''}`;

  if (variant === 'message' && isImage) {
    return (
      <div key={cardKey} className="message-photo-card">
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
};

const FeedMediaCard = ({ file, onOpen, onQuickReaction, isEnglish = false }) => {
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
  const isAdmin = user?.role === 'admin';
   
  const avatarInputRef = useRef(null); 
  const messageTextareaRef = useRef(null);
  const profileDirtyRef = useRef(false);
  const profileLoadedForRef = useRef('');
   
  const [threads, setThreads] = useState({});
  const [threadHasMore, setThreadHasMore] = useState({});
  const [isLoadingOlderDialog, setIsLoadingOlderDialog] = useState(false);
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
  const [visibleDialogMessageCount, setVisibleDialogMessageCount] = useState(CHAT_MESSAGES_PAGE_SIZE);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [mediaPanelTab, setMediaPanelTab] = useState('media');
  const [mediaPanelSearch, setMediaPanelSearch] = useState('');
  const [contactFilter, setContactFilter] = useState('all');
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
  const [profilePreview, setProfilePreview] = useState(null);
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    department: '',
    phone: '',
    room: '',
    position: '',
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
  const [clockTick, setClockTick] = useState(0);
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
  const pendingFeedActionsRef = useRef(new Set());
  const pendingFeedPostIdsRef = useRef(new Set());
  const feedMutationVersionRef = useRef(0);
  const feedFetchSequenceRef = useRef(0);
  const feedFetchControllerRef = useRef(null);
  const forceScrollRef = useRef(false);
  const suppressThreadsRefreshUntilRef = useRef(0);
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

  const notify = useCallback((message, title = 'Готово') => {
    setModal({ type: 'info', title: localizeRuntimeText(title), message: localizeRuntimeText(message) });
  }, [localizeRuntimeText]);

  const queueChatSettingsSync = useCallback((settings) => {
    const login = user?.username;
    if (!login) return;
    if (settingsSyncTimerRef.current) clearTimeout(settingsSyncTimerRef.current);
    settingsSyncTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/profile/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login, preferences: settings }),
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
    if (hasSeenGreeting) return undefined;

    const greeting = isEnglishInterface ? `Hello, ${baseDisplayName}!` : `Здравствуйте, ${baseDisplayName}!`;
    setWelcomeNotice(greeting);
    sessionStorage.setItem(getGreetingKey(user.username), '1');
    const timer = setTimeout(() => setWelcomeNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [baseDisplayName, isEnglishInterface, user?.username]);

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
      websiteLanguage: getProfileValue(profile, cachedProfile, 'websiteLanguage', 'website_language') || DEFAULT_PROFILE_WEBSITE_LANGUAGE,
      website: getProfileValue(profile, cachedProfile, 'website') || getWebsiteByLanguage(getProfileValue(profile, cachedProfile, 'websiteLanguage', 'website_language') || DEFAULT_PROFILE_WEBSITE_LANGUAGE),
      statusText: getProfileValue(profile, cachedProfile, 'statusText', 'status_text'),
      avatar: getProfileValue(profile, cachedProfile, 'avatar')
    };

    if (!mergedProfile.full_name) mergedProfile.full_name = directoryProfile.full_name || '';
    if (!mergedProfile.department) mergedProfile.department = directoryProfile.department || '';
    if (!mergedProfile.phone) mergedProfile.phone = directoryProfile.phone || directoryProfile.internal_phone || directoryProfile.N_tel || '';
    if (!mergedProfile.room) mergedProfile.room = directoryProfile.room || directoryProfile.cabinet || '';
    if (mode === 'form') {
      const serverPreferences = profile.preferences && typeof profile.preferences === 'object'
        ? profile.preferences
        : null;
      if (serverPreferences && Object.keys(serverPreferences).length > 0) {
        const syncedSettings = {
          ...readChatLocalSettings(login),
          ...serverPreferences
        };
        setChatLocalSettings(syncedSettings);
        saveChatLocalSettings(login, syncedSettings);
      } else if (serverPreferences) {
        queueChatSettingsSync(readChatLocalSettings(login));
      }

      const shouldHydrateForm = !profileDirtyRef.current || profileLoadedForRef.current !== login;

      if (shouldHydrateForm) {
        setProfileForm({
          full_name: mergedProfile.full_name,
          department: mergedProfile.department,
          phone: mergedProfile.phone,
          room: mergedProfile.room,
          position: mergedProfile.position,
          bio: mergedProfile.bio,
          websiteLanguage: mergedProfile.websiteLanguage,
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

    setProfilePreview({ ...mergedProfile, login: profile.login || login });
  }, [directoryEmployees, queueChatSettingsSync, user.username]);

  const fetchThreads = useCallback(async () => {
    if (Date.now() < suppressThreadsRefreshUntilRef.current) return;

    try {
      const response = await fetch(`${API_BASE_URL}/chat/threads?limit=${CHAT_MESSAGES_PAGE_SIZE}`);
      const data = await readApiJson(response, 'Не удалось загрузить сообщения');
      if (Date.now() < suppressThreadsRefreshUntilRef.current) return;
      const nextThreads = data?.threads && typeof data.threads === 'object' ? data.threads : {};
      setThreads(nextThreads);
      setThreadHasMore(Object.fromEntries(Object.entries(nextThreads).map(([conversationId, messages]) => [conversationId, Array.isArray(messages) && messages.length >= CHAT_MESSAGES_PAGE_SIZE])));
    } catch (error) {
      console.error('Ошибка загрузки переписки:', error);
    }
  }, []);

  const loadOlderDialogMessages = useCallback(async () => {
    if (isLoadingOlderDialog || !currentConversationId || !currentMessages.length) return;
    const before = currentMessages[0]?.createdAt || '';
    setIsLoadingOlderDialog(true);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/messages?limit=${CHAT_MESSAGES_PAGE_SIZE}&before=${encodeURIComponent(before)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить предыдущие сообщения');
      const olderMessages = Array.isArray(data?.messages) ? data.messages : [];
      setThreads((prev) => {
        const current = Array.isArray(prev[currentConversationId]) ? prev[currentConversationId] : [];
        const byId = new Map([...olderMessages, ...current].filter((message) => message?.id).map((message) => [message.id, message]));
        const merged = [...byId.values()].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
        return { ...prev, [currentConversationId]: merged };
      });
      setThreadHasMore((prev) => ({ ...prev, [currentConversationId]: Boolean(data?.hasMore) && olderMessages.length >= CHAT_MESSAGES_PAGE_SIZE }));
      setVisibleDialogMessageCount((prev) => prev + CHAT_MESSAGES_PAGE_SIZE);
    } catch (error) {
      notify(error.message || 'Не удалось загрузить предыдущие сообщения', 'Чат');
    } finally {
      setIsLoadingOlderDialog(false);
    }
  }, [currentConversationId, currentMessages, isLoadingOlderDialog, notify]);

  const fetchFeed = useCallback(async ({ silent = true, force = false } = {}) => {
    if (!force && pendingFeedActionsRef.current.size > 0) return;
    const requestSequence = feedFetchSequenceRef.current + 1;
    feedFetchSequenceRef.current = requestSequence;
    const mutationVersionAtStart = feedMutationVersionRef.current;
    feedFetchControllerRef.current?.abort();
    const controller = new AbortController();
    feedFetchControllerRef.current = controller;
    const initialLoad = !silent && feedPostsRef.current.length === 0;
    if (initialLoad) setFeedLoading(true);
    else if (!silent) setFeedRefreshing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed?limit=${FEED_POSTS_PAGE_SIZE}&commentsLimit=3`, { signal: controller.signal });
      const data = await readApiJson(response, 'Не удалось загрузить ленту');
      if (
        requestSequence !== feedFetchSequenceRef.current
        || mutationVersionAtStart !== feedMutationVersionRef.current
        || pendingFeedActionsRef.current.size > 0
      ) return;
      const nextPosts = getVisibleFeedPosts(data?.posts);
      setFeedPosts((current) => (getFeedPostsSignature(current) === getFeedPostsSignature(nextPosts) ? current : nextPosts));
      setFeedHasMore(Boolean(data?.hasMore));
      setFeedBefore(data?.before || nextPosts[nextPosts.length - 1]?.createdAt || '');
      setVisibleFeedPostCount(FEED_POSTS_PAGE_SIZE);
      setFeedError('');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      const message = isNetworkFailure(error) ? getFriendlyNetworkMessage('Лента временно недоступна') : (error.message || 'Не удалось загрузить ленту');
      console.error('Ошибка загрузки ленты:', error);
      if (!silent && feedPostsRef.current.length === 0) {
        setFeedError(message);
        notify(message, 'Лента');
        return;
      }
    } finally {
      if (requestSequence === feedFetchSequenceRef.current) {
        if (initialLoad) setFeedLoading(false);
        if (!silent) setFeedRefreshing(false);
      }
    }
  }, [notify]);

  const loadMoreFeedPosts = useCallback(async () => {
    if (feedLoadingMore || !feedHasMore || !feedBefore || pendingFeedActionsRef.current.size > 0) return;
    const mutationVersionAtStart = feedMutationVersionRef.current;
    setFeedLoadingMore(true);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/feed?limit=${FEED_POSTS_PAGE_SIZE}&commentsLimit=3&before=${encodeURIComponent(feedBefore)}`);
      const data = await readApiJson(response, 'Не удалось загрузить ленту');
      if (mutationVersionAtStart !== feedMutationVersionRef.current || pendingFeedActionsRef.current.size > 0) return;
      const nextPosts = getVisibleFeedPosts(data?.posts);
      setFeedPosts((current) => {
        const byId = new Map([...current, ...nextPosts].filter((post) => post?.id).map((post) => [post.id, post]));
        return [...byId.values()].sort((a, b) => getFeedItemTimestamp(b) - getFeedItemTimestamp(a));
      });
      setFeedHasMore(Boolean(data?.hasMore));
      setFeedBefore(data?.before || nextPosts[nextPosts.length - 1]?.createdAt || '');
    } catch (error) {
      notify(error.message || 'Не удалось загрузить ленту', 'Лента');
    } finally {
      setFeedLoadingMore(false);
    }
  }, [feedBefore, feedHasMore, feedLoadingMore, notify]);

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
      const ownEmployee = employees.find((employee) => sameLogin(employee.login, user?.username || ''));
      if (ownEmployee) {
        const currentAvatar = ownEmployee.avatar || ownEmployee.profile?.avatar || '';
        setAvatarUrl(currentAvatar);
        if (currentAvatar) localStorage.setItem(getAvatarKey(user.username), currentAvatar);
        else localStorage.removeItem(getAvatarKey(user.username));
        saveProfileDraft(user.username, {
          ...readProfileDraft(user.username),
          avatar: currentAvatar
        });
      }
    } catch (error) {
      console.error('Ошибка загрузки сотрудников:', error);
    } finally {
      setIsDirectoryLoaded(true);
    }
  }, [user?.username]);

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
    const refreshCoreData = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchThreads();
      fetchEmployees();
      fetchMyApplications({ silent: true });
    };
    const refreshFeed = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchFeed({ silent: true });
    };
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      refreshCoreData();
      refreshFeed();
    };

    refreshCoreData();
    refreshFeed();

    const poller = setInterval(refreshCoreData, 8000);
    const feedPoller = setInterval(refreshFeed, 30000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(poller);
      clearInterval(feedPoller);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchThreads, fetchEmployees, fetchFeed, fetchMyApplications]);

  useEffect(() => {
    if (activeTab !== 'feed') return;
    fetchFeed({ silent: false });
  }, [activeTab, fetchFeed]);

  useEffect(() => {
    const hasActiveTimer = myApplications.some((application) => ['new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened'].includes(application.status));
    if (activeTab !== 'request' || !hasActiveTimer) return undefined;
    const timer = setInterval(() => setClockTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [activeTab, myApplications]);

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
    chatDraftsRef.current = chatDrafts;
  }, [chatDrafts]);

  useEffect(() => {
    if (!currentConversationId) return;
    skipDraftSaveRef.current = true;
    const saved = chatDraftsRef.current[currentConversationId] || {};
    setDraft(saved.text || '');
    setAttachmentDrafts(Array.isArray(saved.attachments) ? saved.attachments : []);
  }, [currentConversationId]);

  useEffect(() => {
    if (!currentConversationId) return;
    if (skipDraftSaveRef.current) {
      skipDraftSaveRef.current = false;
      return;
    }
    setChatDrafts((current) => {
      const next = { ...current, [currentConversationId]: { text: draft, attachments: attachmentDrafts } };
      chatDraftsRef.current = next;
      saveChatDrafts(user?.username || 'guest', next);
      return next;
    });
  }, [attachmentDrafts, currentConversationId, draft, user?.username]);

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
      const savedAvatar = data?.profile?.avatar || optimizedAvatar;
      setAvatarUrl(savedAvatar);
      localStorage.setItem(getAvatarKey(user.username), savedAvatar);
      saveProfileDraft(user.username, { ...profileForm, avatar: savedAvatar });
      await fetchEmployees();
    } catch (error) {
      notify(error.message || 'Не удалось обработать изображение. Попробуйте другое фото.', 'Фото профиля');
    } finally {
      event.target.value = '';
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
    saveProfileDraft(user.username, { ...profileForm, avatar: '' });
    await fetchEmployees();
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
    const thumbnailDataUrl = await createAttachmentThumbnailDataUrl(file);
    const formData = new FormData();
    formData.append('scope', scope);
    formData.append('name', file.name);
    formData.append('type', file.type || 'application/octet-stream');
    formData.append('size', String(file.size || 0));
    formData.append('uploadedBy', user?.username || '');
    if (thumbnailDataUrl) formData.append('thumbnailDataUrl', thumbnailDataUrl);
    formData.append('file', file, file.name);

    const response = await fetch(`${API_BASE_URL}/chat/uploads`, {
      method: 'POST',
      body: formData
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
      setRequestStatus({ state: 'error', textKey: 'requestFillDescription', text: '', ticketId: '' });
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
        setRequestStatus({ state: 'sent', textKey: 'requestSubmitted', text: '', ticketId: data?.id || data?.insertId || createMessageId().slice(0, 8) });
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

    setRequestStatus({ state: 'error', textKey: lastError?.message ? '' : 'requestNetworkError', text: lastError?.message || '', ticketId: '' });
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
      queueChatSettingsSync(next);
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

  const getConversationMediaItems = useCallback((scope = 'message', sourceMessage = null) => {
    const sourceMessages = scope === 'dialog' ? currentMessages : sourceMessage ? [sourceMessage] : [];
    return sourceMessages.flatMap((message) => getMessageMediaAttachments(message).map((file, index) => ({ file, message, fileIndex: index })));
  }, [currentMessages]);

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
    setRequestText(`${message.text || (isEnglishInterface ? 'Message with attachment' : 'Сообщение с вложением')}\n\n${isEnglishInterface ? 'Source' : 'Источник'}: ${message.sender}, ${new Date(message.createdAt).toLocaleString(interfaceLocale)}`);
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
  }, [getConversationMediaItems]);

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
    const confirmed = await confirmAction(t('deleteAttachmentConfirm'), t('deleteAttachmentTitle'));
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
      const { post, file } = mediaViewer;
      if (!post?.id || !file) return;
      const currentPost = feedPostsRef.current.find((item) => item.id === post.id) || post;
      const currentAttachments = getFeedAttachments(currentPost);
      const targetIndex = currentAttachments.findIndex((item) => (
        (file.id && item.id === file.id)
        || (file.url && item.url === file.url)
        || (item.name === file.name && item.type === file.type && item.size === file.size)
      ));
      if (targetIndex < 0) {
        setMediaViewer(null);
        return;
      }
      const targetFile = currentAttachments[targetIndex];
      const nextAttachments = currentAttachments.filter((_, index) => index !== targetIndex);
      const fileLabel = targetFile.name || (isVideoAttachment(targetFile) ? 'видео' : 'фото');
      const postHasText = Boolean(String(currentPost.text || '').trim());
      let confirmed = await confirmAction(t('deleteMediaFromPost').replace('{type}', isVideoAttachment(targetFile) ? t('deleteVideoType') : t('deletePhotoType')).replace('{name}', fileLabel), t('deleteAttachmentTitle'));
      if (!confirmed) return;
      if (!nextAttachments.length && !postHasText) {
        confirmed = await confirmAction(t('deleteLastPostAttachment'), t('deletePostTitle'));
        if (!confirmed) return;
        setMediaViewer(null);
        await deleteFeedPost(post.id, { skipConfirm: true });
        return;
      }
      const actionKey = `media-delete:${post.id}:${targetFile.id || targetFile.url || targetIndex}`;
      if (!beginFeedAction(actionKey, post.id)) return;
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
        setFeedPosts((current) => current.map((item) => (item.id === currentPost.id ? currentPost : item)));
        notify(
          isNetworkFailure(error) ? getFriendlyNetworkMessage('Не удалось удалить вложение') : (error.message || 'Не удалось удалить вложение'),
          'Лента'
        );
      } finally {
        endFeedAction(actionKey, post.id);
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
    if (!['УДАЛИТЬ', 'DELETE'].includes(String(typed || '').trim().toUpperCase())) return;

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

  const activeApplications = useMemo(() => myApplications.filter((item) => item.status !== 'done' && !item.fl), [myApplications]);
  const completedApplications = useMemo(() => myApplications.filter((item) => item.status === 'done' || item.fl), [myApplications]);
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

  const typingHint = draft.trim().length > 0 ? t('youTyping') : '';
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
  const requestBadge = activeApplications.length || (requestStatus.state === 'sent' ? 1 : 0);
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
        body: JSON.stringify(optimisticPost)
      }, { attempts: 2, fallbackMessage: 'Не удалось опубликовать запись' });

      const serverPost = data?.post ? { ...data.post, deliveryStatus: 'sent' } : null;
      setFeedPosts((current) => {
        const nextPosts = current.map((post) => (post.id === optimisticPost.id ? (serverPost || { ...post, deliveryStatus: 'sent' }) : post));
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
      const preparedFiles = await Promise.all(files.map((file) => uploadAttachmentFile(file, 'feed')));
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
      const response = await fetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments?limit=50`);
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
        body: JSON.stringify({
          id: optimisticComment.id,
          author: optimisticComment.author,
          authorName: optimisticComment.authorName,
          text
        })
      }, { attempts: 4, fallbackMessage: 'Не удалось добавить комментарий' });
      const savedComment = data.comment || optimisticComment;
      setFeedPosts((current) => current.map((post) => (
        post.id !== postId ? post : (() => {
          const comments = [...(post.comments || []).filter((comment) => comment.id !== optimisticComment.id), savedComment].filter(Boolean);
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
        `${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}?deletedBy=${encodeURIComponent(user?.username || 'employee')}`,
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
        `${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}?deletedBy=${encodeURIComponent(user?.username || 'employee')}`,
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
        body: JSON.stringify({ emoji, login, active })
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

  return (
    <div
      className={`employee-chat-layout theme-${chatLocalSettings.uiTheme || 'light'} density-${chatLocalSettings.uiDensity || 'regular'} text-${chatLocalSettings.uiTextSize || 'medium'} ${isDraggingFiles ? 'dragging-files' : ''}`}
      onDrop={handleAttachmentDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {isDraggingFiles && <div className="drop-zone-overlay"><strong>📎 {t('dropFiles')}</strong><span>{t('dropFilesHint')}</span></div>}
      {welcomeNotice && <div className="chat-welcome-notice" role="status"><span>{welcomeNotice}</span></div>}
      <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} hidden />
      
      <aside className="employee-chat-sidebar">
        <div className="employee-chat-brand">
          <button type="button" className="employee-avatar-upload" onClick={() => setAvatarViewerOpen(true)}>
            {avatarUrl ? <img src={avatarUrl} alt="avatar" className="employee-avatar-image" /> : <span>{String(baseDisplayName || '?').slice(0, 1).toUpperCase()}</span>}
          </button>
          <div className="employee-brand-meta">
            <strong>{profileForm.full_name || baseDisplayName}</strong>
            <span>{profileForm.position || profileForm.department || t('workingChat')}</span>
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


        <div className="employee-contact-panel">
          <label className="field-label">{t('contacts')}</label>
          <input
            className="employee-chat-search"
            placeholder={t('contactSearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <label className="contact-filter-select"><span>{t('filter')}</span><select value={contactFilter} onChange={(e) => setContactFilter(e.target.value)}>{CONTACT_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{getContactFilterLabel(filter)}</option>)}</select></label><div className={`employee-chat-list ${isManager ? 'manager-mode' : ''}`}>
            {availableEmployees.length === 0 && <div className="empty-mini">{t('noResults')}</div>}
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
                      <span className="employee-chat-user-extra">{formatVisibleLogin(employee.email)} · {profile.department || t('departmentMissing')} · {t('cabinetShort')}. {profile.room || '—'}</span>
                    </span>
                    {(isManagerContact || isOnline) && <span className="employee-chat-user-status">{isManagerContact ? t('admin') : t('online')}</span>}
                    {unreadByEmail[employee.email] > 0 && <span className="employee-chat-user-unread">{unreadByEmail[employee.email]}</span>}
                  </button>
                  <span className="contact-card-actions"><button type="button" className="profile-open-btn" onClick={() => { openProfileCard(employee.email); setActiveTab('profile'); }}>{t('profile')}</button><button type="button" className="favorite-contact-btn" aria-label={t('pinDialog')}  onClick={() => toggleLocalListValue('pinned', getConversationId(user.username, employee.email))}>{(chatLocalSettings.pinned || []).includes(getConversationId(user.username, employee.email)) ? '📌' : '📍'}</button><button type="button" className="favorite-contact-btn" aria-label={t('favorite')} onClick={() => toggleLocalListValue('favorites', employee.email)}>{(chatLocalSettings.favorites || []).includes(employee.email) ? '★' : '☆'}</button></span>
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
                <strong>{t('chooseDialog')}</strong>
                <span>{t('chooseDialogHint')}</span>
              </div>
            ) : (
              <>
                <header className="conversation-header">
                  <div>
                    <span className="eyebrow">{t('dialog')}</span>
                    <h2>{activeContact?.profile?.full_name || selectedEmail}</h2>
                    <p>{formatVisibleLogin(selectedEmail)}</p>
                  </div>
                  <div className="conversation-tools">
                    <input value={dialogSearch} onChange={(e) => { setDialogSearch(e.target.value); setDialogSearchIndex(0); }} placeholder={t('dialogSearch')} />{normalizedDialogSearch && <span className="dialog-search-count">{dialogSearchResults.length ? dialogSearchIndex + 1 : 0} {t('of')} {dialogSearchResults.length}</span>}<button type="button" disabled={!dialogSearchResults.length} onClick={() => setDialogSearchIndex((prev) => Math.max(0, prev - 1))}>↑</button><button type="button" disabled={!dialogSearchResults.length} onClick={() => setDialogSearchIndex((prev) => Math.min(dialogSearchResults.length - 1, prev + 1))}>↓</button>{chatLocalSettings.showDialogMediaPanel === true && <button type="button" onClick={() => setMediaPanelOpen((prev) => !prev)}>{t('mediaFiles')}</button>}
                    {chatLocalSettings.showConversationMenu === true && <details className="conversation-menu" open={conversationMenuOpen} onClick={(event) => event.stopPropagation()}>
                      <summary aria-label={t('dialogActions')} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConversationMenuOpen((prev) => !prev); }}>⋯</summary>
                      <div className="conversation-menu-popover">
                        <button type="button" onClick={() => { toggleLocalListValue('archived', currentConversationId); setConversationMenuOpen(false); }}>{t('archiveDialog')}</button><button type="button" onClick={() => { toggleLocalListValue('hidden', currentConversationId); setConversationMenuOpen(false); }}>{t('hideDialog')}</button><button type="button" onClick={() => { toggleLocalListValue('pinned', currentConversationId); setConversationMenuOpen(false); }}>{t('pinDialogAction')}</button><button type="button" onClick={() => { setReadState((prev) => ({ ...prev, [currentConversationId]: '' })); setConversationMenuOpen(false); }}>{t('markUnread')}</button><button type="button" onClick={() => { toggleLocalListValue('muted', currentConversationId); setConversationMenuOpen(false); }}>{t('muteNotifications')}</button><button type="button" onClick={() => { clearCurrentDraft(); setConversationMenuOpen(false); }}>{t('clearDraft')}</button><button type="button" className="danger-action" onClick={() => { clearConversation(); setConversationMenuOpen(false); }}>{t('deleteConversation')}</button>
                      </div>
                    </details>}
                  </div>
                </header>

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
                  {(hiddenDialogMessagesCount > 0 || threadHasMore[currentConversationId]) && <button type="button" className="chat-pagination-button" disabled={isLoadingOlderDialog} onClick={() => hiddenDialogMessagesCount > 0 ? setVisibleDialogMessageCount((prev) => prev + CHAT_MESSAGES_PAGE_SIZE) : loadOlderDialogMessages()}>{t('loadPreviousMessages')} · {t('showingLatestMessages').replace('{shown}', String(paginatedVisibleMessages.length)).replace('{total}', String(threadHasMore[currentConversationId] ? `${visibleMessages.length}+` : visibleMessages.length))}</button>}
                  {messagesWithDateSeparators.length === 0 && <div className="empty-chat">{dialogSearch ? t('noMessageSearchResults') : t('noMessages')}</div>}
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

                  <form className="message-form" onSubmit={handleSend}>
                    <div className="composer-textarea-box">
                      <div className="composer-input-shell">
                        <button type="button" className="composer-emoji-btn" aria-label={t('emoji')} onClick={() => setIsEmojiOpen((prev) => !prev)}>☺</button>
                        {isEmojiOpen && (
                          <div className="emoji-picker composer-emoji-picker">
                            {QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => { appendToDraft(emoji); setIsEmojiOpen(false); }}>{emoji}</button>)}
                          </div>
                        )}
                        <textarea
                          ref={messageTextareaRef}
                          placeholder={t('messagePlaceholder')}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={handleComposerKeyDown}
                          onPaste={handleComposerPaste}
                          maxLength={2000}
                          rows={1}
                        />
                      </div>
                      <div className="composer-hints">
                        <label><input type="checkbox" checked={chatLocalSettings.enterToSend !== false} onChange={() => updateChatLocalSettings((prev) => ({ ...prev, enterToSend: prev.enterToSend === false }))} /> {t('enterSends')}</label>
                        {draft.length > 1600 && <span className={draft.length > 1900 ? 'limit-warning' : ''}>{draft.length}/2000</span>}
                        <span>{t('composerHint')}</span>
                      </div>
                    </div>
                    <label className="attach-file-btn" aria-label={t('attachFiles')} title={t('attachFiles')}>📎<input type="file" hidden multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z" onChange={handleAttachmentChange} /></label>
                    <button type="submit" disabled={isSendingMessage}>{isSendingMessage ? t('sending') : isOnline ? t('send') : t('queue')}</button>
                  </form>
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
                const waitingStartedAt = ticket.created_at || ticket.data;
                const waitingSeconds = ticket.waiting_seconds ?? (ticket.status === 'new' || ticket.status === 'reopened' ? secondsSince(waitingStartedAt) : null);
                const workSeconds = ticket.work_seconds != null
                  ? Number(ticket.work_seconds || 0) + (['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(ticket.status) ? secondsSince(ticket.resolved_at || ticket.work_started_at || ticket.accepted_at) : 0)
                  : (['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(ticket.status) ? secondsSince(ticket.work_started_at || ticket.accepted_at) : null);
                return (
                  <article key={ticket.id} className={`employee-ticket-card ${meta.tone}`}>
                    <header><div><strong>#{ticket.id} · {meta.label}</strong><span>{getRequestCategoryLabel(ticket.category || 'Другое')} · {getRequestPriorityLabel(ticket.priority || 'Обычный')}</span></div><em>{meta.hint}</em></header>
                    <p>{ticket.application}</p>
                    <div className="ticket-metrics">{waitingSeconds != null && <span>{t('waitingTime')}: {formatDuration(waitingSeconds)}</span>}{workSeconds != null && workSeconds > 0 && <span>{t('workTime')}: {formatDuration(workSeconds)}</span>}</div>
                    {(ticket.executor || ticket.accepted_by || ticket.admin_comment || ticket.eta_minutes) && <div className="ticket-admin-note"><strong>{ticket.executor || ticket.accepted_by || t('administrator')}</strong><span>{ticket.admin_comment || (ticket.eta_minutes ? t('administratorEta').replace('{minutes}', ticket.eta_minutes) : t('administratorAccepted'))}</span></div>}
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
              <article className="employee-feed-post feed-composer-post">
                <header className="employee-feed-header compact-feed-header feed-composer-post-header">
                  <div><h2>{t('feedTitle')}</h2><p>{t('feedSubtitle')}</p></div>
                  <button type="button" disabled={feedRefreshing || pendingFeedActions.length > 0} onClick={() => fetchFeed({ silent: false })}>{feedRefreshing ? t('refreshing') : t('refresh')}</button>
                </header>
                {feedError && <div className="feed-status-warning">{t('feedUnavailable')}: {localizeRuntimeText(feedError)}</div>}
                <form className="employee-feed-composer compact-feed-composer vk-feed-composer" onSubmit={addFeedPost}>
                  <div className="feed-composer-body"><div className="feed-avatar feed-avatar-current">{avatarUrl ? <img src={avatarUrl} alt={t('myAvatar')} loading="lazy" decoding="async" /> : <span>{String(profileForm.full_name || user?.name || user?.username || '?').slice(0, 1).toUpperCase()}</span>}</div><div className={`feed-composer-line ${chatLocalSettings.showFeedCategorySelect === true ? 'has-category' : 'without-category'}`}>{chatLocalSettings.showFeedCategorySelect === true && <select value={feedCategory} onChange={(e) => setFeedCategory(e.target.value)}>{FEED_CATEGORIES.map((category) => <option key={category} value={category}>{getFeedCategoryLabel(category)}</option>)}</select>}<textarea rows={2} placeholder={t('whatsNew')} value={feedDraft} onChange={(e) => setFeedDraft(e.target.value)} /></div></div>
                  {feedAttachments.length > 0 && (
                    <div className="employee-feed-attachment-preview-grid media-draft-grid">
                      {feedAttachments.map((file, index) => {
                        const mediaFile = String(file.type || '').startsWith('image/') || isVideoAttachment(file);
                        return (
                          <div key={file.id || `${file.name}-${index}`} className={`employee-feed-attachment-preview media-draft-tile ${mediaFile ? 'is-media' : ''}`}>
                            {mediaFile ? (
                              <button type="button" className="media-draft-thumb" onClick={() => setMediaViewer({ source: 'feed-draft', file, fileIndex: index })}>
                                {isVideoAttachment(file) ? <video src={getOriginalAttachmentUrl(file)} poster={getVideoPosterUrl(file) || getAttachmentUrl(file)} muted playsInline preload="metadata" onLoadedMetadata={nudgeVideoToFirstFrame} /> : <img src={getAttachmentUrl(file)} alt={file.name} loading="lazy" decoding="async" />}
                              </button>
                            ) : <span className="media-draft-file-icon">{getFileIcon(file.type)}</span>}
                            <span>{file.name} · {formatFileSize(file.size)}</span>
                            <button type="button" className="media-draft-remove" onClick={() => removeFeedAttachment(file.id || `${file.name}-${index}`)}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="employee-feed-composer-actions"><label>📎 {t('photoVideo')}<input type="file" multiple hidden accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z" onChange={onFeedFileChange} /></label><button type="submit" disabled={isPublishingFeed || (!feedDraft.trim() && feedAttachments.length === 0)}>{isPublishingFeed ? t('publishing') : t('publish')}</button></div>
                </form>
              </article>
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
                        <span>{authorMeta}{post.editedAt && ` · ${t('changed')}`}</span>
                      </button>
                      <button type="button" className="feed-post-menu-button" onClick={(event) => { event.stopPropagation(); setOpenFeedMenuId(openFeedMenuId === post.id ? '' : post.id); }}>⋯</button>
                      {openFeedMenuId === post.id && <div className="feed-post-menu" onClick={(event) => event.stopPropagation()}>{canDeletePost && <button type="button" disabled={postMutationPending} onClick={() => startEditFeedPost(post)}>{t('editText')}</button>}{isManager && <button type="button" disabled={postMutationPending} onClick={() => toggleFeedPinned(post.id, !post.pinned)}>{post.pinned ? t('unpin') : t('pin')}</button>}<button type="button" onClick={() => copyFeedPostLink(post.id)}>{t('copyLink')}</button><button type="button" onClick={() => shareFeedPostToChat(post)}>{t('sharePost')}</button><button type="button" onClick={() => quoteFeedPost(post)}>{t('quotePost')}</button><button type="button" onClick={() => hideFeedPost(post.id)}>{t('hidePost')}</button>{!isPostAuthor(post, user) && <button type="button" onClick={() => reportFeedPost(post.id)}>{t('report')}</button>}{(isManager || isAdmin) && <button type="button" onClick={() => notify((post.audit || []).length ? 'История есть в аудите' : 'История изменений пуста', 'Лента')}>{t('changeHistory')}</button>}{canDeletePost && <button type="button" className="danger-action" disabled={postMutationPending} onClick={() => deleteFeedPost(post.id)}>{t('delete')}</button>}</div>}
                    </header>
                    {editingFeedPostId === post.id ? <div className="feed-edit-box"><textarea rows={3} value={editingFeedText} onChange={(e) => setEditingFeedText(e.target.value)} /><div><button type="button" disabled={postMutationPending} onClick={() => saveFeedPostEdit(post.id)}>{t('saveActionButton')}</button><button type="button" disabled={postMutationPending} onClick={() => setEditingFeedPostId('')}>{t('cancel')}</button></div></div> : post.text && <p className="employee-feed-post-text">{post.text}</p>}
                    {postAttachments.length > 0 && (
                      <div className={`employee-feed-media-grid media-count-${Math.min(postMediaAttachments.length, 4)} ${singlePhotoPost ? 'single-photo' : ''}`}>
                        {postAttachments.map((file, index) => (
                          isMediaAttachment(file) ? (
                            <FeedMediaCard
                              key={file.id || `${post.id}-feed-media-${index}`}
                              file={file}
                              isEnglish={isEnglishInterface}
                              onOpen={() => openFeedMediaViewer(post, file)}
                              onQuickReaction={() => {
                                if (!postMutationPending) toggleFeedReaction(post.id, '👍');
                              }}
                            />
                          ) : (
                            <AttachmentCard
                              key={file.id || `${post.id}-feed-file-${index}`}
                              cardKey={`${post.id}-feed-file-${index}`}
                              file={file}
                              variant="feed"
                              isEnglish={isEnglishInterface}
                            />
                          )
                        ))}
                      </div>
                    )}
                    <div className="message-reactions-inline feed-reactions-inline">{REACTION_EMOJIS.filter((emoji) => (post.reactions?.[emoji] || []).length > 0).map((emoji) => { const active = (post.reactions?.[emoji] || []).includes(user?.username); return <button key={emoji} type="button" className={active ? 'active' : ''} disabled={postMutationPending} aria-busy={postMutationPending} onClick={(event) => { event.stopPropagation(); toggleFeedReaction(post.id, emoji); }} title={(post.reactions?.[emoji] || []).join(', ')}>{emoji} {(post.reactions?.[emoji] || []).length}</button>; })}</div>
                    {selectedFeedPostId === post.id && (
                      <div className="feed-selected-menu compact-feed-selected-menu" onClick={(event) => event.stopPropagation()}>
                        <div className="selected-reaction-row feed-reaction-picker">{(feedReactionExpanded ? REACTION_EMOJIS : REACTION_EMOJIS.slice(0, 7)).map((emoji) => { const active = (post.reactions?.[emoji] || []).includes(user?.username); return <button key={emoji} type="button" className={active ? 'active' : ''} disabled={postMutationPending} aria-busy={postMutationPending} onClick={() => toggleFeedReaction(post.id, emoji)}>{emoji}</button>; })}{!feedReactionExpanded && <button type="button" className="more-reactions" onClick={() => setFeedReactionExpanded(true)}>⌄</button>}</div>
                        <div className="selected-actions-row feed-actions-row">{isManager && <button type="button" disabled={postMutationPending} onClick={() => toggleFeedPinned(post.id, !post.pinned)}>{post.pinned ? t('unpin') : t('pin')}</button>}</div>
                      </div>
                    )}
                    <div className="employee-feed-comments">
                      <div className="employee-feed-comments-title">{t('comments')} · {totalPostComments}</div>
                      {sortedPostComments.length === 0 && <small className="employee-feed-no-comments">{t('noComments')}</small>}
                      {previewComments.map((comment) => { const canDeleteComment = isManager || isAdmin || comment.author === user?.username; const commentInitial = String(comment.authorName || comment.author || '?').slice(0, 1).toUpperCase(); const commentAvatar = getEmployeeAvatar(comment.author, comment.avatar, comment.authorAvatar, comment.authorPhoto, comment.author_photo); return <div key={comment.id} className="employee-feed-comment"><button type="button" className="feed-avatar comment-avatar profile-link-avatar" onClick={(event) => openEmployeeProfile(comment.author, event)}>{commentAvatar ? <img src={commentAvatar} alt={comment.authorName || comment.author || t('comments')} loading="lazy" decoding="async" /> : <span>{commentInitial}</span>}</button><div className="employee-feed-comment-body"><button type="button" className="comment-author-link" onClick={(event) => openEmployeeProfile(comment.author, event)}>{comment.authorName || formatFeedLogin(comment.author)}</button><span>{comment.text}</span><small>{new Date(comment.createdAt).toLocaleString(interfaceLocale)}</small><div className="feed-comment-actions compact"><button type="button" onClick={() => setCommentDrafts((prev) => ({ ...prev, [post.id]: `@${formatFeedLogin(comment.author)} ` }))}>{t('reply')}</button>{canDeleteComment && <button type="button" disabled={postMutationPending} aria-busy={postMutationPending} onClick={() => deleteFeedComment(post.id, comment.id)}>{t('delete')}</button>}</div></div></div>; })}
                      {(hiddenCommentsCount > 0 || (expandedCommentPosts[post.id] && totalPostComments > 2)) && (
                        <button
                          type="button"
                          className="feed-show-more-comments"
                          disabled={postMutationPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (expandedCommentPosts[post.id]) {
                              setExpandedCommentPosts((prev) => ({ ...prev, [post.id]: false }));
                            } else {
                              loadFeedComments(post.id);
                            }
                          }}
                        >
                          {expandedCommentPosts[post.id] ? t('hideComments') : t('showAllComments')} ({totalPostComments})
                        </button>
                      )}
                      <div className="employee-feed-comment-form" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onFocus={(event) => event.stopPropagation()}><div className="feed-avatar comment-avatar feed-avatar-current">{avatarUrl ? <img src={avatarUrl} alt={t('myAvatar')} loading="lazy" decoding="async" /> : <span>{String(profileForm.full_name || user?.name || user?.username || '?').slice(0, 1).toUpperCase()}</span>}</div><input placeholder={t('writeComment')} value={commentDrafts[post.id] || ''} disabled={postMutationPending} onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))} />{(commentDrafts[post.id] || '').trim() && <button type="button" disabled={postMutationPending} onClick={() => addCommentToPost(post.id)}>{t('sendComment')}</button>}</div>
                    </div>
                  </article>
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
                <section className="profile-panel"><h3>{t('myProfile')}</h3><form onSubmit={saveMyProfile} className="profile-form profile-form-labeled"><label><span>{t('fullName')}</span><input placeholder={t('profileNamePlaceholder')} value={profileForm.full_name} onChange={(e) => updateProfileField('full_name', e.target.value)} /></label><label><span>{t('login')}</span><input value={profileForm.full_name || user?.name || user?.username || ''} disabled /></label><label><span>{t('position')}</span><input placeholder={t('positionPlaceholder')} value={profileForm.position} onChange={(e) => updateProfileField('position', e.target.value)} /></label><label><span>{t('department')}</span><input placeholder={t('departmentPlaceholder')} value={profileForm.department} onChange={(e) => updateProfileField('department', e.target.value)} /></label><label><span>{t('room')}</span><input placeholder={t('roomPlaceholder')} value={profileForm.room} onChange={(e) => updateProfileField('room', e.target.value)} /></label><label><span>{t('phone')}</span><input placeholder={t('phonePlaceholder')} value={profileForm.phone} onChange={(e) => updateProfileField('phone', e.target.value)} /></label><label><span>{t('websiteVersion')}</span><select value={profileForm.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE} onChange={(e) => updateProfileField('websiteLanguage', e.target.value)}>{PROFILE_LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>{t('website')}</span><input placeholder="https://..." value={profileForm.website} onChange={(e) => updateProfileField('website', e.target.value)} /></label><label><span>{t('status')}</span><input placeholder={t('statusPlaceholder')} value={profileForm.statusText} onChange={(e) => updateProfileField('statusText', e.target.value)} /></label><label className="profile-field-wide"><span>{t('bio')}</span><textarea placeholder={t('bioPlaceholder')} rows={4} value={profileForm.bio} onChange={(e) => updateProfileField('bio', e.target.value)} /></label><button type="submit">{t('saveProfile')}</button></form></section>
                <section className="profile-panel"><h3>{t('securityPhoto')}</h3><div className="profile-appearance-settings"><h4>{t('appearance')}</h4><div className="chat-appearance-controls profile-appearance-controls"><label><span>{t('theme')}</span><select value={chatLocalSettings.uiTheme || 'light'} onChange={(e) => updateChatUiSetting('uiTheme', e.target.value)}>{CHAT_THEMES.map((item) => <option key={item.id} value={item.id}>{getOptionLabel(item)}</option>)}</select></label><label><span>{t('density')}</span><select value={chatLocalSettings.uiDensity || 'regular'} onChange={(e) => updateChatUiSetting('uiDensity', e.target.value)}>{CHAT_DENSITIES.map((item) => <option key={item.id} value={item.id}>{getOptionLabel(item)}</option>)}</select></label><label><span>{t('textSize')}</span><select value={chatLocalSettings.uiTextSize || 'medium'} onChange={(e) => updateChatUiSetting('uiTextSize', e.target.value)}>{CHAT_TEXT_SIZES.map((item) => <option key={item.id} value={item.id}>{getOptionLabel(item)}</option>)}</select></label></div></div><div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>{t('changePhoto')}</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>{t('removePhoto')}</button></div><div className="profile-chat-tools"><strong>{t('dialogTools')}</strong><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showConversationMenu === true} onChange={() => toggleDialogToolSetting('showConversationMenu')} /><span><strong>{t('showConversationMenuTitle')}</strong><small>{t('showConversationMenuHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showExtraMessageActions === true} onChange={() => toggleDialogToolSetting('showExtraMessageActions')} /><span><strong>{t('showExtraMessageActionsTitle')}</strong><small>{t('showExtraMessageActionsHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showChatTemplates === true} onChange={() => toggleDialogToolSetting('showChatTemplates')} /><span><strong>{t('showChatTemplatesTitle')}</strong><small>{t('showChatTemplatesHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogMediaPanel === true} onChange={() => toggleDialogToolSetting('showDialogMediaPanel')} /><span><strong>{t('showDialogMediaPanelTitle')}</strong><small>{t('showDialogMediaPanelHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogDateJump === true} onChange={() => toggleDialogToolSetting('showDialogDateJump')} /><span><strong>{t('showDialogDateJumpTitle')}</strong><small>{t('showDialogDateJumpHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showDialogFilters === true} onChange={() => toggleDialogToolSetting('showDialogFilters')} /><span><strong>{t('showDialogFiltersTitle')}</strong><small>{t('showDialogFiltersHint')}</small></span></label></div><div className="profile-chat-tools"><strong>{t('feedTools')}</strong><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showFeedCategorySelect === true} onChange={() => toggleFeedToolSetting('showFeedCategorySelect')} /><span><strong>{t('showFeedCategorySelectTitle')}</strong><small>{t('showFeedCategorySelectHint')}</small></span></label><label className="profile-toggle-row"><input type="checkbox" checked={chatLocalSettings.showFeedFilters === true} onChange={() => toggleFeedToolSetting('showFeedFilters')} /><span><strong>{t('showFeedFiltersTitle')}</strong><small>{t('showFeedFiltersHint')}</small></span></label></div><form onSubmit={changeMyPassword} className="profile-password-form"><input type="password" placeholder={t('currentPassword')} value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))} /><input type="password" placeholder={t('newPassword')} value={passwordForm.newPassword} onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))} /><button type="submit">{t('updatePassword')}</button></form>{!isAdmin && <button type="button" className="profile-logout-btn" onClick={handleLogout}>{t('logout')}</button>}</section>
              </div>
            )}
          </div>
        )}

        {activeTab === 'employees' && isManager && (
          <section className="manager-panel">
            <h2>{t('employeeManagement')}</h2>
            <form className="manager-form manager-form-labeled" onSubmit={saveEmployee}>
              <label><span>{t('employeeLogin')}</span><input placeholder="ivanov@example.local" value={employeeForm.login} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, login: e.target.value }))} required /></label>
              <label>
                <span>{employeeForm.id ? t('newPasswordLabel') : t('password')}</span>
                <input type={showEmployeePassword ? 'text' : 'password'} placeholder={employeeForm.id ? t('passwordKeepPlaceholder') : t('loginPasswordPlaceholder')} value={employeeForm.password} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, password: e.target.value }))} />
                <small>{employeeForm.id ? t('passwordKeepHint') : t('passwordMinHint')}</small>
              </label>
              <label><span>{t('fullName')}</span><input placeholder={t('profileNamePlaceholder')} value={employeeForm.full_name} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, full_name: e.target.value }))} /></label>
              <label><span>{t('department')}</span><input placeholder={t('employeeDepartmentPlaceholder')} value={employeeForm.department} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, department: e.target.value }))} /></label>
              <label className="manager-password-toggle"><input type="checkbox" checked={showEmployeePassword} onChange={(e) => setShowEmployeePassword(e.target.checked)} />{t('showPassword')}</label>
              <div className="manager-form-actions">
                <button type="submit">{employeeForm.id ? t('saveActionButton') : t('add')}</button>
                {employeeForm.id && <button type="button" onClick={() => { setEmployeeForm({ id: null, login: '', password: '', full_name: '', department: '', phone: '', room: '' }); setShowEmployeePassword(false); }}>{t('cancel')}</button>}
              </div>
            </form>
            <div className="manager-list">
              {directoryEmployees.map((employee) => (
                <div className="manager-list-item" key={employee.id}>
                  <div><strong>{employee.login}</strong><div>{employee.full_name || '—'}</div></div>
                  <div className="manager-list-actions">
                    <button type="button" onClick={() => { setEmployeeForm({ id: employee.id, login: employee.login || '', password: '', full_name: employee.full_name || '', department: employee.department || '', phone: employee.phone || '', room: employee.room || '' }); setShowEmployeePassword(false); }}>{t('edit')}</button>
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
                {selectedThreadId && selectedThreadMessages.map((message) => {
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
          <div className="app-modal-card forward-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
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
          <div className="avatar-viewer" onMouseDown={(event) => event.stopPropagation()}>
            <header><strong>{t('profilePhoto')}</strong><button type="button" onClick={() => setAvatarViewerOpen(false)}>×</button></header>
            {avatarUrl ? <img src={avatarUrl} alt={t('profilePhoto')} decoding="async" /> : <div className="avatar-full-placeholder">{String(baseDisplayName || user?.username || '?').slice(0, 1).toUpperCase()}</div>}
            <div className="avatar-actions-row"><button type="button" onClick={() => avatarInputRef.current?.click()}>{t('edit')}</button><button type="button" onClick={removeAvatar} disabled={!avatarUrl}>{t('delete')}</button></div>
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
