# Getting Started with Playwright Skill

A developer guide for setting up and using the Playwright browser automation skill.

## Prerequisites

- Node.js 18+
- A project with Claude Code configured (`.claude/` directory)

## Installation

### 1. Clone or Copy the Skill

Copy the `playwright-skill` directory into your project's `.claude/skills/` folder:

```
your-project/
├── .claude/
│   └── skills/
│       └── playwright-skill/    # This skill
├── src/
└── ...
```

### 2. Install Dependencies

```bash
cd .claude/skills/playwright-skill
npm install
```

### 3. Build the CLI

```bash
npm run build
```

### 4. Configure for Your Project

Copy the example configuration files:

```bash
cp skill/worktrees.example.json skill/worktrees.json
cp skill/secrets.example.json skill/.secrets.json
```

Edit `skill/worktrees.json` with your project's:
- Base URLs for each environment/worktree
- User roles and email addresses
- Tenant configuration (if multi-tenant)

Edit `skill/.secrets.json` with passwords (never commit this file).

## Quick Start

### Start the Daemon

The daemon maintains browser state between commands:

```bash
# Visible browser (recommended for development)
npx playwright-skill-daemon --headless false

# Headless (for CI/automated testing)
npx playwright-skill-daemon --headless true
```

### Basic Workflow

```bash
# 1. Navigate to a page
npx playwright-skill navigate "https://your-app.test/login"

# 2. Take a snapshot to see element refs
npx playwright-skill snapshot

# 3. Interact with elements using refs
npx playwright-skill fill e5 "user@example.com"
npx playwright-skill fill e8 "password"
npx playwright-skill click e12

# 4. Save auth for reuse
npx playwright-skill auth-save myuser
```

### Using CSS Selectors

When element refs don't work (modals, dynamically rendered content):

```bash
# Click by selector
npx playwright-skill click-selector "button[type=submit]"

# Fill by selector
npx playwright-skill fill-selector "input[name=email]" "user@example.com"

# Upload files (hidden inputs)
npx playwright-skill upload-selector "input[type=file]" "/path/to/file.csv"
```

## Project Configuration

### Single Environment

For projects with one environment, minimal config:

```json
{
  "worktrees": {
    "my-app": {
      "baseUrl": "https://my-app.test",
      "auth": {
        "defaultUser": "admin@example.com"
      }
    }
  }
}
```

### Multiple Worktrees

For projects using git worktrees:

```json
{
  "worktrees": {
    "my-app": {
      "baseUrl": "https://my-app.test",
      "branch": "develop"
    },
    "my-app-staging": {
      "baseUrl": "https://staging.my-app.com",
      "branch": "main"
    },
    "my-app-feature": {
      "baseUrl": "https://feature.my-app.test",
      "branch": "feature/new-thing"
    }
  }
}
```

The skill auto-detects which worktree you're in based on your current directory.

### Multi-Tenant Apps

For applications with tenant-specific URLs:

```json
{
  "worktrees": {
    "my-app": {
      "baseUrl": "https://my-app.test",
      "tenant": {
        "slug": "acme-corp",
        "panels": {
          "admin": "/admin",
          "app": "/app/acme-corp"
        }
      }
    }
  }
}
```

## Development Tips

### Debugging Element Selection

```bash
# Take screenshot to see current state
npx playwright-skill screenshot

# Query DOM to find elements
npx playwright-skill query "button"
npx playwright-skill query ".modal input"

# Get full snapshot for debugging
npx playwright-skill snapshot
npx playwright-skill cache-query <cache-id> snapshot
```

### Handling Dynamic Content

```bash
# Wait for element to appear
npx playwright-skill wait ".loading-complete"
npx playwright-skill wait "#results" --timeout 60000

# Reload and re-snapshot after changes
npx playwright-skill reload
npx playwright-skill snapshot
```

### Auth Persistence

```bash
# Save auth after login
npx playwright-skill auth-save admin

# Load auth in new session
npx playwright-skill auth-load admin

# Check current auth status
npx playwright-skill auth-status

# Clear auth when needed
npx playwright-skill auth-clear
```

## Troubleshooting

### "Daemon not running"

Start the daemon first:
```bash
npx playwright-skill-daemon --headless false
```

### Element refs not found

Take a fresh snapshot - the page may have changed:
```bash
npx playwright-skill snapshot
```

### Modal elements not in snapshot

Modal content often renders outside the main DOM tree. Use selectors:
```bash
npx playwright-skill query ".modal button"
npx playwright-skill click-selector ".modal button[type=submit]"
```

### Auth not persisting

Check if cookies are being saved:
```bash
npx playwright-skill auth-status
```

If using headless mode, try visible browser:
```bash
npx playwright-skill-daemon --headless false
```

## Architecture Overview

```
┌─────────────────────────────────────────┐
│           CLI Commands                   │
│  npx playwright-skill <command>          │
└─────────────────────────────────────────┘
                    │
          Unix Socket (/tmp/playwright-skill.sock)
                    │
                    ▼
┌─────────────────────────────────────────┐
│              Daemon                      │
│  - Owns browser instance                 │
│  - Maintains page state                  │
│  - 30 min idle timeout                   │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│           Chromium Browser               │
│  - Visible or headless                   │
│  - User can interact directly            │
└─────────────────────────────────────────┘
```

## Next Steps

- Read [SKILL.md](../SKILL.md) for complete documentation
- See [REFERENCE.md](../skill/REFERENCE.md) for all commands
- Check [AUTH.md](../skill/AUTH.md) for authentication patterns
- Review [CONFIG.md](../skill/CONFIG.md) for configuration options
