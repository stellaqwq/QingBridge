import { resolve } from 'node:path';
const environments = new WeakMap();
export const environmentOf = config => environments.get(config);
export const encodedPrefix = 'qqai-base64:v1:';
export function decodeEnvironment(source) {
  const env = { ...source };
  for (const [key,value] of Object.entries(env)) {
    if (typeof value!=='string' || !value.startsWith(encodedPrefix)) continue;
    const encoded=value.slice(encodedPrefix.length), bytes=Buffer.from(encoded,'base64');
    if (bytes.toString('base64')!==encoded) throw new Error('Invalid encoded configuration: '+key);
    env[key]=bytes.toString('utf8');
  }
  return env;
}

function number(env, key, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
  return n;
}
function bool(env, key, fallback = false) {
  if (env[key] === undefined || env[key] === '') return fallback;
  if (!['true', 'false'].includes(env[key])) throw new Error(`${key} must be true or false`);
  return env[key] === 'true';
}
function ids(value = '') {
  const values = value.split(',').map(s => s.trim()).filter(Boolean);
  if (values.some(s => !/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s)))) {
    throw new Error('Allowlist entries must be positive safe integer QQ IDs');
  }
  return new Set(values.map(String));
}
function url(value, schemes) {
  const parsed = new URL(value);
  if (!schemes.includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Invalid endpoint URL (credentials in URLs are not allowed)');
  }
  return parsed.toString();
}
export function loadConfig(env = process.env) {
  env = decodeEnvironment(env);
  const token = env.ONEBOT_ACCESS_TOKEN ?? '';
  if (token.length < 24) throw new Error('ONEBOT_ACCESS_TOKEN must contain at least 24 characters; run npm run init');
  const adminToken = env.ADMIN_ACCESS_TOKEN ?? '';
  if (adminToken.length < 24) throw new Error('ADMIN_ACCESS_TOKEN must contain at least 24 characters; run npm run init');
  if (adminToken === token) throw new Error('ADMIN_ACCESS_TOKEN must differ from ONEBOT_ACCESS_TOKEN; run npm run init');
  const reverseToken = env.REVERSE_WS_TOKEN || token;
  if (adminToken === reverseToken) throw new Error('ADMIN_ACCESS_TOKEN must differ from REVERSE_WS_TOKEN; run npm run init');
  const sessionKey = env.SESSION_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(sessionKey)) throw new Error('SESSION_KEY must be a random 32-byte hex key; run npm run init');
  const enabled = bool(env, 'AI_ENABLED');
  const allowedUsers = ids(env.AI_ALLOWED_USERS);
  const allowedGroups = ids(env.AI_ALLOWED_GROUPS);
  if (enabled && !allowedUsers.size && !allowedGroups.size) throw new Error('AI requires an explicit user/group allowlist');
  if (enabled && !env.AI_MODEL?.trim()) throw new Error('AI_MODEL is required when AI_ENABLED=true');
  const driver = env.QQ_DRIVER || 'kernel';
  let mediaBaseUrl='';
  if(env.MEDIA_BASE_URL){
    const parsed=new URL(url(env.MEDIA_BASE_URL,['http:','https:']));
    if(parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('MEDIA_BASE_URL must be an HTTP(S) origin without a path, query or fragment');
    mediaBaseUrl=parsed.origin;
  }
  const config = {
    host: env.HOST || '127.0.0.1', port: number(env, 'PORT', 5700, 0, 65535), token, adminToken, sessionKey,
    dataDir: resolve(env.DATA_DIR || './data'), driver,
    account: number(env, 'QQ_ACCOUNT', 0), rpcTimeout: number(env, 'QQ_RPC_TIMEOUT_MS', 15000, 10),
    maxRequestBytes:number(env,'ONEBOT_MAX_REQUEST_BYTES',16*1024*1024,1024*1024,128*1024*1024),
    media:{baseUrl:mediaBaseUrl,maxBytes:number(env,'MEDIA_MAX_BYTES',10*1024*1024,1024,50*1024*1024),
      timeout:number(env,'MEDIA_TIMEOUT_MS',90000,1000,300000),retentionDays:number(env,'MEDIA_CACHE_DAYS',7,1,365)},
    kernel: { runtime: resolve(env.QQ_RUNTIME_DIR || './runtime/qq'), directory: resolve(env.QQ_KERNEL_DIR || './runtime/kernel'),
      data: resolve(env.QQ_KERNEL_DATA || `${env.DATA_DIR || './data'}/qq-kernel`),
      shutdownTimeout: number(env, 'QQ_SHUTDOWN_TIMEOUT_MS', 5000, 100, 20000) },
    native: {
      host: env.QQ_SERVER_HOST || 'msfwifi.3g.qq.com', port: number(env, 'QQ_SERVER_PORT', 8080, 1, 65535),
      profilePath: env.QQ_PROFILE ? resolve(env.QQ_PROFILE) : '',
      signUrl: env.QQ_SIGN_URL ? url(env.QQ_SIGN_URL, ['http:', 'https:']) : '', signToken: env.QQ_SIGN_TOKEN || ''
    },
    heartbeatMs: number(env, 'HEARTBEAT_MS', 30000, 100),
    reverseUrls: (env.REVERSE_WS_URLS || '').split(',').filter(Boolean).map(s => url(s.trim(), ['ws:', 'wss:'])),
    reverseToken,
    webhookUrl: env.WEBHOOK_URL ? url(env.WEBHOOK_URL, ['http:', 'https:']) : '',
    webhookSecret: env.WEBHOOK_SECRET || '',
    sendInterval: number(env, 'SEND_INTERVAL_MS', 1500),
    sessionInterval: number(env, 'SESSION_INTERVAL_MS', 3000),
    sendConcurrency: number(env, 'SEND_CONCURRENCY', 4, 1, 16),
    maxPendingSends: number(env, 'MAX_PENDING_SENDS', 1000, 1, 10000),
    sendMaxAttempts: number(env, 'SEND_MAX_ATTEMPTS', 5, 1, 16),
    jobMaxAge: number(env, 'JOB_MAX_AGE_MS', 600000, 1000),
    maxPending: number(env, 'MAX_PENDING_JOBS', 1000, 1),
    retentionDays: number(env, 'HISTORY_RETENTION_DAYS', 7, 1),
    retainIgnoredContent:bool(env, 'RETAIN_IGNORED_JOB_CONTENT', false),
    uncertainRetentionDays: number(env, 'UNCERTAIN_RETENTION_DAYS', 30, 1, 3650),
    ai: {
      enabled, baseUrl: url(env.AI_BASE_URL || 'http://127.0.0.1:11434/v1', ['http:', 'https:']),
      apiKey: env.AI_API_KEY || '', model: env.AI_MODEL || '', allowedUsers, allowedGroups,
      requireAt: bool(env, 'AI_GROUP_REQUIRE_AT', true),
      systemPrompt: env.AI_SYSTEM_PROMPT || '你是用户的 QQ AI 助手。简洁、诚实地回答，不要声称自己是人类。',
      timeout: number(env, 'AI_TIMEOUT_MS', 45000, 10), maxAttempts: number(env, 'AI_MAX_ATTEMPTS', 3, 1, 10),
      concurrency: number(env, 'AI_CONCURRENCY', 4, 1, 16),
      contextTurns: number(env, 'AI_CONTEXT_TURNS', 10, 0, 100),
      maxInputChars: number(env, 'AI_MAX_INPUT_CHARS', 8000, 1),
      maxReplyChars: number(env, 'AI_MAX_REPLY_CHARS', 1800, 1)
    }
  };
  environments.set(config, { ...env });
  return config;
}
