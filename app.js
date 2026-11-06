/* Setlist Studio
   One page, no server, no accounts. State lives in localStorage and is
   saved on every change; a JSON backup moves it between devices when that
   day comes. The document on the right is the artefact; the library on the
   left is the band's repertoire feeding it. */

(() => {
  'use strict';

  const STORE_KEY = 'setlist-studio.v1';

  // Where the couple-facing song picks page lives: the band website's page.
  // For the concept demo that is the website's local preview server, so
  // the link only opens on the computer running it. When the new site goes
  // live, change this to https://www.thesugarwhiskey.com/song-picks.html
  // and bump the service worker cache version. The couple's reply still
  // comes back through this app's own request/ page.
  const REQUEST_PAGE_URL = 'http://localhost:8765/song-picks.html';
  // The couple's "Send to the band" lands here, and this app checks it
  // while any gig has a picks link out. Concept demo: it is the website's
  // local demo server (tools/demo-server.mjs in the website project); a
  // real backend replaces it when the site goes live.
  const PICKS_INBOX_URL = 'http://localhost:8765/api/picks';

  // Who turns up. Every name field offers these instead of typing, and
  // anyone typed in who is not on the list joins it.
  const DEFAULT_CREW = ['Ant', 'Ris', 'Jord', 'Adam', 'Church', 'Chris',
    'Haley', 'Jerry'];
  const NAME_FIELDS = ['hCrew', 'hSound', 'hContact', 'hMc'];

  // --- State --------------------------------------------------------------

  let state = null;

  let uidCounter = 0;
  const uid = () =>
    Date.now().toString(36) + '-' + (uidCounter++).toString(36);

  // A gig's first dance, and its father and daughter dance: one of the
  // library's songs (mode "list") or a song named by hand (mode "own"),
  // with notes for the band. Each is set from its field at the top of the
  // setlist, or by the couple's picks (from), and marks its song's line.
  // `mark` flags the line; `line`, `added` and `note` remember which line
  // the field marked, whether it added it, and the notes it put there.
  const DANCES = {
    firstDance: { mark: 'firstDance', line: 'danceLine', added: 'danceAdded', note: 'danceNote' },
    fatherDaughter: { mark: 'fatherDaughter', line: 'fdLine', added: 'fdAdded', note: 'fdNote' },
  };
  const noDance = () =>
    ({ mode: '', songId: '', title: '', artist: '', notes: '', from: 'band' });
  // A couple's dance as words ("Perfect (Ed Sheeran)"), whichever way it came.
  const danceText = (fd) => (!fd ? '' : typeof fd === 'string' ? fd
    : (fd.title || '') + (fd.artist ? ' (' + fd.artist + ')' : ''));

  function defaultDoc() {
    // Four sets of twelve: the shape of the real sheet this replaces.
    const doc = {
      id: uid(),
      header: {
        couple: '', names: '', venue: '', date: '', crew: '',
        sound: '', contact: '', mc: '', notes: '',
      },
      firstDance: noDance(),
      fatherDaughter: noDance(),
      numSets: 4,
      songsPerSet: 12,
      sets: [],
      activeSet: 0,
    };
    for (let i = 0; i < doc.numSets; i++) {
      doc.sets.push({ label: 'SET ' + (i + 1), items: [] });
    }
    return doc;
  }

  // The seed file writes each song's singers as "Chris A, Adam G" - one
  // name and key per singer. A name on its own is a singer whose key the
  // band never wrote down.
  function parseSung(sung) {
    return String(sung || '').split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const bits = entry.split(/\s+/);
        const key = bits.length > 1 ? bits.pop() : '';
        return { id: uid(), singer: bits.join(' '), key };
      });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        migrate();
        save();
        return;
      }
    } catch (e) { /* fall through to a fresh start */ }
    state = {
      library: SEED_LIBRARY.map((s) => ({
        id: uid(),
        title: s.title,
        parts: parseSung(s.sung),
        note: s.note || '',
        isNew: false,
      })),
      docs: [defaultDoc()],
      crew: DEFAULT_CREW.slice(),
      activeDocId: null,
    };
    state.activeDocId = state.docs[0].id;
    save();
  }

  function save() {
    if (hub) { scheduleHubSave(); return; }
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  // --- The hub's database -------------------------------------------------
  //
  // Opened inside the band manager hub (at /studio/), the setlists live in
  // the hub's database, never this browser: every device sees the same
  // ones, and the band's gig pages read them. Each change goes up a moment
  // after it's made. A save from setlists someone else has changed since is
  // refused, and the newer ones load instead. Standalone (GitHub Pages)
  // there's no hub, and everything stays in this browser as before.
  const IN_HUB = /^\/studio(\/|$)/.test(location.pathname);
  const HUB_API = '/api/admin/studio';
  const MOVED_KEY = 'setlist-studio.moved-to-hub';
  let hub = null;  // { savedAt } once the hub's setlists are loaded
  let hubTimer = null;
  let hubBusy = false;
  let hubAgain = false;

  // Opened from a gig in the hub (#gig=ID, with &doc=ID to link a setlist
  // that has no gig yet): that gig's own setlist, made from its details
  // when it has none. The hub chooses the gig, so the picker and New,
  // Duplicate and Delete aren't shown.
  const EMBED = new URLSearchParams(location.search).has('embed');
  const opened = new URLSearchParams(location.hash.slice(1));
  const GIG = IN_HUB ? opened.get('gig') : null;
  const LINK_DOC = opened.get('doc');

  const hubGet = () => fetch(HUB_API, { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  function scheduleHubSave() {
    clearTimeout(hubTimer);
    hubTimer = setTimeout(hubSave, 700);
  }

  function hubSave() {
    clearTimeout(hubTimer);
    hubTimer = null;
    if (hubBusy) { hubAgain = true; return; }
    hubBusy = true;
    const body = JSON.stringify(Object.assign({}, state, { baseSavedAt: hub.savedAt }));
    fetch(HUB_API, {
      method: 'PUT', credentials: 'same-origin', body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: body.length < 60000,
    }).then((r) => r.json().catch(() => ({})).then((data) => {
      if (r.ok) {
        hub.savedAt = state.savedAt = data.savedAt;
        // Each setlist's last change, as the hub stamped it.
        for (const d of state.docs) if (data.updated && data.updated[d.id]) d.updatedAt = data.updated[d.id];
        return;
      }
      if (r.status === 409 && data.current) {
        hubAgain = false;
        adoptHub(data.current);
        toast('These setlists were just changed on another device, so they\'ve been reloaded. Make your last change again.');
        return;
      }
      throw new Error(data.error || r.status);
    })).catch(() => {
      toast('Not saved yet: can\'t reach the hub. Trying again…');
      setTimeout(scheduleHubSave, 5000);
    }).then(() => {
      hubBusy = false;
      if (hubAgain) { hubAgain = false; hubSave(); }
    });
  }

  // For the hub's "Save and send to band": resolves once every change is
  // saved (a waiting one goes now); fails if the hub can't be reached.
  window.studioSaved = () => new Promise((resolve, reject) => {
    if (!hub) { resolve(); return; }
    if (hubTimer) hubSave();
    const started = Date.now();
    (function check() {
      if (!hubTimer && !hubBusy) { resolve(); return; }
      if (Date.now() - started > 15000) { reject(new Error('The setlist couldn\'t be saved: check the connection and try again.')); return; }
      setTimeout(check, 100);
    })();
  });

  // Someone else's newer setlists, in place of these. This device stays
  // on the setlist it had open.
  function adoptHub(value) {
    const mine = state && state.activeDocId;
    state = value;
    migrate();
    if (mine && state.docs.some((d) => d.id === mine)) state.activeDocId = mine;
    hub.savedAt = value.savedAt || 0;
    renderAll();
    if (GIG) openGig().then((changed) => { if (changed) { save(); renderAll(); } });
  }

  // Changes saved on another device, picked up when this one comes back to
  // the foreground (not while something's being typed or saved).
  function hubRefresh() {
    if (!hub || document.hidden || hubTimer || hubBusy) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
    hubGet().then((value) => {
      if (value && value.savedAt && value.savedAt !== hub.savedAt && !hubTimer && !hubBusy) adoptHub(value);
    }).catch(() => {});
  }

  // What this browser kept before the hub did, if anything.
  function readLocal() {
    try {
      const local = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!local || !Array.isArray(local.docs) || !Array.isArray(local.library)) return null;
      const keep = state;
      state = local;
      migrate();
      state = keep;
      return local;
    } catch (e) { return null; }
  }

  const songsIn = (d) => d.sets.reduce((n, set) =>
    n + set.items.filter((i) => !i.brk && !i.noteRow).length, 0);

  // Setlists made in this browser while Setlist Manager kept them here
  // join the hub's, once per browser, so nothing made here is lost: any
  // the hub doesn't have, and a copy of any it has in another version,
  // marked as from this device. Songs they use that the hub's library
  // doesn't have come with them.
  function mergeLocal(local) {
    let added = 0;
    const byTitle = titleIndex();
    const same = (a, b) => JSON.stringify([a.header, a.sets]) === JSON.stringify([b.header, b.sets]);
    for (const d of local.docs) {
      if (!songsIn(d)) continue;
      const there = state.docs.find((x) => x.id === d.id);
      if (there && same(there, d)) continue;
      const copy = JSON.parse(JSON.stringify(d));
      if (there || (copy.gigId && state.docs.some((x) => x.gigId === copy.gigId))) {
        copy.id = uid();
        delete copy.gigId;
        copy.header.couple = (copy.header.couple || 'Untitled') + ' (from this device)';
      }
      for (const set of copy.sets) {
        set.items = set.items.filter((item) => {
          if (item.brk || item.noteRow) return true;
          const mine = local.library.find((s) => s.id === item.songId);
          if (!mine) return false;
          let song = state.library.find((s) => s.id === mine.id) || byTitle.get(normTitle(mine.title));
          if (!song) {
            song = JSON.parse(JSON.stringify(mine));
            state.library.push(song);
            byTitle.set(normTitle(song.title), song);
          }
          const part = mine.parts.find((p) => p.id === item.partId);
          let match = part && (song.parts.find((p) => p.id === part.id) ||
            song.parts.find((p) => p.singer === part.singer && p.key === part.key));
          if (part && !match) { match = Object.assign({}, part); song.parts.push(match); }
          item.songId = song.id;
          if (match) item.partId = match.id; else delete item.partId;
          return true;
        });
      }
      state.docs.push(copy);
      added++;
    }
    return added;
  }

  // The gig's setlist made the active one: linked, or made from the gig.
  // Returns a promise of whether anything changed.
  function openGig() {
    let d = state.docs.find((x) => x.gigId === GIG);
    let changed = false;
    if (!d && LINK_DOC) {
      d = state.docs.find((x) => x.id === LINK_DOC && !x.gigId);
      if (d) { d.gigId = GIG; changed = true; }
    }
    if (d) {
      state.activeDocId = d.id;
      return Promise.resolve(changed);
    }
    return fetch('/api/admin/gigs/' + encodeURIComponent(GIG), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((g) => {
        if (state.docs.some((x) => x.gigId === GIG)) return openGig();
        const fresh = defaultDoc();
        fresh.gigId = GIG;
        // A rehearsal's list is the songs to rehearse, not four sets.
        if (g && g.kind === 'rehearsal') {
          fresh.sets = [{ label: 'SONGS TO REHEARSE', items: [] }];
          fresh.numSets = 1;
          fresh.songsPerSet = 30;
        }
        if (g) {
          fresh.header.couple = g.title || '';
          fresh.header.names = (g.names || []).filter(Boolean).join(' & ');
          fresh.header.venue = g.venue || '';
          fresh.header.date = g.date ? new Date(g.date + 'T00:00').toLocaleDateString('en-AU',
            { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
        }
        state.docs.push(fresh);
        state.activeDocId = fresh.id;
        return true;
      });
  }

  // Inside the hub the couple's picks arrive at the hub, not here: their
  // dances fill this gig's dance fields that are still empty.
  function dancesFromGig() {
    if (!GIG) return;
    fetch('/api/admin/gigs/' + encodeURIComponent(GIG), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((g) => {
        // The dances are a wedding's (or a gig whose kind isn't set yet).
        document.body.classList.toggle('no-dances', !!(g && g.kind && g.kind !== 'wedding' && g.kind !== 'unset'));
        const picks = g && g.picks;
        const d = state.docs.find((x) => x.gigId === GIG);
        if (!picks || !d) return;
        let changed = false;
        for (const key of Object.keys(DANCES)) {
          const theirs = danceFromPicks(picks[key]);
          if (theirs && !(d[key] && d[key].mode)) { setDance(d, key, theirs); changed = true; }
        }
        if (changed) { save(); renderAll(); }
      }).catch(() => {});
  }

  function startHub() {
    if (EMBED) document.body.classList.add('embedded');
    hubGet().then((value) => {
      const local = readLocal();
      const fromHub = value && Array.isArray(value.docs) && Array.isArray(value.library);
      if (fromHub) {
        state = value;
      } else {
        // The hub's first setlists: this browser's, or a fresh start.
        load();
      }
      const before = JSON.stringify(state);
      migrate();
      hub = { savedAt: (fromHub && value.savedAt) || 0 };
      let moved = 0;
      if (fromHub && local && !localStorage.getItem(MOVED_KEY)) moved = mergeLocal(local);
      localStorage.setItem(MOVED_KEY, String(Date.now()));
      return (GIG ? openGig() : Promise.resolve(false)).then((changed) => {
        if (changed || !fromHub || JSON.stringify(state) !== before) hubSave();
        renderAll();
        ready();
        dancesFromGig();
        if (moved) {
          toast(moved + ' setlist' + (moved === 1 ? '' : 's') + ' saved only in this browser ' +
            (moved === 1 ? 'is' : 'are') + ' now in the hub too.');
        }
      });
    }).catch(() => {
      document.body.classList.add('hub-down');
      const msg = el('div', 'hub-down-msg');
      msg.appendChild(el('b', null, 'Can\'t reach the hub\'s setlists.'));
      msg.appendChild(el('span', null, 'Check the connection (or sign in to the hub again), then reload.'));
      const again = el('button', 'primary', 'Reload');
      again.addEventListener('click', () => location.reload());
      msg.appendChild(again);
      document.body.appendChild(msg);
    });
    window.addEventListener('pagehide', () => { if (hubTimer) hubSave(); });
    document.addEventListener('visibilitychange', hubRefresh);
    setInterval(hubRefresh, 30000);
  }

  const doc = () =>
    state.docs.find((d) => d.id === state.activeDocId) || state.docs[0];

  const songById = (id) => state.library.find((s) => s.id === id) || null;

  // A song is sung by one or more people, each in their own key: that pair
  // is a "part". Older saves carried a single key/singer on the song, so
  // they are folded into one part here and the old fields dropped.
  function migrate() {
    if (!state || !Array.isArray(state.library)) return;
    if (!Array.isArray(state.crew)) state.crew = DEFAULT_CREW.slice();
    // The first dance was a "1st" tick on any line; it is a field at the
    // top of the setlist now, and the field marks its line.
    for (const d of (state.docs || [])) {
      // An earlier version kept the couple's first names in two fields.
      const h = d.header || {};
      if (!h.names && (h.name1 || h.name2)) h.names = [h.name1, h.name2].filter(Boolean).join(' & ');
      if (!d.fatherDaughter) d.fatherDaughter = noDance();
      if (d.firstDance && d.firstDance.mode) continue;
      d.firstDance = d.firstDance || noDance();
      for (const set of (d.sets || [])) {
        for (const item of (set.items || [])) {
          if (!item.firstDance || d.firstDance.mode) continue;
          const song = state.library.find((x) => x.id === item.songId);
          if (!song) continue;
          item.danceLine = true;
          Object.assign(d.firstDance, { mode: 'list', songId: song.id, title: song.title });
        }
      }
    }
    // The template used to carry a "First Dance" placeholder song. The
    // first dance is a mark on a real song now, so the stray library entry
    // and any line pointing at it go. Once per device, never again.
    if (!state.droppedFirstDancePlaceholder) {
      state.droppedFirstDancePlaceholder = true;
      const stray = state.library.filter(
        (s) => s.title === 'First Dance' && !s.parts.length);
      for (const gone of stray) {
        state.library = state.library.filter((s) => s !== gone);
        for (const d of (state.docs || [])) {
          for (const set of (d.sets || [])) {
            set.items = set.items.filter(
              (i) => i.brk || i.songId !== gone.id);
          }
        }
      }
    }
    for (const song of state.library) {
      if (!Array.isArray(song.parts)) {
        song.parts = (song.singer || song.key)
          ? [{ id: uid(), singer: song.singer || '', key: song.key || '' }]
          : [];
      }
      for (const part of song.parts) if (!part.id) part.id = uid();
      delete song.singer;
      delete song.key;
    }
    for (const d of (state.docs || [])) {
      for (const set of (d.sets || [])) {
        for (const item of set.items) {
          if (item.brk || item.partId) continue;
          const song = songById(item.songId);
          if (song && song.parts.length) item.partId = song.parts[0].id;
        }
      }
    }
    // The first release seeded 53 songs; the full repertoire came later,
    // but the seed only fills an empty library, so early devices never got
    // it. Add whatever is missing, once per device, so songs deleted after
    // this point stay deleted.
    if (!state.toppedUpFullRepertoire) {
      state.toppedUpFullRepertoire = true;
      const have = new Set(titleIndex().keys());
      for (const s of SEED_LIBRARY) {
        if (have.has(normTitle(s.title))) continue;
        have.add(normTitle(s.title));
        state.library.push({
          id: uid(),
          title: s.title,
          parts: parseSung(s.sung),
          note: s.note || '',
          isNew: false,
        });
      }
    }
  }

  const BLANK_PART = { id: '', singer: '', key: '' };

  // Which singer this line is pinned to. A line whose singer has since been
  // deleted falls back to the first, rather than showing nothing.
  function partFor(song, item) {
    if (!song || !song.parts || !song.parts.length) return BLANK_PART;
    if (item && item.partId) {
      const hit = song.parts.find((p) => p.id === item.partId);
      if (hit) return hit;
    }
    return song.parts[0];
  }

  // --- DOM handles --------------------------------------------------------

  // A crew field holds a list of people: "Ant & Ruddy", "Ruddy, Anthony".
  const splitNames = (value) => String(value || '')
    .split(/[,&]|\band\b/i).map((n) => n.trim()).filter(Boolean);
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const normTitle = (t) => String(t).toLowerCase()
    .replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

  function rememberCrew(value) {
    let added = false;
    for (const name of splitNames(value)) {
      if (name.length > 40) continue;
      if (!state.crew.some((c) => sameName(c, name))) {
        state.crew.push(name);
        added = true;
      }
    }
    return added;
  }

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const headerFields = [
    ['hCouple', 'couple'], ['hNames', 'names'],
    ['hVenue', 'venue'], ['hDate', 'date'],
    ['hCrew', 'crew'], ['hSound', 'sound'], ['hContact', 'contact'],
    ['hMc', 'mc'], ['hNotes', 'notes'],
  ];

  // --- Rendering ----------------------------------------------------------

  function renderAll() {
    renderDocPicker();
    renderHeader();
    renderScaffold();
    renderSets();
    renderLibrary();
  }

  function renderDocPicker() {
    const picker = $('#docPicker');
    picker.innerHTML = '';
    for (const d of state.docs) {
      const opt = el('option', null, d.header.couple || 'Untitled setlist');
      opt.value = d.id;
      picker.appendChild(opt);
    }
    picker.value = doc().id;
  }

  function renderHeader() {
    for (const [id, field] of headerFields) {
      $('#' + id).value = doc().header[field] || '';
    }
    renderDances();
    const d = doc();
    const line = $('#hPicks');
    line.classList.toggle('hidden', !d.clientPicksWhen);
    if (!d.clientPicksWhen) return;
    const v = Object.values(d.clientVerdicts || {});
    line.textContent = 'Song picks from ' + (d.clientPicksFrom || 'the couple') +
      ', ' + new Date(d.clientPicksWhen).toLocaleString('en-AU', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      }) + ': ' + v.filter((x) => x === 'please').length + ' PLEASE PLAY, ' +
      v.filter((x) => x === 'no').length + ' HECK NO' +
      (d.clientFirstDance ? '. First dance: ' + danceText(d.clientFirstDance) : '') +
      (d.clientFatherDaughter ? '. Father & daughter dance: ' + danceText(d.clientFatherDaughter) : '') + '.';
  }

  function renderScaffold() {
    $('#numSets').value = doc().numSets;
    $('#songsPerSet').value = doc().songsPerSet;
  }

  let sortables = [];

  function renderSets() {
    for (const s of sortables) s.destroy();
    sortables = [];

    const host = $('#sets');
    host.innerHTML = '';
    const d = doc();
    if (d.activeSet >= d.sets.length) d.activeSet = 0;

    d.sets.forEach((set, setIndex) => {
      const section = el('div', 'set');

      const head = el('div', 'set-head' +
        (setIndex === d.activeSet ? ' active-target' : ''));
      const label = el('input', 'set-label');
      label.value = set.label;
      label.addEventListener('input', () => { set.label = label.value; save(); });
      label.addEventListener('focus', () => setActiveSet(setIndex, false));
      head.appendChild(label);

      const songCount = set.items.filter((i) => !i.brk && !i.noteRow).length;
      const count = el('span',
        'set-count' + (songCount > d.songsPerSet ? ' over' : ''),
        songCount + ' / ' + d.songsPerSet);
      head.appendChild(count);

      const tools = el('div', 'set-tools');
      const addBreak = el('button', null, '+ break');
      addBreak.title = 'Add a break to this set';
      addBreak.addEventListener('click', () => {
        set.items.push({ brk: true, label: 'Break', minutes: 15 });
        setActiveSet(setIndex, false);
        save(); renderSets();
      });
      tools.appendChild(addBreak);
      const addNote = el('button', null, '+ note');
      addNote.title = 'Add a note line to this set';
      addNote.addEventListener('click', () => {
        set.items.push({ noteRow: true, text: '' });
        setActiveSet(setIndex, false);
        save(); renderSets();
      });
      tools.appendChild(addNote);
      const rmSet = el('button', null, '✕');
      rmSet.title = 'Remove this set';
      rmSet.addEventListener('click', () => {
        if (set.items.length &&
            !confirm('Remove "' + set.label + '" and its ' +
              set.items.length + ' items?')) return;
        d.sets.splice(setIndex, 1);
        d.numSets = d.sets.length;
        if (d.activeSet >= d.sets.length) d.activeSet = d.sets.length - 1;
        save(); renderAll();
      });
      tools.appendChild(rmSet);
      head.appendChild(tools);

      head.addEventListener('click', (e) => {
        if (e.target === head || e.target === count) {
          setActiveSet(setIndex, true);
        }
      });
      section.appendChild(head);

      const list = el('ul', 'set-items');
      list.dataset.set = setIndex;

      let number = 0;
      set.items.forEach((item, itemIndex) => {
        list.appendChild(item.brk ? renderBreak(set, item, itemIndex)
          : item.noteRow ? renderNoteRow(set, item, itemIndex)
          : renderEntry(set, item, itemIndex, ++number, setIndex));
      });
      section.appendChild(list);

      sortables.push(new Sortable(list, {
        group: 'sets',
        handle: '.grip',
        animation: 140,
        // A song dragged in from the library, dropped just here.
        onAdd: (evt) => {
          if (evt.from !== $('#libList')) return;
          const song = songById(evt.item.dataset.songId);
          evt.item.remove();
          if (song) addSongAt(song, Number(evt.to.dataset.set), evt.newIndex);
          else renderSets();
        },
        onEnd: (evt) => {
          const fromSet = d.sets[Number(evt.from.dataset.set)];
          const toSet = d.sets[Number(evt.to.dataset.set)];
          const [moved] = fromSet.items.splice(evt.oldIndex, 1);
          toSet.items.splice(evt.newIndex, 0, moved);
          save(); renderSets(); renderLibrary();
        },
      }));

      host.appendChild(section);
    });

    // The legend earns its place only when a marked song is on the list,
    // and then names only the marks in use - same rule as the PDF's.
    let anyReq = false;
    let anyDance = false;
    let anyNew = false;
    for (const set of d.sets) {
      for (const item of set.items) {
        if (item.brk || item.noteRow) continue;
        if (item.requested) anyReq = true;
        if (item.firstDance) anyDance = true;
        const song = songById(item.songId);
        if (song && song.isNew) anyNew = true;
      }
    }
    $('#lgReq').classList.toggle('hidden', !anyReq);
    $('#lgDance').classList.toggle('hidden', !anyDance);
    $('#lgNew').classList.toggle('hidden', !anyNew);
    $('#legend').classList.toggle('hidden', !(anyReq || anyDance || anyNew));
  }

  function renderEntry(set, item, itemIndex, number, setIndex) {
    const song = songById(item.songId);
    const li = el('li', 'entry' +
      ((song && song.isNew) ? ' is-new' : '') +
      (item.requested ? ' requested' : '') +
      (item.firstDance ? ' first-dance' : '') +
      (item.fatherDaughter ? ' father-daughter' : ''));

    li.appendChild(el('span', 'num', number + '.'));
    li.appendChild(el('span', 'grip', '⋮⋮'));

    const body = el('div', 'song');
    const title = el('div', 'title' +
      (item.requested ? ' requested' : '') +
      (item.firstDance ? ' first-dance' : '') +
      (item.fatherDaughter ? ' father-daughter' : ''),
      song ? song.title : '(deleted song)');
    body.appendChild(title);
    // The song's own note shows on every setlist; the line's note belongs
    // to this one alone and wears the accent to say so.
    if ((song && song.note) || item.note) {
      const noteLine = el('div', 'note');
      if (song && song.note) {
        noteLine.appendChild(el('span', null, song.note));
      }
      if (item.note) {
        if (song && song.note) {
          noteLine.appendChild(document.createTextNode(' · '));
        }
        noteLine.appendChild(el('span', 'doc-note', item.note));
      }
      body.appendChild(noteLine);
    }
    const verdict = (doc().clientVerdicts || {})[item.songId];
    if (verdict) {
      body.appendChild(el('div',
        'verdict verdict-line ' + (verdict === 'please' ? 'please' : 'veto'),
        verdict === 'please' ? 'PLEASE PLAY' : 'HECK NO'));
    }
    body.addEventListener('click', () => { if (song) openEditor(song, item); });
    li.appendChild(body);

    const part = partFor(song, item);
    const manySingers = !!(song && song.parts.length > 1);
    const keyEl = el('span', 'key' + (manySingers ? ' pickable' : ''), part.key);
    const singerEl = el('span',
      'singer' + (manySingers ? ' pickable' : ''), part.singer);
    if (manySingers) {
      const swap = () => askSinger(song, (chosen) => {
        item.partId = chosen.id;
        save(); renderSets();
      });
      keyEl.title = singerEl.title = 'Tap to change who sings it';
      keyEl.addEventListener('click', swap);
      singerEl.addEventListener('click', swap);
    }
    li.appendChild(keyEl);
    li.appendChild(singerEl);

    const flags = el('div', 'flags');
    const reqL = el('label', 'req-l');
    const req = el('input');
    req.type = 'checkbox';
    req.checked = !!item.requested;
    req.addEventListener('change', () => {
      item.requested = req.checked;
      save(); renderSets();
    });
    reqL.appendChild(req);
    reqL.appendChild(document.createTextNode('req'));
    reqL.title = 'Requested by the couple';
    flags.appendChild(reqL);

    const newL = el('label');
    const nw = el('input');
    nw.type = 'checkbox';
    nw.checked = !!(song && song.isNew);
    nw.addEventListener('change', () => {
      if (!song) return;
      // "New" is a fact about the song, so it reddens everywhere at once.
      song.isNew = nw.checked;
      save(); renderSets(); renderLibrary();
    });
    newL.appendChild(nw);
    newL.appendChild(document.createTextNode('new'));
    newL.title = 'New song: the band still needs to learn it';
    flags.appendChild(newL);
    li.appendChild(flags);

    const rm = el('button', 'rm', '✕');
    rm.title = 'Remove from this set';
    rm.addEventListener('click', () => {
      set.items.splice(itemIndex, 1);
      save(); renderSets(); renderLibrary();
    });
    li.appendChild(rm);

    li.addEventListener('mousedown', () => setActiveSet(setIndex, false));
    return li;
  }

  function renderBreak(set, item, itemIndex) {
    const li = el('li', 'entry break-row');
    li.appendChild(el('span', 'num', '—'));
    li.appendChild(el('span', 'grip', '⋮⋮'));

    const label = el('input', 'b-label');
    label.value = item.label;
    label.placeholder = 'Break';
    label.addEventListener('input', () => { item.label = label.value; save(); });
    li.appendChild(label);

    const min = el('input', 'b-min');
    min.type = 'number';
    min.min = '0';
    min.value = item.minutes;
    min.addEventListener('input', () => {
      item.minutes = Number(min.value) || 0; save();
    });
    li.appendChild(min);
    li.appendChild(el('span', 'b-unit', 'min'));

    const rm = el('button', 'rm', '✕');
    rm.addEventListener('click', () => {
      set.items.splice(itemIndex, 1);
      save(); renderSets();
    });
    li.appendChild(rm);
    return li;
  }

  // A free line among the songs - "speeches here", "cake cut after this" -
  // dragged around exactly like a break, carried through to every export.
  function renderNoteRow(set, item, itemIndex) {
    const li = el('li', 'entry note-row');
    li.appendChild(el('span', 'num', '✎'));
    li.appendChild(el('span', 'grip', '⋮⋮'));

    const text = el('input', 'n-text');
    text.value = item.text || '';
    text.placeholder = 'Note for the band…';
    text.addEventListener('input', () => { item.text = text.value; save(); });
    li.appendChild(text);

    const rm = el('button', 'rm', '✕');
    rm.title = 'Remove this note';
    rm.addEventListener('click', () => {
      set.items.splice(itemIndex, 1);
      save(); renderSets();
    });
    li.appendChild(rm);
    return li;
  }

  function setActiveSet(index, rerender) {
    if (doc().activeSet === index) return;
    doc().activeSet = index;
    save();
    if (rerender !== false) renderSets();
    else {
      document.querySelectorAll('.set-head').forEach((h, i) =>
        h.classList.toggle('active-target', i === index));
    }
  }

  function renderLibrary() {
    const query = $('#libSearch').value.trim().toLowerCase();
    const list = $('#libList');
    list.innerHTML = '';

    const inDoc = new Map();
    for (const set of doc().sets) {
      for (const item of set.items) {
        if (item.songId) {
          inDoc.set(item.songId, (inDoc.get(item.songId) || 0) + 1);
        }
      }
    }

    const songs = state.library
      .filter((s) => !query || s.title.toLowerCase().includes(query))
      .sort((a, b) => a.title.localeCompare(b.title));

    for (const song of songs) {
      const li = el('li', 'lib-row');

      const t = el('div', 't');
      t.appendChild(el('div',
        'title' + (song.isNew ? ' is-new' : ''), song.title));
      const meta = song.parts
        .map((p) => [p.key, p.singer].filter(Boolean).join(' '))
        .filter(Boolean);
      if (song.note) meta.push(song.note);
      if (song.onSite === false) meta.push('Not on the website');
      t.appendChild(el('div', 'meta', meta.join(' · ')));
      li.appendChild(t);

      const verdict = (doc().clientVerdicts || {})[song.id];
      if (verdict) {
        li.appendChild(el('span',
          'verdict ' + (verdict === 'please' ? 'please' : 'veto'),
          verdict === 'please' ? 'PLEASE PLAY' : 'HECK NO'));
      }

      const uses = inDoc.get(song.id) || 0;
      if (uses) {
        li.appendChild(el('span', 'in-doc', uses === 1 ? '✓' : '✓ ×' + uses));
      }

      const edit = el('button', 'edit', 'edit');
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditor(song);
      });
      li.appendChild(edit);

      li.dataset.songId = song.id;
      li.addEventListener('click', () => {
        if (Date.now() - libDraggedAt < 400) return;  // the end of a drag, not a tap
        addSongToActive(song);
      });
      list.appendChild(li);
    }

    if (!songs.length) {
      list.appendChild(el('li', 'lib-hint',
        query ? 'Nothing matches.' : 'The library is empty. Add a song.'));
    }
  }

  function addSongToActive(song) {
    if (song.parts.length > 1) {
      askSinger(song, (part) => placeSong(song, part.id));
      return;
    }
    placeSong(song, song.parts.length ? song.parts[0].id : '');
  }

  // Dragged from the library to a place in a set.
  function addSongAt(song, setIndex, index) {
    const put = (partId) => {
      const d = doc();
      const set = d.sets[setIndex];
      if (!set) return;
      set.items.splice(Math.min(index, set.items.length), 0, {
        songId: song.id, partId, requested: pleaseFor(d, song.id),
      });
      save(); renderSets(); renderLibrary();
    };
    renderSets();  // the dropped row goes; the song arrives once its singer is known
    if (song.parts.length > 1) askSinger(song, (part) => put(part.id));
    else put(song.parts.length ? song.parts[0].id : '');
  }

  // The library's songs drag into any set, anywhere (copies: the library
  // keeps them). With a mouse at once; on a touch screen, press and hold.
  let libDraggedAt = 0;
  function makeLibraryDraggable() {
    new Sortable($('#libList'), {
      group: { name: 'sets', pull: 'clone', put: false },
      sort: false,
      draggable: '.lib-row',
      filter: '.edit',
      preventOnFilter: false,
      delay: 200,
      delayOnTouchOnly: true,
      animation: 140,
      // On a phone or a portrait iPad the library is a sheet over the
      // setlist: it slides away once a drag starts, so there's somewhere
      // to drop (the dragged song rides on the page, not the sheet).
      fallbackOnBody: true,
      onStart: () => {
        document.body.classList.add('lib-dragging');
        $('#libraryPane').classList.remove('open');
        $('#libToggle').textContent = 'Library';
      },
      onEnd: () => {
        document.body.classList.remove('lib-dragging');
        libDraggedAt = Date.now();
      },
    });
  }

  // A PLEASE PLAY from the couple IS a request: any line it lands on
  // starts with req already ticked.
  const pleaseFor = (d, songId) =>
    (d.clientVerdicts || {})[songId] === 'please';

  function placeSong(song, partId) {
    const d = doc();
    if (!d.sets.length) {
      d.sets.push({ label: 'SET 1', items: [] });
      d.numSets = 1;
    }
    d.sets[d.activeSet].items.push({
      songId: song.id, partId, requested: pleaseFor(d, song.id),
    });
    save(); renderSets(); renderLibrary();
  }

  // --- "Who's singing?" ----------------------------------------------------

  function askSinger(song, onPick) {
    $('#spSong').textContent = song.title;
    const list = $('#spList');
    list.innerHTML = '';
    for (const part of song.parts) {
      const b = el('button', 'pick');
      b.appendChild(el('span', 'pick-singer', part.singer || 'Unnamed'));
      b.appendChild(el('span', 'pick-key', part.key || '—'));
      b.addEventListener('click', () => { closePicker(); onPick(part); });
      list.appendChild(b);
    }
    $('#singerPick').classList.remove('hidden');
  }

  function closePicker() {
    $('#singerPick').classList.add('hidden');
  }

  // --- Song editor sheet ---------------------------------------------------

  let editing = null; // null = closed, {} without id = new song
  let editingItem = null; // the setlist line the editor was opened from

  // --- The dances ------------------------------------------------------------

  // Every library song by its title and by any title it was once known as
  // (`aka`: a spelling the hub tidied), so picks, dances and the template
  // made with an old spelling still find the song. A current title wins.
  function titleIndex() {
    const byTitle = new Map();
    for (const s of state.library) byTitle.set(normTitle(s.title), s);
    for (const s of state.library) {
      for (const t of s.aka || []) if (!byTitle.has(normTitle(t))) byTitle.set(normTitle(t), s);
    }
    return byTitle;
  }

  // The library song a title names. One the library has lost comes back
  // from the seed with its singers and keys; one the band has never had
  // joins with `unknown` (a dance named by hand: new, to learn).
  function librarySong(title, unknown) {
    const key = normTitle(title);
    let song = titleIndex().get(key);
    if (!song) {
      const seed = SEED_LIBRARY.find((x) => normTitle(x.title) === key);
      song = {
        id: uid(),
        title: seed ? seed.title : title,
        parts: seed ? parseSung(seed.sung) : [],
        note: (seed && seed.note) || '',
        isNew: false,
        ...(seed ? {} : unknown),
      };
      state.library.push(song);
    }
    return song;
  }

  // A dance marks the gig's one line for it: a line already holding the
  // song if there is one, otherwise a new line: the first dance opening
  // Set 2, where the dancing starts, and the father and daughter dance
  // straight after the first dance. Its notes go on that line. A new choice
  // moves the mark, and a line added for an earlier choice goes.
  function placeDance(d, key, fd, song) {
    const k = DANCES[key];
    const lines = [];
    for (const set of d.sets) {
      for (const item of set.items) {
        if (!item.brk && !item.noteRow) lines.push({ set, item });
      }
    }
    const prev = lines.find((l) => l.item[k.line]);
    if (prev && !(song && prev.item.songId === song.id)) {
      if (prev.item[k.added]) {
        prev.set.items.splice(prev.set.items.indexOf(prev.item), 1);
        lines.splice(lines.indexOf(prev), 1);
      } else {
        prev.item[k.mark] = false;
        if (prev.item.note === prev.item[k.note]) delete prev.item.note;
        delete prev.item[k.line];
        delete prev.item[k.note];
      }
    }
    if (!song) return null;
    let target = lines.find((l) => l.item.songId === song.id);
    if (!target) {
      const item = {
        songId: song.id, partId: song.parts.length ? song.parts[0].id : '',
        [k.added]: true,
      };
      const first = key === 'fatherDaughter' && lines.find((l) => l.item.danceLine);
      const set = first ? first.set : d.sets[1] || d.sets[0];
      if (!set) return null;
      if (first) set.items.splice(set.items.indexOf(first.item) + 1, 0, item);
      else set.items.unshift(item);
      target = { set, item };
      lines.push(target);
    }
    // One of each dance per gig.
    for (const l of lines) if (l !== target) l.item[k.mark] = false;
    const line = target.item;
    if (line.note === line[k.note] || fd.notes) {
      line.note = fd.notes;
      if (!line.note) delete line.note;
    }
    line[k.note] = fd.notes;
    line[k.mark] = true;
    line[k.line] = true;
    // A song is one dance or the other: an old mark for the other dance on
    // this line (one its field didn't put there) goes.
    const other = DANCES[key === 'firstDance' ? 'fatherDaughter' : 'firstDance'];
    if (line[other.mark] && !line[other.line]) line[other.mark] = false;
    return { set: target.set.label };
  }

  // Sets one of the gig's dances and marks its line. A song added to the
  // library only for an earlier choice, and used nowhere, goes again.
  function setDance(d, key, next) {
    const fd = { ...noDance(), ...next };
    fd.title = String(fd.title || '').trim();
    fd.artist = String(fd.artist || '').trim();
    let song = null;
    if (fd.mode === 'list') {
      song = songById(fd.songId) || (fd.title ? librarySong(fd.title) : null);
    } else if (fd.mode === 'own' && fd.title) {
      song = librarySong(fd.title, { note: fd.artist, isNew: true, danceFor: d.id });
      if (song.danceFor === d.id) song.note = fd.artist;
    }
    const before = d[key] && songById(d[key].songId);
    fd.songId = song ? song.id : '';
    if (song && fd.mode === 'list') fd.title = song.title;
    d[key] = fd;
    const placed = placeDance(d, key, fd, song);
    if (before && before !== song && before.danceFor === d.id &&
      !state.docs.some((x) => x.sets.some((set) =>
        set.items.some((i) => i.songId === before.id)))) {
      state.library = state.library.filter((x) => x !== before);
    }
    return placed;
  }

  // A couple's dance (from their picks) in the field's terms.
  const danceFromPicks = (p) => (p && p.title ? {
    mode: p.custom ? 'own' : 'list', title: p.custom ? p.title : (p.t || p.title),
    artist: p.artist || '', notes: p.notes || '', from: 'couple',
  } : null);

  // Each dance's field: search the library and choose (it fills in as you
  // type), or name any song with its artist, plus notes.
  const danceBox = (key) => document.querySelector('.h-dance[data-dance="' + key + '"]');

  function renderDances() {
    for (const key of Object.keys(DANCES)) {
      const box = danceBox(key);
      if (!box) continue;
      const fd = doc()[key] || noDance();
      const song = fd.mode === 'list' ? songById(fd.songId) : null;
      const q = (c) => box.querySelector(c);
      q('.fd-pick').classList.toggle('hidden', !!song || fd.mode === 'own');
      q('.fd-chosen').classList.toggle('hidden', !song);
      q('.fd-own').classList.toggle('hidden', fd.mode !== 'own');
      if (song) q('.fd-song').textContent = song.title;
      if (fd.mode === 'own') {
        q('.fd-title').value = fd.title;
        q('.fd-artist').value = fd.artist;
      }
      q('.fd-notes').value = fd.notes || '';
      q('.fd-mode').textContent = fd.mode === 'own' ? 'Search the library instead' : 'Not in the library?';
      q('.fd-mode').classList.toggle('hidden', !!song);
    }
  }

  function wireDance(key) {
    const box = danceBox(key);
    const q = (c) => box.querySelector(c);
    const search = q('.fd-search');
    const list = q('.fd-options');
    let matches = [];
    let active = -1;
    const current = () => doc()[key] || noDance();
    const commit = (next) => { setDance(doc(), key, next); save(); renderAll(); };
    const close = () => {
      list.classList.add('hidden');
      list.innerHTML = '';
      search.setAttribute('aria-expanded', 'false');
      matches = [];
      active = -1;
    };
    const highlight = (i) => {
      active = i;
      [...list.children].forEach((li, n) => li.setAttribute('aria-selected', n === i ? 'true' : 'false'));
    };
    const choose = (song) => {
      close();
      search.value = '';
      commit({ mode: 'list', songId: song.id, title: song.title, notes: current().notes });
    };
    const byHand = (title) => {
      close();
      search.value = '';
      commit({ mode: 'own', title, notes: current().notes });
      q(title ? '.fd-artist' : '.fd-title').focus();
    };
    search.addEventListener('input', () => {
      const text = search.value.trim().toLowerCase();
      list.innerHTML = '';
      if (!text) { close(); return; }
      // Titles that start with what's typed first, then any other match.
      const starts = (x) => (x.title.toLowerCase().startsWith(text) ? 0 : 1);
      matches = state.library.filter((x) => x.title.toLowerCase().includes(text))
        .sort((a, b) => starts(a) - starts(b) || a.title.localeCompare(b.title))
        .slice(0, 8);
      matches.forEach((song) => {
        const li = el('li', 'fd-option', song.title);
        li.setAttribute('role', 'option');
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => choose(song));
        list.appendChild(li);
      });
      if (!matches.length) {
        const li = el('li', 'fd-none', 'Not in the library. ');
        const own = el('button', null, 'Name it by hand');
        own.addEventListener('mousedown', (e) => e.preventDefault());
        own.addEventListener('click', () => byHand(search.value.trim()));
        li.appendChild(own);
        list.appendChild(li);
      }
      list.classList.remove('hidden');
      search.setAttribute('aria-expanded', 'true');
      highlight(matches.length ? 0 : -1);
    });
    search.addEventListener('blur', close);
    search.addEventListener('keydown', (e) => {
      const n = matches.length;
      if (list.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown' && n) { e.preventDefault(); highlight((active + 1) % n); }
      else if (e.key === 'ArrowUp' && n) { e.preventDefault(); highlight((active - 1 + n) % n); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(matches[active]); }
      else if (e.key === 'Escape') close();
    });
    q('.fd-clear').addEventListener('click', () => commit({ notes: current().notes }));
    q('.fd-mode').addEventListener('click', () => {
      if (current().mode === 'own') {
        commit({ notes: current().notes });
        search.focus();
      } else {
        byHand(search.value.trim());
      }
    });
    // Typing is kept as it goes; the setlist follows when a box is left.
    const keep = (field, input) => {
      input.addEventListener('input', () => {
        doc()[key] = { ...current(), [field]: input.value };
        save();
      });
      input.addEventListener('change', () => commit({ ...current(), from: 'band' }));
    };
    keep('title', q('.fd-title'));
    keep('artist', q('.fd-artist'));
    keep('notes', q('.fd-notes'));
  }

  function openEditor(song, item) {
    editing = song || null;
    editingItem = item || null;
    $('#seTitle').textContent = song ? 'Edit song' : 'New song';
    $('#seSongTitle').value = song ? song.title : '';
    $('#seArtist').value = (song && song.artist) || '';
    $('#seOnSite').checked = !song || song.onSite !== false;
    $('#sePartList').innerHTML = '';
    const parts = (song && song.parts.length) ? song.parts : [];
    if (parts.length) parts.forEach(addPartRow);
    else addPartRow();
    $('#seNote').value = song ? song.note : '';
    // Opened from a setlist line, the editor also carries that line's
    // own note; opened from the library there is no line to carry it.
    $('#seDocNoteWrap').classList.toggle('hidden', !editingItem);
    $('#seDocNote').value = editingItem ? (editingItem.note || '') : '';
    $('#seDelete').classList.toggle('hidden', !song);
    $('#songEditor').classList.remove('hidden');
    $('#seSongTitle').focus();
  }

  function addPartRow(part) {
    const row = el('div', 'part-row');
    row.dataset.id = (part && part.id) || '';

    const singer = el('input', 'p-singer');
    singer.placeholder = 'Singer';
    singer.autocomplete = 'off';
    singer.value = (part && part.singer) || '';
    row.appendChild(singer);

    const key = el('input', 'p-key');
    key.placeholder = 'Key';
    key.autocomplete = 'off';
    key.value = (part && part.key) || '';
    row.appendChild(key);

    const rm = el('button', 'p-rm', '✕');
    rm.title = 'Remove this singer';
    rm.addEventListener('click', () => {
      row.remove();
      if (!$('#sePartList').children.length) addPartRow();
    });
    row.appendChild(rm);

    $('#sePartList').appendChild(row);
    return row;
  }

  function closeEditor() {
    $('#songEditor').classList.add('hidden');
    editingItem = null;
  }

  function saveEditor() {
    const title = $('#seSongTitle').value.trim();
    if (!title) { $('#seSongTitle').focus(); return; }
    const parts = [];
    for (const row of $('#sePartList').children) {
      const singer = row.querySelector('.p-singer').value.trim();
      const key = row.querySelector('.p-key').value.trim();
      if (!singer && !key) continue;
      parts.push({ id: row.dataset.id || uid(), singer, key });
    }
    const values = { title, parts, note: $('#seNote').value.trim(), artist: $('#seArtist').value.trim() };
    if (editing) Object.assign(editing, values);
    else state.library.push(editing = Object.assign({ id: uid(), isNew: false }, values));
    // On the website and the couples' song picks unless unticked.
    if ($('#seOnSite').checked) delete editing.onSite;
    else editing.onSite = false;
    if (editingItem) {
      const docNote = $('#seDocNote').value.trim();
      if (docNote) editingItem.note = docNote;
      else delete editingItem.note;
    }
    save(); closeEditor(); renderAll();
  }

  function deleteEditing() {
    if (!editing) return;
    const uses = state.docs.reduce((n, d) => n + d.sets.reduce((m, set) =>
      m + set.items.filter((i) => i.songId === editing.id).length, 0), 0);
    const msg = uses
      ? 'Delete "' + editing.title + '"? It is on ' + uses +
        ' setlist line' + (uses === 1 ? '' : 's') + ', which will be removed.'
      : 'Delete "' + editing.title + '" from the library?';
    if (!confirm(msg)) return;
    state.library = state.library.filter((s) => s.id !== editing.id);
    for (const d of state.docs) {
      for (const set of d.sets) {
        set.items = set.items.filter((i) => i.brk || i.songId !== editing.id);
      }
    }
    save(); closeEditor(); renderAll();
  }

  // --- Crew ----------------------------------------------------------------

  let crewTarget = null;   // the name field the chip bar is serving

  function showCrewBar(input) {
    crewTarget = input;
    const label = input.closest('label');
    $('#crewBarLabel').textContent =
      (label ? label.textContent.trim() : 'Crew') + ':';
    renderCrewChips();
    $('#crewBar').classList.remove('hidden');
  }

  function hideCrewBar() {
    $('#crewBar').classList.add('hidden');
    crewTarget = null;
  }

  function renderCrewChips() {
    const host = $('#crewBarChips');
    host.innerHTML = '';
    if (!crewTarget) return;
    const on = splitNames(crewTarget.value);
    for (const name of state.crew) {
      const chip = el('button', 'chip' +
        (on.some((n) => sameName(n, name)) ? ' on' : ''), name);
      // Keep the caret in the field so the bar does not close under the tap.
      chip.addEventListener('mousedown', (e) => e.preventDefault());
      chip.addEventListener('click', () => toggleName(name));
      host.appendChild(chip);
    }
    if (!state.crew.length) {
      host.appendChild(el('span', 'chip-empty', 'No crew saved yet.'));
    }
  }

  function toggleName(name) {
    if (!crewTarget) return;
    const names = splitNames(crewTarget.value);
    const at = names.findIndex((n) => sameName(n, name));
    if (at >= 0) names.splice(at, 1);
    else names.push(name);
    crewTarget.value = names.join(', ');
    doc().header[crewTarget.dataset.field] = crewTarget.value;
    save();
    renderCrewChips();
    crewTarget.focus();
  }

  function openCrewEditor() {
    renderCrewList();
    $('#crewNew').value = '';
    $('#crewEditor').classList.remove('hidden');
    $('#crewNew').focus();
  }

  function closeCrewEditor() {
    $('#crewEditor').classList.add('hidden');
    renderCrewChips();
  }

  function renderCrewList() {
    const host = $('#crewList');
    host.innerHTML = '';
    if (!state.crew.length) {
      host.appendChild(el('div', 'crew-empty', 'No one on the list yet.'));
      return;
    }
    state.crew.forEach((name, i) => {
      const row = el('div', 'crew-row');
      row.appendChild(el('span', 'crew-name', name));
      const rm = el('button', 'crew-rm', '\u2715');
      rm.title = 'Remove ' + name;
      rm.addEventListener('click', () => {
        state.crew.splice(i, 1);
        save(); renderCrewList();
      });
      row.appendChild(rm);
      host.appendChild(row);
    });
  }

  function addCrewFromEditor() {
    const value = $('#crewNew').value.trim();
    if (!value) return;
    if (rememberCrew(value)) save();
    $('#crewNew').value = '';
    $('#crewNew').focus();
    renderCrewList();
  }

  // --- The band's usual sets -----------------------------------------------

  // One click puts the template into the document. Songs are matched to the
  // library by title; anything the library has not met yet is added to it,
  // so the template works whatever state a device's library is in.
  function loadDefaultTemplate() {
    const d = doc();
    const filled = d.sets.reduce((n, s) => n + s.items.length, 0);
    if (filled && !confirm('Replace the ' + filled + ' line' +
      (filled === 1 ? '' : 's') + " in this setlist with the band's " +
      'default template?')) return;

    const byTitle = titleIndex();
    let addedSongs = 0;

    d.sets = DEFAULT_TEMPLATE.map((set) => ({
      label: set.label,
      items: set.items.map((entry) => {
        if (entry.brk) {
          return { brk: true, label: entry.brk, minutes: entry.minutes || 0 };
        }
        let song = byTitle.get(normTitle(entry.title));
        if (!song) {
          song = { id: uid(), title: entry.title, parts: [], note: '',
            isNew: false };
          state.library.push(song);
          byTitle.set(normTitle(entry.title), song);
          addedSongs++;
        }
        const part = (entry.singer &&
          song.parts.find((p) => sameName(p.singer, entry.singer))) ||
          song.parts[0];
        return { songId: song.id, partId: part ? part.id : '',
          requested: pleaseFor(d, song.id) };
      }),
    }));
    d.numSets = d.sets.length;
    d.activeSet = 0;
    save(); renderAll();
    toast('Template loaded.' + (addedSongs
      ? ' ' + addedSongs + ' new song' + (addedSongs === 1 ? '' : 's') +
        ' added to the library.' : ''));
  }

  // --- Song picks from the couple -------------------------------------------

  // The couple's verdicts ride inside links, both ways. The outgoing link
  // carries the repertoire to the request page; the reply carries titles
  // marked PLEASE PLAY or HECK NO back here, where they become badges in
  // the library while this gig's setlist is being built. No server: the
  // links are the transport, messaging apps are the network.

  let picksUrl = '';

  function openPicksShare() {
    const d = doc();
    const songs = state.library.slice()
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!songs.length) { toast('The library is empty.'); return; }
    const sid = uid();
    if (!Array.isArray(d.shares)) d.shares = [];
    d.shares.push({ sid, when: Date.now() });
    save();
    // Only the first names travel: the title is the band's own label for
    // the gig and can carry notes the couple should never see.
    const names = (d.header.names || '').trim();
    const payload = LZString.compressToEncodedURIComponent(JSON.stringify({
      v: 1, kind: 'list', sid,
      couple: names,
      songs: songs.filter((s) => s.onSite !== false).map((s) => s.title),
    }));
    picksUrl = REQUEST_PAGE_URL + '#p=' + payload;
    $('#psBlurb').textContent = 'Send ' + (names || 'the couple') +
      ' this link. They tap PLEASE PLAY or HECK NO on any of the ' +
      songs.length + ' songs and send their picks straight back - when ' +
      'you open their reply, the verdicts appear in the library here.' +
      (names ? '' : " Fill in the couple's first names on the setlist " +
        'first and the link greets them by name.');
    $('#psShare').classList.toggle('hidden', !navigator.share);
    $('#picksShare').classList.remove('hidden');
  }

  function closePicksSheets() {
    $('#picksShare').classList.add('hidden');
    $('#picksImport').classList.add('hidden');
  }

  // A reply can arrive as a tapped link (the hash), a pasted link, or a
  // pasted bare code; this digs the payload out of any of them.
  function picksPayloadFrom(text) {
    const m = String(text || '').match(/p=([A-Za-z0-9+$\-]+)/);
    const raw = m ? m[1] : String(text || '').trim();
    if (!raw) return null;
    try {
      const data = JSON.parse(LZString.decompressFromEncodedURIComponent(raw));
      if (data && data.kind === 'picks' &&
          Array.isArray(data.please) && Array.isArray(data.no)) return data;
    } catch (e) { /* not a picks code */ }
    return null;
  }

  function applyPicks(data, quiet) {
    // The reply names the share it answers; find the gig that sent it.
    let d = state.docs.find((x) =>
      (x.shares || []).some((s) => s.sid === data.sid));
    if (!d) {
      d = doc();
      if (!confirm('These picks do not match a link sent from this ' +
        'device. Apply them to "' + (d.header.couple || 'Untitled') +
        '"?')) return;
    }
    const byTitle = titleIndex();
    const seedByTitle = new Map();
    for (const s of SEED_LIBRARY) seedByTitle.set(normTitle(s.title), s);
    const verdicts = {};
    let added = 0;
    // The website offers couples the full repertoire, so a pick can name a
    // song this device's library has lost. It joins the library (with its
    // seed singers and keys when known) rather than the pick being dropped.
    const mark = (titles, verdict) => {
      for (const title of titles) {
        let song = byTitle.get(normTitle(title));
        if (!song) {
          const seed = seedByTitle.get(normTitle(title));
          song = {
            id: uid(),
            title: seed ? seed.title : title,
            parts: seed ? parseSung(seed.sung) : [],
            note: (seed && seed.note) || '',
            isNew: false,
          };
          state.library.push(song);
          byTitle.set(normTitle(title), song);
          added++;
        }
        verdicts[song.id] = verdict;
      }
    };
    mark(data.please, 'please');
    mark(data.no, 'no');
    // A newer reply replaces the old one wholesale - a couple changing
    // their minds should not leave stale verdicts behind.
    d.clientVerdicts = verdicts;
    d.clientPicksFrom = data.couple || '';
    d.clientPicksWhen = data.at || Date.now();
    d.clientFirstDance = data.firstDance || '';
    d.clientFatherDaughter = data.fatherDaughter || '';
    // Their dances fill the gig's fields. Sent without one, a dance they
    // chose before is taken back; one the band set stays.
    for (const key of Object.keys(DANCES)) {
      const theirs = danceFromPicks(typeof data[key] === 'string' ? { custom: true, title: data[key] } : data[key]);
      if (theirs) setDance(d, key, theirs);
      else if (d[key] && d[key].from === 'couple') setDance(d, key, null);
    }
    // Lines already on the setlist catch up: a PLEASE PLAY ticks req.
    // Nothing is ever unticked - a request made in person stays made.
    let ticked = 0;
    for (const set of d.sets) {
      for (const item of set.items) {
        if (item.brk || item.noteRow) continue;
        if (verdicts[item.songId] === 'please' && !item.requested) {
          item.requested = true;
          ticked++;
        }
      }
    }
    if (quiet) {
      save(); renderAll();
      return { doc: d, ticked, added };
    }
    state.activeDocId = d.id;
    save(); renderAll();
    toast('Picks from ' + (data.couple || 'the couple') + ': ' +
      data.please.length + ' PLEASE PLAY, ' + data.no.length + ' HECK NO.' +
      (ticked ? ' ' + ticked + ' setlist line' + (ticked === 1 ? '' : 's') +
        ' ticked req.' : '') +
      (added ? ' ' + added + ' song' + (added === 1 ? '' : 's') +
        ' added to the library.' : ''));
  }

  // --- Documents -----------------------------------------------------------

  function newDoc() {
    const d = defaultDoc();
    state.docs.push(d);
    state.activeDocId = d.id;
    save(); renderAll();
  }

  function duplicateDoc() {
    const copy = JSON.parse(JSON.stringify(doc()));
    copy.id = uid();
    copy.header.couple = (copy.header.couple || 'Untitled') + ' (copy)';
    // The couple's song picks belong to their gig, not the next one.
    delete copy.shares;
    delete copy.clientVerdicts;
    delete copy.clientPicksFrom;
    delete copy.clientPicksWhen;
    delete copy.clientFirstDance;
    state.docs.push(copy);
    state.activeDocId = copy.id;
    save(); renderAll();
  }

  function deleteDoc() {
    const d = doc();
    if (!confirm('Delete the setlist "' +
      (d.header.couple || 'Untitled') + '"? The library is untouched.')) return;
    state.docs = state.docs.filter((x) => x.id !== d.id);
    if (!state.docs.length) state.docs.push(defaultDoc());
    state.activeDocId = state.docs[0].id;
    save(); renderAll();
  }

  // --- Scaffold ------------------------------------------------------------

  function applyNumSets() {
    const d = doc();
    let target = Math.max(1, Math.min(8, Number($('#numSets').value) || 1));
    while (d.sets.length < target) {
      d.sets.push({ label: 'SET ' + (d.sets.length + 1), items: [] });
    }
    while (d.sets.length > target &&
           d.sets[d.sets.length - 1].items.length === 0) {
      d.sets.pop();
    }
    // Never silently destroy a populated set: the count snaps back instead.
    d.numSets = d.sets.length;
    if (d.activeSet >= d.sets.length) d.activeSet = d.sets.length - 1;
    save(); renderScaffold(); renderSets();
  }

  // --- Exports -------------------------------------------------------------

  const writeClipboard = (html, text, done) => SetlistSheet.writeClipboard(html, text)
    .then(done, () => toast('Could not reach the clipboard.'));

  const esc = (t) => String(t).replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function songCellHtml(song, item) {
    let t = esc(song.title + SetlistSheet.tagsOf(song, item));
    if (item.requested || item.firstDance || item.fatherDaughter) t = '<b>' + t + '</b>';
    if (item.firstDance) t = '<span style="color:#7a3fb8">' + t + '</span>';
    else if (song.isNew) t = '<span style="color:#c22c2c">' + t + '</span>';
    return t;
  }

  // Colour does not survive a paste or a black-and-white printer, so every
  // export says it in words too: "(FIRST DANCE)", "(FATHER & DAUGHTER
  // DANCE)" and "🆕" (sheet.js).
  const danceTag = (item, song) => SetlistSheet.tagsOf(song || {}, item);

  // The Docs copy and the PDF are sheet.js's, shared with the band
  // manager hub, so a setlist reads the same wherever it's printed.
  function copyForDocs() {
    const d = hub ? Object.assign({}, doc(), { updatedAt: doc().updatedAt || state.savedAt }) : doc();
    SetlistSheet.copyDocs(d, state.library).then(
      () => toast('Copied. Paste straight into a Google Doc.'),
      () => toast('Could not reach the clipboard.'));
  }

  function copyForSheets() {
    const d = doc();
    const header = ['Set', '#', 'Song', 'Key', 'Singer', 'Note'];
    const rows = [];
    d.sets.forEach((set) => {
      let n = 0;
      for (const item of set.items) {
        if (item.brk) {
          rows.push({ cells: [set.label, '', (item.label || 'Break'),
            '', '', item.minutes ? item.minutes + ' min' : ''] });
          continue;
        }
        if (item.noteRow) {
          if (item.text) {
            rows.push({ cells: [set.label, '', item.text, '', '', ''] });
          }
          continue;
        }
        const song = songById(item.songId);
        if (!song) continue;
        const part = partFor(song, item);
        rows.push({ song, item, cells: [set.label, ++n,
          song.title + danceTag(item, song),
          part.key, part.singer,
          [song.note, item.note].filter(Boolean).join(' · ')] });
      }
    });
    const tsv = [header.join('\t')]
      .concat(rows.map((r) => r.cells.join('\t'))).join('\n');
    let html = '<meta charset="utf-8"><table><tr>' +
      header.map((c) => '<th>' + c + '</th>').join('') + '</tr>';
    for (const r of rows) {
      const cells = r.cells.map((c, i) =>
        (i === 2 && r.song) ? songCellHtml(r.song, r.item) : esc(c));
      html += '<tr>' + cells.map((c) => '<td>' + c + '</td>').join('') +
        '</tr>';
    }
    html += '</table>';
    writeClipboard(html, tsv,
      () => toast('Copied. Paste straight into Google Sheets.'));
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)],
      { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'setlist-studio-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(file) {
    file.text().then((text) => {
      const incoming = JSON.parse(text);
      if (!incoming || !Array.isArray(incoming.library) ||
          !Array.isArray(incoming.docs)) throw new Error('shape');
      if (!confirm('Replace everything here with the backup ("' +
        incoming.library.length + ' songs, ' + incoming.docs.length +
        ' setlists")?')) return;
      state = incoming;
      migrate();
      if (!state.docs.length) state.docs.push(defaultDoc());
      state.activeDocId = state.docs[0].id;
      save(); renderAll();
      toast('Backup restored.');
    }).catch(() => toast('That file is not a Setlist Studio backup.'));
  }

  // The printed sheet: each set on its own page, as large as it fits.
  function exportPdf() {
    // Inside the hub, the PDF says when the setlist last changed.
    const d = hub ? Object.assign({}, doc(), { updatedAt: doc().updatedAt || state.savedAt }) : doc();
    SetlistSheet.ready().then(() => SetlistSheet.savePdf(d, state.library));
  }

  // --- Small helpers -------------------------------------------------------

  let toastTimer = null;
  function toast(message) {
    let t = $('#toast');
    if (!t) {
      t = el('div');
      t.id = 'toast';
      t.style.cssText =
        'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);' +
        'background:#1d2724;color:#fff;padding:9px 16px;border-radius:8px;' +
        'z-index:60;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      document.body.appendChild(t);
    }
    t.textContent = message;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2600);
  }

  // --- Wiring --------------------------------------------------------------

  function wire() {
    Object.keys(DANCES).forEach(wireDance);
    for (const [id, field] of headerFields) {
      const input = $('#' + id);
      input.dataset.field = field;
      input.addEventListener('input', (e) => {
        doc().header[field] = e.target.value;
        save();
        if (field === 'couple') renderDocPicker();
        if (crewTarget === input) renderCrewChips();
      });
      if (!NAME_FIELDS.includes(id)) continue;
      input.addEventListener('focus', () => showCrewBar(input));
      input.addEventListener('blur', () => {
        // A name typed by hand joins the roster.
        if (rememberCrew(input.value)) save();
        setTimeout(() => {
          const now = document.activeElement;
          if (now && $('#crewBar').contains(now)) return;
          if (NAME_FIELDS.some((other) => now === $('#' + other))) return;
          hideCrewBar();
        }, 160);
      });
    }

    $('#loadTemplate').addEventListener('click', loadDefaultTemplate);
    $('#crewManage').addEventListener('click', openCrewEditor);
    $('#crewMembers').addEventListener('click', () => {
      $('#menuPop').classList.add('hidden');
      openCrewEditor();
    });
    $('#crewAdd').addEventListener('click', addCrewFromEditor);
    $('#crewDone').addEventListener('click', closeCrewEditor);
    $('#crewEditor').addEventListener('click', (e) => {
      if (e.target === $('#crewEditor')) closeCrewEditor();
    });
    $('#crewNew').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCrewFromEditor(); }
    });

    $('#docPicker').addEventListener('change', (e) => {
      state.activeDocId = e.target.value;
      save(); renderAll();
    });
    $('#newDoc').addEventListener('click', newDoc);
    $('#dupDoc').addEventListener('click', duplicateDoc);
    $('#delDoc').addEventListener('click', deleteDoc);

    $('#numSets').addEventListener('change', applyNumSets);
    $('#songsPerSet').addEventListener('change', () => {
      doc().songsPerSet =
        Math.max(1, Number($('#songsPerSet').value) || 1);
      save(); renderScaffold(); renderSets();
    });
    $('#addSet').addEventListener('click', () => {
      const d = doc();
      d.sets.push({ label: 'SET ' + (d.sets.length + 1), items: [] });
      d.numSets = d.sets.length;
      d.activeSet = d.sets.length - 1;
      save(); renderScaffold(); renderSets();
    });

    $('#libSearch').addEventListener('input', renderLibrary);
    makeLibraryDraggable();
    $('#libAdd').addEventListener('click', () => openEditor(null));

    $('#seAddPart').addEventListener('click', () => {
      addPartRow().querySelector('.p-singer').focus();
    });
    $('#seSave').addEventListener('click', saveEditor);
    $('#seCancel').addEventListener('click', closeEditor);
    $('#seDelete').addEventListener('click', deleteEditing);
    $('#songEditor').addEventListener('click', (e) => {
      if (e.target === $('#songEditor')) closeEditor();
    });
    $('#spCancel').addEventListener('click', closePicker);
    $('#singerPick').addEventListener('click', (e) => {
      if (e.target === $('#singerPick')) closePicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeEditor(); closePicker(); closeCrewEditor(); closePicksSheets();
      }
      if (e.key === 'Enter' &&
          !$('#songEditor').classList.contains('hidden') &&
          e.target.tagName === 'INPUT') saveEditor();
    });

    $('#exportPdf').addEventListener('click', exportPdf);
    $('#copyDocs').addEventListener('click', copyForDocs);
    $('#copySheets').addEventListener('click', copyForSheets);
    $('#menuBtn').addEventListener('click', () =>
      $('#menuPop').classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
      if (!$('#menuPop').classList.contains('hidden') &&
          !$('#menuPop').contains(e.target) && e.target !== $('#menuBtn')) {
        $('#menuPop').classList.add('hidden');
      }
    });
    $('#sharePicks').addEventListener('click', () => {
      $('#menuPop').classList.add('hidden'); openPicksShare();
    });
    $('#importPicks').addEventListener('click', () => {
      $('#menuPop').classList.add('hidden');
      $('#piText').value = '';
      $('#picksImport').classList.remove('hidden');
      $('#piText').focus();
    });
    $('#psCopy').addEventListener('click', () => {
      navigator.clipboard.writeText(picksUrl).then(
        () => toast('Link copied. Send it to the couple.'),
        () => toast('Could not reach the clipboard.'));
      closePicksSheets();
    });
    $('#psShare').addEventListener('click', () => {
      navigator.share({
        text: 'Pick the songs you want (and the ones you don\'t!): ',
        url: picksUrl,
      }).catch(() => {});
      closePicksSheets();
    });
    $('#psCancel').addEventListener('click', closePicksSheets);
    $('#picksShare').addEventListener('click', (e) => {
      if (e.target === $('#picksShare')) closePicksSheets();
    });
    $('#piApply').addEventListener('click', () => {
      const data = picksPayloadFrom($('#piText').value);
      if (!data) {
        toast('That does not look like a song picks link or code.');
        return;
      }
      closePicksSheets();
      applyPicks(data);
    });
    $('#piCancel').addEventListener('click', closePicksSheets);
    $('#picksImport').addEventListener('click', (e) => {
      if (e.target === $('#picksImport')) closePicksSheets();
    });

    $('#exportJson').addEventListener('click', () => {
      $('#menuPop').classList.add('hidden'); exportJson();
    });
    $('#importJson').addEventListener('click', () => {
      $('#menuPop').classList.add('hidden'); $('#importFile').click();
    });
    $('#importFile').addEventListener('change', (e) => {
      if (e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = '';
    });
    $('#printDoc').addEventListener('click', () => {
      $('#menuPop').classList.add('hidden'); window.print();
    });

    const setLibOpen = (open) => {
      $('#libraryPane').classList.toggle('open', open);
      $('#libToggle').textContent = open ? 'Close' : 'Library';
    };
    $('#libToggle').addEventListener('click', () =>
      setLibOpen(!$('#libraryPane').classList.contains('open')));
    $('#libClose').addEventListener('click', () => setLibOpen(false));
  }

  // --- Updates -------------------------------------------------------------

  // The service worker downloads a new version in the background whenever
  // one is published. This banner is how anyone finds out: one tap, and
  // the new version is on screen. No cache clearing, ever.
  function showUpdateBanner() {
    if ($('#updateBar')) return;
    const bar = el('div');
    bar.id = 'updateBar';
    bar.appendChild(el('span', null, 'A new version is ready.'));
    const b = el('button', null, 'Update now');
    b.addEventListener('click', () => location.reload());
    bar.appendChild(b);
    document.body.appendChild(bar);
  }

  // --- Song picks inbox ---------------------------------------------------

  // While a gig has a picks link out, look for the couple's reply every few
  // seconds (and straight away on coming back to the app). Each reply is
  // applied once, to the gig whose link it answers; replies for gigs on
  // another device are left alone.
  const INBOX_EVERY_MS = 5000;
  let inboxBusy = false;

  const waitingOnPicks = () =>
    state.docs.some((d) => (d.shares || []).length);

  function checkInbox() {
    if (!state || inboxBusy || document.hidden || !waitingOnPicks()) return;
    inboxBusy = true;
    fetch(PICKS_INBOX_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((replies) => {
        if (!Array.isArray(replies)) return;
        if (!Array.isArray(state.inboxSeen)) state.inboxSeen = [];
        for (const reply of replies) {
          if (!reply || !reply.id || state.inboxSeen.includes(reply.id)) continue;
          if (!reply.sid || !state.docs.some((d) =>
            (d.shares || []).some((s) => s.sid === reply.sid))) continue;
          if (!Array.isArray(reply.please) || !Array.isArray(reply.no)) continue;
          state.inboxSeen.push(reply.id);
          const result = applyPicks(reply, true);
          if (result) showPicksBanner(reply, result);
        }
      })
      .catch(() => { /* demo server not running: nothing to fetch */ })
      .then(() => { inboxBusy = false; });
  }

  // Stays up until dismissed: a couple's picks arriving is the news.
  function showPicksBanner(reply, result) {
    const old = $('#picksBar');
    if (old) old.remove();
    const d = result.doc;
    const bar = el('div');
    bar.id = 'picksBar';
    bar.setAttribute('role', 'status');
    const text = el('div', 'pb-text');
    text.appendChild(el('b', null, (reply.couple || 'The couple') +
      ' sent their song picks'));
    text.appendChild(el('span', null, reply.please.length + ' PLEASE PLAY, ' +
      reply.no.length + ' HECK NO' +
      (reply.firstDance ? '. First dance: ' + danceText(reply.firstDance) : '') +
      (reply.fatherDaughter ? '. Father & daughter dance: ' + danceText(reply.fatherDaughter) : '') +
      (result.ticked ? '. ' + result.ticked + ' setlist line' +
        (result.ticked === 1 ? '' : 's') + ' ticked req' : '') + '.'));
    bar.appendChild(text);
    if (state.activeDocId !== d.id) {
      const open = el('button', null, 'Open setlist');
      open.addEventListener('click', () => {
        state.activeDocId = d.id;
        save(); renderAll();
        bar.remove();
      });
      bar.appendChild(open);
    }
    const x = el('button', 'pb-close', '×');
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', () => bar.remove());
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  // --- Boot ----------------------------------------------------------------

  wire();
  SetlistSheet.ready();  // the PDF's logo and heading font, ahead of the first PDF
  if (IN_HUB) {
    startHub();
  } else {
    load();
    renderAll();
    ready();
  }

  // A tapped reply link lands here as "#p=...". It arrives as a fresh load,
  // or as a bare hash change when the app is already open (an installed
  // copy reusing its running window does that). Either way: import it,
  // then take the payload off the address bar so a reload does not re-ask.
  function importFromAddress() {
    if (!/p=/.test(location.hash)) return;
    const picks = picksPayloadFrom(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (picks) applyPicks(picks);
  }
  // Once the setlists are loaded (from the hub, that's a moment later).
  function ready() {
    importFromAddress();
    window.addEventListener('hashchange', importFromAddress);
    checkInbox();
    setInterval(checkInbox, INBOX_EVERY_MS);
    document.addEventListener('visibilitychange', checkInbox);
  }

  // Inside the hub there's no offline copy at all: the setlists are the
  // hub's, and Setlist Manager must always be the latest version (the hub
  // also clears out any copy an older version cached).
  if (IN_HUB && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => {
      if (/\/studio\/$/.test(new URL(r.scope).pathname)) r.unregister();
    })).catch(() => {});
  } else if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // A fresh install stays silent; only an update to an app already
      // running gets the banner, once the new version is ready to serve.
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next || !navigator.serviceWorker.controller) return;
        next.addEventListener('statechange', () => {
          if (next.state === 'activated') showUpdateBanner();
        });
      });
      // Installed copies can sit in memory for days; look for a new
      // version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    }).catch(() => {});
  }
})();
