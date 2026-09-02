/* Setlist Studio
   One page, no server, no accounts. State lives in localStorage and is
   saved on every change; a JSON backup moves it between devices when that
   day comes. The document on the right is the artefact; the library on the
   left is the band's repertoire feeding it. */

(() => {
  'use strict';

  const STORE_KEY = 'setlist-studio.v1';

  // --- State --------------------------------------------------------------

  let state = null;

  let uidCounter = 0;
  const uid = () =>
    Date.now().toString(36) + '-' + (uidCounter++).toString(36);

  function defaultDoc() {
    // Four sets of twelve: the shape of the real sheet this replaces.
    const doc = {
      id: uid(),
      header: {
        couple: '', venue: '', date: '', crew: '',
        sound: '', contact: '', mc: '', notes: '',
      },
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

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        return;
      }
    } catch (e) { /* fall through to a fresh start */ }
    state = {
      library: SEED_LIBRARY.map((s) => ({
        id: uid(),
        title: s.title,
        key: s.key || '',
        singer: s.singer || '',
        note: s.note || '',
        isNew: false,
      })),
      docs: [defaultDoc()],
      activeDocId: null,
    };
    state.activeDocId = state.docs[0].id;
    save();
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  const doc = () =>
    state.docs.find((d) => d.id === state.activeDocId) || state.docs[0];

  const songById = (id) => state.library.find((s) => s.id === id) || null;

  // --- DOM handles --------------------------------------------------------

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const headerFields = [
    ['hCouple', 'couple'], ['hVenue', 'venue'], ['hDate', 'date'],
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

      const songCount = set.items.filter((i) => !i.brk).length;
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
        list.appendChild(item.brk
          ? renderBreak(set, item, itemIndex)
          : renderEntry(set, item, itemIndex, ++number, setIndex));
      });
      section.appendChild(list);

      sortables.push(new Sortable(list, {
        group: 'sets',
        handle: '.grip',
        animation: 140,
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
  }

  function renderEntry(set, item, itemIndex, number, setIndex) {
    const song = songById(item.songId);
    const li = el('li', 'entry' +
      ((song && song.isNew) ? ' is-new' : '') +
      (item.requested ? ' requested' : ''));

    li.appendChild(el('span', 'num', number + '.'));
    li.appendChild(el('span', 'grip', '⋮⋮'));

    const body = el('div', 'song');
    const title = el('div', 'title', song ? song.title : '(deleted song)');
    body.appendChild(title);
    if (song && song.note) body.appendChild(el('div', 'note', song.note));
    body.addEventListener('click', () => { if (song) openEditor(song); });
    li.appendChild(body);

    li.appendChild(el('span', 'key', song ? song.key : ''));
    li.appendChild(el('span', 'singer', song ? song.singer : ''));

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
        if (!item.brk) inDoc.set(item.songId, (inDoc.get(item.songId) || 0) + 1);
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
      t.appendChild(el('div', 'meta',
        [song.key, song.singer, song.note].filter(Boolean).join(' · ')));
      li.appendChild(t);

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

      li.addEventListener('click', () => addSongToActive(song));
      list.appendChild(li);
    }

    if (!songs.length) {
      list.appendChild(el('li', 'lib-hint',
        query ? 'Nothing matches.' : 'The library is empty. Add a song.'));
    }
  }

  function addSongToActive(song) {
    const d = doc();
    if (!d.sets.length) {
      d.sets.push({ label: 'SET 1', items: [] });
      d.numSets = 1;
    }
    d.sets[d.activeSet].items.push({ songId: song.id, requested: false });
    save(); renderSets(); renderLibrary();
  }

  // --- Song editor sheet ---------------------------------------------------

  let editing = null; // null = closed, {} without id = new song

  function openEditor(song) {
    editing = song || null;
    $('#seTitle').textContent = song ? 'Edit song' : 'New song';
    $('#seSongTitle').value = song ? song.title : '';
    $('#seKey').value = song ? song.key : '';
    $('#seSinger').value = song ? song.singer : '';
    $('#seNote').value = song ? song.note : '';
    $('#seNew').checked = song ? !!song.isNew : false;
    $('#seDelete').classList.toggle('hidden', !song);
    $('#songEditor').classList.remove('hidden');
    $('#seSongTitle').focus();
  }

  function closeEditor() {
    $('#songEditor').classList.add('hidden');
  }

  function saveEditor() {
    const title = $('#seSongTitle').value.trim();
    if (!title) { $('#seSongTitle').focus(); return; }
    const values = {
      title,
      key: $('#seKey').value.trim(),
      singer: $('#seSinger').value.trim(),
      note: $('#seNote').value.trim(),
      isNew: $('#seNew').checked,
    };
    if (editing) Object.assign(editing, values);
    else state.library.push(Object.assign({ id: uid() }, values));
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

  function docFilename(ext) {
    const base = (doc().header.couple || 'setlist')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return (base || 'setlist') + '.' + ext;
  }

  function copyForSheets() {
    const d = doc();
    const rows = [['Set', '#', 'Song', 'Key', 'Singer', 'Note', 'Requested', 'New']];
    d.sets.forEach((set) => {
      let n = 0;
      for (const item of set.items) {
        if (item.brk) {
          rows.push([set.label, '', 'BREAK: ' + (item.label || 'Break'),
            '', '', item.minutes ? item.minutes + ' min' : '', '', '']);
          continue;
        }
        const song = songById(item.songId);
        if (!song) continue;
        rows.push([set.label, ++n, song.title, song.key, song.singer,
          song.note || '', item.requested ? 'yes' : '', song.isNew ? 'yes' : '']);
      }
    });
    const tsv = rows.map((r) => r.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).then(
      () => toast('Copied. Paste straight into Google Sheets.'),
      () => toast('Could not reach the clipboard.'));
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
      if (!state.docs.length) state.docs.push(defaultDoc());
      state.activeDocId = state.docs[0].id;
      save(); renderAll();
      toast('Backup restored.');
    }).catch(() => toast('That file is not a Setlist Studio backup.'));
  }

  // The printed sheet: the same document, set in PDF. Mirrors the band's
  // real sheet - header block, ruled set headings, numbered rows with key
  // and singer columns - refined into consistent columns.
  function exportPdf() {
    const d = doc();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 48;
    const colKey = pageW - margin - 120;
    const colSinger = pageW - margin - 70;
    let y = margin;

    const ink = [29, 39, 36];
    const dim = [92, 106, 102];
    const red = [194, 44, 44];

    const ensureRoom = (needed) => {
      if (y + needed > pageH - margin) { pdf.addPage(); y = margin; }
    };

    pdf.setTextColor(...ink);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.text(d.header.couple || 'Setlist', margin, y);
    y += 10;
    pdf.setDrawColor(...ink);
    pdf.setLineWidth(1.2);
    pdf.line(margin, y, pageW - margin, y);
    y += 16;

    pdf.setFontSize(10);
    const meta = [
      ['Venue', d.header.venue], ['Date', d.header.date],
      ['Crew', d.header.crew], ['Sound', d.header.sound],
      ['Point of contact', d.header.contact], ['MC', d.header.mc],
    ].filter(([, v]) => v);
    for (let i = 0; i < meta.length; i += 2) {
      const pair = meta.slice(i, i + 2);
      let x = margin;
      for (const [label, value] of pair) {
        pdf.setFont('helvetica', 'bold');
        pdf.text(label.toUpperCase() + ':', x, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(String(value),
          x + pdf.getTextWidth(label.toUpperCase() + ': ') + 2, y);
        x = margin + (pageW - margin * 2) / 2;
      }
      y += 14;
    }

    if (d.header.notes) {
      y += 2;
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...dim);
      const lines = pdf.splitTextToSize(d.header.notes, pageW - margin * 2);
      for (const line of lines) {
        ensureRoom(12);
        pdf.text(line, margin, y);
        y += 12;
      }
      pdf.setTextColor(...ink);
    }

    let anyRequested = false;
    for (const set of d.sets) {
      ensureRoom(46);
      y += 18;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.text(set.label, margin, y);
      y += 5;
      pdf.setLineWidth(0.8);
      pdf.line(margin, y, pageW - margin, y);
      y += 14;
      pdf.setFontSize(11);

      let n = 0;
      for (const item of set.items) {
        if (item.brk) {
          ensureRoom(16);
          pdf.setFont('helvetica', 'italic');
          pdf.setTextColor(...dim);
          pdf.text('— ' + (item.label || 'Break') +
            (item.minutes ? ' (' + item.minutes + ' min)' : '') + ' —',
            margin + 22, y);
          pdf.setTextColor(...ink);
          y += 15;
          continue;
        }
        const song = songById(item.songId);
        if (!song) continue;
        ensureRoom(16);
        n++;

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...dim);
        pdf.text(String(n), margin + 14, y, { align: 'right' });

        if (song.isNew) pdf.setTextColor(...red);
        else pdf.setTextColor(...ink);
        pdf.setFont('helvetica', song.isNew ? 'bold' : 'normal');
        let title = song.title;
        if (item.requested) { title += ' *'; anyRequested = true; }
        pdf.text(title, margin + 22, y);
        if (song.note) {
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(9);
          pdf.setTextColor(...dim);
          pdf.text(song.note, margin + 22 + pdf.getTextWidth(title) + 8, y);
          pdf.setFontSize(11);
        }

        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...ink);
        pdf.text(song.key || '', colKey, y);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...dim);
        pdf.text(song.singer || '', colSinger, y);
        pdf.setTextColor(...ink);
        y += 15;
      }
    }

    y += 16;
    ensureRoom(14);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(...dim);
    const legend = [];
    if (anyRequested) legend.push('* requested by the couple');
    if (state.library.some((s) => s.isNew &&
        d.sets.some((set) => set.items.some((i) => i.songId === s.id)))) {
      legend.push('red = new song');
    }
    if (legend.length) pdf.text(legend.join('   ·   '), margin, y);

    const filename = docFilename('pdf');
    const blob = pdf.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: filename }).catch(() => {});
    } else {
      pdf.save(filename);
    }
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
    for (const [id, field] of headerFields) {
      $('#' + id).addEventListener('input', (e) => {
        doc().header[field] = e.target.value;
        save();
        if (field === 'couple') renderDocPicker();
      });
    }

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
    $('#libAdd').addEventListener('click', () => openEditor(null));

    $('#seSave').addEventListener('click', saveEditor);
    $('#seCancel').addEventListener('click', closeEditor);
    $('#seDelete').addEventListener('click', deleteEditing);
    $('#songEditor').addEventListener('click', (e) => {
      if (e.target === $('#songEditor')) closeEditor();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEditor();
      if (e.key === 'Enter' &&
          !$('#songEditor').classList.contains('hidden') &&
          e.target.tagName === 'INPUT') saveEditor();
    });

    $('#exportPdf').addEventListener('click', exportPdf);
    $('#copySheets').addEventListener('click', copyForSheets);
    $('#menuBtn').addEventListener('click', () =>
      $('#menuPop').classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
      if (!$('#menuPop').classList.contains('hidden') &&
          !$('#menuPop').contains(e.target) && e.target !== $('#menuBtn')) {
        $('#menuPop').classList.add('hidden');
      }
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

    $('#libToggle').addEventListener('click', () =>
      $('#libraryPane').classList.toggle('open'));
  }

  // --- Boot ----------------------------------------------------------------

  load();
  wire();
  renderAll();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
