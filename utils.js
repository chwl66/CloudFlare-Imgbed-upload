// ==================== 公共工具模块 ====================
// 提供统一的工具函数，避免代码重复

// ==================== 常量定义 ====================
const MB = 1024 * 1024;

const CONSTANTS = {
  // 文件相关
  CHUNK_SIZE: 8192, // base64 编码时每次处理的字节数
  MAX_FILE_SIZE: 100 * MB, // 单次请求体硬上限（Cloudflare Pages 部署上限 100MB）
  TRUNCATE_LENGTH: 55,

  // 各渠道单文件上限（依据上游官方 API 文档：cfbed.sanyue.de/api/upload.html）
  // 支持分块上传的渠道按 Cloudflare Pages 的 100MB 请求体上限处理
  CHANNEL_LIMITS: {
    telegram: 100 * MB,
    cfr2: 100 * MB,
    s3: 100 * MB,
    discord: 100 * MB,
    huggingface: 20 * MB, // ≥20MB 需走 HuggingFace 直传流程，扩展暂未实现
    webdav: 100 * MB
  },

  // 支持分块上传的渠道（HuggingFace 有独立的直传流程，WebDAV 不支持分块）
  CHUNKED_CHANNELS: ['telegram', 'cfr2', 's3', 'discord'],

  // 各渠道推荐分块大小（官方文档建议值）
  CHUNK_SIZE_BY_CHANNEL: {
    telegram: 16 * MB,
    cfr2: 8 * MB,
    s3: 8 * MB,
    discord: 8 * MB
  },

  // 超过该大小才走分块上传，小文件仍走单请求
  CHUNKED_UPLOAD_THRESHOLD: 8 * MB,
  
  // 超时设置
  UPLOAD_TIMEOUT: 60000, // 60秒（可配置）
  CONNECTION_TIMEOUT: 15000, // 15秒
  TEST_TIMEOUT: 10000, // 10秒
  
  // 重试设置
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1秒
  RETRY_BACKOFF: 2, // 指数退避倍数
  
  // 图片文件签名
  IMAGE_SIGNATURES: {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/gif': [0x47, 0x49, 0x46],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
    'image/bmp': [0x42, 0x4D],
    'image/svg+xml': [0x3C, 0x3F, 0x78, 0x6D, 0x6C], // <?xml
    'image/ico': [0x00, 0x00, 0x01, 0x00]
  },
  
  // 有效配置值（与上游官方 /upload 接口的 uploadChannel 枚举保持一致，不含 external）
  VALID_UPLOAD_CHANNELS: ['telegram', 'cfr2', 's3', 'discord', 'huggingface', 'webdav'],
  VALID_NAME_TYPES: ['default', 'index', 'origin', 'short'],
  VALID_RETURN_FORMATS: ['default', 'full'],

  // 上传来源（用于上传记录标识）
  UPLOAD_SOURCES: {
    IMAGE: 'image',
    CLIPBOARD: 'clipboard',
    DRAG: 'drag',
    UNKNOWN: 'unknown'
  },
  
  // 私有IP地址范围
  PRIVATE_IP_RANGES: [
    /^127\./,           // 127.0.0.0/8
    /^10\./,            // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,      // 192.168.0.0/16
    /^localhost$/i,
    /^::1$/,            // IPv6 localhost
    /^fc00:/,           // IPv6 private
    /^0\./,             // 0.0.0.0/8
    /^169\.254\./       // 链路本地地址
  ]
};

// ==================== 上传能力工具 ====================

/**
 * 获取指定渠道的单文件上限
 * @param {string} channel - 上传渠道
 * @returns {number} 字节数
 */
function getChannelLimit(channel) {
  return CONSTANTS.CHANNEL_LIMITS[channel] || CONSTANTS.MAX_FILE_SIZE;
}

/**
 * 获取指定渠道的分块大小
 * @param {string} channel - 上传渠道
 * @returns {number} 字节数
 */
function getChunkSize(channel) {
  return CONSTANTS.CHUNK_SIZE_BY_CHANNEL[channel] || CONSTANTS.CHUNKED_UPLOAD_THRESHOLD;
}

/**
 * 判断渠道是否支持分块上传
 * @param {string} channel - 上传渠道
 * @returns {boolean}
 */
function supportsChunkedUpload(channel) {
  return CONSTANTS.CHUNKED_CHANNELS.includes(channel);
}

/**
 * 格式化文件大小（用于提示文案）
 * @param {number} bytes - 字节数
 * @returns {string} 如 "12.3MB"
 */
function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return '未知大小';
  if (size < 1024) return `${size}B`;
  if (size < MB) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / MB).toFixed(1)}MB`;
}

// ==================== 网络请求工具 ====================

/**
 * 带超时的 fetch 请求
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Response>} fetch 响应
 */
async function fetchWithTimeout(url, options = {}, timeout = CONSTANTS.CONNECTION_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('请求超时，服务器响应时间过长');
    }
    throw error;
  }
}

/**
 * 带重试的 fetch 请求
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {Object} retryOptions - 重试选项
 * @returns {Promise<Response>} fetch 响应
 */
async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const {
    maxRetries = CONSTANTS.MAX_RETRIES,
    retryDelay = CONSTANTS.RETRY_DELAY,
    backoff = CONSTANTS.RETRY_BACKOFF,
    timeout = CONSTANTS.CONNECTION_TIMEOUT,
    shouldRetry = (error, response) => {
      // 网络错误或 5xx 错误时重试
      if (error) return true;
      return response && response.status >= 500 && response.status < 600;
    }
  } = retryOptions;
  
  let lastError;
  let lastResponse;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeout);
      
      // 检查是否需要重试
      if (!shouldRetry(null, response) || attempt === maxRetries) {
        return response;
      }
      
      lastResponse = response;
    } catch (error) {
      lastError = error;
      
      // 最后一次尝试或不应重试
      if (attempt === maxRetries || !shouldRetry(error, null)) {
        throw error;
      }
    }
    
    // 等待后重试（指数退避）
    const delay = retryDelay * Math.pow(backoff, attempt);
    await sleep(delay);
    console.log(`[ImgBed] 重试第 ${attempt + 1} 次，延迟 ${delay}ms`);
  }
  
  // 如果有响应返回响应，否则抛出错误
  if (lastResponse) return lastResponse;
  throw lastError;
}

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 语义化版本比较
 * @param {string} v1 - 版本1
 * @param {string} v2 - 版本2
 * @returns {number} -1: v1 < v2, 0: v1 = v2, 1: v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  const maxLength = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  
  return 0;
}

// ==================== 安全验证工具 ====================

/**
 * 验证图片URL是否安全（防止SSRF）
 * @param {string} url - 图片URL
 * @returns {boolean} 是否安全
 */
function validateImageUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // 只允许HTTP/HTTPS协议
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
    
    // 禁止内网IP地址
    const hostname = urlObj.hostname;
    for (const range of CONSTANTS.PRIVATE_IP_RANGES) {
      if (range.test(hostname)) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * 验证图片文件类型和内容
 * @param {File|Blob} file - 文件对象
 * @param {Object} options - 验证选项
 * @returns {Promise<boolean>} 是否为有效图片
 */
async function validateImageFile(file, options = {}) {
  const { maxSize = CONSTANTS.MAX_FILE_SIZE, strictMode = false, channel = '' } = options;
  
  // 检查文件大小
  if (file.size > maxSize) {
    const channelHint = channel ? `（${channel} 渠道）` : '';
    throw new Error(
      `文件大小 ${formatFileSize(file.size)} 超过上限 ${formatFileSize(maxSize)}${channelHint}`
    );
  }
  
  // 检查文件是否为空
  if (file.size === 0) {
    throw new Error('文件为空');
  }
  
  // 检查MIME类型
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('不是有效的图片文件');
  }
  
  // 检查文件头
  const buffer = await file.slice(0, 12).arrayBuffer();
  const view = new Uint8Array(buffer);
  
  const isValidSignature = Object.values(CONSTANTS.IMAGE_SIGNATURES).some(sig => 
    sig.every((byte, index) => view[index] === byte)
  );
  
  // SVG 特殊处理（可能以 < 开头而非 <?xml）
  const isSvg = view[0] === 0x3C && (file.type === 'image/svg+xml' || 
    (file.name && file.name.toLowerCase().endsWith('.svg')));
  
  if (!isValidSignature && !isSvg) {
    if (strictMode) {
      throw new Error('文件头与扩展名不匹配，可能不是有效的图片文件');
    }
    console.warn('[ImgBed] 文件头验证未通过，但继续上传');
  }
  
  return true;
}

// ==================== 字符串处理工具 ====================

/**
 * HTML转义，防止XSS攻击
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 智能截断文本
 * @param {string} text - 要截断的文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的文本
 */
function truncateText(text, maxLength = CONSTANTS.TRUNCATE_LENGTH) {
  if (text.length <= maxLength) return text;
  const start = text.substring(0, 30);
  const end = text.substring(text.length - 20);
  return `${start}...${end}`;
}

// ==================== 文件处理工具 ====================

/**
 * 安全的 ArrayBuffer 转 Base64 函数
 * @param {ArrayBuffer} arrayBuffer - 要转换的 ArrayBuffer
 * @returns {string} Base64 编码的字符串
 */
function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = CONSTANTS.CHUNK_SIZE;
  let binary = '';
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  
  return btoa(binary);
}

/**
 * 从URL获取文件名
 * @param {string} url - URL地址
 * @returns {string} 文件名
 */
function getFileNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const fileName = pathname.split('/').pop();
    return fileName || 'image.jpg';
  } catch (error) {
    console.warn('解析文件名失败:', error.message, 'URL:', url);
    return 'image.jpg';
  }
}

// ==================== 错误处理工具 ====================

/**
 * 获取用户友好的错误消息
 * @param {Error} error - 错误对象
 * @param {number} status - HTTP状态码
 * @returns {string} 用户友好的错误消息
 */
function getFriendlyErrorMessage(error, status = null) {
  const message = error?.message || '';
  
  // 根据状态码返回友好消息
  if (status) {
    const statusMessages = {
      400: '请求参数错误（400）',
      401: '认证失败（401），请检查认证码',
      403: '访问被拒绝（403），请检查权限设置',
      404: 'API 地址不存在（404），请检查地址是否正确',
      405: '请求方法不允许（405）',
      408: '请求超时（408）',
      409: '请求冲突（409）',
      413: '请求实体过大（413）',
      429: '请求过于频繁（429）',
      500: '服务器内部错误（500），请稍后重试',
      502: '网关错误（502），服务器可能正在重启',
      503: '服务不可用（503），服务器可能过载',
      504: '网关超时（504），服务器响应过慢',
      522: '连接超时（522），无法连接到服务器',
      524: '服务器响应超时（524），请检查服务器状态'
    };
    
    if (statusMessages[status]) {
      return statusMessages[status];
    }
  }
  
  // 根据错误消息返回友好消息
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return '网络连接失败，请检查网络设置';
  }
  if (message.includes('timeout') || message.includes('AbortError')) {
    return '请求超时，请检查网络或稍后重试';
  }
  if (message.includes('超过上限') || message.includes('文件大小超过限制')) {
    return message;
  }
  if (message.includes('不是有效的图片文件')) {
    return message;
  }
  if (message.includes('文件头与扩展名不匹配')) {
    return message;
  }
  
  return message || '未知错误';
}

// ==================== 事件管理工具 ====================

/**
 * 事件管理器类，用于统一管理事件监听器
 */
class EventManager {
  static listeners = new Map();
  
  /**
   * 添加事件监听器
   * @param {Element} element - 目标元素
   * @param {string} event - 事件类型
   * @param {Function} handler - 事件处理函数
   * @param {Object} options - 事件选项
   * @returns {Function} 包装后的处理函数（用于移除）
   */
  static add(element, event, handler, options = {}) {
    // 使用元素和事件类型生成唯一键
    const elementId = element._eventManagerId || (element._eventManagerId = Math.random().toString(36).substr(2, 9));
    const key = `${elementId}-${event}`;
    
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    
    // 不再绑定 this，保持原始上下文
    element.addEventListener(event, handler, options);
    
    this.listeners.get(key).push({
      element,
      event,
      handler,
      options
    });
    
    return handler;
  }
  
  /**
   * 移除事件监听器
   * @param {Element} element - 目标元素
   * @param {string} event - 事件类型
   * @param {Function} handler - 可选，指定要移除的处理函数
   */
  static remove(element, event, handler = null) {
    const elementId = element._eventManagerId;
    if (!elementId) return;
    
    const key = `${elementId}-${event}`;
    const listeners = this.listeners.get(key) || [];
    
    if (handler) {
      // 移除指定的处理函数
      const index = listeners.findIndex(l => l.handler === handler);
      if (index !== -1) {
        element.removeEventListener(event, handler);
        listeners.splice(index, 1);
      }
    } else {
      // 移除该元素该事件的所有监听器
      listeners.forEach(({ handler: h }) => {
        element.removeEventListener(event, h);
      });
      this.listeners.delete(key);
    }
  }
  
  /**
   * 清理所有事件监听器
   */
  static cleanup() {
    this.listeners.forEach((listeners) => {
      listeners.forEach(({ element, event, handler }) => {
        try {
          element.removeEventListener(event, handler);
        } catch (e) {
          // 忽略已移除元素的错误
        }
      });
    });
    this.listeners.clear();
  }
  
  /**
   * 获取已注册的监听器数量
   * @returns {number} 监听器数量
   */
  static getListenerCount() {
    let count = 0;
    this.listeners.forEach(listeners => {
      count += listeners.length;
    });
    return count;
  }
}

// ==================== 复制工具 ====================

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @param {HTMLElement} element - 触发复制的元素（用于视觉反馈）
 * @returns {Promise<void>}
 */
async function copyTextToClipboard(text, element = null) {
  try {
    // 优先使用现代API
    await navigator.clipboard.writeText(text);
    
    // 提供视觉反馈
    if (element) {
      showCopyFeedback(element);
    }
  } catch (error) {
    // 降级方案：使用临时文本区域
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.cssText = `
        position: fixed;
        top: -9999px;
        left: -9999px;
        opacity: 0;
        pointer-events: none;
      `;
      document.body.appendChild(textArea);
      textArea.select();
      textArea.setSelectionRange(0, 99999); // 移动设备兼容
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        if (element) {
          showCopyFeedback(element);
        }
      } else {
        throw new Error('复制命令执行失败');
      }
    } catch (fallbackError) {
      console.error('复制失败:', fallbackError);
      throw new Error('无法复制到剪贴板，请手动复制');
    }
  }
}

/**
 * 显示复制成功反馈
 * @param {HTMLElement} element - 触发复制的元素
 */
function showCopyFeedback(element) {
  const feedback = document.createElement('div');
  feedback.innerHTML = '✓ 已复制';
  feedback.style.cssText = `
    position: absolute;
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    z-index: 10002;
    pointer-events: none;
    opacity: 0;
    transform: translateY(10px) scale(0.9);
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    backdrop-filter: blur(10px);
  `;
  
  // 定位到元素右上角
  const rect = element.getBoundingClientRect();
  feedback.style.left = (rect.right - 80) + 'px';
  feedback.style.top = (rect.top - 40) + 'px';
  
  document.body.appendChild(feedback);
  
  // 显示动画
  setTimeout(() => {
    feedback.style.opacity = '1';
    feedback.style.transform = 'translateY(0) scale(1)';
  }, 10);
  
  // 1.5秒后移除
  setTimeout(() => {
    feedback.style.opacity = '0';
    feedback.style.transform = 'translateY(-10px) scale(0.9)';
    setTimeout(() => {
      if (feedback.parentNode) {
        feedback.parentNode.removeChild(feedback);
      }
    }, 300);
  }, 1500);
}