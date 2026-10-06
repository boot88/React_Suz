import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

// Keep all loaded records, but mount only the rows around the viewport. Heights
// are measured by ID so images and prepended pages keep a stable scroll anchor.
export default function VirtualMessageList({ items, viewportRef, listRef, renderItem, onMissingMessage }) {
  const rootRef = useRef(null);
  const heightsRef = useRef(new Map());
  const jumpRef = useRef('');
  const latestRef = useRef({ items, onMissingMessage });
  latestRef.current = { items, onMissingMessage };
  const [view, setView] = useState({ top: 0, height: 800 });
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const offsets = useMemo(() => {
    // Reading the version invalidates cached offsets after ResizeObserver.
    void measurementVersion;
    const result = [0];
    items.forEach(item => result.push(result[result.length - 1] + (heightsRef.current.get(item.id) || (item.type === 'date' ? 42 : 120))));
    return result;
  }, [items, measurementVersion]);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  let start = 0;
  while (start < items.length && offsets[start + 1] < view.top - 1000) start += 1;
  let end = start;
  while (end < items.length && offsets[end] < view.top + view.height + 1000) end += 1;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const update = () => {
      const origin = rootRef.current.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
      setView({ top: Math.max(0, viewport.scrollTop - origin), height: viewport.clientHeight });
    };
    viewport.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => { viewport.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [viewportRef]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const root = rootRef.current;
    const measure = entries => {
      let adjustment = 0;
      let changed = false;
      entries.forEach(entry => {
        const id = entry.target.dataset.rowId;
        const height = entry.target.getBoundingClientRect().height;
        if (!height) return;
        const index = latestRef.current.items.findIndex(item => item.id === id);
        if (index < 0) return;
        const old = heightsRef.current.get(id) || (latestRef.current.items[index].type === 'date' ? 42 : 120);
        if (Math.abs(old - height) < 1) return;
        if (entry.target.getBoundingClientRect().bottom < viewport.getBoundingClientRect().top) adjustment += height - old;
        heightsRef.current.set(id, height);
        changed = true;
      });
      if (changed) { viewport.scrollTop += adjustment; setMeasurementVersion(version => version + 1); }
    };
    const rows = [...root.querySelectorAll('[data-row-id]')];
    measure(rows.map(target => ({ target })));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    rows.forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [items, start, end, viewportRef]);

  useLayoutEffect(() => {
    if (!listRef) return undefined;
    const scrollToId = id => {
      const index = latestRef.current.items.findIndex(item => String(item.message?.id || item.id) === String(id));
      if (index < 0) { latestRef.current.onMissingMessage?.(id); return; }
      const viewport = viewportRef.current;
      const root = rootRef.current;
      if (!viewport || !root) return;
      const origin = root.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
      viewport.scrollTop = Math.max(0, origin + offsetsRef.current[index] - viewport.clientHeight / 2);
      setView({ top: Math.max(0, offsetsRef.current[index] - viewport.clientHeight / 2), height: viewport.clientHeight });
      jumpRef.current = String(id);
    };
    listRef.current = { scrollToId };
    return () => { listRef.current = null; };
  }, [listRef, viewportRef]);

  useLayoutEffect(() => {
    if (!jumpRef.current) return;
    const target = [...rootRef.current.querySelectorAll('[data-message-id]')].find(node => node.dataset.messageId === jumpRef.current);
    if (!target) return;
    const viewport = viewportRef.current;
    viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (viewport.clientHeight - target.getBoundingClientRect().height) / 2;
    jumpRef.current = '';
  }, [items, start, end, measurementVersion, viewportRef]);

  return <div ref={rootRef} className="virtual-message-list" style={{ overflowAnchor: 'none' }}>
    <div aria-hidden="true" style={{ height: offsets[start] }} />
    {items.slice(start, end).map(item => <div key={item.id} data-row-id={item.id} className="virtual-message-row" style={{ display: 'flow-root' }}>{renderItem(item)}</div>)}
    <div aria-hidden="true" style={{ height: offsets[items.length] - offsets[end] }} />
  </div>;
}
