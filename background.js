// 导入公共配置模块
importScripts('utils.js');
importScripts('config.js');
importScripts('history-store.js');

// 使用公共配置文件中的 DEFAULT_CONFIG、CONFIG_KEYS 和相关函数

// ==================== 日志工具 ====================
const LOG_PREFIX = '[ImgBed]';

/**
 * 统一的日志记录函数
 * @param {string} level - 日志级别：'info', 'warn', 'error', 'debug'
 * @param {string} message - 日志消息
 * @param {any} data - 附加数据（可选）
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `${LOG_PREFIX} [${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  switch (level) {
    case 'error':
      console.error(logMessage, data || '');
      break;
    case 'warn':
      console.warn(logMessage, data || '');
      break;
    case 'debug':
      console.debug(logMessage, data || '');
      break;
    default:
      console.log(logMessage, data || '');
  }
}

// ==================== 错误处理工具 ====================

/**
 * 错误类型枚举
 */
const ErrorTypes = {
  CONFIG_ERROR: 'CONFIG_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UPLOAD_ERROR: 'UPLOAD_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  PERMISSION_ERROR: 'PERMISSION_ERROR'
};

/**
 * 创建标准化错误对象
 * @param {string} type - 错误类型
 * @param {string} message - 错误消息
 * @param {Error} originalError - 原始错误对象（可选）
 * @returns {Error} 标准化的错误对象
 */
function createError(type, message, originalError = null) {
  const error = new Error(message);
  error.type = type;
  error.originalError = originalError;
  error.timestamp = new Date().toISOString();
  return error;
}

/**
 * 获取用户友好的错误消息（使用工具函数）
 * @param {Error} error - 错误对象
 * @param {number} status - HTTP状态码
 * @returns {string} 用户友好的错误消息
 */
function getUserFriendlyErrorMessage(error, status = null) {
  return getFriendlyErrorMessage(error, status);
}

// ==================== 初始化扩展 ====================

// 初始化扩展
chrome.runtime.onInstalled.addListener(async () => {
  log('info', '扩展已安装/更新');

  // 初始化配置（仅写入 sync 非敏感字段）
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([...SYNC_CONFIG_KEYS, ...CONFIG_META_KEYS, ...SENSITIVE_CONFIG_KEYS]),
    chrome.storage.local.get(SENSITIVE_CONFIG_KEYS)
  ]);

  const normalizedConfig = normalizeConfig({ ...syncData, ...localData });
  const mergedSyncConfig = {};

  SYNC_CONFIG_KEYS.forEach(key => {
    mergedSyncConfig[key] = normalizedConfig[key];
  });

  mergedSyncConfig._version = CONFIG_VERSION;

  // 迁移历史敏感字段：sync -> local
  const legacySensitive = {};
  SENSITIVE_CONFIG_KEYS.forEach(key => {
    if (localData[key] === undefined && typeof syncData[key] === 'string' && syncData[key].trim()) {
      legacySensitive[key] = syncData[key];
    }
  });

  await chrome.storage.sync.set(mergedSyncConfig);

  if (Object.keys(legacySensitive).length > 0) {
    await chrome.storage.local.set(legacySensitive);
  }

  // 防止敏感字段残留在 sync
  await chrome.storage.sync.remove(SENSITIVE_CONFIG_KEYS);

  log('debug', '配置已初始化', mergedSyncConfig);

  // 创建右键菜单
  createContextMenus();
});


// 创建右键菜单
function createContextMenus() {
  // 清除现有菜单
  chrome.contextMenus.removeAll(() => {
    // 图片右键菜单（一级）
    chrome.contextMenus.create({
      id: 'upload-image',
      title: '上传图片到 ImgBed',
      contexts: ['image']
    });

    // 页面右键菜单（一级）
    chrome.contextMenus.create({
      id: 'upload-clipboard',
      title: '上传剪贴板图片到 ImgBed',
      contexts: ['page']
    });

    log('debug', '右键菜单已创建');
  });
}

// 确保标签页内已加载内容脚本（扩展更新后旧标签页不会自动注入，需要补注入）
async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (pong && pong.pong) return true;
  } catch (error) {
    log('debug', '内容脚本未响应，准备注入', { tabId, error: error.message });
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['utils.js', 'notification.js', 'content.js']
    });
  } catch (error) {
    log('warn', '注入内容脚本失败', { tabId, error: error.message });
    return false;
  }

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['notification.css'] });
  } catch (error) {
    // 样式注入失败不影响上传功能
    log('debug', '注入通知样式失败', { tabId, error: error.message });
  }

  log('info', '已向标签页补注入内容脚本', { tabId });
  return true;
}

// 发送右键菜单消息并统一处理错误反馈
async function sendContextMenuMessage(tabId, message, actionLabel) {
  if (typeof tabId !== 'number') {
    log('error', `${actionLabel}失败：无效标签页`, { tabId });
    showContextMenuError(`${actionLabel}失败：无法定位当前页面`);
    return;
  }

  const ready = await ensureContentScript(tabId);
  if (!ready) {
    showContextMenuError(`${actionLabel}失败：当前页面不支持扩展操作，请刷新页面后重试`);
    return;
  }

  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      const raw = chrome.runtime.lastError.message || '';
      const hint = /Receiving end does not exist|Could not establish connection/i.test(raw)
        ? '页面未加载扩展脚本，请刷新页面后重试'
        : raw;
      log('error', `${actionLabel}失败：消息发送异常`, { error: raw });
      showContextMenuError(`${actionLabel}失败：${hint}`);
      return;
    }

    if (response && response.success === false) {
      const errorMessage = response.error || '未知错误';
      log('error', `${actionLabel}失败：内容脚本返回错误`, { error: errorMessage });
      showContextMenuError(`${actionLabel}失败：${errorMessage}`);
    }
  });
}

// 显示右键菜单错误提示
function showContextMenuError(message) {
  chrome.notifications.create(`imgbed-context-error-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'ImgBed 上传失败',
    message
  });
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  log('debug', `菜单点击: ${info.menuItemId}`);

  switch (info.menuItemId) {
    case 'upload-image':
      // 上传图片
      sendContextMenuMessage(tab?.id, {
        action: 'uploadImage',
        imageUrl: info.srcUrl
      }, '上传图片');
      break;

    case 'upload-clipboard':
      // 上传剪贴板图片
      sendContextMenuMessage(tab?.id, {
        action: 'uploadClipboard'
      }, '上传剪贴板图片');
      break;
  }
});

// 处理扩展快捷键（可在 chrome://extensions/shortcuts 中自定义）
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'upload-clipboard') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showContextMenuError('上传剪贴板图片失败：无法定位当前页面');
    return;
  }

  sendContextMenuMessage(tab.id, { action: 'uploadClipboard' }, '上传剪贴板图片');
});


// ==================== 消息处理 ====================

// 处理来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('debug', `收到消息: ${request.action}`, { tabId: sender.tab?.id });
  
  if (request.action === 'uploadFile') {
    // 使用立即返回的方式处理异步操作
    (async () => {
      try {
        log('info', `开始上传文件: ${request.fileName}`);
        const result = await uploadFile(request.fileData, request.fileName);
        log('info', `文件上传成功: ${request.fileName}`, { url: result.url });
        await recordUploadHistory({
          source: request.source,
          fileName: request.fileName,
          success: true,
          url: result.url
        });
        sendResponse({ success: true, result });
      } catch (error) {
        const friendlyMessage = getUserFriendlyErrorMessage(error);
        log('error', `文件上传失败: ${request.fileName}`, { error: error.message });
        await recordUploadHistory({
          source: request.source,
          fileName: request.fileName,
          success: false,
          error: friendlyMessage
        });
        sendResponse({ success: false, error: friendlyMessage });
      }
    })();
    return true; // 保持消息通道开放
  }

  if (request.action === 'uploadImageUrl') {
    // 通过 background script 获取跨域图片
    (async () => {
      try {
        log('info', `开始上传图片URL: ${request.imageUrl}`);
        const result = await uploadImageFromUrl(request.imageUrl, request.fileName);
        log('info', `图片URL上传成功`, { url: result.url });
        await recordUploadHistory({
          source: request.source || UPLOAD_SOURCES.IMAGE,
          fileName: request.fileName,
          success: true,
          url: result.url
        });
        sendResponse({ success: true, result });
      } catch (error) {
        const friendlyMessage = getUserFriendlyErrorMessage(error);
        log('error', `图片URL上传失败`, { error: error.message, url: request.imageUrl });
        await recordUploadHistory({
          source: request.source || UPLOAD_SOURCES.IMAGE,
          fileName: request.fileName,
          success: false,
          error: friendlyMessage
        });
        sendResponse({ success: false, error: friendlyMessage });
      }
    })();
    return true; // 保持消息通道开放
  }
  
  if (request.action === 'getUploadPlan') {
    // 内容脚本据此决定走单请求还是分块上传
    (async () => {
      try {
        const config = await getConfig();
        const channel = config.uploadChannel;

        sendResponse({
          success: true,
          plan: {
            channel,
            limit: getChannelLimit(channel),
            chunkSize: getChunkSize(channel),
            supportsChunked: supportsChunkedUpload(channel),
            chunkedThreshold: CONSTANTS.CHUNKED_UPLOAD_THRESHOLD,
            timeout: config.uploadTimeout
          }
        });
      } catch (error) {
        log('error', '获取上传计划失败', { error: error.message });
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'chunkedUploadInit') {
    (async () => {
      try {
        const config = await getConfig();
        log('info', `初始化分块上传: ${request.fileName}`, { totalChunks: request.totalChunks });
        const uploadId = await initChunkedUpload(
          config,
          request.fileName,
          request.fileType,
          request.totalChunks
        );
        sendResponse({ success: true, uploadId });
      } catch (error) {
        sendResponse({ success: false, error: getUserFriendlyErrorMessage(error) });
      }
    })();
    return true;
  }

  if (request.action === 'chunkedUploadChunk') {
    (async () => {
      try {
        const config = await getConfig();
        const chunkBlob = await (await fetch(request.chunkData)).blob();
        await uploadChunk(config, { ...request, chunkBlob });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: getUserFriendlyErrorMessage(error) });
      }
    })();
    return true;
  }

  if (request.action === 'chunkedUploadMerge') {
    (async () => {
      try {
        const config = await getConfig();
        log('info', `合并分块: ${request.fileName}`, { uploadId: request.uploadId });
        const result = await mergeChunkedUpload(config, request);
        await recordUploadHistory({
          source: request.source,
          fileName: request.fileName,
          success: true,
          url: result.url
        });
        sendResponse({ success: true, result });
      } catch (error) {
        const friendlyMessage = getUserFriendlyErrorMessage(error);
        log('error', `分块上传合并失败: ${request.fileName}`, { error: error.message });
        await recordUploadHistory({
          source: request.source,
          fileName: request.fileName,
          success: false,
          error: friendlyMessage
        });
        sendResponse({ success: false, error: friendlyMessage });
      }
    })();
    return true;
  }

  if (request.action === 'chunkedUploadAbort') {
    (async () => {
      try {
        const config = await getConfig();
        await cleanupChunkedUpload(config, request.uploadId, request.totalChunks);
        log('info', '已清理分块上传会话', { uploadId: request.uploadId });
        sendResponse({ success: true });
      } catch (error) {
        log('warn', '清理分块上传会话失败', { error: error.message });
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'copyToClipboard') {
    // 通过 content script 复制到剪贴板
    log('debug', '请求复制到剪贴板');
    chrome.tabs.sendMessage(sender.tab.id, {
      action: 'copyText',
      text: request.text
    });
    return false; // 同步操作，不需要保持通道
  }
});

// 写入上传记录（记录失败不影响上传主流程）
async function recordUploadHistory(entry) {
  try {
    await addUploadRecord(entry);
  } catch (error) {
    log('warn', '上传记录写入失败', { error: error.message });
  }
}

// ==================== 上传功能 ====================

/**
 * 构建上传URL
 * @param {Object} config - 配置对象
 * @returns {string} 上传URL
 */
function buildUploadUrl(config) {
  const params = new URLSearchParams({
    serverCompress: config.serverCompress,
    uploadChannel: config.uploadChannel,
    autoRetry: config.autoRetry,
    uploadNameType: config.uploadNameType,
    returnFormat: config.returnFormat
  });
  
  if (config.authCode && config.authCode.trim()) {
    params.append('authCode', config.authCode);
  }
  
  if (config.channelName && config.channelName.trim()) {
    params.append('channelName', config.channelName);
  }
  
  if (config.uploadFolder) {
    params.append('uploadFolder', config.uploadFolder);
  }
  
  return `${config.apiUrl.replace(/\/$/, '')}/upload?${params.toString()}`;
}

/**
 * 构建上传请求头
 * 优先使用 API Token（Authorization: Bearer），兼容旧版 authCode
 * @param {Object} config - 配置对象
 * @returns {Object} 请求头对象
 */
function buildUploadHeaders(config) {
  const headers = {};
  
  if (config.apiToken && config.apiToken.trim()) {
    headers['Authorization'] = `Bearer ${config.apiToken.trim()}`;
  }
  
  return headers;
}

/**
 * 处理上传响应
 * @param {Response} uploadResponse - fetch 响应
 * @param {Object} config - 配置对象
 * @returns {Promise<{url: string, formatted: string}>} 处理后的结果
 */
async function processUploadResponse(uploadResponse, config) {
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => '');
    log('error', '上传请求失败', {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      response: errorText.substring(0, 200)
    });
    throw createError(
      ErrorTypes.UPLOAD_ERROR,
      `上传失败: ${uploadResponse.status} ${uploadResponse.statusText}`
    );
  }
  
  let result;
  try {
    result = await uploadResponse.json();
  } catch (parseError) {
    log('error', '解析服务器响应失败', { error: parseError.message });
    throw createError(ErrorTypes.PARSE_ERROR, '服务器返回格式错误，无法解析 JSON');
  }
  
  if (!result || !result.length || !result[0].src) {
    log('error', '服务器返回数据格式异常', { result });
    throw createError(ErrorTypes.PARSE_ERROR, '服务器返回格式错误');
  }
  
  // 优先使用服务端返回的 publicUrl（配置 urlPrefix 时返回 CDN 加速链接）
  let imageUrl = result[0].publicUrl || result[0].src;
  
  // 处理URL
  imageUrl = normalizeImageUrl(imageUrl, config.apiUrl);
  
  return {
    url: imageUrl,
    formatted: imageUrl
  };
}

/**
 * 规范化图片URL
 *
 * 只处理服务端返回的相对路径（returnFormat=default 时 src 形如 /file/xxx）。
 * 绝对地址一律原样返回：服务端返回的 publicUrl 由「默认 URL 前缀」拼接而成，
 * 域名通常与站点域名不同（CDN 加速域名），改写 hostname 会直接破坏该链接。
 *
 * @param {string} imageUrl - 原始图片URL
 * @param {string} apiUrl - API地址
 * @returns {string} 规范化后的URL
 */
function normalizeImageUrl(imageUrl, apiUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl) return imageUrl;

  // 相对路径补全服务端域名
  if (imageUrl.startsWith('/')) {
    return apiUrl.replace(/\/$/, '') + imageUrl;
  }

  // 绝对地址（含 publicUrl）保持原样
  return imageUrl;
}

/**
 * 上传文件到图床
 * @param {string} fileData - Base64 编码的文件数据
 * @param {string} fileName - 文件名
 * @returns {Promise<{url: string, formatted: string}>} 上传结果
 */
async function uploadFile(fileData, fileName) {
  const config = await getConfig();
  
  if (!config.apiUrl) {
    throw createError(ErrorTypes.CONFIG_ERROR, '请先配置 API 地址！');
  }
  
  log('debug', '上传配置', {
    apiUrl: config.apiUrl,
    channel: config.uploadChannel,
    compress: config.serverCompress,
    autoRetry: config.autoRetry
  });
  
  const uploadUrl = buildUploadUrl(config);
  
  let response;
  let blob;
  
  try {
    // 将 base64 转换为 blob
    response = await fetch(fileData);
    blob = await response.blob();

    // 按渠道校验文件大小（与上游官方限制保持一致）
    const channelLimit = getChannelLimit(config.uploadChannel);
    if (blob.size > channelLimit) {
      throw createError(
        ErrorTypes.UPLOAD_ERROR,
        `文件大小 ${formatFileSize(blob.size)} 超过 ${config.uploadChannel} 渠道上限 ${formatFileSize(channelLimit)}`
      );
    }

    // 大文件自动走分块（仅支持分块的渠道），避免单请求体超限
    if (supportsChunkedUpload(config.uploadChannel) && blob.size > CONSTANTS.CHUNKED_UPLOAD_THRESHOLD) {
      return await uploadBlobChunkedDirect(config, blob, fileName);
    }

    const formData = new FormData();
    formData.append('file', blob, fileName);
    
    log('debug', '发送上传请求', { url: uploadUrl, fileSize: blob.size });
    
    // 根据配置决定是否使用重试
    const uploadTimeout = config.uploadTimeout;
    const uploadHeaders = buildUploadHeaders(config);
    let uploadResponse;
    
    if (config.autoRetry) {
      uploadResponse = await fetchWithRetry(uploadUrl, {
        method: 'POST',
        headers: uploadHeaders,
        body: formData
      }, {
        maxRetries: CONSTANTS.MAX_RETRIES,
        timeout: uploadTimeout,
        shouldRetry: (error, resp) => {
          if (error) return true;
          // 5xx 错误重试，4xx 错误不重试
          return resp && resp.status >= 500;
        }
      });
    } else {
      uploadResponse = await fetchWithTimeout(uploadUrl, {
        method: 'POST',
        headers: uploadHeaders,
        body: formData
      }, uploadTimeout);
    }
    
    return await processUploadResponse(uploadResponse, config);
    
  } finally {
    // 清理资源：body 已被消费时 cancel() 会抛错，需先判断 bodyUsed 并吞掉 Promise 拒绝
    if (response && response.body && !response.bodyUsed) {
      response.body.cancel().catch(() => {});
    }
  }
}

// ==================== 分块上传 ====================
// 对应上游官方文档的分块流程：初始化 → 逐块上传 → 合并；中途失败可发清理请求

/**
 * 构建上传基础地址
 * @param {Object} config - 配置对象
 * @returns {string}
 */
function buildUploadBaseUrl(config) {
  return `${config.apiUrl.replace(/\/$/, '')}/upload`;
}

/**
 * 构建分块上传的查询串（认证信息与非敏感参数）
 * @param {Object} config - 配置对象
 * @param {Object} extra - 额外参数
 * @returns {string}
 */
function buildChunkedQuery(config, extra = {}) {
  const params = new URLSearchParams({ uploadChannel: config.uploadChannel });

  if (config.channelName && config.channelName.trim()) {
    params.append('channelName', config.channelName);
  }
  if (config.authCode && config.authCode.trim()) {
    params.append('authCode', config.authCode);
  }

  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });

  return params.toString();
}

/**
 * 解析分块相关接口的 JSON 响应
 * @param {Response} response - fetch 响应
 * @param {string} actionLabel - 操作名称（用于错误提示）
 * @returns {Promise<any>}
 */
async function parseChunkResponse(response, actionLabel) {
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    log('error', `${actionLabel}失败`, {
      status: response.status,
      statusText: response.statusText,
      response: errorText.substring(0, 200)
    });
    throw createError(
      ErrorTypes.UPLOAD_ERROR,
      `${actionLabel}失败: ${response.status} ${response.statusText}`
    );
  }

  try {
    const data = await response.json();

    // 上游分块接口可能以 200 + { success: false, message } 形式返回失败
    if (data && data.success === false) {
      throw createError(
        ErrorTypes.UPLOAD_ERROR,
        `${actionLabel}失败: ${data.message || data.error || '服务端返回失败'}`
      );
    }

    return data;
  } catch (parseError) {
    if (parseError.type) throw parseError;
    log('error', `${actionLabel}响应解析失败`, { error: parseError.message });
    throw createError(ErrorTypes.PARSE_ERROR, '服务器返回格式错误，无法解析 JSON');
  }
}

/**
 * 第一步：初始化分块上传会话
 * @returns {Promise<string>} uploadId
 */
async function initChunkedUpload(config, fileName, fileType, totalChunks) {
  const url = `${buildUploadBaseUrl(config)}?${buildChunkedQuery(config, { initChunked: 'true' })}`;

  const formData = new FormData();
  formData.append('originalFileName', fileName);
  formData.append('originalFileType', fileType);
  formData.append('totalChunks', String(totalChunks));

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: buildUploadHeaders(config),
    body: formData
  }, config.uploadTimeout);

  const data = await parseChunkResponse(response, '初始化分块上传');
  if (!data || !data.uploadId) {
    throw createError(ErrorTypes.UPLOAD_ERROR, '初始化分块上传失败：服务端未返回 uploadId');
  }

  log('info', '分块上传已初始化', { uploadId: data.uploadId, totalChunks });
  return data.uploadId;
}

/**
 * 第二步：上传单个分块
 * @param {Object} payload - 分块信息（含 chunkBlob）
 * @returns {Promise<boolean>}
 */
async function uploadChunk(config, payload) {
  const { uploadId, chunkIndex, totalChunks, fileName, fileType, chunkBlob } = payload;
  const url = `${buildUploadBaseUrl(config)}?${buildChunkedQuery(config, { chunked: 'true' })}`;

  const formData = new FormData();
  formData.append('file', chunkBlob, fileName);
  formData.append('uploadId', uploadId);
  formData.append('chunkIndex', String(chunkIndex));
  formData.append('totalChunks', String(totalChunks));
  formData.append('originalFileName', fileName);
  formData.append('originalFileType', fileType);

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: buildUploadHeaders(config),
    body: formData
  }, config.uploadTimeout);

  await parseChunkResponse(response, `上传分块 ${chunkIndex + 1}/${totalChunks}`);
  return true;
}

/**
 * 第三步：合并分块
 * @param {Object} payload - 合并信息
 * @returns {Promise<{url: string, formatted: string}>}
 */
async function mergeChunkedUpload(config, payload) {
  const { uploadId, totalChunks, fileName, fileType } = payload;

  const extra = {
    chunked: 'true',
    merge: 'true',
    returnFormat: config.returnFormat
  };
  if (config.uploadFolder) {
    extra.uploadFolder = config.uploadFolder;
  }

  const url = `${buildUploadBaseUrl(config)}?${buildChunkedQuery(config, extra)}`;

  const formData = new FormData();
  formData.append('uploadId', uploadId);
  formData.append('totalChunks', String(totalChunks));
  formData.append('originalFileName', fileName);
  formData.append('originalFileType', fileType);

  const requestOptions = {
    method: 'POST',
    headers: buildUploadHeaders(config),
    body: formData
  };

  const response = config.autoRetry
    ? await fetchWithRetry(url, requestOptions, {
        maxRetries: CONSTANTS.MAX_RETRIES,
        timeout: config.uploadTimeout,
        shouldRetry: (error, resp) => (error ? true : Boolean(resp && resp.status >= 500))
      })
    : await fetchWithTimeout(url, requestOptions, config.uploadTimeout);

  return processUploadResponse(response, config);
}

/**
 * 清理分块上传会话（失败或取消时释放服务端临时数据）
 */
async function cleanupChunkedUpload(config, uploadId, totalChunks) {
  const url = `${buildUploadBaseUrl(config)}?${buildChunkedQuery(config, {
    cleanup: 'true',
    uploadId,
    totalChunks
  })}`;

  await fetchWithTimeout(url, { method: 'POST' }, CONSTANTS.CONNECTION_TIMEOUT);
}

/**
 * 后台内部的完整分块上传（用于跨域图片转存等已在后台拿到 Blob 的场景）
 * 分块直接以 Blob 切片提交，避免 base64 往返带来的内存开销
 *
 * @param {Object} config - 配置对象
 * @param {Blob} blob - 文件数据
 * @param {string} fileName - 文件名
 * @returns {Promise<{url: string, formatted: string}>}
 */
async function uploadBlobChunkedDirect(config, blob, fileName) {
  const fileType = blob.type || 'application/octet-stream';
  const chunkSize = getChunkSize(config.uploadChannel);
  const totalChunks = Math.ceil(blob.size / chunkSize);

  log('info', '开始分块上传', { fileName, size: blob.size, chunkSize, totalChunks });

  const uploadId = await initChunkedUpload(config, fileName, fileType, totalChunks);

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * chunkSize;
      const chunkBlob = blob.slice(start, Math.min(start + chunkSize, blob.size));

      await uploadChunk(config, {
        uploadId,
        chunkIndex: index,
        totalChunks,
        fileName,
        fileType,
        chunkBlob
      });
    }

    return await mergeChunkedUpload(config, { uploadId, totalChunks, fileName, fileType });
  } catch (error) {
    cleanupChunkedUpload(config, uploadId, totalChunks).catch(() => {});
    throw error;
  }
}

// ==================== 工具函数 ====================

// arrayBufferToBase64 函数已移至 utils.js，使用导入的版本

/**
 * 通过 background script 获取跨域图片并上传
 * @param {string} imageUrl - 图片 URL
 * @param {string} fileName - 文件名
 * @returns {Promise<{url: string, formatted: string}>} 上传结果
 */
async function uploadImageFromUrl(imageUrl, fileName) {
  // 首先验证URL安全性
  if (!validateImageUrl(imageUrl)) {
    throw createError(ErrorTypes.NETWORK_ERROR, '无效或不安全的图片URL');
  }
  
  try {
    // 构建请求选项
    const requestOptions = buildRequestOptions(imageUrl);
    const blob = await fetchImageWithFallback(imageUrl, requestOptions);
    
    // 验证图片文件
    await validateImageFile(blob);
    
    log('debug', `图片获取成功`, { size: blob.size, type: blob.type });
    
    // 转换为 base64
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const mimeType = blob.type || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    log('info', '图片获取成功，开始上传...');
    // 调用现有的上传函数
    return await uploadFile(dataUrl, fileName);
    
  } catch (error) {
    throw createError(ErrorTypes.NETWORK_ERROR, `跨域图片上传失败: ${error.message}`, error);
  }
}

/**
 * 构建请求选项
 * @param {string} imageUrl - 图片URL
 * @returns {Array} 请求选项数组
 */
function buildRequestOptions(imageUrl) {
  const referer = new URL(imageUrl).origin;
  
  return [
    // 第一次尝试：模拟浏览器请求
    {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    },
    // 第二次尝试：简化请求头
    {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8'
      }
    },
    // 第三次尝试：最基本的请求
    {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ImageUploader/1.0)'
      }
    }
  ];
}

/**
 * 使用fallback机制获取图片
 * @param {string} imageUrl - 图片URL
 * @param {Array} requestOptions - 请求选项数组
 * @returns {Promise<Blob>} 图片blob
 */
async function fetchImageWithFallback(imageUrl, requestOptions) {
  let lastError;
  
  // 依次尝试不同的请求配置
  for (let i = 0; i < requestOptions.length; i++) {
    try {
      log('debug', `尝试获取图片 (方式 ${i + 1})`, { url: imageUrl });
      const response = await fetchWithTimeout(imageUrl, requestOptions[i], CONSTANTS.CONNECTION_TIMEOUT);
      
      if (response.ok) {
        const blob = await response.blob();
        
        // 检查是否真的是图片
        if (!blob.type.startsWith('image/')) {
          log('warn', `响应不是图片格式`, { type: blob.type });
          throw new Error(`响应不是图片格式: ${blob.type}`);
        }
        
        return blob;
      } else {
        lastError = createError(
          ErrorTypes.NETWORK_ERROR,
          `HTTP ${response.status}: ${response.statusText}`
        );
        log('debug', `方式 ${i + 1} 失败`, { error: lastError.message });
      }
    } catch (error) {
      lastError = error;
      log('debug', `方式 ${i + 1} 异常`, { error: error.message });
    }
  }
  
  // 所有方式都失败了
  log('error', '所有获取方式都失败', { lastError: lastError?.message });
  throw lastError || createError(ErrorTypes.NETWORK_ERROR, '所有获取方式都失败了');
}
