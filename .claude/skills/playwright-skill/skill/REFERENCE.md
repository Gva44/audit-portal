# Playwright Skill v2 — Command Reference

Complete reference for `playwright-cli` commands and project wrapper scripts.

---

## Session Commands

### open

Open a browser session.

```bash
playwright-cli open           # headless (default)
playwright-cli open --headed  # visible browser window
```

**Notes:**
- Always start with `open` before navigating.
- `--headed` shows the browser; omit for headless CI mode.
- The daemon starts automatically — no second terminal needed.

---

### close

Close the browser session.

```bash
playwright-cli close
```

---

### kill-all

Force-kill all playwright-cli daemons (use when stuck).

```bash
playwright-cli kill-all
```

---

## Navigation Commands

### goto

Navigate to a URL.

```bash
playwright-cli goto <url>
```

**Example:**
```bash
playwright-cli goto https://my-app.test
playwright-cli goto https://my-app.test/dashboard
```

**Notes:**
- Waits for page load before returning.
- Stdout includes a `### Snapshot` link — always read it.

---

### go-back

Go back in browser history.

```bash
playwright-cli go-back
```

---

### go-forward

Go forward in browser history.

```bash
playwright-cli go-forward
```

---

### reload

Reload the current page.

```bash
playwright-cli reload
```

---

## Interaction Commands

### click

Click an element by accessibility ref.

```bash
playwright-cli click <ref>
```

**Arguments:**
- `ref` (required): Element reference from snapshot (e.g., `e5`)

**Example:**
```bash
playwright-cli snapshot     # get refs
playwright-cli click e5     # click element with ref e5
```

---

### fill

Fill an input field (clears existing value first).

```bash
playwright-cli fill <ref> <value>
```

**Example:**
```bash
playwright-cli fill e3 "user@example.com"
playwright-cli fill e5 "my-password"
```

---

### type

Type text (appends to existing content).

```bash
playwright-cli type <text>
```

**Notes:**
- Does not clear existing content; use `fill` to replace.

---

### select

Select an option from a dropdown.

```bash
playwright-cli select <ref> <value>
```

**Example:**
```bash
playwright-cli select e7 "us"
playwright-cli select e7 "United States"
```

---

### press

Press a keyboard key.

```bash
playwright-cli press <key>
```

**Common keys:** `Enter`, `Tab`, `Escape`, `Backspace`, `ArrowUp`, `ArrowDown`

**Modifiers:** `Control+A`, `Meta+C`, `Shift+Enter`

---

### hover

Hover over an element (reveals menus, tooltips).

```bash
playwright-cli hover <ref>
```

---

## Inspection Commands

### snapshot

Capture the accessibility tree.

```bash
playwright-cli snapshot
```

**Output:**
```
### Snapshot
- [Snapshot](.playwright-cli/page-<timestamp>.yml)
```

Always read the linked `.yml` file to see element refs and page structure.

---

### screenshot

Take a screenshot.

```bash
playwright-cli screenshot
```

---

## Dialog Commands

### dialog-accept

Accept an alert/confirm/prompt.

```bash
playwright-cli dialog-accept
```

---

### dialog-dismiss

Dismiss a dialog.

```bash
playwright-cli dialog-dismiss
```

---

## State Commands

### state-save

Save browser state (cookies + localStorage) to a file.

```bash
playwright-cli state-save <path>
```

**Example:**
```bash
playwright-cli state-save .playwright-skill/auth/<profile-name>.json
```

Use `bin/auth-save` wrapper for named profiles (see below).

---

### state-load

Load browser state from a file.

```bash
playwright-cli state-load <path>
```

Use `bin/auth-load` wrapper for named profiles (see below).

---

## Escape Hatch

### run-code

Run arbitrary Playwright JS code.

```bash
playwright-cli run-code '<async page => { ... }>'
```

**Examples:**
```bash
# Wait for element
playwright-cli run-code 'await page.waitForSelector(".loading-complete")'

# Dispatch a custom JS event
playwright-cli run-code 'await page.evaluate(() => window.dispatchEvent(new Event("refresh")))'

# Scroll to bottom
playwright-cli run-code 'await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))'

# Get element count
playwright-cli run-code 'console.log(await page.locator("table tbody tr").count())'
```

---

## CSS Selector Wrapper Scripts

These `bin/` scripts handle scenarios where ARIA refs don't work — for example, framework-rendered elements outside the accessibility tree. Project-specific selector patterns are documented in `skill/CONFIG.md`.

### bin/click-css

Click an element by CSS selector.

```bash
bin/click-css "<selector>"
```

**Example:**
```bash
bin/click-css "[data-modal-confirm]"
bin/click-css "button[data-dismiss]"
bin/click-css "[data-action=save]"
```

**Use when:** Elements are rendered as DOM portals or otherwise outside the accessibility tree.

---

### bin/fill-css

Fill an input by CSS selector.

```bash
bin/fill-css "<selector>" "<value>"
```

**Example:**
```bash
bin/fill-css "[data-field=email]" "user@example.com"
bin/fill-css "input[name=amount]" "42.50"
```

**Use when:** Framework-bound inputs don't respond to ARIA-ref fill.

---

### bin/upload

Upload a file via a hidden file input.

```bash
bin/upload "<selector>" "<file-path>"
```

**Example:**
```bash
bin/upload "input[type=file]" /path/to/document.pdf
bin/upload "input[type=file]" /tmp/photo.jpg
```

**Use when:** File inputs are hidden from the accessibility tree.

---

### bin/auth-save

Save the current browser session to a named auth profile.

```bash
bin/auth-save <name>
```

**Example:**
```bash
bin/auth-save admin
bin/auth-save user
```

Profiles are stored in `.playwright-skill/auth/<name>.json`.

---

### bin/auth-load

Load a named auth profile into the current session.

```bash
bin/auth-load <name>
```

**Example:**
```bash
bin/auth-load admin
```

Prints available profiles if the requested one is not found.

---

## Reading Snapshots

After every command, stdout contains:

```
### Ran Playwright code
<js code>

### Page
- URL: https://...
- Title: ...

### Snapshot
- [Snapshot](.playwright-cli/page-<timestamp>.yml)
```

**Always read the snapshot file:**
```
Read .playwright-cli/page-<timestamp>.yml
```

The YAML contains all interactive elements with `[ref=eN]` identifiers used for `click`, `fill`, `hover`, `select`.

---

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Element not found` | Invalid ref or stale snapshot | Run `snapshot` and read the new file |
| Filament modal not clickable | Modal is a DOM portal outside ARIA tree | Use `bin/click-css` with CSS selector |
| Livewire handler not firing | ARIA-ref click doesn't dispatch event | Use `bin/click-css "[wire:click=...]"` |
| Browser stuck / daemon hung | Daemon crashed | `playwright-cli kill-all` then `playwright-cli open --headed` |
| Auth expired | Cookies/tokens expired | `bin/auth-load <name>` then reload |
