import { BotError } from './errors.mjs';

export class AIClient {
  constructor(config) { this.config = config; }
  async reply(input, history, signal) {
    const config = this.config;
    let response;
    try {
      response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify({ model: config.model, stream: false,
          messages: [{ role: 'system', content: config.systemPrompt }, ...history, { role: 'user', content: input }] }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeout)])
      });
    } catch (cause) { throw new BotError('AI network error', 1500, { retryable: true, cause }); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new BotError('AI provider rejected request', 1500, { retryable: response.status === 429 || response.status >= 500 });
    }
    let raw = '';
    try {
      for await (const chunk of response.body) {
        raw += Buffer.from(chunk).toString('binary');
        if (raw.length > 2 * 1024 * 1024) throw new BotError('AI response exceeded size limit', 1500);
      }
    } catch (cause) {
      if (cause instanceof BotError) throw cause;
      throw new BotError('AI response interrupted', 1500, { retryable: !signal?.aborted, cause });
    }
    let result;
    try { result = JSON.parse(Buffer.from(raw, 'binary').toString('utf8')); }
    catch { throw new BotError('Invalid AI response JSON', 1500); }
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new BotError('Empty AI reply', 1500);
    return Array.from(content.trim()).slice(0, config.maxReplyChars).join('');
  }
}
