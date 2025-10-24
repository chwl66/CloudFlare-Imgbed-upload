// utils/api.js
import { getConfig as getConfigFromStorage } from './config.js';

/**
 * 构建上传 URL
 * @param {object} [extraParams={}] - 额外的 URL 查询参数
 * @param {object|null} [configOverride=null] - 覆盖配置对象，如果为 null 则从存储中获取
 * @returns {Promise<string>} - 构建好的上传 URL
 */
export async function buildUploadUrl(extraParams = {}, configOverride = null) {
  const config = configOverride || await getConfigFromStorage();
  
  if (!config.apiUrl) {
    throw new Error('请先配置 API 地址！');
  }
  
  const params = new URLSearchParams({
    serverCompress: config.serverCompress,
    uploadChannel: config.uploadChannel,
    autoRetry: config.autoRetry,
    uploadNameType: config.uploadNameType,
    returnFormat: 'full', // 强制使用完整链接格式
    ...extraParams
  });
  
  if (config.authCode && config.authCode.trim()) {
    params.append('authCode', config.authCode);
  }
  
  if (config.uploadFolder) {
    params.append('uploadFolder', config.uploadFolder);
  }
  
  return `${config.apiUrl.replace(/\/$/, '')}/upload?${params.toString()}`;
}
