const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'library.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const initial = {
  version: 1,
  updatedAt: new Date().toISOString(),
  items: [
    { id: 'fam-001', name: '混凝土框架柱 C30', category: '结构构件', discipline: '结构', version: '2.1', format: 'RVT', size: '2.4 MB', description: '常用现浇混凝土矩形框架柱族，包含多种截面参数。', tags: ['混凝土', '柱', '常用'], downloads: 128, status: 'published', updatedAt: new Date().toISOString() },
    { id: 'fam-002', name: 'LED 筒灯 12W', category: '照明设备', discipline: '电气', version: '1.3', format: 'RFA', size: '860 KB', description: '嵌入式筒灯，带功率、光通量及开孔尺寸参数。', tags: ['照明', '灯具'], downloads: 86, status: 'published', updatedAt: new Date().toISOString() },
    { id: 'fam-003', name: '单扇平开门 M0921', category: '门窗', discipline: '建筑', version: '1.0', format: 'RFA', size: '1.1 MB', description: '通用单扇平开门，可配置门洞宽度和高度。', tags: ['门', '建筑'], downloads: 64, status: 'published', updatedAt: new Date().toISOString() },
    { id: 'fam-004', name: '风机盘管卧式暗装', category: '暖通设备', discipline: '暖通', version: '0.9', format: 'RFA', size: '3.2 MB', description: '待审核的风机盘管族样例。', tags: ['暖通', '设备'], downloads: 0, status: 'draft', updatedAt: new Date().toISOString() }
  ]
};

function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2)); return structuredClone(initial); }
}
let store = loadStore();
function save() { store.version += 1; store.updatedAt = new Date().toISOString(); fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }
function send(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('请求内容不是有效 JSON')); } }); req.on('error', reject); }); }
function safeItem(item) { return { ...item, tags: Array.isArray(item.tags) ? item.tags : [] }; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/library' && req.method === 'GET') {
      const items = store.items.filter(item => url.searchParams.get('includeDrafts') === 'true' || item.status === 'published');
      return send(res, 200, { version: store.version, updatedAt: store.updatedAt, items });
    }
    if (url.pathname === '/api/items' && req.method === 'POST') {
      const input = await body(req);
      if (!input.name || !input.category) return send(res, 400, { error: '名称和分类为必填项' });
      const item = safeItem({ id: crypto.randomUUID(), name: String(input.name).trim(), category: String(input.category).trim(), discipline: String(input.discipline || '通用'), version: String(input.version || '1.0'), format: String(input.format || 'RFA').toUpperCase(), size: String(input.size || '待上传'), description: String(input.description || '').trim(), tags: String(input.tags || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean), downloads: 0, status: input.status === 'draft' ? 'draft' : 'published', updatedAt: new Date().toISOString() });
      store.items.unshift(item); save(); return send(res, 201, { item, version: store.version });
    }
    const itemRoute = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemRoute && req.method === 'PATCH') {
      const item = store.items.find(entry => entry.id === decodeURIComponent(itemRoute[1]));
      if (!item) return send(res, 404, { error: '未找到该族文件' });
      const input = await body(req);
      if (input.status && !['published', 'draft'].includes(input.status)) return send(res, 400, { error: '无效状态' });
      Object.assign(item, input, { updatedAt: new Date().toISOString() }); save(); return send(res, 200, { item, version: store.version });
    }
    if (itemRoute && req.method === 'DELETE') {
      const before = store.items.length; store.items = store.items.filter(item => item.id !== decodeURIComponent(itemRoute[1]));
      if (store.items.length === before) return send(res, 404, { error: '未找到该族文件' });
      save(); return send(res, 200, { ok: true, version: store.version });
    }
    const downloadRoute = url.pathname.match(/^\/api\/items\/([^/]+)\/download$/);
    if (downloadRoute && req.method === 'POST') {
      const item = store.items.find(entry => entry.id === decodeURIComponent(downloadRoute[1]) && entry.status === 'published');
      if (!item) return send(res, 404, { error: '该族文件暂不可用' });
      item.downloads += 1; save(); return send(res, 200, { item, version: store.version });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: '接口不存在' });
    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.resolve(PUBLIC_DIR, `.${requestPath}`);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, { error: '页面不存在' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, 500, { error: error.message || '服务器内部错误' });
  }
});
server.listen(PORT, () => console.log(`族库同步演示已启动：http://localhost:${PORT}`));
