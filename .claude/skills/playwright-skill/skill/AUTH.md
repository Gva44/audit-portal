# Authentication Patterns

Patterns for handling authentication with playwright-skill.

## Project Configuration

Auth profile names and base URLs are defined in `skill/worktrees.json` (gitignored, not in this repo).

To set up for your project, copy the example and fill in your values:
```bash
cp skill/worktrees.example.json skill/worktrees.json
# Edit skill/worktrees.json with your baseUrl, roles, and auth profile names
```

See `skill/CONFIG.md` for the full configuration schema.

---

## First-Time Setup: Saving Auth Profiles

### 1. Open the browser and navigate to the app

```bash
playwright-cli open --headed
playwright-cli goto <baseUrl>          # from skill/worktrees.json
```

### 2. Log in via the login form

```bash
playwright-cli snapshot
# Read the snapshot file to find form refs
playwright-cli fill e3 "user@example.com"
playwright-cli fill e5 "password"
playwright-cli click e7
```

### 3. Verify login succeeded

```bash
playwright-cli snapshot
# Confirm you're on the dashboard, not the login page
```

### 4. Save the profile

```bash
bin/auth-save <profile-name>          # profile names from skill/worktrees.json
```

Repeat for each role. Profiles are stored in `.playwright-skill/auth/` and gitignored.

---

## Reusing Saved Auth (Standard Session Start)

```bash
playwright-cli open --headed
playwright-cli goto <baseUrl>
bin/auth-load <profile-name>
playwright-cli goto <baseUrl>/dashboard
```

**Why navigate twice?** `state-load` injects cookies into the current session. A second navigation to the target page picks them up.

---

## Switching Between Roles

```bash
# Start as first role
playwright-cli open --headed
playwright-cli goto <baseUrl>
bin/auth-load <profile-a>
playwright-cli goto <baseUrl>/dashboard

# ... do work as profile-a ...

# Switch roles (kill-all and reopen to get a fresh session)
playwright-cli kill-all
playwright-cli open --headed
playwright-cli goto <baseUrl>
bin/auth-load <profile-b>
playwright-cli goto <baseUrl>/dashboard
```

---

## Handling Auth Failures

### Redirect to Login

When navigating to a protected page redirects to login:

```bash
playwright-cli goto <baseUrl>/protected-page
# You end up on /login

# Load saved auth and retry
bin/auth-load <profile-name>
playwright-cli goto <baseUrl>/protected-page
```

### Auth Expired

When a previously saved profile no longer works (session expired server-side):

```bash
# Log in fresh and re-save the profile
playwright-cli goto <baseUrl>/login
playwright-cli snapshot
playwright-cli fill e3 "user@example.com"
playwright-cli fill e5 "password"
playwright-cli click e7
bin/auth-save <profile-name>
```

### Stuck in Redirect Loop

```bash
playwright-cli kill-all
playwright-cli open --headed
playwright-cli goto <baseUrl>/login
# Log in fresh
```

---

## How State Persistence Works

`bin/auth-save` calls `playwright-cli state-save`, which captures:
- **Cookies**: Session tokens and auth cookies
- **localStorage**: Any client-side auth state
- **sessionStorage**: Session-scoped data

`bin/auth-load` calls `playwright-cli state-load`, which injects the full browser state into the current session — equivalent to restoring a complete browser session, unlike cookie-only approaches.

---

## Troubleshooting

**"Auth profile not found"**
```bash
# List available profiles
ls .playwright-skill/auth/
```

**"403 on protected pages after auth-load"**
- Likely auth profile expired or belongs to wrong environment.
- Re-authenticate and re-save the profile.

**"Login form fills but submit fails"**
- The form refs may have changed. Run `playwright-cli snapshot` and read the snapshot file to find current refs.
- Or use CSS selector fallback: `bin/click-css "button[type=submit]"`

**"Headless mode auth not persisting"**
- Some applications block auth in headless mode. Use `playwright-cli open --headed` for initial login.
- After saving the profile, subsequent `open` (headless) + `bin/auth-load` should work.
