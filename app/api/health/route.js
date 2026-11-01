import {readConfig} from '../../../lib/runtime-config.js';
export async function GET(){const c=readConfig(process.env,{requireDatabase:false});return Response.json({app:'CF Studio',version:'3.0.0-alpha.1',databaseConfigured:Boolean(c.databaseUrl),productionDispatch:c.productionDispatch,publishingDispatch:c.publishingDispatch,status:'foundation'});}
