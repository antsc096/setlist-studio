/* Sugar Whiskey Song Picks - the couple's side of the song picks exchange.
   No server anywhere: the song list arrives inside the link the band sent,
   the couple's verdicts travel back inside a link they send in reply. This
   page never stores anything except a draft of their own picks, kept in
   this browser so a closed tab does not lose them.

   The same page also renders the reply link: when the band leader taps the
   link the couple sent back, it shows the picks and hands them on to the
   Setlist Manager. */

(() => {
  'use strict';

  // The manager app's home. This never moves, even when this page gains
  // its branded address on the band's own domain.
  const MANAGER_URL = 'https://antsc096.github.io/setlist-studio/';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let toastTimer = null;
  function toast(message) {
    let t = $('#toast');
    if (!t) {
      t = el('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = message;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  // --- The payload in the link --------------------------------------------

  let rawPayload = '';

  function dataFromHash() {
    const m = location.hash.match(/p=([A-Za-z0-9+$\-]+)/);
    if (!m) return null;
    rawPayload = m[1];
    try {
      const data = JSON.parse(
        LZString.decompressFromEncodedURIComponent(rawPayload));
      if (data && data.kind === 'list' && Array.isArray(data.songs)) {
        return data;
      }
      if (data && data.kind === 'picks' &&
          Array.isArray(data.please) && Array.isArray(data.no)) {
        return data;
      }
    } catch (e) { /* fall through to the no-link view */ }
    return null;
  }

  // --- Views ----------------------------------------------------------------

  function renderNoLink() {
    const main = $('#main');
    const card = el('div', 'card');
    card.appendChild(el('h1', null, 'This page needs a link from the band'));
    card.appendChild(el('p', null,
      'The Sugar Whiskey Band sends couples a personal song picks link. ' +
      'If yours landed you here without any songs, ask the band to send ' +
      'it again.'));
    main.appendChild(card);
  }

  // The couple's view: every song, two buttons, one send.
  function renderVoting(data) {
    const main = $('#main');
    const draftKey = 'sw-picks.' + (data.sid || 'draft');

    // verdicts[i]: 1 = please play, 2 = heck no, absent = no opinion.
    let verdicts = {};
    try {
      verdicts = JSON.parse(localStorage.getItem(draftKey)) || {};
    } catch (e) { /* a lost draft is no tragedy */ }
    const keepDraft = () => {
      try { localStorage.setItem(draftKey, JSON.stringify(verdicts)); }
      catch (e) { /* private browsing; picks still live on the page */ }
    };

    const card = el('div', 'card');
    card.appendChild(el('h1', null,
      data.couple ? 'Hi ' + data.couple + '!' : 'Hi!'));
    const p1 = el('p');
    p1.appendChild(document.createTextNode('Tap '));
    p1.appendChild(el('span', 'hot', 'PLEASE PLAY'));
    p1.appendChild(document.createTextNode(
      ' on the songs you would love to hear, and '));
    p1.appendChild(el('span', 'not', 'HECK NO'));
    p1.appendChild(document.createTextNode(
      ' on the ones we should not even think about.'));
    card.appendChild(p1);
    card.appendChild(el('p', null,
      'Skip anything you have no feelings about - the band will use its ' +
      'judgment. Hit send when you are done.'));
    main.appendChild(card);

    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = 'Search ' + data.songs.length + ' songs';
    search.autocomplete = 'off';
    main.appendChild(search);

    const list = el('ul', 'songs');
    main.appendChild(list);

    const rows = data.songs.map((title, i) => {
      const li = el('li', 'song-row');
      li.appendChild(el('span', 'title', title));
      const yes = el('button', 'vote please', 'PLEASE PLAY');
      const no = el('button', 'vote no', 'HECK NO');
      const paint = () => {
        yes.classList.toggle('on', verdicts[i] === 1);
        no.classList.toggle('on', verdicts[i] === 2);
        li.classList.toggle('on-please', verdicts[i] === 1);
        li.classList.toggle('on-no', verdicts[i] === 2);
      };
      const set = (v) => {
        if (verdicts[i] === v) delete verdicts[i];
        else verdicts[i] = v;
        keepDraft(); paint(); tally();
      };
      yes.addEventListener('click', () => set(1));
      no.addEventListener('click', () => set(2));
      paint();
      li.appendChild(yes);
      li.appendChild(no);
      return { li, title: title.toLowerCase() };
    });
    for (const r of rows) list.appendChild(r.li);

    const empty = el('div', 'empty hidden', 'Nothing matches.');
    main.appendChild(empty);

    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const r of rows) {
        const hit = !q || r.title.includes(q);
        r.li.classList.toggle('hidden', !hit);
        if (hit) shown++;
      }
      empty.classList.toggle('hidden', !!shown);
    });

    const bar = $('#sendBar');
    bar.classList.remove('hidden');

    function counts() {
      let please = 0;
      let no = 0;
      for (const i in verdicts) {
        if (verdicts[i] === 1) please++;
        if (verdicts[i] === 2) no++;
      }
      return { please, no };
    }

    function tally() {
      const c = counts();
      const t = $('#tally');
      t.innerHTML = '';
      const hot = el('b', 'hot', String(c.please));
      const not = el('b', 'not', String(c.no));
      t.appendChild(hot);
      t.appendChild(document.createTextNode(' please play · '));
      t.appendChild(not);
      t.appendChild(document.createTextNode(' heck no'));
    }
    tally();

    $('#sendBtn').addEventListener('click', () => {
      const c = counts();
      if (!c.please && !c.no) {
        toast('Tap PLEASE PLAY or HECK NO on at least one song first.');
        return;
      }
      const please = [];
      const no = [];
      data.songs.forEach((title, i) => {
        if (verdicts[i] === 1) please.push(title);
        if (verdicts[i] === 2) no.push(title);
      });
      const payload = LZString.compressToEncodedURIComponent(JSON.stringify({
        v: 1, kind: 'picks', sid: data.sid || '',
        couple: data.couple || '', please, no,
      }));
      const url = location.origin + location.pathname + '#p=' + payload;
      const text = (data.couple ? data.couple + "'s" : 'Our') +
        ' song picks for The Sugar Whiskey Band: ' + c.please +
        ' please play, ' + c.no + ' heck no.';
      if (navigator.share) {
        navigator.share({ text, url }).catch(() => {});
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text + '\n' + url).then(
          () => toast('Copied. Paste it back to the band in a message.'),
          () => showFallback(url));
      } else {
        showFallback(url);
      }
    });

    function showFallback(url) {
      let box = $('#fallback');
      if (!box) {
        box = el('textarea', 'fallback');
        box.id = 'fallback';
        box.rows = 3;
        box.readOnly = true;
        main.appendChild(box);
      }
      box.value = url;
      box.focus();
      box.select();
      toast('Copy this link and send it back to the band.');
    }
  }

  // The band leader's view of a reply: what the couple said, and the way
  // into the Setlist Manager. The manager matches songs by title, so this
  // page only has to hand the payload on.
  function renderPicks(data) {
    const main = $('#main');
    const card = el('div', 'card');
    card.appendChild(el('h1', null,
      'Song picks from ' + (data.couple || 'the couple')));
    const p = el('p');
    p.appendChild(el('span', 'hot', data.please.length + ' PLEASE PLAY'));
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(el('span', 'not', data.no.length + ' HECK NO'));
    card.appendChild(p);

    const openBtn = el('a', 'open-btn', 'Open in Setlist Manager');
    openBtn.href = MANAGER_URL + '#p=' + rawPayload;
    card.appendChild(openBtn);

    const copyBtn = el('button', 'copy-code', 'Copy picks code');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(rawPayload).then(
        () => toast('Code copied.'),
        () => toast('Could not reach the clipboard.'));
    });
    card.appendChild(copyBtn);
    card.appendChild(el('p', 'fine',
      'If the app opens without picking these up (it can happen on an ' +
      'iPhone home-screen app), copy the code instead, then use ' +
      '⋯ → Import song picks inside Setlist Manager.'));
    main.appendChild(card);

    if (data.please.length) {
      main.appendChild(el('h2', 'vh hot', 'Please play'));
      const ul = el('ul', 'verdict-list please');
      for (const t of data.please) ul.appendChild(el('li', null, t));
      main.appendChild(ul);
    }
    if (data.no.length) {
      main.appendChild(el('h2', 'vh not', 'Heck no'));
      const ul = el('ul', 'verdict-list no');
      for (const t of data.no) ul.appendChild(el('li', null, t));
      main.appendChild(ul);
    }
  }

  // --- Boot -----------------------------------------------------------------

  const data = dataFromHash();
  if (!data) renderNoLink();
  else if (data.kind === 'list') renderVoting(data);
  else renderPicks(data);
})();
