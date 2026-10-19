#!/usr/bin/env python3
"""Prepare a local GeoJSON basemap from our complete NYC OSM extract."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree
from shapely import make_valid

from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location('buildings', Path(__file__).with_name('cache-nyc-buildings.py'))
settings = module_from_spec(spec)
spec.loader.exec_module(settings)
ROOT, BOUNDS = settings.ROOT, settings.BOUNDS
CELL = .02
MAJOR = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link'}
KEEP = {'name', 'name:en', 'ref', 'highway', 'railway', 'natural', 'landuse', 'leisure', 'water', 'waterway',
        'bridge', 'bridge:structure', 'bridge:support', 'man_made', 'layer', 'width', 'height', 'min_height',
        'place', 'amenity', 'shop', 'tourism', 'surface', 'tunnel', 'area', 'service', 'wikidata'}


def collection(features):
    return {'type': 'FeatureCollection', 'features': features}


def write(path, value):
    path.write_text(json.dumps(value, separators=(',', ':')))


def build(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with source.open('rb') as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b''): digest.update(chunk)
    digest.update(Path(__file__).read_bytes())
    version = digest.hexdigest()[:16]
    counts = Counter()
    with tempfile.TemporaryDirectory(dir=destination.parent) as work:
        work = Path(work)
        filtered = work / 'map.osm.pbf'
        subprocess.run(['osmium', 'tags-filter', str(source),
                        'wr/natural=water,coastline,wood,wetland,scrub,beach,grassland',
                        'wr/waterway', 'wr/man_made=bridge', 'wr/bridge', 'w/highway',
                        'wr/landuse', 'wr/leisure', 'w/railway', 'n/place', 'n/amenity', 'n/shop', 'n/tourism',
                        '-o', str(filtered)], check=True)
        output = work / 'output'
        output.mkdir()
        cells = set()
        coasts, overview = [], []
        extent = box(*BOUNDS)
        process = subprocess.Popen(['osmium', 'export', str(filtered), '-a', 'type,id', '-f', 'geojsonseq'],
                                   stdout=subprocess.PIPE, text=True)
        try:
            for line in process.stdout:
                feature = json.loads(line.lstrip('\x1e'))
                tags, geometry = feature['properties'], feature['geometry']
                kind, identity = tags.pop('@type'), tags.pop('@id')
                geo_type = geometry['type']
                linear = geo_type in ('LineString', 'MultiLineString')
                polygon = geo_type in ('Polygon', 'MultiPolygon')
                point = geo_type == 'Point'
                if tags.get('natural') == 'coastline' and linear:
                    lines = [geometry['coordinates']] if geo_type == 'LineString' else geometry['coordinates']
                    coasts.extend(LineString(points) for points in lines if len(points) >= 2)
                    continue
                group = None
                if polygon:
                    if tags.get('man_made') == 'bridge': group = 'bridge-outline'
                    elif tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank' or tags.get('landuse') in ('reservoir', 'basin'): group = 'water'
                    elif tags.get('leisure') or tags.get('landuse') or tags.get('natural'): group = 'landuse'
                elif linear:
                    if tags.get('highway') and tags['highway'] not in ('proposed', 'construction'): group = 'road'
                    elif tags.get('railway') in ('rail', 'light_rail', 'subway', 'tram', 'narrow_gauge'): group = 'rail'
                    elif tags.get('waterway') in ('river', 'stream', 'canal', 'drain'): group = 'waterway'
                elif point and (tags.get('name') or tags.get('name:en')):
                    if tags.get('place'): group = 'place'
                    elif tags.get('amenity') in ('school', 'university', 'hospital', 'library', 'museum', 'ferry_terminal', 'place_of_worship') or tags.get('tourism') in ('museum', 'attraction', 'viewpoint'):
                        group = 'poi'
                if group is None: continue
                geom = shape(geometry)
                if not geom.intersects(extent): continue
                props = {k: v for k, v in tags.items() if k in KEEP}
                props.update(kind=group, osm_type=kind, osm_id=identity)
                if group == 'road':
                    props['class'] = tags['highway']
                    props['ramp'] = tags['highway'].endswith('_link')
                    props['brunnel'] = 'bridge' if tags.get('bridge') not in (None, 'no') else 'tunnel' if tags.get('tunnel') not in (None, 'no') else ''
                elif group == 'rail': props['class'] = 'rail'
                elif group == 'bridge-outline': props['class'] = 'bridge'
                feature = dict(type='Feature', id=f'{kind}/{identity}/{group}', geometry=geometry, properties=props)
                counts[group] += 1
                # Whole-feature bridge and highway geometry is retained for Babylon.
                global_feature = group in ('water', 'bridge-outline', 'place') or (group == 'road' and (tags.get('highway') in MAJOR or props['brunnel'] == 'bridge'))
                if group == 'landuse' and geom.area > .0003: global_feature = True
                if global_feature:
                    coarse = dict(feature)
                    coarse['geometry'] = mapping(geom.simplify(.000015, preserve_topology=True)) if group in ('water', 'landuse') else geometry
                    overview.append(coarse)
                if group in ('water', 'bridge-outline', 'place'): continue
                west, south, east, north = geom.bounds
                # Very large landcover polygons already live in the overview.
                if group == 'landuse' and global_feature: continue
                encoded = json.dumps(feature, separators=(',', ':'))
                for x in range(math.floor(max(west, BOUNDS[0]) / CELL), math.floor(min(east, BOUNDS[2]) / CELL) + 1):
                    for y in range(math.floor(max(south, BOUNDS[1]) / CELL), math.floor(min(north, BOUNDS[3]) / CELL) + 1):
                        key = f'{x}_{y}'
                        with (output / f'{key}.json').open('a') as target:
                            target.write((',' if key in cells else '[') + encoded)
                        cells.add(key)
            if process.wait() != 0: raise RuntimeError('osmium export failed')
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait()
        print('Assembling coastline land/water polygons...', flush=True)
        clipped = [coast.intersection(extent) for coast in coasts]
        regions = list(polygonize(unary_union([extent.boundary, *clipped])))
        segments = [LineString([a, b]) for coast in coasts for a, b in zip(coast.coords, list(coast.coords)[1:]) if a != b]
        tree = STRtree(segments)
        land = []
        for region in regions:
            p = region.representative_point()
            segment = segments[int(tree.nearest(p))]
            a, b = segment.coords
            # OSM coastlines run with land on the left, water on the right.
            if (b[0] - a[0]) * (p.y - a[1]) - (b[1] - a[1]) * (p.x - a[0]) > 0:
                land.append(region)
        if not land: raise RuntimeError('Coastline assembly produced no land')
        land = make_valid(unary_union(land))
        ocean = extent.difference(land)
        def surface(identity, geom):
            return dict(type='Feature', id=identity, properties={'kind': identity}, geometry=mapping(geom.simplify(.00001, preserve_topology=True)))
        # Low zoom does not need one property dictionary per road way. Group
        # simplified lines by class; detailed area chunks retain original IDs/tags.
        coarse_roads = {}
        retained = []
        for feature in overview:
            props = feature['properties']
            if props['kind'] != 'road':
                retained.append(feature)
                continue
            geometry = mapping(shape(feature['geometry']).simplify(.00004, preserve_topology=True))
            lines = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
            coarse_roads.setdefault(props['class'], []).extend(lines)
            if props.get('brunnel') == 'bridge': retained.append(feature)
        coarse = [dict(type='Feature', id=f'overview-road/{kind}',
                       properties={'kind': 'overview-road', 'class': kind},
                       geometry={'type': 'MultiLineString', 'coordinates': lines})
                  for kind, lines in coarse_roads.items()]
        overview = [surface('land', land), surface('ocean', ocean), *retained, *coarse]
        write(output / 'overview.json', collection(overview))
        for key in cells:
            with (output / f'{key}.json').open('a') as target: target.write(']')
        info = json.loads(subprocess.check_output(['osmium', 'fileinfo', '-j', str(source)]))
        manifest = dict(version=version, generatedAt=datetime.now(timezone.utc).isoformat(),
                        osmTimestamp=info['header'].get('option', {}).get('osmosis_replication_timestamp'),
                        bounds=BOUNDS, cellSize=CELL, cells=sorted(cells), counts=dict(counts),
                        source=settings.SOURCE, attribution='© OpenStreetMap contributors, ODbL 1.0')
        write(output / 'manifest.json', manifest)
        if destination.exists(): shutil.rmtree(destination)
        output.rename(destination)
        print(f'Prepared {dict(counts)}, {len(cells)} detail chunks at {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'data/osm/NewYork.osm.pbf')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/nyc-map')
    args = parser.parse_args()
    build(args.input, args.output)
