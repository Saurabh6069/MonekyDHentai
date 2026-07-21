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

## Studio password
Default demo password is `manhwa`. Change it in `src/App.jsx` (search for `ADMIN_PASS`)
before sharing your site publicly.
