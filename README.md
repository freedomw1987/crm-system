# CRM System

A modern CRM + quotation system with built-in AI Agent for sales teams.
Rebuild of `erp.sme-boardpro.com` CRM with AI-powered quotation assistant, customer analysis, and tool calling.

## Tech Stack

- **Backend**: Bun + Elysia + TypeScript + Prisma + PostgreSQL
- **Frontend**: Vite + React + TypeScript + Tailwind CSS + shadcn/ui
- **AI Agent**: OpenAI function calling (custom-built, lightweight)
- **Infrastructure**: AWS CDK → ECS Fargate + RDS Postgres + S3/CloudFront
- **Monorepo**: Bun workspaces

## Architecture

```
crm-system/
├── apps/
│   ├── api/          # Elysia backend (REST API + AI Agent)
│   └── web/          # React + Vite + Tailwind dashboard
├── packages/
│   ├── db/           # Prisma schema + migrations
│   ├── ai/           # AI Agent core (tools, prompts, memory, RAG)
│   └── shared/       # Shared types / DTOs
├── cdk/              # AWS CDK infrastructure
├── docker/           # Dockerfiles
├── scripts/          # Dev utility scripts
└── docs/             # Development documentation
```

## Data Model

11 core entities (HubSpot/Pipedrive-inspired):

- **User** — System users with RBAC (Admin / Sales / Viewer)
- **Company** — Customer companies
- **Contact** — Customer contacts (multiple per company)
- **Address** — Billing/shipping addresses
- **Tag** — Flexible tags (companies, deals, quotations)
- **Product** — Product catalog (SKU, price, cost, stock)
- **Quotation** — Quotation header (links to company + line items)
- **QuotationItem** — Quotation line items
- **Pipeline** — Sales pipeline configuration
- **Deal** — Sales opportunity (follows pipeline stages)
- **ActivityLog** — All customer/deal interactions
- **Conversation** — AI Agent conversation history

## Local Development

### Prerequisites

- Bun 1.2+
- Docker (for local Postgres)
- Node 20+ (for CDK)

### Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Start Postgres
docker compose up -d

# 3. Copy environment variables
cp .env.example .env
# Edit .env with your OPENAI_API_KEY and other secrets

# 4. Run Prisma migrations
bun run db:migrate

# 5. Seed database (optional)
bun run db:seed

# 6. Start dev servers (API + Web in parallel)
bun run dev
```

### Access

- **Web UI**: http://localhost:5173
- **API**: http://localhost:3001
- **Prisma Studio**: `bun run db:studio` (http://localhost:5555)

## AI Agent Capabilities (Day 1)

The AI Agent can perform these operations via natural language:

1. **Quotation Assistant**
   - "Draft a quotation for ACME Corp with 10 × Widget A"
   - "Show me all open quotations for ABC Ltd"
   - "Add 5 hours of consulting to Q-2024-042"

2. **Customer Analysis**
   - "What's the total revenue from TechCorp in Q4?"
   - "Show top 5 customers by deal value"
   - "Which customers haven't ordered in 6 months?"

3. **Product Recommendations**
   - "What products does ABC Ltd usually buy?"
   - "Suggest upsell opportunities for this deal"

4. **Activity Logging**
   - "I just called John at ACME, he wants a callback tomorrow"
   - "Log an email to Mary about the new pricing"

## Development Status

🚧 **Phase 1: Scaffolding** (in progress)

- [x] Monorepo structure
- [ ] Prisma schema + migrations
- [ ] Elysia API (auth + CRUD)
- [ ] AI Agent core
- [ ] React frontend
- [ ] CDK infrastructure
- [ ] CI/CD
- [ ] QA: Vitest + Playwright

## License

Private — David Chu
