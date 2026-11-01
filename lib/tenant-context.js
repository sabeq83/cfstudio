import { AsyncLocalStorage } from 'node:async_hooks';
import { StudioError } from './errors.js';
const context=new AsyncLocalStorage();
export function getActiveTenantId(){const id=context.getStore();if(!id)throw new StudioError('TENANT_CONTEXT_REQUIRED','Tenant wajib ditentukan.',403);return id;}
export function withRequiredTenant(id,fn){if(!id||id==='__none__')throw new StudioError('TENANT_CONTEXT_REQUIRED','Tenant wajib ditentukan.',403);return context.run(id,fn);}
