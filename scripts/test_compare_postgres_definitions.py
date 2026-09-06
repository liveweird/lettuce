import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from compare_postgres_definitions import normalize


SCRIPT = Path(__file__).with_name("compare_postgres_definitions.py")
CHECK = "CHECK (status::text = ANY (ARRAY['OPEN'::character varying, 'CLOSED'::character varying]::text[]))"
CHECK_RESTORED = "CHECK (status::text = ANY (ARRAY['OPEN'::character varying::text, 'CLOSED'::character varying::text]))"
INDEX = "CREATE UNIQUE INDEX only_open ON public.plans USING btree ((1)) WHERE ((status::text = ANY ((ARRAY['OPEN'::character varying])::text[])) AND (marked_as_deleted = false))"
INDEX_RESTORED = "CREATE UNIQUE INDEX only_open ON public.plans USING btree ((1)) WHERE ((status::text = ANY (ARRAY[('OPEN'::character varying)::text])) AND (marked_as_deleted = false))"


class DefinitionComparisonTest(unittest.TestCase):
    def compare(self, kind, source, restored):
        with tempfile.TemporaryDirectory(prefix="lettuce-definition-test-") as directory:
            before, after = Path(directory, "source"), Path(directory, "restored")
            before.write_text(source)
            after.write_text(restored)
            return subprocess.run(
                [sys.executable, str(SCRIPT), kind, str(before), str(after)],
                capture_output=True, text=True, check=False,
            )

    def row(self, definition):
        return "public|plans|constraint_or_index|" + definition + "\n"

    def test_accepts_only_observed_lossless_array_cast_shapes(self):
        self.assertEqual(normalize(CHECK)[0], normalize(CHECK_RESTORED)[0])
        self.assertEqual(normalize(INDEX)[0], normalize(INDEX_RESTORED)[0])
        self.assertEqual(self.compare("checks", self.row(CHECK), self.row(CHECK_RESTORED)).returncode, 0)
        self.assertEqual(self.compare("indexes", self.row(INDEX), self.row(INDEX_RESTORED)).returncode, 0)

    def test_rejects_changed_allowed_value(self):
        result = self.compare("checks", self.row(CHECK), self.row(CHECK_RESTORED.replace("CLOSED", "DRAFT")))
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("DRAFT", result.stderr)

    def test_rejects_missing_soft_delete_predicate(self):
        changed = INDEX_RESTORED.replace(" AND (marked_as_deleted = false)", "")
        self.assertEqual(self.compare("indexes", self.row(INDEX), self.row(changed)).returncode, 1)

    def test_rejects_changed_constant_expression_index(self):
        self.assertEqual(self.compare("indexes", self.row(INDEX), self.row(INDEX_RESTORED.replace("((1))", "((2))"))).returncode, 1)

    def test_rejects_changed_constraint_operator(self):
        self.assertEqual(self.compare("checks", self.row("CHECK (amount >= 0)"), self.row("CHECK (amount > 0)")).returncode, 1)

    def test_does_not_strip_arbitrary_or_bounded_casts(self):
        for definition in ("CHECK (amount::numeric = 1)", CHECK.replace("character varying", "character varying(5)")):
            self.assertEqual(normalize(definition), (definition, 0))

    def test_does_not_normalize_quoted_identifiers_or_string_contents(self):
        for definition in (
            "CHECK (\"ARRAY['OPEN'::character varying]::text[]\" IS NOT NULL)",
            "CHECK (label = 'ARRAY[''OPEN''::character varying]::text[]')",
        ):
            self.assertEqual(normalize(definition), (definition, 0))

    def test_does_not_move_cast_across_a_function_call(self):
        definition = "CHECK (transform(ARRAY['OPEN'::character varying])::text[] IS NOT NULL)"
        self.assertEqual(normalize(definition), (definition, 0))

    def test_rejects_missing_object(self):
        source = self.row(CHECK) + "public|plans|second_check|CHECK (amount >= 0)\n"
        self.assertEqual(self.compare("checks", source, self.row(CHECK_RESTORED)).returncode, 1)

    def test_rejects_empty_malformed_or_duplicate_exports(self):
        for value in ("", "incomplete\n", self.row(CHECK) * 2):
            self.assertEqual(self.compare("checks", value, value).returncode, 2)


if __name__ == "__main__":
    unittest.main()
