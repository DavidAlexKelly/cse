"""
Compressed transport for ORBAT payloads that are too large to pass as raw JSON.

An ORBAT of any realistic size does not survive being passed as a raw JSON
string in an Action parameter: a 59-unit battlegroup is already ~23KB of JSON
and a 250-unit ORBAT is ~100KB, which runs into Action parameter size limits
and, for tool and agent callers, escaping limits on the several hundred quote
characters involved.

gzip takes a highly repetitive ORBAT down by roughly an order of magnitude, and
standard base64 is plain [A-Za-z0-9+/=] - no quotes, no braces, no hyphens - so
the payload becomes a few KB of inert text that passes through intermediaries
untouched.

This module is deliberately dependency-free and lives in src/ rather than in
python_functions/ so it can be unit tested without the generated Ontology SDK.
"""

import base64
import binascii
import gzip

__all__ = ["encode_gzip_base64", "decode_gzip_base64"]


def encode_gzip_base64(json_text: str) -> str:
    """
    Encode a JSON string as base64(gzip(utf-8 json)).

    mtime=0 so the same ORBAT always encodes to the same string; otherwise the
    gzip header timestamp makes byte-identical payloads compare unequal, which
    would defeat any caching or change detection a caller layers on top.
    """
    compressed = gzip.compress(json_text.encode("utf-8"), mtime=0)
    return base64.b64encode(compressed).decode("ascii")


def decode_gzip_base64(payload: str) -> str:
    """
    Reverse encode_gzip_base64, raising ValueError with an actionable message.

    The two ways callers get this wrong are sending urlsafe base64 (which swaps
    '+/' for '-_') and sending base64(json) without the gzip step, so each is
    called out by name rather than surfacing a raw binascii/OSError.
    """
    try:
        compressed = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(
            "payload is not valid standard base64. Expected base64(gzip(json)). "
            "Note that urlsafe base64 ('-' and '_' instead of '+' and '/') is "
            f"not accepted. Underlying error: {exc}"
        ) from exc

    try:
        return gzip.decompress(compressed).decode("utf-8")
    except (OSError, EOFError, UnicodeDecodeError) as exc:
        raise ValueError(
            "payload decoded from base64 but is not gzipped UTF-8 JSON. Send "
            f"base64(gzip(json)), not base64(json). Underlying error: {exc}"
        ) from exc
