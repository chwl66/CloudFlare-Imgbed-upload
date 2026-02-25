// 导入公共配置模块
importScripts('utils.js');
importScripts('config.js');

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

  const { authCode, ...syncDefaults } = DEFAULT_CONFIG;
  const mergedSyncConfig = { ...syncDefaults };

  SYNC_CONFIG_KEYS.forEach(key => {
    if (syncData[key] !== undefined) {
      mergedSyncConfig[key] = syncData[key];
    }
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
    // 图片右键菜单
    chrome.contextMenus.create({
      id: 'upload-image',
      title: '上传图片到 ImgBed',
      contexts: ['image']
    });
    
    // 页面右键菜单 - 上传剪贴板图片
    chrome.contextMenus.create({
      id: 'upload-clipboard',
      title: '上传剪贴板图片到 ImgBed',
      contexts: ['page']
    });
    
    // 分隔符
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['page', 'image']
    });
    
    // 配置菜单
    chrome.contextMenus.create({
      id: 'open-config',
      title: 'ImgBed 配置',
      contexts: ['page', 'image']
    });
    
    log('debug', '右键菜单已创建');
  });
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  log('debug', `菜单点击: ${info.menuItemId}`);
  
  switch (info.menuItemId) {
    case 'upload-image':
      // 上传图片
      chrome.tabs.sendMessage(tab.id, {
        action: 'uploadImage',
        imageUrl: info.srcUrl
      });
      break;
      
    case 'upload-clipboard':
      // 上传剪贴板图片
      chrome.tabs.sendMessage(tab.id, {
        action: 'uploadClipboard'
      });
      break;
      
    case 'open-config':
      // 打开配置页面
      chrome.action.openPopup();
      break;
  }
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
        sendResponse({ success: true, result });
      } catch (error) {
        const friendlyMessage = getUserFriendlyErrorMessage(error);
        log('error', `文件上传失败: ${request.fileName}`, { error: error.message });
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
        sendResponse({ success: true, result });
      } catch (error) {
        const friendlyMessage = getUserFriendlyErrorMessage(error);
        log('error', `图片URL上传失败`, { error: error.message, url: request.imageUrl });
        sendResponse({ success: false, error: friendlyMessage });
      }
    })();
    return true; // 保持消息通道开放
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
    returnFormat: config.returnFormat || DEFAULT_CONFIG.returnFormat
  });
  
  if (config.authCode && config.authCode.trim()) {
    params.append('authCode', config.authCode);
  }
  
  if (config.uploadFolder) {
    params.append('uploadFolder', config.uploadFolder);
  }
  
  return `${config.apiUrl.replace(/\/$/, '')}/upload?${params.toString()}`;
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
  
  let imageUrl = result[0].src;
  
  // 处理URL
  imageUrl = normalizeImageUrl(imageUrl, config.apiUrl);
  
  return {
    url: imageUrl,
    formatted: imageUrl
  };
}

/**
 * 规范化图片URL
 * @param {string} imageUrl - 原始图片URL
 * @param {string} apiUrl - API地址
 * @returns {string} 规范化后的URL
 */
function normalizeImageUrl(imageUrl, apiUrl) {
  // 如果返回的是相对路径，添加域名
  if (imageUrl.startsWith('/')) {
    return apiUrl.replace(/\/$/, '') + imageUrl;
  }
  
  // 智能域名替换
  try {
    const configUrl = new URL(apiUrl);
    const returnUrl = new URL(imageUrl);
    
    if (returnUrl.hostname !== configUrl.hostname) {
      returnUrl.protocol = configUrl.protocol;
      returnUrl.hostname = configUrl.hostname;
      returnUrl.port = configUrl.port;
      const newUrl = returnUrl.toString();
      log('info', '域名已替换为配置项中的域名', { newUrl });
      return newUrl;
    }
  } catch (error) {
    log('warn', '域名替换失败', { error: error.message });
  }
  
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
    
    const formData = new FormData();
    formData.append('file', blob, fileName);
    
    log('debug', '发送上传请求', { url: uploadUrl, fileSize: blob.size });
    
    // 根据配置决定是否使用重试
    const uploadTimeout = config.uploadTimeout || CONSTANTS.UPLOAD_TIMEOUT;
    let uploadResponse;
    
    if (config.autoRetry) {
      uploadResponse = await fetchWithRetry(uploadUrl, {
        method: 'POST',
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
        body: formData
      }, uploadTimeout);
    }
    
    return await processUploadResponse(uploadResponse, config);
    
  } finally {
    // 清理资源
    if (response && response.body) {
      try {
        response.body.cancel();
      } catch (e) {
        // 忽略清理错误
      }
    }
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
