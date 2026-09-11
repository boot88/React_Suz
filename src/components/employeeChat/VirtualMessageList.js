import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const MeasuredRow = ({ item, onMeasure, children }) => {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    const measure = () => onMeasure(item.id, node.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [item.id, onMeasure]);
  return <div ref={ref} className="virtual-message-row">{children}</div>;
};

export default function VirtualMessageList({ items, viewportRef, listRef, renderItem }) {
  const root = useRef(null);
  const heights = useRef(new Map());
  const frame = useRef(null);
  const previous = useRef(null);
  const [measurements, setMeasurements] = useState(new Map());
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const measure = useCallback((id, height) => {
    if (!height || Math.abs((heights.current.get(id) || 0) - height) < 1) return;
    heights.current.set(id, height);
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = null; setMeasurements(new Map(heights.current)); });
  }, []);
  const offsets = useMemo(() => {
    const result = [0];
    items.forEach(item => result.push(result[result.length - 1] + (measurements.get(item.id) || (item.type === 'date' ? 40 : 130))));
    return result;
  }, [items, measurements]);
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    let raf;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const listOffset = root.current ? root.current.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop : 0;
        setViewport({ top: Math.max(0, node.scrollTop - listOffset), height: node.clientHeight });
      });
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(node);
    return () => { cancelAnimationFrame(raf); node.removeEventListener('scroll', update); observer?.disconnect(); };
  }, [viewportRef]);
  useLayoutEffect(() => {
    const node = viewportRef.current;
    const old = previous.current;
    if (node && old && old.items.length && items.length && old.offsets !== offsets) {
      const currentDistanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      const wasNearBottom = old.offsets[old.items.length] - (old.top + old.height) < 100;
      if (wasNearBottom && currentDistanceFromBottom < 100 && old.items[0].id === items[0].id) {
        node.scrollTop = node.scrollHeight;
      } else {
        let anchor = 0;
        while (anchor + 1 < old.items.length && old.offsets[anchor + 1] <= old.top) anchor += 1;
        const newIndex = items.findIndex(item => item.id === old.items[anchor].id);
        if (newIndex >= 0 && root.current) {
          const listOffset = root.current.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
          node.scrollTop = listOffset + offsets[newIndex] + old.top - old.offsets[anchor];
        }
      }
    }
    previous.current = { items, offsets, top: viewport.top, height: viewport.height };
    if (listRef) listRef.current = {
      scrollToId(id) {
        const index = items.findIndex(item => item.id === id);
        if (index < 0 || !node || !root.current) return;
        const listOffset = root.current.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
        node.scrollTop = listOffset + offsets[index];
        setViewport({ top: offsets[index], height: node.clientHeight });
      }
    };
  }, [items, offsets, listRef, viewportRef, viewport.top, viewport.height]);
  useLayoutEffect(() => () => { cancelAnimationFrame(frame.current); if (listRef) listRef.current = null; }, [listRef]);
  let start = 0;
  while (start < items.length && offsets[start + 1] < viewport.top - 800) start += 1;
  let end = start;
  while (end < items.length && offsets[end] < viewport.top + viewport.height + 800) end += 1;
  return <div ref={root} className="virtual-message-list">
    <div aria-hidden="true" style={{ height: offsets[start] || 0 }} />
    {items.slice(start, end).map(item => <MeasuredRow key={item.id} item={item} onMeasure={measure}>{renderItem(item)}</MeasuredRow>)}
    <div aria-hidden="true" style={{ height: Math.max(0, offsets[items.length] - offsets[end]) }} />
  </div>;
}
