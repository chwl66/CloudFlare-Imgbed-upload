// 图床文件管理页面逻辑
// 依赖：utils.js（链接与格式化工具）、config.js（配置读取）
//
// 对应上游管理接口：
//   GET    /api/manage/list?start=&count=&search=&recursive=
//   DELETE /api/manage/delete/<path>
// 上游 /api/manage/* 需要管理员身份，因此必须配置具备 list / delete 权限的 API Token，
// 认证码（authCode）在管理接口上不生效。

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

const state = {
  apiUrl: '',
  apiToken: '',
  authCode: '',
  start: 0,
  total: 0,
  keyword: '',
  files: []
};

let searchTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await init();
});

// ==================== 初始化 ====================

/**
 * 读取配置并加载第一页
 * @returns {Promise<void>}
 */
async function init() {
  try {
    const config = await getConfig();
    state.apiUrl = config.apiUrl;
    state.apiToken = config.apiToken;
    state.authCode = config.authCode;
  } catch (error) {
    showStatus('读取配置失败: ' + error.message, 'error');
    return;
  }

  if (!state.apiUrl) {
    showStatus('请先在扩展弹窗中配置 API 地址', 'error');
    return;
  }

  // 实例未开启管理员验证时可直接访问，先正常加载；401 时再提示需要 Token
  await loadPage(0);
}

// ==================== 网络请求 ====================

/**
 * 构建管理接口请求头
 * @returns {Object}
 */
function buildHeaders() {
  const headers = {};

  if (state.apiToken) {
    headers['Authorization'] = `Bearer ${state.apiToken}`;
  }
  if (state.authCode) {
    headers['authCode'] = state.authCode;
  }

  return headers;
}

/**
 * 加载指定页
 * @param {number} start - 起始偏移
 * @returns {Promise<void>}
 */
async function loadPage(start) {
  const params = new URLSearchParams({
    start: String(Math.max(0, start)),
    count: String(PAGE_SIZE),
    recursive: 'true'
  });

  if (state.keyword) {
    params.set('search', state.keyword);
  }

  setLoading(true);

  try {
    const response = await fetchWithTimeout(
      `${state.apiUrl.replace(/\/$/, '')}/api/manage/list?${params.toString()}`,
      { method: 'GET', headers: buildHeaders() },
      CONSTANTS.CONNECTION_TIMEOUT
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      showStatus(describeManageError(response.status, bodyText), 'error');
      renderPage([], state.total);
      return;
    }

    const data = await response.json();
    const files = Array.isArray(data?.files) ? data.files : [];
    const total = Number(data?.totalCount);

    state.files = files;
    state.start = Math.max(0, start);
    state.total = Number.isFinite(total) ? total : files.length;

    clearStatus();
    renderPage(files, state.total);
  } catch (error) {
    showStatus('加载文件列表失败: ' + getFriendlyErrorMessage(error), 'error');
    renderPage([], state.total);
  } finally {
    setLoading(false);
  }
}

/**
 * 删除单个文件
 * @param {string} fileId - 文件 ID
 * @returns {Promise<boolean>} 是否删除成功
 */
async function deleteFile(fileId) {
  try {
    const response = await fetchWithTimeout(
      `${state.apiUrl.replace(/\/$/, '')}/api/manage/delete/${buildDeletePathSegment(fileId)}`,
      { method: 'DELETE', headers: buildHeaders() },
      CONSTANTS.CONNECTION_TIMEOUT
    );

    const bodyText = await response.text().catch(() => '');

    if (!response.ok) {
      showStatus(describeDeleteError(response.status, bodyText), 'error');
      return false;
    }

    let payload = null;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = null;
    }

    if (payload && payload.success === false) {
      showStatus(`删除失败：${stripErrorPrefix(payload.error || '服务端返回失败')}`, 'error');
      return false;
    }

    return true;
  } catch (error) {
    showStatus('删除失败: ' + getFriendlyErrorMessage(error), 'error');
    return false;
  }
}

/**
 * 把管理接口的状态码翻译成可读提示
 * @param {number} status - HTTP 状态码
 * @param {string} bodyText - 响应体
 * @returns {string}
 */
function describeManageError(status, bodyText) {
  if (status === 401 || status === 403) {
    return '认证失败：管理接口需要带 list 权限的 API Token（认证码不适用于 /api/manage/*）';
  }
  if (status === 404) {
    return '该实例没有 /api/manage/list 接口，可能版本较旧，暂不支持文件管理';
  }

  const reason = extractUpstreamErrorMessage(bodyText, status);
  return `加载失败（${status}）${reason ? `：${reason}` : ''}`;
}

/**
 * 删除失败提示
 * @param {number} status - HTTP 状态码
 * @param {string} bodyText - 响应体
 * @returns {string}
 */
function describeDeleteError(status, bodyText) {
  if (status === 401 || status === 403) {
    return '认证失败：删除文件需要带 delete 权限的 API Token';
  }

  const reason = extractUpstreamErrorMessage(bodyText, status);
  return `删除失败（${status}）${reason ? `：${reason}` : ''}`;
}

// ==================== 渲染 ====================

/**
 * 渲染列表与分页
 * @param {Array<Object>} files - 文件记录
 * @param {number} total - 总数量
 * @returns {void}
 */
function renderPage(files, total) {
  const listElement = document.getElementById('list');
  const emptyElement = document.getElementById('empty');

  listElement.textContent = '';

  const summary = document.getElementById('summary');
  const from = total === 0 ? 0 : state.start + 1;
  const to = state.start + files.length;
  summary.textContent = total > 0 ? `${from}-${to} / 共 ${total} 个文件` : '暂无文件';

  if (files.length === 0) {
    emptyElement.textContent = state.keyword ? '没有匹配的文件' : '暂无文件';
    emptyElement.style.display = 'block';
  } else {
    emptyElement.style.display = 'none';
    files.forEach(file => listElement.appendChild(createFileRow(file)));
  }

  updatePager(total);
}

/**
 * 更新分页控件状态
 * @param {number} total - 总数量
 * @returns {void}
 */
function updatePager(total) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(state.start / PAGE_SIZE) + 1;

  document.getElementById('pageInfo').textContent = `第 ${currentPage} / ${pageCount} 页`;
  document.getElementById('prevBtn').disabled = state.start <= 0;
  document.getElementById('nextBtn').disabled = state.start + PAGE_SIZE >= total;
}

/**
 * 创建单行文件
 * @param {Object} file - { name, metadata }
 * @returns {HTMLElement}
 */
function createFileRow(file) {
  const fileId = String(file?.name || '');
  const meta = file?.metadata || {};

  const row = document.createElement('div');
  row.className = 'item';
  row.dataset.id = fileId;

  row.appendChild(createThumb(meta, fileId));

  const main = document.createElement('div');
  main.className = 'main';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = meta.FileName || fileId.split('/').pop() || fileId;
  name.title = fileId;
  main.appendChild(name);

  const metaLine = document.createElement('div');
  metaLine.className = 'meta';
  metaLine.textContent = buildMetaText(meta, fileId);
  main.appendChild(metaLine);

  row.appendChild(main);
  row.appendChild(createActions());

  return row;
}

/**
 * 创建缩略图
 * @param {Object} meta - 文件 metadata
 * @param {string} fileId - 文件 ID
 * @returns {HTMLElement}
 */
function createThumb(meta, fileId) {
  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  const isImage = String(meta.FileType || '').startsWith('image/');
  if (!isImage) {
    thumb.textContent = fileIcon(meta.FileType);
    return thumb;
  }

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.addEventListener('error', () => {
    thumb.textContent = '🖼';
  });
  img.src = buildFileUrl(state.apiUrl, fileId);
  thumb.appendChild(img);

  return thumb;
}

/**
 * 拼接文件信息行
 * @param {Object} meta - metadata
 * @param {string} fileId - 文件 ID
 * @returns {string}
 */
function buildMetaText(meta, fileId) {
  const parts = [];

  if (meta.FileSize) parts.push(`${meta.FileSize}MB`);
  if (meta.Width && meta.Height) parts.push(`${meta.Width}×${meta.Height}`);
  if (meta.Channel || meta.ChannelName) parts.push([meta.Channel, meta.ChannelName].filter(Boolean).join(' / '));
  if (meta.TimeStamp) parts.push(formatTime(meta.TimeStamp));

  const folder = fileId.split('/').slice(0, -1).join('/');
  if (folder) parts.push(folder);

  return parts.filter(Boolean).join(' · ');
}

/**
 * 按文件类型给出图标
 * @param {string} fileType - MIME 类型
 * @returns {string}
 */
function fileIcon(fileType) {
  const type = String(fileType || '');
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type === 'application/pdf') return '📕';
  if (type.startsWith('text/')) return '📄';
  if (type.includes('zip') || type.includes('compressed') || type.includes('rar')) return '🗜';
  return '📦';
}

/**
 * 创建操作按钮区
 * @returns {HTMLElement}
 */
function createActions() {
  const actions = document.createElement('div');
  actions.className = 'actions';

  actions.appendChild(createButton('copy', '复制链接', 'btn-secondary'));
  actions.appendChild(createButton('open', '打开', 'btn-secondary'));
  actions.appendChild(createButton('delete', '删除', 'btn-danger'));

  return actions;
}

/**
 * 创建按钮
 * @param {string} action - 动作
 * @param {string} label - 文案
 * @param {string} className - 样式类
 * @returns {HTMLButtonElement}
 */
function createButton(action, label, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${className}`;
  button.dataset.action = action;
  button.dataset.label = label;
  button.textContent = label;
  return button;
}

// ==================== 事件 ====================

/**
 * 绑定页面事件
 * @returns {void}
 */
function bindEvents() {
  document.getElementById('list').addEventListener('click', handleListClick);
  document.getElementById('refreshBtn').addEventListener('click', () => loadPage(state.start));
  document.getElementById('searchBtn').addEventListener('click', () => applySearch(document.getElementById('searchInput').value));

  document.getElementById('searchInput').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value;
    searchTimer = setTimeout(() => applySearch(value), SEARCH_DEBOUNCE_MS);
  });

  document.getElementById('prevBtn').addEventListener('click', () => {
    loadPage(Math.max(0, state.start - PAGE_SIZE));
  });

  document.getElementById('nextBtn').addEventListener('click', () => {
    loadPage(state.start + PAGE_SIZE);
  });
}

/**
 * 应用搜索关键词并回到第一页
 * @param {string} value - 搜索词
 * @returns {Promise<void>}
 */
async function applySearch(value) {
  const keyword = String(value || '').trim();
  if (keyword === state.keyword) return;

  state.keyword = keyword;
  await loadPage(0);
}

/**
 * 处理列表按钮点击
 * @param {MouseEvent} event - 点击事件
 * @returns {Promise<void>}
 */
async function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const row = button.closest('.item');
  const fileId = row?.dataset.id;
  if (!fileId) return;

  switch (button.dataset.action) {
    case 'copy':
      await copyFileLink(fileId, button);
      break;
    case 'open':
      window.open(buildFileUrl(state.apiUrl, fileId), '_blank', 'noopener');
      break;
    case 'delete':
      await handleDeleteClick(fileId, button);
      break;
  }
}

/**
 * 复制文件链接
 * @param {string} fileId - 文件 ID
 * @param {HTMLButtonElement} button - 触发按钮
 * @returns {Promise<void>}
 */
async function copyFileLink(fileId, button) {
  try {
    await copyTextToClipboard(buildFileUrl(state.apiUrl, fileId));
    button.textContent = '已复制';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = button.dataset.label;
      button.classList.remove('copied');
    }, 1200);
  } catch (error) {
    showStatus('复制失败: ' + error.message, 'error');
  }
}

/**
 * 删除文件（二次确认）
 * @param {string} fileId - 文件 ID
 * @param {HTMLButtonElement} button - 触发按钮
 * @returns {Promise<void>}
 */
async function handleDeleteClick(fileId, button) {
  if (!button.classList.contains('confirming')) {
    button.classList.add('confirming');
    button.textContent = '确认删除？';

    setTimeout(() => {
      if (button.isConnected) {
        button.classList.remove('confirming');
        button.textContent = button.dataset.label;
      }
    }, 3000);
    return;
  }

  button.disabled = true;
  const success = await deleteFile(fileId);

  if (!success) {
    button.disabled = false;
    button.classList.remove('confirming');
    button.textContent = button.dataset.label;
    return;
  }

  // 删除的是当前页最后一条时回到上一页
  const nextStart = state.files.length === 1 && state.start > 0
    ? Math.max(0, state.start - PAGE_SIZE)
    : state.start;

  await loadPage(nextStart);
}

// ==================== 展示工具 ====================

/**
 * 显示状态提示
 * @param {string} message - 文案
 * @param {string} type - error / info
 * @returns {void}
 */
function showStatus(message, type = 'info') {
  const element = document.getElementById('status');
  element.textContent = message;
  element.className = `status ${type}`;
}

/**
 * 隐藏状态提示
 * @returns {void}
 */
function clearStatus() {
  const element = document.getElementById('status');
  element.textContent = '';
  element.className = 'status';
}

/**
 * 设置加载中的禁用状态
 * @param {boolean} loading - 是否加载中
 * @returns {void}
 */
function setLoading(loading) {
  ['refreshBtn', 'searchBtn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = loading;
  });
}

/**
 * 格式化时间戳
 * @param {number} timestamp - 毫秒时间戳
 * @returns {string}
 */
function formatTime(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return '';

  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
