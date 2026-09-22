"""Behavioral tests for server.py's job runners (_run_review_job()/
_run_writing_job(), both built on the shared _run_generation_job()) --
calls them directly (plain functions, no need for FastAPI's request
machinery/httpx) with mocked generate/score calls.

Run: python3 -m unittest discover -s tests/server -v
(from the repo root, or `cd tests/server && python3 -m unittest -v`)
"""
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))

import server as srv
import review_engine as gw


def make_review_request(**overrides):
    defaults = dict(
        product_title="Widget X", product_details="A fine widget", user_comment="",
        provider="agy", api_key="", model="", endpoint="",
    )
    defaults.update(overrides)
    return types.SimpleNamespace(**defaults)


def make_writing_request(**overrides):
    defaults = dict(
        page_title="Some Job", page_text="job description text", user_prompt="write a cover letter",
        category="cover_letter", provider="agy", api_key="", model="", endpoint="",
    )
    defaults.update(overrides)
    return types.SimpleNamespace(**defaults)


class TestReviewJob(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.job_id = "job-1"
        srv.jobs[self.job_id] = {"stage": "writing", "attempt": 0, "done": False, "result": None, "error": None, "status_code": None}

    def tearDown(self):
        srv.jobs.pop(self.job_id, None)
        self.tmpdir.cleanup()

    def test_review_job_success_writes_file_and_result(self):
        with patch.object(gw, "REVIEW_DIR", self.tmpdir.name), \
             patch("server.gw.generate_review_text", return_value="Great product, five stars!") as gen, \
             patch("server.gw.ai_score", return_value=5) as score:
            srv._run_review_job(self.job_id, make_review_request())

        job = srv.jobs[self.job_id]
        self.assertTrue(job["done"])
        self.assertIsNone(job["error"])
        self.assertEqual(job["result"]["review"], "Great product, five stars!")
        self.assertEqual(job["result"]["ai_score"], 5)
        self.assertIsNone(job["result"]["provider_warning"])
        files = os.listdir(self.tmpdir.name)
        self.assertEqual(files, ["Widget X.txt"])
        with open(os.path.join(self.tmpdir.name, "Widget X.txt")) as f:
            self.assertEqual(f.read(), "Great product, five stars!")

    def test_review_job_refine_loop_runs_until_score_drops(self):
        scores = iter([80, 60, 10])
        with patch.object(gw, "REVIEW_DIR", self.tmpdir.name), \
             patch("server.gw.generate_review_text", return_value="text"), \
             patch("server.gw.ai_score", side_effect=lambda *a, **k: next(scores)) as score:
            srv._run_review_job(self.job_id, make_review_request())
        job = srv.jobs[self.job_id]
        self.assertTrue(job["done"])
        self.assertEqual(job["result"]["ai_score"], 10)
        self.assertEqual(score.call_count, 3)

    def test_review_job_provider_call_error_sets_502(self):
        with patch.object(gw, "REVIEW_DIR", self.tmpdir.name), \
             patch("server.gw.generate_review_text", side_effect=gw.ProviderCallError("openrouter call failed: boom")):
            srv._run_review_job(self.job_id, make_review_request(provider="openrouter", api_key="k", model="m"))
        job = srv.jobs[self.job_id]
        self.assertTrue(job["done"])
        self.assertEqual(job["status_code"], 502)
        self.assertIn("boom", job["error"])

    def test_review_job_empty_output_sets_502(self):
        with patch.object(gw, "REVIEW_DIR", self.tmpdir.name), \
             patch("server.gw.generate_review_text", return_value=""):
            srv._run_review_job(self.job_id, make_review_request())
        job = srv.jobs[self.job_id]
        self.assertTrue(job["done"])
        self.assertEqual(job["status_code"], 502)
        self.assertEqual(job["error"], "No output from agy")

    def test_review_job_unconfigured_external_provider_warns(self):
        with patch.object(gw, "REVIEW_DIR", self.tmpdir.name), \
             patch("server.gw.generate_review_text", return_value="text"), \
             patch("server.gw.ai_score", return_value=5):
            srv._run_review_job(self.job_id, make_review_request(provider="local"))
        job = srv.jobs[self.job_id]
        self.assertIn("local model selected", job["result"]["provider_warning"])


class TestWritingJob(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.job_id = "job-2"
        srv.jobs[self.job_id] = {"stage": "writing", "attempt": 0, "done": False, "result": None, "error": None, "status_code": None}

    def tearDown(self):
        srv.jobs.pop(self.job_id, None)
        self.tmpdir.cleanup()

    def test_writing_job_success_uses_writing_dir_and_result_key(self):
        with patch.object(gw, "WRITING_DIR", self.tmpdir.name), \
             patch("server.gw.generate_review_text", return_value="Dear Hiring Manager...") as gen, \
             patch("server.gw.ai_score", return_value=8):
            srv._run_writing_job(self.job_id, make_writing_request())

        job = srv.jobs[self.job_id]
        self.assertTrue(job["done"])
        self.assertEqual(job["result"]["writing"], "Dear Hiring Manager...")
        self.assertNotIn("review", job["result"])
        files = os.listdir(self.tmpdir.name)
        self.assertEqual(files, ["write a cover letter.txt"])
        # confirm samples were read from the *request's* category, not a fixed one
        call_args = gen.call_args
        prompt_sent = call_args[0][0]
        self.assertIn("cover_letter", prompt_sent)

    def test_writing_job_falls_back_to_page_title_slug_when_no_prompt(self):
        with patch.object(gw, "WRITING_DIR", self.tmpdir.name), \
             patch("server.gw.generate_review_text", return_value="text"), \
             patch("server.gw.ai_score", return_value=5):
            srv._run_writing_job(self.job_id, make_writing_request(user_prompt=""))
        files = os.listdir(self.tmpdir.name)
        self.assertEqual(files, ["Some Job.txt"])

    def test_writing_job_and_review_job_dont_cross_contaminate_categories(self):
        # regression check for the consolidation: samples_category must come
        # from the per-mode closure (request.category for writing, the fixed
        # string "review" for review), not get mixed up between the two.
        with patch.object(gw, "REVIEW_DIR", self.tmpdir.name), \
             patch.object(gw, "WRITING_DIR", self.tmpdir.name), \
             patch("server.gw.read_samples") as read_samples, \
             patch("server.gw.generate_review_text", return_value="text"), \
             patch("server.gw.ai_score", return_value=5), \
             patch("server.gw.provider_configured", return_value=True):
            srv._run_review_job("job-review", make_review_request())
            srv._run_writing_job("job-writing", make_writing_request(category="academic"))
        calls = [c.args[0] for c in read_samples.call_args_list]
        self.assertEqual(calls, ["review", "academic"])
        srv.jobs.pop("job-review", None)
        srv.jobs.pop("job-writing", None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
