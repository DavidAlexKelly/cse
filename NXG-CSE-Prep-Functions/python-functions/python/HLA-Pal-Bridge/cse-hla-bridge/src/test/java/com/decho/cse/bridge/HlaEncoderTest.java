[test/java/com/decho/cse/bridge/HlaEncoderTest.java]
package com.decho.cse.bridge;

import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

// Encoding regression tests. These assert the exact wire sizes and bytes
// the FOM requires, so a future change to HlaEncoder that silently alters a
// wire format shows up here rather than as a task the simulator quietly
// refuses.
//
// No RTI connection is needed: the encoder factory lookup is a pure
// ServiceLoader call and returns client-side code only.
class HlaEncoderTest {

    private final HlaEncoder encoder;

    HlaEncoderTest() throws Exception {
        encoder = new HlaEncoder();
    }

    @Test
    void uuidIsSixteenRawBytesNotAString() {
        byte[] encoded = encoder.uuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
        assertEquals(16, encoded.length, "UUID is a fixed array of 16 raw bytes");
        assertArrayEquals(new byte[]{
                (byte) 0x3f, (byte) 0x25, (byte) 0x04, (byte) 0xe0,
                (byte) 0x4f, (byte) 0x89, (byte) 0x11, (byte) 0xd3,
                (byte) 0x9a, (byte) 0x0c, (byte) 0x03, (byte) 0x05,
                (byte) 0xe8, (byte) 0x2c, (byte) 0x33, (byte) 0x01},
                encoded);
        // Dashes are optional.
        assertArrayEquals(encoded, encoder.uuid("3f2504e04f8911d39a0c0305e82c3301"));
    }

    @Test
    void nonUuidIdentifiersAreRejected() {
        // An HLA object-instance handle string must never be sent as a Taskee.
        assertThrows(IllegalArgumentException.class,
                () -> HlaEncoder.parseUuid("HLAobjectInstanceHandle<42>"));
        assertThrows(IllegalArgumentException.class, () -> HlaEncoder.parseUuid(""));
    }

    @Test
    void worldLocationIsGeocentricEcefMetres() {
        byte[] encoded = encoder.worldLocation(51.5, -0.12, 35);
        assertEquals(24, encoded.length, "WorldLocationStruct is 3 x float64");

        ByteBuffer buffer = ByteBuffer.wrap(encoded); // big endian by default
        double x = buffer.getDouble();
        double y = buffer.getDouble();
        double z = buffer.getDouble();
        double radius = Math.sqrt(x * x + y * y + z * z);

        assertTrue(radius > 6_350_000 && radius < 6_380_000,
                "should be an Earth-radius ECEF vector, was " + radius);
        // Sanity check that the value is metres, not latitude/longitude degrees.
        assertTrue(Math.abs(x) > 1000, "X must be metres, not degrees");
    }

    @Test
    void ecefConversionMatchesKnownPoints() {
        double[] equator = HlaEncoder.wgs84ToEcef(0, 0, 0);
        assertEquals(6378137.0, equator[0], 0.5);
        assertEquals(0.0, equator[1], 0.5);
        assertEquals(0.0, equator[2], 0.5);

        double[] pole = HlaEncoder.wgs84ToEcef(90, 0, 0);
        assertEquals(0.0, pole[0], 0.5);
        assertEquals(0.0, pole[1], 0.5);
        assertEquals(6356752.3, pole[2], 0.5);
    }

    @Test
    void datetime18IsEighteenUtf16Characters() {
        byte[] immediate = encoder.datetime18(null);
        assertEquals(36, immediate.length, "18 characters at 2 bytes each is 36 bytes UTF-16BE");
        assertEquals(HlaEncoder.IMMEDIATE, new String(immediate, StandardCharsets.UTF_16BE));

        byte[] stamped = encoder.datetime18(Instant.parse("2026-08-13T12:34:56.789Z"));
        assertEquals(36, stamped.length);
        assertEquals("20260813123456.789", new String(stamped, StandardCharsets.UTF_16BE));
    }

    @Test
    void scalarWidthsMatchTheFomRepresentations() {
        assertEquals(1, encoder.octet(2).length, "an 8-bit enumeration is one octet");
        assertEquals(4, encoder.int32(2).length, "a 32-bit enumeration or second-count is 4 bytes");
        assertEquals(4, encoder.float32(1.57).length, "a radian/degree angle is a 32-bit float");
        assertEquals(8, encoder.float64(1.57).length, "a metre value is a 64-bit float");

        // HLAboolean and RPRboolean are different widths and not interchangeable.
        assertEquals(4, encoder.hlaBoolean(true).length, "HLAboolean is a 32-bit integer");
        assertEquals(1, encoder.rprBoolean(true).length, "RPRboolean is one octet");

        // HLAunicodeString: 4-byte count + UTF-16BE characters.
        assertEquals(4 + 6, encoder.unicodeString("CSE").length);
    }

    @Test
    void arraysCarryTheirElementCount() {
        byte[] path = encoder.arrayOfWorldLocation(List.of(
                new double[]{51.5, -0.12, 0},
                new double[]{51.6, -0.13, 0},
                new double[]{51.7, -0.14, 0}));
        // 4-byte count, padded to the 8-byte element boundary, then 3 x 24.
        assertEquals(4 + 4 + 3 * 24, path.length);
        assertEquals(3, ByteBuffer.wrap(path).getInt());

        byte[] ids = encoder.arrayOfUuid(List.of(UUID.randomUUID(), UUID.randomUUID()));
        assertEquals(4 + 32, ids.length, "UUID elements are octet aligned, so no padding");
        assertEquals(2, ByteBuffer.wrap(ids).getInt());
    }

    @Test
    void disStructuresHaveTheirSpecifiedLayout() {
        byte[] entityType = encoder.entityType("6.1.0.2.0.0.0");
        assertEquals(8, entityType.length, "EntityTypeStruct is 8 bytes");
        assertEquals(6, entityType[0], "EntityKind");
        assertEquals(1, entityType[1], "Domain");
        assertEquals(2, entityType[4], "Category");

        assertEquals(12, encoder.supply("6.1.0.2.0.0.0", 500).length,
                "the supply struct is an EntityTypeStruct plus a 32-bit float");
        assertEquals(6, encoder.entityIdentifier(1, 1, 0).length, "EntityIdentifierStruct is 6 bytes");
        assertEquals(8, encoder.clockTime(Instant.now()).length, "ClockTimeStruct is 8 bytes");
    }

    @Test
    void geodeticShapesUseDegreesNotEcef() {
        byte[] quad = encoder.geodeticQuadrangle(51.4, -0.2, 51.6, 0.0);
        assertEquals(32, quad.length, "a geodetic quadrangle is two geodetic points");
        assertEquals(51.4, ByteBuffer.wrap(quad).getDouble(), 1e-9,
                "a geodetic point is plain degrees, unlike the ECEF world location struct");
    }

    // == NETN v4 ================================================================
    // These matter more than the v2 checks above: the v4 encodings have
    // never been exercised against a live RTI, and every difference from
    // v2 is a wrong-value trap rather than a decode error - degrees vs
    // radians, milliseconds vs seconds, one struct vs flat parameters. A
    // failure here is the cheapest possible place to find out.

    @Test
    void epochTimeIsFourByteSecondsNotADatetimeString() {
        Instant when = Instant.parse("2026-08-13T12:34:56Z");
        byte[] encoded = encoder.epochTime(when);
        assertEquals(4, encoded.length, "EpochTime is a 32-bit integer of seconds");
        assertEquals(when.getEpochSecond(), ByteBuffer.wrap(encoded).getInt(),
                "v4 replaced the 36-byte Datetime18 string with epoch seconds");
    }

    @Test
    void uuidNestedInARecordMatchesTheRawSixteenBytes() {
        // The nested-element encoder goes through the RTI's fixed array of
        // bytes, while the top-level encoder writes the 16 raw bytes
        // directly. They must agree, or every v4 task that references an
        // entity inside a TaskParameters struct is malformed.
        UUID id = UUID.fromString("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
        assertArrayEquals(encoder.uuid(id), encoder.fixedRecord(encoder.uuidEl(id)),
                "UUID is octet aligned with no count prefix, nested or not");
    }

    @Test
    void magicMoveTaskStructIsEcefLocationThenHeadingInDegrees() {
        // MagicMoveTaskStruct{Location, Heading}: 3 x float64 = 24, then a
        // 4-aligned float32 at offset 24, no trailing padding.
        byte[] encoded = encoder.fixedRecord(
                encoder.locationEl(51.5, -0.12, 35),
                encoder.directionDegreesEl(-90));
        assertEquals(24 + 4, encoded.length);

        ByteBuffer buffer = ByteBuffer.wrap(encoded);
        double x = buffer.getDouble();
        double y = buffer.getDouble();
        double z = buffer.getDouble();
        double radius = Math.sqrt(x * x + y * y + z * z);
        assertTrue(radius > 6_350_000 && radius < 6_380_000,
                "v4 LocationStruct is geocentric ECEF metres, not lat/lon degrees. Was " + radius);
        assertEquals(270.0f, buffer.getFloat(), 1e-6,
                "the direction field is degrees in [0,360), unlike v2's radians");
    }

    @Test
    void moveToLocationTaskStructKeepsFomFieldOrder() {
        // {Location, Path (LocationStructArray), MoveType (int32), Speed (float32)}
        byte[] encoded = encoder.fixedRecord(
                encoder.locationEl(51.5, -0.12, 0),
                encoder.locationArrayEl(List.of()),
                encoder.int32El(1), // MoveTypeEnum32.OnlyRoads
                encoder.float32El(12.5));

        // Asserts the two ends of the struct rather than its total length:
        // what an empty variable array contributes in padding is the
        // encoder's business, but the destination must lead and the speed
        // must trail.
        double[] expectedEcef = HlaEncoder.wgs84ToEcef(51.5, -0.12, 0);
        ByteBuffer buffer = ByteBuffer.wrap(encoded);
        assertEquals(expectedEcef[0], buffer.getDouble(), 1e-6, "Location.X leads the struct");
        assertEquals(expectedEcef[1], buffer.getDouble(), 1e-6, "Location.Y");
        assertEquals(expectedEcef[2], buffer.getDouble(), 1e-6, "Location.Z");
        assertEquals(12.5f, buffer.getFloat(encoded.length - 4), 1e-6,
                "Speed is the last field");
    }

    @Test
    void patrolWaypointsCarrySpeedAndWidthPerPoint() {
        byte[] path = encoder.fixedRecord(encoder.waypointArrayEl(List.of(
                new double[]{51.5, -0.12, 0},
                new double[]{51.6, -0.13, 0}), 8.0, 0.0));

        assertEquals(2, ByteBuffer.wrap(path).getInt(), "element count leads the array");
        // Waypoint{LocationStruct (24), Speed (4), SegmentMaxWidth (4)} = 32,
        // 8-aligned, so the 4-byte count is padded to 8 first.
        assertEquals(4 + 4 + 2 * 32, path.length);
    }

    @Test
    void durationsAreMillisecondsAsInt64() {
        byte[] encoded = encoder.fixedRecord(encoder.millisEl(90_000L));
        assertEquals(8, encoded.length, "TimeMillisecondInt64 is a 64-bit integer");
        assertEquals(90_000L, ByteBuffer.wrap(encoded).getLong(),
                "v4 durations are milliseconds; v2 used 32-bit seconds");
        assertEquals(90_000L, TaskEnums.secondsToMillis(90),
                "the REST API keeps taking seconds regardless of the wire unit");
    }

    @Test
    void changeRulesOfEngagementTaskStructIsASingleOctet() {
        byte[] encoded = encoder.fixedRecord(encoder.octetEl(TaskEnums.ROE_HOLD_FIRE));
        assertEquals(1, encoded.length, "an 8-bit rules-of-engagement enumeration is one octet");
        assertEquals(0, encoded[0]);
    }

    @Test
    void hlaBooleanInAStructIsFourBytesNotOne() {
        // A field typed HLAboolean inside a struct is 4 bytes; sending the
        // 1-byte RPRboolean encoding there would misalign everything after it.
        byte[] encoded = encoder.fixedRecord(encoder.booleanEl(true));
        assertEquals(4, encoded.length);
        assertEquals(1, ByteBuffer.wrap(encoded).getInt());
    }

    @Test
    void roundStructIsTwoEntityTypesThenCountAndRate() {
        // RoundStruct{WeaponType (8), MunitionType (8), QuantityFired (int16),
        // RateOfFire (float32)}: the float32 is 4-aligned, so there are 2
        // bytes of padding after the count.
        byte[] encoded = encoder.fixedRecord(
                encoder.roundEl(TaskEnums.TYPE_UNSPECIFIED, TaskEnums.TYPE_UNSPECIFIED, 0, 0.0));
        assertEquals(8 + 8 + 2 + 2 + 4, encoded.length);
        for (byte b : encoded) {
            assertEquals(0, b, "an unspecified round must be all zeroes");
        }
    }

    @Test
    void cancelTasksSendsAnEmptyButPresentArray() {
        // An empty Tasks array means "all", but the array still has to be
        // sent since the field is required.
        byte[] encoded = encoder.arrayOfUuid(List.of());
        assertEquals(4, encoded.length);
        assertEquals(0, ByteBuffer.wrap(encoded).getInt());
    }

    @Test
    void circleToPolygonStaysWithinRadiusAndDoesNotRepeatTheFirstPoint() {
        List<double[]> polygon = HlaEncoder.circleToPolygon(51.5, -0.12, 500, 0, 8);
        assertEquals(8, polygon.size());
        assertFalse(polygon.get(0)[0] == polygon.get(7)[0]
                        && polygon.get(0)[1] == polygon.get(7)[1],
                "the closing vertex is implied, not repeated");
        for (double[] point : polygon) {
            // ~500 m is well under 0.01 degrees of latitude.
            assertEquals(51.5, point[0], 0.01);
            assertEquals(-0.12, point[1], 0.02);
        }
    }

    // -- Published wire contract -------------------------------------------------------
    // These pin the golden vectors documented as the wire contract handed
    // to other federates as the thing to implement against. If the encoder
    // changes, either the document is updated with it or one of these
    // fails - a published contract that quietly stops matching the sender
    // is worse than no document at all.
    //
    // Reference point: latitude 60.476, longitude 25.116, altitude 500 m.
    // Metre values are compared with a tolerance because trigonometric
    // functions may differ by one ULP between platforms; lengths and
    // offsets are exact.
    private static final double VECTOR_LAT = 60.476;
    private static final double VECTOR_LON = 25.116;
    private static final double VECTOR_ALT = 500.0;
    private static final double VECTOR_X = 2853356.7941;
    private static final double VECTOR_Y = 1337581.7704;
    private static final double VECTOR_Z = 5527238.2030;

    @Test
    void vectorA_locationStructMatchesThePublishedContract() {
        byte[] encoded = encoder.fixedRecord(
                encoder.locationEl(VECTOR_LAT, VECTOR_LON, VECTOR_ALT));
        assertEquals(24, encoded.length, "LocationStruct is 3 x float64, no padding");

        ByteBuffer buffer = ByteBuffer.wrap(encoded);
        assertEquals(VECTOR_X, buffer.getDouble(), 1e-4, "wire contract vector A: X");
        assertEquals(VECTOR_Y, buffer.getDouble(), 1e-4, "wire contract vector A: Y");
        assertEquals(VECTOR_Z, buffer.getDouble(), 1e-4, "wire contract vector A: Z");
    }

    @Test
    void vectorB_magicMoveTaskStructMatchesThePublishedContract() {
        byte[] encoded = encoder.fixedRecord(
                encoder.locationEl(VECTOR_LAT, VECTOR_LON, VECTOR_ALT),
                encoder.directionDegreesEl(270.0));
        assertEquals(28, encoded.length, "wire contract vector B is 28 bytes");
        assertEquals(270.0f, ByteBuffer.wrap(encoded).getFloat(24), 1e-6,
                "heading is degrees at offsets 24..27");
    }

    @Test
    void vectorD_populatedArrayCarriesTheAlignmentPadding() {
        // The padding a receiver must not forget: count, then 4 bytes so
        // the first element starts 8-aligned. A decoder that omits it is 4
        // bytes out for the whole array.
        byte[] encoded = encoder.fixedRecord(encoder.locationArrayEl(List.of(
                new double[]{60.476, 25.116, 0},
                new double[]{60.500, 25.200, 0},
                new double[]{60.550, 25.300, 0})));
        assertEquals(4 + 4 + 3 * 24, encoded.length, "wire contract vector D is 80 bytes");

        ByteBuffer buffer = ByteBuffer.wrap(encoded);
        assertEquals(3, buffer.getInt(0), "element count at offsets 0..3");
        assertEquals(0, buffer.getInt(4), "padding at offsets 4..7");
        assertTrue(Math.abs(buffer.getDouble(8)) > 1000,
                "element[0].X begins at offset 8 and is in metres");
    }

    @Test
    void vectorC_emptyPathLengthIsWhicheverTheRtiEncoderChooses() {
        // The one case the underlying spec leaves ambiguous: whether an
        // empty variable array carries the padding that would precede a
        // first element. Both readings are defensible, so this asserts the
        // invariants that hold either way and records which one this RTI
        // implements.
        //
        // It matters because a receiver assuming one length while this
        // sends the other reads Speed from MoveType's bytes - zero - and a
        // receiver honouring Speed = 0 literally will hold the entity
        // still: accepted, unmoved, nothing logged.
        byte[] encoded = encoder.fixedRecord(
                encoder.locationEl(VECTOR_LAT, VECTOR_LON, VECTOR_ALT),
                encoder.locationArrayEl(List.of()),
                encoder.int32El(0),
                encoder.float32El(30.0));

        assertTrue(encoded.length == 36 || encoded.length == 40,
                "MoveToLocationTaskStruct with an empty Path should be 36 or 40 bytes, was "
                        + encoded.length);

        // Speed is always the final four bytes, whichever reading applies.
        assertEquals(30.0f, ByteBuffer.wrap(encoded).getFloat(encoded.length - 4), 1e-6,
                "Speed is the last field");

        System.out.println("Wire contract vector C: this RTI encodes an empty LocationStructArray "
                + "such that MoveToLocationTaskStruct is " + encoded.length + " bytes (Speed at "
                + "offset " + (encoded.length - 4) + "). Keep the wire contract document in sync "
                + "with this reading.");
    }

    @Test
    void areaVariantEncodesDiscriminantThenPaddedAlternative() {
        byte[] circle = encoder.areaCircle(51.5, -0.12, 50);
        // 4-byte discriminant, padded to the alternative's 8-byte
        // boundary, then GeodeticLocation (16) + float32 (4). The RTI
        // encoder adds no trailing padding.
        assertEquals(4 + 4 + 16 + 4, circle.length);

        ByteBuffer buffer = ByteBuffer.wrap(circle);
        assertEquals(2, buffer.getInt(), "the Circle alternative is discriminant value 2");
        assertEquals(0, buffer.getInt(), "alignment padding");
        assertEquals(51.5, buffer.getDouble(), 1e-9);
        assertEquals(-0.12, buffer.getDouble(), 1e-9);
        assertEquals(50.0f, buffer.getFloat(), 1e-6);
    }
}