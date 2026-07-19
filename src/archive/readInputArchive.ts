import JSZip from 'jszip';
import { archiveLimits } from './archiveLimits';

export interface InputSource { path: string; bytes: Uint8Array }

const isSafePath = (name: string) => !name.split('/').some((part) => part === '..') && !name.startsWith('/') && !name.includes('\\');

export async function readInputs(files: File[]): Promise<InputSource[]> {
  const output: InputSource[] = [];
  let totalUncompressedBytes = 0;
  const retain = (path: string, bytes: Uint8Array) => {
    if (bytes.byteLength > archiveLimits.maximumSingleGpxBytes) return;
    if (totalUncompressedBytes + bytes.byteLength > archiveLimits.maximumUncompressedBytes) throw new Error('ARCHIVE_UNCOMPRESSED_TOO_LARGE');
    totalUncompressedBytes += bytes.byteLength;
    output.push({ path, bytes });
  };
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.gpx')) { retain(file.name, new Uint8Array(await file.arrayBuffer())); continue; }
    if (!file.name.toLowerCase().endsWith('.zip')) continue;
    if (file.size > archiveLimits.maximumCompressedBytes) throw new Error('ARCHIVE_TOO_LARGE');
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new Error('MALFORMED_ZIP'); }
    for (const entry of Object.values(zip.files)) {
      const name = entry.name;
      if (entry.dir || !isSafePath(name) || name.startsWith('__MACOSX/') || /\/(\.|\.DS_Store)/.test(name) || !name.toLowerCase().endsWith('.gpx')) continue;
      if (output.length >= archiveLimits.maximumInputFiles) throw new Error('TOO_MANY_FILES');
      const bytes = await entry.async('uint8array');
      retain(name, bytes);
    }
  }
  return output;
}
