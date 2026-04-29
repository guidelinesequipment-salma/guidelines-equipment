# 🏥 Patient Care Checklist

A web app for managing patient positional, splinting, and speech guidelines across Ward A, Ward B, ICU 1, and ICU 2.

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Set up Supabase (your database)

1. Go to [https://supabase.com](https://supabase.com) and sign in (free account is fine)
2. Click **New Project**, give it a name (e.g. `rehab-checklist`), set a password, choose a region close to you
3. Wait ~2 minutes for the project to be created
4. In the left sidebar, click **SQL Editor**
5. Click **New Query**
6. Open the file `supabase_setup.sql` from this project, copy everything, paste it into the editor, and click **Run**
7. You should see "Success" — your database table is now ready

### Step 2 — Get your Supabase keys

1. In your Supabase project, click ⚙️ **Project Settings** (bottom of left sidebar)
2. Click **API**
3. Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`)
4. Copy the **anon / public** key (a long string starting with `eyJ...`)

### Step 3 — Add your keys to the app

1. Open `config.js` in a text editor (Notepad, VS Code, etc.)
2. Replace `https://YOUR_PROJECT_ID.supabase.co` with your Project URL
3. Replace `YOUR_ANON_PUBLIC_KEY` with your anon key
4. Save the file

It should look like:
```js
const SUPABASE_URL      = 'https://abcdefgh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

### Step 4 — Upload to GitHub

1. Go to [https://github.com](https://github.com) and create a new repository (e.g. `rehab-checklist`)
2. Make it **Public** (required for free Vercel deployment)
3. Upload all these files:
   - `index.html`
   - `style.css`
   - `app.js`
   - `config.js`
   - `supabase_setup.sql` (optional, just for reference)
   - `README.md`

### Step 5 — Deploy on Vercel

1. Go to [https://vercel.com](https://vercel.com) and sign in with your GitHub account
2. Click **Add New → Project**
3. Find your `rehab-checklist` repository and click **Import**
4. Leave all settings as default and click **Deploy**
5. In about 30 seconds, Vercel will give you a live URL like `https://rehab-checklist.vercel.app`
6. Share that URL with your team — everyone uses the same live database!

---

## 📁 File Overview

| File | What it does |
|------|-------------|
| `index.html` | The main page structure |
| `style.css` | All visual styling |
| `app.js` | All the logic (loading, saving, interactions) |
| `config.js` | **Your Supabase keys go here** |
| `supabase_setup.sql` | Run this once in Supabase to create the table |

---

## ✨ Features

- 4 ward tabs: Ward A, Ward B, ICU 1, ICU 2
- Add patients with Name, Room Number, and MRN
- Patient info is **masked by default** — tap 👁 Reveal to see for 8 seconds
- Patients **auto-sort** by room number (alphanumeric)
- **Positional**: Supine / Side-lying checkboxes + free text notes
- **Splinting**: Yes / No + free text notes
- **Speech**: Yes / No + free text notes
- **3-month expiry** bar on each card (turns orange at 14 days, red when expired)
- ✏️ **Edit** any patient's info at any time
- **Real-time sync** — changes appear on all devices instantly
- All data is **saved to Supabase** — nothing is lost on refresh

---

## 🔒 Security Note

The current setup uses open database access (any visitor can read/write). This is fine for internal hospital network use or while testing. If you need proper login/authentication, ask your IT team or a developer to add Supabase Auth to the project.
