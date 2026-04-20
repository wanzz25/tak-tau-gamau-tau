// api/index.js — MC AutoBackup Vercel Serverless API
// Semua data disimpan di browser (localStorage via client)
// Server hanya dipakai untuk PROXY ke Pterodactyl (bypass CORS)

const https = require('https');
const http  = require('http');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try { resolve(JSON.parse(b)); } catch { resolve({}); }
    });
  });
}

// ── Pterodactyl Proxy ──────────────────────────────────────
function ptProxy(res, { panelUrl, apiKey, serverUuid }, method, ptPath, data) {
  let parsedUrl;
  try { parsedUrl = new URL(panelUrl); } 
  catch { return send(res, 400, { error: 'Panel URL tidak valid' }); }

  const isHttps = parsedUrl.protocol === 'https:';
  const lib     = isHttps ? https : http;
  const bodyStr = data ? JSON.stringify(data) : null;

  const opts = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: ptPath,
    method: method || 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
    },
    timeout: 30000
  };

  const pReq = lib.request(opts, pRes => {
    let raw = '';
    pRes.on('data', c => raw += c);
    pRes.on('end', () => {
      res.writeHead(pRes.statusCode, { 'Content-Type': 'application/json', ...CORS });
      res.end(raw);
    });
  });

  pReq.on('timeout', () => { pReq.destroy(); send(res, 504, { error: 'Request timeout ke panel' }); });
  pReq.on('error', e => send(res, 502, { error: 'Gagal konek ke panel: ' + e.message }));
  if (bodyStr) pReq.write(bodyStr);
  pReq.end();
}

// ── Main Handler ───────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url      = req.url || '/';
  const pathname = url.split('?')[0];
  const body     = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};

  // ── Health check ────────────────────────────────────────
  if (pathname === '/api/ping') {
    return send(res, 200, { ok: true, time: new Date().toISOString(), version: '3.0.0' });
  }

  // ════════════════════════════════════════════════════════
  // PROXY — semua request ke Pterodactyl panel
  // Body: { panelUrl, apiKey, serverUuid, method, ptPath, data }
  // ════════════════════════════════════════════════════════
  if (pathname === '/api/proxy') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const { panelUrl, apiKey, serverUuid, method, ptPath, data } = body;

    if (!panelUrl) return send(res, 400, { error: 'panelUrl wajib diisi' });
    if (!apiKey)   return send(res, 400, { error: 'apiKey wajib diisi' });
    if (!ptPath)   return send(res, 400, { error: 'ptPath wajib diisi' });

    console.log(`[proxy] ${method||'GET'} ${panelUrl}${ptPath}`);
    return ptProxy(res, { panelUrl, apiKey, serverUuid }, method || 'GET', ptPath, data);
  }

  // ── Test koneksi ke panel ────────────────────────────────
  if (pathname === '/api/test') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const { panelUrl, apiKey, serverUuid } = body;
    if (!panelUrl || !apiKey || !serverUuid)
      return send(res, 400, { error: 'panelUrl, apiKey, serverUuid wajib' });

    return ptProxy(res, { panelUrl, apiKey }, 'GET', `/api/client/servers/${serverUuid}`, null);
  }

  // ── Buat backup ─────────────────────────────────────────
  if (pathname === '/api/backup/create') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const { panelUrl, apiKey, serverUuid, name, isLocked } = body;
    if (!panelUrl || !apiKey || !serverUuid)
      return send(res, 400, { error: 'panelUrl, apiKey, serverUuid wajib' });

    console.log(`[backup] Create "${name}" → ${panelUrl}`);
    return ptProxy(res, { panelUrl, apiKey }, 'POST',
      `/api/client/servers/${serverUuid}/backups`,
      { name: name || 'mc-backup', is_locked: isLocked || false }
    );
  }

  // ── Cek status backup ───────────────────────────────────
  if (pathname === '/api/backup/status') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const { panelUrl, apiKey, serverUuid, backupUuid } = body;
    if (!backupUuid) return send(res, 400, { error: 'backupUuid wajib' });

    return ptProxy(res, { panelUrl, apiKey }, 'GET',
      `/api/client/servers/${serverUuid}/backups/${backupUuid}`, null
    );
  }

  // ── List backups dari panel ─────────────────────────────
  if (pathname === '/api/backup/list') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const { panelUrl, apiKey, serverUuid } = body;
    if (!panelUrl || !apiKey || !serverUuid)
      return send(res, 400, { error: 'panelUrl, apiKey, serverUuid wajib' });

    return ptProxy(res, { panelUrl, apiKey }, 'GET',
      `/api/client/servers/${serverUuid}/backups`, null
    );
  }

  // ── Delete backup dari panel ────────────────────────────
  if (pathname === '/api/backup/delete') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const { panelUrl, apiKey, serverUuid, backupUuid } = body;
    if (!backupUuid) return send(res, 400, { error: 'backupUuid wajib' });

    return ptProxy(res, { panelUrl, apiKey }, 'DELETE',
      `/api/client/servers/${serverUuid}/backups/${backupUuid}`, null
    );
  }

  // 404
  send(res, 404, { error: `Endpoint tidak ditemukan: ${pathname}` });
};
