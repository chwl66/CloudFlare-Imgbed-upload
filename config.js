// 公共配置文件 - 统一管理默认配置
// 默认配置
const DEFAULT_CONFIG = {
  apiUrl: '', // 空字符串，强制用户配置
  authCode: '',
  serverCompress: true,
  uploadChannel: 'telegram',
  autoRetry: true,
  uploadNameType: 'default',
  uploadFolder: '',
  uploadTimeout: 60000, // 上传超时时间（毫秒）
  returnFormat: 'full'
};

// 配置键列表
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);
const CONFIG_META_KEYS = ['_version'];
const SENSITIVE_CONFIG_KEYS = ['authCode'];
const SYNC_CONFIG_KEYS = CONFIG_KEYS.filter(key => !SENSITIVE_CONFIG_KEYS.includes(key));

// 配置版本管理
const CONFIG_VERSION = '1.3.0';

// 认证码掩码标记
const AUTH_CODE_MASK_MARKER = '••••••';
const INVALID_API_HOSTS = ['your.domain'];

/**
 * 判断 API 地址是否为示例占位域名
 * @param {string} apiUrl
 * @returns {boolean}
 */
function isInvalidApiHost(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    return INVALID_API_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 规范化 API 地址
 * @param {string} apiUrl
 * @returns {string}
 */
function normalizeApiUrlValue(apiUrl) {
  const trimmed = typeof apiUrl === 'string' ? apiUrl.trim() : '';
  if (!trimmed) return '';

  try {
    const parsedUrl = new URL(trimmed);
    if (isInvalidApiHost(parsedUrl.toString())) {
      return '';
    }
    return parsedUrl.toString().replace(/\/$/, '');
  } catch {
    // 非法 URL 保留原值，交由 validateConfig 报错
    return trimmed;
  }
}

/**
 * 规范化上传目录
 * @param {string} uploadFolder
 * @returns {string}
 */
function normalizeUploadFolderValue(uploadFolder) {
  const trimmed = typeof uploadFolder === 'string' ? uploadFolder.trim() : '';
  if (!trimmed) return '';

  return trimmed
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * 规范化布尔配置值
 * @param {any} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function normalizeBooleanValue(value, defaultValue) {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return defaultValue;
}

// 获取配置
async function getConfig() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([...SYNC_CONFIG_KEYS, ...CONFIG_META_KEYS, ...SENSITIVE_CONFIG_KEYS]),
    chrome.storage.local.get(SENSITIVE_CONFIG_KEYS)
  ]);

  const mergedConfig = { ...DEFAULT_CONFIG };

  SYNC_CONFIG_KEYS.forEach(key => {
    if (syncData[key] !== undefined) {
      mergedConfig[key] = syncData[key];
    }
  });

  SENSITIVE_CONFIG_KEYS.forEach(key => {
    if (localData[key] !== undefined) {
      mergedConfig[key] = localData[key];
    } else if (syncData[key] !== undefined) {
      // 兼容历史版本：若敏感项仍在 sync，临时读取并迁移
      mergedConfig[key] = syncData[key];
    }
  });

  if (syncData._version) {
    mergedConfig._version = syncData._version;
  }

  // 历史兼容：将敏感项从 sync 迁移到 local
  const legacySensitive = {};
  SENSITIVE_CONFIG_KEYS.forEach(key => {
    if (localData[key] === undefined && typeof syncData[key] === 'string' && syncData[key].trim()) {
      legacySensitive[key] = syncData[key];
    }
  });
  if (Object.keys(legacySensitive).length > 0) {
    await chrome.storage.local.set(legacySensitive);
    await chrome.storage.sync.remove(Object.keys(legacySensitive));
  }

  // 检查配置版本，必要时进行迁移
  await migrateConfigIfNeeded(mergedConfig);

  return normalizeConfig(mergedConfig);
}

// 保存配置
async function saveConfig(config, originalConfig = null) {
  const normalizedConfig = normalizeConfig(config);

  // 使用工具函数验证配置
  const validation = validateConfig(normalizedConfig);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }

  const syncConfig = {};
  const localConfig = {};

  CONFIG_KEYS.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(normalizedConfig, key)) {
      return;
    }

    let value = normalizedConfig[key];

    // 特殊处理认证码：如果是掩码值，保留原值
    if (key === 'authCode' && isMaskedValue(value) && originalConfig) {
      value = originalConfig[key];
    }

    if (SENSITIVE_CONFIG_KEYS.includes(key)) {
      localConfig[key] = value;
    } else {
      syncConfig[key] = value;
    }
  });

  // 添加版本信息（仅 sync）
  syncConfig._version = CONFIG_VERSION;

  await Promise.all([
    chrome.storage.sync.set(syncConfig),
    chrome.storage.local.set(localConfig)
  ]);

  // 防止敏感字段残留在 sync
  await chrome.storage.sync.remove(SENSITIVE_CONFIG_KEYS);

  return { ...syncConfig, ...localConfig };
}

/**
 * 检查值是否为掩码值
 * @param {string} value - 要检查的值
 * @returns {boolean} 是否为掩码值
 */
function isMaskedValue(value) {
  if (!value) return false;
  // 检查是否包含掩码标记或全是星号
  return value === AUTH_CODE_MASK_MARKER || 
         value.includes('••') || 
         /^\*+$/.test(value) ||
         /^.{0,2}\*+.{0,2}$/.test(value);
}

// 验证配置（使用工具函数）
function validateConfig(config) {
  const errors = [];
  const normalized = normalizeConfig(config);

  // API 地址验证
  if (!normalized.apiUrl) {
    errors.push('请输入 API 地址！');
  } else {
    try {
      const url = new URL(normalized.apiUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('API 地址必须使用 HTTP 或 HTTPS 协议！');
      } else if (isInvalidApiHost(normalized.apiUrl)) {
        errors.push('请填写真实 API 地址，不能使用示例域名！');
      }
    } catch {
      errors.push('API 地址格式不正确！');
    }
  }

  // 上传渠道验证
  if (!CONSTANTS.VALID_UPLOAD_CHANNELS.includes(normalized.uploadChannel)) {
    errors.push('无效的上传渠道！');
  }

  // 文件命名方式验证
  if (!CONSTANTS.VALID_NAME_TYPES.includes(normalized.uploadNameType)) {
    errors.push('无效的文件命名方式！');
  }

  // 返回格式验证
  if (!CONSTANTS.VALID_RETURN_FORMATS.includes(normalized.returnFormat)) {
    errors.push('无效的返回格式！');
  }

  // 上传目录验证（如果提供）
  if (normalized.uploadFolder) {
    // 检查路径格式
    if (normalized.uploadFolder.includes('..') || normalized.uploadFolder.includes('//')) {
      errors.push('上传目录格式不正确！');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// 导出配置（用于调试）
async function exportConfig() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(null, (syncData) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      chrome.storage.local.get(SENSITIVE_CONFIG_KEYS, (localData) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve({ ...syncData, ...localData });
      });
    });
  });
}

// 重置配置为默认值
async function resetConfig() {
  await Promise.all([
    chrome.storage.sync.clear(),
    chrome.storage.local.remove(SENSITIVE_CONFIG_KEYS)
  ]);

  const { authCode, ...syncDefaults } = DEFAULT_CONFIG;
  const defaultConfigWithVersion = { ...syncDefaults, _version: CONFIG_VERSION };
  await chrome.storage.sync.set(defaultConfigWithVersion);
  return { ...DEFAULT_CONFIG, _version: CONFIG_VERSION };
}

// 配置迁移
async function migrateConfigIfNeeded(config) {
  const currentVersion = config._version || '0.0.0';
  
  if (compareVersions(currentVersion, CONFIG_VERSION) >= 0) {
    return; // 版本相同或更高，无需迁移
  }
  
  console.log(`配置迁移: ${currentVersion} -> ${CONFIG_VERSION}`);
  
  // 根据版本执行迁移逻辑
  if (compareVersions(currentVersion, '1.0.0') < 0) {
    // 迁移到1.0.0的逻辑
    if (config.apiUrl === 'https://your.domain') {
      config.apiUrl = ''; // 重置无效的默认值
    }
    // 确保新增字段有默认值
    if (config.uploadTimeout === undefined) {
      config.uploadTimeout = CONSTANTS.UPLOAD_TIMEOUT;
    }
  }

  if (compareVersions(currentVersion, '1.2.0') < 0) {
    if (!config.returnFormat || !CONSTANTS.VALID_RETURN_FORMATS.includes(config.returnFormat)) {
      config.returnFormat = DEFAULT_CONFIG.returnFormat;
    }
  }

  if (compareVersions(currentVersion, '1.3.0') < 0) {
    config.uploadFolder = normalizeUploadFolderValue(config.uploadFolder);
    config.apiUrl = normalizeApiUrlValue(config.apiUrl);
  }
  
  // 保存新版本
  config._version = CONFIG_VERSION;
  await chrome.storage.sync.set({ _version: CONFIG_VERSION });
}

// 获取敏感信息的掩码版本
function getMaskedConfig(config) {
  const maskedConfig = { ...config };
  const sensitiveFields = ['authCode'];
  
  sensitiveFields.forEach(field => {
    if (maskedConfig[field]) {
      // 使用统一的掩码标记
      maskedConfig[field] = AUTH_CODE_MASK_MARKER;
    }
  });
  
  return maskedConfig;
}

// 检查配置完整性
function isConfigComplete(config) {
  const requiredFields = ['apiUrl'];
  const normalized = normalizeConfig(config);
  return requiredFields.every(field => normalized[field] && normalized[field].trim() !== '');
}

// 获取配置摘要（用于日志）
function getConfigSummary(config) {
  return {
    hasApiUrl: !!config.apiUrl,
    hasAuthCode: !!config.authCode,
    uploadChannel: config.uploadChannel,
    uploadNameType: config.uploadNameType,
    returnFormat: config.returnFormat,
    hasUploadFolder: !!config.uploadFolder,
    serverCompress: config.serverCompress,
    autoRetry: config.autoRetry
  };
}

/**
 * 规范化配置值（类型归一 + 默认值回退）
 * @param {Object} config - 原始配置
 * @returns {Object} 规范化后的配置
 */
function normalizeConfig(config = {}) {
  const normalized = { ...DEFAULT_CONFIG, ...config };

  normalized.apiUrl = normalizeApiUrlValue(normalized.apiUrl);
  normalized.authCode = typeof normalized.authCode === 'string' ? normalized.authCode.trim() : '';
  normalized.uploadFolder = normalizeUploadFolderValue(normalized.uploadFolder);

  normalized.serverCompress = normalizeBooleanValue(normalized.serverCompress, DEFAULT_CONFIG.serverCompress);
  normalized.autoRetry = normalizeBooleanValue(normalized.autoRetry, DEFAULT_CONFIG.autoRetry);

  if (!CONSTANTS.VALID_UPLOAD_CHANNELS.includes(normalized.uploadChannel)) {
    normalized.uploadChannel = DEFAULT_CONFIG.uploadChannel;
  }

  if (!CONSTANTS.VALID_NAME_TYPES.includes(normalized.uploadNameType)) {
    normalized.uploadNameType = DEFAULT_CONFIG.uploadNameType;
  }

  if (!CONSTANTS.VALID_RETURN_FORMATS.includes(normalized.returnFormat)) {
    normalized.returnFormat = DEFAULT_CONFIG.returnFormat;
  }

  const timeout = Number(normalized.uploadTimeout);
  if (!Number.isFinite(timeout)) {
    normalized.uploadTimeout = DEFAULT_CONFIG.uploadTimeout;
  } else {
    normalized.uploadTimeout = Math.max(10000, Math.min(300000, Math.floor(timeout)));
  }

  return normalized;
}
