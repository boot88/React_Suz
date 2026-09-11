import React from 'react';

const paths = {
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  reply: <><path d="m9 5-6 6 6 6" /><path d="M3 11h10a8 8 0 0 1 8 8" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  forward: <><path d="m15 5 6 6-6 6" /><path d="M21 11H11a8 8 0 0 0-8 8" /></>,
  pin: <><path d="m9 3 12 12-5 1-4 4-8-8 4-4 1-5ZM8 16l-5 5" /></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z" /></>,
  delete: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  left: <path d="m15 5-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1 3 4 3 4-3 4-3M8 9h.01M16 9h.01" /></>,
  send: <><path d="m3 3 18 9-18 9 4-9-4-9ZM7 12h14" /></>,
  check: <path d="m5 12 4 4L19 6" />,
};

export default function ChatIcon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] || paths.more}</svg>;
}
