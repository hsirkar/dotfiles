import com.onthegomap.planetiler.*;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmSourceFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.locationtech.jts.geom.*;
import java.nio.file.*;
import java.io.*;
import java.util.*;

/** NYC rendering profile: read OSM PBF directly, emit MVT plus ID-keyed tag sidecars. */
public class NycTiles implements Profile, AutoCloseable {
  private final Path tagsDirectory;
  private final BufferedWriter world;
  private final ObjectMapper json = new ObjectMapper();
  private final LinkedHashMap<Integer, BufferedWriter> tagWriters = new LinkedHashMap<>(32, .75f, true);
  private static final Set<String> MAJOR = Set.of("motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link");
  private static final Set<String> FIELDS = Set.of("name", "name:en", "ref", "highway", "railway", "natural", "landuse", "leisure", "water", "waterway", "bridge", "bridge:structure", "man_made", "layer", "width", "height", "min_height", "place", "amenity", "shop", "tourism", "tunnel");
  public NycTiles(Path tags, Path worldPath) throws IOException {
    tagsDirectory = tags;
    Files.createDirectories(tags);
    world = Files.newBufferedWriter(worldPath);
  }
  static String tag(SourceFeature feature, String key) { return Objects.toString(feature.getTag(key), ""); }
  static Double meters(String value) {
    String s = value.trim();
    if (!s.matches("\\d+(?:\\.\\d+)?\\s*(?:m|ft|')?")) return null;
    double amount = Double.parseDouble(s.replaceAll("[^0-9.]", ""));
    return s.endsWith("ft") || s.endsWith("'") ? amount * .3048 : amount;
  }
  static double number(String value, double fallback) { Double n = meters(value); return n == null ? fallback : n; }
  private synchronized void saveTags(String type, long id, Map<String, Object> tags) throws IOException {
    int shard = (int)(id % 256);
    var writer = tagWriters.get(shard);
    if (writer == null) {
      if (tagWriters.size() >= 32) {
        int oldest = tagWriters.keySet().iterator().next();
        tagWriters.remove(oldest).close();
      }
      writer = Files.newBufferedWriter(tagsDirectory.resolve(shard + ".ndjson"), StandardOpenOption.CREATE, StandardOpenOption.APPEND);
      tagWriters.put(shard, writer);
    }
    writer.write(json.writeValueAsString(Map.of("key", type + "/" + id, "tags", tags)));
    writer.newLine();
  }
  static Object coordinates(Geometry g) {
    if (g instanceof Point p) return new double[]{p.getX(), p.getY()};
    if (g instanceof LineString line) return Arrays.stream(line.getCoordinates()).map(c -> new double[]{c.x, c.y}).toList();
    if (g instanceof Polygon polygon) {
      var rings = new ArrayList<Object>(); rings.add(coordinates(polygon.getExteriorRing()));
      for (int i=0; i<polygon.getNumInteriorRing(); i++) rings.add(coordinates(polygon.getInteriorRingN(i)));
      return rings;
    }
    var parts = new ArrayList<Object>();
    for (int i=0; i<g.getNumGeometries(); i++) parts.add(coordinates(g.getGeometryN(i)));
    return parts;
  }
  private synchronized void saveWorld(Geometry geometry, Map<String,Object> properties, String id) throws IOException {
    var env = geometry.getEnvelopeInternal();
    // All modeled Manhattan crossings and their approach corridors. Not the entire city road network.
    if (!env.intersects(new Envelope(-74.05, -73.85, 40.65, 40.90))) return;
    world.write(json.writeValueAsString(Map.of("type", "Feature", "id", id,
      "geometry", Map.of("type", geometry.getGeometryType(), "coordinates", coordinates(geometry)), "properties", properties)));
    world.newLine();
  }
  @Override public void processFeature(SourceFeature source, FeatureCollector features) {
    if (source.getSource().equals("coast")) {
      String kind = tag(source, "kind");
      features.polygon(kind.equals("land") ? "land" : "water").setAttr("kind", kind).setMinZoom(10).setMinPixelSize(0);
      return;
    }
    if (!(source instanceof OsmSourceFeature<?> osm)) return;
    var element = osm.originalElement();
    String type = element.type().toString().toLowerCase(Locale.ROOT);
    long id = element.id();
    boolean building = source.hasTag("building") || source.hasTag("building:part");
    try {
      if (building && source.canBePolygon()) {
        double base = number(tag(source, "min_height"), number(tag(source, "building:min_level"), 0)*3);
        Double explicit = meters(tag(source, "height"));
        Double levels = meters(tag(source, "building:levels"));
        double height = Math.max(base, explicit != null ? explicit : levels != null ? levels*3 : base+8);
        features.polygon("building").setMinZoom(14).setMinPixelSize(0).setPixelTolerance(.15)
          .setId(id*2 + (type.equals("relation") ? 1 : 0))
          .setAttr("osm_type", type).setAttr("osm_id", id).setAttr("name", source.getTag("name"))
          .setAttr("render_height", height).setAttr("render_min_height", base)
          .setAttr("height_source", explicit != null ? "OSM height" : levels != null ? "building:levels × 3 m estimate" : "8 m display default");
        saveTags(type, id, source.tags());
        return;
      }
      String kind = null;
      String highway = tag(source, "highway"), natural = tag(source, "natural");
      boolean polygon = source.canBePolygon();
      if (polygon && source.hasTag("man_made", "bridge")) kind = "bridge-outline";
      else if (polygon && (natural.equals("water") || source.hasTag("waterway", "riverbank") || source.hasTag("landuse", "reservoir", "basin"))) kind = "water";
      else if (source.canBeLine() && !highway.isEmpty() && !source.hasTag("highway", "construction", "proposed") && !source.hasTag("area", "yes")) kind = "road";
      else if (source.canBeLine() && source.hasTag("railway", "rail", "light_rail", "subway", "tram", "narrow_gauge")) kind = "rail";
      else if (source.canBeLine() && source.hasTag("waterway", "river", "stream", "canal", "drain")) kind = "waterway";
      else if (polygon && (source.hasTag("landuse") || source.hasTag("leisure") || source.hasTag("natural", "wood", "wetland", "scrub", "beach", "grassland"))) kind = "landuse";
      else if (source.isPoint() && (source.hasTag("name") || source.hasTag("name:en"))) {
        if (source.hasTag("place")) kind = "place";
        else if (source.hasTag("shop") || source.hasTag("amenity", "school", "university", "hospital", "library", "museum", "ferry_terminal", "place_of_worship", "restaurant", "cafe", "pharmacy") || source.hasTag("tourism", "museum", "attraction", "viewpoint")) kind = "poi";
      }
      if (kind == null) return;
      var props = new HashMap<String, Object>();
      for (String key : FIELDS) if (source.hasTag(key)) props.put(key, source.getTag(key));
      props.put("kind", kind); props.put("osm_type", type); props.put("osm_id", id);
      if (kind.equals("road")) {
        props.put("class", highway); props.put("ramp", highway.endsWith("_link"));
        props.put("brunnel", !tag(source,"bridge").isEmpty() && !tag(source,"bridge").equals("no") ? "bridge" : !tag(source,"tunnel").isEmpty() && !tag(source,"tunnel").equals("no") ? "tunnel" : "");
      } else if (kind.equals("rail")) props.put("class", "rail");
      else if (kind.equals("bridge-outline")) props.put("class", "bridge");
      if (Set.of("road", "bridge-outline", "water").contains(kind)) {
        Geometry geometry = kind.equals("road") ? source.line() : source.polygon();
        geometry = com.onthegomap.planetiler.geo.GeoUtils.worldToLatLonCoords(geometry);
        saveWorld(geometry, props, type + "/" + id + "/" + kind);
      }
      if (kind.equals("bridge-outline")) return;
      var feature = Set.of("water", "landuse").contains(kind) ? features.polygon(kind) : source.isPoint() ? features.point(kind) : features.line(kind);
      int zoom = switch(kind) {
        case "road" -> MAJOR.contains(highway) ? 10 : Set.of("footway","path","steps","service").contains(highway) ? 14 : 13;
        case "rail", "waterway" -> 13;
        case "poi" -> 16;
        default -> 10;
      };
      feature.setMinZoom(zoom).setBufferPixels(kind.equals("road") ? 8 : 4).setPixelTolerance(.4);
      for (String key : FIELDS) if (props.containsKey(key)) feature.setAttr(key, props.get(key));
      feature.setAttr("kind", kind);
      if (kind.equals("road")) feature.setAttr("brunnel", props.get("brunnel"));
    } catch (com.onthegomap.planetiler.geo.GeometryException e) {
      // Broken/incomplete source rings cannot produce a valid map feature.
    } catch (IOException e) { throw new UncheckedIOException(e); }
  }
  @Override public String name() { return "NYC OSM snapshot"; }
  @Override public String attribution() { return Profile.OSM_ATTRIBUTION; }
  @Override public void close() throws IOException {
    for (var writer : tagWriters.values()) writer.close();
    world.close();
  }
  public static void main(String[] arguments) throws Exception {
    var args = Arguments.fromArgs(arguments);
    try (var profile = new NycTiles(Path.of(args.getString("tags_path", "building tag output", "data/osm/tags")), Path.of(args.getString("world_path", "bridge preparation input", "data/osm/world.ndjson")))) {
      Planetiler.create(args).setProfile(profile)
        .addGeoJsonSource("coast", Path.of("data/osm/coastline.geojson"))
        .addOsmSource("osm", Path.of("data/osm/NewYork.osm.pbf"))
        .setOutput(Path.of("data/osm/nyc.pmtiles")).run();
    }
  }
}
