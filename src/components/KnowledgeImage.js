import React, { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL } from '../utils/apiConfig';

export default function KnowledgeImage({ image, onOpen, ...props }) {
  const [source, setSource] = useState(image.data || '');
  useEffect(() => {
    if (image.data || !image.url) { setSource(image.data || ''); return undefined; }
    const controller = new AbortController();
    let url;
    const endpoint = `${API_BASE_URL}${image.url.replace(/^\/api/, '')}`;
    authFetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Image unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSource(url);
    }).catch(() => {});
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [image.data, image.url]);
  return source ? <img alt={props.alt || image.name || ""} {...props} src={source} onClick={() => onOpen?.({ ...image, data: source })} loading="lazy" /> : <span role="status">…</span>;
}
