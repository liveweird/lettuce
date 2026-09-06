#!/usr/bin/env python3
"""Compare protected CHECK/index exports with only the observed PG18 cast rewrite."""

import argparse
from pathlib import Path
import re
import sys


LITERAL = r"'[A-Z_]+'"
VARCHAR = LITERAL + r"::character varying"
ARRAY_FORMS = (
    re.compile(r"\(ARRAY\[(" + VARCHAR + r"(?:, " + VARCHAR + r")*)\]\)::text\[\]"),
    re.compile(r"ARRAY\[(" + VARCHAR + r"(?:, " + VARCHAR + r")*)\]::text\[\]"),
    re.compile(r"ARRAY\[(" + VARCHAR + r"::text(?:, " + VARCHAR + r"::text)*)\]"),
    re.compile(r"ARRAY\[(\(" + VARCHAR + r"\)::text(?:, \(" + VARCHAR + r"\)::text)*)\]"),
)


def normalize(definition):
    """Preserve all other text, including predicates, keys, values, and operators."""
    output = []
    changes = 0
    position = 0
    while position < len(definition):
        char = definition[position]
        if char in ("'", '"'):
            # A cast-shaped substring inside a literal or quoted identifier is not SQL.
            start = position
            escaped_string = char == "'" and position > 0 and definition[position - 1] in "eE"
            position += 1
            while position < len(definition):
                if escaped_string and definition[position] == "\\":
                    position += 2
                elif definition[position] == char:
                    position += 1
                    if position < len(definition) and definition[position] == char:
                        position += 1
                    else:
                        break
                else:
                    position += 1
            else:
                raise ValueError("unterminated quoted token in definition")
            output.append(definition[start:position])
            continue
        # In f(ARRAY[...])::text[], the parentheses belong to a function call, not
        # to a lossless cast of the literal array. Do not consume that call boundary.
        boundary = position == 0 or not (definition[position - 1].isalnum() or definition[position - 1] in "_$")
        match = next((p.match(definition, position) for p in ARRAY_FORMS if p.match(definition, position)), None) if boundary else None
        if match:
            output.append("ARRAY[" + ", ".join(value + "::text" for value in re.findall(LITERAL, match[1])) + "]")
            changes += 1
            position = match.end()
        else:
            output.append(char)
            position += 1
    return "".join(output), changes


def read_definitions(path, kind):
    prefixes = ("CHECK (",) if kind == "checks" else ("CREATE INDEX ", "CREATE UNIQUE INDEX ")
    definitions = {}
    changes = 0
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        parts = line.split("|", 3)
        if len(parts) != 4 or not all(parts[:3]) or not parts[3].startswith(prefixes):
            raise ValueError(f"invalid {kind} export at line {line_number}")
        key = tuple(parts[:3])
        if key in definitions:
            raise ValueError(f"duplicate {kind} identity at line {line_number}")
        definitions[key], count = normalize(parts[3])
        changes += count
    if not definitions:
        raise ValueError(f"empty {kind} export")
    return definitions, changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("checks", "indexes"))
    parser.add_argument("source", type=Path)
    parser.add_argument("restored", type=Path)
    args = parser.parse_args()
    try:
        source, source_changes = read_definitions(args.source, args.kind)
        restored, restored_changes = read_definitions(args.restored, args.kind)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"Cannot compare definitions: {error}", file=sys.stderr)
        return 2
    if source != restored:
        print(f"FAIL: {args.kind} definitions differ; inspect protected exports.", file=sys.stderr)
        return 1
    print(
        f"PASS: {len(source)} {args.kind} definitions; "
        f"normalized {source_changes}/{restored_changes} explicit varchar-to-text arrays."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
