const key = username => `chat-feed-operations:${username}`;
export const readChatOperationIds = username => {
  try {
    const data = JSON.parse(localStorage.getItem(key(username)) || '{}');
    return { feed: data.feed || null, comments: data.comments || {} };
  } catch { return { feed: null, comments: {} }; }
};
export const saveChatOperationIds = (username, operations) => {
  try { localStorage.setItem(key(username), JSON.stringify(operations)); return true; }
  catch { return false; }
};
