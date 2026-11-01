"""
Tests for the compressed ORBAT transport.

Run:
    cd python-functions/python && PYTHONPATH=. python3 tests/test_payload_codec.py
"""

import base64
import gzip
import json
import sys

from src.payload_codec import decode_gzip_base64, encode_gzip_base64


def test_round_trip_preserves_json() -> None:
    payload = {
        "operation": {"primaryKey": "OPERATION-BALTIC-SHIELD"},
        "units": [{"primaryKey": "UNIT-BSP1-BG-1YORKS", "unitIdentifier": "1 YORKS Battlegroup"}],
    }
    text = json.dumps(payload, separators=(",", ":"))
    assert json.loads(decode_gzip_base64(encode_gzip_base64(text))) == payload


def test_round_trip_preserves_non_ascii() -> None:
    # The hierarchy name uses an em dash, so a latin-1 assumption anywhere in
    # the encode/decode path would corrupt it rather than fail loudly.
    text = json.dumps({"name": "Baltic Shield \u2014 Phase 1 ORBAT"}, separators=(",", ":"))
    assert decode_gzip_base64(encode_gzip_base64(text)) == text


def test_encoding_is_quote_and_brace_free() -> None:
    # The whole point: the encoded form must carry no character that an
    # intermediary would have to escape.
    encoded = encode_gzip_base64(json.dumps({"a": ["b", {"c": 1}]}))
    for forbidden in ('"', "{", "}", "[", "]", "\\", "-", "_"):
        assert forbidden not in encoded, f"{forbidden!r} leaked into the payload"


def test_encoding_is_deterministic() -> None:
    text = json.dumps({"operation": {"primaryKey": "OP-X"}})
    assert encode_gzip_base64(text) == encode_gzip_base64(text)


def test_compresses_repetitive_orbat_substantially() -> None:
    # A real ORBAT is extremely repetitive (the same keys and date strings on
    # every unit), which is what makes this transport worth having at all.
    units = [
        {
            "primaryKey": f"UNIT-BSP1-A-{i}",
            "unitIdentifier": f"A Coy Warrior {i}",
            "entityType": "vehicle",
            "owningSimulator": "vbs4",
            "dis": "1.1.224.2.8.0",
            "sidc": "SFGPEVA--------",
            "affiliation": "Friend",
            "allegiance": "GBR",
            "militaryService": "Army",
        }
        for i in range(60)
    ]
    text = json.dumps({"operation": {"primaryKey": "OP-X"}, "units": units}, separators=(",", ":"))
    encoded = encode_gzip_base64(text)
    assert len(encoded) < len(text) / 4, f"only got {len(text)} -> {len(encoded)}"


def test_rejects_urlsafe_base64_with_named_reason() -> None:
    # urlsafe base64 is the most likely thing a caller reaches for, and it
    # silently differs only in two characters, so the error must name it.
    raw = gzip.compress(b'{"operation":{"primaryKey":"OP-X"}}' * 40, mtime=0)
    urlsafe = base64.urlsafe_b64encode(raw).decode("ascii")
    if urlsafe == base64.b64encode(raw).decode("ascii"):
        # No '+' or '/' in this particular ciphertext, so there is nothing to test.
        return
    try:
        decode_gzip_base64(urlsafe)
    except ValueError as exc:
        assert "urlsafe" in str(exc)
    else:
        raise AssertionError("urlsafe base64 was accepted")


def test_rejects_uncompressed_base64_with_named_reason() -> None:
    text = json.dumps({"operation": {"primaryKey": "OP-X"}})
    not_gzipped = base64.b64encode(text.encode("utf-8")).decode("ascii")
    try:
        decode_gzip_base64(not_gzipped)
    except ValueError as exc:
        assert "not base64(json)" in str(exc)
    else:
        raise AssertionError("uncompressed payload was accepted")


def test_rejects_outright_garbage() -> None:
    try:
        decode_gzip_base64("this is not base64 at all!!")
    except ValueError as exc:
        assert "base64" in str(exc)
    else:
        raise AssertionError("garbage was accepted")


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL {name}: {type(exc).__name__}: {exc}")
    print("\nall passed" if not failures else f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
