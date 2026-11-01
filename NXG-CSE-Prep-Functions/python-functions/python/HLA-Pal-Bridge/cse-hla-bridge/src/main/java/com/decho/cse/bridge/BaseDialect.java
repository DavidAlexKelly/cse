[main/java/com/decho/cse/bridge/BaseDialect.java]
package com.decho.cse.bridge;

import hla.rti1516e.InteractionClassHandle;
import hla.rti1516e.ParameterHandleValueMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

// Shared plumbing for the tasking dialects: encoder lifecycle, handle lookup
// and parameter-map construction.
abstract class BaseDialect implements TaskDialect {

    protected final Logger logger = LoggerFactory.getLogger(getClass());
    protected final BridgeFederate federate;
    protected final Identity identity;

    private volatile HlaEncoder encoder;

    protected BaseDialect(BridgeFederate federate, Identity identity) {
        this.federate = federate;
        this.identity = identity;
    }

    // Lazily creates the RTI encoder factory. Doing this on first use rather
    // than in the constructor means a classpath or RTI problem here does not
    // fail Spring startup and take the health/status endpoints down with it.
    protected HlaEncoder enc() throws Exception {
        HlaEncoder local = encoder;
        if (local == null) {
            synchronized (this) {
                local = encoder;
                if (local == null) {
                    local = new HlaEncoder();
                    encoder = local;
                }
            }
        }
        return local;
    }

    // Throws IllegalStateException if the class is not in the loaded FOM.
    protected InteractionClassHandle interaction(String className) {
        return federate.interaction(className);
    }

    protected ParameterHandleValueMap newParams(int capacity) throws Exception {
        return federate.newParameterMap(capacity);
    }

    // Sets a parameter the FOM marks Required. Fails loudly if it is missing.
    protected void put(ParameterHandleValueMap params,
                        InteractionClassHandle handle,
                        String parameter,
                        byte[] value) throws Exception {
        params.put(federate.parameter(handle, parameter), value);
    }

    // Sets a parameter the FOM marks Optional, skipping it if this FOM does
    // not define it. A federation may be assembled from a different set of
    // modules than the reference one, so an optional parameter may
    // legitimately be absent. Omitting it means "use the FOM's default"
    // rather than failing the whole task over a parameter that was never
    // required.
    protected void putOptional(ParameterHandleValueMap params,
                                InteractionClassHandle handle,
                                String parameter,
                                byte[] value) {
        try {
            params.put(federate.parameter(handle, parameter), value);
        } catch (Exception e) {
            logger.debug("Optional parameter {} not present in the loaded FOM, omitting: {}",
                    parameter, e.getMessage());
        }
    }

    protected void send(InteractionClassHandle handle, ParameterHandleValueMap params)
            throws Exception {
        federate.sendInteraction(handle, params);
    }
}