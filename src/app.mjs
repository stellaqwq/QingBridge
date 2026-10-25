import { join } from 'node:path';
import { lockData } from './data-lock.mjs';
import { Store } from './store.mjs';
import { SessionVault } from './qq/session-vault.mjs';
import { loadDriver } from './qq/driver.mjs';
import { QQAdapter } from './qq/adapter.mjs';
import { AIClient } from './ai.mjs';
import { ReplyWorker } from './worker.mjs';
import { OneBotServer } from './onebot.mjs';
import { createLogger } from './logger.mjs';
import { MessageIdMap } from './qq/message-ids.mjs';
import { Settings } from './settings.mjs';
import { Telemetry } from './telemetry.mjs';

export async function createApp(config, overrides = {}) {
  const telemetry = overrides.telemetry || new Telemetry();
  const sink = overrides.log || createLogger();
  const sanitize = createLogger(line => {
    const { time, level, event, ...fields } = JSON.parse(line);
    telemetry.add('log', { level, event, fields });
  });
  const log = (level, event, fields) => { sanitize(level, event, fields); sink(level, event, fields); };
  const settings = new Settings(config, { path:overrides.settingsPath, lockedKeys:overrides.lockedKeys });
  const unlock = lockData(config.dataDir);
  let store, adapter, worker, server;
  try {
    store = new Store(join(config.dataDir, 'bot.sqlite'),{retainIgnoredContent:config.retainIgnoredContent,
      onRedaction:fields=>log('info','ignored_job_content_redacted',fields)});
    const vault = new SessionVault(join(config.dataDir, 'sessions'), config.sessionKey);
    const ids = new MessageIdMap(store.db);
    const driver = overrides.driver || await loadDriver(config, vault, log, ids);
    adapter = new QQAdapter(driver, config);
    adapter.on('event', event => telemetry.message(event));
    adapter.on('outgoing', event => telemetry.message(event));
    adapter.on('state', () => log('info', 'qq_connection_changed', { state:adapter.status().online ? 'online' : 'offline' }));
    adapter.on('fault', error => log('warn', 'qq_driver_fault', { code: error.code ?? 1500 }));
    const ai = overrides.ai || new AIClient(config.ai);
    worker = new ReplyWorker({ adapter, store, ai, config, log });
    server = new OneBotServer({ adapter, worker, store, config, log, telemetry, settings });
    // QR login may still be pending, but a broken driver must fail startup.
    await adapter.start();
    await server.start();
    store.cleanup(config.retentionDays, config.uncertainRetentionDays, config.jobMaxAge);
    worker.start();
    log('info', 'service_started', { port:server.server.address().port, driver:config.driver });
    const cleanup = setInterval(() => {
      try { store.cleanup(config.retentionDays, config.uncertainRetentionDays, config.jobMaxAge); } catch { log('error', 'retention_cleanup_failed'); }
    }, 3600000);
    let closing;
    return { config, adapter, store, worker, server, telemetry, settings, address: server.server.address(),
      close() {
        if (!closing) closing = (async () => {
          clearInterval(cleanup);
          try {
            await server.close();
            await worker.close();
            await adapter.close();
          } finally { store.close(); unlock(); }
        })();
        return closing;
      }
    };
  } catch (error) {
    await server?.close().catch(() => {});
    await worker?.close().catch(() => {});
    await adapter?.close().catch(() => {});
    store?.close(); unlock(); throw error;
  }
}
