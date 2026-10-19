import type { OsmElement } from './osm-building';

type Manifest = {
  version: string;
  generatedAt: string;
  osmTimestamp?: string;
  bounds: [number, number, number, number];
  cellSize: number;
  cells: string[];
};

// These files ship with the app. Cache Storage also keeps visited areas available
// offline; it is optional (e.g. private browsing or a full disk).
export class NycBuildingCache {
  private manifest?: Manifest;
  private memory = new Map<string, OsmElement[]>();
  private disk = globalThis.caches?.open('queensboro-nyc-buildings-v1').catch(() => undefined);
  private root = `${import.meta.env.BASE_URL}nyc-buildings/`;

  async lookup(west: number, south: number, east: number, north: number, signal: AbortSignal, crop = false) {
    const disk = await this.disk;
    const manifestUrl = `${this.root}manifest.json`;
    if (!this.manifest) {
      let response: Response | undefined;
      try {
        response = await fetch(manifestUrl, { cache: 'no-cache', signal });
      } catch {
        signal.throwIfAborted();
        response = await disk?.match(manifestUrl);
      }
      // A checkout without generated files can still use the online lookup.
      if (response?.status === 404) return;
      if (!response?.ok) throw new Error('Could not load the NYC building cache. Please retry.');
      // Vite's SPA fallback returns index.html for missing public assets.
      if (!response.headers.get('Content-Type')?.includes('application/json')) return;
      const manifest = await response.clone().json() as Manifest;
      if (!manifest.version || !Array.isArray(manifest.cells) || !Array.isArray(manifest.bounds)
        || manifest.bounds.length !== 4 || !Number.isFinite(manifest.cellSize) || manifest.cellSize <= 0
        || !Number.isFinite(Date.parse(manifest.generatedAt))) throw new Error('Invalid NYC building cache manifest.');
      this.manifest = manifest;
      try { await disk?.put(manifestUrl, response); } catch { /* Memory-only fallback. */ }
    }
    const manifest = this.manifest;
    const [minX, minY, maxX, maxY] = manifest.bounds;
    if (crop) {
      west = Math.max(west, minX); south = Math.max(south, minY);
      east = Math.min(east, maxX); north = Math.min(north, maxY);
    }
    if (west < minX || south < minY || east > maxX || north > maxY) return;
    const keys: string[] = [];
    for (let x = Math.floor(west / manifest.cellSize); x <= Math.floor(east / manifest.cellSize); x++) {
      for (let y = Math.floor(south / manifest.cellSize); y <= Math.floor(north / manifest.cellSize); y++) {
        const key = `${x}_${y}`;
        if (manifest.cells.includes(key)) keys.push(key);
      }
    }
    const chunks = await Promise.all(keys.map(async key => {
      const inMemory = this.memory.get(key);
      if (inMemory) return inMemory;
      const url = `${this.root}${key}.json?v=${manifest.version}`;
      let response: Response | undefined;
      try { response = await disk?.match(url); } catch { /* Fetch from app instead. */ }
      if (!response) response = await fetch(url, { signal });
      if (!response.ok) throw new Error('NYC building cache file unavailable. Please retry.');
      const elements = await response.clone().json() as OsmElement[];
      if (!Array.isArray(elements)) throw new Error('Invalid NYC building cache file.');
      try { await disk?.put(url, response); } catch { /* Memory-only fallback. */ }
      this.memory.set(key, elements);
      while (this.memory.size > 16) this.memory.delete(this.memory.keys().next().value!);
      return elements;
    }));
    signal.throwIfAborted();
    const elements = [...new Map(chunks.flat().map(element => [`${element.type}/${element.id}`, element])).values()];
    return { elements, time: Date.parse(manifest.generatedAt), osmTimestamp: manifest.osmTimestamp };
  }
}
