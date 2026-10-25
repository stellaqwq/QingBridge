export function formatJobDetail(job) {
  const event=job.event||{},reason={
    ai_disabled:'AI 自动回复未启用',user_not_allowed:'好友不在回复白名单中',group_not_allowed:'群聊不在回复白名单中',
    group_requires_at:'群消息未 @ 机器人',self_message:'机器人自身消息不触发 AI',no_text:'消息不含可处理的文本',
    filtered:'未匹配回复规则（旧记录未保存具体筛选原因）',invalid_ai_input:'消息无法作为 AI 输入',
    policy_changed:'回复策略已改变',queue_full:'任务队列已满',expired:'等待任务已过期'
  }[job.reason]||job.reason||'无';
  let received;
  if(event.content_state==='redacted')received='正文已脱敏清除，无法恢复';
  else if(event.content_state==='not_stored')received='正文未记录，仅保留防重信息';
  else if(event.content_retained===false)received='正文未保留（旧记录未区分未记录与已脱敏）';
  else {
    const segments=event.message;
    const text=job.input||(Array.isArray(segments)?segments.filter(s=>s.type==='text').map(s=>s.data?.text||'').join(''):
      typeof segments==='string'?segments:event.raw_message||'');
    received=typeof text==='string'&&text.trim()?text:
      job.reason==='no_text'||Array.isArray(segments)?'原消息没有文本'+(Array.isArray(segments)&&segments.some(s=>s.type!=='text')?'，仅含图片等非文本内容':''):
      '未找到消息正文（记录未提供内容状态）';
  }
  const reply=job.reply||(event.content_retained===false?'未保留（正文保留策略）':job.status==='ignored'?'未生成（任务已忽略）':'尚未生成');
  return '会话：'+job.conversation+'\n处理原因：'+reason+'\n收到：'+received+'\n回复：'+reply;
}
