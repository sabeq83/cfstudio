import {invariant} from './errors.js';
export const kinds=['multiplier','recipe_video','recipe_static','brand_editorial','product_campaign'];
export function validateTarget(input){
 invariant(kinds.includes(input.kind),'INVALID_KIND','Jalur tidak dikenali.');
 invariant(typeof input.name==='string'&&input.name.trim(),'NAME_REQUIRED','Nama target wajib.');
 invariant(Number.isInteger(input.count)&&input.count>0&&input.count<=10,'INVALID_COUNT','Jumlah 1–10.');
 invariant(!Object.hasOwn(input,'cep'),'CEP_IS_PLANNER_OUTPUT','CEP dihasilkan otomatis oleh Content Planner.');
 if(input.kind==='product_campaign')invariant(input.productId,'PRODUCT_REQUIRED','Produk wajib dipilih.');
 if(input.kind==='multiplier')invariant(input.sourceId,'DECONSTRUCT_REQUIRED','Hasil deconstruct wajib.');
 return {...input,name:input.name.trim(),selected:input.selected!==false};
}
export function validateRoutine(input){invariant(input.brandId,'BRAND_REQUIRED','Brand wajib.');invariant(input.name?.trim(),'NAME_REQUIRED','Nama rutinitas wajib.');invariant(Array.isArray(input.targets)&&input.targets.some(x=>x.selected!==false),'TARGET_REQUIRED','Pilih target produksi.');new Intl.DateTimeFormat('id-ID',{timeZone:input.timezone});invariant(/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time),'INVALID_TIME','Jam tidak valid.');invariant(['daily','weekday','weekly'].includes(input.frequency),'FREQUENCY_INVALID','Frekuensi tidak didukung.');return {...input,targets:input.targets.map(validateTarget)};}
