# IR35Careers — Waitlist Landing Page

> Find Better UK Contract Jobs. The UK's platform for Inside & Outside IR35 contract opportunities.

A single-page, dark glassmorphic "coming soon" waitlist page built with Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, and Three.js. This is the pre-launch teaser page described in the 14-Day Launch Plan — it is **not** the full job board (search, listings, dashboards); its only job is to collect waitlist signups ahead of launch.

---

## ✨ Features

- **Animated background** — a Three.js glowing light-streak scene behind a glassmorphic signup card
- **Waitlist form** — connected to Supabase, with duplicate-email handling
- **Live countdown** — counts down to a real launch date you configure (see Environment Variables)
- **Real signup count** — shows the actual number of people on the waitlist once there is at least one, instead of a placeholder number
- **Toast notifications** — success/error feedback via react-hot-toast
- **SEO basics** — metadata, Open Graph, Twitter Card, JSON-LD, sitemap, robots.txt

---

## 🛠 Tech Stack

| Technology | Purpose |
|---|---|
| Next.js 15 (App Router) | Framework |
| React 19 | UI Library |
| TypeScript | Type Safety |
| Tailwind CSS | Styling |
| Framer Motion | Countdown entrance animation |
| Lucide Icons | Icon set |
| next-themes | Dark mode provider (wired up, not currently exposed as a toggle on this page) |
| Supabase | Waitlist database |
| react-hot-toast | Toast notifications |
| Three.js | Animated background |

---

## 📁 Project Structure

```
ir35careers/
├── public/
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── app/
│   │   ├── globals.css          # Global styles & Tailwind directives
│   │   ├── layout.tsx           # Root layout, metadata, ThemeProvider, Toaster
│   │   └── page.tsx             # Renders WaitlistExperience — the entire page
│   ├── components/
│   │   ├── CountdownTimer.tsx   # Countdown to NEXT_PUBLIC_LAUNCH_DATE
│   │   ├── ThemeProvider.tsx    # next-themes wrapper
│   │   └── WaitlistExperience.tsx # The whole landing page: background, card, form
│   ├── lib/
│   │   ├── supabase.ts          # Supabase client (lazy-initialised)
│   │   └── utils.ts             # cn() helper + email validation
├── supabase/
│   └── waitlist.sql             # Table, RLS policies, and public count view
├── tailwind.config.ts
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── package.json
├── .env.local.example
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.17 or later
- **npm** (or yarn/pnpm/bun)
- A **Supabase** account (free tier works)

### 1. Install

```bash
cd ir35careers
npm install
```

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Open **SQL Editor** and run the SQL from `supabase/waitlist.sql` (creates the table, Row Level Security policies, and the `waitlist_count` view the homepage reads for the real signup count)
3. Go to **Settings > API** and copy your Project URL and `anon` public key

### 3. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_LAUNCH_DATE=2026-08-15T09:00:00Z
```

**Important:** set `NEXT_PUBLIC_LAUNCH_DATE` to your real, chosen launch date before going live. If it's left unset, the countdown falls back to a rough "N days from whenever the app was last started/deployed" placeholder, which will silently drift on every redeploy.

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 🏗 Build for Production

```bash
npm run build
npm start
```

---

## 🌐 Deployment

### Vercel (recommended — matches the project's Supabase/Vercel free-tier plan)

1. Push this repo to GitHub
2. Import the project at [vercel.com/new](https://vercel.com/new)
3. Add the environment variables from `.env.local` in the Vercel dashboard (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (your real production domain)
   - `NEXT_PUBLIC_LAUNCH_DATE`
4. Deploy

### Other platforms

Any platform that supports Next.js works: Netlify, Railway, AWS Amplify, etc.

---

## 📊 Supabase Schema

See `supabase/waitlist.sql` for the full script. Summary:

```sql
CREATE TABLE waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Row Level Security is enabled with:
- Anonymous **inserts** allowed (the public waitlist form)
- Service role **reads** allowed (admin use)
- A `waitlist_count` view, readable by `anon`, exposing only the total row count — this is what the homepage reads to show a real signup number without exposing any email addresses.

---

## ♿ Accessibility

- Semantic HTML, keyboard-navigable form
- Decorative Three.js background is `aria-hidden`
- Sufficient color contrast on the dark card
- Page allows normal vertical scrolling if content ever exceeds the viewport (short/landscape screens), rather than trapping content off-screen

---

## Notes

- **Domain:** confirmed as `ir35careers.com` — used consistently in metadata, `robots.txt`, and `sitemap.xml`.
- **Launch date:** countdown targets a 30-day launch window from 16 July 2026, i.e. **15 August 2026** (`NEXT_PUBLIC_LAUNCH_DATE=2026-08-15T09:00:00Z`). Update this env var if the target date changes.
- **Theming:** `next-themes` and a `ThemeProvider` are wired up in the root layout, but the current page is unconditionally dark-themed and no light/dark toggle is rendered anywhere. This is harmless as-is, just noting it in case a toggle was expected.

---

## 📄 License

Proprietary. All rights reserved © 2026 IR35Careers.
