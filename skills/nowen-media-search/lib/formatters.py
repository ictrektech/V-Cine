"""TOON format encoder.

TOON is a compact structured text format for LLM consumption,
saving 30-60% tokens compared to JSON.

Spec: https://github.com/toon-format/toon-python
"""


def encode(data, indent=0) -> str:
    """Encode a dict (or list of dicts) to TOON format string."""
    lines = []
    _encode_value(data, lines, indent)
    return "\n".join(lines)


def _encode_value(value, lines, indent=0):
    prefix = "  " * indent

    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, list):
                # Array field: key[count,]{fields}:
                item_fields = []
                if v and isinstance(v[0], dict):
                    item_fields = list(v[0].keys())
                fields_str = ",".join(item_fields) if item_fields else ""
                lines.append(f"{prefix}{k}[{len(v)},{{{fields_str}}}]:")
                for item in v:
                    _encode_value(item, lines, indent + 1)
            elif isinstance(v, dict):
                lines.append(f"{prefix}{k}:")
                _encode_value(v, lines, indent + 1)
            else:
                v_str = _format_scalar(v)
                lines.append(f"{prefix}{k}: {v_str}")

    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                vals = [_format_scalar(item.get(f)) for f in item]
                lines.append(f"{prefix}{','.join(vals)}")
            else:
                lines.append(f"{prefix}{_format_scalar(item)}")


def _format_scalar(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    # Quote if contains comma, quote, whitespace edges, or is empty
    if not s or "," in s or '"' in s or s[0] in ' \t"' or s[-1] in ' \t"':
        s = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{s}"'
    return s
