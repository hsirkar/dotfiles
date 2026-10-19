#!/usr/bin/env python3
"""Direct NYC OSM PBF -> Planetiler PMTiles, tag shards, and precomputed world meshes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'data/osm'
PUBLIC = ROOT / 'public/nyc-tiles'
VERSION = '0.10.2'
SOURCE = 'https://download.bbbike.org/osm/bbbike/NewYork/NewYork.osm.pbf'


def run(args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT)


def fingerprint(source):
    digest = hashlib.sha256()
    inputs = [source, *sorted((ROOT/'scripts/tiles').glob('*.py')), *sorted((ROOT/'scripts/tiles').glob('*.java')),
              ROOT/'scripts/tiles/build-world.ts', *(ROOT/'src'/name for name in ['bridge.ts','roads.ts','approaches.ts','config.ts','world-input.ts'])]
    for path in inputs:
        with path.open('rb') as data:
            for chunk in iter(lambda: data.read(1024*1024), b''): digest.update(chunk)
    digest.update(VERSION.encode())
    return digest.hexdigest()[:16]


def build(download=False, reuse=False):
    WORK.mkdir(parents=True, exist_ok=True)
    source = WORK/'NewYork.osm.pbf'
    if download:
        run(['curl', '--fail', '--location', '--retry', '2', SOURCE, '-o', WORK/'NewYork.download'])
        (WORK/'NewYork.download').replace(source)
    if not source.exists(): raise SystemExit('Download the NYC PBF first: npm run tiles:build -- --download')
    jar = WORK/'planetiler.jar'
    if not jar.exists():
        url = f'https://github.com/onthegomap/planetiler/releases/download/v{VERSION}/planetiler.jar'
        run(['curl','--fail','--location',url,'-o',jar])
        checksum = WORK/'planetiler.jar.sha256'
        run(['curl','--fail','--location',url+'.sha256','-o',checksum])
        expected = checksum.read_text().split()[0]
        if hashlib.sha256(jar.read_bytes()).hexdigest() != expected:
            jar.unlink()
            raise RuntimeError('Planetiler checksum mismatch')
    version = fingerprint(source)
    destination = PUBLIC/'releases'/version
    stamp = WORK/'tile-build-version.txt'
    prepared = reuse or (stamp.exists() and stamp.read_text().strip() == version)
    if not prepared:
        for path in [WORK/'tags', WORK/'world-assets', WORK/'planetiler-tmp']:
            if path.exists(): shutil.rmtree(path)
        run([sys.executable,ROOT/'scripts/tiles/prepare-coastline.py',source,WORK/'coastline.geojson'])
        java = os.environ.get('JAVA', 'java')
        run([java,'-Xmx6g','-cp',jar,ROOT/'scripts/tiles/NycTiles.java',
             '--minzoom=10','--maxzoom=16','--bounds=-74.36,40.48,-73.67,40.96','--threads=6',
             f'--tmpdir={WORK}/planetiler-tmp',f'--output={WORK}/nyc.pmtiles','--force',
             f'--tags_path={WORK}/tags',f'--world_path={WORK}/world.ndjson'])
        run([ROOT/'node_modules/.bin/esbuild',ROOT/'scripts/tiles/build-world.ts','--bundle','--platform=node',
             '--format=esm','--external:maplibre-gl',f'--outfile={WORK}/build-world.mjs'])
        run(['node','--max-old-space-size=6144',WORK/'build-world.mjs',WORK/'world.ndjson',WORK/'coastline.geojson',WORK/'world-assets'])
        stamp.write_text(version)
    # Release assets are immutable; the small root manifest is published last.
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        staging = PUBLIC/'staging'
        if staging.exists(): shutil.rmtree(staging)
        (staging/'tags').mkdir(parents=True)
        count = 0
        for shard in range(256):
            records = {}
            path = WORK/'tags'/f'{shard}.ndjson'
            if path.exists():
                with path.open() as data:
                    for line in data:
                        record = json.loads(line)
                        records[record['key']] = record['tags']
            count += len(records)
            (staging/'tags'/f'{shard}.json').write_text(json.dumps(records,separators=(',',':'),ensure_ascii=False))
        shutil.copy2(WORK/'nyc.pmtiles', staging/'nyc.pmtiles')
        shutil.copytree(WORK/'world-assets', staging/'world')
        (staging/'stats.json').write_text(json.dumps({'buildingTagRecords':count}))
        staging.rename(destination)
    info = json.loads(subprocess.check_output(['osmium','fileinfo','-j',str(source)]))
    snapshot = info['header']['option']['osmosis_replication_timestamp']
    manifest = dict(version=version, snapshot=snapshot, generatedAt=datetime.now(timezone.utc).isoformat(),
                    bounds=[-74.36,40.48,-73.67,40.96], archive=f'releases/{version}/nyc.pmtiles',
                    tags=f'releases/{version}/tags/', world=f'releases/{version}/world/manifest.json',
                    attribution='© OpenStreetMap contributors, ODbL 1.0', planetiler=VERSION)
    temporary = PUBLIC/'manifest.new'
    temporary.write_text(json.dumps(manifest,indent=2)+'\n')
    temporary.replace(PUBLIC/'manifest.json')
    print(f'Published local vector tiles: {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='Refresh the source NYC PBF')
    parser.add_argument('--reuse-prepared', action='store_true', help='Publish already prepared PMTiles/sidecars (development only)')
    args = parser.parse_args()
    build(args.download,args.reuse_prepared)
