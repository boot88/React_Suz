import React, { useLayoutEffect, useRef } from 'react';

/*
 * The conversation is already paginated in groups of 50 messages. Keeping the
 * loaded page mounted is more stable than estimating rows with media: an image
 * that finishes loading must not replace spacers or move the user's scroll
 * position. The component keeps the existing imperative jump API used by
 * replies and pinned messages.
 */
export default function VirtualMessageList({ items, viewportRef, listRef, renderItem }) {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    if (!listRef) return undefined;

    listRef.current = {
      scrollToId(id) {
        const root = rootRef.current;
        const viewport = viewportRef.current;
        if (!root || !viewport) return;

        const target = Array.from(root.querySelectorAll('[data-message-id]'))
          .find((node) => node.dataset.messageId === String(id));
        if (!target) return;

        const viewportRect = viewport.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        viewport.scrollTop += targetRect.top - viewportRect.top
          - (viewport.clientHeight - targetRect.height) / 2;
      }
    };

    return () => {
      listRef.current = null;
    };
  }, [listRef, viewportRef]);

  return (
    <div ref={rootRef} className="virtual-message-list">
      {items.map((item) => (
        <div key={item.id} className="virtual-message-row">
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
