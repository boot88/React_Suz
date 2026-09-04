import React, { memo, useEffect, useState } from 'react';
import { authFetch } from '../../utils/authFetch';

const avatarCache = new Map();

const removeQueryTokens = (source = '') => {
  try {
    const isAbsolute = /^https?:\/\//i.test(source);
    const parsed = new URL(source, window.location.origin);
    parsed.searchParams.delete('access_token');
    parsed.searchParams.delete('mt');
    return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return source;
  }
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Avatar read failed'));
  reader.readAsDataURL(blob);
});

const loadAvatar = (source) => {
  if (!source || source.startsWith('data:') || source.startsWith('blob:')) {
    return Promise.resolve(source || '');
  }

  const requestUrl = removeQueryTokens(source);
  const cached = avatarCache.get(requestUrl);
  if (cached) return cached instanceof Promise ? cached : Promise.resolve(cached);

  const request = authFetch(requestUrl, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Avatar request failed: ${response.status}`);
      const blob = await response.blob();
      if (!String(blob.type || '').startsWith('image/')) throw new Error('Avatar response is not an image');
      return blobToDataUrl(blob);
    })
    .then((dataUrl) => {
      avatarCache.set(requestUrl, dataUrl);
      return dataUrl;
    })
    .catch((error) => {
      avatarCache.delete(requestUrl);
      throw error;
    });

  avatarCache.set(requestUrl, request);
  return request;
};

const AuthenticatedAvatar = memo(function AuthenticatedAvatar({ src = '', alt = '', fallback = null, onError, ...imageProps }) {
  const [displaySource, setDisplaySource] = useState(() => (
    src.startsWith('data:') || src.startsWith('blob:') ? src : ''
  ));

  useEffect(() => {
    let active = true;
    setDisplaySource(src.startsWith('data:') || src.startsWith('blob:') ? src : '');
    if (!src) return () => { active = false; };

    loadAvatar(src)
      .then((dataUrl) => {
        if (active) setDisplaySource(dataUrl);
      })
      .catch(() => {
        if (active) setDisplaySource('');
      });

    return () => { active = false; };
  }, [src]);

  if (!displaySource) return fallback;

  return (
    <img
      {...imageProps}
      src={displaySource}
      alt={alt}
      onError={(event) => {
        setDisplaySource('');
        onError?.(event);
      }}
    />
  );
});

export default AuthenticatedAvatar;
