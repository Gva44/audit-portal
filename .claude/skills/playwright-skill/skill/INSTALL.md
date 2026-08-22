# Installation Guide — playwright-skill v2

## Prerequisites

- Node.js 18+
- `@playwright/cli` installed globally

## 1. Install @playwright/cli

```bash
npm install -g @playwright/cli
```

Verify:
```bash
playwright-cli --version
# Output: 1.59.0-alpha-... (or similar)
```

## 2. Install Playwright Browsers

```bash
npx playwright install chromium
```

For Firefox or WebKit support:
```bash
npx playwright install firefox webkit
```

## 3. Make bin/ scripts executable

From the skill root directory:

```bash
chmod +x bin/*
```

## 4. Add bin/ to PATH (optional)

To run `bin/auth-save` instead of `./bin/auth-save`, add the skill's `bin/` directory to your shell PATH:

```bash
# In .zshrc or .bashrc:
export PATH="/path/to/.claude/skills/playwright-skill/bin:$PATH"
```

Or when running from your project root, the SKILL.md `allowed-tools` declarations already cover the `bin/` scripts directly.

## 5. Configure for your project

Copy the example configuration files and fill in your project's values:

```bash
cp skill/worktrees.example.json skill/worktrees.json
# Edit skill/worktrees.json with your baseUrl, auth profile names, and roles
```

See `skill/CONFIG.md` for the full configuration schema.

## 6. Set up auth profiles

On first use, log in as each role and save a profile. Profile names should match the roles defined in your `skill/worktrees.json`:

```bash
bin/open --headed
playwright-cli goto <baseUrl>          # from skill/worktrees.json

# Log in, then save:
bin/auth-save <profile-name>           # repeat for each role
```

Profiles are stored in `.playwright-skill/auth/` and gitignored.

## 6. Verify installation

```bash
# From the skill root:
npx vitest run

# All tests should pass, including the integration smoke tests.
```

## Upgrading from v1

v2 removes the custom Node.js daemon entirely. Key differences:

| v1 | v2 |
|----|-----|
| `npx playwright-skill-daemon --headless false` | `playwright-cli open --headed` |
| `npx playwright-skill navigate <url>` | `playwright-cli goto <url>` |
| `npx playwright-skill auth-save <name>` | `bin/auth-save <name>` |
| `npx playwright-skill auth-load <name>` | `bin/auth-load <name>` |
| `npx playwright-skill click <ref>` | `playwright-cli click <ref>` |
| `npx playwright-skill fill <ref> <val>` | `playwright-cli fill <ref> <val>` |
| Session management via `--session` flag | Single implicit session per daemon |
| Responses as JSON | Responses as plain text with snapshot link |

See [REFERENCE.md](REFERENCE.md) for the full v2 command reference.
