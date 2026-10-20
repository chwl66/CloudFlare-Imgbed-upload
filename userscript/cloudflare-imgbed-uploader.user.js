// ==UserScript==
// @name         CloudFlare ImgBed 上传器（油猴版）
// @namespace    https://github.com/chwl66/CloudFlare-Imgbed-upload
// @version      1.1.0
// @description  把网页图片 / 剪贴板图片 / 本地图片上传到自建 CloudFlare ImgBed 图床，支持分块上传、三种复制格式与上传记录
// @author       chwl66
// @homepage     https://github.com/chwl66/CloudFlare-Imgbed-upload
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ==================== 常量 ====================
  const MB = 1024 * 1024;
  const CONFIG_KEY = 'imgbed.config.v1';
  const HISTORY_KEY = 'imgbed.history.v1';
  const HISTORY_MAX = 200;

  const CHANNELS = [
    { value: 'telegram', label: 'Telegram' },
    { value: 'cfr2', label: 'CloudFlare R2' },
    { value: 's3', label: 'S3' },
    { value: 'discord', label: 'Discord' },
    { value: 'huggingface', label: 'Hugging Face' },
    { value: 'webdav', label: 'WebDAV' }
  ];

  // 与上游官方 /upload 接口的 uploadChannel 枚举一致
  const CHANNEL_LIMITS = {
    telegram: 100 * MB,
    cfr2: 100 * MB,
    s3: 100 * MB,
    discord: 100 * MB,
    huggingface: 20 * MB,
    webdav: 100 * MB
  };

  const CHUNKED_CHANNELS = ['telegram', 'cfr2', 's3', 'discord'];
  const CHUNK_SIZE_BY_CHANNEL = {
    telegram: 16 * MB,
    cfr2: 8 * MB,
    s3: 8 * MB,
    discord: 8 * MB
  };
  const CHUNKED_THRESHOLD = 8 * MB;

  const NAME_TYPES = [
    { value: 'default', label: '默认前缀_原名' },
    { value: 'index', label: '仅前缀' },
    { value: 'origin', label: '仅原名' },
    { value: 'short', label: '短链接' }
  ];

  const SOURCE_LABEL = {
    image: '网页图片',
    clipboard: '剪贴板',
    drag: '拖拽',
    unknown: '未知'
  };

  // 配置结构版本，用于老版本配置迁移
  const CONFIG_VERSION = '1.1.0';

  const DEFAULT_CONFIG = {
    configVersion: CONFIG_VERSION,
    apiUrl: '',
    apiToken: '',
    authCode: '',
    uploadChannel: 'telegram',
    channelName: '',
    uploadNameType: 'default',
    returnFormat: 'full',
    uploadFolder: '',
    uploadTimeout: 60000,
    serverCompress: true,
    autoRetry: true,
    enableBadge: true,
    enableImageMenu: true,
    enableDragDrop: true,
    enableShortcut: true
  };

  // ==================== 存储 ====================
  function readStore(key, fallback) {
    try {
      const raw = GM_getValue(key, null);
      if (raw === null || raw === undefined) return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      console.warn('[ImgBed] 读取存储失败:', error);
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      GM_setValue(key, JSON.stringify(value));
    } catch (error) {
      console.warn('[ImgBed] 写入存储失败:', error);
    }
  }

  function compareVersion(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  /**
   * 老版本配置迁移。v1.0.0 的「接管图片右键菜单」默认关闭，
   * 导致绝大多数用户右键图片毫无反应，v1.1.0 起默认开启并强制迁移一次。
   */
  function migrateConfig(raw) {
    const cfg = Object.assign({}, raw || {});
    const from = typeof cfg.configVersion === 'string' ? cfg.configVersion : '1.0.0';

    if (compareVersion(from, '1.1.0') < 0) {
      cfg.enableImageMenu = true;
    }

    cfg.configVersion = CONFIG_VERSION;
    return cfg;
  }

  let config = normalizeConfig(migrateConfig(readStore(CONFIG_KEY, {})));

  function normalizeConfig(input) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, input || {});

    cfg.apiUrl = typeof cfg.apiUrl === 'string' ? cfg.apiUrl.trim().replace(/\/+$/, '') : '';
    cfg.apiToken = typeof cfg.apiToken === 'string' ? cfg.apiToken.trim() : '';
    cfg.authCode = typeof cfg.authCode === 'string' ? cfg.authCode.trim() : '';
    cfg.channelName = typeof cfg.channelName === 'string' ? cfg.channelName.trim() : '';

    cfg.uploadFolder = typeof cfg.uploadFolder === 'string'
      ? cfg.uploadFolder.trim().replace(/\\+/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
      : '';

    if (!CHANNELS.some(item => item.value === cfg.uploadChannel)) cfg.uploadChannel = DEFAULT_CONFIG.uploadChannel;
    if (!NAME_TYPES.some(item => item.value === cfg.uploadNameType)) cfg.uploadNameType = DEFAULT_CONFIG.uploadNameType;
    if (!['default', 'full'].includes(cfg.returnFormat)) cfg.returnFormat = DEFAULT_CONFIG.returnFormat;

    const timeout = Number(cfg.uploadTimeout);
    cfg.uploadTimeout = Number.isFinite(timeout)
      ? Math.max(10000, Math.min(300000, Math.floor(timeout)))
      : DEFAULT_CONFIG.uploadTimeout;

    ['serverCompress', 'autoRetry', 'enableBadge', 'enableImageMenu', 'enableDragDrop', 'enableShortcut']
      .forEach(key => {
        const value = cfg[key];
        cfg[key] = typeof value === 'string' ? value === 'true' : Boolean(value);
      });

    return cfg;
  }

  function saveConfig(patch) {
    config = normalizeConfig(migrateConfig(Object.assign({}, config, patch)));
    writeStore(CONFIG_KEY, config);
    return config;
  }

  function validateConfig(cfg) {
    if (!cfg.apiUrl) return '请填写 API 地址';
    try {
      const url = new URL(cfg.apiUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return 'API 地址必须使用 HTTP 或 HTTPS 协议';
    } catch (error) {
      return 'API 地址格式不正确';
    }
    if (cfg.uploadFolder.includes('..')) return '上传目录不能包含 ..';
    return '';
  }

  // ==================== 工具 ====================
  function getChannelLimit(channel) {
    return CHANNEL_LIMITS[channel] || CHANNEL_LIMITS.telegram;
  }

  function getChunkSize(channel) {
    return CHUNK_SIZE_BY_CHANNEL[channel] || CHUNKED_THRESHOLD;
  }

  function supportsChunked(channel) {
    return CHUNKED_CHANNELS.includes(channel);
  }

  function formatSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return '未知大小';
    if (size < 1024) return size + 'B';
    if (size < MB) return (size / 1024).toFixed(1) + 'KB';
    return (size / MB).toFixed(1) + 'MB';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(text, max) {
    const value = String(text || '');
    const limit = max || 56;
    if (value.length <= limit) return value;
    return value.slice(0, 30) + '...' + value.slice(-20);
  }

  function fileNameFromUrl(url, fallback) {
    try {
      const name = new URL(url, location.href).pathname.split('/').pop();
      if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name;
    } catch (error) {
      // 忽略解析失败
    }
    return fallback || 'image.jpg';
  }

  function friendlyStatus(status) {
    const map = {
      400: '请求参数错误（400）',
      401: '认证失败（401），请检查 API Token 或认证码',
      403: '访问被拒绝（403），请检查权限设置',
      404: 'API 地址不存在（404），请检查地址是否正确',
      413: '文件过大（413），请换用支持分块上传的渠道',
      429: '请求过于频繁（429）',
      500: '服务器内部错误（500）',
      502: '网关错误（502），服务可能正在重启',
      503: '服务不可用（503）',
      504: '网关超时（504）'
    };
    return map[status] || ('请求失败（' + status + '）');
  }

  // ==================== 网络（GM_xmlhttpRequest 绕过 CORS） ====================
  function gmRequest(options) {
    const {
      url,
      method = 'GET',
      headers = {},
      data = null,
      responseType = 'json',
      timeout = 60000,
      onprogress = null
    } = options;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        timeout,
        responseType,
        onprogress,
        onload: resolve,
        onerror: () => reject(new Error('网络请求失败，请检查地址、网络或 @connect 授权')),
        ontimeout: () => reject(new Error('请求超时（' + Math.round(timeout / 1000) + ' 秒）')),
        onabort: () => reject(new Error('请求已取消'))
      });
    });
  }

  function parseJson(res) {
    const body = res.response;
    if (body && typeof body === 'object' && !(body instanceof Blob)) return body;
    try {
      return JSON.parse(res.responseText || '');
    } catch (error) {
      return null;
    }
  }

  function authHeaders(cfg) {
    const headers = {};
    if (cfg.apiToken) headers.Authorization = 'Bearer ' + cfg.apiToken;
    return headers;
  }

  function buildUploadUrl(cfg, extra) {
    const params = new URLSearchParams({
      serverCompress: String(cfg.serverCompress),
      uploadChannel: cfg.uploadChannel,
      autoRetry: String(cfg.autoRetry),
      uploadNameType: cfg.uploadNameType,
      returnFormat: cfg.returnFormat
    });

    if (cfg.authCode) params.append('authCode', cfg.authCode);
    if (cfg.channelName) params.append('channelName', cfg.channelName);
    if (cfg.uploadFolder) params.append('uploadFolder', cfg.uploadFolder);

    Object.keys(extra || {}).forEach(key => {
      const value = extra[key];
      if (value !== undefined && value !== null) params.append(key, String(value));
    });

    return cfg.apiUrl.replace(/\/+$/, '') + '/upload?' + params.toString();
  }

  function buildChunkedUrl(cfg, extra) {
    const params = new URLSearchParams({ uploadChannel: cfg.uploadChannel });
    if (cfg.channelName) params.append('channelName', cfg.channelName);
    if (cfg.authCode) params.append('authCode', cfg.authCode);

    Object.keys(extra || {}).forEach(key => {
      const value = extra[key];
      if (value !== undefined && value !== null) params.append(key, String(value));
    });

    return cfg.apiUrl.replace(/\/+$/, '') + '/upload?' + params.toString();
  }

  // ==================== 上传 ====================
  function processUploadResponse(res, cfg) {
    if (res.status < 200 || res.status >= 300) {
      throw new Error(friendlyStatus(res.status));
    }

    const data = parseJson(res);
    if (!Array.isArray(data) || !data.length || !data[0] || !data[0].src) {
      throw new Error('服务器返回格式异常，未拿到图片链接');
    }

    // publicUrl 由「默认 URL 前缀」拼接，域名通常与站点不同，必须原样保留
    let imageUrl = data[0].publicUrl || data[0].src;
    if (typeof imageUrl === 'string' && imageUrl.charAt(0) === '/') {
      imageUrl = cfg.apiUrl.replace(/\/+$/, '') + imageUrl;
    }

    return { url: imageUrl };
  }

  async function uploadSingle(cfg, blob, fileName, progress) {
    const formData = new FormData();
    formData.append('file', blob, fileName);

    const res = await gmRequest({
      url: buildUploadUrl(cfg),
      method: 'POST',
      headers: authHeaders(cfg),
      data: formData,
      responseType: 'json',
      timeout: cfg.uploadTimeout,
      onprogress: event => {
        if (event.lengthComputable && event.total) {
          progress.update('上传中 ' + Math.round((event.loaded / event.total) * 100) + '%');
        }
      }
    });

    return processUploadResponse(res, cfg);
  }

  async function uploadChunked(cfg, blob, fileName, progress) {
    const fileType = blob.type || 'application/octet-stream';
    const chunkSize = getChunkSize(cfg.uploadChannel);
    const totalChunks = Math.ceil(blob.size / chunkSize);

    // 1. 初始化
    progress.update('初始化分块上传...');
    const initForm = new FormData();
    initForm.append('originalFileName', fileName);
    initForm.append('originalFileType', fileType);
    initForm.append('totalChunks', String(totalChunks));

    const initRes = await gmRequest({
      url: buildChunkedUrl(cfg, { initChunked: 'true' }),
      method: 'POST',
      headers: authHeaders(cfg),
      data: initForm,
      responseType: 'json',
      timeout: cfg.uploadTimeout
    });

    if (initRes.status < 200 || initRes.status >= 300) {
      throw new Error('初始化分块上传失败：' + friendlyStatus(initRes.status));
    }

    const initData = parseJson(initRes);
    if (!initData || !initData.uploadId) {
      throw new Error('初始化分块上传失败：服务端未返回 uploadId');
    }

    const uploadId = initData.uploadId;

    try {
      // 2. 逐块上传
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * chunkSize;
        const chunk = blob.slice(start, Math.min(start + chunkSize, blob.size));

        progress.update('分块上传中 ' + (index + 1) + '/' + totalChunks);

        const form = new FormData();
        form.append('file', chunk, fileName);
        form.append('uploadId', uploadId);
        form.append('chunkIndex', String(index));
        form.append('totalChunks', String(totalChunks));
        form.append('originalFileName', fileName);
        form.append('originalFileType', fileType);

        const res = await gmRequest({
          url: buildChunkedUrl(cfg, { chunked: 'true' }),
          method: 'POST',
          headers: authHeaders(cfg),
          data: form,
          responseType: 'json',
          timeout: cfg.uploadTimeout
        });

        if (res.status < 200 || res.status >= 300) {
          throw new Error('分块 ' + (index + 1) + '/' + totalChunks + ' 上传失败：' + friendlyStatus(res.status));
        }

        const data = parseJson(res);
        if (data && data.success === false) {
          throw new Error('分块 ' + (index + 1) + ' 上传失败：' + (data.message || '服务端返回失败'));
        }
      }

      // 3. 合并
      progress.update('正在合并分块...');
      const mergeExtra = { chunked: 'true', merge: 'true', returnFormat: cfg.returnFormat };
      if (cfg.uploadFolder) mergeExtra.uploadFolder = cfg.uploadFolder;

      const mergeForm = new FormData();
      mergeForm.append('uploadId', uploadId);
      mergeForm.append('totalChunks', String(totalChunks));
      mergeForm.append('originalFileName', fileName);
      mergeForm.append('originalFileType', fileType);

      const mergeRes = await gmRequest({
        url: buildChunkedUrl(cfg, mergeExtra),
        method: 'POST',
        headers: authHeaders(cfg),
        data: mergeForm,
        responseType: 'json',
        timeout: Math.max(cfg.uploadTimeout, 120000)
      });

      return processUploadResponse(mergeRes, cfg);
    } catch (error) {
      // 失败后释放服务端临时分块
      try {
        await gmRequest({
          url: buildChunkedUrl(cfg, { cleanup: 'true', uploadId, totalChunks }),
          method: 'POST',
          headers: authHeaders(cfg),
          responseType: 'json',
          timeout: 10000
        });
      } catch (cleanupError) {
        console.warn('[ImgBed] 清理分块失败:', cleanupError);
      }
      throw error;
    }
  }

  /**
   * 统一上传入口
   * @param {Blob} blob
   * @param {string} fileName
   * @param {string} source - image / clipboard / drag
   */
  async function uploadBlob(blob, fileName, source) {
    const cfg = config;
    const label = SOURCE_LABEL[source] || SOURCE_LABEL.unknown;

    if (!cfg.apiUrl) {
      showToast('error', '尚未配置', '请先在 Tampermonkey 菜单中打开「ImgBed 设置」填写 API 地址');
      openSettings();
      return { ok: false };
    }

    const limit = getChannelLimit(cfg.uploadChannel);
    if (blob.size > limit) {
      const message = '文件大小 ' + formatSize(blob.size) + ' 超过 ' + cfg.uploadChannel + ' 渠道上限 ' + formatSize(limit);
      showToast('error', '文件过大', message);
      addHistory({ fileName, source, success: false, error: message });
      return { ok: false, error: message };
    }

    const progress = showProgress('准备上传 ' + label + '...');

    try {
      const result = supportsChunked(cfg.uploadChannel) && blob.size > CHUNKED_THRESHOLD
        ? await uploadChunked(cfg, blob, fileName, progress)
        : await uploadSingle(cfg, blob, fileName, progress);

      progress.close();
      showSuccess(result.url);
      addHistory({ fileName, source, success: true, url: result.url });
      console.log('[ImgBed] 上传成功:', result.url);
      return { ok: true, url: result.url };
    } catch (error) {
      progress.close();
      const message = error && error.message ? error.message : '上传失败';
      showToast('error', '上传失败', message);
      addHistory({ fileName, source, success: false, error: message });
      console.error('[ImgBed] 上传失败:', error);
      return { ok: false, error: message };
    }
  }

  /**
   * 抓取网页图片（GM_xmlhttpRequest 不受 CORS 限制）
   */
  async function fetchImageBlob(imageUrl) {
    if (!/^https?:/i.test(imageUrl)) {
      throw new Error('仅支持 http/https 图片地址');
    }

    const res = await gmRequest({
      url: imageUrl,
      method: 'GET',
      responseType: 'blob',
      timeout: 30000
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error('图片获取失败：HTTP ' + res.status + '（可能启用了防盗链）');
    }

    let blob = res.response;
    if (!(blob instanceof Blob)) {
      blob = new Blob([blob]);
    }

    if (blob.size === 0) throw new Error('图片内容为空');
    if (blob.type && !blob.type.startsWith('image/')) {
      throw new Error('目标不是图片（' + blob.type + '）');
    }

    return blob;
  }

  async function uploadImageUrl(imageUrl) {
    if (!imageUrl) return;
    const progress = showProgress('正在获取图片...');
    try {
      const blob = await fetchImageBlob(imageUrl);
      progress.close();
      await uploadBlob(blob, fileNameFromUrl(imageUrl), 'image');
    } catch (error) {
      progress.close();
      const message = error && error.message ? error.message : '图片获取失败';
      showToast('error', '上传失败', message + '。可尝试先复制图片再上传剪贴板');
      addHistory({ fileName: fileNameFromUrl(imageUrl), source: 'image', success: false, error: message });
    }
  }

  // ==================== 剪贴板 ====================
  function readClipboardImage() {
    return new Promise((resolve, reject) => {
      if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        reject(new Error('当前页面不支持剪贴板读取（需 HTTPS 页面）'));
        return;
      }

      navigator.clipboard.read().then(items => {
        for (const item of items) {
          const type = item.types.find(t => t.startsWith('image/'));
          if (type) {
            item.getType(type).then(resolve).catch(reject);
            return;
          }
        }
        reject(new Error('剪贴板中没有图片数据'));
      }).catch(reject);
    });
  }

  /**
   * 等待用户按 Ctrl+V 粘贴图片（剪贴板 API 被拒时的兜底）
   */
  function waitForPaste(timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = null;

      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('paste', onPaste, true);
      };

      const onPaste = event => {
        const items = (event.clipboardData && event.clipboardData.items) || [];
        for (const item of items) {
          if (item.type && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              event.stopPropagation();
              cleanup();
              resolve(file);
              return;
            }
          }
        }
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('等待粘贴超时'));
      }, timeoutMs || 15000);

      window.addEventListener('paste', onPaste, true);
    });
  }

  async function uploadClipboard() {
    let blob = null;

    try {
      blob = await readClipboardImage();
    } catch (error) {
      console.warn('[ImgBed] 剪贴板 API 读取失败，改用粘贴兜底:', error && error.message);
      showToast('info', '请按 Ctrl+V 粘贴图片', '浏览器未允许直接读取剪贴板，15 秒内按 Ctrl+V 即可上传', 15000);

      try {
        blob = await waitForPaste(15000);
      } catch (pasteError) {
        showToast('error', '未获取到图片', '既无法读取剪贴板，也没有检测到粘贴操作');
        return { ok: false };
      }
    }

    if (!blob) return { ok: false };

    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return uploadBlob(blob, 'clipboard-image.' + ext, 'clipboard');
  }

  // ==================== 上传记录 ====================
  function getHistory() {
    const list = readStore(HISTORY_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function addHistory(entry) {
    const record = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      time: Date.now(),
      source: entry.source || 'unknown',
      success: Boolean(entry.success),
      fileName: String(entry.fileName || '').slice(0, 120),
      url: entry.success ? String(entry.url || '').slice(0, 1000) : '',
      error: entry.success ? '' : String(entry.error || '上传失败').slice(0, 300)
    };

    const list = [record].concat(getHistory()).slice(0, HISTORY_MAX);
    writeStore(HISTORY_KEY, list);
    refreshHistoryPane();
  }

  function removeHistory(id) {
    writeStore(HISTORY_KEY, getHistory().filter(item => item.id !== id));
    refreshHistoryPane();
  }

  function clearHistory() {
    writeStore(HISTORY_KEY, []);
    refreshHistoryPane();
  }

  // ==================== UI 基础 ====================
  let shadow = null;
  let toastBox = null;
  let modal = null;
  let badge = null;
  let imageMenu = null;
  let badgeImage = null;
  let badgeTimer = null;

  const STYLE = [
    ':host{all:initial}',
    '.ib-toast-box{position:fixed;right:20px;bottom:20px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;align-items:flex-end;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.ib-toast{min-width:240px;max-width:380px;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.16);padding:12px 14px;font-size:13px;line-height:1.5;animation:ib-in .18s ease-out}',
    '@keyframes ib-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
    '.ib-toast-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:600}',
    '.ib-toast-title{display:flex;align-items:center;gap:7px}',
    '.ib-dot{width:8px;height:8px;border-radius:50%;background:#0ea5e9}',
    '.ib-toast.error .ib-dot{background:#ef4444}',
    '.ib-toast.success .ib-dot{background:#10b981}',
    '.ib-toast.info .ib-dot{background:#0ea5e9}',
    '.ib-toast-close{border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px}',
    '.ib-toast-msg{margin-top:6px;color:#475569;word-break:break-word}',
    '.ib-row{display:flex;align-items:center;gap:8px;margin-top:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 8px;cursor:pointer}',
    '.ib-row:hover{background:#eff6ff;border-color:#bfdbfe}',
    '.ib-row-label{font-size:11px;color:#64748b;flex:0 0 auto}',
    '.ib-row-text{font-size:12px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
    '.ib-row-copy{font-size:11px;color:#2563eb;flex:0 0 auto}',
    '.ib-spinner{width:14px;height:14px;border:2px solid #cbd5e1;border-top-color:#0ea5e9;border-radius:50%;animation:ib-spin .7s linear infinite}',
    '@keyframes ib-spin{to{transform:rotate(360deg)}}',
    '.ib-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.ib-modal{width:520px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.3);display:flex;flex-direction:column;overflow:hidden}',
    '.ib-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#f8fafc,#eef6ff)}',
    '.ib-modal-title{font-size:15px;font-weight:600;color:#0f172a}',
    '.ib-modal-close{border:0;background:transparent;font-size:20px;line-height:1;color:#64748b;cursor:pointer;padding:0 4px}',
    '.ib-tabs{display:flex;gap:6px;padding:10px 18px 0}',
    '.ib-tab{border:0;background:#f1f5f9;color:#475569;border-radius:8px 8px 0 0;padding:7px 14px;font-size:13px;cursor:pointer}',
    '.ib-tab.active{background:#fff;color:#0f172a;font-weight:600;box-shadow:inset 0 -2px 0 #0ea5e9}',
    '.ib-pane{padding:14px 18px;overflow:auto;flex:1}',
    '.ib-hidden{display:none!important}',
    '.ib-field{margin-bottom:11px}',
    '.ib-field label{display:block;font-size:12px;font-weight:600;color:#334155;margin-bottom:5px}',
    '.ib-field input[type=text],.ib-field input[type=password],.ib-field input[type=number],.ib-field select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;color:#0f172a;background:#fff;outline:none}',
    '.ib-field input:focus,.ib-field select:focus{border-color:#0ea5e9;box-shadow:0 0 0 3px rgba(14,165,233,.14)}',
    '.ib-two{display:flex;gap:10px}',
    '.ib-two>.ib-field{flex:1;min-width:0}',
    '.ib-check{display:flex;align-items:center;gap:7px;font-size:12px;color:#334155;margin:6px 0}',
    '.ib-check input{accent-color:#0ea5e9}',
    '.ib-hint{font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.5}',
    '.ib-actions{display:flex;gap:8px;margin-top:14px}',
    '.ib-btn{flex:1;border:0;border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer}',
    '.ib-btn-primary{background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff}',
    '.ib-btn-ghost{background:#f1f5f9;color:#334155}',
    '.ib-status{font-size:12px;padding:8px 10px;border-radius:8px;margin-top:10px;display:none;word-break:break-word}',
    '.ib-status.ok{display:block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}',
    '.ib-status.err{display:block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca}',
    '.ib-status.info{display:block;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}',
    '.ib-hist-tools{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}',
    '.ib-hist-empty{color:#94a3b8;font-size:13px;text-align:center;padding:24px 0}',
    '.ib-hist-item{border:1px solid #e2e8f0;border-radius:10px;padding:9px 10px;margin-bottom:8px;background:#fff}',
    '.ib-hist-top{display:flex;justify-content:space-between;gap:8px;align-items:center}',
    '.ib-hist-name{font-size:12px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ib-hist-meta{font-size:11px;color:#94a3b8;flex:0 0 auto}',
    '.ib-hist-url{font-size:11px;color:#2563eb;margin-top:4px;word-break:break-all}',
    '.ib-hist-err{font-size:11px;color:#dc2626;margin-top:4px;word-break:break-word}',
    '.ib-hist-acts{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}',
    '.ib-mini{border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:6px;font-size:11px;padding:3px 8px;cursor:pointer}',
    '.ib-mini:hover{border-color:#0ea5e9;color:#0369a1}',
    '.ib-badge{position:fixed;z-index:2147483647;display:none;align-items:center;gap:4px;padding:4px 9px;border-radius:999px;background:rgba(15,23,42,.88);color:#fff;font-size:11px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}',
    '.ib-badge:hover{background:#0284c7}',
    '.ib-menu{position:fixed;z-index:2147483647;display:none;flex-direction:column;min-width:170px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.22);padding:5px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}',
    '.ib-menu button{border:0;background:transparent;text-align:left;font-size:12px;color:#0f172a;padding:8px 10px;border-radius:7px;cursor:pointer}',
    '.ib-menu button:hover{background:#eff6ff;color:#0369a1}',
    '.ib-menu .ib-sep{height:1px;background:#e2e8f0;margin:4px 2px}',
    '.ib-menu-title{font-size:10px;color:#94a3b8;padding:3px 10px 5px;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '@media (prefers-color-scheme:dark){',
    '.ib-toast{background:#1e293b;color:#e2e8f0;border-color:#334155}',
    '.ib-toast-msg{color:#94a3b8}',
    '.ib-row{background:#0f172a;border-color:#334155}',
    '.ib-row:hover{background:#1e3a5f;border-color:#1d4ed8}',
    '.ib-row-text{color:#e2e8f0}',
    '.ib-modal{background:#1e293b}',
    '.ib-modal-head{background:linear-gradient(135deg,#1e293b,#0f172a);border-color:#334155}',
    '.ib-modal-title{color:#e2e8f0}',
    '.ib-tab{background:#0f172a;color:#94a3b8}',
    '.ib-tab.active{background:#1e293b;color:#e2e8f0}',
    '.ib-field label{color:#cbd5e1}',
    '.ib-field input,.ib-field select{background:#0f172a;border-color:#334155;color:#e2e8f0}',
    '.ib-check{color:#cbd5e1}',
    '.ib-hist-item{background:#0f172a;border-color:#334155}',
    '.ib-hist-name{color:#e2e8f0}',
    '.ib-mini{background:#1e293b;border-color:#334155;color:#cbd5e1}',
    '.ib-menu{background:#1e293b;border-color:#334155}',
    '.ib-menu button{color:#e2e8f0}',
    '.ib-menu button:hover{background:#1e3a5f}',
    '}'
  ].join('\n');

  function ensureRoot() {
    if (shadow) return shadow;

    const host = document.createElement('div');
    host.id = 'imgbed-userscript-root';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    (document.body || document.documentElement).appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    toastBox = document.createElement('div');
    toastBox.className = 'ib-toast-box';
    shadow.appendChild(toastBox);

    badge = document.createElement('div');
    badge.className = 'ib-badge';
    badge.textContent = '上传到 ImgBed';
    shadow.appendChild(badge);

    imageMenu = document.createElement('div');
    imageMenu.className = 'ib-menu';
    shadow.appendChild(imageMenu);

    return shadow;
  }

  // ==================== Toast ====================
  function showToast(type, title, message, autoCloseMs) {
    ensureRoot();

    const toast = document.createElement('div');
    toast.className = 'ib-toast ' + type;

    const head = document.createElement('div');
    head.className = 'ib-toast-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ib-toast-title';
    const dot = document.createElement('span');
    dot.className = 'ib-dot';
    const titleText = document.createElement('span');
    titleText.textContent = title;
    titleWrap.appendChild(dot);
    titleWrap.appendChild(titleText);

    const close = document.createElement('button');
    close.className = 'ib-toast-close';
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());

    head.appendChild(titleWrap);
    head.appendChild(close);
    toast.appendChild(head);

    if (message) {
      const msg = document.createElement('div');
      msg.className = 'ib-toast-msg';
      msg.textContent = message;
      toast.appendChild(msg);
    }

    toastBox.appendChild(toast);

    if (autoCloseMs) {
      setTimeout(() => toast.remove(), autoCloseMs);
    }

    return toast;
  }

  function showProgress(text) {
    ensureRoot();

    const toast = document.createElement('div');
    toast.className = 'ib-toast info';

    const head = document.createElement('div');
    head.className = 'ib-toast-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ib-toast-title';
    const spinner = document.createElement('span');
    spinner.className = 'ib-spinner';
    const titleText = document.createElement('span');
    titleText.textContent = 'ImgBed 上传';
    titleWrap.appendChild(spinner);
    titleWrap.appendChild(titleText);

    const close = document.createElement('button');
    close.className = 'ib-toast-close';
    close.type = 'button';
    close.textContent = '×';

    head.appendChild(titleWrap);
    head.appendChild(close);
    toast.appendChild(head);

    const msg = document.createElement('div');
    msg.className = 'ib-toast-msg';
    msg.textContent = text;
    toast.appendChild(msg);

    toastBox.appendChild(toast);

    let closed = false;

    return {
      update(nextText) {
        if (!closed) msg.textContent = nextText;
      },
      close() {
        closed = true;
        toast.remove();
      }
    };
  }

  function showSuccess(url) {
    ensureRoot();

    const toast = document.createElement('div');
    toast.className = 'ib-toast success';

    const head = document.createElement('div');
    head.className = 'ib-toast-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ib-toast-title';
    const dot = document.createElement('span');
    dot.className = 'ib-dot';
    const titleText = document.createElement('span');
    titleText.textContent = '上传成功';
    titleWrap.appendChild(dot);
    titleWrap.appendChild(titleText);

    const close = document.createElement('button');
    close.className = 'ib-toast-close';
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());

    head.appendChild(titleWrap);
    head.appendChild(close);
    toast.appendChild(head);

    const formats = [
      { label: '直链', value: url },
      { label: 'Markdown', value: '![image](' + url + ')' },
      { label: 'BBCode', value: '[img]' + url + '[/img]' }
    ];

    formats.forEach(item => {
      const row = document.createElement('div');
      row.className = 'ib-row';
      row.title = item.value;

      const label = document.createElement('span');
      label.className = 'ib-row-label';
      label.textContent = item.label;

      const text = document.createElement('span');
      text.className = 'ib-row-text';
      text.textContent = truncate(item.value);

      const copyHint = document.createElement('span');
      copyHint.className = 'ib-row-copy';
      copyHint.textContent = '点击复制';

      row.appendChild(label);
      row.appendChild(text);
      row.appendChild(copyHint);

      row.addEventListener('click', async () => {
        const ok = await copyText(item.value);
        copyHint.textContent = ok ? '已复制' : '复制失败';
        setTimeout(() => { copyHint.textContent = '点击复制'; }, 1500);
      });

      toast.appendChild(row);
    });

    toastBox.appendChild(toast);
    return toast;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch (fallbackError) {
        console.warn('[ImgBed] 复制失败:', fallbackError);
        return false;
      }
    }
  }

  // ==================== 设置面板 ====================
  function buildModal() {
    ensureRoot();
    if (modal) return modal;

    const mask = document.createElement('div');
    mask.className = 'ib-mask ib-hidden';

    const channelOptions = CHANNELS
      .map(item => '<option value="' + item.value + '">' + esc(item.label) + '</option>')
      .join('');

    const nameTypeOptions = NAME_TYPES
      .map(item => '<option value="' + item.value + '">' + esc(item.label) + '</option>')
      .join('');

    mask.innerHTML = [
      '<div class="ib-modal">',
      '  <div class="ib-modal-head">',
      '    <span class="ib-modal-title">CloudFlare ImgBed 设置</span>',
      '    <button class="ib-modal-close" type="button" data-act="close">×</button>',
      '  </div>',
      '  <div class="ib-tabs">',
      '    <button class="ib-tab active" type="button" data-tab="config">配置</button>',
      '    <button class="ib-tab" type="button" data-tab="history">上传记录</button>',
      '  </div>',
      '  <div class="ib-pane" data-pane="config">',
      '    <div class="ib-field"><label>API 地址 *</label><input type="text" data-k="apiUrl" placeholder="https://img.example.com（不要带 /upload）"></div>',
      '    <div class="ib-field"><label>API Token（可选，需 upload 权限）</label><input type="password" data-k="apiToken" placeholder="与认证码二选一，优先使用 Token"></div>',
      '    <div class="ib-field"><label>上传认证码（可选）</label><input type="password" data-k="authCode" placeholder="服务端启用认证码时填写"></div>',
      '    <div class="ib-two">',
      '      <div class="ib-field"><label>上传渠道</label><select data-k="uploadChannel">' + channelOptions + '</select></div>',
      '      <div class="ib-field"><label>渠道名称（可选）</label><input type="text" data-k="channelName" placeholder="如 r2-main"></div>',
      '    </div>',
      '    <div class="ib-two">',
      '      <div class="ib-field"><label>命名方式</label><select data-k="uploadNameType">' + nameTypeOptions + '</select></div>',
      '      <div class="ib-field"><label>返回格式</label><select data-k="returnFormat"><option value="full">完整链接</option><option value="default">短链接</option></select></div>',
      '    </div>',
      '    <div class="ib-two">',
      '      <div class="ib-field"><label>上传目录（可选）</label><input type="text" data-k="uploadFolder" placeholder="如 img/test"></div>',
      '      <div class="ib-field"><label>上传超时（秒）</label><input type="number" min="10" max="300" data-k="uploadTimeout"></div>',
      '    </div>',
      '    <label class="ib-check"><input type="checkbox" data-k="serverCompress">服务端压缩（仅 Telegram 生效）</label>',
      '    <label class="ib-check"><input type="checkbox" data-k="autoRetry">失败时自动切换渠道重试</label>',
      '    <label class="ib-check"><input type="checkbox" data-k="enableBadge">图片悬停显示「上传到 ImgBed」按钮</label>',
      '    <label class="ib-check"><input type="checkbox" data-k="enableImageMenu">接管图片右键菜单（Alt + 右键可临时用浏览器原生菜单）</label>',
      '    <label class="ib-check"><input type="checkbox" data-k="enableDragDrop">启用拖拽上传</label>',
      '    <label class="ib-check"><input type="checkbox" data-k="enableShortcut">启用 Ctrl+Shift+U 上传剪贴板</label>',
      '    <div class="ib-hint">大文件会自动按渠道分块上传：Telegram 16MB/块，R2 / S3 / Discord 8MB/块。</div>',
      '    <div class="ib-actions">',
      '      <button class="ib-btn ib-btn-primary" type="button" data-act="save">保存配置</button>',
      '      <button class="ib-btn ib-btn-ghost" type="button" data-act="test">测试连接</button>',
      '    </div>',
      '    <div class="ib-status" data-role="status"></div>',
      '  </div>',
      '  <div class="ib-pane ib-hidden" data-pane="history">',
      '    <div class="ib-hist-tools">',
      '      <span class="ib-hint">最多保留最近 ' + HISTORY_MAX + ' 条，仅存于本地</span>',
      '      <button class="ib-mini" type="button" data-act="clear-history">清空</button>',
      '    </div>',
      '    <div data-role="history-list"></div>',
      '  </div>',
      '</div>'
    ].join('');

    shadow.appendChild(mask);
    modal = mask;

    mask.addEventListener('click', event => {
      if (event.target === mask) closeSettings();
    });

    mask.querySelector('[data-act="close"]').addEventListener('click', closeSettings);

    mask.querySelectorAll('.ib-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        mask.querySelectorAll('.ib-tab').forEach(item => item.classList.toggle('active', item === tab));
        const target = tab.getAttribute('data-tab');
        mask.querySelectorAll('.ib-pane').forEach(pane => {
          pane.classList.toggle('ib-hidden', pane.getAttribute('data-pane') !== target);
        });
        if (target === 'history') refreshHistoryPane();
      });
    });

    mask.querySelector('[data-act="save"]').addEventListener('click', () => {
      const patch = collectForm();
      const error = validateConfig(patch);
      if (error) {
        setStatus(error, 'err');
        return;
      }
      saveConfig(patch);
      setStatus('配置已保存', 'ok');
      applyFeatureToggles();
    });

    mask.querySelector('[data-act="test"]').addEventListener('click', testConnection);
    mask.querySelector('[data-act="clear-history"]').addEventListener('click', () => {
      if (confirm('确定清空全部上传记录？')) clearHistory();
    });

    return modal;
  }

  function collectForm() {
    const patch = {};
    modal.querySelectorAll('[data-k]').forEach(el => {
      const key = el.getAttribute('data-k');
      if (el.type === 'checkbox') {
        patch[key] = el.checked;
      } else if (key === 'uploadTimeout') {
        const seconds = parseInt(el.value, 10);
        patch[key] = (Number.isFinite(seconds) ? seconds : 60) * 1000;
      } else {
        patch[key] = el.value;
      }
    });
    return patch;
  }

  function fillForm() {
    modal.querySelectorAll('[data-k]').forEach(el => {
      const key = el.getAttribute('data-k');
      if (el.type === 'checkbox') {
        el.checked = Boolean(config[key]);
      } else if (key === 'uploadTimeout') {
        el.value = String(Math.round(config.uploadTimeout / 1000));
      } else {
        el.value = config[key] == null ? '' : config[key];
      }
    });
  }

  function setStatus(message, type) {
    const el = modal.querySelector('[data-role="status"]');
    el.textContent = message;
    el.className = 'ib-status ' + type;
  }

  function openSettings(tabName) {
    buildModal();
    fillForm();
    modal.classList.remove('ib-hidden');
    setStatus('', '');

    if (tabName === 'history') {
      const tab = modal.querySelector('.ib-tab[data-tab="history"]');
      if (tab) tab.click();
    }
  }

  function closeSettings() {
    if (modal) modal.classList.add('ib-hidden');
  }

  async function testConnection() {
    const patch = collectForm();
    const cfg = normalizeConfig(Object.assign({}, config, patch));
    const error = validateConfig(cfg);

    if (error) {
      setStatus(error, 'err');
      return;
    }

    setStatus('正在测试连接...', 'info');

    const headers = authHeaders(cfg);
    const query = cfg.authCode ? '?authCode=' + encodeURIComponent(cfg.authCode) : '';

    try {
      const res = await gmRequest({
        url: cfg.apiUrl.replace(/\/+$/, '') + '/api/channels' + query,
        method: 'GET',
        headers,
        responseType: 'json',
        timeout: 15000
      });

      if (res.status >= 200 && res.status < 300) {
        const data = parseJson(res);
        const list = Array.isArray(data) ? data : (data && (data.channels || data.data)) || [];
        const names = list.map(item => {
          if (typeof item === 'string') return item;
          if (!item || typeof item !== 'object') return '';
          return item.channelName || item.name || item.id || '';
        }).filter(Boolean);

        setStatus(names.length ? '连接成功，可用渠道 ' + names.length + ' 个' : '连接测试成功', 'ok');
        return;
      }

      if (res.status === 401 || res.status === 403) {
        setStatus(friendlyStatus(res.status), 'err');
        return;
      }

      // 实例没有 /api/channels 时退回根路径探测
      const probe = await gmRequest({
        url: cfg.apiUrl.replace(/\/+$/, '') + '/',
        method: 'HEAD',
        timeout: 15000
      });

      if (probe.status > 0 && probe.status < 500) {
        setStatus('地址可达，但该实例未提供渠道接口，未能验证上传权限', 'info');
      } else {
        setStatus('连接失败：' + friendlyStatus(probe.status), 'err');
      }
    } catch (error) {
      setStatus('连接失败：' + (error && error.message ? error.message : '未知错误'), 'err');
    }
  }

  function refreshHistoryPane() {
    if (!modal) return;
    const listEl = modal.querySelector('[data-role="history-list"]');
    if (!listEl) return;

    const list = getHistory();

    if (!list.length) {
      listEl.innerHTML = '<div class="ib-hist-empty">暂无上传记录</div>';
      return;
    }

    listEl.innerHTML = list.map(item => {
      const time = new Date(item.time).toLocaleString('zh-CN', { hour12: false });
      const meta = (SOURCE_LABEL[item.source] || SOURCE_LABEL.unknown) + ' · ' + time;
      const body = item.success
        ? '<div class="ib-hist-url">' + esc(item.url) + '</div>'
        : '<div class="ib-hist-err">' + esc(item.error) + '</div>';

      const actions = item.success
        ? '<div class="ib-hist-acts">' +
          '<button class="ib-mini" data-copy="' + esc(item.url) + '">直链</button>' +
          '<button class="ib-mini" data-copy="' + esc('![image](' + item.url + ')') + '">Markdown</button>' +
          '<button class="ib-mini" data-copy="' + esc('[img]' + item.url + '[/img]') + '">BBCode</button>' +
          '<button class="ib-mini" data-del="' + esc(item.id) + '">删除</button>' +
          '</div>'
        : '<div class="ib-hist-acts"><button class="ib-mini" data-del="' + esc(item.id) + '">删除</button></div>';

      return '<div class="ib-hist-item">' +
        '<div class="ib-hist-top"><span class="ib-hist-name">' + esc(item.fileName || '(未命名)') + '</span>' +
        '<span class="ib-hist-meta">' + esc(meta) + '</span></div>' + body + actions + '</div>';
    }).join('');
  }

  // 历史记录按钮用事件委托
  function bindHistoryDelegation() {
    if (!modal) return;
    modal.addEventListener('click', async event => {
      const copyBtn = event.target.closest('[data-copy]');
      if (copyBtn) {
        const ok = await copyText(copyBtn.getAttribute('data-copy'));
        const original = copyBtn.textContent;
        copyBtn.textContent = ok ? '已复制' : '失败';
        setTimeout(() => { copyBtn.textContent = original; }, 1200);
        return;
      }

      const delBtn = event.target.closest('[data-del]');
      if (delBtn) {
        removeHistory(delBtn.getAttribute('data-del'));
      }
    });
  }

  // ==================== 图片识别 ====================
  const BG_URL_RE = /url\((['"]?)(.*?)\1\)/i;

  function isImageEl(node) {
    return typeof HTMLImageElement !== 'undefined' && node instanceof HTMLImageElement;
  }

  function getImageUrl(img) {
    if (!img) return '';
    const raw = [
      img.currentSrc,
      img.src,
      img.getAttribute && img.getAttribute('data-src'),
      img.getAttribute && img.getAttribute('data-original'),
      img.getAttribute && img.getAttribute('data-actualsrc'),
      img.getAttribute && img.getAttribute('data-lazy-src')
    ];

    let fallback = '';
    for (const value of raw) {
      if (typeof value !== 'string') continue;
      const url = value.trim();
      if (!url) continue;
      if (/^https?:\/\//i.test(url)) return url;
      if (url.startsWith('//')) return 'https:' + url;
      if (!fallback) fallback = url;
    }
    return fallback;
  }

  function imageFromPath(path) {
    if (!path || !path.length) return null;
    for (const node of path) {
      if (isImageEl(node)) return node;
    }
    return null;
  }

  function imageFromAncestors(node) {
    let el = node;
    for (let depth = 0; el && depth < 6; depth += 1) {
      if (isImageEl(el)) return el;
      let parent = el.parentElement;
      if (!parent && el.getRootNode) {
        const root = el.getRootNode();
        parent = root && root.host ? root.host : null;
      }
      el = parent;
    }
    return null;
  }

  function backgroundUrl(el) {
    if (!el || el === document.body || el === document.documentElement) return '';
    if (typeof getComputedStyle !== 'function') return '';

    try {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') return '';
      const match = bg.match(BG_URL_RE);
      const url = match ? match[2].trim() : '';
      if (!url) return '';
      if (/^https?:\/\//i.test(url)) return url;
      if (url.startsWith('//')) return 'https:' + url;
      if (url.startsWith('/')) return location.origin + url;
      return '';
    } catch (error) {
      return '';
    }
  }

  /**
   * 从事件中定位图片。很多站点会在 <img> 上盖一层透明 div 或 <a>，
   * 此时 event.target 根本不是图片，因此依次尝试：
   *   1) 事件路径（可穿透 Shadow DOM）
   *   2) 向上回溯祖先里的 <img>
   *   3) 按坐标取该点所有元素，找 <img> 或带 background-image 的元素
   */
  function resolveImage(event, allowPoint) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const direct = imageFromPath(path) || imageFromAncestors(event.target);
    if (direct) {
      const url = getImageUrl(direct);
      if (url) return { img: direct, url };
    }

    if (!allowPoint || typeof document.elementsFromPoint !== 'function') return null;

    const stack = document.elementsFromPoint(event.clientX, event.clientY) || [];
    for (const el of stack) {
      if (!isImageEl(el)) continue;
      const url = getImageUrl(el);
      if (url) return { img: el, url };
    }
    for (const el of stack) {
      const url = backgroundUrl(el);
      if (url) return { img: null, url };
    }
    return null;
  }

  // ==================== 图片悬停按钮 / 右键菜单 ====================
  function hideBadge() {
    if (badge) badge.style.display = 'none';
    badgeImage = null;
  }

  function showBadge(img) {
    if (!img || !img.isConnected) return;

    const rect = img.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    if (rect.right < 0 || rect.left > window.innerWidth) return;

    badgeImage = img;
    badge.style.display = 'flex';
    badge.style.top = Math.max(6, rect.top + 8) + 'px';
    badge.style.left = Math.max(6, Math.min(window.innerWidth - 110, rect.right - 108)) + 'px';
  }

  function onMouseOver(event) {
    if (!config.enableBadge) return;
    const info = resolveImage(event, false);
    if (!info || !info.img) return;

    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => showBadge(info.img), 200);
  }

  // 覆盖层场景：<img> 上面盖了透明层，mouseover 永远不会落在 <img> 上，
  // 用节流后的坐标探测兜底
  let lastPointScan = 0;
  function onMouseMove(event) {
    if (!config.enableBadge) return;
    if (badge && badge.style.display === 'flex') return;

    const now = Date.now();
    if (now - lastPointScan < 200) return;
    lastPointScan = now;

    const info = resolveImage(event, true);
    if (info && info.img) showBadge(info.img);
  }

  function onMouseOut(event) {
    if (!config.enableBadge) return;
    const info = resolveImage(event, false);
    const img = info ? info.img : null;
    if (!img || img !== badgeImage) return;

    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      if (!badge.matches(':hover')) hideBadge();
    }, 220);
  }

  function hideImageMenu() {
    if (imageMenu) imageMenu.style.display = 'none';
  }

  function showImageMenu(x, y, imageUrl) {
    ensureRoot();
    imageMenu.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'ib-menu-title';
    try {
      title.textContent = new URL(imageUrl).hostname;
    } catch (error) {
      title.textContent = '网页图片';
    }

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.textContent = '上传此图片到 ImgBed';
    uploadBtn.addEventListener('click', () => {
      hideImageMenu();
      uploadImageUrl(imageUrl);
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制图片地址';
    copyBtn.addEventListener('click', async () => {
      await copyText(imageUrl);
      hideImageMenu();
    });

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = '在新标签页打开';
    openBtn.addEventListener('click', () => {
      window.open(imageUrl, '_blank', 'noopener');
      hideImageMenu();
    });

    const sep = document.createElement('div');
    sep.className = 'ib-sep';

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.textContent = 'ImgBed 设置';
    settingsBtn.addEventListener('click', () => {
      hideImageMenu();
      openSettings();
    });

    imageMenu.appendChild(title);
    imageMenu.appendChild(uploadBtn);
    imageMenu.appendChild(copyBtn);
    imageMenu.appendChild(openBtn);
    imageMenu.appendChild(sep);
    imageMenu.appendChild(settingsBtn);

    imageMenu.style.display = 'flex';
    imageMenu.style.left = '0px';
    imageMenu.style.top = '0px';

    const rect = imageMenu.getBoundingClientRect();
    const left = Math.max(6, Math.min(x, window.innerWidth - rect.width - 6));
    const top = Math.max(6, Math.min(y, window.innerHeight - rect.height - 6));
    imageMenu.style.left = left + 'px';
    imageMenu.style.top = top + 'px';
  }

  function onContextMenu(event) {
    if (!config.enableImageMenu) return;
    // 按住 Alt 右键不接管，保留浏览器原生菜单（另存图片等）
    if (event.altKey) return;

    const info = resolveImage(event, true);
    if (!info) return;

    event.preventDefault();
    event.stopPropagation();
    hideBadge();
    showImageMenu(event.clientX, event.clientY, info.url);
  }

  // ==================== 拖拽 / 快捷键 ====================
  function initDragDrop() {
    document.addEventListener('dragover', event => {
      if (!config.enableDragDrop) return;
      const types = event.dataTransfer && event.dataTransfer.types;
      if (types && Array.from(types).indexOf('Files') !== -1) {
        event.preventDefault();
      }
    }, true);

    document.addEventListener('drop', async event => {
      if (!config.enableDragDrop) return;

      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      const images = files.filter(file => file.type && file.type.startsWith('image/'));
      if (!images.length) return;

      event.preventDefault();
      event.stopPropagation();

      for (const file of images) {
        await uploadBlob(file, file.name || 'image.png', 'drag');
      }
    }, true);
  }

  function initShortcut() {
    window.addEventListener('keydown', event => {
      if (!config.enableShortcut) return;
      if (!event.ctrlKey || !event.shiftKey) return;
      if (event.code !== 'KeyU' && String(event.key).toUpperCase() !== 'U') return;

      event.preventDefault();
      event.stopPropagation();
      uploadClipboard();
    }, true);
  }

  function applyFeatureToggles() {
    if (!config.enableBadge) hideBadge();
    if (!config.enableImageMenu) hideImageMenu();
  }

  // ==================== 初始化 ====================
  function init() {
    ensureRoot();
    buildModal();
    bindHistoryDelegation();
    initDragDrop();
    initShortcut();

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    // 挂在 window 捕获阶段，先于站点自己的右键处理，避免被 stopPropagation 拦掉
    window.addEventListener('contextmenu', onContextMenu, true);

    badge.addEventListener('click', () => {
      const img = badgeImage;
      hideBadge();
      if (img) uploadImageUrl(getImageUrl(img));
    });

    badge.addEventListener('mouseleave', () => hideBadge());
    badge.addEventListener('mouseenter', () => clearTimeout(badgeTimer));

    document.addEventListener('click', event => {
      if (imageMenu && imageMenu.style.display === 'flex') {
        if (!event.composedPath || event.composedPath().indexOf(imageMenu) === -1) hideImageMenu();
      }
      if (!isImageEl(event.target)) hideBadge();
    }, true);

    window.addEventListener('scroll', () => {
      hideBadge();
      hideImageMenu();
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        hideImageMenu();
        hideBadge();
        closeSettings();
      }
    }, true);

    // Tampermonkey 菜单入口
    GM_registerMenuCommand('📋 上传剪贴板图片', () => uploadClipboard());
    GM_registerMenuCommand('⚙️ ImgBed 设置', () => openSettings('config'));
    GM_registerMenuCommand('🕘 上传记录', () => openSettings('history'));

    if (!config.apiUrl) {
      console.info('[ImgBed] 尚未配置 API 地址，请从 Tampermonkey 菜单打开「ImgBed 设置」');
    } else {
      console.info('[ImgBed] 已加载，v' + (typeof GM_info !== 'undefined' ? GM_info.script.version : '1.0.0'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
