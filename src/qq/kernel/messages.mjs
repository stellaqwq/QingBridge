import { BotError } from '../../errors.mjs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const messageKey = raw => JSON.stringify(['qq-kernel', Number(raw.chatType), String(raw.peerUid), String(raw.msgId)]);

export function kernelText(message) {
  if (!Array.isArray(message) || !message.length || message.some(s => s.type !== 'text' || typeof s.data?.text !== 'string')) {
    throw new BotError('Official kernel adapter currently sends text segments only', 1404);
  }
  const content = message.map(s => s.data.text).join('');
  if (!content || content.length > 10000) throw new BotError('Invalid QQ text length', 1400);
  return [{ elementType: 1, elementId: '', textElement: { content, atType: 0, atUid: '', atNtUid: '', atTinyId: '', atNtUin: '' } }];
}

export function normalizeMessage(raw, account, resolveUid = () => 0, resolveImage) {
  const kind = Number(raw.chatType) === 1 ? 'private' : Number(raw.chatType) === 2 ? 'group' : null;
  const sender = Number(raw.senderUin) || resolveUid(raw.senderUid);
  if (!kind || !String(raw.msgId || '') || !raw.peerUid || !Number.isSafeInteger(sender) || sender <= 0) {
    throw new BotError('QQ message identity could not be resolved', 1500);
  }
  const message = [];
  for (const element of raw.elements || []) {
    const text = element.textElement;
    if (Number(element.elementType) === 1 && text) {
      const at = Number(text.atType) === 1 ? 'all' : Number(text.atNtUin) ||
        (text.atNtUid && text.atNtUid === raw.selfUid ? account : resolveUid(text.atNtUid));
      if (Number(text.atType) > 0 && at) message.push({ type: 'at', data: { qq: String(at) } });
      else if (text.content) message.push({ type: 'text', data: { text: String(text.content) } });
    } else if(Number(element.elementType)===2&&element.picElement) {
      const pic=element.picElement;
      if(pic.onebotImageError){message.push({type:'text',data:{text:'[图片下载失败，请稍后重发]'}});continue;}
      const url=typeof pic.originImageUrl==='string'&&/^https?:\/\//i.test(pic.originImageUrl)?pic.originImageUrl:'';
      const path=typeof pic.sourcePath==='string'&&isAbsolute(pic.sourcePath)?pic.sourcePath:'';
      const data={file:path?pathToFileURL(path).href:String(pic.fileName||pic.md5HexStr||'image'),
        sub_type:Number(pic.picSubType)||0,summary:String(pic.summary||''),file_size:String(pic.fileSize||'0')};
      if(url)data.url=url;
      if(pic.onebotImageFile&&resolveImage)Object.assign(data,resolveImage(pic.onebotImageFile));
      message.push({type:'image',data});
    } else message.push({ type: 'text', data: { text: `[QQ 消息段 ${Number(element.elementType)}]` } });
  }
  if (!message.length) throw new BotError('QQ message has no supported content', 1404);
  const time = Number(raw.msgTime);
  if (!Number.isSafeInteger(time) || time < 0) throw new BotError('Invalid QQ message timestamp', 1500);
  const groupId = kind === 'group' ? Number(raw.peerUid) : undefined;
  if (kind === 'group' && (!Number.isSafeInteger(groupId) || groupId <= 0)) throw new BotError('Invalid QQ group identity', 1500);
  return { nativeId: messageKey(raw), kind, sender: { user_id: sender, nickname: raw.sendNickName || raw.senderMemberName || '' },
    message, time, ...(kind === 'group' ? { groupId } : {}) };
}

// A local sendMsg(result=0) only means accepted. Success requires a matching
// kernel status update for the same conversation and native message ID.
export class SendTracker {
  constructor(timeout = 14000) { this.timeout = timeout; this.pending = new Map(); }
  wait(raw, signal, timeout = this.timeout) {
    signal?.throwIfAborted();
    const key = messageKey(raw);
    if (this.pending.has(key)) throw new BotError('Duplicate kernel send identity', 1500);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {});
    const finish = (error, value) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(key);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new BotError('QQ send confirmation unavailable', 1502, { uncertain: true }));
    const timer = setTimeout(abort, timeout);
    signal?.addEventListener('abort', abort, { once: true }); this.pending.set(key, finish);
    return { promise, reject: error => finish(error) };
  }
  update(raw) {
    const finish = this.pending.get(messageKey(raw));
    if (!finish) return;
    if (Number(raw.sendStatus) === 2) finish(null, raw);
    else if (raw.sendStatus !== undefined && Number(raw.sendStatus) === 0) finish(new BotError('QQ kernel reported send failure', 1500));
  }
  close() { for (const finish of [...this.pending.values()]) finish(new BotError('QQ kernel disconnected before send confirmation', 1502, { uncertain: true })); }
}
