[main/java/com/decho/cse/bridge/model/request/AltitudeRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /entities/{id}/altitude.
//
// altitudeMeters: relative to mean sea level. The v2-era task also has an
// AltitudeType enumeration for the reference datum; the bridge omits it so
// the receiver's default applies, rather than guessing an enumerator whose
// meaning it cannot verify.
public record AltitudeRequest(double altitudeMeters) {}