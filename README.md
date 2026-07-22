# Scroll — your webtoon reader site

## Run it on your own computer (optional, to test)
```
npm install
npm run dev
```

## Before it works for real
Open `src/firebaseConfig.js` and fill in your own free Firebase project keys
(instructions are in that file's comments). Without this, the site loads but
chapters you add in the Studio won't save or show up for visitors.

## Deploy for free
See the setup guide the artist was given in chat — GitHub + Vercel, both free.

## Studio access
Studio login uses Firebase email/password auth (set this up under Firebase Console →
Authentication → Sign-in method → Email/Password, then add yourself as a user).

## New reader features
- Search + genre filter chips on the homepage
- "Continue Reading" and reading history (stored per-device, no login needed)
- Bookmarks/favorites (also per-device)
- Comments + 5-star ratings on each series
- Series status badges (Ongoing / Completed / Hiatus)
- "NEW" badges + a "Latest Updates" feed for chapters added in the last 3 days
- Share buttons that now link to the exact series/chapter (see routing note below)

## New Studio features
- **Analytics tab** — total views, top series/episodes by views, and a comment feed
  with delete/moderation
- **Reorder series** with the up/down arrows in the Series tab — this sets the order
  they appear in on the homepage
- **Reading status** field per series (Ongoing / Completed / Hiatus)
- **Direct file upload** for cover images, page images, and PDFs (see Cloudinary
  setup below) instead of only pasting URLs
- **Backup/export** — Studio → Settings → download a full JSON copy of your data

## Real URLs (routing fix)
The site now uses hash-based URLs (`yoursite.app/#/series/abc/chapter/xyz`), so:
- The Share button copies a link to the exact series or chapter, not just the homepage
- Refreshing the page keeps you where you were
- Browser back/forward buttons work between pages
No server configuration is needed for this — it works on any static host including
GitHub + Vercel as-is.

## Setting up direct file uploads (free, no credit card)
1. Create a free account at [cloudinary.com](https://cloudinary.com)
2. In the Cloudinary dashboard, go to **Settings → Upload → Upload presets → Add
   upload preset**, set **Signing mode** to **Unsigned**, and save. Note the preset
   name.
3. Note your **Cloud name** shown at the top of the Cloudinary dashboard.
4. In your site, go to **Studio → Settings → File uploads**, paste in your cloud
   name and upload preset, and save.
5. You'll now see "Upload" buttons next to cover image, page image, and PDF fields
   in the Series and Episodes tabs — pick a file from your device instead of
   pasting a URL.

Free tier covers 25GB storage and 25GB bandwidth/month, which is generous for a
manga/webtoon site.

## Important: update your Firestore rules
Comments and view counts are written by anonymous visitors (readers don't log in), so
your Firestore rules need to allow that, while keeping series/chapter edits admin-only.
In Firebase Console → Firestore Database → Rules, use something like:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /site/data {
      allow read: if true;
      allow write: if request.auth != null
        || request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['comments', 'analytics']);
    }
  }
}
```

This lets anyone read the site, lets signed-in Studio users write anything, and lets
anonymous visitors only touch the `comments` and `analytics` fields (not your series
or chapter data). Publish the rule, then comments and view counts will start saving.
