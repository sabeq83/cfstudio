import {readConfig} from '../lib/runtime-config.js';
const config=readConfig(process.env,{requireDatabase:false});
if(!config.productionDispatch&&!config.publishingDispatch){console.log('CF Studio: dispatch produksi dan publikasi OFF. Tidak ada provider dipanggil.');process.exit(0);}
throw new Error('WORKER_NOT_READY: adapter provider, database dan gate integrasi belum diverifikasi.');
