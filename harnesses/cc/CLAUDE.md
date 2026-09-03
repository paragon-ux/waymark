# Waymark Proactive In-Flight Continuity Directive

You have access to the `waymark` and `capn-mcp` MCP servers. Follow this 4-step directive for code investigations:

1. **Before searching codebase:** Query `capn_ask` to reuse charted knowledge or trace AST calls.
2. **While tracing code:** Save verified hops via `waymark_note` (path, label, start_line, end_line, inference).
3. **After context compaction:** Call `waymark_resume` to pick up your exact verified breadcrumb trail.
4. **When finished:** Seal with `waymark_complete` to archive findings and chart into Capn memory.