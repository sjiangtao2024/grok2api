(function (globalScope) {
  function detectMimeType(base64) {
    try {
      const header = atob(base64.slice(0, 32));
      if (header.startsWith('\x89PNG')) return 'image/png';
      if (header.startsWith('\xff\xd8\xff')) return 'image/jpeg';
      if (header.startsWith('RIFF') && header.includes('WEBP')) return 'image/webp';
    } catch (e) {
      // Ignore decode errors and fall back to png.
    }
    return 'image/png';
  }

  function estimateBase64Bytes(base64) {
    const value = String(base64 || '').trim();
    if (!value) return 0;
    const padding = value.endsWith('==') ? 2 : (value.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return 'size unavailable';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatCreatedAt(createdAt) {
    const raw = Number(createdAt);
    if (!Number.isFinite(raw) || raw <= 0) return 'time unavailable';
    const date = new Date(raw * 1000);
    const parts = [
      String(date.getFullYear()).padStart(4, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ];
    const time = [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ];
    return `${parts.join('-')} ${time.join(':')}`;
  }

  function buildImageInfoLines(info) {
    const image = info || {};
    const lines = [];

    lines.push(image.mime || (image.url ? 'url' : 'unknown format'));

    if (image.width > 0 && image.height > 0) {
      lines.push(`${image.width} x ${image.height}`);
    } else {
      lines.push('dimensions pending');
    }

    const estimatedBytes = estimateBase64Bytes(image.b64);
    lines.push(formatBytes(estimatedBytes));
    lines.push(formatCreatedAt(image.createdAt));
    return lines;
  }

  function buildImageInfoText(info) {
    const image = info || {};
    const formatLine = `format: ${image.mime || (image.url ? 'url' : 'unknown format')}`;
    const dimensionLine = image.width > 0 && image.height > 0
      ? `dimensions: ${image.width} x ${image.height}`
      : 'dimensions: pending';
    const sizeLine = `size: ${formatBytes(estimateBase64Bytes(image.b64))}`;
    const timeLine = `time: ${formatCreatedAt(image.createdAt)}`;
    const payloadLength = String(image.b64 || '').trim().length;
    const payloadLine = payloadLength > 0
      ? `payload: ${payloadLength} chars`
      : (image.url ? `payload: ${image.url}` : 'payload: unavailable');
    return [formatLine, dimensionLine, sizeLine, timeLine, payloadLine].join('\n');
  }

  const api = {
    detectMimeType,
    estimateBase64Bytes,
    formatBytes,
    formatCreatedAt,
    buildImageInfoLines,
    buildImageInfoText,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.ImagineLabUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
