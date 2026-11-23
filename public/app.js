'use strict';

/* MurdrClub front end: one page, routed by the URL hash, polling the API. */

(() => {
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const toastEl = document.getElementById('toast');

  const state = {
    user: null,
    club: null,
    clubId: null,
    shellKey: null,
    chatTab: 'lounge',
    cardHidden: false,
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
    const d = Math.floor(s / 86400);
    const hh = Math.floor((s % 86400) / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (d) return `${d}d ${hh}h ${pad(mm)}m`;
    if (hh) return `${hh}:${pad(mm)}:${pad(ss)}`;
    return `${mm}:${pad(ss)}`;
  }

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const money = (n) => Number(n || 0).toLocaleString('en-US');

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
    const hash = location.hash.replace(/^#/, '') || '/';
    const parts = hash.split('/').filter(Boolean);
    renderNav();

    if (parts[0] === 'join' && parts[1]) {
      if (!state.user) {
        sessionStorage.setItem('mc_join', parts[1]);
        return renderLanding(`Sign up or sign in to join club ${parts[1].toUpperCase()}.`);
      }
      try {
        const { club } = await api('/api/clubs/join', { code: parts[1] });
        location.replace(`#/club/${club.id}`);
      } catch (e) {
        toast(e.message);
        location.replace('#/');
      }
      return undefined;
    }

    if (!state.user) return renderLanding();
    if (parts[0] === 'club' && parts[1]) return openClub(parts[1]);
    return renderHome();
  }

  function renderNav() {
    nav.replaceChildren();
    if (!state.user) return;
    nav.append(
      h('span', { class: 'muted small' }, state.user.name),
      h('a', { class: 'btn small ghost', href: '#/' }, 'My clubs'),
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
          h('button', { type: 'button', class: mode === 'signup' ? 'selected' : '', onclick: () => { mode = 'signup'; draw(); } }, 'Become a member'),
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
      if (pending) location.hash = `#/join/${pending}`;
      else location.hash = '#/';
      route();
    }));
    draw();

    app.replaceChildren(h('section', { class: 'hero' },
      h('div', {},
        h('h1', {}, 'Every night, someone is murdered.'),
        h('p', { class: 'tagline' }, 'MurdrClub is an online murder mystery for 8 to 25 friends. A few of you are secretly Murderers. Each night they choose a victim; each day the Club votes on who to blackball. A season lasts half a day per player \u2014 13 days for a full club of 25 \u2014 played a few minutes at a time.'),
        h('div', { class: 'steps' },
          h('div', { class: 'step' }, h('b', {}, 'Errands'), h('span', { class: 'muted small' }, 'Daytime puzzles fill the Vault. Talk it over in the Lounge.')),
          h('div', { class: 'step' }, h('b', {}, 'The Tribunal'), h('span', { class: 'muted small' }, 'Vote at 18:00. A majority blackballs someone, and their card is turned over \u2014 until only 5 remain.')),
          h('div', { class: 'step' }, h('b', {}, 'The Back Room'), h('span', { class: 'muted small' }, 'At night the Murderers meet in secret and pick their next victim.')))),
      form));
  }

  // ------------------------------------------------------------ home

  async function renderHome() {
    const [{ clubs, invitations }, { clubs: open }] = await Promise.all([api('/api/clubs'), api('/api/clubs/open')]);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const fastFields = h('div', { class: 'row', hidden: true },
      ...[['day', 'Errands', 3], ['tribunal', 'Tribunal', 2], ['backroom', 'Back Room', 1]].map(([k, label, d]) =>
        h('div', { class: 'field grow' }, h('label', { for: `fm-${k}` }, `${label} (minutes)`),
          h('input', { id: `fm-${k}`, name: `fm-${k}`, type: 'number', min: '1', max: '120', value: String(d) }))));

    const pace = h('select', { id: 'f-pace', name: 'pace', onchange: () => { fastFields.hidden = pace.value !== 'fast'; } },
      h('option', { value: 'daily' }, 'Daily — a real season, one day per day'),
      h('option', { value: 'fast' }, 'Fast — play a whole game in an hour (for testing)'));

    const create = h('form', { class: 'card' },
      h('h2', {}, 'Found a club'),
      h('div', { class: 'field' }, h('label', { for: 'f-club' }, 'Club name'),
        h('input', { id: 'f-club', name: 'name', maxlength: '40', placeholder: `${state.user.name}'s Club` })),
      h('div', { class: 'field' }, h('label', { for: 'f-vis' }, 'Who can join'),
        h('select', { id: 'f-vis', name: 'visibility' },
          h('option', { value: 'private' }, 'Private \u2014 invitation only'),
          h('option', { value: 'public' }, 'Public \u2014 listed in Open clubs'))),
      h('div', { class: 'field' }, h('label', { for: 'f-pace' }, 'Pace'), pace),
      fastFields,
      h('p', { class: 'muted small' }, '8 to 25 members. The season lasts half a day per member, so 8 members play 4 days and 25 play 13. Nobody can join once it starts.'),
      h('p', { class: 'muted small' }, `Club Time: ${tz}. Daily clubs run Errands until 18:00, the Tribunal until 21:00, and the Back Room until 08:00.`),
      h('button', { class: 'primary', type: 'submit' }, 'Create club'));
    create.addEventListener('submit', guard(async (ev) => {
      ev.preventDefault();
      const fd = new FormData(create);
      const { club } = await api('/api/clubs', {
        name: fd.get('name'), pace: fd.get('pace'), visibility: fd.get('visibility'), timeZone: tz,
        fastMinutes: { day: fd.get('fm-day'), tribunal: fd.get('fm-tribunal'), backroom: fd.get('fm-backroom') },
      });
      location.hash = `#/club/${club.id}`;
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
      location.hash = `#/club/${club.id}`;
    }));

    const statusBadge = (c) => {
      if (c.status === 'lobby') return h('span', { class: 'badge gold' }, 'Lobby');
      if (c.status === 'ended') return h('span', { class: 'badge' }, c.winner === 'members' ? 'Members won' : 'Murderers won');
      return h('span', { class: `badge ${c.myAlive ? 'ok' : ''}` }, c.myAlive ? `Day ${c.day}` : `Day ${c.day} · departed`);
    };

    app.replaceChildren(h('div', { class: 'home' },
      h('div', { class: 'stack', id: 'home-left' }, h('section', { class: 'card' },
        h('h2', {}, 'Your clubs'),
        clubs.length
          ? h('ul', { class: 'club-list' }, clubs.map((c) => h('li', {}, h('a', { class: 'club-item', href: `#/club/${c.id}` },
            h('div', {}, h('b', {}, c.name), h('div', { class: 'muted small' },
              `${c.alive}/${c.players} members${c.isHost ? ' · you host' : ''}${c.pace === 'fast' ? ' · fast' : ''}`)),
            statusBadge(c)))))
          : h('p', { class: 'muted' }, 'You have not joined a club yet. Found one and invite your friends, accept an invitation, or join an open club.'))),
      h('div', { class: 'stack' }, create, join)));

    const clubCard = (c, buttons) => h('li', { class: 'club-item' },
      h('div', {}, h('b', {}, c.name), h('div', { class: 'muted small' },
        `Hosted by ${c.host} \u00b7 ${c.players}/25 members \u00b7 ${c.seasonDays}-day season${c.pace === 'fast' ? ' \u00b7 fast' : ''}`)),
      h('div', { class: 'row' }, buttons));
    const joinById = (id) => guard(async () => {
      const { club } = await api('/api/clubs/join', { id });
      location.hash = `#/club/${club.id}`;
    });

    const extra = [];
    if (invitations.length) {
      extra.push(h('section', { class: 'card invitations' },
        h('h2', {}, 'You are invited'),
        h('ul', { class: 'club-list' }, invitations.map((c) => clubCard(c, [
          h('button', { class: 'primary small', onclick: joinById(c.id) }, 'Accept'),
          h('button', { class: 'small ghost', onclick: guard(async () => { await api(`/api/invitations/${c.id}/decline`, {}); renderHome(); }) }, 'Decline'),
        ])))));
    }
    extra.push(h('section', { class: 'card' },
      h('h2', {}, 'Open clubs'),
      open.length
        ? h('ul', { class: 'club-list' }, open.map((c) => clubCard(c, [h('button', { class: 'small', onclick: joinById(c.id) }, 'Join')])))
        : h('p', { class: 'muted small' }, 'No public clubs are taking members right now. Found one yourself.')));
    const left = document.getElementById('home-left');
    if (invitations.length) left.prepend(extra.shift());
    left.append(...extra);
  }

  // ------------------------------------------------------------ club

  async function openClub(id) {
    state.clubId = id;
    await refreshClub();
    state.poll = setInterval(() => refreshClub().catch(() => {}), 3000);
  }

  async function refreshClub() {
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
    state.club = club;
    state.serverOffset = club.now - Date.now();
    const key = `${club.id}:${club.status}`;
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
    setClub(club);
  });

  // ---- chat (shared by lobby and game)

  function chatPanel() {
    const input = h('input', { id: 'chat-input', placeholder: 'Say something…', maxlength: '500', autocomplete: 'off' });
    const form = h('form', { id: 'chat-form' }, input, h('button', { type: 'submit', class: 'small' }, 'Send'));
    form.addEventListener('submit', guard(async (ev) => {
      ev.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const { club } = await api(`/api/clubs/${state.clubId}/messages`, { channel: state.chatTab, text });
      input.value = '';
      setClub(club);
    }));
    return h('section', { class: 'card chat side-right' },
      h('div', { class: 'tabs', id: 'chat-tabs', role: 'tablist' }),
      h('div', { class: 'messages', id: 'chat-messages' }),
      form);
  }

  const CHANNELS = { lounge: 'The Lounge', backroom: 'Back Room', cellar: 'The Cellar' };

  function updateChat(club) {
    const readable = Object.keys(CHANNELS).filter((ch) => club.messages[ch]);
    if (!readable.includes(state.chatTab)) state.chatTab = 'lounge';

    patch('chat-tabs', document.getElementById('chat-tabs'), { readable, tab: state.chatTab }, ({ readable: list, tab }) =>
      list.map((ch) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(ch === tab), class: ch === tab ? 'selected' : '',
        onclick: () => { state.chatTab = ch; updateChat(state.club); } }, CHANNELS[ch])));

    const box = document.getElementById('chat-messages');
    const atBottom = box && box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const msgs = club.messages[state.chatTab] || [];
    patch('chat-messages', box, { tab: state.chatTab, msgs }, () => {
      if (!msgs.length) {
        const empty = { lounge: 'The Lounge is quiet. Break the ice.', backroom: 'Only Murderers can read this room. Plan carefully.', cellar: 'The departed gather here. The living cannot hear you.' };
        return h('div', { class: 'chat-empty' }, empty[state.chatTab]);
      }
      return msgs.map((m) => h('div', { class: `msg ${m.mine ? 'mine' : ''}` },
        h('div', { class: 'who' }, `${m.name} · ${fmtTime(m.at)}`), h('div', { class: 'text' }, m.text)));
    });
    if (box && atBottom) box.scrollTop = box.scrollHeight;

    const input = document.getElementById('chat-input');
    if (input) {
      const can = club.canWrite[state.chatTab];
      input.disabled = !can;
      input.placeholder = can ? `Speak in ${CHANNELS[state.chatTab]}…` : 'You can read this room but not speak here.';
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
      const parts = [h('h2', {}, 'Invite members'), h('span', { class: `badge ${priv ? 'blood' : 'ok'}` }, priv ? 'Private club' : 'Public club')];
      if (!club.code) {
        parts.push(h('p', { class: 'muted small', style: 'margin-top:10px' }, 'This club is invitation only. Only the host can invite people.'));
        return parts;
      }
      const link = `${location.origin}/#/join/${club.code}`;
      parts.push(
        h('p', { class: 'muted small', style: 'margin-top:10px' }, priv
          ? 'Send this code or link privately to the people you want. Only you can see it.'
          : 'Anyone can find this club under Open clubs, or join with this code.'),
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
        parts.push(h('h3', { style: 'margin-top:16px' }, 'Invite a player by name'),
          h('p', { class: 'muted small' }, 'They will find the invitation on their My clubs page.'), form);
        if (club.invites.length) {
          parts.push(h('ul', { class: 'players', style: 'margin-top:10px' }, club.invites.map((i) => h('li', { class: 'player' },
            avatar(i.name), h('span', { class: 'pname' }, i.name), h('span', { class: 'tag' }, 'invited'),
            h('button', { class: 'small ghost', onclick: act('uninvite', { userId: i.userId }) }, 'Withdraw')))));
        }
      }
      return parts;
    });

    patch('lobby-host', document.getElementById('lobby-host'), { isHost: club.isHost, n, limits: club.limits, settings: club.settings, days: club.seasonDays }, () => {
      const s = club.settings;
      const paceText = s.pace === 'fast'
        ? `Fast club: Errands ${s.fastMinutes.day} min, Tribunal ${s.fastMinutes.tribunal} min, Back Room ${s.fastMinutes.backroom} min.`
        : `Daily club in ${s.timeZone}: Errands until 18:00, Tribunal until 21:00, Back Room until 08:00.`;
      const parts = [h('h2', {}, 'The season'),
        h('p', {}, h('b', {}, `${club.seasonDays} days`), ` \u2014 half a day for each of ${n} member${n === 1 ? '' : 's'}.`),
        h('p', { class: 'small muted' }, paceText),
        h('p', { class: 'small' }, `${club.limits.murderers} Murderer${club.limits.murderers === 1 ? '' : 's'} will be dealt. No one can join after the club opens.`)];
      if (club.isHost) {
        if (n < club.limits.min) parts.push(h('p', { class: 'small muted' }, `You need at least ${club.limits.min} members (up to ${club.limits.max}). You can fill seats with practice bots to try it out.`));
        parts.push(h('div', { class: 'row' },
          h('button', { class: 'primary', disabled: n < club.limits.min, onclick: act('start', {}) }, 'Open the club'),
          h('button', { class: 'small', disabled: n >= club.limits.max, onclick: act('bots', { count: 1 }) }, '+1 bot'),
          h('button', { class: 'small', disabled: n >= club.limits.max, onclick: act('bots', { count: 5 }) }, '+5 bots')));
      } else {
        parts.push(h('p', { class: 'muted small' }, 'Waiting for the host to open the club.'),
          h('button', { class: 'small ghost', onclick: guard(async () => { await api(`/api/clubs/${state.clubId}/leave`, {}); location.hash = '#/'; }) }, 'Leave club'));
      }
      return parts;
    });

    patch('lobby-players', document.getElementById('lobby-players'), club.players, (players) => [
      h('h2', {}, `Members (${players.length}/${club.limits.max})`),
      h('ul', { class: 'players' }, players.map((p) => h('li', { class: 'player' }, avatar(p.name), h('span', { class: 'pname' }, p.name),
        p.isHost ? h('span', { class: 'tag' }, 'host') : null, p.isBot ? h('span', { class: 'tag' }, 'bot') : null))),
    ]);
  }

  // ---- game

  function buildGameShell() {
    app.replaceChildren(
      h('div', { class: 'club-head' },
        h('div', {},
          h('h1', { id: 'club-name' }),
          h('div', { class: 'phase-line', id: 'phase-line' })),
        h('div', { class: 'vault' }, h('div', { class: 'muted small' }, 'The Vault (points)'), h('div', { class: 'amount', id: 'vault' }))),
      h('div', { id: 'banner' }),
      h('div', { class: 'grid' },
        h('div', { class: 'stack' }, h('div', { id: 'my-card' }), h('section', { class: 'card', id: 'players' })),
        h('div', { class: 'stack' }, h('section', { class: 'card', id: 'action' }), h('section', { class: 'card', id: 'feed' })),
        chatPanel()));
  }

  function updateGame(club) {
    document.getElementById('club-name').textContent = club.name;
    document.getElementById('vault').textContent = `${money(club.vault)} pts`;

    patch('phase-line', document.getElementById('phase-line'), { s: club.status, ph: club.phase, d: club.day, e: club.endgame, host: club.isHost }, () => {
      if (club.status === 'ended') return [h('span', { class: 'badge' }, `Season over · Day ${club.day} of ${club.seasonDays}`)];
      return [
        h('span', { class: 'badge gold' }, `Day ${club.day} of ${club.seasonDays}`),
        h('span', { class: `badge ${club.phase === 'backroom' ? 'blood' : ''}` }, club.phaseName),
        club.endgame ? h('span', { class: 'badge blood' }, 'The Last Toast') : null,
        h('span', { class: 'countdown', id: 'countdown' }),
        club.isHost ? h('button', { class: 'small ghost', title: 'Host control: end this phase now',
          onclick: () => { if (confirm('End this phase now for everyone?')) act('advance', {})(); } }, 'End phase now') : null,
      ];
    });
    tickCountdown();

    patch('banner', document.getElementById('banner'), { s: club.status, w: club.winner, me: club.me, payout: club.payout }, () => {
      if (club.status === 'ended') {
        const members = club.winner === 'members';
        return h('div', { class: `banner ${members ? '' : 'blood'}` },
          h('h2', {}, members ? 'The Members win' : 'The Murderers win'),
          h('p', {}, club.payout && club.payout.winners.length
            ? `${club.payout.winners.join(', ')} take the Vault — ${money(club.payout.share)} points each.` : ''),
          h('p', { class: 'small muted' }, 'Every card is face up and every room is open. Read the Back Room to see how it was done.'));
      }
      if (!club.me.alive) {
        const how = { murdered: 'You were murdered.', blackballed: 'You were blackballed.', resigned: 'You resigned your membership.' }[club.me.eliminatedHow];
        return h('div', { class: 'banner blood' }, h('h2', {}, how || 'You have departed.'), h('p', { class: 'small' }, 'You can still watch, and speak with the other departed in the Cellar.'));
      }
      return null;
    });

    patch('my-card', document.getElementById('my-card'), { role: club.me.role, hidden: state.cardHidden, alive: club.me.alive, strikes: club.me.strikes }, () => {
      const murderer = club.me.role === 'murderer';
      return h('div', { class: `member-card ${murderer ? 'murderer' : ''} ${state.cardHidden ? 'hidden-role' : ''}` },
        h('div', { class: 'muted small' }, 'Your membership card'),
        h('div', { class: 'role' }, murderer ? 'Murderer' : 'Member'),
        h('div', { class: 'small muted' }, murderer
          ? 'Kill a Member each night. Blend in each day. Survive to the end.'
          : 'Find the Murderers. Blackball them at the Tribunal.'),
        club.me.strikes ? h('div', { class: 'small', style: 'color:#ff6b80;margin-top:6px' }, `${club.me.strikes} missed Tribunal${club.me.strikes > 1 ? 's' : ''} — 3 and you are out.`) : null,
        h('button', { class: 'small ghost hide', onclick: () => { state.cardHidden = !state.cardHidden; updateGame(state.club); } }, state.cardHidden ? 'Show card' : 'Hide card'));
    });

    patch('players', document.getElementById('players'), club.players, (players) => {
      const alive = players.filter((p) => p.alive);
      const gone = players.filter((p) => !p.alive);
      const fate = (p) => {
        const how = { murdered: `murdered \u00b7 night ${p.eliminatedDay}`, blackballed: `blackballed \u00b7 day ${p.eliminatedDay}`, resigned: `resigned \u00b7 day ${p.eliminatedDay}` }[p.eliminatedHow];
        return h('span', { class: 'fate', title: p.role ? null : 'Eliminated in the Last Toast: their card stays face down until the season ends' },
          how, p.role ? '' : ' \u00b7 card face down');
      };
      const row = (p) => h('li', { class: `player ${p.alive ? '' : 'dead'}` }, avatar(p.name),
        h('span', { class: 'pwho' },
          h('span', { class: 'pname' }, p.name, p.userId === club.me.userId ? ' (you)' : ''),
          !p.alive ? fate(p) : null),
        p.role === 'murderer' ? h('span', { class: 'tag murderer' }, 'Murderer') : null,
        p.role === 'member' && (club.status === 'ended' || !p.alive) ? h('span', { class: 'tag' }, 'Member') : null);
      return [h('h2', {}, `Members · ${alive.length} alive`), h('ul', { class: 'players' }, alive.map(row), gone.map(row))];
    });

    patch('action', document.getElementById('action'), { a: club.action, ph: club.phase, s: club.status, me: club.me, e: club.endgame, players: club.players.map((p) => [p.userId, p.alive, p.role]) }, () => renderAction(club));

    patch('feed', document.getElementById('feed'), club.events, (events) => [
      h('h2', {}, 'The Proprietor'),
      h('ul', { class: 'feed' }, events.slice().reverse().map((ev) => h('li', { class: `event ${ev.type}` },
        h('div', { class: 'meta' }, `Day ${ev.day} · ${fmtTime(ev.at)}`),
        h('div', {}, ev.text),
        ev.data && ev.data.ballots && ev.data.ballots.length
          ? h('details', {}, h('summary', {}, 'How everyone voted'), h('ul', {}, ev.data.ballots.map((b) => h('li', {}, `${b.voter} → ${b.target}`))))
          : null))),
    ]);
  }

  function renderAction(club) {
    const a = club.action;
    const me = club.me;
    if (club.status === 'ended') return [h('h2', {}, 'The season is over'), h('p', { class: 'muted' }, 'Thank you for your membership. Found a new club from My clubs to play again.')];
    if (!me.alive) return [h('h2', {}, club.phaseName), h('p', { class: 'muted' }, 'You are watching from the Cellar.')];
    if (!a) return null;
    const living = club.players.filter((p) => p.alive && p.userId !== me.userId);

    if (a.type === 'errand') {
      return [
        h('h2', {}, 'Today’s Errand'),
        h('p', { class: 'muted small' }, `Each correct answer adds ${a.points} to the Vault. One try. Results when Errands end. ${a.answered} answered so far.`),
        h('p', {}, h('b', {}, a.question)),
        h('div', { class: 'choices' }, a.choices.map((c, i) => h('button', {
          class: a.myAnswer === i ? 'selected' : '', disabled: a.myAnswer !== null,
          onclick: act('errand', { choice: i }),
        }, c))),
        a.myAnswer !== null ? h('p', { class: 'small muted' }, 'Answer locked in. Now: who do you suspect? Talk it over in the Lounge.') : null,
      ];
    }

    if (a.type === 'tribunal') {
      const parts = [
        h('h2', {}, 'The Tribunal'),
        h('p', { class: 'muted small' }, club.endgame
          ? `${a.votesCast} of ${club.alive} have voted. The most votes is blackballed; ties are drawn by lot.`
          : `${a.votesCast} of ${club.alive} have voted. ${a.needed} votes on one name are needed to blackball. You can change your vote until the Tribunal closes.`),
        h('div', { class: 'choices' }, living.map((p) => h('button', {
          class: a.myVote === p.userId ? 'selected' : '', onclick: act('vote', { targetId: p.userId }),
        }, avatar(p.name), p.name))),
      ];
      if (club.endgame) {
        parts.push(
          h('h3', {}, 'The Last Toast'),
          h('p', { class: 'muted small' }, 'If every survivor raises a glass, the season ends now. Any Murderer left takes the whole Vault.'),
          h('div', { class: 'row' },
            h('button', { class: a.myToast === 'raise' ? 'selected' : '', onclick: act('toast', { choice: 'raise' }) }, 'Raise a Glass'),
            h('button', { class: a.myToast === 'pour' ? 'selected' : '', onclick: act('toast', { choice: 'pour' }) }, 'Pour Another')));
      }
      return parts;
    }

    if (a.type === 'backroom') {
      if (me.role !== 'murderer') {
        return [h('h2', {}, 'Lights out'), h('p', { class: 'muted' }, 'The Murderers are meeting in the Back Room. Sleep well — if you can.')];
      }
      const targets = club.players.filter((p) => p.alive && p.role === 'member');
      return [
        h('h2', {}, 'The Back Room'),
        h('p', { class: 'muted small' }, 'Choose tonight’s victim. Most votes among the Murderers wins; ties are drawn by lot. Discuss in the Back Room chat.'),
        h('div', { class: 'choices' }, targets.map((p) => h('button', {
          class: a.myPick === p.userId ? 'selected' : '', onclick: act('murder', { targetId: p.userId }),
        }, avatar(p.name), p.name))),
        h('ul', { class: 'small muted' }, (a.picks || []).map((pk) => h('li', {}, `${pk.name}: ${pk.target || 'undecided'}`))),
      ];
    }
    return null;
  }

  let lastZero = 0;
  function tickCountdown() {
    const el = document.getElementById('countdown');
    const c = state.club;
    if (!el || !c || !c.phaseEndsAt) return;
    const left = c.phaseEndsAt - (Date.now() + state.serverOffset);
    el.textContent = fmtDuration(left);
    if (left <= 0 && Date.now() - lastZero > 2000) {
      lastZero = Date.now();
      refreshClub().catch(() => {});
    }
  }
  setInterval(tickCountdown, 1000);

  // ------------------------------------------------------------ boot

  window.addEventListener('hashchange', () => route().catch((e) => toast(e.message)));
  api('/api/me').then(({ user }) => { state.user = user; return route(); }).catch((e) => toast(e.message));
})();
