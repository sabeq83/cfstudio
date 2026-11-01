import { randomBytes, scryptSync, timingSafeEqual,createHash } from 'node:crypto';
export function hashPassword(password){if(typeof password!=='string'||password.length<12)throw new Error('Password minimal 12 karakter');const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyPassword(password,stored){const [algorithm,salt,digest]=String(stored).split(':');if(algorithm!=='scrypt'||!salt||!digest)return false;const a=Buffer.from(digest,'hex');const b=scryptSync(password,salt,64);return a.length===b.length&&timingSafeEqual(a,b);}
export function sessionToken(){const token=randomBytes(32).toString('base64url');return {token,hash:createHash('sha256').update(token).digest('hex')};}
