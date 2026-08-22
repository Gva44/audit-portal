# playwright-skill

A Claude Code skill for agentic browser QA, built on top of Microsoft's `@playwright/cli`.

This project has two distinct layers: the **`@playwright/cli` dependency** (Microsoft's official Playwright CLI) and the **playwright-skill wrapper** (session management, context capture, and LLM-optimised diagnostics). This document explains both.

---

## The Dependency: `@playwright/cli`

`@playwright/cli` is Microsoft's official command-line interface for Playwright. Unlike the `playwright` npm package — which is a programmatic Node.js API — `@playwright/cli` exposes browser automation as a set of shell commands, with no application code required.

### How it works

`@playwright/cli` runs a persistent browser session in the background. You interact with it by running short commands in your terminal:

```bash
playwright-cli open --headed       # start a Chromium session (visible)
playwright-cli goto https://app    # navigate
playwright-cli snapshot            # capture accessibility tree
playwright-cli click e5            # click element by ref
playwright-cli fill e3 "value"     # fill input by ref
playwright-cli screenshot          # take a screenshot
playwright-cli close               # close the session
```

### The snapshot model

The core abstraction is the **accessibility tree snapshot**. After every command, `playwright-cli` writes a YAML file to `.playwright-cli/` containing a structured representation of the page — every visible element, its role, label, and an `[ref=eN]` identifier:

```yaml
- heading "Dashboard" [level=1]
- navigation:
  - link "Work Orders" [ref=e12]
  - link "Customers" [ref=e14]
- button "New Work Order" [ref=e23]
- table:
  - row "WO-1042 | Open | Clark Transport" [ref=e31]
```

These refs are used as arguments to `click`, `fill`, `hover`, and `select`. No CSS selectors or XPath needed for standard interactions.

### Named sessions

`playwright-cli` supports multiple simultaneous browser sessions via the `-s=<name>` flag:

```bash
playwright-cli -s=project-a open --headed
playwright-cli -s=project-a goto https://app-a.test

playwright-cli -s=project-b open --headed
playwright-cli -s=project-b goto https://app-b.test

playwright-cli list   # shows both sessions as independent
```

This is the mechanism playwright-skill uses for multi-project isolation.

### Native diagnostic capture

`playwright-cli` also exposes raw browser data:

```bash
playwright-cli console   # browser console messages since last page load
playwright-cli network   # HTTP requests since last page load
```

### The escape hatch

For anything not covered by built-in commands, `run-code` executes arbitrary Playwright JS against the live page:

```bash
playwright-cli run-code 'async page => {
  await page.waitForSelector(".data-loaded");
  return { count: await page.locator("table tr").count() };
}'
```

The return value is printed as `### Result\n<json>`.

---

## What playwright-skill Adds

`@playwright/cli` is a powerful tool for human-driven automation, but agentic QA has different requirements. An LLM agent can't read a 200KB HTML file, can't trivially correlate console errors with failing network requests, and doesn't have a way to compare page state before and after an interaction. playwright-skill addresses each of these gaps.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent (Claude)                           │
└──────────────────────┬──────────────────────────────────────────┘
                       │ runs bin/ scripts
┌──────────────────────▼──────────────────────────────────────────┐
│                    playwright-skill layer                        │
│                                                                 │
│  bin/open           Named session lifecycle                     │
│  bin/close          (.playwright-skill/session)                 │
│                                                                 │
│  bin/context  ──►  capture.ts                                   │
│                      ├─ playwright-cli snapshot                 │
│                      ├─ playwright-cli console                  │
│                      ├─ playwright-cli network                  │
│                      └─ playwright-cli run-code (page data)     │
│                            │                                    │
│                      ResponseBuilder  ──►  TrimmedResponse      │
│                            │               (~200 tokens)        │
│                      CacheStore  ──►  .playwright-skill/cache/  │
│                                                                 │
│  bin/inject-capture  inject.ts  (patches console + fetch/XHR)  │
│  bin/cache-query     cache-cli.ts  (query cached data by type)  │
│  bin/click-css       CSS selector fallbacks for ARIA gaps       │
│  bin/auth-save/load  Named auth profiles                        │
└──────────────────────┬──────────────────────────────────────────┘
                       │ execFileSync('playwright-cli', ...)
┌──────────────────────▼──────────────────────────────────────────┐
│                    @playwright/cli                              │
│                    (Microsoft, npm: @playwright/cli)           │
└─────────────────────────────────────────────────────────────────┘
```

### 1. Session isolation (`bin/open`, `bin/close`)

Bare `playwright-cli open` creates an anonymous session. If two projects are open simultaneously, their commands can collide.

`bin/open` derives a session name from the current directory (`basename $PWD`), writes it to `.playwright-skill/session`, and opens the browser under that named session:

```bash
# project A
cd clark-truck-repair && bin/open --headed
# → session name: "clark-truck-repair"

# project B (simultaneously)
cd ctr-qa && bin/open --headed
# → session name: "ctr-qa"
```

All `bin/` wrapper scripts read `.playwright-skill/session` and forward the `-s=<name>` flag automatically. Projects are fully isolated.

`bin/close` closes the browser gracefully and removes `.playwright-skill/session`, preventing stale state across tasks.

### 2. Context capture pipeline (`bin/context`)

Capturing a useful diagnostic snapshot from `playwright-cli` requires running four separate commands and correlating their outputs. `bin/context` does this automatically and merges the results from three sources:

| Source | Data |
|--------|------|
| `playwright-cli snapshot` | Accessibility tree (YAML) |
| `playwright-cli console` + `playwright-cli network` | Native browser logs |
| `playwright-cli run-code` | URL, title, full HTML, cookies, injected captures |

After merging, it calls `ResponseBuilder` to produce a compact **`TrimmedResponse`** written to stdout, and stores the full context in `CacheStore` on disk.

### 3. Token efficiency (`ResponseBuilder` + `CacheStore`)

A raw HTML page can be hundreds of kilobytes — far too large to include in an LLM context window. `ResponseBuilder` builds a `TrimmedResponse` of approximately 200 tokens:

```json
{
  "id": "req-2026-02-19-1",
  "command": "context",
  "success": true,
  "action": "Captured page context for https://app.test/work-orders",
  "pageState": {
    "url": "https://app.test/work-orders",
    "title": "Work Orders",
    "authStatus": "authenticated",
    "hasErrors": false
  },
  "cacheRef": {
    "id": "cache-m4k2p8-a3f9x1",
    "available": ["snapshot", "html", "screenshot", "console", "network"]
  }
}
```

The full context — HTML, snapshot YAML, console messages, network requests, screenshot — is stored in `.playwright-skill/cache/` under the `cacheRef.id`. The agent retrieves only what it needs:

```bash
bin/cache-query query cache-m4k2p8-a3f9x1 console    # check for JS errors
bin/cache-query query cache-m4k2p8-a3f9x1 network    # check API responses
bin/cache-query query cache-m4k2p8-a3f9x1 snapshot   # review page structure
bin/cache-query query cache-m4k2p8-a3f9x1 html       # inspect raw HTML
```

`CacheStore` is an LRU disk cache (20 entries by default). Old entries are evicted automatically.

### 4. Browser-side capture injection (`bin/inject-capture`)

`playwright-cli console` captures console messages at the browser process level, but only from the moment the page loads. For single-page applications where errors occur during user interaction, that's not enough.

`bin/inject-capture` patches `console.*`, `window.fetch`, and `XMLHttpRequest` directly in the page's JavaScript runtime:

```bash
bin/inject-capture
# → {"success": true, "hasCapture": true, "session": "clark-truck-repair"}
```

After injection, any console output or fetch request made during the session is captured in `window.__capturedConsole` and `window.__capturedRequests`. When `bin/context` runs, it reads these alongside the native playwright-cli captures and deduplicates them. The patches are idempotent — safe to call multiple times.

This matters for agentic QA because agents often interact with a page over an extended session, and errors frequently occur in response to user actions rather than at page load.

### 5. No-session detection

If `bin/context` or `bin/inject-capture` are run without an open browser session, they return a structured error response instead of silently failing:

```json
{
  "success": false,
  "action": "No browser session 'clark-truck-repair' is open",
  "suggestions": [
    "Run: bin/open --headed   # resumes session 'clark-truck-repair'",
    "If the session is stuck: playwright-cli kill-all  then  bin/open --headed"
  ]
}
```

The agent receives actionable instructions and can recover without human intervention.

### 6. CSS selector fallbacks

The ARIA-ref model works well for most elements, but modern frontend frameworks (Livewire, Alpine, React portals) frequently render elements outside the accessibility tree — modal dialogs, toast notifications, hidden file inputs. Three wrapper scripts fill the gap:

```bash
bin/click-css "[data-modal-confirm]"           # click by CSS selector
bin/fill-css "[wire:model=search]" "term"      # fill by CSS selector
bin/upload "input[type=file]" /path/to/file    # set file input
```

### 7. Auth profile management

```bash
bin/auth-save admin    # saves cookies + localStorage to .playwright-skill/auth/admin.json
bin/auth-load admin    # restores session state from that file
```

Auth profiles are gitignored and session-scoped (the `-s=` flag is forwarded automatically). A typical agent workflow authenticates once, saves a profile, and reloads it at the start of subsequent tasks rather than re-authenticating each time.

---

## Agentic QA Workflow

```bash
# 1. Start an isolated browser session
bin/open --headed
playwright-cli goto https://app.test
bin/auth-load admin

# 2. Enable richer capture before interacting
bin/inject-capture

# 3. Exercise the feature under test
playwright-cli snapshot        # read the snapshot file to get refs
playwright-cli click e23       # click "New Work Order"
playwright-cli fill e31 "Clark Transport"
playwright-cli press Enter

# 4. Capture full context and get a compact summary
bin/context --screenshot
# → TrimmedResponse on stdout; read cacheRef.id

# 5. Diagnose from the cache
bin/cache-query query <id> console     # any JS errors during the action?
bin/cache-query query <id> network     # did the API call succeed?
bin/cache-query query <id> snapshot    # what does the page show now?

# 6. Clean up
bin/close
```

The key principle is **deferred retrieval**: the agent acts on a 200-token summary and fetches specific context (console errors, network failures, page structure) only when needed for diagnosis. This keeps per-turn token costs low while retaining access to the full diagnostic picture.

---

## Installation

See [`skill/INSTALL.md`](skill/INSTALL.md) for full setup instructions.

**Quick start:**

```bash
npm install -g @playwright/cli
npx playwright install chromium
npm install        # install skill dev dependencies (TypeScript, vitest)
npm run build      # compile TypeScript → dist/
chmod +x bin/*
npx vitest run     # verify everything is wired correctly
```

---

## Project Structure

```
playwright-skill/
├── bin/
│   ├── open            # start named browser session
│   ├── close           # close session + clean up
│   ├── context         # capture full page context → TrimmedResponse
│   ├── inject-capture  # patch console + fetch in browser
│   ├── cache-query     # query cached context by data type
│   ├── click-css       # click by CSS selector
│   ├── fill-css        # fill by CSS selector
│   ├── upload          # set file input
│   ├── auth-save       # save named auth profile
│   └── auth-load       # restore named auth profile
├── src/
│   ├── capture.ts      # bin/context entry point
│   ├── inject.ts       # bin/inject-capture entry point
│   ├── cache-cli.ts    # bin/cache-query entry point
│   ├── response/
│   │   └── ResponseBuilder.ts   # builds TrimmedResponse
│   ├── cache/
│   │   └── CacheStore.ts        # LRU disk cache
│   ├── logging/
│   │   └── Logger.ts
│   └── types.ts        # Zod schemas + shared types
├── skill/
│   ├── INSTALL.md      # setup guide
│   ├── REFERENCE.md    # full command reference
│   ├── AUTH.md         # auth profile setup
│   └── CONFIG.md       # project-specific configuration
├── tests/
│   ├── integration.test.ts      # structural smoke tests
│   ├── CacheStore.test.ts
│   ├── ResponseBuilder.test.ts
│   └── Logger.test.ts
├── SKILL.md            # agent-facing instructions (loaded by Claude Code)
└── dist/               # compiled JS (gitignored, produced by npm run build)
```

---

## Further Reading

- [`SKILL.md`](SKILL.md) — agent-facing instructions; what Claude sees when the skill is active
- [`skill/REFERENCE.md`](skill/REFERENCE.md) — complete `playwright-cli` command reference with examples
- [`skill/AUTH.md`](skill/AUTH.md) — auth profile setup for multi-role testing
- [`skill/CONFIG.md`](skill/CONFIG.md) — project-specific selector patterns and worktree configuration
- [Microsoft `@playwright/cli` on npm](https://www.npmjs.com/package/@playwright/cli)
- [Playwright documentation](https://playwright.dev)
