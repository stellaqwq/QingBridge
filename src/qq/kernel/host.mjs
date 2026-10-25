import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { release, hostname } from 'node:os';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { BotError } from '../../errors.mjs';
import { SendTracker } from './messages.mjs';
import { loginOptions } from './profile.mjs';
import { waitForMessageService } from './session-ready.mjs';
import { fetchKernelFriends, fetchKernelGroups } from './contacts.mjs';
import { abortable, quickLoginAccount, shutdownKernel } from './lifecycle.mjs';
import { sendKernelMessage } from './send.mjs';
import { hasImages } from './elements.mjs';
import { ImageCache } from './image.mjs';
import { ImageReceiver } from './receive-images.mjs';

const config = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString());
const send = packet => { if (process.connected) process.send(packet, () => {}); };
const event = (name, data) => send({ event: name, data });
const requests = new Map(), tracker = new SendTracker(config.rpcTimeout - 1000);
const lifetime = new AbortController();
const imageCache=new ImageCache(join(config.dataDir,'media-outbox'),{maxBytes:config.media?.maxBytes,retentionDays:config.media?.retentionDays});
const imageReceiver=new ImageReceiver(config.dataDir,config.media);
const receivedTails=new Map();let receivedCount=0;
let wrapper, engine, login, session, startup, msgService, self, qr, online = false, starting, deviceInfo, state = 'booting';
const contacts = new Map();
const callbacks = new EventEmitter(); let requestingQR = false;
let restoring, stopping, transportMonitor;
let sessionGeneration = 0, sessionController = new AbortController(), authenticationRequired = false;
const devicePath = join(config.dataDir, 'device.json');
const profile = { platform_type: 3, app_type: 4, app_version: config.version, os_version: release(),
  global_path_config: { desktopGlobalPath: config.dataDir, mobileGlobalDBPath: config.dataDir,
    mobileGlobalDataPath: config.dataDir, mobileGlobalTempPath: config.dataDir, base_path_prefix: config.dataDir },
  thumb_config: { maxSide: 640, minSide: 198, longLimit: 4096, density: 1 }, use_xlog: false, qua: `V1_WIN_NQ_${config.version.replace('-', '_')}_GW_B` };
function status(next, extra = {}) {
  state = next; event('state', { state, online, account: Number(self?.uin) || 0, ...extra }); callbacks.emit('state');
}
function invalidateSession() {
  sessionGeneration++; sessionController.abort(); sessionController = new AbortController(); starting = null;
}
function sessionOperation(signal) {
  const generation = sessionGeneration;
  const combined = AbortSignal.any([lifetime.signal, sessionController.signal, ...(signal ? [signal] : [])]);
  const current = () => generation === sessionGeneration && !stopping && !lifetime.signal.aborted;
  return { signal: combined, current, assert() {
    combined.throwIfAborted();
    if (!current()) throw new BotError('QQ session has been superseded', 1502);
  } };
}
function lost(next = 'connection_lost') {
  online = false; tracker.close();
  if (next === 'kicked') { authenticationRequired = true; invalidateSession(); clearInterval(transportMonitor); }
  status(next, { reconnect: true });
}
function listener(handlers = {}) {
  return new Proxy(handlers, { get(target, key) {
    if (key === 'then' || typeof key === 'symbol') return undefined;
    return target[key] || (() => {});
  } });
}
function rows(value) { return Array.isArray(value) ? value : value?.msgList || []; }
function learn(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return;
  const uin = Number(value.uin || value.senderUin), uid = value.uid || value.senderUid;
  if (Number.isSafeInteger(uin) && uin > 0 && typeof uid === 'string' && uid) {
    const previous = contacts.get(uin);
    contacts.set(uin, { user_id: uin, uid, nickname: value.nick || value.coreInfo?.nick || value.nickname || value.sendNickName || previous?.nickname || '', remark: value.remark || previous?.remark || '' });
    event('contact', contacts.get(uin));
  }
  for (const item of value instanceof Map ? value.values() : Object.values(value)) if (item && typeof item === 'object') learn(item, depth + 1);
}
function onMessages(value, received = false) {
  for (const raw of rows(value)) {
    tracker.update(raw); learn(raw);
    if (received && online) queueReceived(raw);
  }
}
function queueReceived(raw) {
  if(receivedCount>=256){console.error(JSON.stringify({event:'image_receive_queue_full'}));return;}
  const guard=sessionOperation(),key=JSON.stringify([raw.chatType,raw.peerUid]);
  const service=msgService;receivedCount++;
  const pending=(receivedTails.get(key)||Promise.resolve()).then(async()=>{
    guard.assert();
    const message=(raw.elements||[]).some(e=>Number(e.elementType)===2)?await imageReceiver.prepare(raw,service,guard.signal):raw;
    guard.assert();if(online)event('message',{...message,selfUid:self?.uid});
  }).catch(error=>{if(guard.current())console.error(JSON.stringify({event:'message_receive_failed',code:error instanceof BotError?error.code:1500}));})
    .finally(()=>{receivedCount--;if(receivedTails.get(key)===pending)receivedTails.delete(key);});
  receivedTails.set(key,pending);
}
function onMediaUpload(value) {
  const code=Number(value?.fileErrCode);
  if(Number.isSafeInteger(code)&&code!==0) console.error(JSON.stringify({event:'media_upload_failed',code}));
}
async function initializeSession(info) {
  if (stopping || state === 'kicked') return;
  if (starting || online) return starting;
  const guard = sessionOperation();
  const onlyCurrent = handler => (...args) => { if (guard.current()) return handler(...args); };
  const operation = (async () => {
    guard.assert();
    const identity = info?.selfInfo || info;
    const uin = Number(identity?.uin);
    if (!Number.isSafeInteger(uin) || uin <= 0 || typeof identity?.uid !== 'string' || !identity.uid) throw new BotError('QQ login returned no valid account identity', 1500);
    if (config.account && uin !== config.account) throw new BotError('Scanned QQ account does not match QQ_ACCOUNT', 1400);
    self = { ...identity, uin: String(uin) }; status('authenticated', { authenticated: true }); learn(self);
    startup = wrapper.NodeIQQNTStartupSessionWrapper.createWithModuleList(['nt']);
    const sessionId = startup.getSessionIdList().get('nt');
    session = sessionId ? wrapper.NodeIQQNTWrapperSession.getNTWrapperSession(sessionId) : null;
    if (!session) throw new BotError('Authenticated QQ kernel did not expose a session', 1501);
    const activeSession = session, activeStartup = startup;
    const accountPath = join(config.dataDir, 'accounts', self.uin); mkdirSync(accountPath, { recursive: true });
    const sessionConfig = { selfUin: self.uin, selfUid: self.uid, sysPath: config.appPath, userPath: accountPath,
      gproDBName: 'gpro.db', clientVer: config.version, a2: identity.a2 || '', d2: identity.d2 || '', d2Key: identity.d2Key || '', machineId: config.machineId,
      platform: 3, deviceType: 3, platVer: release(), rdeliveryConfig: { appKey: '', systemId: 0, appId: '', logicEnvironment: '',
        platform: 3, language: 'zh-CN', sdkVersion: '', userId: self.uin, appVersion: config.version, osVersion: release(), bundleId: '', serverUrl: '', fixedAfterHitKeys: [] },
      defaultFileDownloadPath: join(config.dataDir, 'downloads'), extDataPath: config.dataDir,
      desktopPathConfig: { account_path: accountPath }, mobilePathConfig: {}, appid: config.appid, deviceInfo,
      deviceConfig: JSON.stringify({ appearance: { isSplitViewMode: true }, msg: {} }), useNewVerBuddyData: true };
    status('initializing_session');
    await new Promise((resolve, reject) => {
      let initialized = false, finished = false;
      const abort = () => finish(new BotError('QQ session initialization cancelled', 1502));
      const timer = setTimeout(() => finish(new BotError('QQ session initialization confirmation timed out', 1502)), config.rpcTimeout);
      const finish = error => {
        if (finished) return; finished = true; clearTimeout(timer); guard.signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      guard.signal.addEventListener('abort', abort, { once: true });
      if (guard.signal.aborted) { abort(); return; }
      const sessionListener = listener({
        onSessionInitComplete: code => {
          if (initialized || finished) return; initialized = true;
          if (Number(code) !== 0) { finish(new BotError('QQ kernel rejected session initialization', 1500)); return; }
          setImmediate(() => {
            try { guard.assert(); callbacks.confirmedSessionId = activeSession.getSessionId(); finish(); }
            catch { finish(new BotError('QQ session identity lookup failed', 1500)); }
          });
        },
        onNTSessionCreate: () => {},
        onUserOnlineResult: () => {},
        onKickedOffline: onlyCurrent(() => lost('kicked')), onKickedOffLine: onlyCurrent(() => lost('kicked'))
      });
      try {
        activeSession.init(sessionConfig, listener({ onMSFStatusChange: onlyCurrent(() => {
          setImmediate(onlyCurrent(() => { try { if (online && Number(activeSession.getMSFService().getMsfStatus()) !== 1) lost(); } catch { if (online) lost(); } }));
        }), onMSFSsoError: onlyCurrent(() => { if (online) lost(); }), onKickedOffLine: onlyCurrent(() => lost('kicked')), getGroupCode: () => '' }), listener(), sessionListener);
        activeStartup.start();
      } catch { finish(new BotError('QQ session API initialization failed', 1500)); }
    });
    const service = await waitForMessageService({ session: activeSession, makeListener: listener, onMessages: onlyCurrent(onMessages), onMediaUpload: onlyCurrent(onMediaUpload),
      onMediaDownload:onlyCurrent(value=>imageReceiver.complete(value)),
      onKickedOffline: onlyCurrent(() => lost('kicked')), timeout: config.rpcTimeout, signal: guard.signal });
    guard.assert(); msgService = service;
    callbacks.messageSessionId = activeSession.getSessionId();
    try { activeSession.getBuddyService().addKernelBuddyListener(listener({
      onBuddyListChange: onlyCurrent((...values) => { values.forEach(value => learn(value)); callbacks.emit('buddy-list', ...values); }),
      onBuddyListChangedV2: onlyCurrent((...values) => { values.forEach(value => learn(value)); callbacks.emit('buddy-list', ...values); }), onBuddyInfoChange: onlyCurrent(learn) })); } catch {}
    try { activeSession.getGroupService().addKernelGroupListener(listener({ onGroupListUpdate: onlyCurrent((...values) => callbacks.emit('group-list', ...values)) })); } catch {}
    clearInterval(transportMonitor);
    transportMonitor = setInterval(() => {
      if (!guard.current()) return;
      try { if (online && Number(activeSession.getMSFService().getMsfStatus()) !== 1) lost(); }
      catch { if (online) lost(); }
    }, 1000);
    guard.assert(); authenticationRequired = false; online = true;
    status('online', { nickname: self.nick || '', authenticated: true, reason: '' });
  })().catch(error => {
    if (guard.current()) { online = false; status('session_failed', { code: error instanceof BotError ? error.code : 1500,
      reason: error instanceof BotError ? error.message : 'QQ session initialization failed' }); }
    throw error;
  }).finally(() => { if (starting === operation) starting = null; });
  starting = operation; return operation;
}
const loginListener = listener({
  onLoginConnected: () => event('transport', { connected: true }),
  onLoginDisConnected: () => { if (online) lost(); },
  onQRCodeGetPicture: data => {
    if (stopping || state === 'kicked') return;
    const base64 = data?.pngBase64QrcodeData?.replace(/^data:image\/png;base64,/, '');
    const bytes = typeof base64 === 'string' ? Buffer.from(base64, 'base64') : Buffer.alloc(0);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) { status('qr_failed'); return; }
    const expires = Number(data.expireTime);
    qr = { handle: randomUUID(), qrcode: `data:image/png;base64,${base64}`, mime: 'image/png',
      expires_at: Number.isFinite(expires) && expires > 1000000000 ? expires * (expires < 100000000000 ? 1000 : 1) :
        Number.isFinite(expires) && expires > 0 && expires < 86400 ? Date.now() + expires * 1000 : null };
    status('waiting_scan', { qr_received: true }); callbacks.emit('qrcode', qr); login.startPolling();
  },
  onQRCodeSessionUserScaned: () => status('waiting_confirm'),
  onQRCodeLoginSucceed: info => { initializeSession(info).catch(() => {}); },
  onQRCodeSessionFailed: (type, code) => { status('qr_failed', { login_error_code: Number.isFinite(Number(code)) ? Number(code) : null }); callbacks.emit('qr-failed'); },
  onQRCodeSessionQuickLoginFailed: code => status('login_failed', { login_error_code: Number.isFinite(Number(code)) ? Number(code) : null }),
  onLoginFailed: code => status('login_failed', { login_error_code: Number.isFinite(Number(code)) ? Number(code) : null }),
  onQRCodeLoginPollingStarted: () => {},
  onLoginState: (...values) => {
    const info = values.map(value => value?.selfInfo || value).find(value => value?.uin && value?.uid);
    if (info) initializeSession(info).catch(() => {});
  }
});
async function restore(signal) {
  if (online) return { state, account: Number(self.uin) };
  if (restoring) return restoring;
  const guard = sessionOperation(signal);
  const operation = (async () => {
    guard.assert();
    if (self && session && !authenticationRequired && callbacks.confirmedSessionId === session.getSessionId()) {
      const service = await waitForMessageService({ session, makeListener: listener, onMediaUpload, onMediaDownload:value=>imageReceiver.complete(value),
        onMessages: (...args) => { if (guard.current()) onMessages(...args); },
        onKickedOffline: () => { if (guard.current()) lost('kicked'); }, signal: guard.signal,
        timeout: config.rpcTimeout - 500, bind: callbacks.messageSessionId !== session.getSessionId() });
      guard.assert(); msgService = service;
      callbacks.messageSessionId = session.getSessionId();
      online = true; status('online', { authenticated: true, reason: '' });
      return { state, account: Number(self.uin) };
    }
    if (authenticationRequired && startup) {
      await abortable(() => startup.stop(), guard.signal); guard.assert(); session = null; msgService = null;
      callbacks.confirmedSessionId = null; callbacks.messageSessionId = null;
    }
    status('restoring');
    const account = await quickLoginAccount(login, Number(self?.uin) || config.account, guard.signal);
    guard.assert();
    if (!account) { status('login_required', { reconnect: false }); return { state }; }
    // quickLogin's acceptance is not session readiness. Only SDK callbacks can
    // initialize the session and publish online=true.
    await new Promise((resolve, reject) => {
      const cleanup = () => { callbacks.off('state', changed); guard.signal.removeEventListener('abort', abort); };
      const changed = () => {
        if (online) { cleanup(); resolve(); }
        else if (['login_failed', 'session_failed'].includes(state)) { cleanup(); reject(new BotError('QQ saved session requires fresh QR authentication', 1401)); }
      };
      const abort = () => { cleanup(); reject(new BotError('QQ session recovery timed out', 1502, { retryable: true })); };
      callbacks.on('state', changed); guard.signal.addEventListener('abort', abort, { once: true });
      if (guard.signal.aborted) abort(); else changed();
    });
    guard.assert();
    return { state, account };
  })().catch(error => {
    if (!guard.current()) throw error;
    online = false;
    const retryable = error.retryable === true || error.code === 1502;
    status(retryable ? 'connection_lost' : 'login_required', { reconnect: retryable });
    throw error;
  }).finally(() => { if (restoring === operation) restoring = null; });
  restoring = operation; return operation;
}
async function invoke(command, params, signal) {
  switch (command) {
    case 'auth.restore': return restore(signal);
    case 'auth.start': {
      if (restoring) await restoring.catch(() => {});
      if (!online && self && session && state !== 'kicked' && state !== 'login_required') return restore(signal);
      if (online) return { state, account: Number(self.uin) };
      if (qr && ['waiting_scan', 'waiting_confirm'].includes(state) && (!qr.expires_at || qr.expires_at > Date.now())) return { ...qr, state };
      if (requestingQR) throw new BotError('A QQ QR request is already in progress', 1503);
      authenticationRequired = true; invalidateSession();
      if (session && startup) {
        await startup.stop(); session = null; msgService = null;
        callbacks.confirmedSessionId = null; callbacks.messageSessionId = null;
      }
      requestingQR = true;
      try {
        qr = null; status('requesting_qr');
        const response = new Promise((resolve, reject) => {
          const cleanup = () => { callbacks.off('qrcode', success); callbacks.off('qr-failed', failed); signal.removeEventListener('abort', abort); };
          const success = value => { cleanup(); resolve(value); };
          const failed = () => { cleanup(); reject(new BotError('Official QQ kernel rejected the QR request', 1500)); };
          const abort = () => { cleanup(); reject(new BotError('QQ QR request cancelled', 1502)); };
          callbacks.once('qrcode', success); callbacks.once('qr-failed', failed); signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
          else { try { login.getQRCodePicture(); } catch { failed(); } }
        });
        return { ...await response, state };
      } finally { requestingQR = false; }
    }
    case 'auth.poll':
      if (!qr || params.handle !== qr.handle) throw new BotError('Unknown QR login handle', 1400);
      return { state, account: Number(self?.uin) || 0, expires_at: qr.expires_at };
    case 'account.get': return { user_id: Number(self.uin), nickname: self.nick || '' };
    case 'friend.list': return fetchKernelFriends(session, callbacks, signal, learn, config.buddyListArity);
    case 'group.list': return fetchKernelGroups(session, callbacks, signal);
    case 'message.fetch': {
      const result=await abortable(()=>msgService.getMsgsByMsgId({chatType:params.chatType,peerUid:params.peerUid,guildId:''},[params.msgId]),signal);
      const raw=rows(result).find(value=>String(value.msgId)===params.msgId&&(!value.peerUid||String(value.peerUid)===params.peerUid));
      if(!raw)throw new BotError('QQ retained message is unavailable',1404);
      return {raw:await imageReceiver.prepare({chatType:params.chatType,peerUid:params.peerUid,...raw,selfUid:self?.uid},msgService,signal)};
    }
    case 'message.send': {
      return sendKernelMessage({ session, msgService, self, contacts, learn, tracker, imageCache,
        mediaTimeout:(config.media?.timeout||90000)-1000 }, params, signal);
    }
    default: throw new BotError('Official kernel command not implemented', 1404);
  }
}
async function shutdown() {
  if (stopping) return stopping;
  stopping = (async () => {
    lifetime.abort();
    clearInterval(transportMonitor);
    try { await shutdownKernel({ tracker, requests, startup, login, engine }); process.exit(0); }
    catch { process.exit(1); }
  })();
  return stopping;
}
process.on('message', async packet => {
  if (packet?.event === 'shutdown') { await shutdown(); return; }
  if (stopping) return;
  if (packet?.cancel) { requests.get(packet.cancel)?.abort(); return; }
  if (!packet || !Number.isSafeInteger(packet.id) || typeof packet.command !== 'string') return;
  const controller = new AbortController(); requests.set(packet.id, controller);
  const budget=packet.command==='message.fetch'||packet.command==='message.send'&&hasImages(packet.params?.message)?config.media?.timeout||90000:config.rpcTimeout;
  const timer = setTimeout(() => controller.abort(), budget - 250);
  try {
    if (!packet.command.startsWith('auth.') && !online) throw new BotError('Official QQ kernel is offline', 1501);
    send({ id: packet.id, result: await invoke(packet.command, packet.params || {}, controller.signal) });
  } catch (error) { send({ id: packet.id, error: { code: error instanceof BotError ? error.code : 1500,
    message: error instanceof BotError ? error.message : 'Official QQ kernel operation failed', uncertain: Boolean(error.uncertain), retryable: Boolean(error.retryable) } }); }
  finally { clearTimeout(timer); requests.delete(packet.id); }
});
process.once('disconnect', shutdown);
process.once('SIGTERM', shutdown);
const logFailure = error => process.stderr.write(`${error?.stack || 'QQ kernel runtime failure'}\n`);
process.on('uncaughtException', error => { logFailure(error); event('fault', { code: 1500 }); process.exit(1); });
process.on('unhandledRejection', error => { logFailure(error); event('fault', { code: 1500 }); });
try {
  mkdirSync(config.dataDir, { recursive: true }); mkdirSync(join(config.dataDir, 'downloads'), { recursive: true });
  let device;
  if (existsSync(devicePath)) device = JSON.parse(readFileSync(devicePath, 'utf8'));
  else { device = { machineId: randomUUID() }; writeFileSync(devicePath, JSON.stringify(device), { flag: 'wx', mode: 0o600 }); }
  if (/^[a-f0-9]{32}$/.test(device.machineId)) { device.machineId = device.machineId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); writeFileSync(devicePath, JSON.stringify(device), { mode: 0o600 }); }
  if (!/^[a-f0-9-]{36}$/.test(device.machineId)) throw new Error('Invalid device identity');
  config.machineId = device.machineId;
  deviceInfo = { guid: config.machineId, buildVer: config.version, localId: 2052, devName: hostname(), devType: 'Windows_NT',
    vendorName: '', osVer: release(), vendorOsName: 'win32', setMute: false, vendorType: 0 };
  const bridge = { exports: {} }; process.dlopen(bridge, join(config.kernelDir, 'QQNT.dll'));
  wrapper = createRequire(import.meta.url)(join(config.kernelDir, 'wrapper.node'));
  engine = wrapper.NodeIQQNTWrapperEngine.get();
  if (engine.initWithDeskTopConfig(profile, listener()) !== true) throw new Error('QQ engine initialization failed');
  login = wrapper.NodeIKernelLoginService.get(); login.addKernelLoginListener(loginListener);
  login.initConfig(loginOptions({ appid: config.appid, version: config.version, directory: config.dataDir,
    machineId: config.machineId, platformVersion: release(), hostName: hostname() }));
  login.connect(); status('idle'); event('ready', { version: config.version, loaded: true });
  const recovery = new AbortController();
  const timer = setTimeout(() => recovery.abort(), config.rpcTimeout);
  restore(AbortSignal.any([recovery.signal, lifetime.signal])).catch(() => {}).finally(() => clearTimeout(timer));
} catch (error) { logFailure(error); event('fatal', { code: 1501, message: 'Official QQ kernel initialization failed' }); process.exit(1); }
