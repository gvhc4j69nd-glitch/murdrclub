'use strict';

/* MURDRCLUB front end: one page, routed by the URL hash, polling the API. */

(() => {
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const toastEl = document.getElementById('toast');

  const state = {
    user: null,
    club: null,
    clubId: null,
    shellKey: null,
    chatTab: 'table',
    whisperTo: null,
    selected: null,     // { cardId, phase } waiting for a target
    serverOffset: 0,
    poll: null,
    sigs: {},
  };

  // ------------------------------------------------------------ utilities

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v; // CSSOM, which the CSP allows
      else if (k === 'hidden') el.hidden = true;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  async function api(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }

  const guard = (fn) => async (...args) => {
    try { await fn(...args); } catch (e) { toast(e.message); }
  };

  function avatar(name) {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 360;
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const el = h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials);
    el.style.background = `hsl(${hash} 40% 68%)`;
    return el;
  }

  function fmtDuration(ms) {
    if (ms <= 0) return '0:00';
    const s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (hh) return `${hh}h ${pad(mm)}m`;
    return `${mm}:${pad(ss)}`;
  }

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /** Re-render `el` only when `data` changed, so typing and scrolling survive polls. */
  function patch(key, el, data, render) {
    if (!el) return;
    const sig = JSON.stringify(data);
    if (state.sigs[key] === sig) return;
    state.sigs[key] = sig;
    el.replaceChildren(...[].concat(render(data)).filter(Boolean));
  }

  // ------------------------------------------------------------ routing

  function stopPolling() {
    clearInterval(state.poll);
    state.poll = null;
  }

  async function route() {
    stopPolling();
    state.club = null;
    state.shellKey = null;
    state.sigs = {};
    state.selected = null;
    const parts = (location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
    renderNav();

    if (parts[0] === 'join' && parts[1]) {
      if (!state.user) {
        sessionStorage.setItem('mc_join', parts[1]);
        return renderLanding(`Sign up or sign in to take your seat at table ${parts[1].toUpperCase()}.`);
      }
      try {
        const { club } = await api('/api/clubs/join', { code: parts[1] });
        location.replace(`#/table/${club.id}`);
      } catch (e) {
        toast(e.message);
        location.replace('#/');
      }
      return undefined;
    }
    if (!state.user) return renderLanding();
    if ((parts[0] === 'table' || parts[0] === 'club') && parts[1]) return openTable(parts[1]);
    return renderHome();
  }

  function renderNav() {
    nav.replaceChildren();
    if (!state.user) return;
    nav.append(
      h('span', { class: 'muted small nav-name' }, state.user.name),
      h('a', { class: 'btn small ghost', href: '#/' }, 'My tables'),
      h('button', { class: 'small ghost', onclick: guard(async () => {
        await api('/api/logout', {});
        state.user = null;
        location.hash = '#/';
        route();
      }) }, 'Sign out'),
    );
  }

  // ------------------------------------------------------------ landing

  function renderLanding(notice) {
    let mode = 'signup';
    const form = h('form', { class: 'card' });
    const draw = () => {
      form.replaceChildren(...[
        h('div', { class: 'tabs', role: 'tablist' },
          h('button', { type: 'button', class: mode === 'signup' ? 'selected' : '', onclick: () => { mode = 'signup'; draw(); } }, 'Become an heir'),
          h('button', { type: 'button', class: mode === 'login' ? 'selected' : '', onclick: () => { mode = 'login'; draw(); } }, 'Sign in')),
        notice ? h('p', { class: 'small' }, notice) : null,
        h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'Name (shown to other players)'),
          h('input', { id: 'f-name', name: 'name', autocomplete: 'username', required: true, maxlength: '24' })),
        h('div', { class: 'field' }, h('label', { for: 'f-pw' }, 'Password'),
          h('input', { id: 'f-pw', name: 'password', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', required: true, minlength: '8' })),
        h('button', { class: 'primary', type: 'submit', style: 'width:100%' }, mode === 'signup' ? 'Create account' : 'Sign in'),
      ].filter(Boolean));
    };
    form.addEventListener('submit', guard(async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const { user } = await api(mode === 'signup' ? '/api/signup' : '/api/login', { name: fd.get('name'), password: fd.get('password') });
      state.user = user;
      const pending = sessionStorage.getItem('mc_join');
      sessionStorage.removeItem('mc_join');
      location.hash = pending ? `#/join/${pending}` : '#/';
      route();
    }));
    draw();

    app.replaceChildren(h('section', { class: 'hero' },
      h('div', {},
        h('h1', {}, 'Four heirs. One fortune. Nobody leaves the will reading alive — well, one does.'),
        h('p', { class: 'tagline' }, 'MurdrClub is a ruthless card game for four. Bank your bequests, blackmail your rivals, forge the will — and when the lights go out, play a card into the Shadows. Nobody sees who struck. After eight nights the richest heir still breathing inherits everything.'),
        h('div', { class: 'steps' },
          h('div', { class: 'step' }, h('b', {}, 'Day'), h('span', { class: 'muted small' }, 'Take your turn in the open: bank bequests, scheme, hire a Bodyguard, make a Pact.')),
          h('div', { class: 'step' }, h('b', {}, 'Night'), h('span', { class: 'muted small' }, 'Everyone plays one card face down. A Dagger, an Alibi — or a bluff. Attackers stay secret.')),
          h('div', { class: 'step' }, h('b', {}, 'Inquest'), h('span', { class: 'muted small' }, 'Accuse an heir. A majority means arrest, a fine, and a night in the cells.'))),
        h('p', { class: 'muted small', style: 'margin-top:18px' }, 'Play live in about half an hour, or timed, with up to a day for each move.')),
      form));
  }

  // ------------------------------------------------------------ home

  async function renderHome() {
    const [{ clubs, invitations }, { clubs: open }] = await Promise.all([api('/api/clubs'), api('/api/clubs/open')]);

    const create = h('form', { class: 'card' },
      h('h2', {}, 'Set a table'),
      h('div', { class: 'field' }, h('label', { for: 'f-club' }, 'Table name'),
        h('input', { id: 'f-club', name: 'name', maxlength: '40', placeholder: `${state.user.name}'s Table` })),
      h('div', { class: 'field' }, h('label', { for: 'f-mode' }, 'Mode'),
        h('select', { id: 'f-mode', name: 'mode' },
          h('option', { value: 'live' }, 'Live — 45 seconds a turn, about 30–40 minutes'),
          h('option', { value: 'timed' }, 'Timed — up to a day for each move'))),
      h('div', { class: 'field' }, h('label', { for: 'f-vis' }, 'Who can join'),
        h('select', { id: 'f-vis', name: 'visibility' },
          h('option', { value: 'private' }, 'Private — invitation only'),
          h('option', { value: 'public' }, 'Public — listed under Open tables'))),
      h('p', { class: 'muted small' }, 'Four seats. Empty ones can be filled with bots. Nobody joins once the cards are dealt.'),
      h('button', { class: 'primary', type: 'submit' }, 'Create table'));
    create.addEventListener('submit', guard(async (ev) => {
      ev.preventDefault();
      const fd = new FormData(create);
      const { club } = await api('/api/clubs', { name: fd.get('name'), mode: fd.get('mode'), visibility: fd.get('visibility') });
      location.hash = `#/table/${club.id}`;
    }));

    const join = h('form', { class: 'card' },
      h('h2', {}, 'Have an invitation?'),
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('label', { for: 'f-code' }, 'Invitation code'),
          h('input', { id: 'f-code', name: 'code', placeholder: 'ABC234', maxlength: '8', autocapitalize: 'characters' })),
        h('button', { type: 'submit' }, 'Join')));
    join.addEventListener('submit', guard(async (ev) => {
      ev.preventDefault();
      const { club } = await api('/api/clubs/join', { code: new FormData(join).get('code') });
      location.hash = `#/table/${club.id}`;
    }));

    const badge = (c) => {
      if (c.status === 'lobby') return h('span', { class: 'badge gold' }, 'Lobby');
      if (c.status === 'ended') return h('span', { class: `badge ${c.won ? 'ok' : ''}` }, c.won ? 'You inherited' : 'Will read');
      if (!c.myAlive) return h('span', { class: 'badge' }, 'Murdered');
      if (c.myTurn) return h('span', { class: 'badge blood' }, 'Your turn');
      return h('span', { class: 'badge ok' }, `Round ${c.round} of ${c.rounds}`);
    };
    const modeLabel = (m) => (m === 'timed' ? 'timed' : 'live');

    const left = h('div', { class: 'stack' });
    if (invitations.length) {
      left.append(h('section', { class: 'card invitations' }, h('h2', {}, 'You are invited'),
        h('ul', { class: 'club-list' }, invitations.map((c) => h('li', { class: 'club-item' },
          h('div', {}, h('b', {}, c.name), h('div', { class: 'muted small' }, `Hosted by ${c.host} · ${c.players}/${c.seats} seats · ${modeLabel(c.mode)}`)),
          h('div', { class: 'row' },
            h('button', { class: 'primary small', onclick: guard(async () => { const { club } = await api('/api/clubs/join', { id: c.id }); location.hash = `#/table/${club.id}`; }) }, 'Accept'),
            h('button', { class: 'small ghost', onclick: guard(async () => { await api(`/api/invitations/${c.id}/decline`, {}); renderHome(); }) }, 'Decline')))))));
    }
    left.append(h('section', { class: 'card' }, h('h2', {}, 'Your tables'),
      clubs.length
        ? h('ul', { class: 'club-list' }, clubs.map((c) => h('li', {}, h('a', { class: 'club-item', href: `#/table/${c.id}` },
          h('div', {}, h('b', {}, c.name), h('div', { class: 'muted small' }, `${c.alive}/${c.players} heirs alive${c.isHost ? ' · you host' : ''} · ${modeLabel(c.mode)}`)),
          badge(c)))))
        : h('p', { class: 'muted' }, 'No tables yet. Set one and invite three friends, or fill the seats with bots.')));
    left.append(h('section', { class: 'card' }, h('h2', {}, 'Open tables'),
      open.length
        ? h('ul', { class: 'club-list' }, open.map((c) => h('li', { class: 'club-item' },
          h('div', {}, h('b', {}, c.name), h('div', { class: 'muted small' }, `Hosted by ${c.host} · ${c.players}/${c.seats} seats · ${modeLabel(c.mode)}`)),
          h('button', { class: 'small', onclick: guard(async () => { const { club } = await api('/api/clubs/join', { id: c.id }); location.hash = `#/table/${club.id}`; }) }, 'Take a seat'))))
        : h('p', { class: 'muted small' }, 'No public tables are waiting for players right now.')));

    app.replaceChildren(h('div', { class: 'home' }, left, h('div', { class: 'stack' }, create, join)));
  }

  // ------------------------------------------------------------ table

  async function openTable(id) {
    state.clubId = id;
    await refresh();
    state.poll = setInterval(() => refresh().catch(() => {}), 2500);
  }

  async function refresh() {
    try {
      const { club } = await api(`/api/clubs/${state.clubId}`);
      setClub(club);
    } catch (e) {
      if (e.status === 404 || e.status === 403) {
        stopPolling();
        toast(e.message);
        location.hash = '#/';
      } else {
        throw e;
      }
    }
  }

  function setClub(club) {
    const prev = state.club;
    state.club = club;
    state.serverOffset = club.now - Date.now();
    if (prev && (prev.phase !== club.phase || prev.turn !== club.turn)) state.selected = null;
    const key = `${club.id}:${club.status === 'lobby' ? 'lobby' : 'game'}`;
    if (state.shellKey !== key) {
      state.shellKey = key;
      state.sigs = {};
      if (club.status === 'lobby') buildLobbyShell();
      else buildGameShell();
    }
    if (club.status === 'lobby') updateLobby(club);
    else updateGame(club);
    updateChat(club);
  }

  const act = (path, body) => guard(async () => {
    const { club } = await api(`/api/clubs/${state.clubId}/${path}`, body);
    state.selected = null;
    setClub(club);
  });

  // ---- chat (lobby and game)

  function chatPanel() {
    const input = h('input', { id: 'chat-input', placeholder: 'Say something…', maxlength: '500', autocomplete: 'off' });
    const form = h('form', { id: 'chat-form' }, input, h('button', { type: 'submit', class: 'small' }, 'Send'));
    form.addEventListener('submit', guard(async (ev) => {
      ev.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const body = state.chatTab === 'whispers' ? { channel: 'whisper', to: state.whisperTo, text } : { channel: 'table', text };
      if (state.chatTab === 'whispers' && !state.whisperTo) throw new Error('Choose who to whisper to.');
      const { club } = await api(`/api/clubs/${state.clubId}/messages`, body);
      input.value = '';
      setClub(club);
    }));
    return h('section', { class: 'card chat side-right' },
      h('div', { class: 'tabs', id: 'chat-tabs', role: 'tablist' }),
      h('div', { id: 'whisper-to' }),
      h('div', { class: 'messages', id: 'chat-messages' }),
      form);
  }

  function updateChat(club) {
    patch('chat-tabs', document.getElementById('chat-tabs'), { tab: state.chatTab }, () =>
      [['table', 'The Table'], ['whispers', 'Whispers']].map(([k, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(k === state.chatTab), class: k === state.chatTab ? 'selected' : '',
        onclick: () => { state.chatTab = k; state.sigs = { ...state.sigs, 'chat-tabs': null, 'chat-messages': null, 'whisper-to': null }; updateChat(state.club); },
      }, label)));

    const others = club.players.filter((p) => p.userId !== club.me.userId && !p.isBot && (club.status !== 'active' || p.alive));
    if (state.whisperTo && !others.some((p) => p.userId === state.whisperTo)) state.whisperTo = null;
    if (!state.whisperTo && others.length) state.whisperTo = others[0].userId;
    patch('whisper-to', document.getElementById('whisper-to'), { tab: state.chatTab, others: others.map((p) => p.userId), to: state.whisperTo }, () => {
      if (state.chatTab !== 'whispers') return null;
      if (!others.length) return h('p', { class: 'muted small whisper-pick' }, 'There is nobody to whisper to.');
      const sel = h('select', { 'aria-label': 'Whisper to', onchange: () => { state.whisperTo = sel.value; } },
        others.map((p) => h('option', { value: p.userId, selected: p.userId === state.whisperTo }, p.name)));
      return h('div', { class: 'whisper-pick' }, h('span', { class: 'small muted' }, 'Whisper to'), sel);
    });

    const box = document.getElementById('chat-messages');
    const atBottom = box && box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const msgs = state.chatTab === 'table' ? club.messages.table : club.messages.whispers;
    patch('chat-messages', box, { tab: state.chatTab, msgs }, () => {
      if (!msgs.length) {
        return h('div', { class: 'chat-empty' }, state.chatTab === 'table'
          ? 'Everyone at the table can read this.'
          : 'Whispers are private between two heirs. Make a deal. Break it later.');
      }
      return msgs.map((m) => {
        const mine = m.from === club.me.userId;
        const who = state.chatTab === 'whispers' ? `${m.fromName} → ${m.toName}` : m.fromName;
        return h('div', { class: `msg ${mine ? 'mine' : ''}` }, h('div', { class: 'who' }, `${who} · ${fmtTime(m.at)}`), h('div', { class: 'text' }, m.text));
      });
    });
    if (box && atBottom) box.scrollTop = box.scrollHeight;

    const input = document.getElementById('chat-input');
    if (input) {
      input.disabled = !club.canChat;
      input.placeholder = club.canChat ? (state.chatTab === 'table' ? 'Speak to the table…' : 'Whisper…') : 'The dead keep their own counsel.';
    }
  }

  // ---- lobby

  function buildLobbyShell() {
    app.replaceChildren(
      h('div', { class: 'club-head' }, h('div', {}, h('span', { class: 'badge gold' }, 'The Lobby'), h('h1', { id: 'club-name' }))),
      h('div', { class: 'grid' },
        h('div', { class: 'stack' }, h('section', { class: 'card', id: 'lobby-invite' }), h('section', { class: 'card', id: 'lobby-host' })),
        h('section', { class: 'card', id: 'lobby-players' }),
        chatPanel()));
  }

  function updateLobby(club) {
    document.getElementById('club-name').textContent = club.name;
    const priv = club.visibility === 'private';
    const n = club.players.length;
    patch('lobby-invite', document.getElementById('lobby-invite'), { code: club.code, priv, invites: club.invites, host: club.isHost, n }, () => {
      const parts = [h('h2', {}, 'Invite heirs'), h('span', { class: `badge ${priv ? 'blood' : 'ok'}` }, priv ? 'Private table' : 'Public table')];
      if (!club.code) {
        parts.push(h('p', { class: 'muted small', style: 'margin-top:10px' }, 'This table is invitation only. Only the host can invite people.'));
        return parts;
      }
      const link = `${location.origin}/#/join/${club.code}`;
      parts.push(
        h('p', { class: 'muted small', style: 'margin-top:10px' }, priv ? 'Send this code or link privately. Only you can see it.' : 'Anyone can find this table under Open tables, or join with this code.'),
        h('div', { class: 'code' }, club.code),
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'small', onclick: guard(async () => { await navigator.clipboard.writeText(link); toast('Invitation link copied.'); }) }, 'Copy link')));
      if (club.isHost) {
        const input = h('input', { name: 'invitee', placeholder: 'Player name', maxlength: '24', autocomplete: 'off', 'aria-label': 'Player name to invite' });
        const form = h('form', { class: 'row', style: 'margin-top:14px' }, h('div', { class: 'grow' }, input), h('button', { class: 'small', type: 'submit' }, 'Invite'));
        form.addEventListener('submit', guard(async (ev) => {
          ev.preventDefault();
          const { club: next } = await api(`/api/clubs/${state.clubId}/invite`, { name: input.value });
          toast(`Invitation sent to ${input.value.trim()}.`);
          setClub(next);
        }));
        parts.push(h('h3', { style: 'margin-top:16px' }, 'Invite a player by name'), h('p', { class: 'muted small' }, 'They will find it on their My tables page.'), form);
        if (club.invites.length) {
          parts.push(h('ul', { class: 'players', style: 'margin-top:10px' }, club.invites.map((i) => h('li', { class: 'player' },
            avatar(i.name), h('span', { class: 'pwho' }, h('span', { class: 'pname' }, i.name), h('span', { class: 'fate' }, 'invited')),
            h('button', { class: 'small ghost', onclick: act('uninvite', { userId: i.userId }) }, 'Withdraw')))));
        }
      }
      return parts;
    });

    patch('lobby-host', document.getElementById('lobby-host'), { isHost: club.isHost, n, mode: club.mode }, () => {
      const parts = [h('h2', {}, 'The game'),
        h('p', { class: 'small' }, club.mode === 'timed' ? 'Timed: up to a day for each move. The game moves on as soon as everyone has acted.' : 'Live: 45 seconds a turn, 30 seconds for the Night and the Inquest. About 30–40 minutes.'),
        h('p', { class: 'small muted' }, `8 rounds. Four seats; ${n} taken. Nobody can join once the cards are dealt.`)];
      if (club.isHost) {
        parts.push(h('div', { class: 'row' },
          h('button', { class: 'primary', disabled: n !== club.seats, onclick: act('start', {}) }, 'Deal the cards'),
          h('button', { class: 'small', disabled: n >= club.seats, onclick: act('bots', { count: club.seats - n }) }, 'Fill seats with bots')));
      } else {
        parts.push(h('p', { class: 'muted small' }, 'Waiting for the host to deal.'),
          h('button', { class: 'small ghost', onclick: guard(async () => { await api(`/api/clubs/${state.clubId}/leave`, {}); location.hash = '#/'; }) }, 'Leave table'));
      }
      return parts;
    });

    patch('lobby-players', document.getElementById('lobby-players'), club.players, (players) => [
      h('h2', {}, `Heirs (${players.length}/${club.seats})`),
      h('ul', { class: 'players' },
        players.map((p) => h('li', { class: 'player' }, avatar(p.name), h('span', { class: 'pwho' }, h('span', { class: 'pname' }, p.name)),
          p.isHost ? h('span', { class: 'tag' }, 'host') : null, p.isBot ? h('span', { class: 'tag' }, 'bot') : null)),
        Array.from({ length: club.seats - players.length }, () => h('li', { class: 'player empty-seat' }, h('span', { class: 'avatar' }, '?'), h('span', { class: 'pwho muted' }, 'Empty seat')))),
    ]);
  }

  // ---- the game

  function buildGameShell() {
    app.replaceChildren(
      h('div', { class: 'club-head' },
        h('div', {}, h('h1', { id: 'club-name' }), h('div', { class: 'phase-line', id: 'phase-line' })),
        h('div', { class: 'vault' }, h('div', { class: 'muted small' }, 'Your Fortune'), h('div', { class: 'amount', id: 'my-fortune' }))),
      h('div', { id: 'banner' }),
      h('div', { class: 'grid' },
        h('section', { class: 'card', id: 'heirs' }),
        h('div', { class: 'stack' }, h('section', { class: 'card', id: 'action' }), h('section', { class: 'card', id: 'hand' }), h('section', { class: 'card', id: 'feed' })),
        chatPanel()));
  }

  const nameOf = (club, id) => (club.players.find((p) => p.userId === id) || {}).name || '?';

  function updateGame(club) {
    document.getElementById('club-name').textContent = club.name;
    document.getElementById('my-fortune').textContent = club.me.alive ? `${club.me.fortune}` : '—';

    patch('phase-line', document.getElementById('phase-line'), { s: club.status, ph: club.phase, r: club.round, turn: club.turn, mode: club.mode }, () => {
      if (club.status === 'ended') return [h('span', { class: 'badge' }, 'The will has been read')];
      const mine = club.turn === club.me.userId;
      return [
        h('span', { class: 'badge gold' }, `Round ${club.round} of ${club.rounds}`),
        h('span', { class: `badge ${club.phase === 'night' ? 'blood' : ''}` }, club.phaseName),
        club.phase === 'day' ? h('span', { class: `badge ${mine ? 'blood' : ''}` }, mine ? 'Your turn' : `${nameOf(club, club.turn)}’s turn`) : null,
        h('span', { class: 'countdown', id: 'countdown' }),
        h('span', { class: 'badge' }, club.mode === 'timed' ? 'Timed' : 'Live'),
      ];
    });
    tickCountdown();

    patch('banner', document.getElementById('banner'), { s: club.status, w: club.winner, alive: club.me.alive, st: club.standings }, () => {
      if (club.status === 'ended') {
        const iWon = club.winner === club.me.userId;
        const winner = club.winner ? nameOf(club, club.winner) : null;
        return h('div', { class: `banner ${iWon ? '' : 'blood'}` },
          h('h2', {}, winner ? (iWon ? 'You inherit everything.' : `${winner} inherits everything.`) : 'The cat inherits everything.'),
          h('p', { class: 'small muted' }, club.winHow === 'last' ? 'The last heir standing.' : club.winHow === 'none' ? 'Nobody survived the night.' : 'The will has been read.'));
      }
      if (!club.me.alive) return h('div', { class: 'banner blood' }, h('h2', {}, 'You were murdered.'), h('p', { class: 'small' }, 'You are out of the game, but you can watch to the end.'));
      return null;
    });

    patch('heirs', document.getElementById('heirs'), { players: club.players, me: club.me.userId, turn: club.turn, phase: club.phase, offers: club.pactOffers, myPact: club.me.pactWith, s: club.status, alive: club.me.alive }, () => renderHeirs(club));
    patch('action', document.getElementById('action'), { ph: club.phase, s: club.status, turn: club.turn, me: club.me, left: club.playsLeft, sel: state.selected, players: club.players.map((p) => [p.userId, p.alive, p.playedTonight, p.votedToday]), st: club.standings, nh: club.nightHistory }, () => renderAction(club));
    patch('hand', document.getElementById('hand'), { hand: club.me.hand, estate: club.me.estate, ph: club.phase, turn: club.turn, left: club.playsLeft, sel: state.selected, played: club.me.nightPlayed, must: club.me.mustPlayNight, alive: club.me.alive }, () => renderHand(club));
    patch('feed', document.getElementById('feed'), club.events, (events) => [
      h('h2', {}, 'The Proprietor'),
      h('ul', { class: 'feed' }, events.slice().reverse().map((ev) => h('li', { class: `event ${ev.type} ${ev.private ? 'private' : ''}` },
        h('div', { class: 'meta' }, `${ev.private ? 'Only you · ' : ''}Round ${ev.round || 1} · ${fmtTime(ev.at)}`),
        h('div', {}, ev.text),
        ev.ballots && ev.ballots.length ? h('details', {}, h('summary', {}, 'How everyone voted'), h('ul', {}, ev.ballots.map((b) => h('li', {}, `${b.voter} → ${b.target || 'abstained'}`)))) : null))),
    ]);
  }

  function pips(n, max, cls) {
    return h('span', { class: `pips ${cls}`, 'aria-label': `${n} of ${max}` }, Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
  }

  function renderHeirs(club) {
    const active = club.status === 'active';
    const iCanPact = active && club.me.alive;
    const offerFrom = (id) => club.pactOffers.some((o) => o.from === id && o.to === club.me.userId);
    const offeredTo = (id) => club.pactOffers.some((o) => o.from === club.me.userId && o.to === id);
    return [
      h('h2', {}, 'The heirs'),
      h('ul', { class: 'heirs' }, club.players.map((p) => {
        const isMe = p.userId === club.me.userId;
        const status = [];
        if (!p.alive) status.push(h('span', { class: 'tag blood' }, `murdered · night ${p.diedRound}`));
        if (p.arrested) status.push(h('span', { class: 'tag' }, '\u{1F512} in a cell'));
        if (p.poisoned) status.push(h('span', { class: 'tag blood' }, '☠ poisoned'));
        if (active && club.phase === 'night' && p.alive) status.push(h('span', { class: 'tag' }, p.playedTonight ? 'played ✓' : 'thinking…'));
        if (active && club.phase === 'inquest' && p.alive) status.push(h('span', { class: 'tag' }, p.votedToday ? 'voted ✓' : 'deciding…'));
        if (p.pactWith) status.push(h('span', { class: 'tag gold' }, `\u{1F91D} ${nameOf(club, p.pactWith)}`));

        const pactButtons = [];
        if (iCanPact && !isMe && p.alive) {
          if (club.me.pactWith === p.userId) pactButtons.push(h('button', { class: 'small ghost', onclick: act('pact', { op: 'break' }) }, 'Break Pact'));
          else if (offerFrom(p.userId)) {
            pactButtons.push(h('button', { class: 'small primary', onclick: act('pact', { op: 'accept', targetId: p.userId }) }, 'Accept Pact'),
              h('button', { class: 'small ghost', onclick: act('pact', { op: 'decline', targetId: p.userId }) }, 'Refuse'));
          } else if (!club.me.pactWith && !p.pactWith && !offeredTo(p.userId)) {
            pactButtons.push(h('button', { class: 'small ghost', onclick: act('pact', { op: 'propose', targetId: p.userId }) }, 'Offer Pact'));
          } else if (offeredTo(p.userId)) pactButtons.push(h('span', { class: 'tag' }, 'Pact offered'));
        }

        return h('li', { class: `heir ${p.alive ? '' : 'dead'} ${club.turn === p.userId ? 'turn' : ''} ${isMe ? 'me' : ''}` },
          h('div', { class: 'heir-top' }, avatar(p.name),
            h('span', { class: 'pwho' }, h('span', { class: 'pname' }, p.name, isMe ? ' (you)' : '', p.isBot ? h('span', { class: 'tag' }, ' bot') : null))),
          p.alive || club.status === 'ended' ? h('div', { class: 'heir-stats' },
            h('span', { title: 'Blood' }, pips(p.blood > 0 ? p.blood : 0, 4, 'blood')),
            p.bodyguards ? h('span', { class: 'stat', title: 'Bodyguards' }, `\u{1F6E1}${p.bodyguards}`) : null,
            h('span', { class: 'stat', title: 'Cards in hand' }, `\u{1F0A0} ${p.handCount}`),
            h('span', { class: 'stat', title: 'Bequests in their Estate (value hidden)' }, `\u{1F4B0} ${p.estateCount}${p.estateValue !== null ? ` = ${p.estateValue}` : ''}`),
            h('span', { class: 'stat', title: 'Fortune in hand (coins)' }, `¤ ${p.coins}`),
            h('span', { class: 'stat', title: 'Infamy' }, `★ ${p.infamy}`),
            h('span', { class: 'stat', title: 'Suspicion' }, `\u{1F441} ${p.suspicion}`)) : null,
          status.length ? h('div', { class: 'heir-status' }, status) : null,
          pactButtons.length ? h('div', { class: 'row heir-pact' }, pactButtons) : null);
      })),
      h('p', { class: 'muted small legend' }, '\u{1F0A0} cards · \u{1F4B0} bequests · ¤ coins · ★ Infamy · \u{1F441} Suspicion'),
    ];
  }

  function targetButtons(club, onPick) {
    return h('div', { class: 'choices' }, club.players.filter((p) => p.alive && p.userId !== club.me.userId).map((p) =>
      h('button', { onclick: onPick(p.userId) }, avatar(p.name), p.name)));
  }

  function renderAction(club) {
    const me = club.me;
    if (club.status === 'ended') return renderReading(club);
    if (!me.alive) return [h('h2', {}, club.phaseName), h('p', { class: 'muted' }, 'You are watching from beyond.')];
    const sel = state.selected && me.hand.find((c) => c.id === state.selected.cardId);

    if (club.phase === 'day') {
      if (club.turn !== me.userId) return [h('h2', {}, 'Day'), h('p', { class: 'muted' }, `${nameOf(club, club.turn)} is taking their turn. Plot, whisper, or offer a Pact while you wait.`)];
      if (sel) {
        return [h('h2', {}, `${sel.icon} ${sel.name}`), h('p', { class: 'muted small' }, `${sel.text} Choose an heir.`),
          targetButtons(club, (id) => act('play', { cardId: sel.id, targetId: id })),
          h('button', { class: 'small ghost', onclick: () => { state.selected = null; updateGame(state.club); } }, 'Cancel')];
      }
      return [h('h2', {}, 'Your turn'),
        h('p', { class: 'muted small' }, club.playsLeft
          ? `You drew 2 cards. Play up to ${plural(club.playsLeft, 'more card')} from your hand — Day cards only — then end your turn.`
          : 'You have played your cards. End your turn.'),
        h('button', { class: 'primary', onclick: act('endturn', {}) }, 'End turn')];
    }

    if (club.phase === 'night') {
      const waiting = club.players.filter((p) => p.alive && p.playedTonight === false).length;
      if (me.arrested) return [h('h2', {}, 'Night'), h('p', { class: 'muted' }, 'You spend the night in a locked cell. Listen at the door.')];
      if (me.nightPlayed) {
        const c = me.nightPlayed.card;
        return [h('h2', {}, 'Night'), h('p', {}, `You played ${c.icon} ${c.name}${me.nightPlayed.target ? ` at ${nameOf(club, me.nightPlayed.target)}` : c.kind === 'defense' ? ' to protect yourself' : ' as a bluff'}.`),
          h('p', { class: 'muted small' }, waiting ? `Waiting for ${plural(waiting, 'heir')}…` : 'Dawn is coming…')];
      }
      if (!me.mustPlayNight) return [h('h2', {}, 'Night'), h('p', { class: 'muted' }, 'You have no cards to play tonight.')];
      if (sel) {
        return [h('h2', {}, `${sel.icon} ${sel.name}`), h('p', { class: 'muted small' }, 'Who is it for? Nobody will know it was you.'),
          targetButtons(club, (id) => act('night', { cardId: sel.id, targetId: id })),
          h('button', { class: 'small ghost', onclick: () => { state.selected = null; updateGame(state.club); } }, 'Cancel')];
      }
      return [h('h2', {}, 'Night'), h('p', { class: 'muted small' }, 'Play one card face down into the Shadows. A weapon strikes the heir you choose; an Alibi, Locked Door or Secret Passage protects you; anything else is a bluff, and is lost.')];
    }

    if (club.phase === 'inquest') {
      const voted = me.vote !== undefined;
      const alive = club.players.filter((p) => p.alive).length;
      return [h('h2', {}, 'The Inquest'),
        h('p', { class: 'muted small' }, `Accuse an heir. ${Math.floor(alive / 2) + 1} votes arrest them: a fine of 3, their hand thrown out, and a night in the cells. Suspicion \u{1F441} shows who has been careless.`),
        h('div', { class: 'choices' },
          club.players.filter((p) => p.alive && p.userId !== me.userId).map((p) => h('button', { class: me.vote === p.userId ? 'selected' : '', onclick: act('vote', { targetId: p.userId }) }, avatar(p.name), `${p.name} \u{1F441}${p.suspicion}`)),
          h('button', { class: me.vote === null ? 'selected' : '', onclick: act('vote', { targetId: null }) }, 'Abstain')),
        voted ? h('p', { class: 'small muted' }, 'You can change your vote until everyone has voted.') : null];
    }
    return null;
  }

  function renderReading(club) {
    const rows = (club.standings || []).map((s) => h('tr', { class: s.userId === club.winner ? 'winner' : '' },
      h('td', {}, String(s.place)), h('td', {}, s.name),
      h('td', {}, s.alive ? String(s.fortune) : '—'),
      h('td', {}, String(s.infamy)),
      h('td', { class: 'small' }, s.alive ? 'survived' : `murdered night ${s.diedRound}${s.killedBy ? ` by ${s.killedBy}` : ''}${s.killedWith ? ` (${s.killedWith})` : ''}`)));
    return [
      h('h2', {}, 'The Reading of the Will'),
      h('table', { class: 'standings' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Heir'), h('th', {}, 'Fortune'), h('th', {}, 'Infamy'), h('th', {}, 'Fate'))), h('tbody', {}, rows)),
      h('h3', { style: 'margin-top:18px' }, 'What happened in the Shadows'),
      h('div', { class: 'replay' }, club.nightHistory.map((n) => h('details', {}, h('summary', {}, `Night ${n.round}`),
        h('ul', {}, n.plays.map((p) => h('li', {}, `${p.name}: ${p.card}${p.target ? ` → ${p.target}` : ''}${p.timedOut ? ' (ran out of time)' : ''}`)))))),
    ];
  }

  function cardEl(c, { playable, selected, onClick, small } = {}) {
    return h('button', {
      type: 'button',
      class: `pcard kind-${c.kind} ${playable ? 'playable' : 'idle'} ${selected ? 'selected' : ''} ${small ? 'small' : ''}`,
      disabled: !onClick,
      onclick: onClick,
      title: c.text,
    },
    h('span', { class: 'pc-icon', 'aria-hidden': 'true' }, c.icon),
    h('span', { class: 'pc-name' }, c.name),
    small ? null : h('span', { class: 'pc-text' }, c.text),
    small ? null : h('span', { class: 'pc-phase' }, c.phase === 'night' ? 'Night' : 'Day'));
  }

  function renderHand(club) {
    const me = club.me;
    if (!me.alive) return null;
    const myDay = club.status === 'active' && club.phase === 'day' && club.turn === me.userId && club.playsLeft > 0;
    const myNight = club.status === 'active' && club.phase === 'night' && me.mustPlayNight && !me.nightPlayed;
    const pick = (c) => {
      if (myDay && c.phase === 'day') {
        if (c.target) return () => { state.selected = { cardId: c.id }; updateGame(state.club); };
        return act('play', { cardId: c.id });
      }
      if (myNight) {
        if (c.kind === 'weapon') return () => { state.selected = { cardId: c.id }; updateGame(state.club); };
        return () => {
          const what = c.kind === 'defense' && c.phase === 'night' ? `play ${c.name} to protect yourself` : `throw away ${c.name} as a bluff`;
          if (confirm(`Tonight, ${what}?`)) act('night', { cardId: c.id })();
        };
      }
      return null;
    };
    return [
      h('h2', {}, `Your hand (${me.hand.length})`),
      me.hand.length
        ? h('div', { class: 'hand' }, me.hand.map((c) => {
          const onClick = pick(c);
          return cardEl(c, { playable: Boolean(onClick), selected: state.selected && state.selected.cardId === c.id, onClick });
        }))
        : h('p', { class: 'muted small' }, 'Your hand is empty.'),
      h('h3', { style: 'margin-top:16px' }, `Your Estate · ${me.estateValue} in bequests + ${me.coins} in coins`),
      me.estate.length
        ? h('div', { class: 'hand estate' }, me.estate.map((c) => cardEl(c, { small: true })))
        : h('p', { class: 'muted small' }, 'No bequests yet. Play them in the Day; others can see how many you have, but not what they are worth.'),
      h('p', { class: 'muted small', style: 'margin-top:12px' },
        h('span', { class: 'mystat' }, pips(Math.max(0, me.blood), 4, 'blood'), ' Blood'),
        me.bodyguards ? ` · \u{1F6E1} ${me.bodyguards} Bodyguard${me.bodyguards > 1 ? 's' : ''}` : '',
        ` · ★ ${me.infamy} Infamy · \u{1F441} ${me.suspicion} Suspicion`,
        me.poisoned ? ' · ☠ Poisoned: play an Antidote in the Day' : ''),
    ];
  }

  let lastZero = 0;
  function tickCountdown() {
    const el = document.getElementById('countdown');
    const c = state.club;
    if (!el || !c || !c.phaseEndsAt) return;
    const left = c.phaseEndsAt - (Date.now() + state.serverOffset);
    el.textContent = fmtDuration(left);
    el.classList.toggle('urgent', c.mode === 'live' && left < 10000);
    if (left <= 0 && Date.now() - lastZero > 2000) {
      lastZero = Date.now();
      refresh().catch(() => {});
    }
  }
  setInterval(tickCountdown, 1000);

  // ------------------------------------------------------------ boot

  window.addEventListener('hashchange', () => route().catch((e) => toast(e.message)));
  api('/api/me').then(({ user }) => { state.user = user; return route(); }).catch((e) => toast(e.message));
})();
