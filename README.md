# AutoFollowUp AI

Automated lead follow-up SaaS — helps businesses follow up with leads until they respond, book, or are marked dead.

Built with Next.js 14, TypeScript, Supabase, and Tailwind CSS.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the migration file:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
3. In **Authentication > Providers**, make sure Email provider is enabled
4. Copy your project URL and keys from **Settings > API**

### 3. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=any-random-string
```

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and start adding leads.

## License

MIT
