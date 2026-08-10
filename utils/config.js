// utils/config.js
import { DEFAULT_CONFIG } from './constants.js';

// 获取配置
export async function getConfig() {
  try {
    const config = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
    // 使用 Object.assign 确保即使用户存储了 null 或 undefined，也会应用默认值
    const mergedConfig = {};
    for (const key in DEFAULT_CONFIG) {
        mergedConfig[key] = config[key] ?? DEFAULT_CONFIG[key];
    }
    return mergedConfig;
  } catch (error) {
    console.error('Failed to load config:', error);
    return { ...DEFAULT_CONFIG };
  }
}
