// Generic page scraper for "General Writer" mode. Works on any site.
//
// This is injected via chrome.scripting.executeScript({ func: scrapePageContent })
// rather than being registered as a static content script, so it only needs the
// "activeTab" permission (already granted) instead of broad host_permissions.
//
// IMPORTANT: chrome.scripting requires the injected function to be fully
// self-contained (no references to outer closures/variables) since it is
// serialized and executed in the page's context. Keep this a pure function
// (nested helper functions declared inside it are fine).
function scrapePageContent() {
  // Job boards/ATSes we recognize by hostname. Not exhaustive — the
  // keyword-scored fallback below (findByKeywordScore) handles job sites
  // that aren't in this list, or whose markup doesn't match JOB_SELECTORS.
  const JOB_SITE_HOSTS = [
    "linkedin.com", "joinhandshake.com", "indeed.com", "glassdoor.com",
    "greenhouse.io", "lever.co", "myworkdayjobs.com", "ziprecruiter.com",
    "wellfound.com", "ashbyhq.com", "smartrecruiters.com", "icims.com",
    "taleo.net", "simplify.jobs", "monster.com", "dice.com",
  ];
  const isJobSite = JOB_SITE_HOSTS.some(
    (host) => location.hostname === host || location.hostname.endsWith("." + host)
  );

  // Known description containers for the sites above, tried in order.
  // These selectors drift as sites redesign, so this is a best-effort
  // shortlist, not a registry to keep perfectly in sync.
  const JOB_SELECTORS = [
    "#job-details", ".jobs-description__content", ".jobs-box__html-content", // LinkedIn
    "[data-hook='job-description']", ".job-description",                     // Handshake / generic
    "#jobDescriptionText",                                                    // Indeed
    ".job__description", ".job-post",                                        // Greenhouse
    ".posting-description", ".section-wrapper",                              // Lever
    "[data-automation-id='jobPostingDescription']",                          // Workday
    ".job-sections",                                                         // SmartRecruiters
  ];

  const JOB_KEYWORDS = /responsibilities|requirements|qualifications|about the role|about this role|what you.?ll do|who you are|preferred qualifications|minimum qualifications|job description/gi;

  function cleanText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("script, style, nav, header, footer, noscript, button, svg, form").forEach((n) => n.remove());
    // clone is detached, so `.innerText` always returns "" here in Chrome —
    // use `.textContent` and collapse whitespace ourselves instead.
    const raw = clone.textContent || "";
    return raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function findBySelectors() {
    for (const sel of JOB_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) return el;
    }
    return null;
  }

  // Falls back to whichever element looks most like the actual job
  // description: highest density of job-posting keywords among
  // candidates with substantial (but not whole-page) text, so nav/sidebar/
  // related-jobs chrome loses to the real description block.
  function findByKeywordScore() {
    const candidates = Array.from(document.querySelectorAll("main, article, section, div"))
      .filter((el) => {
        const len = el.textContent.length;
        return len > 300 && len < 50000 && el.children.length < 200;
      });

    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      const text = el.textContent;
      const matches = text.match(JOB_KEYWORDS);
      const score = (matches ? matches.length : 0) * 1000 + Math.min(text.length, 5000);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return bestScore > 0 ? best : null;
  }

  const title = document.title;

  if (isJobSite) {
    const jobEl = findBySelectors() || findByKeywordScore();
    if (jobEl) {
      return { title, text: cleanText(jobEl).slice(0, 20000), siteType: "job" };
    }
  }

  const source =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  return { title, text: cleanText(source).slice(0, 20000), siteType: isJobSite ? "job" : "general" };
}
