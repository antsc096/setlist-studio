# Sugar Whiskey Setlist Manager

A setlist builder for The Sugar Whiskey Band, created by Anthony Collins
for the band's sole use. Static pages: no server, no account, no login,
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
  sets with a songs-per-set guide, breaks with lengths, free **note
  lines** between songs ("speeches here") added like breaks, and
  drag-to-reorder across sets. In the Docs copy, note lines sit between
  the tables as their own paragraphs, never inside them.
- Two kinds of song note: the song's own note ("full step down") shows
  on every setlist, and a **note for this setlist only** ("cut it short
  tonight"), entered by tapping the song on a set line, stays with that
  gig and shows in the accent colour. Both carry into the PDF and both
  copy formats.
- Tick **requested by the couple** on a line, **first dance** on the song
  the couple dance to, or **new song** on a song. First dance shows purple
  and bold, new songs red everywhere so the band can see what to learn.
  All three carry through to the PDF and both copy formats, and a
  legend at the foot of the document says what the colours mean.
- **Load default template** fills the document with the band's usual four
  sets plus the extras bench, in one click. Most gigs are a variation on
  it. Songs are matched to the library by title and any the library has
  not met yet are added to it, so it works whatever state a device is in.
- **Crew members**: the people who turn up, saved once. Tap into Crew,
  Sound, Point of contact or MC and their names appear as chips - tap to
  add, tap again to drop. Type someone new and they join the list. Edit
  the list from the ⋯ menu.
- Multiple setlists saved side by side; duplicate one as next gig's
  starting point.

## Song picks from the couple

The couple gets a say before the setlist is built, without an account,
a server, or anything to install. The links themselves carry the data:

1. In the ⋯ menu, **Song picks link for the couple…** builds a link with
   the whole repertoire compressed into it and opens the share sheet.
   Text it to the couple.
2. The couple opens it on the **song picks page** (`request/`, a second
   page in this repo) and taps **PLEASE PLAY** or **HECK NO** on any
   song, then **Send to the band**, which shares a small reply link back.
3. Tapping their reply shows what they picked, with a button into the
   manager. The verdicts land on that gig's setlist and show as green
   and red badges in the library and on set lines while building.

Notes on how it behaves:

- Verdicts belong to the gig, not the library: two gigs in flight keep
  separate picks, and duplicating a setlist does not carry them over.
- A second reply from the same couple replaces the first wholesale.
- Songs are matched by title, so the reply survives library edits; the
  reply names the share it answers, so it finds the right setlist.
- Open the reply on the phone that holds the setlist. If the marks do
  not appear (iPhone home-screen apps keep separate storage from
  Safari), the reply page offers a copyable code for
  ⋯ → **Import song picks…**, which also accepts the whole pasted link.
- The couple's page keeps a draft of their picks in their browser, so
  closing the tab halfway through loses nothing.

### Moving the picks page onto the band's domain

The page works today at the GitHub Pages address. To serve it from
`requests.thesugarwhiskey.com` once there is access to the Wix DNS:

1. Make a new public repo (say `song-requests`) containing a copy of
   the `request/` folder's contents at its root - the folder is
   self-contained on purpose.
2. In the Wix dashboard: Domains → DNS records → add a CNAME,
   host `requests`, value `antsc096.github.io`.
3. In the new repo: Settings → Pages → deploy from the main branch,
   then set the custom domain to `requests.thesugarwhiskey.com` and
   tick "Enforce HTTPS" once the certificate appears.
4. In this repo, change `REQUEST_PAGE_URL` at the top of `app.js` to
   the new address and bump `CACHE` in `sw.js`.

Do not attach the custom domain to *this* repo: that would move the
manager's address too, and every installed copy would start empty.

## Updates

Nobody ever needs to clear a cache. The service worker precaches one
versioned bundle; when a new version is published (any file change plus
a `CACHE` bump in `sw.js`), installed copies download it silently in
the background the next time the app is opened or foregrounded, then
show a banner: **"A new version is ready - Update now."** One tap and
it is live. Without the tap, the new version arrives on the next
app launch anyway.

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

- No build step. `index.html` + `app.css` + `app.js`, with SortableJS,
  jsPDF and lz-string vendored in `vendor/` (all MIT), and Google Sans
  vendored beside them (SIL OFL, from Google Fonts). Nothing loads from
  a CDN: a `fonts.googleapis.com` link would break the offline promise,
  so the woff2 is served from this repo and precached like everything
  else. lz-string squeezes the song picks payloads so a
  152-song link stays near 2 KB.
- `request/` is the couple-facing song picks page: its own small
  `index.html` + `app.css` + `app.js` with copies of the font, brand
  and lz-string, so the folder can be lifted onto the band's domain
  as-is. It is not precached: couples are online, and changes to it
  do not need a `CACHE` bump.
- The band's wordmark lives in `brand/`; the app bar sets it against
  "Setlist Manager".
- `sw.js` precaches every file the page asks for. Add an asset, add it to
  that list and bump `CACHE`, or installed copies keep the old app.
- Data never leaves the device; this repo contains only code and the seed
  song list. The seed lives in `seed.js`, one line per song, with `sung`
  reading the way the band's own sheet does: `'Chris A, Adam G'`.
- To develop, open `index.html` in a browser. That is the whole toolchain.
