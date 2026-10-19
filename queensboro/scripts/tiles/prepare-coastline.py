"""Assemble the local extract's directed coastline into a small build-only input."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from shapely.geometry import LineString, box, mapping
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree
from shapely import make_valid

source, output = map(Path, sys.argv[1:])
bounds = [-74.36, 40.48, -73.67, 40.96]
with tempfile.TemporaryDirectory(dir=source.parent) as work:
    filtered = Path(work) / 'coast.osm.pbf'
    subprocess.run(['osmium', 'tags-filter', str(source), 'w/natural=coastline', '-o', str(filtered)], check=True)
    process = subprocess.Popen(['osmium', 'export', str(filtered), '--geometry-types=linestring', '-f', 'geojsonseq'], stdout=subprocess.PIPE, text=True)
    coasts = []
    for line in process.stdout:
        feature = json.loads(line.lstrip('\x1e'))
        if feature['properties'].get('natural') == 'coastline':
            geometry = feature['geometry']
            lines = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
            coasts.extend(LineString(points) for points in lines if len(points) > 1)
    if process.wait(): raise RuntimeError('Coastline export failed')
    extent = box(*bounds)
    regions = polygonize(unary_union([extent.boundary, *(coast.intersection(extent) for coast in coasts)]))
    segments = [LineString([a, b]) for coast in coasts for a, b in zip(coast.coords, list(coast.coords)[1:]) if a != b]
    tree = STRtree(segments)
    land = []
    for region in regions:
        p = region.representative_point()
        a, b = segments[int(tree.nearest(p))].coords
        if (b[0]-a[0])*(p.y-a[1])-(b[1]-a[1])*(p.x-a[0]) > 0: land.append(region)
    if not land: raise RuntimeError('No coastline land polygons assembled')
    land = make_valid(unary_union(land))
    features = [dict(type='Feature', properties={'kind': kind}, geometry=mapping(geom))
                for kind, geom in [('land', land), ('ocean', extent.difference(land))]]
    output.write_text(json.dumps(dict(type='FeatureCollection', features=features), separators=(',', ':')))
