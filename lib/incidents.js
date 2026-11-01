import {fingerprint} from './production-package.js';
export function incidentKey(e){return fingerprint([e.tenantId,e.runId,e.itemId,e.revision,e.stage,e.causeGroup]);}
export function shouldNotify(previous,next,now=Date.now(),cooldownMs=900000){if(!previous)return true;if(previous.status!==next.status||previous.impact!==next.impact)return true;return now-previous.lastNotifiedAt>=cooldownMs;}
export function safeIncidentMessage(e){const stageNames={start_frames:'Start Frame',tts:'TTS',clips:'Klip video',ffmpeg:'FFmpeg',planning:'Content Planner',publishing:'Repliz'};return `CF Studio • ${e.brandName}\nTahap: ${stageNames[e.stage]||'Produksi'}\nStatus: ${e.status==='recovered'?'Pulih':e.status==='retry_wait'?'Dicoba ulang otomatis':'Perlu pemeriksaan'}\nBuka detail di aplikasi.`;}
