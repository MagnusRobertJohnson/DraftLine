# 🏒 HockeyPool

A modern, multi-tenant fantasy hockey draft pool platform engineered for both **Web browsers** and **Native iOS & Android mobile devices** with live real-time synchronization.

---

## 🌟 Key Features

1. **Multi-Tenant Email Authentication & Subscriptions**
   - Individual user accounts via email & password.
   - **General Users (Free):** Join unlimited drafts via invite code / link, manage their own team, view live draft boards, and monitor standings.
   - **Administrators (Tiered):**
     - **Basic Tier:** Create & manage up to **3 drafts** per NHL season.
     - **Top Tier:** Create & manage up to **15 drafts** per NHL season.
     - Quota enforcement built directly into Supabase database triggers.

2. **Per-Draft Customization & Isolation**
   - **Season Choice:** Regular Season or Playoff pools.
   - **Roster Configuration:** Custom counts for Forwards, Defensemen, Goalies, and Injured Reserve (IR) slots.
   - **Custom Scoring:** Granular point weights for goals, assists, points, +/-, penalty minutes, blocked shots, hits, goalie wins, shutouts, GAA, save %, and overtime goals/losses.
   - **Salary Cap Support:** Optional salary cap toggle with custom cap ceilings (e.g. $88.0M).

3. **Live Real-Time Draft Room**
   - Administrator inputs picks either from desktop or directly on mobile.
   - Picks broadcast via Supabase Realtime WebSockets to all connected web and mobile participants instantly.
   - Draft undo support and finalization trigger.

4. **In-Season Team Management & Multi-Player IR Swaps**
   - Users manage their own team roster.
   - **Position Parity Rule:** When swapping players between active roster and IR, net position counts must remain balanced (e.g., swapping out 2 forwards and 1 goalie requires replacing them with 2 forwards and 1 goalie).
   - **Salary Cap Compliant:** Projected active roster must remain compliant with the draft's salary cap limit.
   - **Midnight Effective Time:** Swaps take effect at the next midnight (Eastern Time) to prevent swapping players during live games.
   - **Date-Stamped Point Accrual:** Player points are frozen while on IR; newly activated players only accrue points from their activation forward.

5. **Enhanced Salary Management (100-Player Limit Fixed)**
   - Resolves the Spotrac 100-entry scraping limitation by supporting:
     - CSV / Spreadsheet drag & drop import with automated fuzzy player name matching.
     - Direct in-app manual salary overrides.
     - Centralized multi-season salary registry.
   - Ambiguous name matches are saved for administrator review on web and mobile, with player position and season statistics to help identify players. Pending shared salaries are unknown until reviewed; source salaries are possibilities, not verified recommendations.
   - Shared review decisions survive automatic syncs while the matching source data is unchanged. Personal overrides still take precedence for their owner, and locked draft salaries are not changed.

---

## 📁 Repository Structure

```
HockeyPool.Public/
├── supabase/
│   ├── schema.sql        # Complete PostgreSQL database schema, tables, RLS policies, triggers
│   └── functions.sql     # Midnight roster transaction processor stored procedure
├── shared/
│   ├── types.ts          # Core TypeScript models shared across web, mobile, and backend
│   ├── scoring.ts        # Point scoring calculations & standings leaderboard engine
│   ├── roster-validation.ts # Multi-player position parity & salary cap validator
│   ├── salary.ts         # Resilient salary manager (CSV parser + fuzzy matching)
│   ├── nhl.ts            # NHL Official REST API client (skaters & goalies)
│   └── index.ts          # Shared exports
├── web/                  # Next.js App Router Web Application (Desktop & Mobile Browser)
│   ├── src/app/          # Landing, Dashboard, Draft Board, Admin Console, Roster & IR, Standings
│   ├── src/lib/          # Supabase client/server/admin instances
│   └── package.json
└── mobile/               # React Native / Expo Native Mobile Application (iOS & Android)
    ├── App.tsx           # Mobile live draft board, team manager, & join code handler
    ├── app.json
    └── package.json
```

---

## 🚀 Getting Started

### 1. Database Setup (Supabase)
1. Log in to [Supabase](https://supabase.com) and create a new project.
2. Open the **SQL Editor** in your Supabase dashboard.
3. Run the contents of [`supabase/schema.sql`](/supabase/schema.sql).
4. Run the contents of [`supabase/functions.sql`](/supabase/functions.sql).
5. Run [`supabase/salary_ambiguity_review.sql`](./supabase/salary_ambiguity_review.sql).
6. Copy your **Project URL**, **Anon Key**, and **Service Role Key** from **Project Settings** ➔ **API**.

For an existing database, run only `salary_ambiguity_review.sql` in the SQL Editor before deploying the updated web application; do not rerun the full schema. After a salary sync, administrators can open **Review players** on the players screen to confirm a previous shared salary, choose a source salary, enter a shared correction, or mark each player unknown. If the underlying ambiguous source data changes, that group requires review again.

### 2. Running the Web Application
```bash
cd web
npm install
# Create .env.local with your Supabase credentials:
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Running the Mobile Application (Expo)
```bash
cd mobile
npm install
# Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your environment
npx expo start
```
Scan the QR code using the **Expo Go** app on iOS or Android, or run on an emulator (`a` for Android, `i` for iOS).

---

## ⏰ Midnight IR Swap Scheduler
To execute pending roster swaps every night at midnight Eastern Time, configure a cron job or scheduled HTTP GET request pointing to:
```
GET /api/cron/roster-swaps
Authorization: Bearer <YOUR_CRON_SECRET>
```
Or schedule `public.apply_due_roster_transactions()` via Supabase `pg_cron`.
