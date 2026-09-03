# Waymark Proactive In-Flight Continuity
1. Before searching codebase, query `capn_ask` to reuse charted knowledge or trace AST calls.
2. While tracing code, save verified hops via `waymark_note` (path, label, start_line, end_line, inference).
3. After context compaction, call `waymark_resume` to pick up your exact verified breadcrumb trail.
4. When finished, seal with `waymark_complete` to archive findings and chart into Capn.