export async function hashSource(bytes: Uint8Array): Promise<string> {
  // Copy into a regular ArrayBuffer so Web Crypto does not receive a SharedArrayBuffer view.
  const source = new Uint8Array(bytes).buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function createActivityId(hash: string, start?: Date): string {
  const stamp = start ? start.toISOString().replace(/[-:]/g, '').replace('.000', '') : 'unknown-date';
  return `${stamp}-${hash.slice(0, 12)}`;
}

export function yearFor(start?: Date): string { return start ? String(start.getUTCFullYear()) : 'unknown'; }
