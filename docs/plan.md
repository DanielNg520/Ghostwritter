# Ghost Writer — Chrome Extension Implementation Plan

## System Architecture Overview

To achieve an on-demand, sidebar-based workflow for writing Amazon Vine reviews, we need to shift from a batch processing script to a client-server architecture. 

Because Chrome Extensions cannot execute terminal commands (like the `agy` CLI) directly for security reasons, the system will consist of two parts:
1. **Local Python API Server (Backend):** Runs locally on your Mac, listening for requests. It executes the AI generation commands using your existing rules and writing samples.
2. **Chrome Extension (Frontend):** A browser extension using the Chrome Side Panel API. It provides the UI, extracts product information from the Amazon page, and sends your comment to the local server.

---

## Technologies Used & Why

### Backend
* **Python with FastAPI (or Flask):** We will use a lightweight web framework to create a local HTTP server. FastAPI is recommended because it is extremely fast, easy to set up for JSON endpoints, and handles cross-origin requests (CORS) cleanly. 
* **`agy` CLI:** We will reuse your existing `run_ghost_writer.py` logic to call `agy` so that all your `RULES.MD`, `MEMORY.MD`, and writing samples continue working identically.

### Frontend
* **Chrome Extension (Manifest V3):** The modern standard for Chrome extensions.
* **Chrome Side Panel API (`chrome.sidePanel`):** Allows the extension to open a persistent sidebar when you click the extension icon. This is much better than a popup, which closes if you click away.
* **Vanilla HTML/CSS/JavaScript:** Since the UI is simple (two textareas and a button), we do not need a complex framework like React. Vanilla web technologies keep the extension lightweight and easy to maintain.
* **DOM Text Extraction (Alternative to Screenshots):** Instead of using Playwright to take heavy full-page screenshots, the extension's content script will instantly extract the Product Title and Bullet Points directly from the HTML. This will make the AI generation *significantly faster*.

---

## Codebase Outline Skeleton

The new structure inside the `ghost writter/` folder will look like this:

```text
ghost writter/
├── server.py                   <- [NEW] FastAPI server that listens for extension requests
├── start_server.command        <- [NEW] Double-click to start the background server
├── run_ghost_writer.py         <- [EXISTING] Minor refactor to allow server.py to import its functions
├── RULES.MD                    <- [EXISTING] Unchanged
├── MEMORY.MD                   <- [EXISTING] Unchanged
└── extension/                  <- [NEW] The Chrome Extension source code
    ├── manifest.json           <- Extension config, permissions (activeTab, sidePanel, scripting)
    ├── background.js           <- Service worker to handle clicking the extension icon
    ├── content.js              <- Script injected into Amazon pages to extract product title/details
    ├── sidebar.html            <- The UI for the sliding sidebar
    ├── sidebar.css             <- Styling for the sidebar
    └── sidebar.js              <- Handles UI logic (button clicks, sending data to server.py)
```

---

## Atomic Tasks

### Phase 1: Backend Infrastructure
- **Task 1.1: Refactor `run_ghost_writer.py` (Optional but recommended)**
  - Modify `run_ghost_writer.py` slightly so its core functions (`run_agy`, `ai_score`, `build_initial_prompt`) can be imported into another Python file without executing the full batch-processing loop.
- **Task 1.2: Build `server.py`**
  - Initialize a basic FastAPI (or Flask) application.
  - Create a `POST /generate-review` endpoint.
  - The endpoint should accept JSON containing: `product_title`, `product_details`, and `user_comment`.
  - Wire the endpoint to trigger the `agy` command and return the generated text.
- **Task 1.3: Enable CORS & Server Script**
  - Configure CORS (Cross-Origin Resource Sharing) on the server so the Chrome Extension is allowed to communicate with it.
  - Create `start_server.command` to easily boot the server.

### Phase 2: Extension UI & Permissions
- **Task 2.1: Setup `manifest.json`**
  - Define Manifest V3 properties.
  - Add permissions for `"sidePanel"`, `"scripting"`, `"activeTab"`, and host permissions for `*://*.amazon.com/*` and `http://localhost:*`.
- **Task 2.2: Build the Sidebar UI (`sidebar.html` & `sidebar.css`)**
  - Create a clean layout with:
    - A header.
    - A textarea for the user's comment.
    - A "Generate Review" button.
    - A loading spinner/indicator.
    - A readonly textarea for the AI output.

### Phase 3: Extension Logic
- **Task 3.1: Implement `background.js`**
  - Set up a listener for the extension action (clicking the puzzle piece icon) to open the Side Panel on the current tab.
- **Task 3.2: Implement `content.js`**
  - Write DOM queries to extract the `#productTitle` and the product description/feature bullets from the Amazon page.
  - Expose a listener so the sidebar can request this data.
- **Task 3.3: Implement `sidebar.js`**
  - Add an event listener to the "Generate Review" button.
  - When clicked:
    1. Send a message to `content.js` to scrape the page data.
    2. Read the user's comment from the textarea.
    3. Make a `fetch()` POST request to `http://localhost:8000/generate-review` with the combined data.
    4. Display loading states, and update the output textarea when the server responds.

### Phase 4: Testing & Polish
- **Task 4.1: End-to-End Testing**
  - Load the unpacked extension in Chrome via `chrome://extensions`.
  - Boot `server.py`.
  - Navigate to an Amazon Vine page, open the sidebar, submit a comment, and ensure the review populates correctly.
- **Task 4.2: Error Handling**
  - Add fallback logic in `sidebar.js` if the local server is not running (e.g., displaying "Make sure the background server is running!").
