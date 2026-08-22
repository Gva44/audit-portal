---
name: playwright-skill-v2
description: Browser automation for web projects using playwright-cli
version: 2.0.0
allowed-tools: Bash(playwright-cli:*), Bash(bin/open), Bash(bin/close), Bash(bin/click-css), Bash(bin/fill-css), Bash(bin/upload), Bash(bin/auth-save), Bash(bin/auth-load), Bash(bin/context), Bash(bin/inject-capture), Bash(bin/cache-query)
---

# Playwright Skill v2

Browser automation using `playwright-cli` (Microsoft's official Playwright CLI). No daemon management required — the browser starts and stops automatically.

---

## 1. Session Startup & Isolation

Always start with `bin/open` (not bare `playwright-cli open`):

```bash
bin/open --headed
playwright-cli goto <url>
```

`bin/open` derives a session name from the current directory (e.g. `my-project`), appends a short agent identifier when running under Claude Code, and starts the browser under that named session. All other `bin/` scripts resolve the session automatically.

**Session isolation:** When `CLAUDE_SESSION_ID` is set (automatic in Claude Code), each agent gets its own session name (e.g. `my-project-a1b2c3d4`) and session file. Parallel agents never interfere with each other. If a session is already open for this agent, `bin/open` closes it first to prevent orphaned Chrome processes — other agents' sessions are unaffected.

**Before opening a new session**, check if you already have one:
```bash
playwright-cli list    # see all open sessions
```
If your session is already listed and open, skip `bin/open` and use it directly.

At the end of a task, clean up with:

```bash
bin/close
```

This closes the browser and removes the session tracking file. If the browser is stuck use `playwright-cli kill-all` instead.

**Overriding the session name:**
```bash
bin/open --headed --session my-custom-name
```

---

## 2. Reading Snapshots

After **every** command, stdout contains a link to the current accessibility tree:

```
### Snapshot
- [Snapshot](.playwright-cli/page-<timestamp>.yml)
```

**Always read the snapshot file to see what's on the page:**

```
Read .playwright-cli/page-<timestamp>.yml
```

The snapshot contains all interactive elements with `[ref=eN]` identifiers used for clicking, filling, and hovering.

---

## 3. Core Commands

### Navigation
```bash
playwright-cli goto <url>          # navigate to URL
playwright-cli go-back             # browser back
playwright-cli go-forward          # browser forward
playwright-cli reload              # reload page
```

**Navigation safety:** Only navigate to URLs matching the project's `baseUrl` (defined in `skill/worktrees.json`) and its subpaths. Do not navigate to external or unknown domains unless the user explicitly requests it. This prevents accidental data leakage (cookies, auth tokens) to third-party sites.

### Interacting with Elements (use ref from snapshot)
```bash
playwright-cli click <ref>         # click element
playwright-cli fill <ref> <value>  # fill input (clears first)
playwright-cli type <text>         # type text (appends)
playwright-cli press <key>         # press key: Enter, Tab, Escape, Control+A
playwright-cli hover <ref>         # hover to reveal menus/tooltips
playwright-cli select <ref> <val>  # select dropdown option
```

### Observation
```bash
playwright-cli snapshot            # capture accessibility tree
playwright-cli screenshot          # take screenshot
```

### Dialogs
```bash
playwright-cli dialog-accept       # accept alert/confirm/prompt
playwright-cli dialog-dismiss      # dismiss dialog
```

### Session Management
```bash
bin/close                          # close browser session + clean up session file (preferred)
playwright-cli kill-all            # force-kill all playwright-cli daemons (use when stuck)
playwright-cli list                # list all open sessions
```

### Escape Hatch
```bash
playwright-cli run-code '<async page => { }>'   # run arbitrary Playwright JS
```

---

## 4. CSS Selector Fallbacks

Use these when ARIA-ref commands fail — for example, when framework-rendered elements are outside the main ARIA tree.

**Modal dialogs** — often rendered as DOM portals:
```bash
bin/click-css "[data-modal-confirm]"
bin/click-css "button[data-dismiss]"
```

**Hidden file inputs** — often hidden from accessibility tree:
```bash
bin/upload "input[type=file]" /path/to/file.pdf
```

**Framework event targets** — ARIA-ref clicks don't always fire framework event handlers:
```bash
bin/fill-css "[data-field=email]" "user@example.com"
bin/click-css "[data-action=save]"
```

See `skill/CONFIG.md` for project-specific selector patterns.

---

## 5. Auth Profiles

Auth profile names and base URLs are defined in `skill/worktrees.json` (gitignored).
See `skill/CONFIG.md` for setup instructions.

**Save after authenticating:**
```bash
bin/auth-save <profile-name>          # profile names from skill/worktrees.json
```

**Restore on a new session:**
```bash
bin/open --headed
playwright-cli goto <baseUrl>          # baseUrl from skill/worktrees.json
bin/auth-load <profile-name>
playwright-cli goto <baseUrl>/dashboard
```

Profiles are stored in `.playwright-skill/auth/` and gitignored.

---

## 6. Recovery

| Problem | Solution |
|---------|----------|
| Browser stuck / daemon hung | `playwright-cli kill-all` then `bin/open --headed` |
| No session open (bin/context error) | `bin/open --headed` |
| Auth expired | `bin/auth-load <profile>` then reload |
| Element ref not found | `playwright-cli snapshot` then read the new snapshot file |
| Filament modal not clickable | Use `bin/click-css` with CSS selector |
| End of task cleanup | `bin/close` |

---

## 7. run-code Examples

```bash
# Wait for a specific element
playwright-cli run-code 'await page.waitForSelector(".loading-complete")'

# Dispatch a Livewire event
playwright-cli run-code 'await page.evaluate(() => window.Livewire.dispatch("refresh"))'

# Scroll to bottom
playwright-cli run-code 'await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))'

# Get element count
playwright-cli run-code 'console.log(await page.locator("table tbody tr").count())'
```

---

## 8. Context Capture & QA Workflow

Three tools integrate `ResponseBuilder` and `CacheStore` into the v2 skill, enabling rich page diagnostics.

### Tools

| Command | Description |
|---------|-------------|
| `bin/context [--screenshot]` | Capture full page context → compact `TrimmedResponse` JSON on stdout |
| `bin/inject-capture` | Inject browser-side console + fetch/XHR patching |
| `bin/cache-query <cmd> [args]` | Query cached data by ID and type |

### `bin/context`

Collects context from three sources and stores it in `.playwright-skill/cache/`:

1. `playwright-cli snapshot` — accessibility tree (YAML)
2. `playwright-cli console` / `playwright-cli network` — native browser logs
3. `playwright-cli run-code` — page URL, title, HTML, cookies, injected captures

Outputs a `TrimmedResponse` (~200 tokens) with:
- `pageState` — URL, title, auth status, error flag
- `cacheRef.id` — reference ID to retrieve full context later
- `cacheRef.available` — list of available data types

```bash
bin/context             # text/ARIA capture only
bin/context --screenshot  # also capture PNG screenshot
```

### `bin/inject-capture`

Patches `console.*`, `window.fetch`, and `XMLHttpRequest` in the browser to capture events in `window.__capturedConsole` and `window.__capturedRequests`. These are merged with playwright-layer captures by `bin/context`.

Idempotent — safe to run multiple times. Only captures events *after* injection.

```bash
bin/inject-capture
# → {"success":true,"hasCapture":true}
```

### `bin/cache-query`

Retrieves full context stored by `bin/context`.

```bash
bin/cache-query query <id> snapshot    # accessibility tree YAML
bin/cache-query query <id> html        # full page HTML
bin/cache-query query <id> console     # console messages JSON
bin/cache-query query <id> network     # network requests JSON
bin/cache-query query <id> screenshot  # base64-encoded PNG
bin/cache-query list                   # JSON array of all cached entries
bin/cache-query stats                  # entry count, total size, max entries
bin/cache-query clear                  # clear all entries
bin/cache-query clear <id>             # clear one entry
```

### Typical QA Workflow

```bash
# 1. Start browser and navigate
bin/open --headed
playwright-cli goto http://localhost:8000
bin/auth-load <profile>

# 2. Inject browser-side capture (optional but recommended)
bin/inject-capture

# 3. Perform actions (click, fill, navigate...)
playwright-cli click e5
playwright-cli fill e7 "search term"
playwright-cli press Enter

# 4. Capture full context
bin/context --screenshot
# Read cacheRef.id from the TrimmedResponse output

# 5. Diagnose issues
bin/cache-query query <id> console     # check for JS errors
bin/cache-query query <id> network     # check API responses
bin/cache-query query <id> snapshot    # review page structure
bin/cache-query query <id> screenshot  # view page visually (base64 PNG)

# 6. Clean up
bin/close
```

> **Multi-project / parallel agent note:** When running under Claude Code, each agent automatically gets an isolated session via `CLAUDE_SESSION_ID`. Direct `playwright-cli` commands (goto, click, fill, etc.) work as-is when only one session is open. If multiple sessions are active, prefix with `-s=<session>` — e.g. `playwright-cli -s=my-project-a1b2c3d4 goto <url>`. The session name is printed when you run `bin/open`.

### Reading Console Errors

```bash
bin/cache-query query <id> console | python3 -c "
import sys, json
msgs = json.load(sys.stdin)
errors = [m for m in msgs if m['type'] == 'error']
for e in errors:
    print(e['text'])
"
```
