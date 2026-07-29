import React, { memo } from 'react';

const ChatLoadingOverlay = memo(function ChatLoadingOverlay({ label }) {
  return (
    <div className="chat-loading-overlay" role="status" aria-live="polite">
      <div className="chat-loading-card">
        <span className="chat-loading-spinner" aria-hidden="true" />
        <strong>{label}…</strong>
      </div>
    </div>
  );
});

export default ChatLoadingOverlay;
