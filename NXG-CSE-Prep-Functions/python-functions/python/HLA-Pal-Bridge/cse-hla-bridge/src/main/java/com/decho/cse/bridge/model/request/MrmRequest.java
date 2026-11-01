[main/java/com/decho/cse/bridge/model/request/MrmRequest.java]
package com.decho.cse.bridge.model.request;

// Optional body of POST /entities/{id}/aggregate and /disaggregate.
//
// federate: name of the federate with modelling responsibility for the
// unit (required by the v2-era FOM). Falls back to a configured default
// when omitted.
// removeSubunits: aggregate only, removes the disaggregated subunits.
public record MrmRequest(
        String federate,
        Boolean removeSubunits
) {}