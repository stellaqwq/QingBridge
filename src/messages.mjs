import { BotError } from './errors.mjs';

export function id(value, name, { signed = false } = {}) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw new BotError(`Invalid ${name}`, 1400);
  if (!/^-?\d+$/.test(String(value))) throw new BotError(`Invalid ${name}`, 1400);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || (!signed && result <= 0) ||
      (signed && (result < -2147483648 || result > 2147483647))) throw new BotError(`Invalid ${name}`, 1400);
  return result;
}
export function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  throw new BotError('Invalid boolean parameter', 1400);
}
function decode(text, param = false) {
  let result = text.replaceAll('&#91;', '[').replaceAll('&#93;', ']');
  if (param) result = result.replaceAll('&#44;', ',');
  return result.replaceAll('&amp;', '&');
}
function escape(text, param = false) {
  let result = String(text).replaceAll('&', '&amp;').replaceAll('[', '&#91;').replaceAll(']', '&#93;');
  if (param) result = result.replaceAll(',', '&#44;');
  return result;
}
export function parseMessage(message, autoEscape = false) {
  if (typeof message === 'string') {
    if (autoEscape) return parseMessage([{ type: 'text', data: { text: message } }]);
    const parts = [];
    let position = 0;
    for (const match of message.matchAll(/\[CQ:([a-zA-Z0-9_]+)((?:,[^\[\]]*)?)\]/g)) {
      if (match.index > position) parts.push({ type: 'text', data: { text: decode(message.slice(position, match.index)) } });
      const data = Object.create(null);
      for (const item of match[2].slice(1).split(',').filter(Boolean)) {
        const equals = item.indexOf('=');
        if (equals < 1) throw new BotError('Invalid CQ code', 1400);
        data[item.slice(0, equals)] = decode(item.slice(equals + 1), true);
      }
      parts.push({ type: match[1], data });
      position = match.index + match[0].length;
    }
    if (position < message.length) parts.push({ type: 'text', data: { text: decode(message.slice(position)) } });
    return parseMessage(parts);
  }
  if (!Array.isArray(message) || !message.length || message.length > 1000) throw new BotError('Invalid message', 1400);
  const result = message.map(segment => {
    if (!segment || typeof segment.type !== 'string' || !/^[a-zA-Z0-9_]+$/.test(segment.type) ||
      !segment.data || typeof segment.data !== 'object' || Array.isArray(segment.data)) throw new BotError('Invalid message segment', 1400);
    if (segment.type === 'text' && typeof segment.data.text !== 'string') throw new BotError('Invalid text segment', 1400);
    return structuredClone(segment);
  });
  if (!result.some(s => s.type !== 'text' || s.data.text.length)) throw new BotError('Empty message', 1400);
  return result;
}
export function toCQ(message) {
  return message.map(segment => segment.type === 'text' ? escape(segment.data.text) :
    `[CQ:${segment.type}${Object.entries(segment.data).map(([k, v]) => `,${k}=${escape(v, true)}`).join('')}]`).join('');
}
export function aiDecision(event, config) {
  if(!config.enabled)return {input:null,reason:'ai_disabled'};
  if(event.post_type!=='message'||event.user_id===event.self_id)return {input:null,reason:'self_message'};
  if(event.message_type==='private'&&!config.allowedUsers.has(String(event.user_id)))return {input:null,reason:'user_not_allowed'};
  if(event.message_type==='group'&&!config.allowedGroups.has(String(event.group_id)))return {input:null,reason:'group_not_allowed'};
  const message = parseMessage(event.message);
  if (event.message_type === 'group' && config.requireAt &&
      !message.some(s => s.type === 'at' && String(s.data.qq) === String(event.self_id))) return {input:null,reason:'group_requires_at'};
  const text = message.filter(s => s.type === 'text').map(s => s.data.text).join('').trim();
  if (!text)return {input:null,reason:'no_text'};
  if (text.length > config.maxInputChars) throw new BotError('AI input length exceeded', 1400);
  // The speaker label is context, not an instruction or a trusted system role.
  return {input:event.message_type==='group'?`[QQ ${event.user_id}] ${text}`:text,reason:null};
}
export function aiInput(event,config){return aiDecision(event,config).input;}
export function conversation(event) {
  return `${event.self_id}:${event.message_type}:${event.message_type === 'group' ? event.group_id : event.user_id}`;
}
export function eventKey(event) { return `${conversation(event)}:${event.message_id}`; }
