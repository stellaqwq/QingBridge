import { aiInput, aiDecision } from './messages.mjs';

export class ReplyWorker {
  constructor({ adapter, store, ai, config, log }) {
    Object.assign(this, { adapter, store, ai, config, log });
    this.controller = new AbortController(); this.running = null;
    this.revision = 0; this.waiters = new Set(); this.onChange = () => this.wake();
  }
  ingest(event) {
    if (event.post_type !== 'message') return true;
    this.store.expirePending(this.config.jobMaxAge);
    let input = null;
    let reason = null;
    try { ({input,reason}=aiDecision(event,this.config.ai)); }
    catch { reason = 'invalid_ai_input'; }
    const result = this.store.ingest(event, input, this.config.maxPending, reason);
    if (result.inserted && result.status === 'queued') this.log('info', 'ai_job_queued', { job: result.id });
    if (result.inserted && input && result.status === 'ignored') this.log('warn', 'ai_queue_full');
    return result.inserted;
  }
  start() {
    if (this.running || this.controller.signal.aborted) return;
    this.store.on('change', this.onChange);
    this.adapter.on?.('state', this.onChange);
    this.store.recover();
    // Each step claims its job synchronously before awaiting I/O. Store.next()
    // blocks later jobs in that conversation until generation and send finish.
    this.running = Promise.all(Array.from({ length: this.config.ai.concurrency }, () => this.loop()));
  }
  async loop() {
    while (!this.controller.signal.aborted) {
      const revision = this.revision;
      let failed = false;
      try { if (await this.step()) continue; }
      catch { failed = true; this.log('error', 'worker_iteration_failed'); }
      if (this.controller.signal.aborted) break;
      // Register against a revision to avoid losing a change between the
      // asynchronous step and going to sleep. Only retries need a timer.
      let milliseconds;
      try {
        if (failed) milliseconds = 1000;
        else {
          let time=this.store.nextExpiryTime(this.config.jobMaxAge);
          if(this.config.ai.enabled&&this.adapter.status().online){
            const retry=this.store.nextTime();
            if(retry!==null)time=time===null?retry:Math.min(time,retry);
          } else if(this.config.ai.enabled&&!this.adapter.on)milliseconds=5000;
          if(time!==null)milliseconds=Math.min(milliseconds??Infinity,Math.max(1,time-Date.now()));
        }
      } catch { milliseconds = 1000; }
      await this.wait(revision, milliseconds);
    }
  }
  wake() { this.revision++; for (const resume of [...this.waiters]) resume(); }
  wait(revision, milliseconds) {
    if (this.controller.signal.aborted || revision !== this.revision) return Promise.resolve();
    return new Promise(resolve => {
      let timer;
      const resume = () => { clearTimeout(timer); this.waiters.delete(resume); resolve(); };
      this.waiters.add(resume);
      if (milliseconds !== undefined) timer = setTimeout(resume, Math.min(milliseconds, 2147483647));
    });
  }
  async step() {
    // Waiting jobs still age while AI is disabled or QQ is offline. Active
    // generation/sending and unknown delivery must never be reclassified here.
    if(this.store.expirePending(this.config.jobMaxAge))return true;
    if (!this.config.ai.enabled) return;
    if (!this.adapter.status().online) return;
    const job = this.store.next();
    if (!job) return;
    const currentEvent = JSON.parse(job.event);
    try {
      if (!aiInput(currentEvent, this.config.ai)) {
        this.store.update(job.id, 'ignored', { reason: 'policy_changed' }); return true;
      }
    } catch { this.store.update(job.id, 'ignored', { reason: 'policy_changed' }); return true; }
    if (job.status === 'queued') {
      if (job.attempts >= this.config.ai.maxAttempts) {
        this.store.update(job.id, 'failed', { reason: 'generation_attempts_exhausted' }); return true;
      }
      const attempt = job.attempts + 1;
      this.store.update(job.id, 'generating', { attempts: attempt });
      try {
        const history = this.store.history(job.conversation, this.config.ai.contextTurns);
        const reply = await this.ai.reply(job.input, history, this.controller.signal);
        this.store.update(job.id, 'ready', { reply });
      } catch (error) {
        const retry = !this.controller.signal.aborted && error.retryable && attempt < this.config.ai.maxAttempts;
        this.store.update(job.id, retry || this.controller.signal.aborted ? 'queued' : 'failed', {
          nextAt: Date.now() + Math.min(30000, 1000 * 2 ** (attempt - 1)), reason: 'ai_generation_failed' });
        this.log('warn', 'ai_generation_failed', { job: job.id, attempt });
      }
      return true;
    }
    const event = JSON.parse(job.event);
    const params = { message: [{ type: 'text', data: { text: job.reply } }],
      ...(event.message_type === 'group' ? { group_id: event.group_id } : { user_id: event.user_id }) };
    const sendAttempt = job.send_attempts + 1;
    if (sendAttempt > this.config.sendMaxAttempts) {
      this.store.update(job.id, 'failed', { reason: 'send_attempts_exhausted' }); return true;
    }
    this.store.update(job.id, 'sending', { sendAttempts: sendAttempt });
    try {
      await this.adapter.action(event.message_type === 'group' ? 'send_group_msg' : 'send_private_msg', params,
        { signal: this.controller.signal });
      this.store.finish(job, this.config.ai.contextTurns);
      this.log('info', 'ai_reply_sent', { job: job.id });
    } catch (error) {
      // A shutdown can cancel a send still waiting in the limiter. It must
      // explicitly confirm non-submission; cancellation after submission and
      // untyped failures remain ambiguous and must never be resent blindly.
      const cancelledBeforeSubmission = this.controller.signal.aborted && error.code === 1502 && error.uncertain === false;
      const exhausted = sendAttempt >= this.config.sendMaxAttempts;
      const retry = cancelledBeforeSubmission || error.retryable && !error.uncertain && !this.controller.signal.aborted && !exhausted;
      const uncertain = error.uncertain || (!error.code && !retry);
      const state = retry ? 'ready' : uncertain ? 'uncertain' : 'failed';
      this.store.update(job.id, state, {
        sendAttempts: cancelledBeforeSubmission ? job.send_attempts : sendAttempt,
        nextAt: retry && !cancelledBeforeSubmission ? Date.now() + Math.min(30000, 1000 * 2 ** (sendAttempt - 1)) : 0,
        reason: cancelledBeforeSubmission ? 'send_cancelled_before_submission' : uncertain ? 'delivery_unknown' :
          exhausted && error.retryable ? 'send_attempts_exhausted' : 'send_failed' });
      this.log(uncertain ? 'error' : 'warn', 'ai_reply_send_failed', { job: job.id, state, attempt: sendAttempt });
    }
    return true;
  }
  async close() {
    this.controller.abort(); this.wake();
    this.store.off('change', this.onChange); this.adapter.off?.('state', this.onChange);
    await this.running;
  }
}
