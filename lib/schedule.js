export function scheduledRunKey({tenantId,routineId,slot}){if(!tenantId||!routineId||!slot)throw new Error('Identitas slot wajib');return JSON.stringify([tenantId,routineId,new Date(slot).toISOString()]);}
export function resolveMissedSlots(slots,policy){if(policy==='skip')return [];if(policy==='run_latest')return slots.length?[...slots].sort().slice(-1):[];throw new Error('Kebijakan tidak didukung');}

export function nextRunAt(config,after=new Date()){
 const format=new Intl.DateTimeFormat('en-US',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
 const cursor=new Date(Math.floor(after.getTime()/60000)*60000+60000);
 for(let n=0;n<8*24*60;n++,cursor.setUTCMinutes(cursor.getUTCMinutes()+1)){
  const parts=Object.fromEntries(format.formatToParts(cursor).map(p=>[p.type,p.value]));
  const day=parts.weekday;const allowed=config.frequency==='daily'||config.frequency==='weekday'&&!['Sat','Sun'].includes(day)||config.frequency==='weekly'&&day==='Mon';
  if(allowed&&parts.hour+':'+parts.minute===config.time)return cursor.toISOString();
 }
 throw new Error('NEXT_RUN_NOT_FOUND');
}
