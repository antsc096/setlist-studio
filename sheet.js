/* The setlist as the band reads it: the PDF and the Google Docs copy.
   Shared by Setlist Manager and the band manager hub (where band members
   open their gigs' setlists), so a setlist prints and pastes the same
   wherever it comes from. Needs vendor/jspdf.umd.min.js for the PDF, and
   brand/ beside it for the logo and heading font.

   SetlistSheet.ready()                 loads the logo and font (a promise)
   SetlistSheet.savePdf(doc, library)   share or download the PDF
   SetlistSheet.pdfUrl(doc, library, print)  a link to it, to open
   SetlistSheet.copyDocs(doc, library)  copy for Google Docs (a promise)
   SetlistSheet.writeClipboard(html, text)  a promise */

(() => {
  'use strict';

  const BLANK_PART = { singer: '', key: '' };
  const partFor = (song, item) => {
    if (!song || !song.parts || !song.parts.length) return BLANK_PART;
    return (item && item.partId && song.parts.find((p) => p.id === item.partId)) || song.parts[0];
  };
  const songsOf = (library) => {
    const byId = new Map((library || []).map((s) => [s.id, s]));
    return (id) => byId.get(id) || null;
  };
  const noteOf = (song, item) => [song.note, item.note].filter(Boolean).join(' · ');

  function filename(d, ext) {
    const base = ((d.header && d.header.couple) || 'setlist')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return (base || 'setlist') + '.' + ext;
  }

  // Which marks a setlist uses, for the legend: only those, and only when
  // a marked song is on it.
  function marksIn(d, songById) {
    const m = { requested: false, dance: false, isNew: false };
    for (const set of d.sets) {
      for (const item of set.items) {
        if (item.brk || item.noteRow) continue;
        const song = songById(item.songId);
        if (!song) continue;
        if (item.requested) m.requested = true;
        if (item.firstDance) m.dance = true;
        if (song.isNew) m.isNew = true;
      }
    }
    return m;
  }

  // --- The PDF ---------------------------------------------------------------
  //
  // One page per set, each set in the largest type that keeps it on its
  // page: the sheet is read from the floor in bad light. The first page
  // carries the event header above the first set; the others repeat the
  // event's name and date at the top. Long titles wrap rather than being
  // cut, every second song is lightly shaded so a key lines up with its
  // song from a distance, and every page ends with the legend.
  //
  // Branded, without costing any reading size: the band's logo sits beside
  // the title (or the running line), never above it, and the band's
  // heading font is for the title and set headings only. Songs stay in a
  // plain sans-serif.

  const INK = [29, 39, 36];
  const DIM = [92, 106, 102];
  const RED = [194, 44, 44];
  const PURPLE = [122, 63, 184];
  const SHADE = [241, 238, 231];
  const MARGIN = 40;
  const MAX_SIZE = 28;
  const MIN_SIZE = 7;
  const FOOTER = 22;
  const LOGO_RATIO = 216 / 102;

  // The logo and heading font, loaded once (ready()). Until they are, or if
  // they can't be, the PDF is the same in Helvetica without the logo.
  let brand = {};
  let brandLoad = null;
  const here = (document.currentScript && document.currentScript.src) || location.href;
  function ready() {
    if (!brandLoad) {
      const get = (path) => fetch(new URL(path, here)).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      const dataUrl = (blob) => new Promise((ok, fail) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.onerror = fail;
        fr.readAsDataURL(blob);
      });
      brandLoad = Promise.all([
        get('brand/sugar-heading.ttf').then(dataUrl).then((u) => u.slice(u.indexOf(',') + 1)).catch(() => null),
        get('brand/sugar-whiskey.png').then(dataUrl).catch(() => null),
      ]).then(([font, logo]) => { brand = { font, logo }; });
    }
    return brandLoad;
  }

  // The heading font where it's loaded (it has no long dashes).
  function headFont(pdf, size) {
    if (brand.font) pdf.setFont('Chapaza', 'normal'); else pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(size);
  }
  const headText = (t) => (brand.font ? String(t).replace(/[–—]/g, '-') : String(t));

  // Lays out one set at type size s from `top`, drawing it when `draw`.
  // Returns the height it takes, and the most lines any song title took.
  function setBlock(pdf, set, s, top, songById, draw) {
    const pageW = pdf.internal.pageSize.getWidth();
    const left = MARGIN;
    const right = pageW - MARGIN;
    const line = s * 1.28;
    const noteSize = s * 0.78;
    let y = top;
    const text = (t, x, size, opts) => { if (draw) pdf.text(t, x, y + size * 0.82, opts); };

    // The heading, ruled.
    const head = s * 1.25;
    headFont(pdf, head);
    if (draw) pdf.setTextColor(...INK);
    for (const l of pdf.splitTextToSize(headText(set.label || ''), right - left)) { text(l, left, head); y += head * 1.15; }
    if (draw) { pdf.setDrawColor(...INK); pdf.setLineWidth(0.8); pdf.line(left, y + s * 0.12, right, y + s * 0.12); }
    y += s * 0.5;

    // Columns sized to this set's keys and singers at this size.
    let keyW = 0;
    let singerW = 0;
    pdf.setFontSize(s);
    for (const item of set.items) {
      if (item.brk || item.noteRow) continue;
      const part = partFor(songById(item.songId), item);
      pdf.setFont('helvetica', 'bold');
      keyW = Math.max(keyW, pdf.getTextWidth(part.key || ''));
      pdf.setFont('helvetica', 'normal');
      singerW = Math.max(singerW, pdf.getTextWidth(part.singer || ''));
    }
    const gap = s * 0.9;
    const numX = left + s * 1.3;
    const titleX = left + s * 1.8;
    const singerX = right - singerW;
    const keyX = singerX - (singerW ? gap : 0) - keyW;
    const titleW = Math.max(s * 4, keyX - gap - titleX);
    const pad = s * 0.12;  // above and below each song, inside its shading

    let n = 0;
    let lines = 1;
    for (const item of set.items) {
      if (item.brk) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(s);
        if (draw) pdf.setTextColor(...DIM);
        text('— ' + (item.label || 'Break') + (item.minutes ? ' (' + item.minutes + ' min)' : '') + ' —', titleX, s);
        y += line;
        continue;
      }
      if (item.noteRow) {
        if (!item.text) continue;
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(s * 0.9);
        if (draw) pdf.setTextColor(...DIM);
        for (const l of pdf.splitTextToSize(item.text, right - titleX)) { text(l, titleX, s * 0.9); y += s * 0.9 * 1.25; }
        y += s * 0.15;
        continue;
      }
      const song = songById(item.songId);
      if (!song) continue;
      const part = partFor(song, item);
      n++;
      const bold = song.isNew || item.requested || item.firstDance;
      pdf.setFontSize(s);
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      const titleLines = pdf.splitTextToSize(song.title, titleW);
      lines = Math.max(lines, titleLines.length);
      const note = noteOf(song, item);
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(noteSize);
      const noteLines = note ? pdf.splitTextToSize(note, titleW) : [];
      const rowH = pad * 2 + titleLines.length * line + (noteLines.length ? noteLines.length * noteSize * 1.22 - s * 0.12 : 0);

      if (draw && n % 2 === 0) {
        pdf.setFillColor(...SHADE);
        pdf.rect(left - 4, y, right - left + 8, rowH, 'F');
      }
      y += pad;
      const rowTop = y;
      pdf.setFontSize(s);
      pdf.setFont('helvetica', 'normal');
      if (draw) pdf.setTextColor(...DIM);
      text(String(n), numX, s, { align: 'right' });
      if (draw) {
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...INK);
        text(part.key || '', keyX, s);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...DIM);
        text(part.singer || '', singerX, s);
      }
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      if (draw) pdf.setTextColor(...(item.firstDance ? PURPLE : song.isNew ? RED : INK));
      for (const l of titleLines) { text(l, titleX, s); y += line; }
      if (noteLines.length) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(noteSize);
        if (draw) pdf.setTextColor(...DIM);
        y -= s * 0.12;
        for (const l of noteLines) { text(l, titleX, noteSize); y += noteSize * 1.22; }
      }
      y = rowTop - pad + rowH;
    }
    return { h: y - top, lines };
  }

  // The band's logo, `h` high with its top at `top`, flush right.
  function logo(pdf, top, h) {
    if (!brand.logo) return;
    const pageW = pdf.internal.pageSize.getWidth();
    pdf.addImage(brand.logo, 'PNG', pageW - MARGIN - h * LOGO_RATIO, top, h * LOGO_RATIO, h);
  }

  // The event header for the first page. Returns its height.
  function headerBlock(pdf, d, top, draw) {
    const pageW = pdf.internal.pageSize.getWidth();
    const width = pageW - MARGIN * 2;
    const h = d.header || {};
    let y = top;
    // The title, with the logo beside it in the same band (no extra height).
    const logoW = brand.logo ? 27 * LOGO_RATIO + 12 : 0;
    pdf.setTextColor(...INK);
    let size = 24;
    headFont(pdf, size);
    const title = headText(h.couple || 'Setlist');
    while (size > 14 && pdf.getTextWidth(title) > width - logoW) headFont(pdf, --size);
    if (draw) {
      pdf.text(pdf.splitTextToSize(title, width - logoW)[0], MARGIN, y + 19);
      logo(pdf, y - 5, 27);
    }
    y += 26;
    if (draw) { pdf.setDrawColor(...INK); pdf.setLineWidth(1.2); pdf.line(MARGIN, y, pageW - MARGIN, y); }
    y += 8;

    // Two to a line when both fit, otherwise one, wrapped.
    pdf.setFontSize(10);
    const meta = [
      ['Venue', h.venue], ['Date', h.date], ['Crew', h.crew], ['Sound', h.sound],
      ['Point of contact', h.contact], ['MC', h.mc],
    ].filter(([, v]) => v).map(([k, v]) => [k.toUpperCase() + ': ', String(v)]);
    const widthOf = ([k, v]) => {
      pdf.setFont('helvetica', 'bold');
      const kw = pdf.getTextWidth(k);
      pdf.setFont('helvetica', 'normal');
      return kw + pdf.getTextWidth(v);
    };
    const put = ([k, v], x, w) => {
      pdf.setFont('helvetica', 'bold');
      const kw = pdf.getTextWidth(k);
      if (draw) pdf.text(k, x, y + 9);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(v, w - kw);
      lines.forEach((l, i) => { if (draw) pdf.text(l, x + kw, y + 9 + i * 13); });
      return lines.length;
    };
    const half = width / 2;
    for (let i = 0; i < meta.length;) {
      const a = meta[i];
      const b = meta[i + 1];
      if (b && widthOf(a) < half - 10 && widthOf(b) < half - 10) {
        put(a, MARGIN, half);
        put(b, MARGIN + half, half);
        y += 14;
        i += 2;
      } else {
        y += put(a, MARGIN, width) * 13 + 1;
        i += 1;
      }
    }
    if (h.notes) {
      y += 3;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(...DIM);
      for (const l of pdf.splitTextToSize(h.notes, width)) { if (draw) pdf.text(l, MARGIN, y + 9); y += 12.5; }
      pdf.setTextColor(...INK);
    }
    return y - top + 10;
  }

  function buildPdf(d, library) {
    const songById = songsOf(library);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    if (brand.font) {
      pdf.addFileToVFS('sugar-heading.ttf', brand.font);
      pdf.addFont('sugar-heading.ttf', 'Chapaza', 'normal');
    }
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const h = d.header || {};
    const marks = marksIn(d, songById);
    const legend = [];
    if (marks.requested) legend.push('bold = requested by the couple');
    if (marks.dance) legend.push('purple = first dance');
    if (marks.isNew) legend.push('red = new song');
    const running = [h.couple, h.date].filter(Boolean).join('  ·  ');
    const sets = d.sets.length ? d.sets : [{ label: '', items: [] }];

    sets.forEach((set, i) => {
      if (i) pdf.addPage();
      let top = MARGIN;
      if (i === 0) {
        top += headerBlock(pdf, d, top, true);
      } else {
        // The event's name and date, and a small logo, in one 20pt band.
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(...DIM);
        if (running) pdf.text(running, MARGIN, top + 7);
        logo(pdf, top - 6, 18);
        top += 20;
      }
      // The largest size, in half points, that keeps the set on the page
      // with no title over two lines; a little smaller instead if that keeps
      // every title on one line.
      const room = pageH - MARGIN - FOOTER - top;
      let size = 0;
      let unwrapped = 0;
      for (let s = MAX_SIZE; s >= MIN_SIZE && !unwrapped; s -= 0.5) {
        const fit = setBlock(pdf, set, s, top, songById, false);
        if (fit.h > room || (fit.lines > 2 && s > MIN_SIZE)) continue;
        if (!size) size = s;
        if (fit.lines === 1) unwrapped = s;
      }
      if (unwrapped >= size * 0.82) size = unwrapped;
      size = size || MIN_SIZE;
      setBlock(pdf, set, size, top, songById, true);

      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(8);
      pdf.setTextColor(...DIM);
      if (legend.length) pdf.text(legend.join('   ·   '), MARGIN, pageH - MARGIN);
      if (sets.length > 1) pdf.text((i + 1) + ' / ' + sets.length, pageW - MARGIN, pageH - MARGIN, { align: 'right' });
    });
    return pdf;
  }

  function savePdf(d, library) {
    const pdf = buildPdf(d, library);
    const name = filename(d, 'pdf');
    const file = new File([pdf.output('blob')], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // A share cancelled or refused (no tap left to spend) still gets the file.
      navigator.share({ files: [file], title: name }).catch((e) => { if (!e || e.name !== 'AbortError') pdf.save(name); });
    } else {
      pdf.save(name);
    }
  }

  // A link to the PDF, to open in a tab; `print` has it ask to print as it opens.
  function pdfUrl(d, library, print) {
    const pdf = buildPdf(d, library);
    if (print) pdf.autoPrint();
    return URL.createObjectURL(pdf.output('blob'));
  }

  // --- The Google Docs copy -------------------------------------------------

  function writeClipboard(html, text) {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      return navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]).catch(() => navigator.clipboard.writeText(text));
    }
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('No clipboard'));
  }

  const esc = (t) => String(t).replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function songCellHtml(song, item) {
    let t = esc(song.title);
    if (item.requested || item.firstDance) t = '<b>' + t + '</b>';
    if (item.firstDance) t = '<span style="color:#7a3fb8">' + t + '</span>';
    else if (song.isNew) t = '<span style="color:#c22c2c">' + t + '</span>';
    return t;
  }

  // Colour does not survive a paste into a plain-text field, so the text
  // flavour says it in words.
  const danceTag = (item) => (item.firstDance ? ' (first dance)' : '');

  // Google Docs sizes a pasted table to its contents, so a table of short
  // song titles ends up as a narrow strip floating on the page. Declaring a
  // width per column fixes that: these add up to 600pt, the text column of
  // an A4 page with the default margins, so the table always spans it.
  const DOC_COLS = [36, 372, 72, 120];
  const CELL = 'padding:4px 7px;border:1px solid #b8c1be;vertical-align:top;';
  const cellStyle = (i) => 'width:' + DOC_COLS[i] + 'px;' + CELL;

  // A formatted document for Google Docs: header lines, then one real
  // table per set. Requested songs are bold, new songs red - no extra
  // columns carrying what type can say.
  function docsCopy(d, library) {
    const songById = songsOf(library);
    const h = d.header || {};
    let html = '<meta charset="utf-8">';
    html += '<h1>' + esc(h.couple || 'Setlist') + '</h1>';
    const meta = [
      ['Venue', h.venue], ['Date', h.date],
      ['Crew', h.crew], ['Sound', h.sound],
      ['Point of contact', h.contact], ['MC', h.mc],
    ].filter(([, v]) => v);
    for (const [k, v] of meta) {
      html += '<p><b>' + k + ':</b> ' + esc(v) + '</p>';
    }
    if (h.notes) {
      html += '<p>' + esc(h.notes).replace(/\n/g, '<br>') + '</p>';
    }
    let text = (h.couple || 'Setlist') + '\n';
    for (const set of d.sets) {
      html += '<h2>' + esc(set.label) + '</h2>';
      text += '\n' + set.label + '\n';
      // Note lines live between the tables, never inside them: the table
      // closes at a note, the note stands as its own paragraph, and a
      // fresh table (same columns, no repeated header) picks the songs
      // back up after it.
      let tableOpen = false;
      let headerDone = false;
      const openTable = () => {
        html += '<table style="width:100%;border-collapse:collapse;' +
          'table-layout:fixed">' +
          '<colgroup>' + DOC_COLS.map((w) =>
            '<col style="width:' + w + 'px">').join('') + '</colgroup>';
        if (!headerDone) {
          html += '<tr>' + ['#', 'Song', 'Key', 'Singer'].map((c, i) =>
            '<th style="' + cellStyle(i) +
            'text-align:left;background:#eef2f1">' + c + '</th>').join('') +
            '</tr>';
          headerDone = true;
        }
        tableOpen = true;
      };
      const closeTable = () => {
        if (tableOpen) { html += '</table>'; tableOpen = false; }
      };
      let n = 0;
      for (const item of set.items) {
        if (item.noteRow) {
          if (!item.text) continue;
          closeTable();
          html += '<p style="margin:6px 0"><i style="color:#5c6a66">' +
            esc(item.text) + '</i></p>';
          text += '- ' + item.text + '\n';
          continue;
        }
        if (!tableOpen) openTable();
        if (item.brk) {
          html += '<tr><td style="' + cellStyle(0) + '"></td>' +
            '<td colspan="3" style="' + CELL + '"><i>' +
            esc(item.label || 'Break') +
            (item.minutes ? ' (' + item.minutes + ' min)' : '') +
            '</i></td></tr>';
          text += '- ' + (item.label || 'Break') + '\n';
          continue;
        }
        const song = songById(item.songId);
        if (!song) continue;
        n++;
        const part = partFor(song, item);
        const noteText = noteOf(song, item);
        const note = noteText
          ? ' <i style="color:#5c6a66">' + esc(noteText) + '</i>' : '';
        html += '<tr><td style="' + cellStyle(0) + '">' + n + '</td>' +
          '<td style="' + cellStyle(1) + '">' + songCellHtml(song, item) +
          note + '</td><td style="' + cellStyle(2) + '"><b>' +
          esc(part.key) + '</b></td><td style="' + cellStyle(3) + '">' +
          esc(part.singer) + '</td></tr>';
        text += n + '. ' + song.title + danceTag(item) + '  ' +
          part.key + '  ' + part.singer + '\n';
      }
      closeTable();
    }
    // The same legend the PDF prints, so the artist reading the pasted
    // doc knows what the colours and bold mean.
    const marks = marksIn(d, songById);
    const legend = [];
    if (marks.requested) legend.push('<b>bold</b> = requested by the couple');
    if (marks.dance) legend.push('<span style="color:#7a3fb8">purple</span> = first dance');
    if (marks.isNew) legend.push('<span style="color:#c22c2c">red</span> = new song');
    if (legend.length) {
      html += '<p style="font-size:10px;color:#5c6a66"><i>' +
        legend.join(' &nbsp;·&nbsp; ') + '</i></p>';
      text += '\n' + legend.join(' · ').replace(/<[^>]+>/g, '') + '\n';
    }
    return { html, text };
  }

  const copyDocs = (d, library) => {
    const { html, text } = docsCopy(d, library);
    return writeClipboard(html, text);
  };

  window.SetlistSheet = { ready, savePdf, pdfUrl, buildPdf, copyDocs, docsCopy, writeClipboard, filename };
})();
