import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { renderPage } from './page.mjs';

export async function createLoginServer({ backend, token, port = 0, connection, restart }) {
  if (!token) throw new Error('ADMIN_ACCESS_TOKEN is missing; run npm run init first');
  const prefix = `/login/${randomBytes(24).toString('hex')}`, nonce = randomBytes(24).toString('base64');
  let qr, inFlight, closing;
  const controller = new AbortController();
  async function call(path, params) {
    const current = connection ? connection() : { backend, token };
    const base = new URL(current.backend);
    const response = await fetch(new URL(path, base), { method: params === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' },
      body: params === undefined ? undefined : JSON.stringify(params),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
    const value = await response.json();
    if (!response.ok || value.status === 'failed') throw Object.assign(new Error(value.message || '无法连接机器人服务'), { status:response.status });
    return value.data ?? value;
  }
  async function snapshot() {
    let status = await call('/admin/status');
    const current = qr;
    let login;
    if (!status.online && current?.handle) {
      try { login = await call('/admin/login/poll', { handle: current.handle }); }
      catch { /* Restarting the host can invalidate an earlier QR handle. */ }
      if (login?.state === 'online') status = await call('/admin/status');
    }
    return { online: status.online === true,
      state: status.online ? 'online' : login?.state || status.kernel?.login_state || status.native?.login_state || 'idle',
      account: status.account || 0, driver: status.driver, simulated: status.simulated === true,privacy:status.privacy,
      ai_enabled: status.ai_enabled === true, jobs: status.jobs || {}, version: status.kernel?.version || null,
      endpoint: new URL(connection ? connection().backend : backend).origin, can_restart:!!restart,
      expires_at: current === qr ? login?.expires_at ?? qr?.expires_at ?? null : null,
      handle: qr?.handle || null, checked_at: Date.now() };
  }
  const html = renderPage(nonce);
  const server = createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; img-src data:; connect-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` };
    function reply(code, data, type = 'application/json') {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(code, { ...headers, 'Content-Type': `${type}; charset=utf-8` }); res.end(type === 'text/html' ? data : JSON.stringify(data));
    }
    const address = server.address(), origin = address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : null;
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.slice(prefix.length);
    const routes = ['', '/qr','/state','/settings','/settings/reveal','/models','/telemetry','/jobs','/job','/resolve','/logout','/restart'];
    if (!origin || req.headers.host !== new URL(origin).host || !url.pathname.startsWith(prefix) || !routes.includes(route)) { reply(404, { message: 'Not found' }); return; }
    try {
      if (req.method === 'POST' && req.headers.origin !== origin) { reply(403, { message: 'Origin rejected' }); return; }
      if (req.method === 'GET' && route === '') { reply(200, html, 'text/html'); return; }
      if (req.method === 'GET' && route === '/state') { reply(200, await snapshot()); return; }
      if (req.method === 'GET' && route === '/settings') { reply(200, await call('/admin/settings')); return; }
      if (req.method === 'GET' && route === '/jobs') { reply(200, await call('/admin/jobs')); return; }
      if (req.method === 'GET' && route === '/job') {
        const id = url.searchParams.get('id');
        if (!/^[1-9]\d{0,14}$/.test(id||'')) { reply(400, { message:'无效任务编号。' }); return; }
        reply(200, await call('/admin/jobs/'+id)); return;
      }
      if (req.method === 'GET' && route === '/telemetry') {
        const after = url.searchParams.get('after') || '0';
        if (!/^\d{1,16}$/.test(after)) { reply(400, { message:'无效的监听游标。' }); return; }
        reply(200, await call('/admin/telemetry?after=' + after)); return;
      }
      if (req.method === 'POST' && route === '/qr') {
        if (!inFlight) inFlight = call('/admin/login/start', {}).then(value => { qr = value; return value; }).finally(() => { inFlight = null; });
        reply(200, await inFlight); return;
      }
      if (req.method === 'POST' && route === '/restart') {
        if (!restart) { reply(409, { message:'此工作台复用了其他进程的服务。请在原服务窗口重新启动。' }); return; }
        reply(200, await restart()); qr = null; return;
      }
      if (req.method === 'POST' && route === '/logout') { reply(200, await call('/admin/login/logout', {})); qr = null; return; }
      if (req.method === 'POST' && ['/settings','/settings/reveal','/resolve','/models'].includes(route)) {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 262144) { reply(413, { message:'请求超过 256 KiB。' }); return; } chunks.push(chunk); }
        const text = Buffer.concat(chunks).toString('utf8');
        let params;
        try { params = JSON.parse(text); } catch { reply(400, { message:'无效 JSON。' }); return; }
        if (!params || typeof params !== 'object' || Array.isArray(params)) { reply(400, { message:'请求必须是对象。' }); return; }
        if (route === '/resolve') {
          if (!Number.isSafeInteger(params.id) || params.id < 1 || !['sent','discard'].includes(params.outcome)) { reply(400, { message:'无效任务操作。' }); return; }
          reply(200, await call(`/admin/jobs/${params.id}/resolve`, { outcome:params.outcome })); return;
        }
        reply(200, await call('/admin' + route, params)); return;
      }
      reply(405, { message: 'Method not allowed' });
    } catch (error) { reply([400,409,413].includes(error.status) ? error.status : 502, { message:error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return { server, url: `http://127.0.0.1:${server.address().port}${prefix}`, close() {
    if (!closing) closing = new Promise((resolve, reject) => { controller.abort(); server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); });
    return closing;
  } };
}
