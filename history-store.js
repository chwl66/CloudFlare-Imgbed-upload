// ==================== 上传记录存储模块 ====================
// background service worker 与上传记录页面共用，统一读写 chrome.storage.local

const HISTORY_STORAGE_KEY = 'uploadHistory';
const HISTORY_MAX_RECORDS = 200;
const HISTORY_FILE_NAME_MAX_LENGTH = 120;
const HISTORY_URL_MAX_LENGTH = 1000;
const HISTORY_ERROR_MAX_LENGTH = 300;

// 上传来源（常量定义见 utils.js 的 CONSTANTS.UPLOAD_SOURCES）
const UPLOAD_SOURCES = CONSTANTS.UPLOAD_SOURCES;

const VALID_UPLOAD_SOURCES = Object.values(UPLOAD_SOURCES);

// 串行化写入，避免多文件并发上传时记录被相互覆盖
let historyWriteChain = Promise.resolve();

/**
 * 生成记录唯一 ID
 * @returns {string} 记录 ID
 */
function createUploadRecordId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 规范化上传记录（字段兜底 + 长度限制）
 * @param {Object} record - 原始记录
 * @returns {Object} 规范化后的记录
 */
function normalizeUploadRecord(record = {}) {
  const success = Boolean(record.success);
  const source = VALID_UPLOAD_SOURCES.includes(record.source)
    ? record.source
    : UPLOAD_SOURCES.UNKNOWN;
  const time = Number(record.time);

  return {
    id: typeof record.id === 'string' && record.id ? record.id : createUploadRecordId(),
    time: Number.isFinite(time) ? time : Date.now(),
    source,
    success,
    fileName: String(record.fileName || '').slice(0, HISTORY_FILE_NAME_MAX_LENGTH),
    url: success ? String(record.url || '').slice(0, HISTORY_URL_MAX_LENGTH) : '',
    error: success ? '' : (String(record.error || '').slice(0, HISTORY_ERROR_MAX_LENGTH) || '上传失败')
  };
}

/**
 * 读取上传记录（不做裁剪，按存储原样返回）
 * @returns {Promise<Array<Object>>} 记录列表，最新在前
 */
async function getUploadRecords() {
  const data = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  const records = data[HISTORY_STORAGE_KEY];
  if (!Array.isArray(records)) return [];

  return records
    .filter(record => record && typeof record === 'object')
    .map(record => normalizeUploadRecord(record));
}

/**
 * 追加一条上传记录
 * @param {Object} record - 上传结果
 * @returns {Promise<Array<Object>>} 写入后的记录列表
 */
function addUploadRecord(record) {
  return queueHistoryWrite(async () => {
    const records = await getUploadRecords();
    const nextRecords = [normalizeUploadRecord(record), ...records];

    if (nextRecords.length > HISTORY_MAX_RECORDS) {
      nextRecords.length = HISTORY_MAX_RECORDS;
    }

    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: nextRecords });
    return nextRecords;
  });
}

/**
 * 删除指定记录
 * @param {Array<string>} ids - 记录 ID 列表
 * @returns {Promise<Array<Object>>} 删除后的记录列表
 */
function deleteUploadRecords(ids) {
  const targetIds = new Set(Array.isArray(ids) ? ids : [ids]);

  return queueHistoryWrite(async () => {
    const records = await getUploadRecords();
    const nextRecords = records.filter(record => !targetIds.has(record.id));
    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: nextRecords });
    return nextRecords;
  });
}

/**
 * 清空全部上传记录
 * @returns {Promise<void>}
 */
function clearUploadRecords() {
  return queueHistoryWrite(() => chrome.storage.local.remove(HISTORY_STORAGE_KEY));
}

/**
 * 将写入任务排入串行队列
 * @param {Function} task - 写入任务
 * @returns {Promise<any>} 任务结果
 */
function queueHistoryWrite(task) {
  const result = historyWriteChain.then(task, task);
  historyWriteChain = result.then(() => undefined, () => undefined);
  return result;
}
