import { FetchSource, PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';
import { addProtocol } from 'maplibre-gl';

export type TileManifest = {
  version: string; snapshot: string; archive: string; tags: string; world: string;
  bounds: [number, number, number, number];
};
const root = new URL(`${import.meta.env.BASE_URL}nyc-tiles/`, location.href).href;
const disk = globalThis.caches?.open('queensboro-vector-data-v1').catch(() => undefined);
export const assetUrl = (path: string) => new URL(path, root).href;

export async function cachedResponse(url: string, signal?: AbortSignal, revalidate = false): Promise<Response> {
  const cache = await disk;
  let cached: Response | undefined;
  try { cached = await cache?.match(url); } catch { /* Storage optional. */ }
  if (cached && !revalidate) return cached;
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: revalidate ? 'no-cache' : 'default' });
    if (!response.ok) throw new Error(`Local map asset returned HTTP ${response.status}`);
  } catch (error) {
    signal?.throwIfAborted();
    if (cached) return cached;
    throw error;
  }
  if (cache) void cache.put(url, response.clone()).catch(() => {});
  return response;
}

export async function loadTileManifest(): Promise<TileManifest> {
  const manifest = await (await cachedResponse(assetUrl('manifest.json'), undefined, true)).json() as TileManifest;
  if (!manifest.version || !manifest.archive || !manifest.tags || !manifest.world || manifest.bounds?.length !== 4)
    throw new Error('Invalid local tile manifest');
  return manifest;
}

// Store exact immutable archive ranges for visited-area offline reuse. MapLibre
// and PMTiles keep their own in-memory tile/header caches; no viewport setData().
class CachedArchiveSource implements Source {
  private source: FetchSource;
  constructor(private url: string) { this.source = new FetchSource(url); }
  getKey() { return this.url; }
  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const key = `${this.url}?range=${offset}-${length}`;
    const cache = await disk;
    let cached: Response | undefined;
    try { cached = await cache?.match(key); } catch { /* Storage optional. */ }
    if (cached && (!etag || cached.headers.get('ETag') === etag))
      return { data: await cached.arrayBuffer(), etag: cached.headers.get('ETag') || undefined };
    const result = await this.source.getBytes(offset, length, signal, etag);
    if (cache) void cache.put(key, new Response(result.data, { headers: result.etag ? { ETag: result.etag } : {} })).catch(() => {});
    return result;
  }
}
export function registerLocalTiles(manifest: TileManifest) {
  const protocol = new Protocol({ metadata: true });
  protocol.add(new PMTiles(new CachedArchiveSource(assetUrl(manifest.archive))));
  addProtocol('pmtiles', protocol.tile);
}

export class BuildingTags {
  private memory = new Map<number, Record<string, Record<string,string>>>();
  constructor(readonly manifest: TileManifest) {}
  async get(type: string, id: number, signal: AbortSignal) {
    const shard = id % 256;
    let records = this.memory.get(shard);
    if (!records) {
      records = await (await cachedResponse(assetUrl(`${this.manifest.tags}${shard}.json`), signal)).json() as Record<string,Record<string,string>>;
      signal.throwIfAborted();
      this.memory.set(shard, records);
      while (this.memory.size > 4) this.memory.delete(this.memory.keys().next().value!);
    }
    const tags = records[`${type}/${id}`];
    if (!tags) throw new Error('No tags found in this building snapshot.');
    return tags;
  }
}
