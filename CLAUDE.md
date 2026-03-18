# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DataFlow AI Analyst — an AI-powered database management and analysis platform. Supports MySQL, PostgreSQL, MongoDB, and Redis. Features natural language text-to-SQL, a dashboard builder, and a full database browser/editor.

## Commands

```bash
pnpm dev      # Dev server at localhost:3000
pnpm build    # Production build (standalone output)
pnpm start    # Start production server
pnpm lint     # ESLint (next core-web-vitals + typescript)
```

No test framework is configured.

## Architecture

**Next.js 16 App Router** with React 19, TypeScript, Tailwind CSS 4.

### Client State

- **React Context** (`contexts/`): `ConnectionContext` (database connections, tree data), `TabContext` (open tabs, active tab)
- **Zustand stores** (`stores/`): `useSqlBotStore` (AI conversations, messages, suggestion caching with 5-min TTL), `useAnalysisStore` (dashboards, components, layout)
- Stores use **optimistic updates** — UI updates immediately, then fire-and-forget API calls persist to the backend.

### Server

- **API routes** (`app/api/`): ~72 route handlers organized into:
  - `ai-chat/` — text-to-sql, schema analysis, suggestions
  - `connections/` — CRUD for databases, tables, rows, collections, Redis keys
  - `info/` — metadata endpoints with dynamic route segments
  - `persist/` — conversation, dashboard, and connection persistence (backed by a dedicated MySQL database)
  - `query/` — SQL execution, formatting, saving
  - `schema/` — schema metadata

- **Connection details are passed per-request** in the request body — the server does not store connection credentials. The `Connection` interface is defined in `contexts/ConnectionContext.tsx`.

- **Persistence DB** (`app/api/persist/db.ts`): A separate MySQL database (`dataflow`) stores app metadata (conversations, dashboards, saved queries). Schema is auto-initialized via `initializeDatabase()`.

### AI Layer

`lib/ai/` abstracts across three providers (Anthropic, OpenAI, Ollama). Configuration is entirely via environment variables. Key modules: `config.ts`, `prompts.ts`, `sql-agent.ts`, `suggestions.ts`, `data-profiler.ts`.

### Component Organization

- `components/layout/` — MainLayout, ActivityBar (sidebar nav), Sidebar (tree browser), TabBar, TabContent
- `components/database/` — table/collection/Redis views and CRUD modals (~28 files)
- `components/ai/` — chat interface, message rendering, chart display
- `components/analysis/` — dashboard builder with draggable grid widgets (react-grid-layout)
- `components/ui/` — shared primitives (Button, Input, Badge, Modal, ContextMenu)

### Key Libraries

- **Monaco Editor** for SQL editing
- **ECharts** for data visualization
- **react-grid-layout** for dashboard widget positioning
- **xlsx** for Excel/CSV export

## Environment Variables

Create `.env.local` with:

```bash
# AI Provider: anthropic | openai | ollama
AI_PROVIDER=anthropic
AI_TEMPERATURE=0.1
AI_MAX_TOKENS=2048

# Anthropic
ANTHROPIC_AUTH_TOKEN=...    # or ANTHROPIC_API_KEY
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_BASE_URL=https://api.anthropic.com

# OpenAI (if using)
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-3.5-turbo

# Ollama (if using)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

The persistence database connection is currently hardcoded in `app/api/persist/db.ts`.

## Conventions

- Path alias: `@/*` maps to the project root
- Styling: `cn()` utility from `lib/utils.ts` (clsx + tailwind-merge). CSS variables defined in `app/globals.css` (Nebula Pro Palette).
- Connection types are uppercase enums: `'MYSQL' | 'POSTGRES' | 'MONGODB' | 'REDIS'`
- Standalone output mode (`next.config.ts`) for containerized deployment
- Fonts: Inter (sans) + JetBrains Mono (monospace), loaded via `next/font`
