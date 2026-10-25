import { createServer } from 'node:http';
import { createHash, timingSafeEqual, createHmac } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { BotError, ok, failure } from './errors.mjs';
import { boolean, id } from './messages.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
function equal(a, b) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function authorize(req, url, expected, { allowQuery = true } = {}) {
  if (typeof expected !== 'string' || !expected.length) return false;
  const header = req.headers.authorization || '';
  const match = /^(?:Bearer|Token) (.+)$/i.exec(header);
  return equal(match?.[1] || (allowQuery ? url.searchParams.get('access_token') : '') || '', expected);
}
async function body(req, maxBytes = MAX_BYTES) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw new BotError('Request body exceeds ONEBOT_MAX_REQUEST_BYTES', 1400);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  if ((req.headers['content-type'] || '').split(';')[0] === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(text));
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new BotError('Invalid request JSON', 1400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BotError('Request body must be an object', 1400);
  return value;
}
function respond(res, code, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function httpCode(error) {
  return [1400, 1404].includes(error.code) ? error.code - 1000 : error.code ? 200 : 500;
}
function send(ws, value) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > MAX_BYTES) { ws.close(1008, 'Slow consumer'); return; }
  ws.send(JSON.stringify(value), error => { if (error) ws.terminate(); });
}

export class OneBotServer {
  constructor({ adapter, worker, store, config, log, telemetry, settings }) {
    Object.assign(this, { adapter, worker, store, config, log, telemetry, settings });
    this.clients = new Map(); this.reverse = new Map(); this.closed = false;
    this.controller = new AbortController(); this.webhookTail = Promise.resolve(); this.webhookPending = 0;
    this.server = createServer((req, res) => { this.http(req, res).catch(() => respond(res, 500, failure(new Error()))); });
    this.server.requestTimeout = 30000; this.server.headersTimeout = 10000;
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: config.maxRequestBytes || MAX_BYTES });
    this.server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
      const path = url.pathname.replace(/\/$/, '') || '/';
      if (!authorize(req, url, config.token)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
      }
      if (!['/', '/api', '/event'].includes(path)) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return;
      }
      this.wsServer.handleUpgrade(req, socket, head, ws => this.attach(ws, path !== '/api', path !== '/event'));
    });
    this.onEvent = event => {
      try {
        if (!worker.ingest(event)) return;
        this.broadcast(event);
      } catch { this.log('error', 'event_persistence_failed'); }
    };
    this.onState = () => {
      this.broadcast(this.meta('lifecycle', { sub_type: adapter.status().online ? 'enable' : 'disable' }));
      for (const url of config.reverseUrls) if (!this.reverse.has(url)) this.connectReverse(url, 0);
    };
    adapter.on('event', this.onEvent); adapter.on('state', this.onState);
  }
  meta(type, fields = {}) {
    return { time: Math.floor(Date.now() / 1000), self_id: this.adapter.driver.account,
      post_type: 'meta_event', meta_event_type: type, ...fields };
  }
  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.port, this.config.host, () => { this.server.off('error', reject); resolve(); });
    });
    const address=this.server.address();
    const boundHost=['0.0.0.0','localhost'].includes(this.config.host)?'127.0.0.1':this.config.host==='::'?'::1':this.config.host;
    const host=boundHost.includes(':')&&!boundHost.startsWith('[')?'['+boundHost+']':boundHost;
    this.adapter.driver.images?.setOrigin('http://'+host+':'+address.port);
    this.heartbeat = setInterval(() => this.broadcast(this.meta('heartbeat', {
      status: this.adapter.status(), interval: this.config.heartbeatMs })), this.config.heartbeatMs);
    this.pingTimer = setInterval(() => {
      for (const [ws, client] of this.clients) {
        if (!client.alive) { ws.terminate(); continue; }
        client.alive = false; ws.ping();
      }
    }, 30000);
    for (const url of this.config.reverseUrls) this.connectReverse(url, 0);
    return this.server.address();
  }
  async http(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { respond(res, 400, failure(new BotError('Invalid URL', 1400))); return; }
    const path = url.pathname.replace(/\/$/, '') || '/';
    if(await this.adapter.driver.images?.http(req,res,url))return;
    if (path === '/healthz') { respond(res, 200, { ok: !this.closed }); return; }
    if (path === '/readyz') { respond(res, this.adapter.status().online ? 200 : 503, { ready: this.adapter.status().online }); return; }
    const admin = path === '/admin' || path.startsWith('/admin/');
    if (!authorize(req, url, admin ? this.config.adminToken : this.config.token, { allowQuery: !admin })) {
      respond(res, 401, failure(new BotError('Unauthorized', 1401))); return;
    }
    try {
      if (path === '/admin/status') {
        respond(res, 200, { ...this.adapter.status(), account: this.adapter.driver.account, jobs: this.store.summary(),
          ai_enabled: this.config.ai.enabled, capabilities: this.adapter.driver.capabilities,
          privacy:{...this.store.privacyStatus(),retain_ignored_content:this.config.retainIgnoredContent,
            history_days:this.config.retentionDays,memory_limit:this.telemetry.limit} }); return;
      }
      if (path === '/admin/settings' && req.method === 'GET') { respond(res, 200, await this.settings.snapshot()); return; }
      if (path === '/admin/settings' && req.method === 'POST') {
        const params = await body(req, this.config.maxRequestBytes || MAX_BYTES);
        const snapshot = await this.settings.save(params.values, params.revision);
        this.log('info', 'settings_saved', { count:Object.keys(params.values).length });
        respond(res, 200, snapshot); return;
      }
      if (path === '/admin/settings/reveal' && req.method === 'POST') {
        const params = await body(req, this.config.maxRequestBytes || MAX_BYTES); respond(res, 200, await this.settings.reveal(params.key)); return;
      }
      if (path === '/admin/models' && req.method === 'POST') {
        const params = await body(req, this.config.maxRequestBytes || MAX_BYTES); respond(res, 200, await this.settings.models(params)); return;
      }
      if (path === '/admin/telemetry' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new BotError('Invalid telemetry cursor', 1400);
        respond(res, 200, this.telemetry.read(after)); return;
      }
      if (path === '/admin/jobs' && req.method === 'GET') { respond(res, 200, this.store.list()); return; }
      if (/^\/admin\/jobs\/\d+$/.test(path) && req.method === 'GET') {
        const job = this.store.get(Number(path.split('/').at(-1)));
        if (!job) throw new BotError('Job not found', 1404);
        respond(res, 200, { ...job, event:JSON.parse(job.event) }); return;
      }
      if (path.startsWith('/admin/login/') && req.method === 'POST') {
        const params = await body(req, this.config.maxRequestBytes || MAX_BYTES);
        respond(res, 200, ok(await this.adapter.login(path.split('/').at(-1), params))); return;
      }
      if (/^\/admin\/jobs\/\d+\/resolve$/.test(path) && req.method === 'POST') {
        const params = await body(req, this.config.maxRequestBytes || MAX_BYTES);
        const job = this.store.get(Number(path.split('/')[3]));
        if (!job || job.status !== 'uncertain') throw new BotError('Job is not uncertain', 1400);
        if (params.outcome === 'sent' && job.reply) this.store.finish(job, this.config.ai.contextTurns);
        else if (params.outcome === 'discard') this.store.update(job.id, 'failed', { reason: 'manually_discarded' });
        else throw new BotError('outcome must be sent or discard; automatic resend is unavailable', 1400);
        respond(res, 200, ok()); return;
      }
      if (path === '/admin/demo/inject' && req.method === 'POST') {
        if (this.adapter.driver.mode !== 'demo') throw new BotError('Demo injection is disabled', 1404);
        const params = await body(req, this.config.maxRequestBytes || MAX_BYTES);
        const kind = params.kind || 'private';
        if (!['private', 'group'].includes(kind)) throw new BotError('Invalid kind', 1400);
        const message = { id: id(params.id, 'id', { signed: true }), kind,
          sender: { user_id: id(params.user_id, 'user_id'), nickname: 'DEMO 用户' },
          message: params.message, ...(kind === 'group' ? { groupId: id(params.group_id, 'group_id') } : {}) };
        this.adapter.driver.inject(message);
        respond(res, 200, ok({ simulated: true })); return;
      }
      if (!['GET', 'POST'].includes(req.method)) { respond(res, 405, failure(new BotError('Method not allowed', 1400))); return; }
      const query = Object.fromEntries(url.searchParams);
      const posted = req.method === 'POST' ? await body(req, this.config.maxRequestBytes || MAX_BYTES) : {};
      const params = { ...query, ...posted };
      delete params.access_token;
      const form = (req.headers['content-type'] || '').split(';')[0] === 'application/x-www-form-urlencoded';
      if ((!Object.hasOwn(posted, 'message') || form) && typeof params.message === 'string' && params.message.startsWith('[')) {
        try { const parsed = JSON.parse(params.message); if (Array.isArray(parsed)) params.message = parsed; } catch { /* CQ or plain text */ }
      }
      respond(res, 200, ok(await this.adapter.action(path.slice(1), params)));
    } catch (error) {
      if (path.startsWith('/admin/settings') || path==='/admin/models') respond(res, error.status || 400, { status:'failed', message:error.message });
      else respond(res, httpCode(error), failure(error));
    }
  }
  attach(ws, events, api) {
    const client = { events, api, inFlight: 0, alive: true };
    this.clients.set(ws, client);
    ws.on('error', () => {});
    ws.on('pong', () => { client.alive = true; });
    ws.on('close', () => this.clients.delete(ws));
    ws.on('message', (data, binary) => {
      if (!api) return;
      let request;
      try {
        if (binary) throw new Error();
        request = JSON.parse(data.toString());
        if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.action !== 'string') throw new Error();
      } catch { send(ws, failure(new BotError('Invalid OneBot request', 1400))); return; }
      const echo = Object.hasOwn(request, 'echo') ? { echo: request.echo } : {};
      if (client.inFlight >= 16) { send(ws, { ...failure(new BotError('Too many in-flight requests', 1503)), ...echo }); return; }
      client.inFlight++;
      this.adapter.action(request.action, request.params).then(
        result => send(ws, { ...ok(result), ...echo }),
        error => send(ws, { ...failure(error), ...echo })
      ).finally(() => { client.inFlight--; });
    });
    if (events) send(ws, this.meta('lifecycle', { sub_type: 'connect' }));
  }
  broadcast(event) {
    for (const [ws, client] of this.clients) if (client.events) send(ws, event);
    if (this.config.webhookUrl && this.webhookPending < 256) {
      this.webhookPending++;
      this.webhookTail = this.webhookTail.then(() => this.postWebhook(event)).catch(() => {
        if (!this.closed) this.log('warn', 'webhook_delivery_failed');
      }).finally(() => { this.webhookPending--; });
    } else if (this.config.webhookUrl) this.log('warn', 'webhook_queue_full');
  }
  async postWebhook(event) {
    if (this.closed) return;
    const text = JSON.stringify(event);
    const response = await fetch(this.config.webhookUrl, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Self-ID': String(event.self_id),
        ...(this.config.webhookSecret ? { 'X-Signature': `sha1=${createHmac('sha1', this.config.webhookSecret).update(text).digest('hex')}` } : {}) },
      body: text, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Webhook failed'); }
    if (response.status === 204) return;
    // Only reply/auto_escape/at_sender quick operations are supported.
    let raw = '';
    for await (const chunk of response.body) {
      raw += Buffer.from(chunk).toString('binary');
      if (raw.length > 65536) throw new Error('Webhook response too large');
    }
    if (!raw.trim() || event.post_type !== 'message') return;
    const quick = JSON.parse(Buffer.from(raw, 'binary').toString('utf8'));
    if (quick.reply === undefined) return;
    let reply = quick.reply;
    const defaultAt = this.adapter.driver.capabilities.includes('message.at');
    if (event.message_type === 'group' && boolean(quick.at_sender, defaultAt)) {
      const { parseMessage } = await import('./messages.mjs');
      reply = [{ type: 'at', data: { qq: String(event.user_id) } },
        ...parseMessage(reply, boolean(quick.auto_escape))];
    }
    await this.adapter.action(event.message_type === 'group' ? 'send_group_msg' : 'send_private_msg', {
      message: reply, auto_escape: boolean(quick.auto_escape), user_id: event.user_id, group_id: event.group_id
    }, { signal: this.controller.signal });
  }
  connectReverse(url, attempt) {
    if (this.closed || !this.adapter.driver.account || this.reverse.has(url)) return;
    const entry = { socket: null, timer: null };
    this.reverse.set(url, entry);
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.config.reverseToken}`,
      'X-Self-ID': String(this.adapter.driver.account), 'X-Client-Role': 'Universal' },
      handshakeTimeout: 10000, maxPayload: this.config.maxRequestBytes || MAX_BYTES, followRedirects: false });
    entry.socket = ws;
    ws.on('error', () => {});
    ws.on('open', () => { attempt = 0; this.attach(ws, true, true); this.log('info', 'reverse_ws_connected'); });
    ws.on('close', () => {
      if (this.closed) return;
      const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 300);
      entry.timer = setTimeout(() => {
        this.reverse.delete(url); this.connectReverse(url, attempt + 1);
      }, wait);
    });
  }
  async close() {
    this.closed = true; clearInterval(this.heartbeat); clearInterval(this.pingTimer); this.controller.abort();
    this.adapter.off('event', this.onEvent); this.adapter.off('state', this.onState);
    for (const entry of this.reverse.values()) { clearTimeout(entry.timer); entry.socket?.terminate(); }
    for (const ws of this.clients.keys()) ws.terminate();
    this.wsServer.close();
    if (this.server.listening) {
      this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
    await this.webhookTail;
  }
}
