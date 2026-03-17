(() => {
  const utils = window.ImagineLabUtils || {};
  const detectMimeType = utils.detectMimeType || ((base64) => {
    try {
      const header = atob(base64.slice(0, 32));
      if (header.startsWith('\x89PNG')) return 'image/png';
      if (header.startsWith('\xff\xd8\xff')) return 'image/jpeg';
      if (header.startsWith('RIFF') && header.includes('WEBP')) return 'image/webp';
    } catch (e) {
      // ignore decode issues and fall back
    }
    return 'image/png';
  });
  const buildImageInfoLines = utils.buildImageInfoLines || ((info) => {
    const image = info || {};
    const lines = [];
    lines.push(image.mime || (image.url ? 'url' : 'unknown format'));
    if (image.width > 0 && image.height > 0) {
      lines.push(`${image.width} x ${image.height}`);
    } else {
      lines.push('dimensions pending');
    }
    lines.push('size unavailable');
    lines.push('time unavailable');
    return lines;
  });
  const formatCreatedAt = utils.formatCreatedAt || (() => 'time unavailable');
  const buildImageInfoText = utils.buildImageInfoText || ((info) => {
    const image = info || {};
    const formatLine = `format: ${image.mime || (image.url ? 'url' : 'unknown format')}`;
    const dimensionLine = image.width > 0 && image.height > 0
      ? `dimensions: ${image.width} x ${image.height}`
      : 'dimensions: pending';
    const payloadLength = String(image.b64 || '').trim().length;
    const payloadLine = payloadLength > 0
      ? `payload: ${payloadLength} chars`
      : (image.url ? `payload: ${image.url}` : 'payload: unavailable');
    return [formatLine, dimensionLine, 'size: unavailable', `time: ${formatCreatedAt(image.createdAt)}`, payloadLine].join('\n');
  });

  const generatePrompt = document.getElementById('generatePrompt');
  const generateSize = document.getElementById('generateSize');
  const generateCount = document.getElementById('generateCount');
  const responseFormat = document.getElementById('responseFormat');
  const generateBtn = document.getElementById('generateBtn');

  const editPrompt = document.getElementById('editPrompt');
  const editSize = document.getElementById('editSize');
  const editCount = document.getElementById('editCount');
  const editImageInput = document.getElementById('editImageInput');
  const editBtn = document.getElementById('editBtn');
  const reuseLastBtn = document.getElementById('reuseLastBtn');
  const clearEditSourceBtn = document.getElementById('clearEditSourceBtn');
  const editSourceLabel = document.getElementById('editSourceLabel');

  const clearResultsBtn = document.getElementById('clearResultsBtn');
  const resultsEmpty = document.getElementById('resultsEmpty');
  const resultsGrid = document.getElementById('resultsGrid');

  const statusBadge = document.getElementById('statusBadge');
  const lastActionValue = document.getElementById('lastActionValue');
  const imageCountValue = document.getElementById('imageCountValue');
  const payloadSizeValue = document.getElementById('payloadSizeValue');
  const elapsedValue = document.getElementById('elapsedValue');

  const requestJson = document.getElementById('requestJson');
  const responseJson = document.getElementById('responseJson');
  const errorJson = document.getElementById('errorJson');

  let currentEditFile = null;
  let lastGeneratedAsset = null;
  let isRunning = false;

  function toast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    }
  }

  function setStatus(state, label) {
    if (!statusBadge) return;
    statusBadge.className = `status-badge ${state}`;
    statusBadge.textContent = label;
  }

  function setRunning(running) {
    isRunning = running;
    if (generateBtn) generateBtn.disabled = running;
    if (editBtn) editBtn.disabled = running;
  }

  function setJson(el, value) {
    if (!el) return;
    const next = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    el.textContent = next;
  }

  function resetError() {
    setJson(errorJson, 'No errors');
  }

  function clearResults() {
    if (resultsGrid) {
      resultsGrid.innerHTML = '';
    }
    if (resultsEmpty) {
      resultsEmpty.classList.remove('hidden');
    }
    imageCountValue.textContent = '0';
    payloadSizeValue.textContent = '0 chars';
    lastGeneratedAsset = null;
    updateEditSourceLabel();
  }

  function formatElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '-';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  }

  function ensureDataImageSource(item) {
    if (!item || typeof item !== 'object') return { src: '', meta: 'empty item' };

    if (typeof item.url === 'string' && item.url.trim()) {
      return {
        src: item.url.trim(),
        meta: 'url',
        url: item.url.trim(),
        infoLines: buildImageInfoLines({ url: item.url.trim(), createdAt: 0 }),
      };
    }

    const encoded = typeof item.b64_json === 'string' && item.b64_json
      ? item.b64_json
      : (typeof item.base64 === 'string' ? item.base64 : '');
    if (!encoded) {
      return { src: '', meta: 'missing image field' };
    }

    const mime = detectMimeType(encoded);
    return {
      src: `data:${mime};base64,${encoded}`,
      meta: `${mime} · ${encoded.length} chars`,
      b64: encoded,
      mime,
      infoLines: buildImageInfoLines({ mime, b64: encoded, createdAt: 0 }),
    };
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  function renderResults(action, response) {
    const items = Array.isArray(response && response.data) ? response.data : [];
    const createdAt = response && response.created ? Number(response.created) : Math.floor(Date.now() / 1000);
    if (resultsGrid) {
      resultsGrid.innerHTML = '';
    }
    if (resultsEmpty) {
      resultsEmpty.classList.toggle('hidden', items.length > 0);
    }

    items.forEach((item, index) => {
      const normalized = ensureDataImageSource(item);
      const imageInfo = {
        mime: normalized.mime || '',
        b64: normalized.b64 || '',
        url: normalized.url || '',
        width: 0,
        height: 0,
        createdAt,
      };
      const card = document.createElement('article');
      card.className = 'result-card';

      const frame = document.createElement('div');
      frame.className = 'result-frame';

      if (normalized.src) {
        const img = document.createElement('img');
        img.src = normalized.src;
        img.alt = `${action} ${index + 1}`;
        frame.appendChild(img);
      }

      const meta = document.createElement('div');
      meta.className = 'result-meta';

      const title = document.createElement('div');
      title.className = 'result-title';
      title.textContent = `${action} #${index + 1}`;

      const detail = document.createElement('div');
      detail.className = 'result-detail';
      setDetailLines(detail, buildImageInfoLines(imageInfo), normalized.meta);

      const actions = document.createElement('div');
      actions.className = 'result-actions';

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'geist-button-outline result-action';
      downloadBtn.type = 'button';
      downloadBtn.textContent = '下载';
      downloadBtn.disabled = !normalized.src;
      downloadBtn.addEventListener('click', () => {
        downloadImage(normalized, action, index);
      });

      const copyBtn = document.createElement('button');
      copyBtn.className = 'geist-button-outline result-action';
      copyBtn.type = 'button';
      copyBtn.textContent = '复制信息';
      copyBtn.addEventListener('click', async () => {
        await copyImageInfo(imageInfo);
      });

      actions.appendChild(downloadBtn);
      actions.appendChild(copyBtn);

      meta.appendChild(title);
      meta.appendChild(detail);
      meta.appendChild(actions);
      card.appendChild(frame);
      card.appendChild(meta);
      resultsGrid.appendChild(card);

      if (frame.firstChild && frame.firstChild.tagName === 'IMG') {
        const img = frame.firstChild;
        img.addEventListener('load', () => {
          imageInfo.width = img.naturalWidth;
          imageInfo.height = img.naturalHeight;
          const nextLines = buildImageInfoLines({
            mime: normalized.mime,
            b64: normalized.b64,
            url: normalized.url,
            width: imageInfo.width,
            height: imageInfo.height,
            createdAt: imageInfo.createdAt,
          });
          setDetailLines(detail, nextLines, normalized.meta);
        }, { once: true });
      }

      if (index === 0 && normalized.b64) {
        lastGeneratedAsset = {
          base64: normalized.b64,
          mime: normalized.mime,
          blob: base64ToBlob(normalized.b64, normalized.mime),
        };
      }
    });

    imageCountValue.textContent = String(items.length);
    const firstItem = items[0];
    const firstSize = firstItem && typeof firstItem.b64_json === 'string'
      ? firstItem.b64_json.length
      : (firstItem && typeof firstItem.base64 === 'string' ? firstItem.base64.length : 0);
    payloadSizeValue.textContent = `${firstSize} chars`;
    scrollResultsIntoView();
  }

  function setDetailLines(el, lines, fallback) {
    if (!el) return;
    el.innerHTML = '';
    const values = Array.isArray(lines) && lines.length ? lines : [fallback || 'unknown payload'];
    values.forEach((line) => {
      const row = document.createElement('div');
      row.textContent = line;
      el.appendChild(row);
    });
  }

  function downloadImage(normalized, action, index) {
    if (!normalized || !normalized.src) return;
    const link = document.createElement('a');
    link.href = normalized.src;
    const ext = extensionFromMime(normalized.mime);
    link.download = `imagine-lab-${action}-${index + 1}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copyImageInfo(imageInfo) {
    const text = buildImageInfoText(imageInfo);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      toast('图片信息已复制', 'success');
    } catch (error) {
      toast('复制失败，请手动复制。', 'error');
    }
  }

  function scrollResultsIntoView() {
    const target = resultsGrid && resultsGrid.children.length > 0 ? resultsGrid : resultsEmpty;
    if (!target || typeof target.scrollIntoView !== 'function') return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function updateEditSourceLabel() {
    if (!editSourceLabel) return;
    if (currentEditFile) {
      editSourceLabel.textContent = `已选择: ${currentEditFile.name}`;
      return;
    }
    if (lastGeneratedAsset) {
      editSourceLabel.textContent = '当前使用上一张生成结果';
      return;
    }
    editSourceLabel.textContent = '当前未选择参考图';
  }

  async function ensureFunctionAuthorization() {
    const apiKey = await ensureFunctionKey();
    if (apiKey === null) {
      toast('Function key 无效，请重新登录。', 'error');
      window.location.href = '/login';
      throw new Error('Function key unavailable');
    }
    return apiKey;
  }

  async function runRequest(action, requestBuilder) {
    if (isRunning) return;

    const startedAt = Date.now();
    setRunning(true);
    setStatus('running', 'Running');
    lastActionValue.textContent = action;
    resetError();

    try {
      const apiKey = await ensureFunctionAuthorization();
      const { requestInfo, fetchOptions } = await requestBuilder(apiKey);
      setJson(requestJson, requestInfo);

      const response = await fetch(fetchOptions.url, fetchOptions.options);
      const payload = await response.json().catch(() => ({}));
      setJson(responseJson, payload);

      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.detail || `HTTP ${response.status}`);
      }

      renderResults(action, payload);
      setStatus('success', 'Success');
      toast(`${action} completed`, 'success');
    } catch (error) {
      setStatus('error', 'Error');
      setJson(errorJson, {
        message: error instanceof Error ? error.message : String(error),
      });
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      elapsedValue.textContent = formatElapsed(Date.now() - startedAt);
      updateEditSourceLabel();
      setRunning(false);
    }
  }

  async function buildGenerationRequest(apiKey) {
    const payload = {
      model: 'grok-imagine-1.0',
      prompt: (generatePrompt?.value || '').trim(),
      size: generateSize?.value || '1024x1024',
      n: Number(generateCount?.value || 1),
      response_format: responseFormat?.value || 'b64_json',
      stream: false,
      return_all_candidates: true,
    };

    if (!payload.prompt) {
      throw new Error('生成提示词不能为空');
    }

    return {
      requestInfo: payload,
      fetchOptions: {
        url: '/v1/function/images/generations',
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildAuthHeaders(apiKey),
          },
          body: JSON.stringify(payload),
        },
      },
    };
  }

  async function buildEditRequest(apiKey) {
    const prompt = (editPrompt?.value || '').trim();
    if (!prompt) {
      throw new Error('编辑提示词不能为空');
    }

    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model', 'grok-imagine-1.0-edit');
    formData.append('size', editSize?.value || '1024x1024');
    formData.append('n', String(Number(editCount?.value || 1)));
    formData.append('response_format', responseFormat?.value || 'b64_json');
    formData.append('stream', 'false');
    formData.append('return_all_candidates', 'true');

    let requestImageInfo = 'none';
    if (currentEditFile) {
      formData.append('image', currentEditFile, currentEditFile.name);
      requestImageInfo = currentEditFile.name;
    } else if (lastGeneratedAsset?.blob) {
      const filename = `imagine-lab-source.${extensionFromMime(lastGeneratedAsset.mime)}`;
      formData.append('image', lastGeneratedAsset.blob, filename);
      requestImageInfo = filename;
    } else {
      throw new Error('编辑模式需要上传参考图，或先生成一张图后点击“复用上一张结果”。');
    }

    return {
      requestInfo: {
        prompt,
        model: 'grok-imagine-1.0-edit',
        size: editSize?.value || '1024x1024',
        n: Number(editCount?.value || 1),
        response_format: responseFormat?.value || 'b64_json',
        stream: false,
        return_all_candidates: true,
        image: requestImageInfo,
      },
      fetchOptions: {
        url: '/v1/function/images/edits',
        options: {
          method: 'POST',
          headers: buildAuthHeaders(apiKey),
          body: formData,
        },
      },
    };
  }

  function extensionFromMime(mime) {
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    return 'png';
  }

  function handleFileChange() {
    const file = editImageInput?.files && editImageInput.files[0] ? editImageInput.files[0] : null;
    currentEditFile = file;
    updateEditSourceLabel();
  }

  function reuseLastResult() {
    if (!lastGeneratedAsset) {
      toast('当前没有可复用的生成结果。', 'error');
      return;
    }
    currentEditFile = null;
    if (editImageInput) {
      editImageInput.value = '';
    }
    updateEditSourceLabel();
    toast('已切换为使用上一张生成结果。', 'success');
  }

  function clearEditSource() {
    currentEditFile = null;
    if (editImageInput) {
      editImageInput.value = '';
    }
    updateEditSourceLabel();
  }

  function init() {
    clearResults();
    updateEditSourceLabel();
    setStatus('idle', 'Idle');
    setJson(requestJson, {});
    setJson(responseJson, {});
    resetError();

    if (generatePrompt) {
      generatePrompt.value = 'cinematic still of a glass observatory suspended above the ocean, golden sunrise, ultra detailed';
    }
    if (editPrompt) {
      editPrompt.value = 'keep the composition, convert it into a premium editorial poster with warm shadows and subtle film grain';
    }

    generateBtn?.addEventListener('click', () => runRequest('generate', buildGenerationRequest));
    editBtn?.addEventListener('click', () => runRequest('edit', buildEditRequest));
    clearResultsBtn?.addEventListener('click', clearResults);
    editImageInput?.addEventListener('change', handleFileChange);
    reuseLastBtn?.addEventListener('click', reuseLastResult);
    clearEditSourceBtn?.addEventListener('click', clearEditSource);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
