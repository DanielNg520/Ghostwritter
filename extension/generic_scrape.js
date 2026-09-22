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
  // related-jobs chrome loses to the real description block. minMatches
  // gates false positives: most ATS-powered postings today live on the
  // company's own domain (stripe.com/careers/..., not boards.greenhouse.io),
  // so this runs on ANY site, not just JOB_SITE_HOSTS — a higher bar is
  // needed there than on a host we already know is a job board, since an
  // unrelated page can mention one of these terms once in passing.
  function findByKeywordScore(minMatches) {
    // Cheap single-pass gate before the expensive part: this runs on any
    // page now (not just JOB_SITE_HOSTS), including large SPAs (Gmail,
    // Twitter/X) with thousands of nested elements, and the candidate loop
    // below is otherwise O(n) *elements* each computing O(subtree) textContent
    // (nested divs re-scan overlapping text) — one whole-page check first
    // means non-job pages (the common case) never pay that cost at all.
    const bodyMatches = (document.body.textContent.match(JOB_KEYWORDS) || []).length;
    if (bodyMatches < minMatches) return null;

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
      const count = matches ? matches.length : 0;
      if (count < minMatches) continue;
      const score = count * 1000 + Math.min(text.length, 5000);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function extractEmployer() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch (e) {
        continue;
      }

      const entries = [];
      if (Array.isArray(data)) {
        entries.push(...data);
      } else if (data && typeof data === "object") {
        if (Array.isArray(data["@graph"])) {
          entries.push(...data["@graph"]);
        }
        entries.push(data);
      }

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        // schema.org allows "@type" to be a single string or an array of
        // strings (e.g. co-listed types) -- check both forms.
        const types = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]];
        if (!types.some((t) => String(t || "").toLowerCase() === "jobposting")) continue;

        // hiringOrganization is usually a single Organization, but
        // schema.org permits an array for co-listed/staffing postings --
        // take the first entry that yields a usable name.
        const orgs = Array.isArray(entry.hiringOrganization) ? entry.hiringOrganization : [entry.hiringOrganization];
        for (const org of orgs) {
          if (org && typeof org === "string" && org.trim()) {
            return org.trim();
          }
          if (org && typeof org === "object" && org.name && typeof org.name === "string" && org.name.trim()) {
            return org.name.trim();
          }
        }
      }
    }

    // og:site_name is only trustworthy as an employer name on the company's
    // own domain — on a known ATS/job-board host it resolves to the
    // platform's own brand (e.g. "Greenhouse", "LinkedIn"), not the employer.
    if (!isJobSite) {
      const meta = document.querySelector('meta[property="og:site_name"]');
      if (meta && meta.content && meta.content.trim()) {
        return meta.content.trim();
      }
    }

    return null;
  }

  const title = document.title;

  // Known job boards get the loose bar (1 keyword match is enough — the
  // hostname already told us this is a job site). Everywhere else needs a
  // denser cluster of job-posting language before we trust it's really a
  // job description and not, say, a page that mentions "requirements" once.
  const jobEl = isJobSite
    ? findBySelectors() || findByKeywordScore(1)
    : findByKeywordScore(3);

  if (jobEl) {
    return { title, text: cleanText(jobEl).slice(0, 20000), siteType: "job", employer: extractEmployer() };
  }

  const source =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  return { title, text: cleanText(source).slice(0, 20000), siteType: "general", employer: null };
}
