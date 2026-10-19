import type { Map, MapGeoJSONFeature } from 'maplibre-gl';

export function attachBuildingInspector(map: Map) {
  const panel = document.createElement('aside');
  panel.className = 'building-inspector';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Selected building information');
  const header = document.createElement('div');
  header.className = 'building-inspector-header';
  const title = document.createElement('h2');
  title.textContent = 'Building';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'building-inspector-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close building information');
  header.append(title, close);
  const content = document.createElement('div');
  content.className = 'building-inspector-content';
  panel.append(header, content);
  document.querySelector('#app')!.append(panel);

  const clear = () => { panel.hidden = true; };
  close.addEventListener('click', () => {
    clear();
    map.getCanvas().focus({ preventScroll: true });
  });
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') clear();
  };
  document.addEventListener('keydown', escape);

  function section(label: string, entries: [string, unknown][], parent: HTMLElement = content) {
    if (label) {
      const heading = document.createElement('h3');
      heading.textContent = label;
      parent.append(heading);
    }
    const list = document.createElement('dl');
    for (const [key, value] of entries) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      // Tile attributes are untrusted text, never HTML.
      term.textContent = key;
      description.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
      list.append(term, description);
    }
    parent.append(list);
  }

  function show(feature: MapGeoJSONFeature, coordinates: { lng: number; lat: number }) {
    const properties = feature.properties || {};
    title.textContent = String(properties.name || properties.name_en || 'Building');
    content.replaceChildren();
    const osm = document.createElement('div');
    osm.className = 'building-inspector-osm';
    const status = document.createElement('p');
    status.className = 'building-inspector-status';
    status.setAttribute('role', 'status');
    status.textContent = 'OSM attributes from the local NYC snapshot.';
    osm.append(status);
    content.append(osm);
    const keys = Object.keys(properties).sort();
    section(`Render properties (${keys.length})`, keys.map(key => [key, properties[key]]));
    if (!keys.length) {
      const empty = document.createElement('p');
      empty.textContent = 'This feature has no render properties.';
      content.append(empty);
    }
    const metadata = document.createElement('details');
    const metadataTitle = document.createElement('summary');
    metadataTitle.textContent = 'Feature details';
    metadata.append(metadataTitle);
    section('', [
      ['Feature ID', feature.id ?? 'Not provided'],
      ['Source', feature.source],
      ['Source layer', feature.sourceLayer ?? 'Not provided'],
      ['Map layer', feature.layer.id],
      ['Geometry type', feature.geometry.type],
      ['Clicked longitude', coordinates.lng.toFixed(7)],
      ['Clicked latitude', coordinates.lat.toFixed(7)],
    ], metadata);
    content.append(metadata);
    const geometry = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Raw GeoJSON';
    const raw = document.createElement('pre');
    raw.textContent = JSON.stringify({
      type: 'Feature',
      ...(feature.id !== undefined ? { id: feature.id } : {}),
      properties,
      geometry: feature.geometry,
    }, null, 2);
    geometry.append(summary, raw);
    const note = document.createElement('p');
    note.className = 'building-inspector-note';
    note.textContent = 'Footprints and tags come from the downloaded OSM snapshot. Heights without an OSM height tag are display estimates; see height_source.';
    content.append(geometry, note);
    panel.scrollTop = 0;
    panel.hidden = false;
    const type = properties.osm_type;
    const id = Number(properties.osm_id);
    if (!['way', 'relation'].includes(type) || !Number.isSafeInteger(id) || id <= 0) {
      status.textContent = 'No OSM identity is available for this building.';
      return;
    }
    let tags: Record<string, string>;
    try { tags = JSON.parse(properties.osm_tags); }
    catch { status.textContent = 'Could not read the cached building tags.'; return; }
    osm.replaceChildren();
    const identity = document.createElement('a');
    identity.href = `https://www.openstreetmap.org/${type}/${id}`;
    identity.target = '_blank';
    identity.rel = 'noopener noreferrer';
    identity.textContent = `OSM ${type}/${id} ↗`;
    const provenance = document.createElement('p');
    provenance.className = 'building-inspector-note';
    provenance.textContent = `NYC snapshot · ${new Date(properties.snapshot).toLocaleDateString()}`;
    osm.append(identity, provenance);
    section(`OSM tags (${Object.keys(tags).length})`, Object.keys(tags).sort().map(key => [key, tags[key]]), osm);
    if (tags.name || tags['name:en']) title.textContent = tags.name || tags['name:en'];
  }

  map.on('click', event => {
    if (!map.getLayer('buildings-3d')) return;
    const feature = map.queryRenderedFeatures(event.point, { layers: ['buildings-3d'] })[0];
    if (feature) show(feature, event.lngLat);
    else clear();
  });
  map.on('remove', () => {
    clear();
    document.removeEventListener('keydown', escape);
    panel.remove();
  });
}
