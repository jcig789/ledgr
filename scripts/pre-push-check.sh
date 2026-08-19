#!/bin/bash
# Ledgr Pre-Push Checker
# Run before every push: bash scripts/pre-push-check.sh
# Catches Obsidian store violations before the store does.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"
CSS="$ROOT/styles.css"
ERRORS=0
WARNINGS=0

red()   { echo -e "\033[0;31m$1\033[0m"; }
yellow(){ echo -e "\033[0;33m$1\033[0m"; }
green() { echo -e "\033[0;32m$1\033[0m"; }
bold()  { echo -e "\033[1m$1\033[0m"; }

bold "=== Ledgr Pre-Push Checker ==="
echo ""

# ── ERRORS ────────────────────────────────────────────────────────────────────

bold "── ERRORS (store will reject) ──"

# 1. document.createElement
MATCHES=$(grep -rn "document\.createElement" "$SRC" 2>/dev/null | grep -v "//.*document\.createElement" || true)
if [ -n "$MATCHES" ]; then
  red "ERROR: document.createElement found (use el.createEl() instead)"
  echo "$MATCHES"
  ERRORS=$((ERRORS+1))
fi

# 2. eslint-disable
MATCHES=$(grep -rn "eslint-disable" "$SRC" 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  red "ERROR: eslint-disable comment found (not allowed)"
  echo "$MATCHES"
  ERRORS=$((ERRORS+1))
fi

# 3. window.prompt — skip lines that are comments explaining why we avoid it
MATCHES=$(grep -rn "window\.prompt(" "$SRC" 2>/dev/null | grep -v "^\s*//" | grep -v "//.*window\.prompt" || true)
if [ -n "$MATCHES" ]; then
  red "ERROR: window.prompt() found (use inline input or Modal instead)"
  echo "$MATCHES"
  ERRORS=$((ERRORS+1))
fi

# 4. input.type = x after creation (not inside attr:{}, not comments, not data type migrations)
MATCHES=$(grep -rn "\.type\s*=\s*[\"']" "$SRC" 2>/dev/null \
  | grep -v "attr.*type\|//.*type\|acc\.type\s*=\|a\.type\s*=\|AccountType\|this\.type\s*=\|newType\s*=\|row\.type\s*=" || true)
if [ -n "$MATCHES" ]; then
  red "ERROR: input.type = 'x' after creation found (use createEl('input', { attr: { type: 'x' } }))"
  echo "$MATCHES"
  ERRORS=$((ERRORS+1))
fi

# 5. .style. direct assignment (not setCssStyles)
MATCHES=$(grep -rn "\.style\.[a-zA-Z]* =" "$SRC" 2>/dev/null | grep -v "setCssStyles\|//.*style\." || true)
if [ -n "$MATCHES" ]; then
  red "ERROR: .style.x = value found (use setCssStyles({ x: value }) instead)"
  echo "$MATCHES"
  ERRORS=$((ERRORS+1))
fi

echo ""
bold "── WARNINGS (store may flag) ──"

# 6. createEl("div") or createEl("span")
MATCHES=$(grep -rn '\.createEl("div"\|\.createEl("span"' "$SRC" 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  yellow "WARNING: createEl('div') or createEl('span') found (use createDiv() / createSpan())"
  echo "$MATCHES"
  WARNINGS=$((WARNINGS+1))
fi

# 7. !important in CSS (skip comment lines — any line where !important is not a CSS property value)
MATCHES=$(grep -n "!important" "$CSS" 2>/dev/null | grep -v "avoids \!important\|without needing \!important\|Higher specificity\|\*/\s*$\|^\s*/\*\|^\s*\*" | grep -v "^[^:]*:[^{]*[{]" | grep "[^{]*!important" || true)
if [ -n "$MATCHES" ]; then
  yellow "WARNING: !important found in styles.css (use higher specificity instead)"
  echo "$MATCHES"
  WARNINGS=$((WARNINGS+1))
fi

# 8. scrollbar-width: none (partially supported)
MATCHES=$(grep -n "scrollbar-width:\s*none" "$CSS" 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  yellow "WARNING: scrollbar-width:none found (use ::-webkit-scrollbar{display:none} instead)"
  echo "$MATCHES"
  WARNINGS=$((WARNINGS+1))
fi

# 9. async in addDropdown/addButton onClick callbacks
MATCHES=$(grep -rn "\.onClick(async\|\.addDropdown(async" "$SRC" 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  yellow "WARNING: async callback in addButton/addDropdown — wrap with void instead"
  echo "$MATCHES"
  WARNINGS=$((WARNINGS+1))
fi

# 10. hardcoded hex colors in TypeScript (not in comments)
MATCHES=$(grep -rn "#[0-9A-Fa-f]\{6\}" "$SRC" 2>/dev/null | grep -v "//\|/\*\|\.css\|\.md" || true)
if [ -n "$MATCHES" ]; then
  yellow "WARNING: Hardcoded hex color in TypeScript (use CSS variable instead)"
  echo "$MATCHES"
  WARNINGS=$((WARNINGS+1))
fi

# ── CONSISTENCY ───────────────────────────────────────────────────────────────

echo ""
bold "── CONSISTENCY CHECKS ──"

# All 5 views have Calendar tab
for view in DashboardView NetWorthView StatementsView StandingView CalendarView; do
  file="$SRC/ui/${view}.ts"
  if [ -f "$file" ]; then
    if ! grep -q '"calendar"' "$file"; then
      yellow "WARNING: $view is missing Calendar tab entry"
      WARNINGS=$((WARNINGS+1))
    fi
  fi
done

# All event trigger names match listener names
TRIGGERS=$(grep -rh "workspace\.trigger(" "$SRC" 2>/dev/null | grep -o '"ledgr:[^"]*"' | sort -u || true)
LISTENERS=$(grep -rh "workspace.*\.on(" "$SRC" 2>/dev/null | grep -o '"ledgr:[^"]*"' | sort -u || true)
# Check for triggers with no listener
while IFS= read -r event; do
  if [ -n "$event" ] && ! echo "$LISTENERS" | grep -q "$event"; then
    yellow "WARNING: Event $event is triggered but no view listens for it"
    WARNINGS=$((WARNINGS+1))
  fi
done <<< "$TRIGGERS"

# ── RESULT ────────────────────────────────────────────────────────────────────

echo ""
bold "=== Results ==="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  green "✓ All checks passed. Safe to push."
elif [ $ERRORS -eq 0 ]; then
  yellow "⚠ $WARNINGS warning(s). Review before pushing."
else
  red "✗ $ERRORS error(s), $WARNINGS warning(s). Fix errors before pushing."
  exit 1
fi
