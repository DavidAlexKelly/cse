[main/java/com/decho/cse/bridge/HlaEncoder.java]
package com.decho.cse.bridge;

import hla.rti1516e.RtiFactoryFactory;
import hla.rti1516e.encoding.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

// Encoders for the datatypes used by the NETN / RPR-FOM interactions this
// bridge sends.
//
// All encoding goes through the RTI's own EncoderFactory rather than
// hand-rolled byte buffer writes, because HLA fixed records, arrays and
// variant records have alignment and padding rules that a naive
// concatenate-the-bytes encoder gets wrong.
//
// Key datatype facts:
// - UUID / UuidArrayOfHLAbyte16 / TransactionId is a fixed array of 16
//   raw bytes, not text.
// - WorldLocationStruct is 3 x float64, geocentric ECEF metres, not
//   latitude/longitude degrees.
// - GeodeticLocation is 2 x float64, latitude/longitude in degrees.
// - Datetime18 is a fixed array of 18 UTF-16BE characters in the format
//   yyyyMMddHHmmss.SSS; all zeroes means "start immediately".
// - Callsign / Text64 are variable arrays of UTF-16BE characters, the same
//   encoding as HLAunicodeString.
// - Angle fields in the v2-era FOM are radians, not degrees.
// - HLAboolean is a 4-byte integer enumeration (0/1); RPRboolean is a
//   1-byte octet enumeration (0/1). They are not interchangeable.
//
// NETN v4 datatypes differ from the above in ways that are silent
// wrong-value traps rather than decode errors:
// - LocationStruct is 3 x float64 in the same geocentric ECEF world
//   coordinate system as WorldLocationStruct - it is not
//   latitude/longitude despite the name; separate geodetic types exist
//   for that.
// - DirectionDegreesFloat32 is a 32-bit float in degrees clockwise from
//   true north, replacing the v2-era radians.
// - EpochTime is a 32-bit integer of seconds since the Unix epoch,
//   replacing Datetime18.
// - TimeMillisecondInt64 is a 64-bit integer of milliseconds; durations
//   that were seconds-as-int32 in v2 are milliseconds-as-int64 in v4.
// - SupplyStatusStruct pairs an EntityTypeStruct with a float64 quantity,
//   where v2 used a float32 quantity.
// - Each task carries one TaskParameters fixed record instead of flat
//   parameters, so nested records have to be composed as DataElements and
//   cannot be concatenated as raw bytes.
public final class HlaEncoder {

    // Datetime18 value meaning "execute immediately".
    public static final String IMMEDIATE = "00000000000000.000";

    private static final DateTimeFormatter DT18 =
            DateTimeFormatter.ofPattern("yyyyMMddHHmmss.SSS").withZone(ZoneOffset.UTC);

    // WGS-84 ellipsoid.
    private static final double WGS84_A = 6378137.0;
    private static final double WGS84_E2 = 6.69437999014e-3;

    private final EncoderFactory f;

    public HlaEncoder() throws Exception {
        // Pure ServiceLoader lookup, no RTI connection required, so this is
        // also usable from unit tests.
        this.f = RtiFactoryFactory.getRtiFactory().getEncoderFactory();
    }

    // -- Scalars ---------------------------------------------------------------
    // HLAoctet, also used for every 8-bit enumeration.
    public byte[] octet(int value) {
        return f.createHLAoctet((byte) value).toByteArray();
    }

    // HLAinteger16BE.
    public byte[] int16(int value) {
        return f.createHLAinteger16BE((short) value).toByteArray();
    }

    // HLAinteger32BE, also used for every 32-bit enumeration and second-based time.
    public byte[] int32(int value) {
        return f.createHLAinteger32BE(value).toByteArray();
    }

    // HLAfloat32BE (radians, metres, velocity, etc, depending on context).
    public byte[] float32(double value) {
        return f.createHLAfloat32BE((float) value).toByteArray();
    }

    // HLAfloat64BE (metres, altitude, etc, depending on context).
    public byte[] float64(double value) {
        return f.createHLAfloat64BE(value).toByteArray();
    }

    // HLAboolean - a 32-bit integer enumeration (false=0, true=1).
    public byte[] hlaBoolean(boolean value) {
        return int32(value ? 1 : 0);
    }

    // RPRboolean - an octet enumeration (false=0, true=1).
    public byte[] rprBoolean(boolean value) {
        return octet(value ? 1 : 0);
    }

    // HLAunicodeString, and the byte-identical Callsign / Text64 types.
    public byte[] unicodeString(String value) {
        return f.createHLAunicodeString(value == null ? "" : value).toByteArray();
    }

    // HLAASCIIstring.
    public byte[] asciiString(String value) {
        return f.createHLAASCIIstring(value == null ? "" : value).toByteArray();
    }

    // -- Identifiers -------------------------------------------------------------
    // UUID / UuidArrayOfHLAbyte16 / TransactionId - a fixed array of 16 raw bytes.
    // Throws IllegalArgumentException if the value is not a UUID: an HLA
    // object-instance handle string is never a valid Taskee.
    public byte[] uuid(String value) {
        return uuid(parseUuid(value));
    }

    public byte[] uuid(UUID value) {
        // A fixed array of octet-aligned elements: exactly the 16 raw
        // bytes, with no count prefix and no padding.
        return rawUuid(value);
    }

    private static byte[] rawUuid(UUID value) {
        byte[] raw = new byte[16];
        long hi = value.getMostSignificantBits();
        long lo = value.getLeastSignificantBits();
        for (int i = 0; i < 8; i++) {
            raw[i] = (byte) (hi >>> (56 - 8 * i));
            raw[i + 8] = (byte) (lo >>> (56 - 8 * i));
        }
        return raw;
    }

    public static UUID parseUuid(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing UUID");
        }
        String s = value.trim();
        if (s.length() == 32 && s.indexOf('-') < 0) {
            s = s.substring(0, 8) + "-" + s.substring(8, 12) + "-" + s.substring(12, 16)
                    + "-" + s.substring(16, 20) + "-" + s.substring(20);
        }
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Not a UUID: '" + value + "'");
        }
    }

    // ArrayOfUuid / ArrayOfTaskIds - a variable array of 16-byte UUIDs: a
    // 4-byte element count followed by the octet-aligned elements.
    public byte[] arrayOfUuid(List<UUID> ids) {
        byte[] out = new byte[4 + 16 * ids.size()];
        System.arraycopy(int32(ids.size()), 0, out, 0, 4);
        for (int i = 0; i < ids.size(); i++) {
            System.arraycopy(rawUuid(ids.get(i)), 0, out, 4 + 16 * i, 16);
        }
        return out;
    }

    // -- Time ----------------------------------------------------------------------
    // Datetime18 - a fixed array of exactly 18 UTF-16BE characters.
    // when: null means "immediately".
    public byte[] datetime18(Instant when) {
        String text = (when == null) ? IMMEDIATE : DT18.format(when);
        if (text.length() != 18) {
            throw new IllegalStateException("Datetime18 must be 18 chars, got: " + text);
        }
        // A fixed array of 18 2-byte characters: 36 bytes of UTF-16BE, no
        // length prefix, no padding.
        return text.getBytes(StandardCharsets.UTF_16BE);
    }

    // ClockTimeStruct - {Hours (int32), TimePastTheHour (uint32 DIS timestamp units)}.
    public byte[] clockTime(Instant when) {
        long epochSeconds = when.getEpochSecond();
        int hours = (int) (epochSeconds / 3600);
        double remainderNanos = (epochSeconds % 3600) * 1_000_000_000.0 + when.getNano();
        long units = (long) (remainderNanos / 3_600_000_000_000.0 * 2147483647.0);

        HLAfixedRecord record = f.createHLAfixedRecord();
        record.add(f.createHLAinteger32BE(hours));
        record.add(f.createHLAinteger32BE((int) units));
        return record.toByteArray();
    }

    // -- Geometry --------------------------------------------------------------------
    // WorldLocationStruct - geocentric ECEF metres {X, Y, Z}.
    public byte[] worldLocation(double latitudeDegrees, double longitudeDegrees, double altitudeMeters) {
        return worldLocationRecord(latitudeDegrees, longitudeDegrees, altitudeMeters).toByteArray();
    }

    private HLAfixedRecord worldLocationRecord(double lat, double lon, double alt) {
        double[] ecef = wgs84ToEcef(lat, lon, alt);
        HLAfixedRecord record = f.createHLAfixedRecord();
        record.add(f.createHLAfloat64BE(ecef[0]));
        record.add(f.createHLAfloat64BE(ecef[1]));
        record.add(f.createHLAfloat64BE(ecef[2]));
        return record;
    }

    // ArrayOfWorldLocationStruct - a variable array of WorldLocationStruct.
    public byte[] arrayOfWorldLocation(List<double[]> latLonAlt) {
        HLAfixedRecord[] elements = new HLAfixedRecord[latLonAlt.size()];
        for (int i = 0; i < latLonAlt.size(); i++) {
            double[] p = latLonAlt.get(i);
            elements[i] = worldLocationRecord(p[0], p[1], p.length > 2 ? p[2] : 0.0);
        }
        HLAvariableArray<HLAfixedRecord> array =
                f.createHLAvariableArray(index -> f.createHLAfixedRecord(), elements);
        return array.toByteArray();
    }

    // GeodeticLocation - {Latitude, Longitude} in degrees.
    private HLAfixedRecord geodeticLocation(double latitudeDegrees, double longitudeDegrees) {
        HLAfixedRecord record = f.createHLAfixedRecord();
        record.add(f.createHLAfloat64BE(latitudeDegrees));
        record.add(f.createHLAfloat64BE(longitudeDegrees));
        return record;
    }

    // GeodeticQuadrangle - {Point1, Point2}, a lat/lon bounding box.
    public byte[] geodeticQuadrangle(double lat1, double lon1, double lat2, double lon2) {
        HLAfixedRecord record = f.createHLAfixedRecord();
        record.add(geodeticLocation(lat1, lon1));
        record.add(geodeticLocation(lat2, lon2));
        return record.toByteArray();
    }

    // AreaVariantStruct discriminated on GeoLocationTypeEnum32, using the
    // Circle alternative: {CenterPoint (GeodeticLocation), Radius (float32)}.
    public byte[] areaCircle(double latitudeDegrees, double longitudeDegrees, double radiusMeters) {
        HLAfixedRecord circle = f.createHLAfixedRecord();
        circle.add(geodeticLocation(latitudeDegrees, longitudeDegrees));
        circle.add(f.createHLAfloat32BE((float) radiusMeters));

        // Reuses the exact discriminant instance for both setVariant and
        // setDiscriminant, since variant lookup is by object rather than by
        // equals()/hashCode().
        HLAinteger32BE circleDiscriminant = f.createHLAinteger32BE(2); // Circle
        HLAvariantRecord<HLAinteger32BE> variant = f.createHLAvariantRecord(circleDiscriminant);
        variant.setVariant(circleDiscriminant, circle);
        variant.setDiscriminant(circleDiscriminant);
        return variant.toByteArray();
    }

    // WGS-84 geodetic (degrees, metres) to geocentric ECEF (metres).
    public static double[] wgs84ToEcef(double latitudeDegrees, double longitudeDegrees, double altitudeMeters) {
        double lat = Math.toRadians(latitudeDegrees);
        double lon = Math.toRadians(longitudeDegrees);
        double sinLat = Math.sin(lat);
        double cosLat = Math.cos(lat);
        double n = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
        double x = (n + altitudeMeters) * cosLat * Math.cos(lon);
        double y = (n + altitudeMeters) * cosLat * Math.sin(lon);
        double z = (n * (1.0 - WGS84_E2) + altitudeMeters) * sinLat;
        return new double[]{x, y, z};
    }

    // -- DIS / RPR structures ---------------------------------------------------------
    // EntityTypeStruct from a dotted SISO-REF-010 type
    // (kind.domain.country.category.subcategory.specific.extra).
    public byte[] entityType(String dotted) {
        return entityTypeRecord(dotted).toByteArray();
    }

    private HLAfixedRecord entityTypeRecord(String dotted) {
        int[] p = new int[7];
        String[] parts = (dotted == null ? "" : dotted).split("\\.");
        for (int i = 0; i < 7 && i < parts.length; i++) {
            try {
                p[i] = Integer.parseInt(parts[i].trim());
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("Not a DIS entity type: '" + dotted + "'");
            }
        }
        HLAfixedRecord record = f.createHLAfixedRecord();
        record.add(f.createHLAoctet((byte) p[0])); // EntityKind
        record.add(f.createHLAoctet((byte) p[1])); // Domain
        record.add(f.createHLAinteger16BE((short) p[2])); // CountryCode
        record.add(f.createHLAoctet((byte) p[3])); // Category
        record.add(f.createHLAoctet((byte) p[4])); // Subcategory
        record.add(f.createHLAoctet((byte) p[5])); // Specific
        record.add(f.createHLAoctet((byte) p[6])); // Extra
        return record;
    }

    // NETN_SupplyStruct - {SupplyType (EntityTypeStruct), Quantity (float32)}.
    public byte[] supply(String dottedSupplyType, double quantity) {
        HLAfixedRecord record = f.createHLAfixedRecord();
        record.add(entityTypeRecord(dottedSupplyType));
        record.add(f.createHLAfloat32BE((float) quantity));
        return record.toByteArray();
    }

    // EntityIdentifierStruct - {{SiteID, ApplicationID}, EntityNumber}.
    public byte[] entityIdentifier(int siteId, int applicationId, int entityNumber) {
        HLAfixedRecord federate = f.createHLAfixedRecord();
        federate.add(f.createHLAinteger16BE((short) siteId));
        federate.add(f.createHLAinteger16BE((short) applicationId));

        HLAfixedRecord record = f.createHLAfixedRecord();
        record.add(federate);
        record.add(f.createHLAinteger16BE((short) entityNumber));
        return record.toByteArray();
    }

    // == NETN v4 ================================================================
    // v4 collapses each task's parameters into a single TaskParameters
    // fixed record, so encoding is composition of nested records rather
    // than one parameter per value. Everything below returns DataElement
    // rather than byte[] because nesting has to preserve each field's
    // octet boundary, which a byte[] no longer carries once flattened.

    // -- v4 top-level parameter values ------------------------------------------------
    // EpochTime - a 32-bit integer of seconds since the Unix epoch.
    public byte[] epochTime(Instant when) {
        return int32((int) (when == null ? Instant.now() : when).getEpochSecond());
    }

    // -- v4 element factories -----------------------------------------------------------
    // Nested values are built as elements and assembled with fixedRecord(...)
    // at the call site, so a task's TaskParameters struct reads in the same
    // field order as the FOM defines it.
    public DataElement octetEl(int value) { return f.createHLAoctet((byte) value); }
    public DataElement int16El(int value) { return f.createHLAinteger16BE((short) value); }
    public DataElement int32El(int value) { return f.createHLAinteger32BE(value); }
    public DataElement int64El(long value) { return f.createHLAinteger64BE(value); }
    public DataElement float32El(double value) { return f.createHLAfloat32BE((float) value); }
    public DataElement float64El(double value) { return f.createHLAfloat64BE(value); }
    public DataElement stringEl(String value) { return f.createHLAunicodeString(value == null ? "" : value); }

    // HLAboolean - a 32-bit integer enumeration, not an octet.
    public DataElement booleanEl(boolean value) { return f.createHLAinteger32BE(value ? 1 : 0); }

    // TimeMillisecondInt64.
    public DataElement millisEl(long milliseconds) { return int64El(milliseconds); }

    // DirectionDegreesFloat32, normalised into [0,360).
    public DataElement directionDegreesEl(double degrees) { return float32El(normaliseDegrees(degrees)); }

    // UUID - a fixed array of 16 octet-aligned bytes.
    //
    // Built from the RTI's own byte elements rather than a custom wrapper,
    // so alignment behaviour stays the RTI's responsibility rather than ours.
    public DataElement uuidEl(UUID value) {
        byte[] raw = rawUuid(value);
        HLAbyte[] elements = new HLAbyte[raw.length];
        for (int i = 0; i < raw.length; i++) {
            elements[i] = f.createHLAbyte(raw[i]);
        }
        return f.createHLAfixedArray(elements);
    }

    public DataElement uuidEl(String value) { return uuidEl(parseUuid(value)); }

    // The all-zero UUID. Every v4 UUID field that means "unspecified" uses
    // this rather than being omitted, since a field inside a fixed record
    // cannot be left out.
    public DataElement nilUuidEl() { return uuidEl(new UUID(0L, 0L)); }

    // EntityTypeStruct from a dotted SISO-REF-010 type.
    public DataElement entityTypeEl(String dotted) { return entityTypeRecord(dotted); }

    // LocationStruct as a nested element (geocentric ECEF metres).
    public DataElement locationEl(double latitudeDegrees, double longitudeDegrees, double altitudeMeters) {
        return worldLocationRecord(latitudeDegrees, longitudeDegrees, altitudeMeters);
    }

    // LocationStructArray - a variable array of LocationStruct.
    public DataElement locationArrayEl(List<double[]> latLonAlt) {
        HLAfixedRecord[] elements = new HLAfixedRecord[latLonAlt.size()];
        for (int i = 0; i < latLonAlt.size(); i++) {
            double[] p = latLonAlt.get(i);
            elements[i] = worldLocationRecord(p[0], p[1], p.length > 2 ? p[2] : 0.0);
        }
        return f.createHLAvariableArray(index -> f.createHLAfixedRecord(), elements);
    }

    // ArrayOfWaypoints - a variable array of
    // Waypoint{Location, Speed (float32 m/s), SegmentMaxWidth (float32 m)}.
    // speedMetersPerSecond: speed to reach each waypoint; 0 leaves the
    // choice to the simulator.
    // segmentMaxWidthMeters: 0 means no width constraint.
    public DataElement waypointArrayEl(List<double[]> latLonAlt,
                                        double speedMetersPerSecond,
                                        double segmentMaxWidthMeters) {
        HLAfixedRecord[] elements = new HLAfixedRecord[latLonAlt.size()];
        for (int i = 0; i < latLonAlt.size(); i++) {
            double[] p = latLonAlt.get(i);
            HLAfixedRecord waypoint = f.createHLAfixedRecord();
            waypoint.add(worldLocationRecord(p[0], p[1], p.length > 2 ? p[2] : 0.0));
            waypoint.add(f.createHLAfloat32BE((float) speedMetersPerSecond));
            waypoint.add(f.createHLAfloat32BE((float) segmentMaxWidthMeters));
            elements[i] = waypoint;
        }
        return f.createHLAvariableArray(index -> f.createHLAfixedRecord(), elements);
    }

    // RoundStruct - {WeaponType, MunitionType (both EntityTypeStruct),
    // QuantityFired (int16), RateOfFire (float32)}.
    // All-zero types and quantities mean "unspecified, simulator decides",
    // since DIS weapon/munition enumerations are scenario-specific.
    public DataElement roundEl(String dottedWeaponType,
                                String dottedMunitionType,
                                int quantityFired,
                                double roundsPerSecond) {
        return recordEl(
                entityTypeEl(dottedWeaponType == null ? "0.0.0.0.0.0.0" : dottedWeaponType),
                entityTypeEl(dottedMunitionType == null ? "0.0.0.0.0.0.0" : dottedMunitionType),
                int16El(quantityFired),
                float32El(roundsPerSecond));
    }

    // Composes a TaskParameters (or any other) fixed record as a value.
    public byte[] fixedRecord(DataElement... fields) {
        return recordEl(fields).toByteArray();
    }

    // Composes a fixed record as a nested element, for structs that
    // contain structs.
    public HLAfixedRecord recordEl(DataElement... fields) {
        HLAfixedRecord record = f.createHLAfixedRecord();
        for (DataElement field : fields) {
            record.add(field);
        }
        return record;
    }

    // -- Geometry helpers ---------------------------------------------------------------
    // Approximates a circle as a closed polygon of lat/lon/alt points, for
    // v4 Area fields expressed as a LocationStructArray rather than a
    // centre and radius. The first point is not repeated at the end: these
    // arrays describe the vertices of an area, so the closing edge is implied.
    public static List<double[]> circleToPolygon(double latitudeDegrees,
                                                   double longitudeDegrees,
                                                   double radiusMeters,
                                                   double altitudeMeters,
                                                   int points) {
        int n = Math.max(3, points);
        List<double[]> polygon = new java.util.ArrayList<>(n);
        double dLat = radiusMeters / 111_320.0;
        double cosLat = Math.max(0.01, Math.cos(Math.toRadians(latitudeDegrees)));
        double dLon = radiusMeters / (111_320.0 * cosLat);
        for (int i = 0; i < n; i++) {
            double angle = 2.0 * Math.PI * i / n;
            polygon.add(new double[]{
                    latitudeDegrees + dLat * Math.sin(angle),
                    longitudeDegrees + dLon * Math.cos(angle),
                    altitudeMeters});
        }
        return polygon;
    }

    private static double normaliseDegrees(double degrees) {
        double d = degrees % 360.0;
        return d < 0 ? d + 360.0 : d;
    }

    // Uppercase hex, space-separated per byte, for diagnostics: lets "here
    // is exactly what was put on the wire" be compared byte for byte
    // against another federate's decoder.
    public static String hex(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(bytes.length * 3);
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) {
                out.append(' ');
            }
            out.append(String.format("%02X", bytes[i]));
        }
        return out.toString();
    }
}