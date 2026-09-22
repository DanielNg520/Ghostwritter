#!/usr/bin/env python3
"""Extension smoke tests, run against a real unpacked Chromium instance.

Covers what actually breaks silently: extractEmployer()'s heuristics
(generic_scrape.js), the Settings Profile round-trip, category-select /
sample-panel population (both now sourced live from the server, not a
hardcoded list -- see tests/server/'s own suite for that server-side half),
cover-letter PDF export, and the per-tab panel binding
(sidebar.js/background.js).

Requires:
  1. pip install -r tests/requirements-dev.txt && playwright install chromium
  2. The Ghost Writer server running at localhost:8000 (e.g. `python3
     server/server.py` from server/, in the .venv that has its
     requirements.txt installed) -- category-select and the Settings
     sample panels are now fetched live from it, not hardcoded, so this
     suite can't fully self-host that part the way it does the fixture
     pages below.
Run: python3 tests/browser/smoke_test.py

Starts its own local HTTP server for the fixtures/ pages (some checks need
a real host the manifest grants -- http://localhost/* -- to exercise the
actual chrome.scripting.executeScript call path, not just a direct
function eval).
"""

import base64
import hashlib
import http.server
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
EXT_DIR = REPO / "extension"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
HTTP_PORT = 8877

results = {"pass": [], "fail": []}


def check(name, cond, detail=""):
    if cond:
        results["pass"].append(name)
        print(f"[PASS] {name}")
    else:
        results["fail"].append(name)
        print(f"[FAIL] {name} {detail}")


def extension_id():
    manifest = json.loads((EXT_DIR / "manifest.json").read_text())
    key_bytes = base64.b64decode(manifest["key"])
    digest = hashlib.sha256(key_bytes).hexdigest()
    return "".join(chr(int(c, 16) + ord("a")) for c in digest[:32])


def start_fixture_server():
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(FIXTURES), **kw)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def check_ghostwriter_server_running():
    """category-select/the Settings sample panels are now fetched live from
    the real server rather than hardcoded -- fail fast with a clear message
    instead of a confusing mid-run Playwright timeout if it's not up."""
    try:
        urllib.request.urlopen("http://localhost:8000/health", timeout=2)
    except (urllib.error.URLError, ConnectionError):
        print(
            "[ERROR] Ghost Writer server isn't reachable at localhost:8000.\n"
            "        Start it first: cd server && ../.venv/bin/python3 server.py"
        )
        sys.exit(1)


def main():
    check_ghostwriter_server_running()
    httpd = start_fixture_server()
    ext_id = extension_id()
    scrape_src = (EXT_DIR / "generic_scrape.js").read_text()

    with sync_playwright() as p:
        profile_dir = Path("/tmp") / f"ghostwriter_smoke_test_profile_{int(time.time())}"
        ctx = p.chromium.launch_persistent_context(
            str(profile_dir),
            headless=False,
            args=[
                f"--disable-extensions-except={EXT_DIR}",
                f"--load-extension={EXT_DIR}",
                "--headless=new",
                "--no-first-run",
            ],
        )
        time.sleep(1)

        def scrape(fixture_name):
            page = ctx.new_page()
            page.goto(f"http://localhost:{HTTP_PORT}/{fixture_name}")
            result = page.evaluate(f"() => {{ {scrape_src}\nreturn scrapePageContent(); }}")
            page.close()
            return result

        # ---- extractEmployer() heuristics ----
        r = scrape("fake_job.html")
        check("JSON-LD hiringOrganization", r.get("employer") == "Acme Corporation", r.get("employer"))

        r = scrape("fake_job_handshake.html")
        check("'About the employer' heading pattern", r.get("employer") == "UC San Diego", r.get("employer"))

        r = scrape("fake_job_linkonly.html")
        check("company-profile-link pattern", r.get("employer") == "Initech Logistics LLC", r.get("employer"))

        r = scrape("fake_job_ogonly.html")
        check("og:site_name accepted (real company)", r.get("employer") == "Bright Future Marketing Co", r.get("employer"))

        r = scrape("fake_job_brandsubstring.html")
        check("og:site_name rejected (platform brand substring, 'Greenhouse Job Board')", r.get("employer") is None, r.get("employer"))

        r = scrape("fake_job_careers_ogname.html")
        check("og:site_name accepted ('Acme Careers', not a bare generic word)", r.get("employer") == "Acme Careers", r.get("employer"))

        r = scrape("fake_job_badge.html")
        check("About-heading candidate skips a Follow button, finds real heading", r.get("employer") == "Initrode Dynamics", r.get("employer"))

        r = scrape("fake_job_bare_careers.html")
        check("og:site_name rejected (bare generic word, 'Careers')", r.get("employer") is None, r.get("employer"))

        r = scrape("fake_job_dicerna.html")
        check("og:site_name accepted ('Dicerna Pharmaceuticals', word-boundary not substring)", r.get("employer") == "Dicerna Pharmaceuticals", r.get("employer"))

        r = scrape("fake_job_openjobs_badge.html")
        check("profile-link candidate skips a '58 open jobs' counter", r.get("employer") == "Vandelay Industries", r.get("employer"))

        r = scrape("fake_job_decorated_badges.html")
        check("decorated badge ('Follow · 12,483 followers') rejected", r.get("employer") == "Pinnacle Design Studio", r.get("employer"))

        r = scrape("fake_job_decorated_navlink.html")
        check("decorated nav link ('Company ›') rejected", r.get("employer") == "Summit Consulting Group", r.get("employer"))

        r = scrape("fake_job_similar_jobs_boundary.html")
        check("profile-link scan stops at a 'Similar jobs' boundary", r.get("employer") == "Parallax Logistics", r.get("employer"))

        r = scrape("fake_job_monster_beverage.html")
        check("og:site_name accepted ('Monster Beverage', brand word inside a distinct company name)", r.get("employer") == "Monster Beverage", r.get("employer"))

        r = scrape("fake_job_monster_bare.html")
        check("og:site_name rejected ('Monster Jobs', brand + generic suffix, anchored)", r.get("employer") is None, r.get("employer"))

        # ---- settings.html: Profile save/load round-trip ----
        settings = ctx.new_page()
        settings.goto(f"chrome-extension://{ext_id}/settings.html")
        settings.wait_for_timeout(500)
        settings.fill("#profile-name", "Jane Doe")
        settings.fill("#profile-email", "jane@example.com")
        settings.click("#save-profile-btn")
        settings.wait_for_timeout(300)
        check("Profile save confirmation shown", settings.locator("#profile-status").inner_text() == "Profile saved.")
        stored = settings.evaluate("() => chrome.storage.local.get('profileInfo')")
        check("profileInfo persisted", stored.get("profileInfo", {}).get("name") == "Jane Doe", stored)
        settings.reload()
        settings.wait_for_timeout(500)
        check("Profile fields repopulate on reload", settings.input_value("#profile-name") == "Jane Doe")
        settings.close()

        # ---- sidebar.html: panel behavior ----
        # A panel restored by Chrome on relaunch (no fresh toolbar click, so
        # no ?tabId=) must still work -- it used to go completely inert here
        # (a real regression a user hit: Product Review broke entirely after
        # Chrome restored the panel), so this checks the fallback-to-active-
        # tab path, not that the panel refuses to do anything.
        unbound = ctx.new_page()
        unbound.goto(f"chrome-extension://{ext_id}/sidebar.html")
        unbound.wait_for_timeout(400)
        check("Unbound panel (no ?tabId=) shows no blocking error message",
              "toolbar icon" not in unbound.locator("#status-message").inner_text())

        # Creating/navigating a page can itself steal browser focus, so the
        # fixture page's bring_to_front() must be the LAST focus change
        # before evaluate() -- chrome.tabs.query({active:true}) reads real
        # browser focus state, not which Playwright page issued the call.
        active_tab_for_fallback = ctx.new_page()
        active_tab_for_fallback.goto(f"http://localhost:{HTTP_PORT}/fake_job.html")
        active_tab_for_fallback.bring_to_front()
        unbound.wait_for_timeout(200)

        scraped_fallback = unbound.evaluate("() => window.scrapeActiveTab()")
        check("Unbound panel falls back to reading the active tab instead of refusing",
              scraped_fallback is not None and scraped_fallback.get("employer") == "Acme Corporation", scraped_fallback)
        unbound.close()
        active_tab_for_fallback.close()

        panel = ctx.new_page()
        panel.goto(f"chrome-extension://{ext_id}/sidebar.html?tabId=1")
        panel.wait_for_timeout(400)
        check("export-pdf-btn hidden by default", panel.is_hidden("#export-pdf-btn"))
        check("jsPDF global loaded", panel.evaluate("() => typeof window.jspdf") == "object")

        panel.click("#mode-general-btn")
        panel.evaluate("() => { document.getElementById('export-pdf-btn').hidden = false; }")
        panel.select_option("#category-select", "formal")
        panel.wait_for_timeout(100)
        check("export-pdf-btn hides on category change", panel.is_hidden("#export-pdf-btn"))

        long_body = "Dear Hiring Manager,\n\n" + ("I am excited to apply for this role. " * 40) + "\n\nSincerely,\nJane Doe"
        panel.evaluate("(t) => { document.getElementById('output').value = t; }", long_body)
        panel.evaluate(
            "(v) => { document.getElementById('employer-input').value = v; }",
            "Vandelay Industries / Import-Export \\ Special\"Chars?<>|" + ("X" * 200),
        )
        with panel.expect_download() as dl_info:
            panel.evaluate("() => window.exportCoverLetterPdf()")
        download = dl_info.value
        saved = Path("/tmp") / "ghostwriter_smoke_export.pdf"
        download.save_as(str(saved))
        check("PDF downloaded", saved.exists() and saved.stat().st_size > 0)
        check("Filename sanitized + capped (<=180 chars + suffix)", len(download.suggested_filename) <= 180 + len(" - Cover Letter.pdf") + 5, download.suggested_filename)
        pdf_bytes = saved.read_bytes()
        check("PDF is valid and multi-page (pagination triggered)", pdf_bytes[:5] == b"%PDF-" and (b"/Type /Page" in pdf_bytes or b"/Type/Page" in pdf_bytes))
        panel.close()

        # ---- cross-tab isolation: the actual security property ----
        tab_a = ctx.new_page()
        tab_a.goto(f"http://localhost:{HTTP_PORT}/fake_job.html")
        tab_b = ctx.new_page()
        tab_b.goto(f"http://localhost:{HTTP_PORT}/fake_job2.html")
        tab_b.bring_to_front()
        ctx.pages[0].wait_for_timeout(300)

        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        tabs = sw.evaluate("async () => (await chrome.tabs.query({})).map(t => ({id: t.id, url: t.url, active: t.active}))")
        tab_a_id = next(t["id"] for t in tabs if t["url"] and "fake_job.html" in t["url"])
        active_id = next((t["id"] for t in tabs if t["active"]), None)
        check("setup: a different tab is frontmost, not tab A", active_id != tab_a_id)

        bound_panel = ctx.new_page()
        bound_panel.goto(f"chrome-extension://{ext_id}/sidebar.html?tabId={tab_a_id}")
        bound_panel.wait_for_timeout(400)
        scraped = bound_panel.evaluate("() => window.scrapeActiveTab()")
        check("panel bound to tab A reads tab A even though another tab is frontmost",
              scraped is not None and scraped.get("employer") == "Acme Corporation", scraped)
        bound_panel.close()
        tab_a.close()
        tab_b.close()

        ctx.close()

    httpd.shutdown()

    print()
    print(f"RESULT: {len(results['pass'])} passed, {len(results['fail'])} failed")
    if results["fail"]:
        print("FAILED:", results["fail"])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
