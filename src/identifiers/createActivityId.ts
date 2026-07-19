export async function hashSource(bytes:Uint8Array){const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}
export function createActivityId(hash:string,start?:Date){const stamp=start?start.toISOString().replace(/[-:]/g,'').replace('.000',''):'unknown-date';return `${stamp}-${hash.slice(0,12)}`}
export function yearFor(start?:Date){return start?String(start.getUTCFullYear()):'unknown'}
