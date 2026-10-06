import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import VirtualMessageList from './VirtualMessageList';

global.IS_REACT_ACT_ENVIRONMENT = true;

test('mounts a bounded window and can jump to an unmounted message', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const viewportRef = { current: container };
  const listRef = { current: null };
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  const root = createRoot(container);
  const items = Array.from({ length: 2000 }, (_, index) => ({ id: `m${index}`, message: { id: `m${index}` } }));
  // This renders with ReactDOM directly; no Testing Library render helper.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  act(() => root.render(<VirtualMessageList items={items} viewportRef={viewportRef} listRef={listRef} renderItem={item => <div data-message-id={item.id}>Message</div>} />));
  expect(container.querySelectorAll('[data-message-id]').length).toBeLessThan(50);
  act(() => listRef.current.scrollToId('m1500'));
  expect(container.querySelector('[data-message-id="m1500"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-message-id]').length).toBeLessThan(50);
  act(() => root.unmount());
  container.remove();
});
