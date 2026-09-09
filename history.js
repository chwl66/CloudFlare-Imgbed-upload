// 上传记录页面逻辑
// 依赖：utils.js（复制工具）、history-store.js（记录读写）

// 页面状态
let allRecords = [];
let filterStatus = 'all';
let searchKeyword = '';

// 来源显示文案
const SOURCE_LABELS = {
  [UPLOAD_SOURCES.IMAGE]: '右键图片',
  [UPLOAD_SOURCES.CLIPBOARD]: '剪贴板',
  [UPLOAD_SOURCES.DRAG]: '拖拽',
  [UPLOAD_SOURCES.UNKNOWN]: '其他'
};

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  watchStorageChanges();
  await refreshRecords();
});

// ==================== 数据加载与渲染 ====================

/**
 * 重新读取并渲染记录
 * @returns {Promise<void>}
 */
async function refreshRecords() {
  try {
    allRecords = await getUploadRecords();
  } catch (error) {
    allRecords = [];
    console.error('读取上传记录失败:', error);
  }
  renderRecords();
}

/**
 * 按当前筛选条件渲染记录列表
 * @returns {void}
 */
function renderRecords() {
  const listElement = document.getElementById('list');
  const emptyElement = document.getElementById('empty');
  const records = getVisibleRecords();

  listElement.textContent = '';

  const successCount = allRecords.filter(record => record.success).length;
  document.getElementById('summary').textContent = allRecords.length
    ? `共 ${allRecords.length} 条 · 成功 ${successCount} · 失败 ${allRecords.length - successCount}`
    : '暂无记录';

  if (!records.length) {
    emptyElement.textContent = allRecords.length ? '没有匹配的记录' : '暂无上传记录';
    emptyElement.style.display = 'block';
    return;
  }

  emptyElement.style.display = 'none';
  records.forEach(record => {
    listElement.appendChild(createRecordElement(record));
  });
}

/**
 * 获取符合搜索与状态筛选的记录
 * @returns {Array<Object>} 记录列表
 */
function getVisibleRecords() {
  const keyword = searchKeyword.trim().toLowerCase();

  return allRecords.filter(record => {
    if (filterStatus === 'success' && !record.success) return false;
    if (filterStatus === 'failed' && record.success) return false;

    if (!keyword) return true;

    return [record.fileName, record.url, record.error]
      .some(field => String(field || '').toLowerCase().includes(keyword));
  });
}

/**
 * 创建单条记录节点
 * @param {Object} record - 上传记录
 * @returns {HTMLElement} 记录节点
 */
function createRecordElement(record) {
  const item = document.createElement('article');
  item.className = `item${record.success ? '' : ' failed'}`;
  item.dataset.id = record.id;

  item.appendChild(createThumbElement(record));

  const main = document.createElement('div');
  main.className = 'main';

  // 标题行：文件名 + 来源 + 状态 + 时间
  const head = document.createElement('div');
  head.className = 'item-head';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = record.fileName || '未命名图片';
  head.appendChild(name);

  const sourceBadge = document.createElement('span');
  sourceBadge.className = 'badge';
  sourceBadge.textContent = SOURCE_LABELS[record.source] || SOURCE_LABELS[UPLOAD_SOURCES.UNKNOWN];
  head.appendChild(sourceBadge);

  const stateBadge = document.createElement('span');
  stateBadge.className = `badge ${record.success ? 'state-success' : 'state-failed'}`;
  stateBadge.textContent = record.success ? '成功' : '失败';
  head.appendChild(stateBadge);

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatRecordTime(record.time);
  time.title = new Date(record.time).toLocaleString();
  head.appendChild(time);

  main.appendChild(head);

  // 链接或错误信息
  if (record.success && isSafeUrl(record.url)) {
    const url = document.createElement('code');
    url.className = 'url';
    url.textContent = record.url;
    main.appendChild(url);
  } else {
    const error = document.createElement('div');
    error.className = 'error-text';
    error.textContent = record.success ? '记录中没有可用的图片链接' : record.error;
    main.appendChild(error);
  }

  // 操作按钮
  main.appendChild(createActionsElement(record));
  item.appendChild(main);

  return item;
}

/**
 * 创建缩略图节点
 * @param {Object} record - 上传记录
 * @returns {HTMLElement} 缩略图节点
 */
function createThumbElement(record) {
  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  if (!record.success || !isSafeUrl(record.url)) {
    thumb.textContent = '✕';
    return thumb;
  }

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.addEventListener('error', () => {
    thumb.textContent = '🖼';
  });
  img.src = record.url;
  thumb.appendChild(img);

  return thumb;
}

/**
 * 创建操作按钮区
 * @param {Object} record - 上传记录
 * @returns {HTMLElement} 操作区节点
 */
function createActionsElement(record) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  const canUseUrl = record.success && isSafeUrl(record.url);

  if (canUseUrl) {
    actions.appendChild(createActionButton('copy', '直链', '复制链接'));
    actions.appendChild(createActionButton('copy', 'Markdown', '复制 Markdown 格式'));
    actions.appendChild(createActionButton('copy', 'BBCode', '复制 BBCode 格式'));
    actions.appendChild(createActionButton('open', '', '在新标签页打开'));
  }

  actions.appendChild(createActionButton('delete', '删除', '删除这条记录'));

  return actions;
}

/**
 * 创建操作按钮
 * @param {string} action - 动作类型
 * @param {string} label - 按钮文案
 * @param {string} title - 悬停提示
 * @returns {HTMLButtonElement} 按钮节点
 */
function createActionButton(action, label, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${action === 'delete' ? 'btn-danger' : 'btn-secondary'}`;
  button.dataset.action = action;
  button.dataset.format = label;
  button.textContent = action === 'open' ? '打开' : label;
  button.title = title;
  return button;
}

// ==================== 交互事件 ====================

/**
 * 绑定页面事件
 * @returns {void}
 */
function bindEvents() {
  document.getElementById('list').addEventListener('click', handleListClick);

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchKeyword = e.target.value;
    renderRecords();
  });

  document.getElementById('filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    filterStatus = chip.dataset.filter;
    document.querySelectorAll('.chip').forEach(item => {
      item.classList.toggle('active', item === chip);
    });
    renderRecords();
  });

  document.getElementById('clearBtn').addEventListener('click', handleClearClick);
}

/**
 * 监听存储变化，上传完成后自动刷新列表
 * @returns {void}
 */
function watchStorageChanges() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (Object.prototype.hasOwnProperty.call(changes, HISTORY_STORAGE_KEY)) {
      refreshRecords();
    }
  });
}

/**
 * 处理记录列表中的按钮点击
 * @param {MouseEvent} event - 点击事件
 * @returns {Promise<void>}
 */
async function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const item = button.closest('.item');
  const record = allRecords.find(entry => entry.id === item?.dataset.id);
  if (!record) return;

  switch (button.dataset.action) {
    case 'copy':
      await copyRecordText(record, button.dataset.format, button);
      break;
    case 'open':
      window.open(record.url, '_blank', 'noopener');
      break;
    case 'delete':
      await deleteUploadRecords([record.id]);
      break;
  }
}

/**
 * 按格式复制记录链接
 * @param {Object} record - 上传记录
 * @param {string} format - 复制格式：直链 / Markdown / BBCode
 * @param {HTMLButtonElement} button - 触发按钮（用于视觉反馈）
 * @returns {Promise<void>}
 */
async function copyRecordText(record, format, button) {
  const formats = {
    '直链': record.url,
    'Markdown': `![image](${record.url})`,
    'BBCode': `[img]${record.url}[/img]`
  };

  const text = formats[format];
  if (!text) return;

  try {
    await copyTextToClipboard(text);
    showCopiedFeedback(button);
  } catch (error) {
    console.error('复制失败:', error);
    button.textContent = '复制失败';
    setTimeout(() => {
      button.textContent = format;
    }, 1500);
  }
}

/**
 * 显示复制成功反馈
 * @param {HTMLButtonElement} button - 触发按钮
 * @returns {void}
 */
function showCopiedFeedback(button) {
  button.textContent = '已复制';
  button.classList.add('copied');

  setTimeout(() => {
    button.textContent = button.dataset.format;
    button.classList.remove('copied');
  }, 1200);
}

/**
 * 清空记录（二次确认）
 * @returns {Promise<void>}
 */
async function handleClearClick() {
  const button = document.getElementById('clearBtn');

  if (!button.classList.contains('confirming')) {
    button.classList.add('confirming');
    button.textContent = '确认清空？';

    setTimeout(() => {
      button.classList.remove('confirming');
      button.textContent = '清空记录';
    }, 3000);
    return;
  }

  button.classList.remove('confirming');
  button.textContent = '清空记录';

  try {
    await clearUploadRecords();
    allRecords = [];
    renderRecords();
  } catch (error) {
    console.error('清空上传记录失败:', error);
  }
}

// ==================== 展示工具 ====================

/**
 * 判断链接是否可安全使用
 * @param {string} url - 链接
 * @returns {boolean} 是否为 http/https 链接
 */
function isSafeUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * 格式化记录时间为相对/绝对时间
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {string} 展示文本
 */
function formatRecordTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';

  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (isSameDay(date, new Date())) return `${Math.floor(diff / hour)} 小时前`;

  const pad = value => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();

  return sameYear
    ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

/**
 * 判断两个日期是否同一天
 * @param {Date} left - 日期
 * @param {Date} right - 日期
 * @returns {boolean} 是否同一天
 */
function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
