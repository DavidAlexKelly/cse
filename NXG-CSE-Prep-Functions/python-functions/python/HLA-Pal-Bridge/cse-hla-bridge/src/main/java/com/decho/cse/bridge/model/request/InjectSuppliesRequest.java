package com.decho.cse.bridge.model.request;

// Body of POST /entities/{id}/inject-supplies.
//
// resourceType names the supply class (see TaskEnums); supplyType is an
// optional finer-grained name passed through to the dialect. quantity
// defaults to 100 when absent.
public record InjectSuppliesRequest(
        String resourceType,
        String supplyType,
        Double quantity
) {}
