# WeChat to Notion

A premium tool to collect WeChat articles and save them directly to your Notion database.

## Features
- 🔗 **Instant Parsing**: Paste any WeChat article URL.
- 🧹 **Smart Cleaning**: Removes clutter, ads, and noise.
- 📝 **Rich Content**: Preserves images, headers, lists, and formatting.
- 🚀 **Notion Sync**: Automatically creates a new page in your database.

## Setup

1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Rename `.env.local.example` to `.env.local` and add your Notion credentials:
   ```bash
   NOTION_API_KEY=your_secret_key
   NOTION_DATABASE_ID=your_database_id
   ```

   > **How to get these?**
   > - **API Key**: Go to [Notion My Integrations](https://www.notion.so/my-integrations), create a new integration.
   > - **Database ID**: Open your Notion database as a full page. The ID is the long string in the URL between `/` and `?`.
   > - **Important**: You must "Add Connection" to your database (Click `...` > Connections > Select your integration).

3. **Run**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Technologies
- Next.js 15 (App Router)
- Framer Motion (Animations)
- Glassmorphism UI (Vanilla CSS)
- Readability & Cheerio (Parsing)
