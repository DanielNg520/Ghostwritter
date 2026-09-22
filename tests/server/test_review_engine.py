"""Behavioral tests for review_engine.py/secrets_loader.py's shared helpers
(cli_path.resolve_cli_path(), the call_openrouter/call_groq/call_local
chat-completions shape, generate_review_text()/ai_score()'s provider
dispatch, unique_review_path()/unique_writing_path()) -- mocks subprocess/
requests so it runs without agy/claude/sops/real API keys installed.

Run: python3 -m unittest discover -s tests/server -v
(from the repo root, or `cd tests/server && python3 -m unittest -v`)
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))

import review_engine as gw


class FakeResponse:
    def __init__(self, json_data, status=200):
        self._json = json_data
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._json


class TestCliPathResolution(unittest.TestCase):
    def test_resolve_cli_path_found_on_path(self):
        from cli_path import resolve_cli_path
        with patch("cli_path.shutil.which", return_value="/usr/bin/foo"):
            self.assertEqual(resolve_cli_path("foo"), "/usr/bin/foo")

    def test_resolve_cli_path_fallback(self):
        from cli_path import resolve_cli_path
        with patch("cli_path.shutil.which", return_value=None), \
             patch("cli_path.os.path.isfile", side_effect=lambda p: p == "/opt/homebrew/bin/foo"):
            self.assertEqual(resolve_cli_path("foo"), "/opt/homebrew/bin/foo")

    def test_resolve_cli_path_gives_up(self):
        from cli_path import resolve_cli_path
        with patch("cli_path.shutil.which", return_value=None), \
             patch("cli_path.os.path.isfile", return_value=False):
            self.assertEqual(resolve_cli_path("foo"), "foo")


class TestCallProviders(unittest.TestCase):
    def test_call_openrouter_success(self):
        fake = FakeResponse({"choices": [{"message": {"content": " hello "}}]})
        with patch("review_engine.requests.post", return_value=fake) as post:
            result = gw.call_openrouter("prompt", "key123", "model-x")
            self.assertEqual(result, "hello")
            args, kwargs = post.call_args
            self.assertEqual(args[0], "https://openrouter.ai/api/v1/chat/completions")
            self.assertEqual(kwargs["headers"]["Authorization"], "Bearer key123")

    def test_call_groq_success(self):
        fake = FakeResponse({"choices": [{"message": {"content": "groq reply"}}]})
        with patch("review_engine.requests.post", return_value=fake) as post:
            result = gw.call_groq("prompt", "key456", "model-y")
            self.assertEqual(result, "groq reply")
            args, kwargs = post.call_args
            self.assertEqual(args[0], "https://api.groq.com/openai/v1/chat/completions")

    def test_call_local_with_and_without_key(self):
        fake = FakeResponse({"choices": [{"message": {"content": "local reply"}}]})
        with patch("review_engine.requests.post", return_value=fake) as post:
            gw.call_local("prompt", "http://localhost:1234/v1/chat/completions", "m", api_key="abc")
            _, kwargs = post.call_args
            self.assertEqual(kwargs["headers"]["Authorization"], "Bearer abc")
        with patch("review_engine.requests.post", return_value=fake) as post:
            gw.call_local("prompt", "http://localhost:1234/v1/chat/completions", "m")
            _, kwargs = post.call_args
            self.assertNotIn("Authorization", kwargs["headers"])

    def test_call_openrouter_no_choices_raises(self):
        fake = FakeResponse({"choices": []})
        with patch("review_engine.requests.post", return_value=fake):
            with self.assertRaises(RuntimeError) as ctx:
                gw.call_openrouter("p", "k", "m")
            self.assertIn("OpenRouter", str(ctx.exception))

    def test_call_groq_empty_content_raises(self):
        fake = FakeResponse({"choices": [{"message": {"content": ""}}]})
        with patch("review_engine.requests.post", return_value=fake):
            with self.assertRaises(RuntimeError) as ctx:
                gw.call_groq("p", "k", "m")
            self.assertIn("Groq", str(ctx.exception))


class TestProviderDispatch(unittest.TestCase):
    def test_generate_review_text_claude_code(self):
        with patch("review_engine.run_claude_code", return_value="claude says hi") as m:
            result = gw.generate_review_text("prompt", "claude_code", "", "", "")
            self.assertEqual(result, "claude says hi")
            m.assert_called_once_with("prompt")

    def test_generate_review_text_openrouter_configured(self):
        with patch("review_engine.call_openrouter", return_value="or reply") as m:
            result = gw.generate_review_text("prompt", "openrouter", "key", "model", "")
            self.assertEqual(result, "or reply")
            m.assert_called_once_with("prompt", "key", "model")

    def test_generate_review_text_openrouter_unconfigured_falls_to_agy(self):
        with patch("review_engine.run_agy", return_value="agy reply") as m:
            result = gw.generate_review_text("prompt", "openrouter", "", "", "")
            self.assertEqual(result, "agy reply")
            m.assert_called_once_with("prompt")

    def test_generate_review_text_provider_failure_raises_providercallerror(self):
        with patch("review_engine.call_groq", side_effect=RuntimeError("boom")):
            with self.assertRaises(gw.ProviderCallError):
                gw.generate_review_text("prompt", "groq", "key", "model", "")

    def test_generate_review_text_agy_default(self):
        with patch("review_engine.run_agy", return_value="agy default") as m:
            result = gw.generate_review_text("prompt", "agy", "", "", "")
            self.assertEqual(result, "agy default")
            m.assert_called_once_with("prompt")

    def test_ai_score_uses_low_effort_agy_by_default(self):
        with patch("review_engine.run_agy", return_value="42") as m:
            score = gw.ai_score("some text")
            self.assertEqual(score, 42)
            m.assert_called_once()
            args, kwargs = m.call_args
            self.assertEqual(kwargs.get("effort"), "low")

    def test_ai_score_uses_configured_provider(self):
        with patch("review_engine.call_openrouter", return_value="17") as m:
            score = gw.ai_score("some text", provider="openrouter", api_key="k", model="m")
            self.assertEqual(score, 17)
            m.assert_called_once_with("Rate the probability that the following text was written by an AI. Output ONLY a single integer from 0 (definitely human) to 100 (definitely AI). No explanation.\n\nText:\nsome text", "k", "m")

    def test_ai_score_failure_returns_zero(self):
        with patch("review_engine.run_agy", side_effect=RuntimeError("agy crashed")):
            score = gw.ai_score("some text")
            self.assertEqual(score, 0)

    def test_ai_score_unparseable_defaults_to_100(self):
        with patch("review_engine.run_agy", return_value="not a number"):
            score = gw.ai_score("some text")
            self.assertEqual(score, 100)


class TestUniquePath(unittest.TestCase):
    def test_unique_review_path_no_collision(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(gw, "REVIEW_DIR", d):
                path = gw.unique_review_path("My Product")
                self.assertEqual(path, os.path.join(d, "My Product.txt"))

    def test_unique_review_path_collision_increments(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(gw, "REVIEW_DIR", d):
                open(os.path.join(d, "My Product.txt"), "w").close()
                path = gw.unique_review_path("My Product")
                self.assertEqual(path, os.path.join(d, "My Product (2).txt"))

    def test_unique_writing_path_truncates_and_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(gw, "WRITING_DIR", d):
                path = gw.unique_writing_path("")
                self.assertEqual(path, os.path.join(d, "untitled.txt"))
                long_slug = "x" * 200
                path2 = gw.unique_writing_path(long_slug)
                base = os.path.basename(path2)
                self.assertLessEqual(len(base), len("x" * 80) + len(".txt"))


class TestListSampleCategories(unittest.TestCase):
    # extension/settings.js and sidebar.js both derive their category
    # list/order from this via GET /samples -- a plain sorted() here
    # silently regressed the intended display order once already.
    def test_returns_categories_in_sample_categories_declared_order(self):
        with tempfile.TemporaryDirectory() as d:
            # Create dirs in a DIFFERENT order than SAMPLE_CATEGORIES
            # declares, to prove the result isn't just os.listdir() order
            # or alphabetical order.
            for name in ["review", "formal", "cover_letter", "academic"]:
                os.makedirs(os.path.join(d, name))
            with patch.object(gw, "SAMPLE_DIR", d):
                result = gw.list_sample_categories()
        expected = [c for c in gw.SAMPLE_CATEGORIES if c in {"review", "formal", "cover_letter", "academic"}]
        self.assertEqual(result, expected)
        self.assertNotEqual(result, sorted(result), "would coincidentally pass if still alphabetical")

    def test_unlisted_directory_sorts_after_known_categories(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ["formal", "zzz_custom", "academic"]:
                os.makedirs(os.path.join(d, name))
            with patch.object(gw, "SAMPLE_DIR", d):
                result = gw.list_sample_categories()
        self.assertEqual(result, ["formal", "academic", "zzz_custom"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
