export const MEDIA_BUCKET = 'video-background-media';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_METADATA = 256 * 1024;
const utf8 = new TextEncoder();
export function decode64(data: string) {
  if (typeof data !== 'string' || !data.length || data.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw Error('生成ファイルの大きさが不正です');
  const binary = atob(data), bytes = new Uint8Array(binary.length);
  if (bytes.length > MAX_BYTES) throw Error('生成ファイルが20MBを超えています');
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function encode64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(out);
}
async function digest(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function createMediaStore(base: string, key: string, fetcher: typeof fetch = fetch) {
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  function path(job: string, item: string, lease: string, type: string) {
    if (![job, item, lease].every(x => UUID.test(x))) throw Error('保存先の指定が不正です');
    return `${job}/${item}/${lease}.${type}`;
  }
  function checkedPath(name: string, job: string, item?: string) {
    if (!UUID.test(job) || !name.startsWith(job + '/') || !/^[a-f0-9/-]+\.(bin|json)$/i.test(name) || (item && !name.startsWith(job + '/' + item + '/'))) throw Error('保存先の指定が不正です');
    return name;
  }
  async function upload(name: string, bytes: Uint8Array, mime: string) {
    if (!bytes.length || bytes.length > MAX_BYTES) throw Error('保存するファイルの大きさが不正です');
    const r = await fetcher(base + '/storage/v1/object/' + MEDIA_BUCKET + '/' + name, {
      method: 'POST', headers: { ...headers, 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes, signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) throw Error('画像・音声のファイル保存に失敗しました（' + r.status + '）');
    return { bucket: MEDIA_BUCKET, path: name, bytes: bytes.length, sha256: await digest(bytes) };
  }
  async function download(ref: any, job: string, item?: string) {
    if (ref?.bucket !== MEDIA_BUCKET) throw Error('保存先が不正です');
    const name = checkedPath(ref.path, job, item);
    const r = await fetcher(base + '/storage/v1/object/authenticated/' + MEDIA_BUCKET + '/' + name, { headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error('保存した画像・音声を取得できません。保存期間は30日です。');
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length !== ref.bytes || await digest(bytes) !== ref.sha256) throw Error('保存ファイルを確認できませんでした');
    return bytes;
  }
  async function saveResult(job: string, item: string, lease: string, result: any) {
    const metadata: any = {};
    for (const k of ['mimeType','provider','alignment','audioAlignment','sampleRate','channels','fallbackFrom']) if (result[k] !== undefined) metadata[k] = result[k];
    if (utf8.encode(JSON.stringify(metadata)).length > MAX_METADATA - 1024) throw Error('音声の時刻情報が大きすぎます');
    const mime = String(metadata.mimeType || 'application/octet-stream');
    if (!/^(image|audio)\/[\w.+-]+(?:;[^\r\n]*)?$|^application\/octet-stream$/.test(mime)) throw Error('生成ファイルの種類が不正です');
    const ref = await upload(path(job, item, lease, 'bin'), decode64(result.data), mime);
    return { ...metadata, media: ref };
  }
  async function readResult(job: string, item: string, result: any) {
    if (typeof result?.data === 'string') return result; // transitional legacy response
    const { media, ...metadata } = result;
    return { ...metadata, data: encode64(await download(media, job, item)) };
  }
  async function saveRequest(job: string, request: any) {
    const bytes = utf8.encode(JSON.stringify(request));
    if (bytes.length <= 64 * 1024) return request;
    const ref = await upload(path(job, crypto.randomUUID(), crypto.randomUUID(), 'json'), bytes, 'application/json');
    return { mediaRequest: ref };
  }
  async function readRequest(job: string, request: any) {
    if (!request?.mediaRequest) return request;
    return JSON.parse(new TextDecoder().decode(await download(request.mediaRequest, job)));
  }
  async function remove(names: string[]) {
    if (!names.length) return;
    if (names.some(n => !/^[a-f0-9/-]+\.(bin|json)$/i.test(n))) throw Error('削除するファイルの指定が不正です');
    const r = await fetcher(base + '/storage/v1/object/' + MEDIA_BUCKET, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: names }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error('期限切れファイルを整理できませんでした（' + r.status + '）');
  }
  return { saveResult, readResult, saveRequest, readRequest, remove };
}
