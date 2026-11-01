import {getPool} from './db-pg.js';
import {assertAccess} from './access-control.js';
const domains=['product','deconstruct','brand','visual_identity','preset'];
export async function listCatalog(actor,domain){if(!domains.includes(domain))throw new Error('DOMAIN_INVALID');assertAccess(actor,{tenantId:actor.tenantId},'catalog.read');const {rows}=await getPool().query(`SELECT id,domain,brand_id,name,revision,archived,payload FROM catalog_items WHERE tenant_id=$1 AND domain=$2 AND archived=false AND ($3::boolean OR brand_id=ANY($4::text[]) OR (domain='brand' AND id=ANY($4::text[]))) ORDER BY name`,[actor.tenantId,domain,actor.allBrands,actor.brandIds]);return rows;}
