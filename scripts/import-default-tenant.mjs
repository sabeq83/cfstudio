import pg from 'pg';
import {domainTables,planObject} from '../lib/import-service.js';
import {assertSeparateDatabases} from '../lib/runtime-config.js';
if(!process.env.SOURCE_DATABASE_URL||!process.env.SOURCE_TENANT_ID||!process.env.TARGET_TENANT_ID)throw new Error('Konfigurasi tenant dan sumber wajib eksplisit.');
if(process.env.SOURCE_SCHEMA!=='staging')throw new Error('SOURCE_SCHEMA harus staging.');
if(process.env.DATABASE_URL)assertSeparateDatabases(process.env.SOURCE_DATABASE_URL,process.env.DATABASE_URL);
if(process.argv.includes('--apply'))throw new Error('IMPORT_APPLY_NOT_READY: verifikasi database tujuan, binding/dependency dan media harus diselesaikan sebelum apply.');
const client=new pg.Client({connectionString:process.env.SOURCE_DATABASE_URL});const totals={};
try{await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');for(const [domain,table] of Object.entries(domainTables)){const {rows}=await client.query(`SELECT * FROM staging."${table}" WHERE tenant_id=$1`,[process.env.SOURCE_TENANT_ID]);const plans=rows.map(row=>planObject(row,{domain,sourceTenantId:process.env.SOURCE_TENANT_ID,targetTenantId:process.env.TARGET_TENANT_ID}));totals[domain]={count:plans.length,mediaVerified:false};}console.log(JSON.stringify({dryRun:true,sourceSchema:'staging',totals,note:'Preset kustom dicakup inventory; apply dan relink belum diaktifkan.'},null,2));await client.query('ROLLBACK');}finally{await client.end();}
