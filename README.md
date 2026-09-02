# Setlist Studio

A setlist builder for a working band. One static page: no server, no
account, no login, and after the first visit, no network. Everything lives
in your browser's storage on your own device.

**Use it:** https://antsc096.github.io/setlist-studio/

On a phone, open that link once and choose "Add to Home Screen"; it then
opens and works fully offline like an app.

## What it does

- The band's **repertoire** on the left: search it, tap a song to drop it
  into the highlighted set. Each song carries its key, who sings it, and a
  performance note ("full step down").
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
- **Copy for Sheets**: copies the whole setlist as cells that paste
  directly into Google Sheets.
- **Print**: Ctrl/Cmd+P prints the document itself.
- **Backup**: export and import everything as one JSON file; also how data
  moves to another device.

## Notes

- No build step. `index.html` + `app.css` + `app.js`, with SortableJS and
  jsPDF vendored in `vendor/` (both MIT).
- Data never leaves the device; this repo contains only code and the seed
  song list.
- To develop, open `index.html` in a browser. That is the whole toolchain.
