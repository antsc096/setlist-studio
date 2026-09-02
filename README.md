# Sugar Whiskey Setlist Manager

A setlist builder for The Sugar Whiskey Band, created by Anthony Collins
for the band's sole use. One static page: no server, no account, no login,
and after the first visit, no network. Everything lives in your browser's
storage on your own device.

**Use it:** https://antsc096.github.io/setlist-studio/

## Installing it

There is nothing to download from a store. Open the link once and add it
to the home screen; from then on it launches like any other app, full
screen and fully offline.

- **Android (Chrome)**: open the link, then the three-dot menu ->
  "Add to Home screen" (Chrome may offer "Install app" instead).
- **iPhone / iPad (Safari)**: open the link in Safari - not Chrome - then
  the share button -> "Add to Home Screen".
- **Windows / Mac (Chrome or Edge)**: open the link, then the install icon
  at the right-hand end of the address bar.
- **Or just use the link.** It works the same in a browser tab; installing
  only gives it an icon and drops the browser chrome.

Each installed copy keeps its own data, so send the band the link and use
**Export backup** to move a shared library between phones.

## What it does

- The band's **repertoire** on the left: search it, tap a song to drop it
  into the highlighted set. It ships with the band's whole list - 152
  songs from the "TSWB Song list and keys" sheet. Each song carries a
  performance note ("full step down") and one row per **singer** - Chris,
  Adam, Church, Jerry, Miranda - each with their own key. Tap a song more
  than one of them sings and it asks who is singing tonight; tap the key
  on a line already in a set to swap singer.
- The **setlist document** on the right: event header (couple, venue,
  date, crew, sound, point of contact, MC, run-sheet notes), any number of
  sets with a songs-per-set guide, breaks with lengths, and drag-to-reorder
  across sets.
- Tick **requested by the couple** on a line, or **new song** on a song -
  new songs show red everywhere so the band can see what to learn.
- Multiple setlists saved side by side; duplicate one as next gig's
  starting point.

## Getting it out

- **PDF**: one tap. On phones it opens the share sheet (straight into
  Drive or a group chat); on computers it downloads.
- **Copy for Docs**: copies the setlist as a formatted table per set that
  pastes straight into a Google Doc, sized to the full page width.
- **Copy for Sheets**: copies the whole setlist as cells that paste
  directly into Google Sheets.
- **Print**: Ctrl/Cmd+P prints the document itself.
- **Backup**: export and import everything as one JSON file; also how data
  moves to another device.

## Notes

- No build step. `index.html` + `app.css` + `app.js`, with SortableJS and
  jsPDF vendored in `vendor/` (both MIT), and Google Sans vendored beside
  them (SIL OFL, from Google Fonts). Nothing loads from a CDN: a
  `fonts.googleapis.com` link would break the offline promise, so the
  woff2 is served from this repo and precached like everything else.
- The band's wordmark lives in `brand/`; the app bar sets it against
  "Setlist Manager".
- `sw.js` precaches every file the page asks for. Add an asset, add it to
  that list and bump `CACHE`, or installed copies keep the old app.
- Data never leaves the device; this repo contains only code and the seed
  song list. The seed lives in `seed.js`, one line per song, with `sung`
  reading the way the band's own sheet does: `'Chris A, Adam G'`.
- To develop, open `index.html` in a browser. That is the whole toolchain.
