#!/usr/bin/env python3
"""Build static building chunks from a BBBike NewYork OSM PBF. Requires osmium."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://download.bbbike.org/osm/bbbike/NewYork/NewYork.osm.pbf'
BOUNDS = [-74.36, 40.48, -73.67, 40.96]  # BBBike NewYork.poly, west/south/east/north
CELL = 0.01


def build(source, destination):
    version = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    with tempfile.TemporaryDirectory(dir=destination.parent) as work:
        work = Path(work)
        filtered = work / 'buildings.osm.pbf'
        subprocess.run(['osmium', 'tags-filter', str(source), 'wr/building',
                        'wr/building:part', 'w/man_made=bridge_pier,tower',
                        '-o', str(filtered)], check=True)
        chunks = work / 'chunks'
        chunks.mkdir()
        # Export assembles complete ways and multipolygon relations, retaining tags.
        process = subprocess.Popen(['osmium', 'export', str(filtered),
                                    '--geometry-types=polygon', '-a', 'type,id',
                                    '-f', 'geojsonseq'], stdout=subprocess.PIPE, text=True)
        cells = set()
        count = 0
        try:
            for line in process.stdout:
                feature = json.loads(line.lstrip('\x1e'))
                tags = feature['properties']
                kind, identity = tags.pop('@type'), tags.pop('@id')
                if not ('building' in tags or 'building:part' in tags or
                        tags.get('man_made') in ('bridge_pier', 'tower')):
                    continue
                geometry = feature['geometry']
                polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
                points = [p for polygon in polygons for ring in polygon for p in ring]
                west, south = map(min, zip(*points))
                east, north = map(max, zip(*points))
                if east < BOUNDS[0] or north < BOUNDS[1] or west > BOUNDS[2] or south > BOUNDS[3]:
                    continue
                element = dict(type=kind, id=identity, tags=tags, polygons=polygons)
                encoded = json.dumps(element, separators=(',', ':'))
                # Duplicate crossing footprints into every intersecting cell.
                for x in range(math.floor(max(west, BOUNDS[0]) / CELL), math.floor(min(east, BOUNDS[2]) / CELL) + 1):
                    for y in range(math.floor(max(south, BOUNDS[1]) / CELL), math.floor(min(north, BOUNDS[3]) / CELL) + 1):
                        key = f'{x}_{y}'
                        path = chunks / f'{key}.json'
                        with path.open('a') as output:
                            output.write((',' if key in cells else '[') + encoded)
                        cells.add(key)
                count += 1
            if process.wait() != 0:
                raise RuntimeError('osmium export failed')
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait()
        if not count:
            raise RuntimeError('No buildings exported; keeping the existing cache')
        for key in cells:
            with (chunks / f'{key}.json').open('a') as output:
                output.write(']')
        info = json.loads(subprocess.check_output(['osmium', 'fileinfo', '-j', str(source)]))
        timestamp = info['header'].get('option', {}).get('osmosis_replication_timestamp')
        manifest = dict(version=version, generatedAt=datetime.now(timezone.utc).isoformat(),
                        osmTimestamp=timestamp, bounds=BOUNDS, cellSize=CELL,
                        count=count, cells=sorted(cells), source=SOURCE,
                        attribution='© OpenStreetMap contributors, ODbL 1.0')
        (chunks / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        if destination.exists():
            shutil.rmtree(destination)
        chunks.rename(destination)
        print(f'Cached {count:,} buildings in {len(cells):,} cells at {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='Download/refresh the source PBF first')
    parser.add_argument('--input', type=Path, default=ROOT / 'data/osm/NewYork.osm.pbf')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/nyc-buildings')
    args = parser.parse_args()
    args.input.parent.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.download:
        partial = args.input.with_suffix('.download')
        subprocess.run(['curl', '--fail', '--location', '--retry', '2', SOURCE, '-o', str(partial)], check=True)
        partial.replace(args.input)
    build(args.input, args.output)
