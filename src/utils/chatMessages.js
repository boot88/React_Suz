export const compareMessages = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a.id).localeCompare(String(b.id));
const version = message => new Date(message.updatedAt || message.editedAt || message.deletedAt || message.createdAt || 0).getTime();
export const mergeMessages = (current = [], incoming = []) => {
  const byId = new Map(current.map(message => [message.id, message]));
  incoming.forEach(message => {
    const previous = byId.get(message.id);
    if (!previous || previous.deliveryStatus === 'waiting' || previous.deliveryStatus === 'sending' || previous.deliveryStatus === 'error' || version(message) >= version(previous)) {
      byId.set(message.id, { ...previous, ...message });
    }
  });
  return [...byId.values()].sort(compareMessages);
};

export const isMessageRead = (message, peerRead) => {
  if (!peerRead?.messageId) return Boolean(message.readAt);
  return compareMessages(message, { id: peerRead.messageId, createdAt: peerRead.createdAt }) <= 0;
};
