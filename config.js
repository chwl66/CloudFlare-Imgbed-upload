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

// 配置版本管理
const CONFIG_VERSION = '1.2.0';

// 认证码掩码标记
const AUTH_CODE_MASK_MARKER = '••••••';

// 获取配置
async function getConfig() {
  const config = await chrome.storage.sync.get(CONFIG_KEYS);
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  // 检查配置版本，必要时进行迁移
  await migrateConfigIfNeeded(mergedConfig);
  
  return mergedConfig;
}

// 保存配置
async function saveConfig(config, originalConfig = null) {
  // 使用工具函数验证配置
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }
  
  const validConfig = {};
  CONFIG_KEYS.forEach(key => {
    if (config.hasOwnProperty(key)) {
      // 特殊处理认证码：如果是掩码值，保留原值
      if (key === 'authCode' && isMaskedValue(config[key]) && originalConfig) {
        validConfig[key] = originalConfig[key];
      } else {
        validConfig[key] = config[key];
      }
    }
  });
  
  // 添加版本信息
  validConfig._version = CONFIG_VERSION;
  
  await chrome.storage.sync.set(validConfig);
  return validConfig;
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
  
  // API 地址验证
  if (!config.apiUrl) {
    errors.push('请输入 API 地址！');
  } else {
    try {
      const url = new URL(config.apiUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('API 地址必须使用 HTTP 或 HTTPS 协议！');
      }
    } catch {
      errors.push('API 地址格式不正确！');
    }
  }
  
  // 上传渠道验证
  if (!CONSTANTS.VALID_UPLOAD_CHANNELS.includes(config.uploadChannel)) {
    errors.push('无效的上传渠道！');
  }

  // 文件命名方式验证
  if (!CONSTANTS.VALID_NAME_TYPES.includes(config.uploadNameType)) {
    errors.push('无效的文件命名方式！');
  }

  // 返回格式验证
  if (!CONSTANTS.VALID_RETURN_FORMATS.includes(config.returnFormat)) {
    errors.push('无效的返回格式！');
  }
  
  // 上传目录验证（如果提供）
  if (config.uploadFolder) {
    // 检查路径格式
    if (config.uploadFolder.includes('..') || config.uploadFolder.includes('//')) {
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
    chrome.storage.sync.get(null, (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(data);
      }
    });
  });
}

// 重置配置为默认值
async function resetConfig() {
  await chrome.storage.sync.clear();
  const defaultConfigWithVersion = { ...DEFAULT_CONFIG, _version: CONFIG_VERSION };
  await chrome.storage.sync.set(defaultConfigWithVersion);
  return defaultConfigWithVersion;
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
      config.returnFormat = 'full';
    }
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
  return requiredFields.every(field => config[field] && config[field].trim() !== '');
}

// 获取配置摘要（用于日志）
function getConfigSummary(config) {
  return {
    hasApiUrl: !!config.apiUrl,
    hasAuthCode: !!config.authCode,
    uploadChannel: config.uploadChannel,
    uploadNameType: config.uploadNameType,
    hasUploadFolder: !!config.uploadFolder,
    serverCompress: config.serverCompress,
    autoRetry: config.autoRetry
  };
}