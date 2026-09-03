# Claude Code Integration (Tier 1 & Tier 3)

## 1. Tier 1: Post-Compact Lifecycle Hook
Register in `.claude/config.json`:
```json
{
  "hooks": {
    "post_compact": "node <path-to-waymark>/scripts/hooks/waymark-compact-hook.mjs --format=markdown"
  }
}
```

## 2. Tier 3: Persistent Directive
Place `CLAUDE.md` in your project root to prime Claude Code with the 4-step Proactive Directive.