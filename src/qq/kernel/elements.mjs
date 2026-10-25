import { BotError } from '../../errors.mjs';
import { kernelText } from './messages.mjs';

export const hasImages = message => Array.isArray(message)&&message.some(segment=>segment.type==='image');
export function validateKernelMessage(message) {
  if(!Array.isArray(message)||!message.length||message.length>1000)throw new BotError('Invalid QQ message',1400);
  let chars=0,images=0;
  for(const segment of message) {
    if(segment.type==='text'&&typeof segment.data?.text==='string'){chars+=segment.data.text.length;continue;}
    if(segment.type==='image'&&typeof segment.data?.file==='string'&&segment.data.file){
      images++;
      if(segment.data.type==='flash')throw new BotError('Flash images are not supported',1404);
      if(segment.data.sub_type!==undefined&&![0,1,'0','1'].includes(segment.data.sub_type))throw new BotError('Only normal images and image stickers are supported',1404);
      continue;
    }
    throw new BotError('Official kernel sends text and image segments; this message segment is unsupported',1404);
  }
  if(chars>10000||images>20||(!chars&&!images))throw new BotError('QQ message exceeds text or image count limits',1400);
}
export async function prepareKernelElements(message,cache,signal,msgService) {
  validateKernelMessage(message);
  const elements=[],leases=[];let bytes=0;
  const release=()=>{for(const image of leases)image.release();};
  try {
    for(const segment of message) {
      signal?.throwIfAborted();
      if(segment.type==='text') { if(segment.data.text)elements.push(...kernelText([segment]));continue; }
      if(!cache)throw new BotError('QQ image cache is unavailable',1501);
      const image=await cache.acquire(segment.data.file,{signal});leases.push(image);bytes+=image.bytes.length;
      if(bytes>cache.maxBytes)throw new BotError('Total message image bytes exceed MEDIA_MAX_BYTES',1400);
      const sourcePath=await cache.stage(image,msgService,signal);
      const summary=typeof segment.data.summary==='string'?Array.from(segment.data.summary).slice(0,120).join(''):'';
      elements.push({elementType:2,elementId:'',extBufForUI:'',picElement:{
        sourcePath,md5HexStr:image.md5,fileName:image.md5+'.'+image.format,fileSize:String(image.bytes.length),
        picWidth:image.width,picHeight:image.height,original:segment.data.original!==false&&segment.data.original!=='false',
        picType:image.format==='gif'?2000:1000,picSubType:Number(segment.data.sub_type??(image.format==='gif'?1:0)),
        fileUuid:'',fileSubId:'',thumbFileSize:0,summary,isFlashPic:false
      }});
    }
    return {elements,release};
  }catch(error){release();throw error;}
}
