import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../utils/apiConfig';
import { authFetch, withAccessToken } from '../../utils/authFetch';
import { ensureMediaTokens, getFileIdFromUrl } from '../../utils/mediaTokenCache';

const CHAT_READ_STATE_KEY = 'chatReadState';
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
const CHAT_MESSAGES_PAGE_SIZE = 50;
const FEED_POSTS_PAGE_SIZE = 25;
const FEED_COMMENTS_PAGE_SIZE = 20;
const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)$/i;
const EMPLOYEE_TABS = [
  { id: 'feed', label: 'Лента' },
  { id: 'chat', label: 'Чат' },
  { id: 'request', label: 'Мои заявки' },
  { id: 'receivedArchives', label: 'Полученные архивы' }
];
const MANAGER_TABS = [
  { id: 'chat', label: 'Чат' },
  { id: 'feed', label: 'Лента' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'audit', label: 'Аудит' },
  { id: 'archive', label: 'Архив' }
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
  adminPanel: 'Админка',
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
  loadMoreComments: 'Показать ещё комментарии',
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
  savedOriginal: 'Сохранённый оригинал',
  history: 'История',
  change: 'изменение',
  archiveCenter: 'Архив переписки',
  archiveSearch: 'Сотрудник, текст сообщения или имя файла',
  archiveAll: 'Все',
  archiveActive: 'Активные',
  archiveStored: 'Архивные',
  archiveConversation: 'Архивировать',
  restoreConversation: 'Разархивировать',
  archiveEmpty: 'Переписки по заданным условиям не найдены.',
  archiveChoose: 'Выберите переписку для отдельного просмотра.',
  archiveFrom: 'С даты',
  archiveTo: 'По дату',
  archivePackages: 'Сформированные ZIP-архивы',
  archiveName: 'Название архива (необязательно)',
  createFullArchive: 'Создать полный архив чатов и ленты',
  createConversationArchive: 'Создать ZIP выбранной переписки',
  archivePending: 'Формируется',
  archiveCompleted: 'Готов',
  archiveFailed: 'Ошибка',
  archiveDownload: 'Скачать ZIP',
  archiveNoPackages: 'Архивы ещё не формировались.',
  archiveRecords: 'записей',
  archiveFiles: 'файлов',
  archiveGrantAccess: 'Выдать доступ',
  archiveAccessEmployee: 'Выберите сотрудника',
  archiveAccessDuration: 'Срок доступа',
  archiveAccessOneDay: '1 день',
  archiveAccessSevenDays: '7 дней',
  archiveAccessThirtyDays: '30 дней',
  archiveAccessNinetyDays: '90 дней',
  archiveAccesses: 'Выданные доступы',
  archiveAccessUntil: 'до',
  archiveAccessRevoked: 'отозван',
  archiveAccessExpired: 'истёк',
  archiveRevokeAccess: 'Отозвать',
  archiveConversationOnly: 'Доступ сотруднику выдаётся только к ZIP отдельной переписки.',
  receivedArchives: 'Полученные архивы',
  receivedArchivesHint: 'Здесь администратор может временно открыть вам старую переписку. Архив доступен только для чтения.',
  receivedArchivesEmpty: 'Администратор пока не выдавал вам доступ к архивам.',
  receivedArchiveChoose: 'Выберите архив слева, чтобы открыть переписку.',
  receivedArchiveGrantedBy: 'Выдал',
  receivedArchiveExpires: 'Доступ до',
  legalHoldTitle: 'Запрет удаления · legal hold',
  legalHoldHint: 'Защищает выбранную переписку, все её сообщения и файлы от физического удаления.',
  legalHoldName: 'Название запрета',
  legalHoldReason: 'Причина и основание',
  legalHoldEnd: 'Действует до (необязательно)',
  legalHoldCreate: 'Установить запрет',
  legalHoldChoose: 'Сначала выберите переписку в списке ниже.',
  legalHoldSearch: 'Название, причина, сотрудник или диалог',
  legalHoldAll: 'Все запреты',
  legalHoldActive: 'Действующие',
  legalHoldExpired: 'Истёкшие',
  legalHoldReleased: 'Снятые',
  legalHoldEmpty: 'Запреты по заданным условиям не найдены.',
  legalHoldPermanent: 'Бессрочно',
  legalHoldProtected: 'Удаление запрещено',
  legalHoldItems: 'защищённых объектов',
  legalHoldRelease: 'Снять запрет',
  legalHoldCreatedBy: 'Установил',
  purgeTitle: 'Окончательное удаление',
  purgeHint: 'Необратимо удаляет исходные записи и только те файлы, которые больше нигде не используются. Скачанный ZIP остаётся копией для восстановления.',
  purgeRefresh: 'Пересчитать',
  purgeMessages: 'Сообщения',
  purgeVersions: 'Версии',
  purgeFiles: 'Связанные файлы',
  purgeExclusiveFiles: 'Будут удалены с диска',
  purgeSharedFiles: 'Общие файлы сохранятся',
  purgeBackupReady: 'ZIP проверен и скачан',
  purgeBackupMissing: 'Нет подходящего ZIP-архива. Сформируйте архив выбранной переписки.',
  purgeBackupNotDownloaded: 'ZIP сформирован, но ещё не скачан администратором.',
  purgeBackupIncomplete: 'ZIP устарел или содержит не все сообщения и файлы. Сформируйте новый.',
  purgeBackupCorrupt: 'ZIP отсутствует на диске или его SHA-256 не совпадает.',
  purgeLegalHoldBlocked: 'Удаление заблокировано действующим legal hold.',
  purgeReason: 'Обязательная причина окончательного удаления',
  purgeAction: 'Удалить окончательно',
  purgeHistory: 'История окончательных удалений',
  purgeHistoryEmpty: 'Окончательных удалений ещё не было.',
  purgeDeletedBy: 'Удалил',
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
  adminPanel: 'Admin panel',
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
  loadMoreComments: 'Show more comments',
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
  savedOriginal: 'Retained original',
  history: 'History',
  change: 'change',
  archiveCenter: 'Conversation archive',
  archiveSearch: 'Employee, message text, or file name',
  archiveAll: 'All',
  archiveActive: 'Active',
  archiveStored: 'Archived',
  archiveConversation: 'Archive',
  restoreConversation: 'Restore',
  archiveEmpty: 'No conversations match these filters.',
  archiveChoose: 'Choose a conversation to open it separately.',
  archiveFrom: 'From date',
  archiveTo: 'To date',
  archivePackages: 'Generated ZIP archives',
  archiveName: 'Archive name (optional)',
  createFullArchive: 'Create full chat and feed archive',
  createConversationArchive: 'Create ZIP for selected conversation',
  archivePending: 'Building',
  archiveCompleted: 'Ready',
  archiveFailed: 'Failed',
  archiveDownload: 'Download ZIP',
  archiveNoPackages: 'No archives have been generated yet.',
  archiveRecords: 'records',
  archiveFiles: 'files',
  archiveGrantAccess: 'Grant access',
  archiveAccessEmployee: 'Choose employee',
  archiveAccessDuration: 'Access duration',
  archiveAccessOneDay: '1 day',
  archiveAccessSevenDays: '7 days',
  archiveAccessThirtyDays: '30 days',
  archiveAccessNinetyDays: '90 days',
  archiveAccesses: 'Granted access',
  archiveAccessUntil: 'until',
  archiveAccessRevoked: 'revoked',
  archiveAccessExpired: 'expired',
  archiveRevokeAccess: 'Revoke',
  archiveConversationOnly: 'Employee access is available only for a ZIP of one conversation.',
  receivedArchives: 'Received archives',
  receivedArchivesHint: 'An administrator can temporarily open an old conversation here. Archives are read-only.',
  receivedArchivesEmpty: 'No archive access has been granted to you yet.',
  receivedArchiveChoose: 'Choose an archive on the left to open the conversation.',
  receivedArchiveGrantedBy: 'Granted by',
  receivedArchiveExpires: 'Access until',
  legalHoldTitle: 'Deletion hold · legal hold',
  legalHoldHint: 'Protects the selected conversation, all messages, and files from physical deletion.',
  legalHoldName: 'Hold name',
  legalHoldReason: 'Reason and basis',
  legalHoldEnd: 'Active until (optional)',
  legalHoldCreate: 'Apply hold',
  legalHoldChoose: 'Choose a conversation from the list below first.',
  legalHoldSearch: 'Name, reason, employee, or conversation',
  legalHoldAll: 'All holds',
  legalHoldActive: 'Active',
  legalHoldExpired: 'Expired',
  legalHoldReleased: 'Released',
  legalHoldEmpty: 'No holds match the selected filters.',
  legalHoldPermanent: 'No expiration',
  legalHoldProtected: 'Deletion prohibited',
  legalHoldItems: 'protected items',
  legalHoldRelease: 'Release hold',
  legalHoldCreatedBy: 'Applied by',
  purgeTitle: 'Permanent deletion',
  purgeHint: 'Irreversibly removes source records and only files that are not used elsewhere. The downloaded ZIP remains the recovery copy.',
  purgeRefresh: 'Recalculate',
  purgeMessages: 'Messages',
  purgeVersions: 'Versions',
  purgeFiles: 'Linked files',
  purgeExclusiveFiles: 'Deleted from disk',
  purgeSharedFiles: 'Shared files preserved',
  purgeBackupReady: 'ZIP verified and downloaded',
  purgeBackupMissing: 'No suitable ZIP archive. Create an archive for the selected conversation.',
  purgeBackupNotDownloaded: 'The ZIP is ready but has not been downloaded by an administrator.',
  purgeBackupIncomplete: 'The ZIP is outdated or does not contain every message and file. Create a new one.',
  purgeBackupCorrupt: 'The ZIP is missing from disk or its SHA-256 does not match.',
  purgeLegalHoldBlocked: 'Deletion is blocked by an active legal hold.',
  purgeReason: 'Required reason for permanent deletion',
  purgeAction: 'Delete permanently',
  purgeHistory: 'Permanent deletion history',
  purgeHistoryEmpty: 'No permanent deletions have been made.',
  purgeDeletedBy: 'Deleted by',
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
const ENGLISH_TAB_LABELS = { feed: 'Feed', chat: 'Chat', request: 'My requests', employees: 'Employees', audit: 'Audit', archive: 'Archive', receivedArchives: 'Received archives' };
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
  waiting_employee_confirmation: { label: 'В работе', labelEn: 'In progress', hint: 'Если проблема решена, заявку можно закрыть', hintEn: 'Close the request if the issue is resolved', tone: 'confirm' },
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

const readChatLocalSettings = (username = 'guest') => {
  try {
    const all = JSON.parse(localStorage.getItem(CHAT_LOCAL_SETTINGS_KEY) || '{}');
    return {
      archived: [],
      hidden: [],
      pinned: [],
      muted: [],
      favorites: [],
      uiDesign: 'classic',
      uiLanguage: 'ru',
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
    return Array.isArray(all?.[username]) ? all[username].filter(entry => entry?.message?.id && entry.conversationId).map(entry => ({ ...entry, message: { ...entry.message, deliveryStatus: entry.message.deliveryStatus === 'error' ? 'error' : 'waiting' } })) : [];
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

const appendAttachmentLogin = (url = '') => withAccessToken(url);

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

const getAttachmentFileIds = (attachments = []) => [...new Set(
  (Array.isArray(attachments) ? attachments : [])
    .map((file) => file?.fileId || file?.id || getFileIdFromUrl(file?.url || file?.thumbnailUrl || file?.previewUrl || ''))
    .filter(Boolean)
    .map((value) => String(value))
)];

const collectThreadFileIds = (threads = {}) => {
  const ids = [];
  Object.values(threads || {}).forEach((messages) => {
    (Array.isArray(messages) ? messages : []).forEach((message) => {
      if (!message?.id) return;
      ids.push(...getAttachmentFileIds([
        ...(Array.isArray(message.attachments) ? message.attachments : []),
        message.attachment || null
      ].filter(Boolean)));
    });
  });
  return [...new Set(ids)];
};

const collectFeedFileIds = (posts = []) => {
  const ids = [];
  (Array.isArray(posts) ? posts : []).forEach((post) => {
    if (!post?.id) return;
    ids.push(...getAttachmentFileIds([
      ...(Array.isArray(post.attachments) ? post.attachments : []),
      post.attachment || null,
      ...(Array.isArray(post.comments) ? post.comments : []).flatMap((comment) => [
        ...(Array.isArray(comment.attachments) ? comment.attachments : []),
        comment.attachment || null
      ].filter(Boolean))
    ].filter(Boolean)));
  });
  return [...new Set(ids)];
};

const prefetchMediaTokens = (fileIds, scope = 'chat') => {
  const accessToken = getCurrentAttachmentIdentity().accessToken;
  if (!fileIds.length || !accessToken) return;
  ensureMediaTokens({ fileIds, scope, getToken: () => accessToken });
};


const canManageFeedPost = (post = {}, currentUser = {}, isManager = false, isAdmin = false) => {
  if (isManager || isAdmin) return true;
  const username = currentUser?.username || '';
  if (!username) return false;
  return sameLogin(post.author, username)
    || sameLogin(post.login, username)
    || sameLogin(post.sender, username);
};

const AttachmentPreviewImage = React.memo(function AttachmentPreviewImage({ file, alt, isEnglish = false }) {
  const preferredSource = getAttachmentUrl(file);
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
          loading="lazy"
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

const VideoPosterFrame = React.memo(function VideoPosterFrame({ file, alt = '', isEnglish = false }) {
  const posterUrl = getVideoPosterUrl(file);

  return (
    <span className={`video-poster-frame ${posterUrl ? 'has-poster' : 'without-poster'}`}>
      {posterUrl ? (
        <AttachmentPreviewImage
          file={{ thumbnailUrl: posterUrl }}
          alt={alt}
          isEnglish={isEnglish}
        />
      ) : (
        <span className="video-poster-placeholder" aria-hidden="true">🎬</span>
      )}
      <span className="video-poster-play" aria-hidden="true">▶</span>
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

  return (
    <div className={`playable-video-shell ${variant} is-${orientation} ${className}`} style={{ aspectRatio: storedRatio }}>
      <button
        type="button"
        className="video-preview-open"
        aria-label={`${isEnglish ? 'Open video' : 'Открыть видео'} ${file?.name || ''}`.trim()}
        onClick={(event) => {
          event.stopPropagation();
          if (onExpand) onExpand(event);
          else openAttachmentInNewTab(file);
        }}
      >
        <VideoPosterFrame file={file} alt={file?.name || ''} isEnglish={isEnglish} />
        <span className="video-preview-label">{isEnglish ? 'Open video' : 'Открыть видео'}</span>
      </button>
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
          <AttachmentPreviewImage file={file} alt={fileName} isEnglish={isEnglish} />
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
        <AttachmentPreviewImage file={file} alt={fileName} isEnglish={isEnglish} />
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
          <AttachmentPreviewImage file={file} alt={fileName} isEnglish={isEnglish} />
        </button>
      )}
      <span className="feed-media-caption">{fileName} · {formatFileSize(file?.size)}</span>
    </div>
  );
});

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

export { MANAGER_TEMPLATE_MESSAGES, EMPLOYEE_TEMPLATE_MESSAGES, MANAGER_TEMPLATE_MESSAGES_EN, EMPLOYEE_TEMPLATE_MESSAGES_EN, REACTION_EMOJIS, QUICK_EMOJIS, MAX_ATTACHMENT_SIZE_MB, MAX_ATTACHMENT_SIZE, CHAT_MESSAGES_PAGE_SIZE, FEED_POSTS_PAGE_SIZE, FEED_COMMENTS_PAGE_SIZE, EMPLOYEE_TABS, MANAGER_TABS, REQUEST_CATEGORIES, REQUEST_PRIORITIES, DEFAULT_PROFILE_WEBSITE_LANGUAGE, PROFILE_LANGUAGE_OPTIONS, RUSSIAN_LABELS, ENGLISH_LABELS, ENGLISH_TAB_LABELS, ENGLISH_CONTACT_FILTER_LABELS, translateRuntimeText, FEED_CATEGORIES, ENGLISH_FEED_CATEGORY_LABELS, ENGLISH_REQUEST_CATEGORY_LABELS, ENGLISH_REQUEST_PRIORITY_LABELS, CHAT_FILTERS, CONTACT_FILTERS, CHAT_MEDIA_TABS, AUDIT_PERIODS, CHAT_THEMES, CHAT_DENSITIES, CHAT_TEXT_SIZES, formatEnglishProfileLogin, getWebsiteByLanguage, getConversationId, getParticipantsFromThreadId, getAvatarKey, getGreetingKey, createMessageId, readReadState, saveReadState, getReadTimestamp, getReadMessageId, readChatLocalSettings, saveChatLocalSettings, readPendingMessages, savePendingMessages, getMessageAttachments, getMessageMediaAttachments, extractLinks, getSafeExternalUrl, getLinkPreview, readFeedReadAt, saveFeedReadAt, readCustomTemplates, saveCustomTemplates, getFeedItemTimestamp, getFeedLatestTimestamp, getForwardedMessageText, readDirectoryCache, saveDirectoryCache, readProfileDraft, getProfileValue, saveProfileDraft, processAvatar, sleep, isNetworkFailure, getFriendlyNetworkMessage, readApiJson, fetchJsonWithRetry, createAttachmentThumbnailDataUrl, nudgeVideoToFirstFrame, normalizeText, formatDateLabel, getDateKey, isVideoAttachment, formatFileSize, getFileIcon, dataUrlToBlob, openAttachmentInNewTab, formatFeedLogin, getFeedAttachments, getFeedPostsSignature, getVisibleFeedPosts, sortFeedPosts, setFeedReactionForUser, sameLogin, readSavedFeedDraft, saveFeedDraft, clearSavedFeedDraft, readHiddenFeedPosts, saveHiddenFeedPosts, isImageAttachment, isMediaAttachment, resolveAttachmentUrl, getAttachmentUrl, getOriginalAttachmentUrl, getVideoPosterUrl, getPostShareUrl, isPostAuthor, collectThreadFileIds, collectFeedFileIds, prefetchMediaTokens, canManageFeedPost, VideoPosterFrame, AttachmentCard, FeedMediaCard, getThreadActivityMeta, isThreadInPeriod, getApplicationStatusMeta };
