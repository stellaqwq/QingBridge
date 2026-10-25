import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { launchWorkspace } from './launch.mjs';
import { config, incoming } from '../test/helpers.mjs';

const output=resolve('.impeccable/review'), temporaryRoot=resolve('dist/web-qa');
await mkdir(output,{recursive:true});await mkdir(temporaryRoot,{recursive:true});
await writeFile(join(output,'web-qa.json'),JSON.stringify({success:false,status:'running'}));
const profile=await mkdtemp(join(temporaryRoot,'chrome-')),data=await mkdtemp(join(temporaryRoot,'demo-'));
let workspace,browser,socket,commandId=0;const pending=new Map(),failures=[],checks=[],layoutMetrics=[],contrastMetrics=[];
function send(method,params={}){const id=++commandId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function wait(expression){for(let n=0;n<120;n++){if(await evaluate(expression))return;await delay(100);}throw Error('UI condition failed: '+expression);}
async function click(id){await evaluate('document.getElementById('+JSON.stringify(id)+').click()');}
async function value(id,value){await evaluate('(function(){const e=document.getElementById('+JSON.stringify(id)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}));})()');}
async function navigate(view){await evaluate('document.querySelector(\'[data-view="'+view+'"]\').click()');await wait('!document.getElementById("view-'+view+'").hidden');}
async function viewport(width,height=1000){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<681});await evaluate('window.scrollTo(0,0)');await delay(260);}
async function noOverflow(name){assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,name);checks.push(name);}
async function screenshot(name){await evaluate('window.scrollTo(0,0);document.getElementById("toast").hidden=true');await delay(260);const metrics=await send('Page.getLayoutMetrics'),size=metrics.cssContentSize;const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.width,height:size.height,scale:1}});await writeFile(join(output,name+'.png'),Buffer.from(shot.data,'base64'));}
try{
  workspace=await launchWorkspace(config(data,{AI_API_KEY:'web-qa-fixture-key'}));
  workspace.app.adapter.driver.inject(incoming(20261025,{message:'【演示消息】你好，助手已经连接了吗？',sender:{user_id:10001,nickname:'演示用户'}}));
  workspace.app.adapter.driver.inject(incoming(20261026,{kind:'group',groupId:20001,message:'【演示群聊】请帮忙整理一下今天的待办。',sender:{user_id:10002,nickname:'演示群成员'}}));
  await workspace.app.adapter.action('send_private_msg',{user_id:10001,message:'【演示回复】你好，连接正常。这是一条用于验收消息监听的模拟回复。'});
  workspace.app.telemetry.add('log',{level:'warn',event:'ai_reply_send_failed',fields:{job:2,state:'uncertain'}});
  const uncertain=workspace.app.store.list()[0];workspace.app.store.update(uncertain.id,'uncertain',{reply:'DEMO delivery review'});

  // Explicit synthetic fixtures cover each distinct task-content state.
  const fixtureEvent=id=>({self_id:10000,user_id:10001,message_id:id,post_type:'message',message_type:'private',message:[{type:'text',data:{text:'【演示原文】白名单外的内容'}}],raw_message:'【演示原文】白名单外的内容'});
  const fixtureStore=workspace.app.store;
  const redactedFixture=fixtureStore.ingest(fixtureEvent(98001),'【演示】已删除输入',100).id;
  fixtureStore.update(redactedFixture,'ignored',{reason:'policy_changed'});
  fixtureStore.retainIgnoredContent=true;
  const filteredFixture=fixtureStore.ingest(fixtureEvent(98002),null,100,'user_not_allowed').id;
  const noTextFixture=fixtureStore.ingest({...fixtureEvent(98003),message:[{type:'image',data:{file:'synthetic-image'}}],raw_message:'[CQ:image]'},null,100,'no_text').id;
  fixtureStore.retainIgnoredContent=false;
  const notStoredFixture=fixtureStore.ingest(fixtureEvent(98004),null,100,'ai_disabled').id;
  browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  browser.on('error',error=>failures.push({source:'launch',text:error.message}));
  let port;for(let n=0;n<100;n++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Chrome debugging port available');const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  socket.on('message',bytes=>{const message=JSON.parse(bytes);if(message.id){const handler=pending.get(message.id);if(!handler)return;clearTimeout(handler.timer);pending.delete(message.id);if(message.error)handler.reject(Error(message.error.message));else handler.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')failures.push(message.params);else if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')failures.push(message.params.entry);});
  await once(socket,'open');await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await viewport(1440);await send('Page.navigate',{url:workspace.url});await wait('document.getElementById("connection")?.textContent==="已连接"');
  if(process.argv.includes('--measure')){
    const measurements=[];
    for(const width of [1440,390,320]){
      await viewport(width,width<681?844:1000);await navigate('overview');
      const overview=await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.pipeline button')];const list=document.getElementById('recent-activity'),last=list.lastElementChild;return {width:innerWidth,steps:buttons.map(b=>({width:b.getBoundingClientRect().width,iconY:b.querySelector('.step-mark').getBoundingClientRect().y,status:b.querySelector('small').textContent,statusHeight:b.querySelector('small').getBoundingClientRect().height})),activityGap:last?list.closest('.panel').getBoundingClientRect().bottom-last.getBoundingClientRect().bottom:0};})()`);
      await navigate('messages');const filters=await evaluate(`['message-type','message-direction'].map(id=>({id,width:document.getElementById(id).getBoundingClientRect().width}))`);
      measurements.push({...overview,filters});
    }
    await writeFile(join(output,'ui-baseline.json'),JSON.stringify(measurements,null,2));
    console.log(JSON.stringify({baseline:measurements}));
    await viewport(1440);await navigate('overview');
  }

  function contrast(a,b){const luminance=s=>{const c=s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
  for(const width of [1440,1024,768,680,390,320]){
    await viewport(width,width<681?844:1000);await navigate('overview');
    const layout=await evaluate("(()=>{const b=[...document.querySelectorAll('.pipeline button')],list=document.getElementById('recent-activity');return {width:innerWidth,steps:b.map(e=>({width:e.getBoundingClientRect().width,iconY:e.querySelector('.step-mark').getBoundingClientRect().y,statusHeight:e.querySelector('small').getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(e.querySelector('small')).lineHeight)})),activityGap:list.closest('.panel').getBoundingClientRect().bottom-list.lastElementChild.getBoundingClientRect().bottom};})()");
    if(width<=680){assert.ok(layout.steps.every(s=>s.width>=240),'readable mobile steps '+width);assert.ok(layout.steps.every(s=>s.statusHeight<=s.lineHeight+1),'status text fits without a dangling character '+width);}
    else {
      assert.ok(Math.max(...layout.steps.map(s=>s.iconY))-Math.min(...layout.steps.map(s=>s.iconY))<=1,'desktop icon alignment '+width);
      const arrows=await evaluate("[...document.querySelectorAll('.pipeline>svg')].map(e=>e.getBoundingClientRect().y+e.getBoundingClientRect().height/2)");
      assert.ok(arrows.every(y=>Math.abs(y-layout.steps[0].iconY-14.5)<=1),'flow arrows share icon centers '+width);
    }
    assert.ok(layout.activityGap<=20,'recent activity follows content '+width);
    if(width===320)await screenshot('mobile-320');
    await navigate('messages');
    const filters=await evaluate("['message-type','message-direction'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=s.font;return {id,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,available:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-24,required:Math.max(...[...e.options].map(o=>ctx.measureText(o.text).width)),label:e.closest('label')?.textContent};})");
    for(const filter of filters){assert.ok(filter.width>=120,'filter cannot collapse '+filter.id+' '+width);assert.ok(filter.available>=filter.required-1,'all option text fits '+filter.id+' '+width);assert.ok(filter.label,'visible filter label');if(width<=680)assert.ok(filter.height>=44,'mobile filter target');}
    if(width===320)await screenshot('messages-mobile-320');
    layoutMetrics.push({...layout,filters});checks.push('flow, filters and activity geometry '+width);
    await navigate('settings');await wait('document.getElementById("field-AI_MODEL")');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    const colors=await evaluate("(()=>{const e=document.getElementById('field-AI_MODEL');e.focus();const s=getComputedStyle(e);return {border:s.borderTopColor,focus:s.outlineColor,outline:s.outlineStyle,background:s.backgroundColor,focused:document.activeElement===e,visible:e.matches(':focus-visible')};})()");
    const ratios={width,border:contrast(colors.border,colors.background),focus:contrast(colors.focus,colors.background),colors};
    assert.ok(ratios.border>=3,'field boundary contrast '+JSON.stringify(ratios));assert.ok(ratios.focus>=3&&colors.outline==='solid','focus ring contrast '+JSON.stringify(ratios));contrastMetrics.push(ratios);
  }
  checks.push('field boundaries and keyboard focus contrast');
  await viewport(1440);await navigate('overview');
  const darkFocus=await evaluate("(()=>{const e=document.querySelector('.sidebar .nav button');e.focus();return {focus:getComputedStyle(e).outlineColor,background:getComputedStyle(document.querySelector('.sidebar')).backgroundColor};})()");
  assert.ok(contrast(darkFocus.focus,darkFocus.background)>=3,'focus is visible on the dark navigation rail');checks.push('keyboard focus contrast on dark sidebar');
  await viewport(1440);await navigate('overview');
  assert.equal(await evaluate('document.getElementById("demo").hidden'),false);await wait('document.querySelector(".activity-row")');await noOverflow('desktop overview');await screenshot('desktop');
  await navigate('messages');await wait('document.querySelectorAll(".message-row").length===3');await screenshot('messages-desktop');await value('message-search','待办');assert.equal(await evaluate('document.querySelectorAll(".message-row").length'),1);await value('message-search','');await value('message-direction','out');assert.equal(await evaluate('document.querySelectorAll(".message-row").length'),1);await value('message-direction','all');
  await click('pause-messages');workspace.app.adapter.driver.inject(incoming(20261027,{message:'<script>window.unsafe=1</script>【演示】这是文本。'}));await delay(1700);assert.equal(await evaluate('document.querySelectorAll(".message-row").length'),3);await click('pause-messages');assert.equal(await evaluate('document.querySelectorAll(".message-row").length'),4);assert.equal(await evaluate('window.unsafe'),undefined);checks.push('message filtering, pause, resume and escaped content');

  const expanded=await evaluate("(()=>{const row=document.querySelector('.message-row');row.querySelector('details').open=true;row.querySelector('summary').focus();return row.dataset.message;})()");
  workspace.app.adapter.driver.inject(incoming(20261028,{message:'【演示】用于验证原始事件展开状态的新消息。'}));
  await wait('document.querySelectorAll(".message-row").length===5');
  assert.equal(await evaluate('document.querySelector(\'.message-row[data-message="'+expanded+'"] details\').open'),true);
  assert.equal(await evaluate('document.activeElement.closest(".message-row")?.dataset.message'),expanded);
  await value('message-type','group');await value('message-type','all');
  assert.equal(await evaluate('document.querySelector(\'.message-row[data-message="'+expanded+'"] details\').open'),true);
  checks.push('raw event expansion survives new messages and filtering; keyboard focus survives insertion');
  await navigate('logs');await wait('document.querySelectorAll("#log-body tr").length>0');await value('log-level','warn');await screenshot('logs-desktop');assert.equal(await evaluate('document.querySelectorAll("#log-body tr").length'),1);await value('log-level','all');checks.push('log filtering');
  await navigate('jobs');await wait('document.querySelectorAll("#job-body tr").length>0');await evaluate('document.querySelector("#job-body details").open=true');await wait('document.querySelector("#job-body details pre").textContent.includes("会话：")');await delay(1700);assert.equal(await evaluate('document.querySelector("#job-body details").open'),true);await screenshot('jobs-desktop');assert.equal(await evaluate('document.getElementById("uncertain-help").hidden'),false);await evaluate('Array.from(document.querySelectorAll("#job-body button")).find(b=>b.textContent==="放弃任务").click()');await wait('document.getElementById("confirm-dialog").open');await click('confirm-ok');await wait('document.getElementById("uncertain-help").hidden');checks.push('uncertain job resolution and persistent details');

  async function taskText(id){await evaluate('document.querySelector(\'tr[data-job="'+id+'"] details\').open=true');await wait('document.querySelector(\'tr[data-job="'+id+'"] pre\').textContent.includes("会话：")');return evaluate('document.querySelector(\'tr[data-job="'+id+'"] pre\').textContent');}
  const filteredText=await taskText(filteredFixture);assert.ok(filteredText.includes('不在回复白名单')&&filteredText.includes('【演示原文】'));
  assert.ok((await taskText(redactedFixture)).includes('正文已脱敏清除，无法恢复'));
  assert.ok((await taskText(noTextFixture)).includes('原消息没有文本，仅含图片等非文本内容'));
  assert.ok((await taskText(notStoredFixture)).includes('正文未记录，仅保留防重信息'));
  fixtureStore.redactIgnored('retention');
  await wait('document.querySelector(\'tr[data-job="'+filteredFixture+'"] pre\').textContent.includes("正文已脱敏清除")');
  await evaluate('document.getElementById("privacy-audit").open=true');
  assert.ok(await evaluate('document.getElementById("privacy-records").textContent.includes("脱敏")'));
  await screenshot('privacy-jobs-desktop');checks.push('four task content states and live redaction cache invalidation');checks.push('persistent privacy audit is visible with count and time');
  await navigate('settings');await wait('document.getElementById("field-AI_MODEL")');await value('field-AI_API_KEY','changed-fixture-key');await value('field-AI_API_KEY','');assert.equal(await evaluate('document.getElementById("save").disabled'),true);assert.equal(workspace.app.config.ai.apiKey,'web-qa-fixture-key');checks.push('blank secret input preserves stored value');await value('field-AI_MODEL','web-qa-model');await value('field-AI_SYSTEM_PROMPT','【验收配置】请简洁地回答。\n支持多行提示词。');await click('save');await wait('document.getElementById("save-state").textContent.includes("等待重启")');assert.equal(workspace.app.config.ai.model,'');await screenshot('settings-desktop');
  await click('restart');await wait('document.getElementById("confirm-dialog").open');assert.ok(await evaluate('document.getElementById("confirm-body").textContent.includes("不可恢复")'));checks.push('restart warns redaction cannot be reversed by re-enabling retention');await click('confirm-ok');await wait('document.getElementById("save-state").textContent==="所有设置已保存"');assert.equal(workspace.app.config.ai.model,'web-qa-model');checks.push('save and apply restart');
  await value('setting-search','TOKEN');assert.ok(await evaluate('document.querySelectorAll("#fields .field").length>=4'));await value('setting-search','');
  await evaluate('Array.from(document.querySelectorAll("#settings-nav button")).find(b=>b.textContent==="OneBot 与推送").click()');await wait('document.getElementById("field-ONEBOT_ACCESS_TOKEN")');assert.equal(await evaluate('document.getElementById("field-ONEBOT_ACCESS_TOKEN").value'),'');await evaluate('document.getElementById("field-ONEBOT_ACCESS_TOKEN").closest(".field").querySelector(".secret-controls button").click()');await wait('document.getElementById("field-ONEBOT_ACCESS_TOKEN").type==="text"');assert.equal(await evaluate('document.getElementById("field-ONEBOT_ACCESS_TOKEN").value'),workspace.app.config.token);assert.equal(await evaluate('document.getElementById("save").disabled'),true);checks.push('secret reveal without dirtying configuration');

  await evaluate('Array.from(document.querySelectorAll("#settings-nav button")).find(b=>b.textContent==="数据与保留").click()');
  assert.ok(await evaluate('document.getElementById("help-RETAIN_IGNORED_JOB_CONTENT").textContent.includes("重新开启此开关也无法恢复")'));
  await screenshot('privacy-settings-desktop');checks.push('irreversible field help and memory/disk retention cross-references');
  await navigate('messages');assert.ok(await evaluate('document.getElementById("disk-retention").textContent.includes("7 天")&&document.getElementById("memory-retention").textContent.includes("1000")'));
  await navigate('settings');
  for(const width of [1440,1024,768,680,390,320]){await viewport(width,width<681?844:1000);for(const title of ['AI 与回复','回复范围','QQ 与运行时','OneBot 与推送','队列与发送','数据与保留','实验驱动']){await evaluate('Array.from(document.querySelectorAll("#settings-nav button")).find(b=>b.textContent==='+JSON.stringify(title)+').click()');await noOverflow('settings '+title+' '+width);}if(width===390){await evaluate('document.querySelector("#settings-nav button").click()');await screenshot('settings-mobile');}}
  await viewport(390,844);await navigate('messages');await noOverflow('mobile messages');await screenshot('messages-mobile');await navigate('overview');await screenshot('mobile');assert.equal(await evaluate('document.getElementById("sidebar").inert'),true);await click('menu');assert.equal(await evaluate('document.getElementById("sidebar").classList.contains("open")'),true);await click('shade');checks.push('mobile navigation');
  const original=workspace.app.adapter.status.bind(workspace.app.adapter);workspace.app.adapter.status=()=>({...original(),online:false});let loginCalls=0;workspace.app.adapter.login=async command=>{if(command==='start')loginCalls++;return {state:command==='poll'?'waiting_confirm':'waiting_scan',handle:'synthetic-only',expires_at:Date.now()+90000,...(command==='start'?{qrcode:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII='}:{})};};await wait('document.getElementById("connection").textContent==="未连接"');assert.equal(loginCalls,0);await viewport(1440);await screenshot('login-desktop');await viewport(390,844);await screenshot('login-mobile');await click('refresh');await wait('!document.getElementById("qr").hidden');assert.equal(loginCalls,1);await wait('document.getElementById("state").textContent==="请在手机上确认登录"');await viewport(390,844);await noOverflow('mobile QR login');checks.push('manual QR login and polling');
  assert.equal(failures.length,0,JSON.stringify(failures));const report={success:true,checks:checks.length,viewports:[1440,1024,768,680,390,320],javascriptOrCspErrors:0,details:checks,layoutMetrics,contrastMetrics,screenshots:output};await writeFile(join(output,'web-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  await writeFile(join(output,'web-qa.json'),JSON.stringify({success:false,error:error.message,checks:checks.length,layoutMetrics,contrastMetrics},null,2));throw error;
}finally{
  for(const handler of pending.values())clearTimeout(handler.timer);
  if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}
  if(browser&&browser.exitCode===null){await Promise.race([once(browser,'exit'),delay(3000)]);if(browser.exitCode===null)browser.kill();}
  await workspace?.close();
  for(const path of [profile,data]){assert.equal(dirname(path),temporaryRoot);await rm(path,{recursive:true,force:true});}
}
