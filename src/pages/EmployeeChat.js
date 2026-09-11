import useChatDraftStorage, { readChatDrafts, saveChatDrafts } from '../components/employeeChat/useChatDraftStorage';
import VirtualMessageList from '../components/employeeChat/VirtualMessageList';
import EmployeeFeedWorkspace from '../components/employeeChat/EmployeeFeedWorkspace';
import EmployeeProfileWorkspace from '../components/employeeChat/EmployeeProfileWorkspace';
import EmployeeRequestsWorkspace from '../components/employeeChat/EmployeeRequestsWorkspace';
import ChatAuditAdministration from '../components/employeeChat/ChatAuditAdministration';
import ChatArchiveAdministration from '../components/employeeChat/ChatArchiveAdministration';
import ChatEmployeeAdministration from '../components/employeeChat/ChatEmployeeAdministration';
import ChatMessageItem from '../components/employeeChat/ChatMessageItem';
import ChatIcon from '../components/employeeChat/ChatIcon';
import ModernMediaViewer from '../components/employeeChat/ModernMediaViewer';
import useStableMessageProps from '../components/employeeChat/useStableMessageProps';
import ChatAppearanceSettings from '../components/employeeChat/ChatAppearanceSettings';
import useMessageOutbox from '../components/employeeChat/useMessageOutbox';
import { mergeMessages, compareMessages, isMessageRead } from '../utils/chatMessages';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import { readCachedConversation, writeCachedConversation, removeCachedConversation } from '../utils/chatMessageCache';
import { readCachedFeed, writeCachedFeed } from '../utils/feedCache';

import { formatApplicationDateTime, getApplicationTiming } from '../utils/applicationTime';
import ChatComposerForm from '../components/employeeChat/ChatComposerForm';
import ChatDialogHeader from '../components/employeeChat/ChatDialogHeader';
import ChatLoadingOverlay from '../components/employeeChat/ChatLoadingOverlay';
import ContactsWorkspace from '../components/employeeChat/ContactsWorkspace';
import FeedComposer from '../components/employeeChat/FeedComposer';
import FeedPostCard from '../components/employeeChat/FeedPostCard';
import RequestTimerMetrics from '../components/employeeChat/RequestTimerMetrics';
import AuthenticatedAvatar from '../components/employeeChat/AuthenticatedAvatar';
import './EmployeeChat.css';
import './EmployeeChatModern.css';

import { MANAGER_TEMPLATE_MESSAGES, EMPLOYEE_TEMPLATE_MESSAGES, MANAGER_TEMPLATE_MESSAGES_EN, EMPLOYEE_TEMPLATE_MESSAGES_EN, REACTION_EMOJIS, QUICK_EMOJIS, MAX_ATTACHMENT_SIZE_MB, MAX_ATTACHMENT_SIZE, CHAT_MESSAGES_PAGE_SIZE, FEED_POSTS_PAGE_SIZE, FEED_COMMENTS_PAGE_SIZE, EMPLOYEE_TABS, MANAGER_TABS, REQUEST_CATEGORIES, REQUEST_PRIORITIES, DEFAULT_PROFILE_WEBSITE_LANGUAGE, PROFILE_LANGUAGE_OPTIONS, RUSSIAN_LABELS, ENGLISH_LABELS, ENGLISH_TAB_LABELS, ENGLISH_CONTACT_FILTER_LABELS, translateRuntimeText, FEED_CATEGORIES, ENGLISH_FEED_CATEGORY_LABELS, ENGLISH_REQUEST_CATEGORY_LABELS, ENGLISH_REQUEST_PRIORITY_LABELS, CHAT_FILTERS, CONTACT_FILTERS, CHAT_MEDIA_TABS, AUDIT_PERIODS, CHAT_THEMES, CHAT_DENSITIES, CHAT_TEXT_SIZES, formatEnglishProfileLogin, getWebsiteByLanguage, getConversationId, getParticipantsFromThreadId, getAvatarKey, getGreetingKey, createMessageId, readReadState, saveReadState, getReadTimestamp, getReadMessageId, readChatLocalSettings, saveChatLocalSettings, readPendingMessages, savePendingMessages, getMessageAttachments, getMessageMediaAttachments, extractLinks, getSafeExternalUrl, getLinkPreview, readFeedReadAt, saveFeedReadAt, readCustomTemplates, saveCustomTemplates, getFeedItemTimestamp, getFeedLatestTimestamp, getForwardedMessageText, readDirectoryCache, saveDirectoryCache, readProfileDraft, getProfileValue, saveProfileDraft, processAvatar, sleep, isNetworkFailure, getFriendlyNetworkMessage, readApiJson, fetchJsonWithRetry, createAttachmentThumbnailDataUrl, nudgeVideoToFirstFrame, normalizeText, formatDateLabel, getDateKey, isVideoAttachment, formatFileSize, getFileIcon, dataUrlToBlob, openAttachmentInNewTab, formatFeedLogin, getFeedAttachments, getFeedPostsSignature, getVisibleFeedPosts, sortFeedPosts, setFeedReactionForUser, sameLogin, readSavedFeedDraft, saveFeedDraft, clearSavedFeedDraft, readHiddenFeedPosts, saveHiddenFeedPosts, isImageAttachment, isMediaAttachment, resolveAttachmentUrl, getAttachmentUrl, getOriginalAttachmentUrl, getVideoPosterUrl, getPostShareUrl, isPostAuthor, collectThreadFileIds, collectFeedFileIds, prefetchMediaTokens, canManageFeedPost, VideoPosterFrame, AttachmentCard, FeedMediaCard, getThreadActivityMeta, isThreadInPeriod, getApplicationStatusMeta } from '../components/employeeChat/chatPresentation';

const sameViewerFile = (left, right) => left === right || Boolean(left && right && (
  (left.id && right.id && String(left.id) === String(right.id))
  || (!left.id && !right.id && (left.url || left.dataUrl) && (left.url || left.dataUrl) === (right.url || right.dataUrl))
));

const EmployeeChat = ({ adminSection = null }) => {
  const { user, logout, employeeDirectory, changeServicePassword } = useAuth();
  const navigate = useNavigate();
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
  const selectedEmailRef = useRef('');
  selectedEmailRef.current = selectedEmail;
  const cancelledUploadsRef = useRef(new Set());
  const [connectionState, setConnectionState] = useState('connecting');
  const historyCursorRef = useRef({});
  const historyRequestRef = useRef({});
  const pendingMessagesRef = useRef([]);
  const suppressReadRef = useRef('');
  const fetchThreadsVersionRef = useRef(0);
  const conversationMutationRef = useRef({});
  const [dateSearchMessages, setDateSearchMessages] = useState(null);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [draft, setDraft] = useState('');
  const [attachmentDrafts, setAttachmentDrafts] = useState([]);
  const [chatUploadQueue, setChatUploadQueue] = useState([]);
  const [pendingMessages, setPendingMessages] = useState(() => readPendingMessages(user?.username || 'guest').map(entry => ({ ...entry, message: { ...entry.message, deliveryStatus: entry.message.deliveryStatus === 'error' ? 'error' : 'waiting' } })));
  pendingMessagesRef.current = pendingMessages;
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
  const [activeTab, setActiveTab] = useState(adminSection || 'chat');
  useEffect(() => { if (adminSection) setActiveTab(adminSection); }, [adminSection]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const isSendingMessage = false;
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
  const [archiveConversations, setArchiveConversations] = useState([]);
  const [archiveFilters, setArchiveFilters] = useState({ q: '', state: 'all', from: '', to: '' });
  const [archiveSelectedId, setArchiveSelectedId] = useState('');
  const [archiveMessages, setArchiveMessages] = useState([]);
  const [archiveHasMore, setArchiveHasMore] = useState(false);
  const [archiveBefore, setArchiveBefore] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [recordsArchives, setRecordsArchives] = useState([]);
  const [archivePackageName, setArchivePackageName] = useState('');
  const [archiveCreating, setArchiveCreating] = useState(false);
  const [archiveAccessDrafts, setArchiveAccessDrafts] = useState({});
  const [legalHolds, setLegalHolds] = useState([]);
  const [legalHoldFilters, setLegalHoldFilters] = useState({ q: '', status: 'all' });
  const [legalHoldForm, setLegalHoldForm] = useState({ name: '', reason: '', endsAt: '' });
  const [legalHoldLoading, setLegalHoldLoading] = useState(false);
  const [purgePreview, setPurgePreview] = useState(null);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeHistory, setPurgeHistory] = useState([]);
  const [receivedArchives, setReceivedArchives] = useState([]);
  const [receivedArchiveAccessId, setReceivedArchiveAccessId] = useState('');
  const [receivedArchiveMessages, setReceivedArchiveMessages] = useState([]);
  const [receivedArchiveBefore, setReceivedArchiveBefore] = useState('');
  const [receivedArchiveHasMore, setReceivedArchiveHasMore] = useState(false);
  const [receivedArchiveLoading, setReceivedArchiveLoading] = useState(false);
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
  const [readViewportVersion, setReadViewportVersion] = useState(0);
  const [feedReadAt, setFeedReadAt] = useState(() => readFeedReadAt(user?.username || 'guest'));
  const [directoryEmployees, setDirectoryEmployees] = useState(() => readDirectoryCache());
  const [isDirectoryLoaded, setIsDirectoryLoaded] = useState(() => readDirectoryCache().length > 0);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [welcomeNotice, setWelcomeNotice] = useState('');
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [profileViewLogin, setProfileViewLogin] = useState('');
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
  const isEnglishInterface = (chatLocalSettings.uiLanguage || 'ru') === 'en';
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
  const nearBottomRef = useRef(false);
  const messageListRef = useRef(null);
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
  const settingsRevisionRef = useRef(0);
  const fetchThreadsRef = useRef(null);

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

    setWelcomeNotice(baseDisplayName);
    sessionStorage.setItem(getGreetingKey(user.username), '1');
    const timer = setTimeout(() => setWelcomeNotice(''), 3200);
    return () => clearTimeout(timer);
  }, [baseDisplayName, isEnglishInterface, user?.username]);

  const handleLogout = () => {
    if (user?.username) {
      sessionStorage.removeItem(getGreetingKey(user.username));
    }
    logout();
  };

  const loadProfile = useCallback(async (login, mode = 'form') => {
    const settingsRevision = settingsRevisionRef.current;
    const response = await authFetch(`${API_BASE_URL}/auth/profile?login=${encodeURIComponent(login)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Не удалось загрузить анкету');
    }

    const profile = data?.profile || {};
    const cachedProfile = readProfileDraft(login);
    const directoryProfile = directoryEmployeesRef.current.find((employee) => employee.login === login) || {};
    const serverAvatar = resolveAttachmentUrl(profile?.avatar || '');
    const cachedAvatar = resolveAttachmentUrl(
      cachedProfile?.avatar || localStorage.getItem(getAvatarKey(login)) || ''
    );
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
      // A profile request may have started before a new avatar was uploaded.
      // Do not let that stale empty response erase the freshly saved photo.
      avatar: serverAvatar || cachedAvatar
    };

    if (!mergedProfile.full_name) mergedProfile.full_name = directoryProfile.full_name || '';
    if (!mergedProfile.department) mergedProfile.department = directoryProfile.department || '';
    if (!mergedProfile.phone) mergedProfile.phone = directoryProfile.phone || directoryProfile.internal_phone || directoryProfile.N_tel || '';
    if (!mergedProfile.room) mergedProfile.room = directoryProfile.room || directoryProfile.cabinet || '';
    if (mode === 'form') {
      const serverPreferences = profile.preferences && typeof profile.preferences === 'object'
        ? profile.preferences
        : null;
      if (settingsRevision === settingsRevisionRef.current && serverPreferences && Object.keys(serverPreferences).length > 0) {
        const syncedSettings = {
          ...readChatLocalSettings(login),
          ...serverPreferences
        };
        setChatLocalSettings(syncedSettings);
        saveChatLocalSettings(login, syncedSettings);
      } else if (settingsRevision === settingsRevisionRef.current && serverPreferences) {
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
  }, [queueChatSettingsSync, user.username]);

  const fetchThreads = useCallback(async () => {
    try {
      const requestVersion = ++fetchThreadsVersionRef.current;
      const response = await authFetch(`${API_BASE_URL}/chat/threads`, {
        headers: chatAuthHeaders
      });
      const data = await readApiJson(response, 'Не удалось загрузить сообщения');
      if (requestVersion !== fetchThreadsVersionRef.current) return;
      setThreadSummaries(data?.summaries && typeof data.summaries === 'object' ? data.summaries : {});
      if (data?.readStates && typeof data.readStates === 'object') {
        setReadState((current) => {
          const next = { ...current, ...data.readStates };
          saveReadState(user.username, next);
          return next;
        });
      }
    } catch (error) {
      console.error('Ошибка загрузки переписки:', error);
    }
  }, [chatAuthHeaders, user.username]);

  useEffect(() => {
    fetchThreadsRef.current = fetchThreads;
  }, [fetchThreads]);

  const fetchConversationMessages = useCallback(async (
    conversationId,
    { silent = false, signal, includeDeletedContent = false } = {}
  ) => {
    if (!conversationId) return;
    const requestVersion = (historyRequestRef.current[conversationId] || 0) + 1;
    historyRequestRef.current[conversationId] = requestVersion;
    const mutationVersion = conversationMutationRef.current[conversationId] || 0;
    if (!silent) setLoadingConversationIds((prev) => ({ ...prev, [conversationId]: true }));
    try {
      const retainedContentQuery = includeDeletedContent ? '&includeDeletedContent=1' : '';
      const response = await authFetch(
        `${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}/messages?limit=${CHAT_MESSAGES_PAGE_SIZE}${retainedContentQuery}`,
        { headers: chatAuthHeaders, signal }
      );
      const data = await readApiJson(response, 'Не удалось загрузить сообщения');
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      if (historyRequestRef.current[conversationId] !== requestVersion || signal?.aborted) return null;
      if ((conversationMutationRef.current[conversationId] || 0) !== mutationVersion) return null;
      setThreads((prev) => {
        const local = pendingMessagesRef.current.filter(item => item.conversationId === conversationId).map(item => item.message);
        return { ...prev, [conversationId]: mergeMessages(mergeMessages(prev[conversationId], local), messages) };
      });
      if (!historyCursorRef.current[conversationId]) historyCursorRef.current[conversationId] = data.before || '';
      writeCachedConversation(user.username, conversationId, messages);
      prefetchMediaTokens(collectThreadFileIds({ [conversationId]: messages }), 'chat');
      setThreadHasMore((prev) => ({
        ...prev,
        [conversationId]: prev[conversationId] === undefined ? Boolean(data?.hasMore) : prev[conversationId]
      }));
      return messages;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      console.error('Ошибка загрузки выбранного диалога:', error);
      setThreads((prev) => (
        Object.prototype.hasOwnProperty.call(prev, conversationId)
          ? prev
          : { ...prev, [conversationId]: [] }
      ));
      if (!silent) notifyRef.current(error.message || 'Не удалось загрузить выбранный диалог', 'Чат');
      return null;
    } finally {
      if (!silent) setLoadingConversationIds((prev) => ({ ...prev, [conversationId]: false }));
    }
  }, [chatAuthHeaders, user.username]);

  const fetchArchiveConversations = useCallback(async (signal) => {
    if (!isAdmin) return;
    setArchiveLoading(true);
    try {
      const params = new URLSearchParams();
      if (archiveFilters.q.trim()) params.set('q', archiveFilters.q.trim());
      if (archiveFilters.state !== 'all') params.set('state', archiveFilters.state);
      if (archiveFilters.from) params.set('from', archiveFilters.from);
      if (archiveFilters.to) params.set('to', archiveFilters.to);
      const response = await authFetch(`${API_BASE_URL}/chat/records/conversations?${params.toString()}`, {
        headers: chatAuthHeaders,
        signal
      });
      const data = await readApiJson(response, 'Не удалось выполнить поиск в архиве');
      setArchiveConversations(Array.isArray(data?.conversations) ? data.conversations : []);
    } catch (error) {
      if (error?.name !== 'AbortError') notifyRef.current(error.message || 'Не удалось открыть архив', 'Архив');
    } finally {
      if (!signal?.aborted) setArchiveLoading(false);
    }
  }, [archiveFilters, chatAuthHeaders, isAdmin]);

  const fetchArchiveMessages = useCallback(async (conversationId, { append = false } = {}) => {
    if (!conversationId || !isAdmin) return;
    setArchiveLoading(true);
    try {
      const before = append ? archiveBefore : '';
      const beforeQuery = before ? `&before=${encodeURIComponent(before)}` : '';
      const searchQuery = archiveFilters.q.trim() ? `&q=${encodeURIComponent(archiveFilters.q.trim())}` : '';
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/conversations/${encodeURIComponent(conversationId)}/messages?limit=${CHAT_MESSAGES_PAGE_SIZE}${beforeQuery}${searchQuery}`,
        { headers: chatAuthHeaders }
      );
      const data = await readApiJson(response, 'Не удалось открыть архивную переписку');
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      setArchiveMessages((current) => append
        ? [...new Map([...messages, ...current].map((message) => [message.id, message])).values()]
        : messages);
      setArchiveBefore(data?.before || '');
      setArchiveHasMore(Boolean(data?.hasMore));
      prefetchMediaTokens(collectThreadFileIds({ [conversationId]: messages }), 'chat');
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось открыть архивную переписку', 'Архив');
    } finally {
      setArchiveLoading(false);
    }
  }, [archiveBefore, archiveFilters.q, chatAuthHeaders, isAdmin]);

  const setConversationArchiveState = useCallback(async (conversationId, state) => {
    const confirmed = await confirmAction(
      state === 'archived'
        ? 'Архивировать переписку? Она исчезнет из активных чатов сотрудников, но все сообщения и файлы сохранятся.'
        : 'Разархивировать переписку и вернуть её в активные чаты?',
      state === 'archived' ? 'Архивирование переписки' : 'Восстановление переписки'
    );
    if (!confirmed) return;
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/conversations/${encodeURIComponent(conversationId)}/state`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
          body: JSON.stringify({ state })
        }
      );
      await readApiJson(response, 'Не удалось изменить состояние переписки');
      await Promise.all([fetchArchiveConversations(), fetchThreads()]);
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось изменить состояние переписки', 'Архив');
    }
  }, [chatAuthHeaders, confirmAction, fetchArchiveConversations, fetchThreads]);

  const fetchRecordsArchives = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/archives`, { headers: chatAuthHeaders });
      const data = await readApiJson(response, 'Не удалось получить список архивов');
      setRecordsArchives(Array.isArray(data?.archives) ? data.archives : []);
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось получить список архивов', 'Архив');
    }
  }, [chatAuthHeaders, isAdmin]);

  const fetchLegalHolds = useCallback(async (signal) => {
    if (!isAdmin) return;
    setLegalHoldLoading(true);
    try {
      const params = new URLSearchParams();
      if (legalHoldFilters.q.trim()) params.set('q', legalHoldFilters.q.trim());
      if (legalHoldFilters.status !== 'all') params.set('status', legalHoldFilters.status);
      const response = await authFetch(`${API_BASE_URL}/chat/records/legal-holds?${params.toString()}`, {
        headers: chatAuthHeaders,
        signal
      });
      const data = await readApiJson(response, 'Не удалось получить список legal hold');
      setLegalHolds(Array.isArray(data?.holds) ? data.holds : []);
    } catch (error) {
      if (error?.name !== 'AbortError') notifyRef.current(error.message || 'Не удалось получить список legal hold', 'Архив');
    } finally {
      if (!signal?.aborted) setLegalHoldLoading(false);
    }
  }, [chatAuthHeaders, isAdmin, legalHoldFilters]);

  const createLegalHold = useCallback(async (event) => {
    event.preventDefault();
    if (!archiveSelectedId) {
      notifyRef.current('Сначала выберите переписку, которую нужно защитить.', 'Legal hold');
      return;
    }
    if (!legalHoldForm.name.trim() || !legalHoldForm.reason.trim()) {
      notifyRef.current('Заполните название и причину запрета.', 'Legal hold');
      return;
    }
    const confirmed = await confirmAction(
      `Установить запрет физического удаления переписки ${archiveSelectedId}? Все сообщения и файлы будут защищены.`,
      'Legal hold'
    );
    if (!confirmed) return;
    setLegalHoldLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/legal-holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
        body: JSON.stringify({
          conversationId: archiveSelectedId,
          name: legalHoldForm.name.trim(),
          reason: legalHoldForm.reason.trim(),
          endsAt: legalHoldForm.endsAt || undefined
        })
      });
      await readApiJson(response, 'Не удалось установить legal hold');
      setLegalHoldForm({ name: '', reason: '', endsAt: '' });
      await Promise.all([fetchLegalHolds(), fetchArchiveConversations()]);
      notifyRef.current('Запрет установлен. Физическое удаление этой переписки заблокировано.', 'Legal hold');
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось установить legal hold', 'Legal hold');
    } finally {
      setLegalHoldLoading(false);
    }
  }, [archiveSelectedId, chatAuthHeaders, confirmAction, fetchArchiveConversations, fetchLegalHolds, legalHoldForm]);

  const releaseLegalHold = useCallback(async (hold) => {
    const confirmed = await confirmAction(
      `Снять запрет «${hold.name}» с переписки ${hold.conversation_id || ''}? После этого физическое удаление снова станет возможным, если нет других запретов.`,
      'Снятие legal hold'
    );
    if (!confirmed) return;
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/legal-holds/${encodeURIComponent(hold.id)}/release`,
        { method: 'POST', headers: chatAuthHeaders }
      );
      await readApiJson(response, 'Не удалось снять legal hold');
      await Promise.all([fetchLegalHolds(), fetchArchiveConversations()]);
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось снять legal hold', 'Legal hold');
    }
  }, [chatAuthHeaders, confirmAction, fetchArchiveConversations, fetchLegalHolds]);

  const fetchPurgeHistory = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/purge-history`, { headers: chatAuthHeaders });
      const data = await readApiJson(response, 'Не удалось получить историю окончательных удалений');
      setPurgeHistory(Array.isArray(data?.purges) ? data.purges : []);
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось получить историю окончательных удалений', 'Архив');
    }
  }, [chatAuthHeaders, isAdmin]);

  const fetchConversationPurgePreview = useCallback(async (conversationId = archiveSelectedId) => {
    if (!conversationId || !isAdmin) {
      setPurgePreview(null);
      return;
    }
    setPurgeLoading(true);
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/conversations/${encodeURIComponent(conversationId)}/purge-preview`,
        { headers: chatAuthHeaders }
      );
      const data = await readApiJson(response, 'Не удалось рассчитать окончательное удаление');
      setPurgePreview(data || null);
    } catch (error) {
      setPurgePreview(null);
      notifyRef.current(error.message || 'Не удалось рассчитать окончательное удаление', 'Архив');
    } finally {
      setPurgeLoading(false);
    }
  }, [archiveSelectedId, chatAuthHeaders, isAdmin]);

  const permanentlyDeleteConversation = useCallback(async () => {
    if (!archiveSelectedId || !purgePreview?.canPurge || purgeLoading) return;
    const reason = purgeReason.trim();
    if (!reason) {
      notifyRef.current('Укажите причину окончательного удаления.', 'Окончательное удаление');
      return;
    }
    const counts = purgePreview.counts || {};
    const firstConfirmed = await confirmAction(
      `Подготовлено к удалению: ${counts.messages || 0} сообщений, ${counts.messageVersions || 0} версий и ${counts.exclusiveFiles || 0} файлов с диска. Продолжить?`,
      'Окончательное удаление'
    );
    if (!firstConfirmed) return;
    const phrase = await promptAction(
      'Введите УДАЛИТЬ заглавными буквами. Операцию нельзя будет отменить без восстановления скачанного ZIP.',
      '',
      'Подтверждение удаления'
    );
    if (String(phrase || '').trim().toUpperCase() !== 'УДАЛИТЬ') {
      notifyRef.current('Окончательное удаление отменено: контрольное слово не совпало.', 'Архив');
      return;
    }
    const finalConfirmed = await confirmAction(
      `Последнее подтверждение: окончательно удалить переписку ${archiveSelectedId}?`,
      'Финальное подтверждение'
    );
    if (!finalConfirmed) return;

    setPurgeLoading(true);
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/conversations/${encodeURIComponent(archiveSelectedId)}/purge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
          body: JSON.stringify({
            archiveId: purgePreview.backup.id,
            reason,
            confirmationPhrase: 'УДАЛИТЬ',
            confirmationConversationId: archiveSelectedId,
            acknowledgedConsequences: true
          })
        }
      );
      const data = await readApiJson(response, 'Не удалось выполнить окончательное удаление');
      setPurgeReason('');
      setPurgePreview(null);
      setArchiveSelectedId('');
      setArchiveMessages([]);
      await Promise.all([fetchArchiveConversations(), fetchLegalHolds(), fetchPurgeHistory(), fetchRecordsArchives(), fetchThreads()]);
      notifyRef.current(
        data?.cleanupWarning
          ? `Переписка удалена. ${data.cleanupWarning}`
          : 'Переписка окончательно удалена. Контрольная запись сохранена в аудите.',
        'Архив'
      );
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось выполнить окончательное удаление', 'Архив');
      await fetchConversationPurgePreview(archiveSelectedId);
    } finally {
      setPurgeLoading(false);
    }
  }, [
    archiveSelectedId,
    chatAuthHeaders,
    confirmAction,
    fetchArchiveConversations,
    fetchConversationPurgePreview,
    fetchLegalHolds,
    fetchPurgeHistory,
    fetchRecordsArchives,
    fetchThreads,
    promptAction,
    purgeLoading,
    purgePreview,
    purgeReason
  ]);

  const createRecordsArchive = useCallback(async (scope) => {
    if (scope === 'conversation' && !archiveSelectedId) {
      notifyRef.current('Сначала выберите переписку', 'Архив');
      return;
    }
    const confirmed = await confirmAction(
      scope === 'all'
        ? 'Создать полный ZIP со всеми чатами, лентой и настоящими файлами? Формирование продолжится в фоне.'
        : 'Создать ZIP выбранной переписки со всеми сообщениями и файлами?',
      'Формирование архива'
    );
    if (!confirmed) return;
    setArchiveCreating(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/archives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
        body: JSON.stringify({
          scope,
          conversationId: scope === 'conversation' ? archiveSelectedId : undefined,
          name: archivePackageName.trim() || undefined
        })
      });
      const data = await readApiJson(response, 'Не удалось начать формирование архива');
      if (data?.archive) setRecordsArchives((current) => [data.archive, ...current.filter((item) => item.id !== data.archive.id)]);
      setArchivePackageName('');
      notifyRef.current('Архив формируется в фоне. Статус обновится автоматически.', 'Архив');
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось начать формирование архива', 'Архив');
    } finally {
      setArchiveCreating(false);
    }
  }, [archivePackageName, archiveSelectedId, chatAuthHeaders, confirmAction]);

  const downloadRecordsArchive = useCallback(async (archive) => {
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/archives/${encodeURIComponent(archive.id)}/download-token`,
        { method: 'POST', headers: chatAuthHeaders }
      );
      const data = await readApiJson(response, 'Не удалось подготовить скачивание архива');
      const anchor = document.createElement('a');
      anchor.href = `${API_BASE_URL}/chat/records/archives/${encodeURIComponent(archive.id)}/download?mt=${encodeURIComponent(data.token)}`;
      anchor.download = `${String(archive.name || archive.id).replace(/[\\/:*?"<>|]+/g, '-')}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(fetchRecordsArchives, 1500);
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось скачать архив', 'Архив');
    }
  }, [chatAuthHeaders, fetchRecordsArchives]);

  const updateArchiveAccessDraft = useCallback((archiveId, patch) => {
    setArchiveAccessDrafts((current) => ({
      ...current,
      [archiveId]: { userLogin: '', expiresInDays: 7, ...(current[archiveId] || {}), ...patch }
    }));
  }, []);

  const grantRecordsArchiveAccess = useCallback(async (archive) => {
    const draft = archiveAccessDrafts[archive.id] || {};
    const userLogin = String(draft.userLogin || '').trim().toLowerCase();
    const expiresInDays = Number(draft.expiresInDays) || 7;
    if (!userLogin) {
      notifyRef.current('Выберите сотрудника, которому нужно показать архив.', 'Архив');
      return;
    }
    const confirmed = await confirmAction(
      `Выдать сотруднику ${userLogin} доступ к архиву «${archive.name}» на ${expiresInDays} дн.? Архив будет доступен только для чтения.`,
      'Доступ к архиву'
    );
    if (!confirmed) return;
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/archives/${encodeURIComponent(archive.id)}/access`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
          body: JSON.stringify({ userLogin, expiresInDays })
        }
      );
      await readApiJson(response, 'Не удалось выдать доступ к архиву');
      await fetchRecordsArchives();
      notifyRef.current('Сотрудник увидит архив в разделе «Полученные архивы».', 'Архив');
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось выдать доступ к архиву', 'Архив');
    }
  }, [archiveAccessDrafts, chatAuthHeaders, confirmAction, fetchRecordsArchives]);

  const revokeRecordsArchiveAccess = useCallback(async (access) => {
    const confirmed = await confirmAction(
      `Отозвать доступ к архиву у ${access.user_full_name || access.user_login}?`,
      'Отзыв доступа'
    );
    if (!confirmed) return;
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/access/${encodeURIComponent(access.id)}/revoke`,
        { method: 'POST', headers: chatAuthHeaders }
      );
      await readApiJson(response, 'Не удалось отозвать доступ');
      await fetchRecordsArchives();
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось отозвать доступ', 'Архив');
    }
  }, [chatAuthHeaders, confirmAction, fetchRecordsArchives]);

  const fetchReceivedArchives = useCallback(async () => {
    if (!user?.username || isManager) return;
    setReceivedArchiveLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/chat/records/received`, { headers: chatAuthHeaders });
      const data = await readApiJson(response, 'Не удалось получить выданные архивы');
      const archives = Array.isArray(data?.archives) ? data.archives : [];
      setReceivedArchives(archives);
      setReceivedArchiveAccessId((current) => (
        current && archives.some((archive) => String(archive.access_id) === String(current)) ? current : ''
      ));
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось получить выданные архивы', 'Архив');
    } finally {
      setReceivedArchiveLoading(false);
    }
  }, [chatAuthHeaders, isManager, user?.username]);

  const fetchReceivedArchiveMessages = useCallback(async (accessId, { append = false } = {}) => {
    if (!accessId || isManager) return;
    setReceivedArchiveLoading(true);
    try {
      const before = append ? receivedArchiveBefore : '';
      const beforeQuery = before ? `&before=${encodeURIComponent(before)}` : '';
      const response = await authFetch(
        `${API_BASE_URL}/chat/records/received/${encodeURIComponent(accessId)}/messages?limit=${CHAT_MESSAGES_PAGE_SIZE}${beforeQuery}`,
        { headers: chatAuthHeaders }
      );
      const data = await readApiJson(response, 'Не удалось открыть полученный архив');
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      setReceivedArchiveMessages((current) => append
        ? [...new Map([...messages, ...current].map((message) => [message.id, message])).values()]
        : messages);
      setReceivedArchiveBefore(data?.before || '');
      setReceivedArchiveHasMore(Boolean(data?.hasMore));
      prefetchMediaTokens(collectThreadFileIds({ [data?.conversationId || 'archive']: messages }), 'chat');
    } catch (error) {
      notifyRef.current(error.message || 'Не удалось открыть полученный архив', 'Архив');
      await fetchReceivedArchives();
    } finally {
      setReceivedArchiveLoading(false);
    }
  }, [chatAuthHeaders, fetchReceivedArchives, isManager, receivedArchiveBefore]);

  useEffect(() => {
    if (activeTab !== 'archive' || !isAdmin) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetchArchiveConversations(controller.signal), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTab, fetchArchiveConversations, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'archive' || !isAdmin) return undefined;
    fetchRecordsArchives();
    const timer = window.setInterval(fetchRecordsArchives, 4000);
    return () => window.clearInterval(timer);
  }, [activeTab, fetchRecordsArchives, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'archive' || !isAdmin) return;
    fetchPurgeHistory();
  }, [activeTab, fetchPurgeHistory, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'archive' || !isAdmin) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => fetchLegalHolds(controller.signal), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTab, fetchLegalHolds, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'archive' || !archiveSelectedId || !isAdmin) return;
    setArchiveMessages([]);
    setArchiveBefore('');
    fetchArchiveMessages(archiveSelectedId);
  // archiveBefore deliberately excluded: it changes while paging the selected archive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, archiveFilters.q, archiveSelectedId, isAdmin]);

  useEffect(() => {
    setPurgeReason('');
    setPurgePreview(null);
    if (activeTab !== 'archive' || !archiveSelectedId || !isAdmin) return;
    fetchConversationPurgePreview(archiveSelectedId);
  // The preview is recalculated when the selected conversation changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, archiveSelectedId, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'profile' || isManager) return undefined;
    fetchReceivedArchives();
    const timer = window.setInterval(fetchReceivedArchives, 30_000);
    return () => window.clearInterval(timer);
  }, [activeTab, fetchReceivedArchives, isManager]);

  useEffect(() => {
    if (activeTab !== 'profile' || !receivedArchiveAccessId || isManager) return;
    setReceivedArchiveMessages([]);
    setReceivedArchiveBefore('');
    fetchReceivedArchiveMessages(receivedArchiveAccessId);
  // receivedArchiveBefore deliberately excluded: it changes while paging.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isManager, receivedArchiveAccessId]);

  const fetchDialogSearchPage = useCallback(async ({ append = false, before = '', signal } = {}) => {
    const query = dialogSearch.trim();
    if (!currentConversationId || query.length < 2) return;
    setDialogSearchLoading(true);
    try {
      const params = new URLSearchParams({ q: query, limit: '25' });
      if (before) params.set('before', before);
      const response = await authFetch(
        `${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/search?${params.toString()}`,
        { headers: chatAuthHeaders, signal }
      );
      const data = await readApiJson(response, 'Не удалось выполнить поиск по переписке');
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      setServerDialogSearchResults((current) => {
        const combined = append ? [...current, ...messages] : messages;
        return [...new Map(combined.map((message) => [message.id, message])).values()];
      });
      setDialogSearchBefore(data?.before || '');
      setDialogSearchHasMore(Boolean(data?.hasMore));
    } catch (error) {
      if (error?.name !== 'AbortError') notifyRef.current(error.message || 'Не удалось выполнить поиск', 'Чат');
    } finally {
      if (!signal?.aborted) setDialogSearchLoading(false);
    }
  }, [chatAuthHeaders, currentConversationId, dialogSearch]);

  useEffect(() => {
    setServerDialogSearchResults([]);
    setDialogSearchBefore('');
    setDialogSearchHasMore(false);
    if (!currentConversationId || dialogSearch.trim().length < 2) {
      setDialogSearchLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchDialogSearchPage({ signal: controller.signal });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentConversationId, dialogSearch, fetchDialogSearchPage]);

  const loadOlderDialogMessages = useCallback(async () => {
    if (isLoadingOlderDialog || !currentConversationId || !currentMessages.length) return;
    const before = historyCursorRef.current[currentConversationId] || '';
    if (!before) return;
    setIsLoadingOlderDialog(true);
    try {
      const response = await authFetch(
        `${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/messages?limit=${CHAT_MESSAGES_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
        { headers: chatAuthHeaders }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить предыдущие сообщения');
      const olderMessages = Array.isArray(data?.messages) ? data.messages : [];
      historyCursorRef.current[currentConversationId] = data.before || '';
      setThreads((prev) => {
        const current = Array.isArray(prev[currentConversationId]) ? prev[currentConversationId] : [];
        const byId = new Map([...olderMessages, ...current].filter((message) => message?.id).map((message) => [message.id, message]));
        const merged = [...byId.values()].sort(compareMessages);
        return { ...prev, [currentConversationId]: merged };
      });
      setThreadHasMore((prev) => ({ ...prev, [currentConversationId]: Boolean(data?.hasMore) && olderMessages.length >= CHAT_MESSAGES_PAGE_SIZE }));
      setVisibleDialogMessageCount((prev) => prev + CHAT_MESSAGES_PAGE_SIZE);
    } catch (error) {
      notify(error.message || 'Не удалось загрузить предыдущие сообщения', 'Чат');
    } finally {
      setIsLoadingOlderDialog(false);
    }
  }, [chatAuthHeaders, currentConversationId, currentMessages, isLoadingOlderDialog, notify]);

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
      const response = await authFetch(`${API_BASE_URL}/chat/feed?limit=${FEED_POSTS_PAGE_SIZE}&commentsLimit=3`, { signal: controller.signal });
      const data = await readApiJson(response, 'Не удалось загрузить ленту');
      if (
        requestSequence !== feedFetchSequenceRef.current
        || mutationVersionAtStart !== feedMutationVersionRef.current
        || pendingFeedActionsRef.current.size > 0
      ) return;
      const nextPosts = getVisibleFeedPosts(data?.posts);
      setFeedPosts((current) => (getFeedPostsSignature(current) === getFeedPostsSignature(nextPosts) ? current : nextPosts));
      prefetchMediaTokens(collectFeedFileIds(nextPosts), 'feed');
      setFeedHasMore(Boolean(data?.hasMore));
      setFeedBefore(data?.cursor || '');
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
      const response = await authFetch(`${API_BASE_URL}/chat/feed?limit=${FEED_POSTS_PAGE_SIZE}&commentsLimit=3&cursor=${encodeURIComponent(feedBefore)}`);
      const data = await readApiJson(response, 'Не удалось загрузить ленту');
      if (mutationVersionAtStart !== feedMutationVersionRef.current || pendingFeedActionsRef.current.size > 0) return;
      const nextPosts = getVisibleFeedPosts(data?.posts);
      setFeedPosts((current) => {
        const byId = new Map([...current, ...nextPosts].filter((post) => post?.id).map((post) => [post.id, post]));
        return sortFeedPosts([...byId.values()]);
      });
      prefetchMediaTokens(collectFeedFileIds(nextPosts), 'feed');
      setFeedHasMore(Boolean(data?.hasMore));
      setFeedBefore(data?.cursor || '');
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
      const response = await authFetch(`${API_BASE_URL}/applications/my`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось загрузить заявки');
      setMyApplications(Array.isArray(data?.applications) ? data.applications : []);
      setApplicationsError('');
    } catch (error) {
      const message = error.message || 'Не удалось загрузить заявки';
      if (!silent) {
        setApplicationsError(message);
        notifyRef.current(message, 'Заявки');
      }
    } finally {
      if (!silent) setApplicationsLoading(false);
    }
  }, [user?.username]);

  const fetchEmployees = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/employees`);
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
        const currentAvatar = resolveAttachmentUrl(
          ownEmployee.avatar
          || ownEmployee.profile?.avatar
          || localStorage.getItem(getAvatarKey(user.username))
          || ''
        );
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

  const persistNewMessage = useCallback(async (conversationId, message) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const data = await fetchJsonWithRetry(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...chatAuthHeaders }, body: JSON.stringify({ message })
      }, { attempts: 1, fallbackMessage: 'Не удалось сохранить сообщение' });
      return data.item;
    } finally { window.clearTimeout(timeout); }
  }, [chatAuthHeaders]);

  const persistMessagePatch = useCallback(async (conversationId, messageId, message) => {
    const result = await fetchJsonWithRetry(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
      body: JSON.stringify({ message })
    }, { attempts: 1, fallbackMessage: 'Не удалось сохранить изменение' });
    return result.item;
  }, [chatAuthHeaders]);

  const persistMessageReaction = useCallback(async (conversationId, messageId, emoji, active) => {
    const result = await fetchJsonWithRetry(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
      body: JSON.stringify({ emoji, active })
    }, { attempts: 1, fallbackMessage: 'Не удалось поставить реакцию' });
    return result.item;
  }, [chatAuthHeaders]);

  useEffect(() => {
    const refreshCoreData = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchThreads();
      fetchEmployees();
      fetchMyApplications({ silent: true });
    };
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      refreshCoreData();
    };

    refreshCoreData();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchThreads, fetchEmployees, fetchMyApplications]);

  useEffect(() => {
    conversationFetchControllerRef.current?.abort();
    if (!currentConversationId) return undefined;

    const controller = new AbortController();
    conversationFetchControllerRef.current = controller;
    let active = true;

    const loadConversation = async () => {
      const queued = pendingMessagesRef.current.filter(entry => entry.conversationId === currentConversationId).map(entry => entry.message);
      if (queued.length) setThreads(current => ({ ...current, [currentConversationId]: mergeMessages(current[currentConversationId], queued) }));
      const hasMemoryCopy = Object.prototype.hasOwnProperty.call(threadsRef.current, currentConversationId);
      let hasCachedCopy = false;
      if (!hasMemoryCopy) {
        setLoadingConversationIds((prev) => ({ ...prev, [currentConversationId]: true }));
        const cachedMessages = await readCachedConversation(user.username, currentConversationId);
        if (!active || controller.signal.aborted) return;
        if (cachedMessages.length) {
          hasCachedCopy = true;
          setThreads((prev) => ({ ...prev, [currentConversationId]: mergeMessages(cachedMessages, prev[currentConversationId]) }));
          prefetchMediaTokens(collectThreadFileIds({ [currentConversationId]: cachedMessages }), 'chat');
          setLoadingConversationIds((prev) => ({ ...prev, [currentConversationId]: false }));
        }
      }
      await fetchConversationMessages(currentConversationId, {
        silent: hasMemoryCopy || hasCachedCopy,
        signal: controller.signal
      });
    };

    loadConversation();
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentConversationId, fetchConversationMessages, user.username]);

  useEffect(() => {
    if (activeTab !== 'audit' || !selectedThreadId) return undefined;
    const controller = new AbortController();
    fetchConversationMessages(selectedThreadId, {
      signal: controller.signal,
      includeDeletedContent: isAdmin
    });
    return () => controller.abort();
  }, [activeTab, fetchConversationMessages, isAdmin, selectedThreadId]);

  const synchronizeConversation = useCallback(async (id) => {
    const knownIds = (threadsRef.current[id] || []).filter(message => !['waiting', 'sending', 'error'].includes(message.deliveryStatus)).map(message => message.id);
    for (let offset = 0; offset < knownIds.length; offset += 200) {
      const version = conversationMutationRef.current[id] || 0;
      try {
        const response = await authFetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(id)}/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...chatAuthHeaders }, body: JSON.stringify({ ids: knownIds.slice(offset, offset + 200) })
        });
        const data = await readApiJson(response, 'Не удалось сверить переписку');
        if ((conversationMutationRef.current[id] || 0) !== version) continue;
        const removed = new Set(data.removedIds || []);
        setThreads(current => ({ ...current, [id]: mergeMessages((current[id] || []).filter(message => !removed.has(message.id)), data.messages || []) }));
      } catch { break; }
    }
    await fetchConversationMessages(id, { silent: true });
  }, [chatAuthHeaders, fetchConversationMessages]);

  useEffect(() => {
    if (!user?.username || typeof EventSource === 'undefined') return undefined;
    const lastEventStorageKey = `employeeChatLastEventId:${user.username.toLowerCase()}`;
    const query = new URLSearchParams();
    if (user.accessToken) query.set('access_token', user.accessToken);
    const savedLastEventId = localStorage.getItem(lastEventStorageKey);
    if (savedLastEventId) query.set('last_event_id', savedLastEventId);
    const stream = new EventSource(`${API_BASE_URL}/chat/threads/stream?${query.toString()}`);
    let summaryTimer;
    const scheduleSummary = () => { window.clearTimeout(summaryTimer); summaryTimer = window.setTimeout(() => fetchThreadsRef.current?.(), 150); };
    stream.addEventListener('ready', () => {
      setConnectionState('connected');
      seenStreamEventIdsRef.current.clear();
      fetchThreadsRef.current?.();
      const selected = selectedEmailRef.current;
      if (selected) synchronizeConversation(getConversationId(user.username, selected));
      fetchMyApplications({ silent: true });
      if (feedPostsRef.current.length) fetchFeed({ silent: true });
    });
    stream.onerror = () => { setConnectionState(navigator.onLine ? 'reconnecting' : 'offline'); authFetch(`${API_BASE_URL}/auth/session`).catch(() => {}); };

    const readStreamEvent = (event) => {
      const eventId = String(event.lastEventId || '');
      if (eventId && seenStreamEventIdsRef.current.has(eventId)) return null;
      try {
        const payload = JSON.parse(event.data || '{}');
        if (eventId) {
          seenStreamEventIdsRef.current.add(eventId);
          if (seenStreamEventIdsRef.current.size > 1000) {
            seenStreamEventIdsRef.current = new Set([...seenStreamEventIdsRef.current].slice(-500));
          }
          localStorage.setItem(lastEventStorageKey, eventId);
        }
        return payload;
      } catch {
        return null;
      }
    };

    const handleMessage = (event, { incrementCount = false } = {}) => {
      try {
        const payload = readStreamEvent(event);
        if (!payload) return;
        const conversationId = payload.conversationId;
        const message = payload.item;
        if (!conversationId || !message?.id) return;
        prefetchMediaTokens(collectThreadFileIds({ [conversationId]: [message] }), 'chat');
        scheduleSummary();
        conversationMutationRef.current[conversationId] = (conversationMutationRef.current[conversationId] || 0) + 1;
        const wasKnown = (threadsRef.current[conversationId] || []).some((item) => item.id === message.id);
        setThreads((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, conversationId)) return prev;
          const current = Array.isArray(prev[conversationId]) ? prev[conversationId] : [];
          const exists = current.some((item) => item.id === message.id);
          const next = exists
            ? current.map((item) => (item.id === message.id ? { ...item, ...message } : item))
            : [...current, message].sort((left, right) => (
              new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
            ));
          writeCachedConversation(user.username, conversationId, next);
          return { ...prev, [conversationId]: next };
        });
        setThreadSummaries((prev) => {
          const current = prev[conversationId] || {};
          const currentTimestamp = Number(current.lastTimestamp)
            || new Date(current.lastAt || current.lastMessage?.createdAt || 0).getTime()
            || 0;
          const messageTimestamp = new Date(message.createdAt || message.updatedAt || Date.now()).getTime();
          const isLatest = messageTimestamp >= currentTimestamp;
          return {
            ...prev,
            [conversationId]: {
              ...current,
              conversationId,
              ...(isLatest ? {
                lastMessage: message,
                lastAt: message.createdAt || message.updatedAt || new Date().toISOString(),
                lastTimestamp: messageTimestamp
              } : {}),
              messageCount: Math.max(0, Number(current.messageCount) || 0) + (incrementCount && !wasKnown ? 1 : 0)
            }
          };
        });
      } catch {
        // Ignore malformed events; EventSource will continue receiving updates.
      }
    };

    const handleConversationRefresh = (event) => {
      try {
        const payload = readStreamEvent(event);
        if (!payload) return;
        const conversationId = payload.conversationId;
        if (!conversationId) return;
        conversationMutationRef.current[conversationId] = (conversationMutationRef.current[conversationId] || 0) + 1;
        fetchThreadsRef.current?.();
        if (payload.clearedAt) {
          setThreads(current => ({ ...current, [conversationId]: (current[conversationId] || []).map(message => ({ ...message, deletedAt: payload.clearedAt, deletedBy: payload.deletedBy, text: '', attachments: [], attachment: null })) }));
        }
        if (Object.prototype.hasOwnProperty.call(threadsRef.current, conversationId)) {
          fetchConversationMessages(conversationId, { silent: true });
        }
      } catch {
        // noop
      }
    };

    const handleConversationDelete = (event) => {
      try {
        const payload = readStreamEvent(event);
        if (!payload) return;
        const conversationId = payload.conversationId;
        if (!conversationId) return;
        setThreads((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, conversationId)) return prev;
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
        setThreadSummaries((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, conversationId)) return prev;
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
        removeCachedConversation(user.username, conversationId);
      } catch {
        // noop
      }
    };

    const readFeedEvent = readStreamEvent;

    const handleFeedPostCreated = (event) => {
      const payload = readFeedEvent(event);
      const post = payload?.post;
      if (!post?.id) return;
      feedMutationVersionRef.current += 1;
      setFeedPosts((current) => {
        const existing = current.find((item) => item.id === post.id);
        const mergedPost = existing
          ? {
            ...existing,
            ...post,
            comments: Array.isArray(existing.comments) && existing.comments.length ? existing.comments : (post.comments || []),
            reactions: Object.keys(existing.reactions || {}).length ? existing.reactions : (post.reactions || {})
          }
          : post;
        return sortFeedPosts([mergedPost, ...current.filter((item) => item.id !== post.id)]);
      });
    };

    const handleFeedPostUpdated = (event) => {
      const payload = readFeedEvent(event);
      if (!payload?.post?.id) return;
      feedMutationVersionRef.current += 1;
      setFeedPosts((current) => sortFeedPosts(current.map((post) => (
        post.id === payload.post.id ? { ...post, ...payload.post } : post
      ))));
    };

    const handleFeedPostDeleted = (event) => {
      const payload = readFeedEvent(event);
      if (!payload?.postId) return;
      feedMutationVersionRef.current += 1;
      setFeedPosts((current) => current.filter((post) => post.id !== payload.postId));
    };

    const handleFeedCommentCreated = (event) => {
      const payload = readFeedEvent(event);
      if (!payload?.postId || !payload?.comment?.id) return;
      feedMutationVersionRef.current += 1;
      setFeedPosts((current) => current.map((post) => {
        if (post.id !== payload.postId) return post;
        const comments = [
          ...(post.comments || []).filter((comment) => comment.id !== payload.comment.id),
          payload.comment
        ];
        return {
          ...post,
          comments,
          commentCount: Number(payload.commentCount) || comments.filter((comment) => !comment.deletedAt).length,
          updatedAt: payload.updatedAt || post.updatedAt
        };
      }));
    };

    const handleFeedCommentDeleted = (event) => {
      const payload = readFeedEvent(event);
      if (!payload?.postId || !payload?.commentId) return;
      feedMutationVersionRef.current += 1;
      setFeedPosts((current) => current.map((post) => (
        post.id === payload.postId
          ? {
            ...post,
            comments: (post.comments || []).filter((comment) => comment.id !== payload.commentId),
            commentCount: Math.max(0, Number(payload.commentCount) || 0),
            updatedAt: payload.updatedAt || post.updatedAt
          }
          : post
      )));
    };

    const handleFeedReactionUpdated = (event) => {
      const payload = readFeedEvent(event);
      if (!payload?.postId) return;
      feedMutationVersionRef.current += 1;
      setFeedPosts((current) => current.map((post) => (
        post.id === payload.postId
          ? { ...post, reactions: payload.reactions || post.reactions, updatedAt: payload.updatedAt || post.updatedAt }
          : post
      )));
    };

    const handleFeedPinUpdated = (event) => {
      const payload = readFeedEvent(event);
      if (!payload?.postId) return;
      feedMutationVersionRef.current += 1;
      setFeedPosts((current) => sortFeedPosts(current.map((post) => (
        post.id === payload.postId
          ? { ...post, pinned: Boolean(payload.pinned), updatedAt: payload.updatedAt || post.updatedAt }
          : post
      ))));
    };

    const handleBulkDeleted = (event) => {
      const payload = readStreamEvent(event);
      if (!payload?.conversationId || !Array.isArray(payload.messageIds)) return;
      scheduleSummary();
      conversationMutationRef.current[payload.conversationId] = (conversationMutationRef.current[payload.conversationId] || 0) + 1;
      const deletedIds = new Set(payload.messageIds);
      setThreads((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, payload.conversationId)) return prev;
        const nextMessages = (prev[payload.conversationId] || []).map((message) => (
          deletedIds.has(message.id)
            ? {
              ...message,
              deletedAt: payload.deletedAt,
              deletedBy: payload.deletedBy
            }
            : message
        ));
        writeCachedConversation(user.username, payload.conversationId, nextMessages);
        return { ...prev, [payload.conversationId]: nextMessages };
      });
    };

    const handleReadStateUpdated = (event) => {
      const payload = readStreamEvent(event);
      if (!payload?.conversationId) return;
      scheduleSummary();
    };

    const handleTypingUpdated = (event) => {
      const payload = readStreamEvent(event);
      if (!payload?.conversationId || !payload?.login) return;
      setRemoteTypingByConversation((prev) => ({
        ...prev,
        [payload.conversationId]: payload.active ? payload.login : ''
      }));
    };

    stream.addEventListener('message-created', (event) => handleMessage(event, { incrementCount: true }));
    stream.addEventListener('message-updated', handleMessage);
    stream.addEventListener('messages-bulk-deleted', handleBulkDeleted);
    stream.addEventListener('read-state-updated', handleReadStateUpdated);
    stream.addEventListener('typing-updated', handleTypingUpdated);
    stream.addEventListener('conversation-refresh', handleConversationRefresh);
    stream.addEventListener('conversation-delete', handleConversationDelete);
    stream.addEventListener('feed-post-created', handleFeedPostCreated);
    stream.addEventListener('feed-post-updated', handleFeedPostUpdated);
    stream.addEventListener('feed-post-deleted', handleFeedPostDeleted);
    stream.addEventListener('feed-comment-created', handleFeedCommentCreated);
    stream.addEventListener('feed-comment-deleted', handleFeedCommentDeleted);
    stream.addEventListener('feed-reaction-updated', handleFeedReactionUpdated);
    stream.addEventListener('feed-pin-updated', handleFeedPinUpdated);
    return () => { stream.close(); window.clearTimeout(summaryTimer); };
  }, [fetchConversationMessages, fetchFeed, fetchMyApplications, synchronizeConversation, user?.accessToken, user?.username]);

  useEffect(() => {
    if (activeTab !== 'feed' || !user?.username) return undefined;
    let active = true;

    const loadFeed = async () => {
      const hasMemoryCopy = feedPostsRef.current.length > 0;
      let hasCachedCopy = false;
      if (!hasMemoryCopy) {
        const cached = await readCachedFeed(user.username);
        if (!active) return;
        if (cached?.posts?.length) {
          hasCachedCopy = true;
          setFeedPosts(getVisibleFeedPosts(cached.posts));
          prefetchMediaTokens(collectFeedFileIds(cached.posts), 'feed');
          setFeedBefore(cached.cursor || '');
          setFeedHasMore(Boolean(cached.hasMore));
          setVisibleFeedPostCount(FEED_POSTS_PAGE_SIZE);
          setFeedLoading(false);
        }
      }
      await fetchFeed({ silent: hasMemoryCopy || hasCachedCopy });
    };

    loadFeed();
    return () => {
      active = false;
      feedFetchControllerRef.current?.abort();
    };
  }, [activeTab, fetchFeed, user?.username]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dialog = params.get('dialog');
    const thread = params.get('thread');
    const applicationId = params.get('application');

    const openByThread = (threadId) => {
      if (!threadId) return false;
      const participants = getParticipantsFromThreadId(threadId);
      const other = participants.find((login) => !sameLogin(login, user?.username || ''));
      if (!other) return false;
      setSelectedEmail(other);
      setActiveTab('chat');
      return true;
    };

    if (dialog) {
      setSelectedEmail(dialog);
      setActiveTab('chat');
    } else if (openByThread(thread)) {
      // Открыли тред напрямую (например, из ссылки админки).
    }

    if (applicationId && !dialog) {
      authFetch(`${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}`)
        .then((response) => readApiJson(response, 'Не удалось загрузить заявку'))
        .then((data) => {
          const application = data?.application;
          if (!application) return;
          if (application.chat_thread_id) openByThread(application.chat_thread_id);
          if (application.employee_login) {
            setSelectedEmail(application.employee_login);
            setActiveTab('chat');
          }
        })
        .catch((error) => {
          console.error('Не удалось открыть переписку заявки:', error);
        });
    }
    // Запускается один раз при монтировании.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Сервер считает статус устаревшим через 2 минуты — используем то же окно,
    // чтобы фоновая вкладка с приторможенным heartbeat не выглядела офлайн.
    const PRESENCE_RECENT_WINDOW_MS = 2 * 60 * 1000;

    return sourceEmployees
      .filter((item) => item.login !== user?.username)
      .map((item) => {
        const presence = presenceMap.get(item.login.toLowerCase());
        const lastSeen = presence?.lastSeen || null;
        const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
        const isRecentlySeen = Boolean(lastSeenMs) && Date.now() - lastSeenMs < PRESENCE_RECENT_WINDOW_MS;
        const computedRole = presence?.role || item.role || 'employee';
        return {
          email: item.login,
          isOnline: Boolean(presence?.isOnline) || isRecentlySeen,
          lastSeen,
          role: computedRole,
          profile: item
        };
      })
      .sort((a, b) => {
        const aIsManager = ['manager', 'admin'].includes((a.role || '').toLowerCase());
        const bIsManager = ['manager', 'admin'].includes((b.role || '').toLowerCase());

        if (aIsManager !== bIsManager) return aIsManager ? -1 : 1;

        const aOnline = Boolean(a.isOnline);
        const bOnline = Boolean(b.isOnline);
        if (aOnline !== bOnline) return bOnline - aOnline;
        return a.email.localeCompare(b.email);
      });
  }, [directoryEmployees, employeeDirectory, isDirectoryLoaded, isManager, user?.username]);
  const managerLogin = useMemo(
    () => chatCandidates.find((item) => ['manager', 'admin'].includes(String(item.role || '').toLowerCase()))?.email || '',
    [chatCandidates]
  );

  const unreadByEmail = useMemo(() => Object.fromEntries(chatCandidates.map(employee => {
    const id = getConversationId(user.username, employee.email);
    return [employee.email, Number(threadSummaries[id]?.unreadCount) || 0];
  })), [chatCandidates, threadSummaries, user.username]);

  useEffect(() => {
    if (!selectedEmail) return;
    if (!chatCandidates.some((item) => item.email === selectedEmail)) setSelectedEmail('');
  }, [chatCandidates, selectedEmail]);

  useEffect(() => {
    if (selectedEmail) { setActiveTab('chat'); suppressReadRef.current = ''; setDateSearchMessages(null); }
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
      return next;
    });
  }, [attachmentDrafts, currentConversationId, draft, user?.username]);

  useChatDraftStorage(user?.username || 'guest', chatDrafts);

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
    const handleOnline = () => { setIsOnline(true); setConnectionState('reconnecting'); };
    const handleOffline = () => { setIsOnline(false); setConnectionState('offline'); };
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
    nearBottomRef.current = false;
  }, [activeTab, selectedEmail]);

  useEffect(() => {
    if (!currentConversationId || activeTab !== 'chat' || document.hidden || suppressReadRef.current === currentConversationId || dialogSearch.trim() || dateSearchMessages) return;
    const wrap = messagesWrapRef.current;
    if (!wrap) return;
    const distanceFromBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
    if (distanceFromBottom > 80) return;
    const conversationMessages = threads[currentConversationId] || [];
    const latestIncoming = conversationMessages
      .filter((message) => message.sender !== user.username && !message.deletedAt)
      .reduce((latest, message) => {
        if (!latest) return message;
        return compareMessages(message, latest) > 0 ? message : latest;
      }, null);
    if (!latestIncoming) return;
    const currentReadState = readState[currentConversationId];
    const readCursor = { id: getReadMessageId(currentReadState), createdAt: getReadTimestamp(currentReadState) };
    if (
      getReadMessageId(currentReadState) === latestIncoming.id
      || compareMessages(readCursor, latestIncoming) >= 0
    ) return;

    const unreadInConversation = conversationMessages.filter((message) => (
      message.sender !== user.username
      && compareMessages(message, readCursor) > 0
    )).length;

    authFetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
      body: JSON.stringify({ messageId: latestIncoming.id })
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.state) return;
      setReadState((prev) => {
        const next = { ...prev, [currentConversationId]: data.state };
        saveReadState(user.username, next);
        return next;
      });
      fetchThreadsRef.current?.();
      // Сначала дожидаемся сохранения на сервере. Иначе App успевает получить
      // прежний счётчик и индикатор в меню остаётся до повторного входа в чат.
      window.dispatchEvent(new CustomEvent('chat:read', {
        detail: { decrement: unreadInConversation }
      }));
    }).catch(() => {
      // Local read state remains available while the connection recovers.
    });
  }, [activeTab, chatAuthHeaders, currentConversationId, dateSearchMessages, dialogSearch, readState, readViewportVersion, threads, user.username]);

  useEffect(() => {
    const nextConversationId = currentConversationId || '';
    const active = Boolean(nextConversationId && draft.trim());
    const timer = window.setTimeout(() => {
      const previousConversationId = typingActiveConversationRef.current;
      if (previousConversationId && previousConversationId !== nextConversationId) {
        authFetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(previousConversationId)}/typing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
          body: JSON.stringify({ active: false }),
          keepalive: true
        }).catch(() => {});
      }
      if (!nextConversationId) {
        typingActiveConversationRef.current = '';
        return;
      }
      typingRequestControllerRef.current?.abort();
      const controller = new AbortController();
      typingRequestControllerRef.current = controller;
      authFetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(nextConversationId)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
        body: JSON.stringify({ active }),
        signal: controller.signal
      }).then(() => {
        typingActiveConversationRef.current = active ? nextConversationId : '';
      }).catch((error) => {
        if (error?.name !== 'AbortError') console.debug('Typing state update skipped:', error.message);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [chatAuthHeaders, currentConversationId, draft]);

  useEffect(() => () => {
    const conversationId = typingActiveConversationRef.current;
    typingRequestControllerRef.current?.abort();
    if (!conversationId) return;
    authFetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(conversationId)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
      body: JSON.stringify({ active: false }),
      keepalive: true
    }).catch(() => {});
  }, [chatAuthHeaders]);


  useEffect(() => {
    const wrap = messagesWrapRef.current;
    if (!wrap) return;
    forceScrollRef.current = true;
    wrap.scrollTop = wrap.scrollHeight;
    setReadViewportVersion((current) => current + 1);
  }, [currentConversationId]);

  useEffect(() => {
    const wrap = messagesWrapRef.current;
    if (!wrap) return;

    if (forceScrollRef.current) {
      wrap.scrollTop = wrap.scrollHeight;
      forceScrollRef.current = false;
      setReadViewportVersion((current) => current + 1);
      return;
    }

    const distanceFromBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
    if (distanceFromBottom < 140) {
      wrap.scrollTop = wrap.scrollHeight;
      setReadViewportVersion((current) => current + 1);
    }
  }, [currentMessages.length]);

  useEffect(() => {
    if (!currentConversationId || !Object.prototype.hasOwnProperty.call(threadsRef.current, currentConversationId)) return;
    writeCachedConversation(user.username, currentConversationId, currentMessages);
  }, [currentConversationId, currentMessages, user.username]);

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
      const avatarBlob = dataUrlToBlob(optimizedAvatar);
      const response = await authFetch(`${API_BASE_URL}/auth/profile/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': avatarBlob.type || 'image/jpeg' },
        body: avatarBlob
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Не удалось сохранить аватар');
      }
      const savedAvatar = resolveAttachmentUrl(data.avatar);
      if (!savedAvatar) throw new Error('Сервер не вернул адрес аватара');
      setAvatarUrl(savedAvatar);
      localStorage.setItem(getAvatarKey(user.username), savedAvatar);
      saveProfileDraft(user.username, { ...profileForm, avatar: savedAvatar });
      setDirectoryEmployees((current) => {
        const next = current.map((employee) => (
          sameLogin(employee.login, user.username)
            ? {
                ...employee,
                avatar: savedAvatar,
                profile: { ...(employee.profile || {}), avatar: savedAvatar }
              }
            : employee
        ));
        saveDirectoryCache(next);
        return next;
      });
    } catch (error) {
      notify(error.message || 'Не удалось обработать изображение. Попробуйте другое фото.', 'Фото профиля');
    } finally {
      event.target.value = '';
    }
  };

  const removeAvatar = async () => {
    const response = await authFetch(`${API_BASE_URL}/auth/profile/avatar`, {
      method: 'DELETE'
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
    if (isSendingMessage || !currentConversationId || (!draft.trim() && !attachmentDrafts.length)) return;
    if (draft.length > 2000 || attachmentDrafts.length > 10) { notify('Не больше 2000 символов и 10 файлов', 'Сообщение'); return; }
    if (chatUploadQueue.some(item => item.conversationId === currentConversationId && item.status !== 'error')) { notify('Дождитесь загрузки файлов или отмените её', 'Вложения'); return; }
    const message = { id: createMessageId(), sender: user.username, text: draft.trim(), createdAt: new Date().toISOString(),
      attachments: attachmentDrafts, attachment: attachmentDrafts[0] || null,
      replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender, text: replyTo.text } : null, deliveryStatus: 'waiting' };
    forceScrollRef.current = true;
    setThreads(prev => ({ ...prev, [currentConversationId]: mergeMessages(prev[currentConversationId], [message]) }));
    queuePendingMessage(currentConversationId, message);
    setDraft(''); setAttachmentDrafts([]); setReplyTo(null);
  };

  const uploadAttachmentFile = async (file, scope = 'chat', { onProgress, signal } = {}) => {
    const mediaMetadata = await createAttachmentThumbnailDataUrl(file);
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    const formData = new FormData();
    formData.append('scope', scope);
    formData.append('name', file.name);
    formData.append('type', file.type || 'application/octet-stream');
    formData.append('size', String(file.size || 0));
    formData.append('uploadedBy', user?.username || '');
    if (mediaMetadata.thumbnailDataUrl) formData.append('thumbnailDataUrl', mediaMetadata.thumbnailDataUrl);
    if (mediaMetadata.width) formData.append('width', String(mediaMetadata.width));
    if (mediaMetadata.height) formData.append('height', String(mediaMetadata.height));
    if (mediaMetadata.aspectRatio) formData.append('aspectRatio', String(mediaMetadata.aspectRatio));
    if (mediaMetadata.duration) formData.append('duration', String(mediaMetadata.duration));
    formData.append('file', file, file.name);

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const abort = () => request.abort();
      request.open('POST', `${API_BASE_URL}/chat/uploads`);
      if (user?.accessToken) request.setRequestHeader('Authorization', `Bearer ${user.accessToken}`);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      request.onload = () => {
        signal?.removeEventListener('abort', abort);
        let data = {};
        try { data = JSON.parse(request.responseText || '{}'); } catch { data = {}; }
        if (request.status >= 200 && request.status < 300 && data.file) {
          resolve(data.file);
        } else {
          reject(new Error(data.message || 'Не удалось загрузить файл'));
        }
      };
      request.timeout = 120000;
      request.ontimeout = () => reject(new Error('Время загрузки истекло. Повторите попытку.'));
      request.onerror = () => {
        signal?.removeEventListener('abort', abort);
        reject(new Error('Не удалось загрузить файл'));
      };
      request.onabort = () => {
        signal?.removeEventListener('abort', abort);
        reject(new DOMException('Upload cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      request.send(formData);
    });
  };

  const uploadQueuedChatFile = async (queueItem) => {
    if (cancelledUploadsRef.current.has(queueItem.id)) return;
    const controller = new AbortController();
    uploadControllersRef.current.set(queueItem.id, controller);
    setChatUploadQueue((current) => current.map((item) => (
      item.id === queueItem.id ? { ...item, status: 'uploading', progress: 0, error: '' } : item
    )));
    try {
      const uploadedFile = await uploadAttachmentFile(queueItem.file, 'chat', {
        signal: controller.signal,
        onProgress: (progress) => setChatUploadQueue((current) => current.map((item) => (
          item.id === queueItem.id ? { ...item, progress } : item
        )))
      });
      if (cancelledUploadsRef.current.has(queueItem.id)) return;
      const stored = chatDraftsRef.current[queueItem.conversationId] || {};
      const attachments = [...(stored.attachments || []).filter(file => file.id !== uploadedFile.id), uploadedFile];
      const nextDrafts = { ...chatDraftsRef.current, [queueItem.conversationId]: { ...stored, attachments } };
      chatDraftsRef.current = nextDrafts; setChatDrafts(nextDrafts); saveChatDrafts(user.username, nextDrafts);
      if (selectedEmailRef.current && getConversationId(user.username, selectedEmailRef.current) === queueItem.conversationId) setAttachmentDrafts(attachments);
      setChatUploadQueue(current => current.filter(item => item.id !== queueItem.id));
    } catch (error) {
      if (error?.name === 'AbortError') {
        setChatUploadQueue((current) => current.filter((item) => item.id !== queueItem.id));
      } else {
        setChatUploadQueue((current) => current.map((item) => (
          item.id === queueItem.id
            ? { ...item, status: 'error', error: error.message || 'Не удалось загрузить файл' }
            : item
        )));
      }
    } finally {
      uploadControllersRef.current.delete(queueItem.id);
    }
  };

  const addAttachmentFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !currentConversationId) return;
    if (files.length + attachmentDrafts.length + chatUploadQueue.filter(item => item.conversationId === currentConversationId).length > 10) { notify('Не больше 10 файлов в сообщении', 'Вложения'); return; }

    const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (tooLarge) {
      notify(`Файл ${tooLarge.name} слишком большой. Максимум ${MAX_ATTACHMENT_SIZE_MB} МБ.`, 'Вложения');
      return;
    }

    const queueItems = files.map((file) => ({
      id: createMessageId(),
      conversationId: currentConversationId,
      file,
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'queued',
      error: ''
    }));
    setChatUploadQueue((current) => [...current, ...queueItems]);
    for (const queueItem of queueItems) {
      // Sequential upload keeps memory and network pressure predictable and
      // lets a failed file be retried without losing successful uploads.
      await uploadQueuedChatFile(queueItem);
    }
  };

  const cancelChatUpload = (queueId) => {
    cancelledUploadsRef.current.add(queueId);
    uploadControllersRef.current.get(queueId)?.abort();
    setChatUploadQueue((current) => current.filter((item) => item.id !== queueId));
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

  const jumpToMessageDate = async (dateValue) => {
    if (!dateValue || !currentConversationId) return;
    let dateMessages = currentMessages.filter((message) => {
      const messageDate = new Date(message.createdAt);
      if (Number.isNaN(messageDate.getTime())) return false;
      return messageDate.toISOString().slice(0, 10) === dateValue;
    });
    try {
      if (!dateMessages.length) {
        const response = await authFetch(
          `${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/date?date=${encodeURIComponent(dateValue)}&limit=${CHAT_MESSAGES_PAGE_SIZE}`,
          { headers: chatAuthHeaders }
        );
        const data = await readApiJson(response, 'Не удалось перейти к выбранной дате');
        dateMessages = Array.isArray(data?.messages) ? data.messages : [];
        if (dateMessages.length) {
          setDateSearchMessages(dateMessages);
          setVisibleDialogMessageCount((count) => Math.max(count, currentMessages.length + dateMessages.length));
        }
      }
      const target = dateMessages[0];
      if (!target) {
        notify('В этот день сообщений нет', 'Календарь');
        return;
      }
      window.setTimeout(() => {
        messageListRef.current?.scrollToId(target.id);
      }, 50);
    } catch (error) {
      notify(error.message || 'Не удалось перейти к выбранной дате', 'Календарь');
    }
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


  const removeAttachmentDraft = async (attachmentId) => {
    const file = attachmentDrafts.find((item, index) => (item.id || `${item.name}-${index}`) === attachmentId);
    setAttachmentDrafts((prev) => prev.filter((file, index) => (file.id || `${file.name}-${index}`) !== attachmentId));
    if (file?.id) {
      await authFetch(`${API_BASE_URL}/chat/uploads/${encodeURIComponent(file.id)}`, {
        method: 'DELETE',
        headers: chatAuthHeaders
      }).catch(() => {});
    }
  };

  const saveMyProfile = async (event) => {
    event.preventDefault();
    const response = await authFetch(`${API_BASE_URL}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        });
        notify('Пароль обновлён. При следующем входе используйте новый пароль.', 'Пароль');
        setPasswordForm({ currentPassword: '', newPassword: '' });
        logout({ reason: 'expired' });
      } catch (error) {
        notify(error.message || 'Не удалось сменить пароль', 'Пароль');
      }
      return;
    }

    const response = await authFetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
    logout({ reason: 'expired' });
  };

  const openProfileCard = useCallback(async (login) => {
    try {
      await loadProfile(login, 'preview');
      setProfileViewLogin(login);
    } catch (error) {
      notify(error.message || 'Не удалось открыть профиль сотрудника', 'Профиль');
    }
  }, [loadProfile, notify]);

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
    const idempotencyKey = (typeof window !== 'undefined' && window.crypto?.randomUUID)
      ? window.crypto.randomUUID()
      : `application-${Date.now()}-${createMessageId()}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await authFetch(`${API_BASE_URL}/applications/from-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            application: requestText.trim(),
            category: requestCategory,
            priority: requestPriority,
            chat_thread_id: currentConversationId || '',
            source_message_id: replyTo?.id || '',
            idempotency_key: idempotencyKey
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

  useEffect(() => {
    const accessToken = String(user?.accessToken || '').trim();
    if (!accessToken || typeof EventSource === 'undefined') return undefined;
    const stream = new EventSource(`${API_BASE_URL}/applications/stream?access_token=${encodeURIComponent(accessToken)}`);
    const onApplication = (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        const application = payload?.application;
        if (!application?.id) return;
        setMyApplications((previous) => payload.eventType === 'deleted'
          ? previous.filter((item) => item.id !== application.id)
          : [application, ...previous.filter((item) => item.id !== application.id)]);
      } catch { /* Ignore a malformed realtime event and keep the current list. */ }
    };
    stream.addEventListener('application', onApplication);
    return () => {
      stream.removeEventListener('application', onApplication);
      stream.close();
    };
  }, [user?.accessToken]);

  const confirmApplicationDone = async (applicationId) => {
    const employeeComment = await promptAction('Если хотите, оставьте комментарий к закрытию заявки. Можно оставить пустым.', '', 'Комментарий к закрытию');
    if (employeeComment === '') {
      const confirmed = await confirmAction('Закрыть заявку без комментария?', 'Заявка выполнена');
      if (!confirmed) return;
    }
    try {
      const response = await authFetch(`${API_BASE_URL}/applications/${applicationId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_comment: String(employeeComment || '').trim() })
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
      const response = await authFetch(`${API_BASE_URL}/applications/${applicationId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_comment: comment })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось переоткрыть заявку');
      refreshApplicationInList(data.application);
      notify('Заявка возвращена администратору.', 'Заявка переоткрыта');
    } catch (error) {
      notify(error.message || 'Не удалось переоткрыть заявку', 'Заявка');
    }
  };


  const updateChatLocalSettings = useCallback((updater) => {
    settingsRevisionRef.current += 1;
    setChatLocalSettings((prev) => {
      const next = updater(prev);
      saveChatLocalSettings(user?.username || 'guest', next);
      queueChatSettingsSync(next);
      return next;
    });
  }, [queueChatSettingsSync, user?.username]);

  const toggleLocalListValue = useCallback((key, value) => {
    updateChatLocalSettings((prev) => {
      const current = new Set(prev[key] || []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      return { ...prev, [key]: [...current] };
    });
  }, [updateChatLocalSettings]);

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
    return sourceMessages
      .filter((message) => !message.deletedAt)
      .flatMap((message) => getMessageMediaAttachments(message).map((file, index) => ({ file, message, fileIndex: index })));
  }, [currentMessages]);

  const retryMessageSend = (message) => {
    if (!currentConversationId) return;
    setPendingMessages(current => [...current.filter(item => item.message.id !== message.id),
      { conversationId: currentConversationId, message: { ...message, deliveryStatus: 'waiting' }, nextAttemptAt: 0 }]);
    setThreads(current => ({ ...current, [currentConversationId]: (current[currentConversationId] || []).map(item => item.id === message.id ? { ...item, deliveryStatus: 'waiting' } : item) }));
  };

  useMessageOutbox({ login: user.username, online: isOnline, items: pendingMessages, setItems: setPendingMessages, send: persistNewMessage,
    onSending: entry => setThreads(current => ({ ...current, [entry.conversationId]: (current[entry.conversationId] || []).map(message => message.id === entry.message.id ? { ...message, deliveryStatus: 'sending' } : message) })),
    onSaved: (entry, saved) => {
      if (!saved?.id) return;
      setThreads(current => ({ ...current, [entry.conversationId]: mergeMessages(current[entry.conversationId], [{ ...saved, deliveryStatus: 'sent' }]) }));
      fetchThreadsRef.current?.();
    },
    onFailed: entry => setThreads(current => ({ ...current, [entry.conversationId]: mergeMessages(current[entry.conversationId], [entry.message]) }))
  });

  const startInlineEditMessage = (message) => {
    if (['waiting', 'error'].includes(message.deliveryStatus)) {
      setPendingMessages(current => current.filter(item => item.message.id !== message.id));
      setDraft(message.text || ''); setAttachmentDrafts(getMessageAttachments(message));
      setThreads(current => ({ ...current, [currentConversationId]: (current[currentConversationId] || []).filter(item => item.id !== message.id) }));
      return;
    }
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
    if (!confirmed || !currentConversationId || !selectedMessageIds.length) return;
    const messageIds = [...selectedMessageIds];
    const previousMessages = threads[currentConversationId] || [];
    const deletedAt = new Date().toISOString();
    setThreads((prev) => ({
      ...prev,
      [currentConversationId]: (prev[currentConversationId] || []).map((message) => (
        messageIds.includes(message.id)
          ? { ...message, deletedAt, deletedBy: user.username }
          : message
      ))
    }));
    clearSelectedMessages();
    try {
      await fetchJsonWithRetry(
        `${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/messages/bulk-delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...chatAuthHeaders },
          body: JSON.stringify({ messageIds })
        },
        { fallbackMessage: 'Не удалось удалить выбранные сообщения' }
      );
    } catch (error) {
      setThreads((prev) => ({ ...prev, [currentConversationId]: previousMessages }));
      notify(error.message || 'Не удалось удалить выбранные сообщения', 'Удаление сообщений');
    }
  };

  const updateMessage = async (messageId, updater, targetConversationId = currentConversationId) => {
    if (!targetConversationId) return;
    const previousMessages = threads[targetConversationId] || [];
    const nextMessages = previousMessages.map((item) => (item.id === messageId ? updater(item) : item));
    setThreads((prev) => ({ ...prev, [targetConversationId]: nextMessages }));

    try {
      const saved = await persistMessagePatch(targetConversationId, messageId, nextMessages.find((item) => item.id === messageId));
      if (saved) setThreads(current => ({ ...current, [targetConversationId]: mergeMessages(current[targetConversationId], [saved]) }));
    } catch (error) {
      await fetchConversationMessages(targetConversationId, { silent: true });
      throw new Error(error.message || 'Не удалось сохранить изменение');
    }
  };

  const toggleReaction = async (messageId, emoji, targetConversationId = currentConversationId) => {
    if (!targetConversationId) return;
    const previousMessages = threadsRef.current[targetConversationId] || [];
    const sourceMessage = previousMessages.find((item) => item.id === messageId);
    if (!sourceMessage) return;
    const actorHasReaction = (sourceMessage.reactions?.[emoji] || [])
      .some((login) => sameLogin(login, user.username));
    const active = !actorHasReaction;
    setThreads((current) => ({
      ...current,
      [targetConversationId]: (current[targetConversationId] || previousMessages).map((item) => {
        if (item.id !== messageId) return item;
        const reactions = { ...(item.reactions || {}) };
        const users = (Array.isArray(reactions[emoji]) ? reactions[emoji] : [])
          .filter((login) => !sameLogin(login, user.username));
        if (active) users.push(user.username);
        if (users.length) reactions[emoji] = users;
        else delete reactions[emoji];
        return { ...item, reactions };
      })
    }));
    try {
      const saved = await persistMessageReaction(targetConversationId, messageId, emoji, active);
      if (saved) {
        setThreads((current) => ({
          ...current,
          [targetConversationId]: mergeMessages(current[targetConversationId], [saved])
        }));
      }
    } catch (error) {
      await fetchConversationMessages(targetConversationId, { silent: true });
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
        deletedAt: new Date().toISOString(),
        deletedBy: user.username
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

  useEffect(() => {
    if (!replyTo || mediaViewer || chatLocalSettings.uiDesign !== 'modern') return;
    messageTextareaRef.current?.focus({ preventScroll: true });
  }, [replyTo, mediaViewer, chatLocalSettings.uiDesign]);

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
      const currentIndex = Math.max(0, files.findIndex((file, index) => sameViewerFile(file, current.file) && (!items.length || items[index].message.id === current.message.id)));
      const nextIndex = (currentIndex + direction + files.length) % files.length;
      return { ...current, ...(items[nextIndex] ? { message: items[nextIndex].message } : {}), file: files[nextIndex], fileIndex: nextIndex };
    });
  }, [getConversationMediaItems]);

  useEffect(() => {
    if (!mediaViewer || chatLocalSettings.uiDesign === 'modern') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMediaViewer(null);
      if (event.key === 'ArrowLeft') moveMediaViewer(-1);
      if (event.key === 'ArrowRight') moveMediaViewer(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mediaViewer, moveMediaViewer, chatLocalSettings.uiDesign]);

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
    const { message, file } = mediaViewer;
    const fileIndex = getMessageAttachments(message).findIndex(item => sameViewerFile(item, file));
    if (fileIndex < 0) return;
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
    setThreads((prev) => ({ ...prev, [targetConversationId]: nextMessages }));
    notify('Сообщение переслано', 'Переслать');

    queuePendingMessage(targetConversationId, newMessage);
    setForwardingTargetEmail('');
  };


  const clearConversation = async () => {
    if (!currentConversationId) return;
    const messageCount = threadSummaries[currentConversationId]?.messageCount || currentMessages.length;
    const confirmed = await confirmAction(
      `Очистить всю переписку с ${selectedEmail}? Сообщений: ${messageCount}. Сообщения и вложения останутся в архиве администратора.`,
      'Очистка диалога'
    );
    if (!confirmed) return;

    const typed = await promptAction('Для подтверждения введите УДАЛИТЬ:', '', 'Финальное подтверждение');
    if (!['УДАЛИТЬ', 'DELETE'].includes(String(typed || '').trim().toUpperCase())) return;

    try {
      await fetchJsonWithRetry(`${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/clear`, {
        method: 'POST', headers: chatAuthHeaders
      }, { attempts: 1, fallbackMessage: 'Не удалось очистить переписку' });
      setThreads(current => ({ ...current, [currentConversationId]: [] }));
      delete historyCursorRef.current[currentConversationId];
      setThreadHasMore(current => ({ ...current, [currentConversationId]: false }));
      await removeCachedConversation(user.username, currentConversationId);
      fetchThreadsRef.current?.();
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
      role: employeeForm.role,
      full_name: employeeForm.full_name,
      department: employeeForm.department,
      phone: employeeForm.phone,
      room: employeeForm.room
    };

    const isEdit = Boolean(employeeForm.id);
    const url = isEdit ? `${API_BASE_URL}/auth/employees/${employeeForm.id}` : `${API_BASE_URL}/auth/register`;
    const method = isEdit ? 'PUT' : 'POST';

    const response = await authFetch(url, {
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
    setEmployeeForm({ id: null, login: '', password: '', role: 'employee', full_name: '', department: '', phone: '', room: '' });
    setShowEmployeePassword(false);
  };

  const deleteEmployee = async (employeeId) => {
    const confirmed = await confirmAction('Удалить сотрудника? Его учётная запись будет удалена.', 'Удаление сотрудника');
    if (!confirmed) return;
    const response = await authFetch(`${API_BASE_URL}/auth/employees/${employeeId}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(data.message || 'Не удалось удалить сотрудника', 'Сотрудники');
      return;
    }
    await fetchEmployees();
  };

  const activeApplications = useMemo(() => myApplications.filter((item) => item.status !== 'done' && !item.fl), [myApplications]);
  const completedApplications = useMemo(() => myApplications.filter((item) => item.status === 'done' || item.fl), [myApplications]);
  const threadActivityById = useMemo(() => {
    const ids = new Set([...Object.keys(threadSummaries), ...Object.keys(threads)]);
    return Object.fromEntries([...ids].map((threadId) => {
      const summary = threadSummaries[threadId];
      const loadedMessages = threads[threadId];
      if (Array.isArray(loadedMessages) && loadedMessages.length) {
        return [threadId, getThreadActivityMeta(loadedMessages)];
      }
      return [threadId, {
        visible: Boolean(summary?.lastMessage),
        messageCount: Number(summary?.messageCount) || 0,
        deletedCount: Number(summary?.deletedCount) || 0,
        attachmentsCount: Number(summary?.attachmentsCount) || 0,
        lastAt: summary?.lastAt || '',
        lastTimestamp: Number(summary?.lastTimestamp) || 0
      }];
    }));
  }, [threadSummaries, threads]);

  const allConversationIds = useMemo(() => Object.keys(threadActivityById).filter((threadId) => {
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

  const employeeByLogin = useMemo(() => new Map(directoryEmployees.map(employee => [String(employee.login).toLowerCase(), employee])), [directoryEmployees]);
  const activeContact = chatCandidates.find((item) => item.email === selectedEmail);
  const remoteTypingLogin = currentConversationId ? remoteTypingByConversation[currentConversationId] : '';
  const typingHint = remoteTypingLogin
    ? `${activeContact?.profile?.full_name || formatVisibleLogin(remoteTypingLogin)} ${t('typing')}…`
    : '';
  const tabs = adminSection ? MANAGER_TABS.filter(tab => ['employees', 'archive', 'audit'].includes(tab.id)) : (isManager ? MANAGER_TABS.filter(tab => ['chat', 'feed'].includes(tab.id)) : EMPLOYEE_TABS);
  const unreadTotal = Object.entries(unreadByEmail).reduce((sum, [email, count]) => sum + ((chatLocalSettings.muted || []).includes(getConversationId(user.username, email)) ? 0 : count), 0);
  const feedReadTimestamp = feedReadAt ? new Date(feedReadAt).getTime() : 0;
  const feedBadge = feedPosts.reduce((count, post) => {
    const postUnread = post.author !== user?.username && getFeedItemTimestamp(post) > feedReadTimestamp ? 1 : 0;
    const commentsUnread = (post.comments || []).filter((comment) => (
      comment.author !== user?.username && getFeedItemTimestamp(comment) > feedReadTimestamp
    )).length;
    return count + postUnread + commentsUnread;
  }, 0);
  const requestBadge = activeApplications.length || (requestStatus.state === 'sent' ? 1 : 0);
  const normalizedDialogSearch = normalizeText(dialogSearch);
  const visibleMessages = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const source = normalizedDialogSearch.length >= 2 ? serverDialogSearchResults : (dateSearchMessages || currentMessages);
    return [...source].sort(compareMessages).filter((message) => {
      const isDeleted = Boolean(message.deletedAt);
      const attachments = isDeleted ? [] : getMessageAttachments(message);
      if (normalizedDialogSearch && isDeleted) return false;
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
  }, [currentMessages, dateSearchMessages, dialogFilter, normalizedDialogSearch, serverDialogSearchResults, user.username]);
  const dialogSearchResults = normalizedDialogSearch.length >= 2
    ? serverDialogSearchResults
    : [];
  const activeDialogSearchResult = dialogSearchResults[dialogSearchIndex] || null;
  useEffect(() => {
    if (!activeDialogSearchResult?.id) return;
    window.requestAnimationFrame(() => {
      messageListRef.current?.scrollToId(activeDialogSearchResult.id);
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
  const dialogMediaItems = useMemo(() => currentMessages
    .filter((message) => !message.deletedAt)
    .flatMap((message) => [
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
    const startIndex = normalizedDialogSearch || dateSearchMessages ? 0 : Math.max(0, visibleMessages.length - visibleDialogMessageCount);
    return visibleMessages.slice(startIndex);
  }, [visibleMessages, visibleDialogMessageCount, normalizedDialogSearch, dateSearchMessages]);
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

  const loadFeedComments = async (postId, { append = false } = {}) => {
    const hasPendingCommentChange = [...pendingFeedActionsRef.current].some((key) => (
      key === `comment-add:${postId}` || key.startsWith(`comment-delete:${postId}:`)
    ));
    const actionKey = `comments-load:${postId}`;
    if (hasPendingCommentChange || !beginFeedAction(actionKey, postId)) return;
    try {
      const currentPost = feedPostsRef.current.find((post) => post.id === postId);
      const before = append ? currentPost?.comments?.[0]?.createdAt || '' : '';
      const beforeQuery = before ? `&before=${encodeURIComponent(before)}` : '';
      const response = await authFetch(`${API_BASE_URL}/chat/feed/posts/${encodeURIComponent(postId)}/comments?limit=${FEED_COMMENTS_PAGE_SIZE}${beforeQuery}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить комментарии');
      const comments = Array.isArray(data?.comments) ? data.comments : [];
      setFeedPosts((current) => current.map((post) => (
        post.id === postId
          ? {
            ...post,
            comments: append
              ? [...new Map([...comments, ...(post.comments || [])].map((comment) => [comment.id, comment])).values()]
              : comments,
            commentCount: Math.max(Number(post.commentCount) || 0, comments.length)
          }
          : post
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

  const messageItemProps = useStableMessageProps({ messageListRef, AttachmentCard, AuthenticatedAvatar, REACTION_EMOJIS, activeDialogSearchResult, chatLocalSettings, copyMessageText, createRequestFromMessage, currentConversationId, deleteMessage, employeeByLogin, extractLinks, formatFeedLogin, getEmployeeAvatar, getLinkPreview, getMessageAttachments, highlightText, inlineEditMessageId, inlineEditText, interfaceLocale, isEnglishInterface, isManager, isMessageRead, isVideoAttachment, messageReactionExpanded, multiSelectMode, openAttachmentInNewTab, openChatMediaViewer, openEmployeeProfile, openForwardMessagePicker, openSelectedMessageMenu, profileForm, retryMessageSend, saveInlineEditMessage, selectedMessageId, selectedMessageIds, selectedMessageMenuPlacement, selectedMessageMenuStyle, setInlineEditMessageId, setInlineEditText, setMessageReactionExpanded, setMultiSelectMode, setReplyTo, setSelectedMessageId, startInlineEditMessage, t, threadSummaries, togglePinned, toggleReaction, toggleSelectedMessage, user });

  return (
    <div
      className={`employee-chat-layout design-${chatLocalSettings.uiDesign || 'classic'} ${adminSection ? 'chat-administration' : ''} ${activeTab === 'chat' && selectedEmail ? 'mobile-dialog-open' : ''} ${activeTab !== 'chat' ? 'mobile-section-open' : ''} theme-${chatLocalSettings.uiTheme || 'light'} density-${chatLocalSettings.uiDensity || 'regular'} text-${chatLocalSettings.uiTextSize || 'medium'} ${isDraggingFiles ? 'dragging-files' : ''}`}
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
      
      {!adminSection && <aside className="employee-chat-sidebar">
        <div className="employee-chat-brand">
          <button type="button" className="employee-avatar-upload" onClick={() => setAvatarViewerOpen(true)}>
            <AuthenticatedAvatar
              src={avatarUrl}
              alt="avatar"
              className="employee-avatar-image"
              fallback={<span>{String(baseDisplayName || '?').slice(0, 1).toUpperCase()}</span>}
            />
          </button>
          <div className="employee-brand-meta">
            <strong>{profileForm.full_name || baseDisplayName}</strong>
            <span>{profileForm.position || user?.position || profileForm.department || t('workingChat')}</span>
          </div>
          <div className="brand-actions">
            {isAdmin && <button type="button" className="icon-btn admin-panel-return-btn" onClick={() => navigate('/')}>{t('adminPanel')}</button>}
            <button type="button" className="icon-btn" onClick={() => { setActiveTab('profile'); setProfileViewLogin(''); }}>{t('profile')}</button>
          </div>
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
          modern={chatLocalSettings.uiDesign === 'modern'}
          hiddenDialogs={chatLocalSettings.hidden}
          archivedDialogs={chatLocalSettings.archived}
          mutedDialogs={chatLocalSettings.muted}
          onRestoreHidden={id => toggleLocalListValue('hidden', id)}
          onRestoreArchived={id => toggleLocalListValue('archived', id)}
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

      </aside>}

      <section className="employee-chat-main">
        {adminSection && <nav className="chat-admin-navigation">{tabs.map(tab => <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => navigate(`/chat-tools/${tab.id}`)}>{getTabLabel(tab)}</button>)}<button type="button" onClick={() => navigate('/employee')}>{isEnglishInterface ? 'Open chat' : 'Открыть чат'}</button></nav>}
        {!adminSection && <button type="button" className="mobile-chat-back" onClick={() => { setSelectedEmail(''); setActiveTab('chat'); }}>{isEnglishInterface ? '← Conversations' : '← Диалоги'}</button>}
        {!adminSection && <div className={`chat-connection-state ${connectionState}`} role="status"><span />{isEnglishInterface ? ({ connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline' })[connectionState] : ({ connected: 'На связи', connecting: 'Подключение…', reconnecting: 'Восстанавливаем связь…', offline: 'Нет соединения' })[connectionState]}</div>}
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
                  showConversationMenu={chatLocalSettings.showConversationMenu === true || chatLocalSettings.uiDesign === 'modern'}
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
                    setSelectedEmail('');
                    setConversationMenuOpen(false);
                  }}
                  onHide={() => {
                    toggleLocalListValue('hidden', currentConversationId);
                    setSelectedEmail('');
                    setConversationMenuOpen(false);
                  }}
                  onPin={() => {
                    toggleLocalListValue('pinned', currentConversationId);
                    setConversationMenuOpen(false);
                  }}
                  onMarkUnread={async () => {
                    suppressReadRef.current = currentConversationId;
                    try {
                      const response = await authFetch(`${API_BASE_URL}/chat/threads/${encodeURIComponent(currentConversationId)}/unread`, { method: 'PUT' });
                      if (!response.ok) throw new Error(isEnglishInterface ? 'Could not mark unread' : 'Не удалось пометить непрочитанным');
                      setReadState(prev => ({ ...prev, [currentConversationId]: '' }));
                      fetchThreadsRef.current?.();
                      setSelectedEmail('');
                    } catch (error) {
                      suppressReadRef.current = '';
                      notify(error.message);
                    }
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
                  canDeleteConversation={isManager}
                  onDeleteConversation={() => {
                    clearConversation();
                    setConversationMenuOpen(false);
                  }}
                />

                {isCurrentConversationLoading && <ChatLoadingOverlay label={t('loading')} />}

	                {chatLocalSettings.showDialogFilters === true && <div className="dialog-filter-row">{CHAT_FILTERS.map((filter) => <button key={filter.id} type="button" className={dialogFilter === filter.id ? 'active' : ''} onClick={() => setDialogFilter(filter.id)}>{getOptionLabel(filter)}</button>)}</div>}
	                {chatLocalSettings.showDialogDateJump === true && <div className="date-jump-row"><label>{t('jumpToDate')} <input type="date" onChange={(event) => jumpToMessageDate(event.target.value)} /></label></div>}
                {chatLocalSettings.showDialogMediaPanel === true && mediaPanelOpen && <div className="dialog-media-panel"><div className="dialog-media-tabs">{CHAT_MEDIA_TABS.map((tab) => <button key={tab.id} type="button" className={mediaPanelTab === tab.id ? 'active' : ''} onClick={() => setMediaPanelTab(tab.id)}>{getOptionLabel(tab)}</button>)}</div><input type="search" placeholder={t('mediaSearch')} value={mediaPanelSearch} onChange={(e) => setMediaPanelSearch(e.target.value)} /><div className="dialog-media-grid">{filteredDialogMediaItems.length === 0 && <small>{t('noResults')}</small>}{filteredDialogMediaItems.map(({ message, file, fileIndex, type }, index) => <button key={`${message.id}-${file.name}-${index}`} type="button" onClick={() => type === 'link' ? window.open(file.dataUrl, '_blank', 'noopener,noreferrer') : isMediaAttachment(file) ? setMediaViewer({ message, file, fileIndex, scope: 'dialog' }) : openAttachmentInNewTab(file)}>{type === 'link' ? <span>🔗 {file.name}</span> : isMediaAttachment(file) ? (isVideoAttachment(file) ? <VideoPosterFrame file={file} alt={file.name || t('media')} isEnglish={isEnglishInterface} /> : <img src={getAttachmentUrl(file)} alt={file.name || t('media')} loading="lazy" decoding="async" />) : <span>{getFileIcon(file.type)} {file.name}</span>}<em>{new Date(message.createdAt).toLocaleDateString(interfaceLocale)}</em></button>)}</div></div>}

                {pinnedMessages.length > 0 && (
                  <div className="pinned-box">
                    <strong>📌 {t('pinnedMessages')} {pinnedMessageIndex + 1} {t('of')} {pinnedMessages.length}</strong><div className="pinned-controls"><button type="button" onClick={() => setPinnedMessageIndex((prev) => Math.max(0, prev - 1))}>‹</button><button type="button" onClick={() => setPinnedMessageIndex((prev) => Math.min(pinnedMessages.length - 1, prev + 1))}>›</button></div>{pinnedMessages[pinnedMessageIndex] && <button type="button" onClick={() => messageListRef.current?.scrollToId(pinnedMessages[pinnedMessageIndex].id)}>• {pinnedMessages[pinnedMessageIndex].text || (getMessageAttachments(pinnedMessages[pinnedMessageIndex]).some(isImageAttachment) ? `📷 ${t('photo')}` : `📎 ${t('document')}`)}</button>}
                  </div>
                )}

                {multiSelectMode && <div className="multi-select-toolbar"><strong>{t('selectedCount')}: {selectedMessageIds.length}</strong><button type="button" onClick={copySelectedMessages}>{t('copy')}</button><button type="button" onClick={() => { const selected = getSelectedMessages(); if (selected[0]) openForwardMessagePicker({ ...selected[0], text: selected.map((msg) => `${msg.sender}: ${msg.text || `[${t('attachmentPlaceholder')}]`}`).join('\n') }); }}>{t('forward')}</button><button type="button" onClick={() => { const selected = getSelectedMessages(); setRequestText(selected.map((msg) => `${msg.sender}: ${msg.text || `[${t('attachmentPlaceholder')}]`}`).join('\n')); setActiveTab('request'); }}>{t('createRequest')}</button><button type="button" className="danger-action" onClick={deleteSelectedMessages}>{t('delete')}</button><button type="button" onClick={clearSelectedMessages}>{t('cancel')}</button></div>}
                <div
                  className="messages-wrap"
                  ref={messagesWrapRef}
                  onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (selectedMessageId && messageReactionExpanded) setMessageReactionExpanded(false);
                    else if (selectedMessageId) setSelectedMessageId('');
                  }}
                  onScroll={(event) => {
                    const wrap = event.currentTarget;
                    const distanceFromBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
                    const isNearBottom = distanceFromBottom <= 80;
                    if (isNearBottom && !nearBottomRef.current && unreadByEmail[selectedEmail] > 0) {
                      setReadViewportVersion((current) => current + 1);
                    }
                    nearBottomRef.current = isNearBottom;
                    if (normalizedDialogSearch || dateSearchMessages || event.currentTarget.scrollTop > 32 || hiddenDialogMessagesCount > 0 || !threadHasMore[currentConversationId]) return;
                    loadOlderDialogMessages();
                  }}
                >
                  {dateSearchMessages && <button type="button" className="chat-pagination-button" onClick={() => setDateSearchMessages(null)}>{isEnglishInterface ? 'Back to conversation' : 'Вернуться в переписку'}</button>}
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
                  {!normalizedDialogSearch && !dateSearchMessages && (hiddenDialogMessagesCount > 0 || threadHasMore[currentConversationId]) && <button type="button" className="chat-pagination-button" disabled={isLoadingOlderDialog} onClick={() => hiddenDialogMessagesCount > 0 ? setVisibleDialogMessageCount((prev) => prev + CHAT_MESSAGES_PAGE_SIZE) : loadOlderDialogMessages()}>{t('loadPreviousMessages')} · {t('showingLatestMessages').replace('{shown}', String(paginatedVisibleMessages.length)).replace('{total}', String(threadHasMore[currentConversationId] ? `${visibleMessages.length}+` : visibleMessages.length))}</button>}
                  {!isCurrentConversationLoading && messagesWithDateSeparators.length === 0 && <div className="empty-chat">{dialogSearch ? t('noMessageSearchResults') : t('noMessages')}</div>}
                  {<VirtualMessageList key={currentConversationId} items={messagesWithDateSeparators} viewportRef={messagesWrapRef} listRef={messageListRef} renderItem={item => <ChatMessageItem item={item} {...messageItemProps} />} />}
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

	                  {replyTo && <div className="reply-preview active-reply">{chatLocalSettings.uiDesign === 'modern' ? <><ChatIcon name="reply" /><span className="reply-preview-content"><strong>{t('replyTo')}: {employeeByLogin.get(String(replyTo.sender || '').toLowerCase())?.full_name || replyTo.sender}</strong><span>{replyTo.text || t('attachmentPlaceholder')}</span></span></> : <>{t('replyTo')}: {replyTo.sender}: {replyTo.text}</>}<button type="button" aria-label={t('cancel')} onClick={() => setReplyTo(null)}>×</button></div>}

                  {chatUploadQueue.length > 0 && (
                    <div className="chat-upload-queue" aria-live="polite">
                      {chatUploadQueue.filter(item => item.conversationId === currentConversationId).map((item) => (
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
                                {isVideoAttachment(file) ? <VideoPosterFrame file={file} alt={file.name} isEnglish={isEnglishInterface} /> : <img src={getAttachmentUrl(file)} alt={file.name} loading="lazy" decoding="async" />}
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
                    modern={chatLocalSettings.uiDesign === 'modern'}
                    isEmojiOpen={isEmojiOpen}
                    enterToSend={chatLocalSettings.enterToSend !== false}
                    isSending={isSendingMessage}
                    hasAttachments={attachmentDrafts.length > 0}
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
          <EmployeeRequestsWorkspace REQUEST_CATEGORIES={REQUEST_CATEGORIES} REQUEST_PRIORITIES={REQUEST_PRIORITIES} RequestTimerMetrics={RequestTimerMetrics} activeApplications={activeApplications} applicationsError={applicationsError} applicationsLoading={applicationsLoading} completedApplications={completedApplications} confirmApplicationDone={confirmApplicationDone} fetchMyApplications={fetchMyApplications} formatApplicationDateTime={formatApplicationDateTime} getApplicationStatusMeta={getApplicationStatusMeta} getApplicationTiming={getApplicationTiming} getRequestCategoryLabel={getRequestCategoryLabel} getRequestPriorityLabel={getRequestPriorityLabel} interfaceLocale={interfaceLocale} isEnglishInterface={isEnglishInterface} localizeRuntimeText={localizeRuntimeText} reopenApplication={reopenApplication} requestCategory={requestCategory} requestPriority={requestPriority} requestStatus={requestStatus} requestText={requestText} setRequestCategory={setRequestCategory} setRequestPriority={setRequestPriority} setRequestText={setRequestText} submitRequest={submitRequest} t={t} />
        )}

        {activeTab === 'feed' && (
          <EmployeeFeedWorkspace AttachmentCard={AttachmentCard} FEED_CATEGORIES={FEED_CATEGORIES} FEED_POSTS_PAGE_SIZE={FEED_POSTS_PAGE_SIZE} FeedComposer={FeedComposer} FeedMediaCard={FeedMediaCard} FeedPostCard={FeedPostCard} REACTION_EMOJIS={REACTION_EMOJIS} addCommentToPost={addCommentToPost} addFeedPost={addFeedPost} avatarUrl={avatarUrl} canManageFeedPost={canManageFeedPost} chatLocalSettings={chatLocalSettings} commentDrafts={commentDrafts} commentSort={commentSort} copyFeedPostLink={copyFeedPostLink} deleteFeedComment={deleteFeedComment} deleteFeedPost={deleteFeedPost} directoryEmployees={directoryEmployees} editingFeedPostId={editingFeedPostId} editingFeedText={editingFeedText} expandedCommentPosts={expandedCommentPosts} feedAttachments={feedAttachments} feedCategory={feedCategory} feedDraft={feedDraft} feedError={feedError} feedHasMore={feedHasMore} feedListRef={feedListRef} feedLoading={feedLoading} feedLoadingMore={feedLoadingMore} feedReactionExpanded={feedReactionExpanded} feedRefreshing={feedRefreshing} feedSearch={feedSearch} fetchFeed={fetchFeed} formatFeedLogin={formatFeedLogin} formatFileSize={formatFileSize} getAttachmentUrl={getAttachmentUrl} getEmployeeAvatar={getEmployeeAvatar} getFeedAttachments={getFeedAttachments} getFeedCategoryLabel={getFeedCategoryLabel} getFileIcon={getFileIcon} getOriginalAttachmentUrl={getOriginalAttachmentUrl} getVideoPosterUrl={getVideoPosterUrl} hiddenFeedPostsCount={hiddenFeedPostsCount} hideFeedPost={hideFeedPost} interfaceLocale={interfaceLocale} isAdmin={isAdmin} isEnglishInterface={isEnglishInterface} isFeedPostPending={isFeedPostPending} isImageAttachment={isImageAttachment} isManager={isManager} isMediaAttachment={isMediaAttachment} isPublishingFeed={isPublishingFeed} isVideoAttachment={isVideoAttachment} loadFeedComments={loadFeedComments} loadMoreFeedPosts={loadMoreFeedPosts} localizeRuntimeText={localizeRuntimeText} nudgeVideoToFirstFrame={nudgeVideoToFirstFrame} onFeedFileChange={onFeedFileChange} openEmployeeProfile={openEmployeeProfile} openFeedMediaViewer={openFeedMediaViewer} openFeedMenuId={openFeedMenuId} paginatedRegularFeedPosts={paginatedRegularFeedPosts} pendingFeedActions={pendingFeedActions} pinnedFeedPosts={pinnedFeedPosts} profileForm={profileForm} quoteFeedPost={quoteFeedPost} regularFeedPosts={regularFeedPosts} removeFeedAttachment={removeFeedAttachment} sameLogin={sameLogin} saveFeedPostEdit={saveFeedPostEdit} selectedFeedPostId={selectedFeedPostId} setCommentDrafts={setCommentDrafts} setEditingFeedPostId={setEditingFeedPostId} setEditingFeedText={setEditingFeedText} setExpandedCommentPosts={setExpandedCommentPosts} setFeedCategory={setFeedCategory} setFeedDraft={setFeedDraft} setFeedReactionExpanded={setFeedReactionExpanded} setFeedSearch={setFeedSearch} setMediaViewer={setMediaViewer} setOpenFeedMenuId={setOpenFeedMenuId} setSelectedFeedPostId={setSelectedFeedPostId} setVisibleFeedPostCount={setVisibleFeedPostCount} shareFeedPostToChat={shareFeedPostToChat} sortComments={sortComments} startEditFeedPost={startEditFeedPost} t={t} toggleFeedPinned={toggleFeedPinned} toggleFeedReaction={toggleFeedReaction} user={user} visibleFeedPosts={visibleFeedPosts} />
        )}

        {activeTab === 'profile' && (
          <EmployeeProfileWorkspace AuthenticatedAvatar={AuthenticatedAvatar} CHAT_DENSITIES={CHAT_DENSITIES} CHAT_TEXT_SIZES={CHAT_TEXT_SIZES} CHAT_THEMES={CHAT_THEMES} ChatAppearanceSettings={ChatAppearanceSettings} DEFAULT_PROFILE_WEBSITE_LANGUAGE={DEFAULT_PROFILE_WEBSITE_LANGUAGE} PROFILE_LANGUAGE_OPTIONS={PROFILE_LANGUAGE_OPTIONS} avatarInputRef={avatarInputRef} avatarUrl={avatarUrl} changeMyPassword={changeMyPassword} chatLocalSettings={chatLocalSettings} formatVisibleLogin={formatVisibleLogin} getOptionLabel={getOptionLabel} getSafeExternalUrl={getSafeExternalUrl} handleLogout={handleLogout} isAdmin={isAdmin} isEnglishInterface={isEnglishInterface} passwordForm={passwordForm} profileForm={profileForm} profilePreview={profilePreview} profileViewLogin={profileViewLogin} receivedArchivesPanel={!isManager && <section className="profile-received-archives received-archives-panel"><h3>{t('receivedArchives')}</h3><p className="received-archives-hint">{t('receivedArchivesHint')}</p><div className="threads-grid archive-grid"><div className="threads-list">{receivedArchiveLoading && receivedArchives.length === 0 && <div className="empty-chat">{t('loading')}…</div>}{!receivedArchiveLoading && receivedArchives.length === 0 && <div className="empty-chat">{t('receivedArchivesEmpty')}</div>}{receivedArchives.map((archive) => <button key={archive.access_id} type="button" className={`thread-item ${String(receivedArchiveAccessId) === String(archive.access_id) ? 'active' : ''}`} onClick={() => setReceivedArchiveAccessId(String(archive.access_id))}><span className="thread-title">{archive.name}</span><span className="thread-stats">{getParticipantsFromThreadId(archive.scope?.conversationId || '').join(' ↔ ')}</span><span className="thread-last">{t('receivedArchiveExpires')}: {archive.expires_at ? new Date(archive.expires_at).toLocaleString(interfaceLocale) : '—'}</span><span className="thread-last">{t('receivedArchiveGrantedBy')}: {archive.granted_by || '—'}</span></button>)}</div><div className="threads-messages archive-message-viewer">{!receivedArchiveAccessId && <div className="empty-chat">{t('receivedArchiveChoose')}</div>}{receivedArchiveAccessId && receivedArchiveHasMore && <button type="button" className="chat-pagination-button" disabled={receivedArchiveLoading} onClick={() => fetchReceivedArchiveMessages(receivedArchiveAccessId, { append: true })}>{t('loadPreviousMessages')}</button>}{receivedArchiveAccessId && receivedArchiveMessages.map((message) => { const attachments = getMessageAttachments(message); return <article key={message.id} className={`audit-message ${message.deletedAt ? 'deleted' : ''}`}><div className="message-meta"><span>{message.sender}</span><span>{new Date(message.createdAt).toLocaleString(interfaceLocale)}</span></div>{message.deletedAt && <em>{t('deletedMessage')}</em>}{message.text && <div className="archive-original-text">{message.text}</div>}{attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${message.id}-received-archive-${index}`} cardKey={`${message.id}-received-archive-${index}`} file={file} variant="archive" isEnglish={isEnglishInterface} />)}</div>}</article>; })}</div></div></section>} removeAvatar={removeAvatar} saveMyProfile={saveMyProfile} setActiveTab={setActiveTab} setPasswordForm={setPasswordForm} setProfileViewLogin={setProfileViewLogin} setSelectedEmail={setSelectedEmail} t={t} toggleDialogToolSetting={toggleDialogToolSetting} toggleFeedToolSetting={toggleFeedToolSetting} updateChatUiSetting={updateChatUiSetting} updateProfileField={updateProfileField} user={user} />
        )}

        {adminSection && activeTab === 'employees' && isAdmin && (
          <ChatEmployeeAdministration deleteEmployee={deleteEmployee} directoryEmployees={directoryEmployees} employeeForm={employeeForm} saveEmployee={saveEmployee} setEmployeeForm={setEmployeeForm} setShowEmployeePassword={setShowEmployeePassword} showEmployeePassword={showEmployeePassword} t={t} />
        )}

        {adminSection && activeTab === 'archive' && isAdmin && (
          <ChatArchiveAdministration AttachmentCard={AttachmentCard} archiveAccessDrafts={archiveAccessDrafts} archiveConversations={archiveConversations} archiveCreating={archiveCreating} archiveFilters={archiveFilters} archiveHasMore={archiveHasMore} archiveLoading={archiveLoading} archiveMessages={archiveMessages} archivePackageName={archivePackageName} archiveSelectedId={archiveSelectedId} createLegalHold={createLegalHold} createRecordsArchive={createRecordsArchive} directoryEmployees={directoryEmployees} downloadRecordsArchive={downloadRecordsArchive} fetchArchiveMessages={fetchArchiveMessages} fetchConversationPurgePreview={fetchConversationPurgePreview} formatFileSize={formatFileSize} formatVisibleLogin={formatVisibleLogin} getMessageAttachments={getMessageAttachments} getParticipantsFromThreadId={getParticipantsFromThreadId} grantRecordsArchiveAccess={grantRecordsArchiveAccess} interfaceLocale={interfaceLocale} isEnglishInterface={isEnglishInterface} legalHoldFilters={legalHoldFilters} legalHoldForm={legalHoldForm} legalHoldLoading={legalHoldLoading} legalHolds={legalHolds} permanentlyDeleteConversation={permanentlyDeleteConversation} purgeHistory={purgeHistory} purgeLoading={purgeLoading} purgePreview={purgePreview} purgeReason={purgeReason} recordsArchives={recordsArchives} releaseLegalHold={releaseLegalHold} revokeRecordsArchiveAccess={revokeRecordsArchiveAccess} sameLogin={sameLogin} setArchiveFilters={setArchiveFilters} setArchivePackageName={setArchivePackageName} setArchiveSelectedId={setArchiveSelectedId} setConversationArchiveState={setConversationArchiveState} setLegalHoldFilters={setLegalHoldFilters} setLegalHoldForm={setLegalHoldForm} setPurgeReason={setPurgeReason} t={t} updateArchiveAccessDraft={updateArchiveAccessDraft} user={user} />
        )}


        {adminSection && activeTab === 'audit' && isAdmin && (
          <ChatAuditAdministration AUDIT_PERIODS={AUDIT_PERIODS} AttachmentCard={AttachmentCard} allConversationIds={allConversationIds} auditFilters={auditFilters} auditSearch={auditSearch} deleteMessage={deleteMessage} editMessage={editMessage} getMessageAttachments={getMessageAttachments} getOptionLabel={getOptionLabel} getParticipantsFromThreadId={getParticipantsFromThreadId} getThreadActivityMeta={getThreadActivityMeta} interfaceLocale={interfaceLocale} isAdmin={isAdmin} isEnglishInterface={isEnglishInterface} loadingConversationIds={loadingConversationIds} selectedThreadId={selectedThreadId} selectedThreadMessages={selectedThreadMessages} setAuditFilters={setAuditFilters} setAuditSearch={setAuditSearch} setSelectedThreadId={setSelectedThreadId} t={t} threadActivityById={threadActivityById} threads={threads} />
        )}
      </section>

      {mediaViewer && (() => {
        const viewerFiles = getViewerFiles();
        const viewerIndex = Math.max(0, viewerFiles.findIndex(file => sameViewerFile(file, mediaViewer.file)));
        const hasManyViewerFiles = viewerFiles.length > 1;
        if (chatLocalSettings.uiDesign === 'modern') {
          const source = mediaViewer.source === 'feed' ? mediaViewer.post : mediaViewer.message;
          const sourceLogin = source?.sender || source?.author;
          return <ModernMediaViewer
            file={mediaViewer.file} files={viewerFiles} index={viewerIndex}
            author={source?.authorName || employeeByLogin.get(String(sourceLogin || '').toLowerCase())?.full_name || sourceLogin}
            date={source?.createdAt ? new Date(source.createdAt).toLocaleString(interfaceLocale) : ''}
            theme={chatLocalSettings.uiTheme} isEnglish={isEnglishInterface} t={t}
            isVideoAttachment={isVideoAttachment} getOriginalAttachmentUrl={getOriginalAttachmentUrl}
            getAttachmentUrl={getAttachmentUrl} getVideoPosterUrl={getVideoPosterUrl} VideoPosterFrame={VideoPosterFrame}
            onClose={() => setMediaViewer(null)} onMove={moveMediaViewer}
            onSelect={index => moveMediaViewer(index - viewerIndex)}
            onReply={mediaViewer.message ? replyToViewedMedia : undefined}
            onShare={mediaViewer.source === 'feed' ? shareViewedFeedMedia : mediaViewer.message ? shareViewedMedia : undefined}
            onDelete={(mediaViewer.source === 'feed' ? canManageFeedPost(mediaViewer.post, user, isManager, isAdmin) : mediaViewer.message && (isManager || mediaViewer.message.sender === user.username)) ? deleteViewedMedia : undefined}
            deletePending={mediaViewer.source === 'feed' && isFeedPostPending(mediaViewer.post?.id)}
          />;
        }
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
          {hasManyViewerFiles && <div className="photo-viewer-thumbs" onMouseDown={(event) => event.stopPropagation()}>{viewerFiles.map((file, index) => <button key={file.id || `${file.name}-${index}`} type="button" className={index === viewerIndex ? 'active' : ''} onClick={() => moveMediaViewer(index - viewerIndex)}>{isVideoAttachment(file) ? <VideoPosterFrame file={file} alt={file.name || t('thumbnailAlt')} isEnglish={isEnglishInterface} /> : <img src={getAttachmentUrl(file)} alt={file.name || t('thumbnailAlt')} loading="lazy" decoding="async" />}</button>)}</div>}
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
            <AuthenticatedAvatar src={avatarUrl} alt={t('profilePhoto')} decoding="async" fallback={<div className="avatar-full-placeholder">{String(baseDisplayName || user?.username || '?').slice(0, 1).toUpperCase()}</div>} />
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
