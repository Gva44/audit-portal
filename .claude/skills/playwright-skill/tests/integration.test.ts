/**
 * Integration smoke tests for playwright-skill v2.
 *
 * These tests verify that the v2 skill structure is correct:
 * - Required files exist
 * - Bin scripts are executable
 * - SKILL.md frontmatter declares the right tools
 * - playwright-cli is available in PATH
 *
 * No browser is launched; these are static/structural checks only.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, accessSync, readFileSync, constants } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function skillPath(...parts: string[]): string {
  return resolve(ROOT, ...parts);
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe('playwright-cli availability', () => {
  it('playwright-cli is in PATH', () => {
    let output: string;
    try {
      output = execSync('playwright-cli --version', { encoding: 'utf-8' }).trim();
    } catch {
      throw new Error('playwright-cli not found in PATH — install with: npm install -g @playwright/cli');
    }
    // Version output from @playwright/cli looks like "1.59.0-alpha-..."
    expect(output).toMatch(/\d+\.\d+/);
  });
});

describe('bin scripts exist and are executable', () => {
  const scripts = ['open', 'close', 'click-css', 'fill-css', 'upload', 'auth-save', 'auth-load'];

  for (const script of scripts) {
    it(`bin/${script} exists`, () => {
      expect(existsSync(skillPath('bin', script))).toBe(true);
    });

    it(`bin/${script} is executable`, () => {
      expect(isExecutable(skillPath('bin', script))).toBe(true);
    });

    it(`bin/${script} has bash shebang`, () => {
      const content = readFileSync(skillPath('bin', script), 'utf-8');
      expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    });
  }
});

describe('SKILL.md frontmatter', () => {
  let content: string;

  it('SKILL.md exists', () => {
    const path = skillPath('SKILL.md');
    expect(existsSync(path)).toBe(true);
    content = readFileSync(path, 'utf-8');
  });

  it('declares playwright-cli as allowed tool', () => {
    content = readFileSync(skillPath('SKILL.md'), 'utf-8');
    expect(content).toContain('Bash(playwright-cli:*)');
  });

  it('declares bin/ wrapper scripts as allowed tools', () => {
    content = readFileSync(skillPath('SKILL.md'), 'utf-8');
    expect(content).toContain('Bash(bin/open)');
    expect(content).toContain('Bash(bin/close)');
    expect(content).toContain('Bash(bin/click-css)');
    expect(content).toContain('Bash(bin/fill-css)');
    expect(content).toContain('Bash(bin/upload)');
    expect(content).toContain('Bash(bin/auth-save)');
    expect(content).toContain('Bash(bin/auth-load)');
  });

  it('does NOT reference old daemon commands', () => {
    content = readFileSync(skillPath('SKILL.md'), 'utf-8');
    expect(content).not.toContain('npx playwright-skill');
    expect(content).not.toContain('playwright-skill-daemon');
    // '--session' is now a valid bin/open flag; guard against the old daemon form only
    expect(content).not.toContain('playwright-skill --session');
  });
});

describe('skill directory structure', () => {
  const requiredFiles = [
    'SKILL.md',
    'bin/open',
    'bin/close',
    'bin/click-css',
    'bin/fill-css',
    'bin/upload',
    'bin/auth-save',
    'bin/auth-load',
    'skill/REFERENCE.md',
    'skill/AUTH.md',
    '.playwright-skill/.gitkeep',
  ];

  for (const file of requiredFiles) {
    it(`${file} exists`, () => {
      expect(existsSync(skillPath(file))).toBe(true);
    });
  }

  const removedFiles = [
    'src/daemon/Daemon.ts',
    'src/daemon/client.ts',
    'src/daemon-cli.ts',
    'src/cli.ts',
    'src/browser/Context.ts',
    'src/browser/Tab.ts',
  ];

  for (const file of removedFiles) {
    it(`${file} was removed (v1 daemon artifact)`, () => {
      expect(existsSync(skillPath(file))).toBe(false);
    });
  }
});

describe('context capture bin scripts', () => {
  const captureScripts = ['context', 'inject-capture', 'cache-query'];

  for (const script of captureScripts) {
    it(`bin/${script} exists`, () => {
      expect(existsSync(skillPath('bin', script))).toBe(true);
    });

    it(`bin/${script} is executable`, () => {
      expect(isExecutable(skillPath('bin', script))).toBe(true);
    });

    it(`bin/${script} has bash shebang`, () => {
      const content = readFileSync(skillPath('bin', script), 'utf-8');
      expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    });
  }
});

describe('compiled dist entry points', () => {
  const distFiles = ['capture.js', 'inject.js', 'cache-cli.js'];

  for (const file of distFiles) {
    it(`dist/${file} exists (after build)`, () => {
      expect(existsSync(skillPath('dist', file))).toBe(true);
    });
  }
});

describe('SKILL.md capture tool declarations', () => {
  it('declares bin/context as allowed tool', () => {
    const content = readFileSync(skillPath('SKILL.md'), 'utf-8');
    expect(content).toContain('Bash(bin/context)');
  });

  it('declares bin/inject-capture as allowed tool', () => {
    const content = readFileSync(skillPath('SKILL.md'), 'utf-8');
    expect(content).toContain('Bash(bin/inject-capture)');
  });

  it('declares bin/cache-query as allowed tool', () => {
    const content = readFileSync(skillPath('SKILL.md'), 'utf-8');
    expect(content).toContain('Bash(bin/cache-query)');
  });
});

describe('auth profile directory', () => {
  it('.playwright-skill/ directory exists', () => {
    expect(existsSync(skillPath('.playwright-skill'))).toBe(true);
  });

  it('.playwright-skill/auth/ is gitignored', () => {
    const gitignore = readFileSync(skillPath('.gitignore'), 'utf-8');
    expect(gitignore).toContain('.playwright-skill/auth/');
  });

  it('.playwright-cli/ snapshots are gitignored', () => {
    const gitignore = readFileSync(skillPath('.gitignore'), 'utf-8');
    expect(gitignore).toContain('.playwright-cli/');
  });
});
