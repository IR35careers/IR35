# IR35Careers Landing Page

> Find Better UK Contract Jobs. The UK's modern platform for Inside & Outside IR35 contract opportunities.

A premium, production-ready landing page built with Next.js 15, React 19, TypeScript, Tailwind CSS, and Framer Motion.

![IR35Careers](https://ir35careers.co.uk/og-image.png)

---

## ✨ Features

- **Premium Design** — Inspired by Apple, Linear, Vercel, Framer, Raycast
- **Glassmorphism** — Frosted glass cards with soft shadows and gradients
- **Animations** — Smooth Framer Motion transitions throughout
- **Dark Mode** — Full dark mode support with next-themes
- **Responsive** — Perfect on desktop, tablet, and mobile
- **SEO Optimised** — Metadata, Open Graph, Twitter Cards, JSON-LD, sitemap
- **Performance** — Optimised fonts, lazy loading, minimal JS
- **Accessibility** — WCAG AA compliant, keyboard navigation, ARIA labels
- **Waitlist Integration** — Connected to Supabase with duplicate prevention

---

## 🛠 Tech Stack

| Technology | Purpose |
|---|---|
| Next.js 15 (App Router) | Framework |
| React 19 | UI Library |
| TypeScript | Type Safety |
| Tailwind CSS | Styling |
| Framer Motion | Animations |
| Lucide Icons | Icon Set |
| next-themes | Dark Mode |
| Supabase | Waitlist Database |
| react-hot-toast | Toast Notifications |

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
│   │   ├── layout.tsx           # Root layout with metadata & providers
│   │   └── page.tsx             # Main landing page
│   ├── components/
│   │   ├── BackgroundEffects.tsx # Animated background with parallax
│   │   ├── FAQ.tsx              # Accordion FAQ section
│   │   ├── Features.tsx         # 6 feature cards grid
│   │   ├── FinalCTA.tsx         # Final call-to-action section
│   │   ├── FloatingPills.tsx    # Animated floating pills around hero
│   │   ├── Footer.tsx           # Site footer
│   │   ├── Hero.tsx             # Hero section with headline & signup
│   │   ├── HowItWorks.tsx       # 3-step process
│   │   ├── Navigation.tsx       # Sticky navigation bar
│   │   ├── SocialProof.tsx      # Trust indicators
│   │   ├── ThemeProvider.tsx     # Dark mode provider
│   │   ├── Timeline.tsx         # Launch roadmap
│   │   └── WaitlistForm.tsx     # Email signup form with Supabase
│   ├── hooks/
│   │   └── useMousePosition.ts  # Mouse tracking hook for parallax
│   ├── lib/
│   │   ├── supabase.ts         # Supabase client
│   │   └── utils.ts            # Utility functions
│   └── types/
│       └── index.ts            # TypeScript interfaces
├── supabase/
│   └── waitlist.sql            # Database schema
├── tailwind.config.ts          # Tailwind configuration
├── next.config.ts              # Next.js configuration
├── postcss.config.mjs          # PostCSS configuration
├── tsconfig.json               # TypeScript configuration
├── package.json                # Dependencies
├── .env.local.example          # Environment variables template
└── README.md                   # This file
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.17 or later
- **npm**, **yarn**, **pnpm**, or **bun**
- A **Supabase** account (free tier works)

### 1. Clone and Install

```bash
cd ir35careers
npm install
```

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Navigate to **SQL Editor** in your Supabase dashboard
3. Copy and run the SQL from `supabase/waitlist.sql`
4. Go to **Settings > API** and copy your:
   - Project URL
   - `anon` public key

### 3. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🏗 Build for Production

```bash
npm run build
npm start
```

---

## 🌐 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Add environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (your production domain)
4. Deploy!

### Other Platforms

The app works on any platform that supports Next.js:
- **Netlify** — via `netlify.toml` or Netlify CLI
- **Railway** — auto-detects Next.js
- **AWS Amplify** — with Next.js adapter

---

## 🎨 Customisation

### Colors

Edit `tailwind.config.ts` to change the color palette. The main colors are:

- **Primary** (indigo) — buttons, accents, links
- **Accent** (teal) — secondary highlights
- **Surface** (slate) — text, backgrounds, borders

### Content

All text content is in the component files under `src/components/`. Key files:

- `Hero.tsx` — Main headline and subheadline
- `Features.tsx` — Feature cards
- `FAQ.tsx` — FAQ questions and answers
- `Timeline.tsx` — Roadmap items

### Animations

All animations use Framer Motion. Adjust timing in individual components or globally via `tailwind.config.ts` keyframes.

---

## 📊 Supabase Schema

```sql
CREATE TABLE waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Row Level Security is enabled with policies for:
- Anonymous inserts (public waitlist form)
- Service role reads (admin dashboard)

---

## ♿ Accessibility

- Semantic HTML throughout
- ARIA labels on interactive elements
- Keyboard navigable
- Focus indicators
- Sufficient color contrast (WCAG AA)
- Screen reader friendly

---

## 📱 Responsive Breakpoints

| Breakpoint | Width |
|---|---|
| Mobile | < 640px |
| Tablet | 640px – 1024px |
| Desktop | > 1024px |

---

## 📄 License

This project is proprietary. All rights reserved © 2026 IR35Careers.

---

## 🤝 Support

For questions or issues, reach out via:
- **Email**: hello@ir35careers.co.uk
- **Twitter**: [@ir35careers](https://twitter.com/ir35careers)

---

Built with ❤️ for UK Contractors
