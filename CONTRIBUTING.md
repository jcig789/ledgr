# Contributing to Ledgr

Thanks for your interest in contributing.

## Reporting Issues

Use [GitHub Issues](../../issues) to report bugs or request features. Include:
- Obsidian version and platform (desktop / mobile / OS)
- Steps to reproduce
- What you expected vs. what happened

## Development Setup

Requirements: Node.js 18+, npm.

```bash
git clone https://github.com/jcig789/ledgr
cd ledgr
npm install
```

Create a `.env` file in the repo root:
```
VAULT_PATH=/path/to/your/obsidian/vault
```

Then start the dev build with watch mode:
```bash
npm run dev
```

This compiles `main.js` and copies it (along with `manifest.json` and `styles.css`) into `.obsidian/plugins/ledgr/` in your vault automatically on each change.

## Code Style

- TypeScript throughout
- Obsidian API only — no `document.createElement`, use `el.createDiv()` / `el.createSpan()` / `el.createEl()`
- No external runtime dependencies
- All data stored as plain Markdown or JSON in the vault

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run build` and verify it compiles cleanly
4. Open a pull request with a clear description of what changed and why
