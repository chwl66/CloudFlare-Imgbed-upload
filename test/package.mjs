// 打包扩展：只收运行时必需文件，输出 dist/cloudflare-imgbed-uploader-v<version>.zip
// 零依赖（Node 18+），自带最小 ZIP 写入器，保证条目名用正斜杠、manifest.json 位于压缩包根目录
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');

// 运行时必需文件（与 manifest.json 及各页面的引用一一对应）
const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'utils.js',
  'config.js',
  'history-store.js',
  'notification.js',
  'notification.css',
  'popup.html',
  'popup.js',
  'popup.css',
  'history.html',
  'history.js',
  'manage.html',
  'manage.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() / 2) & 0x1F);
  const day = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
  return { time, day };
}

// ---------- ZIP 写入 ----------
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = entry.data;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const { time, day } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 文件名标志
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014B50, 0);
    cd.writeUInt16LE(20, 4);             // version made by
    cd.writeUInt16LE(20, 6);             // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);             // extra
    cd.writeUInt16LE(0, 32);             // comment
    cd.writeUInt16LE(0, 34);             // disk
    cd.writeUInt16LE(0, 36);             // internal attrs
    cd.writeUInt32LE(0, 38);             // external attrs
    cd.writeUInt32LE(offset, 42);

    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// ---------- 主流程 ----------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;

const missing = FILES.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error('缺少文件：', missing.join(', '));
  process.exit(1);
}

const entries = FILES.map(name => {
  const abs = path.join(ROOT, name);
  return { name, data: fs.readFileSync(abs), mtime: fs.statSync(abs).mtime };
});

const zip = buildZip(entries);
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `cloudflare-imgbed-uploader-v${version}.zip`);
fs.writeFileSync(outFile, zip);

const rawTotal = entries.reduce((sum, e) => sum + e.data.length, 0);
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`打包完成：${path.relative(ROOT, outFile)}`);
console.log(`版本 ${version}，${entries.length} 个文件，原始 ${kb(rawTotal)} → 压缩后 ${kb(zip.length)}`);
for (const entry of entries) {
  console.log(`  ${entry.name.padEnd(22)} ${kb(entry.data.length).padStart(9)}`);
}
