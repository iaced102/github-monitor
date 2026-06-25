# OctoFinance — AI-Powered GitHub Copilot FinOps Platform

> **FY26 GitHub Copilot SDK Enterprise Challenge Submission**
> **Repo**: [https://github.com/microsoft/OctoFinance](https://github.com/microsoft/OctoFinance)

## Project Summary

OctoFinance is an AI-powered GitHub Copilot FinOps platform built on the Copilot SDK that transforms how enterprises manage Copilot seat costs at scale. Instead of manually analyzing usage spreadsheets across multiple organizations, administrators simply ask questions in natural language — "Which users haven't used Copilot in 30 days? How much are we wasting?" — and the AI agent autonomously calls 17 custom tools to analyze real-time data from GitHub APIs, identify waste, calculate ROI, and recommend optimizations. A human-in-the-loop approval workflow ensures destructive operations like seat removal require explicit admin confirmation. The platform features a rich analytics dashboard with 9 visualization sections, multi-org/multi-enterprise support with automatic discovery, real-time data synchronization, per-user premium request tracking, and comprehensive audit logging. Built with Python FastAPI, React, and the GitHub Copilot Python SDK, OctoFinance delivers enterprise-grade FinOps automation that turns Copilot cost management from a manual burden into an intelligent, conversational experience.

![alt text](images/chat.png)

![alt text](images/dashboard.png)

---

## Problem & Solution

**Problem**: Enterprises managing hundreds or thousands of Copilot seats across multiple organizations lack unified visibility into usage, waste, and ROI. Manual cost analysis through spreadsheets is time-consuming and error-prone, and premium request costs are hard to track per-user.

**Solution**: An AI-first FinOps platform built on the GitHub Copilot SDK with:
- **Conversational interface** — Ask questions in natural language, get data-driven answers
- **17 custom tools** — Autonomous data analysis via `define_tool()` API
- **Human-in-the-loop** — AI recommends, admin approves before destructive operations
- **9-section dashboard** — Rich analytics with org filtering and date ranges
- **Multi-org management** — Multiple PATs, auto-discovery, cross-org analysis
- **MCP server** — All tools also available via Model Context Protocol

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│              React Frontend (Vite + TypeScript)                     │
│   AI Chat (SSE) · Dashboard (9 sections) · Action Panel · Auth     │
└──────────────────────────┬─────────────────────────────────────────┘
                SSE / REST │
┌──────────────────────────┴─────────────────────────────────────────┐
│              FastAPI Backend (Python 3.13+)                         │
│   Copilot SDK AI Engine (17 tools) · Auth · Sync · PAT Manager     │
│   MCP Server (stdio) · Data Collector · Audit Log                  │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
              GitHub REST API (Seats, Billing, Usage, Metrics, Premium)
                           │
              SQLite Data Store (auto-migrated from JSON)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture diagram, data flow, and project structure.

---

## Key Features

- **Copilot SDK Agentic AI** — 17 custom tools, SSE streaming, session management
- **Analytics Dashboard** — 9 collapsible sections with org filter and date range
- **Multi-Org Management** — Multiple PATs, auto-discovery, enterprise support
- **Human-in-the-Loop** — Recommendation → Review → Approve/Reject workflow
- **Real-Time Sync** — Auto-sync, cron scheduling, SSE progress streaming
- **Premium Request Tracking** — Org-level API data + per-user CSV upload
- **MCP Integration** — All 17 tools available via MCP protocol
- **Security** — Cookie auth, PBKDF2 hashing, audit logging
- **i18n** — English and Chinese (Simplified)
- **Theming** — Dark and Light modes

See [docs/FEATURES.md](docs/FEATURES.md) for detailed feature descriptions and full API reference.

---

## Installation & Production Deployment (Step-by-Step)

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Docker & Docker Compose | 20.10+ / v2+ | Recommended for production |
| Python | 3.13+ | Only if running without Docker |
| Node.js | 22+ | Only for development mode |
| GitHub Copilot CLI | 1.0.51+ | AI engine dependency |
| GitHub PAT | — | Scopes: `read:org`, `admin:org`, `copilot`, `manage_billing:copilot` |

### Step 1: Clone the Repository

```bash
git clone https://github.com/microsoft/OctoFinance.git
cd OctoFinance
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Authentication — choose ONE method:

# Option 1: GitHub App (recommended for production)
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=78901234
GITHUB_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi...

# Option 2: Personal Access Token (simple setup)
GITHUB_PAT=ghp_your_token_here

# Enterprise slug (required if org is under GitHub Enterprise)
ENTERPRISE_SLUG=your-enterprise-slug

# Billing PAT (optional, enables accurate seat counts & AI credits)
# If not set, falls back to GITHUB_PAT automatically
GITHUB_BILLING_PAT=ghp_your_billing_pat_here

# Admin seed user (auto-created on startup)
SEED_USER_ENABLED=true
SEED_USER_USERNAME=admin
SEED_USER_PASSWORD=<strong-password>

# Sync settings
AUTO_SYNC_ON_STARTUP=true
SYNC_CRON=0 */6 * * *
```

**GitHub PAT scopes required:**
- `read:org` — Read organization membership
- `admin:org` — Manage Copilot seats
- `copilot` — Access Copilot usage metrics
- `manage_billing:copilot` — Read billing data and premium requests

**Billing PAT** (classic PAT with `read:enterprise` scope): Enables fetching real Copilot seat assignments and AI credit usage from GitHub Enterprise. Without this, seat counts are estimated from team membership.

### Step 3a: Production Deployment with Docker (Recommended)

```bash
# Build and start the container
docker compose up -d --build

# Verify it's running
docker compose logs -f octofinance
```

The application will be available at `http://your-server:8000`.

**What the Docker build does:**
1. Builds the React frontend (Vite production bundle)
2. Installs Python 3.13 + backend dependencies
3. Installs Node.js 24 + GitHub Copilot CLI
4. Serves the SPA + API on a single port (8000)

**Persistent data** is stored in `./data/` (mounted as a volume):
- SQLite database (seats, usage, metrics, audit logs)
- PAT configurations
- Session data

**Copilot CLI credentials**: The container mounts `~/.copilot` from the host. You must authenticate Copilot CLI on the host first:

```bash
# On the host machine (one-time setup)
npx @github/copilot auth
```

### Step 3b: Production Deployment without Docker

```bash
# 1. Install Python dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# 2. Build the frontend
cd frontend
npm install
npm run build
cd ..

# 3. Install & authenticate GitHub Copilot CLI
npm install -g @github/copilot@1.0.51
copilot  # Follow prompts to authenticate

# 4. Start the production server
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

### Step 4: Reverse Proxy (Production)

For HTTPS, place Nginx or Caddy in front:

```nginx
server {
    listen 443 ssl;
    server_name octofinance.yourcompany.com;

    ssl_certificate     /etc/ssl/certs/octofinance.pem;
    ssl_certificate_key /etc/ssl/private/octofinance-key.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support (for AI chat streaming & sync progress)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Step 5: First Login & Data Sync

1. Open `https://octofinance.yourcompany.com` in your browser
2. Login with the seed user credentials from `.env`
3. If `AUTO_SYNC_ON_STARTUP=true`, data sync starts automatically
4. Otherwise, click **Sync Data** in the status bar to trigger manually
5. Wait for sync to complete (progress shown via SSE streaming)

### Development Mode

```bash
# Terminal 1: Backend with hot reload
source .venv/bin/activate
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend dev server (with HMR)
cd frontend && npm install && npm run dev
```

Dev frontend: http://localhost:5173 (proxies API to :8000)

---

## Dashboard Tabs & Chart Reference

OctoFinance provides **7 dashboard tabs**, each with specialized charts and KPI cards for different analysis angles.

### Tab 1: Metrics (Copilot Usage Analytics)

The primary analytics view for understanding Copilot adoption and productivity.

**KPI Cards:**
| KPI | Description | Business Use |
|-----|-------------|--------------|
| Total Seats | Licensed Copilot seats across all orgs | Budget planning baseline |
| Utilization % | Active seats / Total seats | Identify waste (< 50% = danger zone) |
| Monthly Cost | Total Copilot licensing spend | Budget tracking |
| Monthly Waste | Cost of inactive seats | Direct savings opportunity |
| Acceptance Rate | Code suggestions accepted / generated | Measures AI value delivery |
| Avg DAU | Average daily active users in period | Engagement health metric |
| Total Chats | IDE + dotcom chat interactions | Conversational AI adoption |
| PR Summaries | AI-generated pull request summaries | Feature adoption tracking |

**Charts:**

| Section | Chart | Type | What It Shows |
|---------|-------|------|---------------|
| Active User Trends | Daily Trend | Line | MAU / WAU / DAU / Chat Users / Agent Users over time |
| Code Productivity | LOC Trend | Area | Lines of Code suggested vs accepted per day |
| Code Productivity | Acceptance Rate | Line | Code accept % and LOC accept % trend |
| Feature Usage | Feature Breakdown | Bar | Usage by feature (Chat Agent Mode, Code Completions, CLI, etc.) |
| Feature Usage | Per-User Drilldown | Bar | Click any feature to see per-user breakdown |
| IDE Distribution | IDE Pie | Pie | VS Code vs JetBrains vs Neovim vs others |
| Language Distribution | Language Bar | Bar | Top programming languages by suggestion count |
| Top Users | User Table | Table | Sortable table with per-user acceptance rate, LOC, activity |
| Seat Details | Seat Table | Table | All seats with plan type, last activity, status |

### Tab 2: Premium Requests

Tracks premium model usage and associated costs.

**Charts:**

| Chart | Type | What It Shows |
|-------|------|---------------|
| Daily Premium Requests | Area | Volume of premium model requests over time |
| Model Breakdown | Stacked Bar | Which AI models (GPT-4, Claude, Gemini) are being used |
| Top Users by Premium | Bar | Highest premium request consumers |
| Org Breakdown | Pie | Premium request distribution across organizations |

### Tab 3: Usage Reports

Org-level usage metrics from the GitHub API.

**Charts:**

| Chart | Type | What It Shows |
|-------|------|---------------|
| Suggestions vs Acceptances | Stacked Area | Code generation volume and acceptance |
| Active Users Trend | Line | DAU/WAU per day from API reports |
| Language Breakdown | Bar | Suggestions per programming language |
| Editor Breakdown | Pie | Usage distribution across IDEs |

### Tab 4: Cost Center

Groups seats by cost center / team for budget allocation.

**Features:**
- Assign users to cost centers (Org-level, Team-level, or User-level)
- View cost per cost center with drill-down
- Track unassigned seats (cost leakage)
- Export cost allocation reports per department

### Tab 5: Usage Monitor

Deep-dive into individual usage patterns for identifying adoption issues.

**Charts:**

| Chart | Type | What It Shows |
|-------|------|---------------|
| Model Usage Trend | Stacked Area | Daily requests per AI model |
| Feature Usage Heatmap | Bar | Which Copilot features are most/least used |
| User Activity Matrix | Table | Per-user daily activity with color coding |
| Inactive Users | Table | Users with zero activity in selected period |

### Tab 6: ROI (Return on Investment)

Quantifies the business value of Copilot investment.

**KPI Cards:**
| KPI | Description | Business Use |
|-----|-------------|--------------|
| Acceptance Rate | Overall code suggestion acceptance | Core value metric |
| LOC Accepted | Total lines of AI-generated code accepted | Productivity output |
| Active Users | Users actively using Copilot | Adoption health |
| Cost per Active User | Monthly cost / active users | Efficiency metric |

**Charts:**

| Chart | Type | What It Shows |
|-------|------|---------------|
| Acceptance Rate Trend | Area | Daily acceptance rate evolution |
| Top Users by Acceptance | Bar | Most productive Copilot users |

### Tab 7: Groups (Admin Only)

User group management for scoped analysis. Super-admins can:
- Create groups (by team, project, department)
- Assign users to groups
- Apply group filter across all other tabs for scoped analysis

---

## Use Cases & Business Impact Analysis

### Use Case 1: Waste Identification & Seat Optimization

**Scenario**: Enterprise with 500 Copilot seats at $39/seat/month = $19,500/month

**How to analyze:**
1. Open **Metrics** tab → check **Utilization %** KPI
2. If utilization is 65%, that means 175 seats are idle = **$6,825/month waste**
3. Use the **AI Chat**: "Show me users who haven't used Copilot in the last 30 days"
4. AI returns list with last activity dates
5. Ask: "Recommend seats to remove for users inactive > 45 days"
6. AI creates action recommendations → Review in **Pending Actions** → Approve

**Business Impact:**
- Typical savings: 20-35% of total Copilot spend
- Example: $6,825/month = **$81,900/year** recovered

### Use Case 2: ROI Justification for Leadership

**Scenario**: CTO asks "Is Copilot worth the investment?"

**How to analyze:**
1. Open **ROI** tab → check Acceptance Rate and LOC Accepted
2. Key metrics to present:
   - **Acceptance Rate > 25%** = good adoption (industry average ~27%)
   - **LOC Accepted** = quantifiable productivity output
   - **Cost per Active User** = effective unit cost (vs. sticker price)
3. Calculate developer time saved:
   - Avg developer salary: $150K/year → $75/hour
   - If Copilot saves 30 min/day per active user → $37.50/day saved
   - 200 active users × $37.50 × 22 days = **$165,000/month value**
   - vs. $7,800/month cost (200 × $39) → **21x ROI**

**Presenting to leadership:**
- Export charts from ROI tab (Acceptance Rate Trend shows improvement over time)
- Use Cost per Active User to show effective spend vs. value delivered
- Compare Monthly Waste (preventable) vs. Monthly Cost (total)

### Use Case 3: Adoption Tracking & Enablement

**Scenario**: Rolled out Copilot to 3 new teams, need to measure adoption

**How to analyze:**
1. Create **Groups** for each team in the Groups tab
2. Apply **Group Filter** on the dashboard → view metrics per team
3. Track week-over-week:
   - DAU growth (Active User Trends chart)
   - Feature adoption (which features teams are using)
   - Acceptance Rate (are they finding suggestions useful?)
4. Identify teams with low adoption → target training

**Key indicators of healthy adoption:**
| Metric | Poor | Moderate | Strong |
|--------|------|----------|--------|
| DAU / Total Seats | < 30% | 30-60% | > 60% |
| Acceptance Rate | < 15% | 15-30% | > 30% |
| Features Used | 1-2 | 3-4 | 5+ |
| Week-over-Week Growth | Declining | Flat | Growing |

### Use Case 4: Premium Model Cost Control

**Scenario**: Premium requests (GPT-4, Claude) creating unexpected cost spikes

**How to analyze:**
1. Open **Premium** tab → check daily premium request volume
2. Identify top consumers (Top Users by Premium chart)
3. Check **Model Breakdown** — which models drive cost
4. Use AI Chat: "Which users exceeded 1000 premium requests this month?"
5. Set up **Alerts** for premium usage thresholds
6. Use **Budget Panel** to set per-group spending limits

**Business Impact:**
- Premium models cost 10-50x more per request than standard
- Identifying and coaching top 5% of premium consumers can reduce premium spend by 30-40%

### Use Case 5: Multi-Org Governance

**Scenario**: Enterprise with 5 organizations, each with own Copilot subscription

**How to analyze:**
1. Add PATs for each org in **Settings**
2. OctoFinance auto-discovers all orgs under the enterprise
3. Use **Org Selector** to view cross-org or per-org metrics
4. **Cost Center** tab shows budget allocation across orgs
5. AI Chat: "Compare utilization rates across all organizations"
6. Identify underperforming orgs → drive standardization

### Use Case 6: Periodic Reporting & Compliance

**Scenario**: Monthly FinOps report to finance team

**How to generate:**
1. Set **Month filter** (Chu kỳ) to the reporting period
2. Each tab's data reflects only that month
3. Use **Export CSV** buttons on tables for raw data
4. Use AI Chat: "Generate a monthly summary report for June 2026"
5. AI produces a formatted report with key metrics and recommendations
6. **Report History** panel stores past generated reports

---

## Data Analysis Guide

### Key Metrics & How to Interpret Them

| Metric | Formula | Healthy Range | Action if Outside |
|--------|---------|---------------|-------------------|
| Utilization Rate | Active Seats / Total Seats | > 70% | Remove inactive seats |
| Acceptance Rate | Suggestions Accepted / Suggestions Shown | > 25% | Training needed if low |
| Cost per Active User | Monthly Spend / Active Users | < $50 | Optimize seat allocation |
| Monthly Waste | Inactive Seats × $39 | $0 | Reclaim idle licenses |
| DAU/MAU Ratio | Daily Active / Monthly Active | > 0.5 | Low = sporadic usage |
| Premium Ratio | Premium Requests / Total Requests | < 20% | Monitor cost spikes |

### Analysis Workflow (Recommended)

```
1. Weekly Check (5 min)
   └─ Metrics tab → KPI cards → any red flags?
   └─ Premium tab → any cost spikes?

2. Monthly Review (30 min)
   └─ Set month filter → review all tabs
   └─ ROI tab → prepare leadership metrics
   └─ Generate AI report → share with stakeholders
   └─ Execute pending seat removal recommendations

3. Quarterly Deep-Dive (2 hours)
   └─ Group analysis → team-level adoption comparison
   └─ Feature adoption → identify training gaps
   └─ Cost center allocation → budget reconciliation
   └─ Trend analysis → is adoption growing or stalling?
```

### AI Chat Example Queries

| Goal | Example Query |
|------|---------------|
| Find waste | "Which users have not used Copilot in the last 30 days?" |
| Calculate savings | "How much money can we save by removing inactive users?" |
| Compare teams | "Compare acceptance rates between org-a and org-b" |
| Track adoption | "Show weekly active user trend for the last 3 months" |
| Premium control | "Who are the top 10 premium request users this month?" |
| Budget planning | "What's the projected monthly cost if we add 50 more seats?" |
| Feature insights | "Which Copilot features have the lowest adoption?" |
| Generate report | "Generate a monthly FinOps summary for stakeholders" |

---

## MCP Server

OctoFinance tools can be used via MCP protocol by external LLM clients:

```bash
pip install mcp
python -m backend.app.mcp_server
```

See [mcp.json](mcp.json) for the client configuration example.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/USAGE.md](docs/USAGE.md) | Usage guide — UI walkthrough, chat examples, dashboard |
| [docs/FEATURES.md](docs/FEATURES.md) | Detailed features, tool catalog, API reference |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture diagram, data flow, tech stack, project structure |
| [docs/SECURITY.md](docs/SECURITY.md) | Responsible AI notes, security considerations |
| [AGENTS.md](AGENTS.md) | Custom instructions & agent configuration |
| [mcp.json](mcp.json) | MCP server configuration |

---

*Built with the [GitHub Copilot Python SDK](https://github.com/github/copilot-sdk) for the FY26 GitHub Copilot SDK Enterprise Challenge.*
