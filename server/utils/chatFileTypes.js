const path = require('path');
const BINARY_TYPE = 'application/octet-stream';
const INLINE_MEDIA_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/webm'
]);
const EXTENSION_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
  '.gz': 'application/gzip', '.tar': 'application/x-tar', '.bz2': 'application/x-bzip2', '.xz': 'application/x-xz'
};
const ACTIVE_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xhtml', '.xml', '.js', '.mjs']);
const normalizeMime = (value) => {
  const mime = String(value || '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) && mime.length <= 255 ? mime : BINARY_TYPE;
};
const isInlineMediaType = (mime) => INLINE_MEDIA_TYPES.has(normalizeMime(mime));
const hasImageSignature = (head, mime) => {
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return head.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};

// Any extension is accepted. Unrecognized and active formats are ordinary
// downloadable files; only supported media are eligible for browser previews.
const getUploadMime = (name, reportedMime, head) => {
  const ext = path.extname(String(name || '')).toLowerCase();
  let mime = normalizeMime(reportedMime);
  if (mime === BINARY_TYPE) mime = EXTENSION_TYPES[ext] || mime;
  if (ACTIVE_EXTENSIONS.has(ext)) return BINARY_TYPE;
  if (mime.startsWith('image/')) return INLINE_MEDIA_TYPES.has(mime) && hasImageSignature(head, mime) ? mime : BINARY_TYPE;
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return INLINE_MEDIA_TYPES.has(mime) ? mime : BINARY_TYPE;
  if (['text/html', 'application/xhtml+xml', 'application/xml', 'text/xml', 'application/javascript', 'text/javascript'].includes(mime)) return BINARY_TYPE;
  return mime;
};

const getDownloadHeaders = (mime, forceDownload = false) => {
  const type = normalizeMime(mime);
  const inline = !forceDownload && isInlineMediaType(type);
  return { type: inline ? type : BINARY_TYPE, disposition: inline ? 'inline' : 'attachment' };
};

module.exports = { getUploadMime, getDownloadHeaders };
