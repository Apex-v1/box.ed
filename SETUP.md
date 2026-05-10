# Publishing to GitHub — first-time setup

If you've never pushed a project to GitHub before, here's the full sequence.
Pick whichever path matches your comfort level.

---

## Path A: Via the GitHub website (easiest, no terminal)

This path uses GitHub's web UI — no command-line knowledge needed.

### 1. Create the repo on GitHub
- Sign in to github.com (create an account if you haven't)
- Click the **+** in the top-right → **New repository**
- Name it `box-ed` (or whatever you like)
- Description: "Pack your digital things into virtual moving boxes"
- Choose **Public** (so others can see) or **Private** (just you)
- DO NOT check "Initialize with README", "Add .gitignore", or "Add license" —
  the repo I prepared already has all of these
- Click **Create repository**

### 2. Upload the files
- On the new empty repo's page, look for the link
  **"uploading an existing file"** (in the gray box of quick-setup options)
- Drag the entire contents of the `box-ed-repo/` folder into the upload area
- Wait for everything to upload (the model files are the slowest)
- Scroll down, type a commit message like "Initial commit", click
  **Commit changes**

That's it. Your project is now on GitHub. The URL is
`https://github.com/YOUR_USERNAME/box-ed`.

---

## Path B: Via the terminal (more standard, useful long-term)

This path uses Git on the command line. Slightly more setup but it's the
normal way developers work and you'll use it for every future change.

### 1. Install Git
- Mac: comes pre-installed (run `git --version` in Terminal to check)
- Windows: download from [git-scm.com](https://git-scm.com)
- Linux: `sudo apt install git` or equivalent

### 2. Configure Git (one-time, ever)
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

Use the same email you'll use on GitHub.

### 3. Create the repo on GitHub
Same as Path A step 1 — create an empty repo, no auto-files.

### 4. Initialize and push from your local folder
Open Terminal, navigate to wherever you have the `box-ed-repo` folder:

```bash
cd path/to/box-ed-repo
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/box-ed.git
git push -u origin main
```

You'll be asked to authenticate. Modern Git uses a browser auth flow or a
Personal Access Token. If it asks for a password and rejects yours, that's
because GitHub disabled password auth in 2021 — you need to either:
- Set up [GitHub CLI](https://cli.github.com) (`gh auth login`), which handles
  auth automatically, or
- Generate a Personal Access Token at
  [github.com/settings/tokens](https://github.com/settings/tokens) and use it
  in place of your password

GitHub Desktop ([desktop.github.com](https://desktop.github.com)) is also a
fine middle ground — graphical Git client, handles auth painlessly.

---

## Path C: GitHub Desktop (graphical, no terminal)

If you want a GUI but more control than the web UI:

1. Install [GitHub Desktop](https://desktop.github.com)
2. Sign in to your GitHub account inside the app
3. **File → New Repository** → point at the `box-ed-repo` folder you have
4. The app shows all changed files; click **Commit to main**
5. Click **Publish repository** → choose Public or Private → Publish

Same end result, no terminal involved.

---

## After it's on GitHub

### Deploy to Vercel (optional but quick)
- Go to [vercel.com](https://vercel.com), sign in with GitHub
- Click **Add New → Project**
- Pick your `box-ed` repo from the list, click **Import**
- Vercel auto-detects Vite. Click **Deploy**
- ~90 seconds later, you have a live URL like `box-ed.vercel.app`
- Every future `git push` to main auto-deploys

### Run locally
After cloning the repo (or in your local copy), install dependencies and start:
```bash
npm install   # only needed once (or after package.json changes)
npm run dev   # starts the local dev server with hot-reload
```

The terminal will print a URL — usually `http://localhost:5173`. Open it.

### Make changes
1. Edit files in your editor
2. `npm run dev` shows them live in the browser
3. When happy: `git add .`, `git commit -m "describe your change"`, `git push`
4. Vercel auto-deploys the change

---

## Common gotchas

**"Permission denied" when pushing.** You haven't authenticated. Use GitHub
CLI (`gh auth login`) or generate a Personal Access Token.

**"Repository already exists" when running `git remote add`.** You ran the
command twice. Fix with `git remote remove origin` then re-add.

**The deployed site shows a blank page.** Check the Vercel deployment logs
for build errors. Most common: a syntax error in code that worked locally
because you forgot to save a file before testing.

**`npm install` fails on a fresh clone.** Usually a Node version mismatch.
Make sure you have Node 18+. Run `node --version` to check.

**The 3D models don't appear after deploy.** GLB files in `public/models/`
need to actually be committed to the repo. Run `git status` to see if they
were included; if Git is ignoring them, check the `.gitignore`.

---

## What you've now got

A real repository with version history, deployed online, that you can share
with a URL. Every change gets versioned automatically. If you break something
you can revert. If someone wants to contribute, they can fork it.

This is the foundation for everything else — backend, sharing, mobile, real
launch. All happens from this same repo from now on.
