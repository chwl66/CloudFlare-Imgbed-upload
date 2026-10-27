// 冒烟测试：在 Node 中模拟上游 /upload 接口，验证背景脚本的上传链路
//
// 覆盖点：
//   1. getUploadPlan 的渠道 / 上限 / 分块参数 / 超时是否与配置一致
//   2. 单请求上传的参数拼装与 Authorization 头
//   3. 服务端返回的 publicUrl（CDN 域名）不被改写
//   4. 分块上传 初始化 → 逐块 → 合并 的完整链路与参数
//   5. 失败清理请求、上传记录写入
//
// 用法：node test/smoke.mjs
// 依赖：Node 18+（使用内置 fetch / FormData / Blob），无需安装任何包

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];
let uploadSeq = 0;

// ---------- 模拟上游 /upload 接口 ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const bodyText = body.toString('utf8');
    const query = Object.fromEntries(url.searchParams);
    calls.push({
      path: url.pathname,
      query,
      auth: req.headers.authorization || '',
      authCodeHeader: req.headers.authcode || '',
      bodySize: body.length,
      bodyText,
      contentType: req.headers['content-type'] || ''
    });

    const json = (payload) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname !== '/upload') {
      res.writeHead(404);
      return res.end('{}');
    }

    // 模拟上游失败：返回纯文本 Error: ...
    if (bodyText.includes('fail-upload')) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      return res.end('Error: No R2 channel provided');
    }

    // 外链收录：上游返回相对路径
    if (query.uploadChannel === 'external') {
      return json([{ src: '/file/external-link.png' }]);
    }

    // 初始化
    if (query.initChunked === 'true') {
      uploadSeq += 1;
      return json({ success: true, uploadId: `up_${uploadSeq}` });
    }

    // 合并
    if (query.chunked === 'true' && query.merge === 'true') {
      return json([{ src: '/file/merged.jpg', publicUrl: 'https://cdn.example.net/file/merged.jpg' }]);
    }

    // 单块
    if (query.chunked === 'true') {
      return json({ success: true, message: 'chunk ok' });
    }

    // 清理
    if (query.cleanup === 'true') {
      return json({ success: true });
    }

    // 普通上传
    return json([{ src: '/file/plain.jpg', publicUrl: 'https://cdn.example.net/file/plain.jpg' }]);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

// ---------- chrome 环境 mock ----------
function makeArea() {
  const store = new Map();
  return {
    store,
    async get(keys) {
      if (keys === null || keys === undefined) return Object.fromEntries(store);
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      list.forEach((k) => { if (store.has(k)) out[k] = store.get(k); });
      return out;
    },
    async set(obj) { Object.entries(obj).forEach(([k, v]) => store.set(k, v)); },
    async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => store.delete(k)); },
    async clear() { store.clear(); }
  };
}

const syncArea = makeArea();
const localArea = makeArea();
const sessionArea = makeArea();
let messageListener = null;

const chromeMock = {
  storage: { sync: syncArea, local: localArea, session: sessionArea },
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener(fn) { messageListener = fn; } },
    lastError: undefined,
    getURL: (p) => `chrome-extension://test/${p}`
  },
  contextMenus: {
    removeAll(cb) { if (cb) cb(); },
    create() {},
    onClicked: { addListener() {} }
  },
  commands: { onCommand: { addListener() {} } },
  tabs: { query: async () => [], sendMessage() {} },
  notifications: { create() {} },
  action: { openPopup() {} }
};

const sandbox = {
  chrome: chromeMock,
  console,
  setTimeout,
  clearTimeout,
  fetch,
  URL,
  URLSearchParams,
  FormData,
  Blob,
  Headers,
  AbortController,
  TextDecoder,
  TextEncoder,
  atob,
  btoa,
  Promise,
  Math,
  Date,
  JSON,
  Number,
  String,
  Object,
  Array,
  Error,
  Uint8Array,
  RegExp,
  importScripts() {}
};

vm.createContext(sandbox);

for (const file of ['utils.js', 'config.js', 'history-store.js', 'background.js']) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

// ---------- 写入测试配置 ----------
await syncArea.set({
  apiUrl: `http://127.0.0.1:${port}`,
  uploadChannel: 'cfr2',
  channelName: 'r2-main',
  uploadNameType: 'default',
  uploadFolder: 'img/test',
  returnFormat: 'full',
  uploadTimeout: 30000,
  serverCompress: true,
  autoRetry: true,
  _version: '1.4.0'
});
await localArea.set({ apiToken: 'test-token', authCode: 'test-auth-code' });

function sendMessage(request) {
  return new Promise((resolve, reject) => {
    if (!messageListener) return reject(new Error('消息监听器未注册'));
    const timer = setTimeout(() => reject(new Error(`消息超时: ${request.action}`)), 20000);
    messageListener(request, { tab: { id: 1 } }, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------- 1. 上传计划 ----------
const planResp = await sendMessage({ action: 'getUploadPlan' });
const plan = planResp?.plan || {};
check('getUploadPlan 返回渠道', plan.channel === 'cfr2', `channel=${plan.channel}`);
check('cfr2 支持分块', plan.supportsChunked === true);
check('cfr2 上限 100MB', plan.limit === 100 * 1024 * 1024, `limit=${plan.limit}`);
check('cfr2 分块 8MB', plan.chunkSize === 8 * 1024 * 1024, `chunkSize=${plan.chunkSize}`);
check('超时跟随配置', plan.timeout === 30000, `timeout=${plan.timeout}`);

// ---------- 2. 单请求上传 ----------
calls.length = 0;
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const single = await sendMessage({
  action: 'uploadFile',
  fileData: tinyPng,
  fileName: 'plain.png',
  source: 'drag'
});
check('单请求上传成功', single?.success === true, single?.error || '');
check(
  'publicUrl 的 CDN 域名未被改写',
  single?.result?.url === 'https://cdn.example.net/file/plain.jpg',
  `url=${single?.result?.url}`
);
const plainCall = calls.find((c) => !c.query.chunked && !c.query.initChunked);
check(
  '单请求带上官方参数',
  plainCall &&
    plainCall.query.uploadChannel === 'cfr2' &&
    plainCall.query.channelName === 'r2-main' &&
    plainCall.query.uploadFolder === 'img/test' &&
    plainCall.query.returnFormat === 'full' &&
    plainCall.query.uploadNameType === 'default'
);
check('Token 走 Authorization 头', plainCall?.auth === 'Bearer test-token', plainCall?.auth);
check('认证码走 authCode 请求头', plainCall?.authCodeHeader === 'test-auth-code', plainCall?.authCodeHeader);
check('认证码不出现在 URL', plainCall && !('authCode' in plainCall.query), `query=${plainCall?.query?.authCode ?? ''}`);

// ---------- 3. 分块上传 ----------
calls.length = 0;
const initResp = await sendMessage({
  action: 'chunkedUploadInit',
  fileName: 'big.jpg',
  fileType: 'image/jpeg',
  totalChunks: 3
});
check('分块初始化返回 uploadId', initResp?.success === true && !!initResp.uploadId, initResp?.error || initResp?.uploadId);

const uploadId = initResp.uploadId;
for (let i = 0; i < 3; i += 1) {
  const chunkResp = await sendMessage({
    action: 'chunkedUploadChunk',
    uploadId,
    chunkIndex: i,
    totalChunks: 3,
    fileName: 'big.jpg',
    fileType: 'image/jpeg',
    chunkData: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  });
  check(`第 ${i + 1} 块上传成功`, chunkResp?.success === true, chunkResp?.error || '');
}

const mergeResp = await sendMessage({
  action: 'chunkedUploadMerge',
  uploadId,
  totalChunks: 3,
  fileName: 'big.jpg',
  fileType: 'image/jpeg',
  source: 'clipboard'
});
check('合并成功', mergeResp?.success === true, mergeResp?.error || '');
check(
  '合并结果使用 publicUrl',
  mergeResp?.result?.url === 'https://cdn.example.net/file/merged.jpg',
  `url=${mergeResp?.result?.url}`
);

const initCall = calls.find((c) => c.query.initChunked === 'true');
check('初始化参数正确', !!initCall && initCall.query.uploadChannel === 'cfr2' && initCall.query.channelName === 'r2-main');
check('初始化携带认证头', initCall?.auth === 'Bearer test-token');
const chunkCalls = calls.filter((c) => c.query.chunked === 'true' && c.query.merge !== 'true');
check('分块请求数量正确', chunkCalls.length === 3, `count=${chunkCalls.length}`);
check('分块请求为 multipart', chunkCalls.every((c) => c.contentType.includes('multipart/form-data')));
const mergeCall = calls.find((c) => c.query.merge === 'true');
check(
  '合并参数含 returnFormat / uploadFolder',
  mergeCall?.query.returnFormat === 'full' && mergeCall?.query.uploadFolder === 'img/test'
);

// ---------- 4. 上传记录 ----------
const historyData = await localArea.get('uploadHistory');
const records = historyData.uploadHistory || [];
check('上传记录已写入', records.length >= 2, `records=${records.length}`);
check('记录包含来源标记', records.some((r) => r.source === 'clipboard') && records.some((r) => r.source === 'drag'));

// ---------- 5. 清理请求 ----------
calls.length = 0;
const abortResp = await sendMessage({ action: 'chunkedUploadAbort', uploadId, totalChunks: 3 });
const cleanupCall = calls.find((c) => c.query.cleanup === 'true');
check('清理请求参数正确', abortResp?.success === true && cleanupCall?.query.uploadId === uploadId);

// ---------- 6. 大文件自动分块（跨域转存等后台已有 Blob 的路径） ----------
calls.length = 0;
const bigBytes = Buffer.alloc(9 * 1024 * 1024, 1);
const bigDataUrl = `data:image/jpeg;base64,${bigBytes.toString('base64')}`;
const bigResp = await sendMessage({
  action: 'uploadFile',
  fileData: bigDataUrl,
  fileName: 'big.jpg',
  source: 'image'
});
check(
  '超过阈值自动走分块',
  bigResp?.success === true && calls.some((c) => c.query.initChunked === 'true'),
  bigResp?.error || `calls=${calls.length}`
);
check(
  '9MB 按 8MB 切分为 2 块',
  calls.filter((c) => c.query.chunked === 'true' && c.query.merge !== 'true').length === 2,
  `chunks=${calls.filter((c) => c.query.chunked === 'true' && c.query.merge !== 'true').length}`
);

// ---------- 7. 上游错误文本透传 ----------
// 关掉自动重试，避免测试白等 7 秒退避
await syncArea.set({ autoRetry: false });
calls.length = 0;
const failResp = await sendMessage({
  action: 'uploadFile',
  fileData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  fileName: 'fail-upload.png',
  source: 'drag'
});
check('上传失败返回 success=false', failResp?.success === false);
check(
  '错误信息包含上游原因',
  typeof failResp?.error === 'string' && failResp.error.includes('No R2 channel provided') && failResp.error.includes('500'),
  failResp?.error || ''
);
await syncArea.set({ autoRetry: true });

// ---------- 8. 外链收录（external 渠道） ----------
calls.length = 0;
const externalResp = await sendMessage({
  action: 'uploadExternalLink',
  imageUrl: 'https://example.com/pics/external-link.png',
  fileName: 'external-link.png'
});
check('外链收录成功', externalResp?.success === true, externalResp?.error || '');
check(
  '外链收录返回绝对链接（相对路径被补全）',
  externalResp?.result?.url === `http://127.0.0.1:${port}/file/external-link.png`,
  externalResp?.result?.url
);
const externalCall = calls.find((c) => c.query.uploadChannel === 'external');
check('外链收录使用 external 渠道', !!externalCall);
check(
  '外链收录提交 url 与占位文件',
  !!externalCall && externalCall.bodyText.includes('name="url"') && externalCall.bodyText.includes('https://example.com/pics/external-link.png') && externalCall.bodyText.includes('name="file"')
);
check('外链收录带上认证头', externalCall?.authCodeHeader === 'test-auth-code');

// ---------- 9. 非图片文件上传 ----------
calls.length = 0;
const pdfData = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 test').toString('base64')}`;
const pdfResp = await sendMessage({
  action: 'uploadFile',
  fileData: pdfData,
  fileName: 'report.pdf',
  source: 'drag'
});
check('非图片文件可上传', pdfResp?.success === true, pdfResp?.error || '');
check('非图片文件保留原文件名', calls.some((c) => c.bodyText.includes('report.pdf')));

// ---------- 10. 渠道列表解析与删除路径 ----------
const channelGroups = sandbox.parseChannelGroups({
  telegram: [{ name: 'tg-main', type: 'TelegramNew' }],
  cfr2: [{ name: 'r2-a', type: 'CloudflareR2' }, { name: 'r2-b', type: 'CloudflareR2' }],
  s3: [],
  discord: [],
  huggingface: [],
  webdav: []
});
check('解析上游渠道分组', channelGroups.telegram.length === 1 && channelGroups.cfr2.length === 2, JSON.stringify(channelGroups));
check('渠道总数统计', sandbox.countChannelGroups(channelGroups) === 3);

const flatGroups = sandbox.parseChannelGroups([{ name: 'r2-a', type: 'cfr2' }]);
check('兼容数组结构', flatGroups.cfr2.length === 1, JSON.stringify(flatGroups));

check(
  '上游错误映射被展开',
  sandbox.extractUpstreamErrorMessage('{"cfr2":"Error: No R2 channel provided"}') === 'cfr2: No R2 channel provided',
  sandbox.extractUpstreamErrorMessage('{"cfr2":"Error: No R2 channel provided"}')
);

const deleteSegment = sandbox.buildDeletePathSegment('img/test/a.png');
check(
  '删除路径用逗号还原分隔符（上游解码后 split 还原）',
  decodeURIComponent(deleteSegment).split(',').join('/') === 'img/test/a.png',
  deleteSegment
);
check(
  '文件链接按路径段编码',
  sandbox.buildFileUrl('https://img.example.com/', 'img/test/a b.png') === 'https://img.example.com/file/img/test/a%20b.png'
);

server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
