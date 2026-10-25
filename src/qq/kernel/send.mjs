import { BotError, deadline } from '../../errors.mjs';
import { hasImages, prepareKernelElements } from './elements.mjs';
import { resolveContactUid } from './contacts.mjs';

export async function sendKernelMessage({ session, msgService, self, contacts, learn, tracker, imageCache, mediaTimeout }, params, signal) {
  const prepared = await prepareKernelElements(params.message,imageCache,signal,msgService);
  const elements=prepared.elements;
  const timeout=hasImages(params.message)?mediaTimeout||tracker.timeout:tracker.timeout;
  try {
  const contact = contacts.get(params.target);
  const peer = { chatType: params.kind === 'group' ? 2 : 1,
    peerUid: params.kind === 'group' ? String(params.target) : contact?.uid || params.peerUid, guildId: '' };
  if (!peer.peerUid) peer.peerUid = await resolveContactUid(session, params.target, signal, learn);
  signal?.throwIfAborted();
  const msgId = String(msgService.generateMsgUniqueId(peer.chatType, String(Date.now())));
  if (!msgId || msgId === 'undefined') throw new BotError('QQ kernel returned no native message ID', 1500);
  // Bound both SDK acceptance and terminal confirmation, including a native
  // Promise that ignores cancellation. A late result can never cause a resend.
  return await deadline(async operationSignal => {
    const pending = tracker.wait({ ...peer, msgId }, operationSignal, timeout);
    try {
      const result = await msgService.sendMsg(msgId, peer, elements, new Map());
      if (!result || !/^-?\d+$/.test(String(result.result))) throw new BotError('QQ submission result unavailable',1502,{uncertain:true});
      if (Number(result.result) !== 0) {
        const code = Number.isSafeInteger(Number(result?.result)) ? Number(result.result) : 'missing';
        // Keep the native reason in the local host log. SDK errors may include
        // paths or account identifiers, so never expose the raw object via API.
        const reason = String(result?.errMsg || result?.err_msg || '').replace(/[\r\n]/g, ' ').replace(/\d{5,}/g, '[number]').slice(0,300);
        console.error(JSON.stringify({ event: 'message_submission_rejected', code, reason }));
        throw new BotError(`QQ kernel rejected message submission (code ${code})`, 1500);
      }
      const ack = await pending.promise;
      return { raw: { senderUin: self.uin, senderUid: self.uid, msgTime: String(Math.floor(Date.now() / 1000)), elements, ...ack, ...peer, msgId } };
    } catch (error) {
      const failure = error instanceof BotError ? error : new BotError('QQ send result unavailable', 1502, { uncertain: true });
      pending.reject(failure); throw failure;
    }
  }, Math.max(1, timeout), { mutation: true, signal });
  } finally { prepared.release(); await imageCache?.cleanup().catch(()=>{}); }
}
export const sendKernelText=sendKernelMessage;
