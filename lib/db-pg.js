import pg from 'pg';
import {readConfig} from './runtime-config.js';
let pool;
export function getPool(){if(!pool){const c=readConfig();pool=new pg.Pool({connectionString:c.databaseUrl,max:c.poolMax,connectionTimeoutMillis:8000});}return pool;}
export async function transaction(fn){const client=await getPool().connect();try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
