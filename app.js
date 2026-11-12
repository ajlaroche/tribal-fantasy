// Tribal Fantasy — UI. Renders from state S; all user actions go through run().
(function () {
  const API = window.API;
  const ME_KEY = 'tf-me';

  const S = {
    data: null,       // public league data from API.loadPublic()
    me: null,         // {name, pin} saved on this device
    mine: null,       // {id, name, picks, winner} for the signed-in player
    adminUid: null,
    tab: 'week',
    joinMode: 'join', // 'join' | 'signin'
    openResults: null,// episode number whose results form is open
    showAdminLogin: false,
  };

  // ------------------------------------------------------------ utils
  const $ = sel => document.querySelector(sel);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = esc;
  const isAdmin = () => !!(S.adminUid && S.data && S.data.league.admin_uid === S.adminUid);

  function loadMe() { try { return JSON.parse(localStorage.getItem(ME_KEY)); } catch (e) { return null; } }
  function saveMe(me) { try { me ? localStorage.setItem(ME_KEY, JSON.stringify(me)) : localStorage.removeItem(ME_KEY); } catch (e) { /* ignore */ } }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
  }

  async function run(fn, okMsg) {
    try {
      await fn();
      await refresh();
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(e.message || String(e), true);
    }
  }

  const cast = id => S.data.castaways.find(c => c.id === Number(id));
  const castName = id => (id == null ? '—' : (cast(id)?.name || '?'));
  const immLabel = v => {
    if (!v) return '—';
    if (v.startsWith('t:')) return v.slice(2) + ' tribe';
    return castName(v.slice(2));
  };
  const inPlay = () => S.data.castaways.filter(c => c.status === 'in');
  const tribes = () => [...new Set(inPlay().map(c => c.tribe).filter(Boolean))].sort();
  const initials = name => String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  // Photo if we have one; initials circle otherwise (and if the photo fails to load).
  const avatar = (c, size) => `<span class="avatar${size === 'sm' ? ' sm' : ''}" aria-hidden="true"><span>${esc(initials(c.name))}</span>${c.photo_url
    ? `<img src="${attr(c.photo_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
  const mgrName = id => S.data.managers.find(m => m.id === id)?.name || 'Someone';

  function epStatus(ep) {
    if (ep.scored) return 'scored';
    return new Date(ep.lock_at) > new Date() ? 'open' : 'locked';
  }
  function currentEpisode() {
    const eps = S.data.episodes;
    const open = eps.filter(e => epStatus(e) === 'open').sort((a, b) => a.number - b.number)[0];
    return open || eps[eps.length - 1] || null;
  }
  function untilText(iso) {
    const ms = new Date(iso) - new Date();
    if (ms <= 0) return 'locked';
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    return 'locks in ' + (d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`);
  }
  // Lock times are one exact moment (the first airing, 8pm ET). Each viewer sees it in their own zone, labeled.
  const fmtDate = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const myZone = (() => {
    try { return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value; }
    catch (e) { return 'local'; }
  })();
  function toLocalInput(iso) {
    const d = new Date(iso); const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const scoring = () => Object.assign({}, window.Scoring.DEFAULT_SCORING, S.data.league.scoring || {});

  function table() {
    const d = S.data;
    return window.Scoring.standings({
      managers: d.managers, picks: d.revealedPicks, episodes: d.episodes,
      castaways: d.castaways, winnerPicks: d.winnerPicks, scoring: d.league.scoring,
    });
  }

  function options(list, selected, placeholder) {
    return `<option value="">${esc(placeholder || 'Choose…')}</option>` +
      list.map(o => `<option value="${attr(o.value)}"${String(o.value) === String(selected ?? '') ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${esc(o.label)}</option>`).join('');
  }

  // ------------------------------------------------------------ data
  async function refresh() {
    S.data = await API.loadPublic();
    S.adminUid = await API.getUserId().catch(() => null);
    if (S.me) {
      try { S.mine = await API.myPicks(S.me.name, S.me.pin); }
      catch (e) { S.me = null; S.mine = null; saveMe(null); toast('Please sign in again', true); }
    }
    render();
  }

  // ------------------------------------------------------------ render
  function render() {
    if (!S.data) return;
    document.title = S.data.league.name;
    $('#league-name').textContent = S.data.league.name;

    const tabs = [['week', 'This week'], ['standings', 'Standings'], ['history', 'History'], ['cast', 'Castaways']];
    if (isAdmin()) tabs.push(['admin', 'Commissioner']);
    if (S.tab === 'admin' && !isAdmin() && !S.showAdminLogin) S.tab = 'week';
    $('#tabs').innerHTML = tabs.map(([k, l]) =>
      `<button data-action="tab" data-tab="${k}"${S.tab === k ? ' aria-current="page"' : ''}>${l}</button>`).join('');

    const demoBanner = API.demo ? `<div class="banner"><strong>Demo mode.</strong> Fake league saved only in this browser.
      Join code <code>ISLAND</code>; sample players Sam / 1111 and Jordan / 2222. Add your Supabase keys to <code>config.js</code> to go live.
      <button class="link" data-action="reset-demo">Reset demo</button></div>` : '';

    const views = { week: viewWeek, standings: viewStandings, history: viewHistory, cast: viewCast, admin: viewAdmin };
    $('#app').innerHTML = demoBanner + (S.tab === 'admin' && !isAdmin() ? viewAdminLogin() : views[S.tab]());

    $('#foot').innerHTML = S.me
      ? `Playing as <strong>${esc(S.mine?.name || S.me.name)}</strong> · <button class="link" data-action="player-signout">Switch player</button>`
        + (isAdmin() ? '' : ` · <button class="link" data-action="admin-login">Commissioner</button>`)
      : (isAdmin() ? '' : `<button class="link" data-action="admin-login">Commissioner sign-in</button>`);
    if (isAdmin()) $('#foot').innerHTML += `${S.me ? ' · ' : ''}<button class="link" data-action="admin-signout">Commissioner sign out</button>`;
  }

  // ---- This week
  function viewWeek() {
    const ep = currentEpisode();
    if (!ep) return `<div class="card"><h2>No episodes yet</h2><p class="muted">The commissioner hasn't opened any episodes for picks.</p></div>` + viewPlayerGate();
    const st = epStatus(ep);
    let html = `<div class="card"><div class="card-head"><h2>${esc(ep.title || 'Episode ' + ep.number)}</h2>
      <span class="pill ${st}">${st === 'open' ? untilText(ep.lock_at) : st}</span></div>
      <p class="muted small">Picks lock ${esc(fmtDate(ep.lock_at))}, when the episode starts airing</p>`;

    if (st === 'open') {
      html += S.me ? viewPickForm(ep) : `<p>Join the league or sign in below to make your picks.</p>`;
      html += `<p class="small muted">Everyone's picks are revealed when the episode locks.</p>`;
    } else {
      html += viewRevealed(ep);
    }
    html += `</div>`;
    if (!S.me) html += viewPlayerGate();
    html += viewWinnerCard();
    html += viewRulesCard();
    return html;
  }

  function viewPickForm(ep) {
    const mine = S.mine?.picks.find(p => p.episode === ep.number) || {};
    const prev = (S.mine?.picks || []).filter(p => p.episode < ep.number).sort((a, b) => b.episode - a.episode)[0];
    const people = inPlay().map(c => ({ value: c.id, label: c.name + (c.tribe && !S.data.league.merged ? ` (${c.tribe})` : '') }));
    const immOpts = S.data.league.merged
      ? inPlay().map(c => ({ value: 'c:' + c.id, label: c.name }))
      : tribes().map(t => ({ value: 't:' + t, label: t + ' tribe' }));
    const safeOpts = people.map(o => ({ ...o, disabled: prev && prev.safe === o.value,
      label: o.label + (prev && prev.safe === o.value ? ' — used last week' : '') }));
    const sc = scoring();
    const saved = mine.updated_at || mine.boot != null || mine.immunity || mine.safe != null || mine.idol != null;
    return `<form data-form="picks" data-episode="${ep.number}">
      <div class="field"><label for="p-boot">Who gets voted out? <span class="hint">+${sc.boot}</span></label>
        <select id="p-boot" name="boot">${options(people, mine.boot)}</select></div>
      <div class="field"><label for="p-imm">Who wins immunity? <span class="hint">+${sc.immunity} · ${S.data.league.merged ? 'individual' : 'tribe'}</span></label>
        <select id="p-imm" name="immunity">${options(immOpts, mine.immunity)}</select></div>
      <div class="field"><label>Will an idol be played? <span class="hint">+${sc.idol}</span></label>
        <div class="choices">
          <label class="choice"><input type="radio" name="idol" value="true"${mine.idol === true ? ' checked' : ''}> Yes</label>
          <label class="choice"><input type="radio" name="idol" value="false"${mine.idol === false ? ' checked' : ''}> No</label>
        </div></div>
      <div class="field"><label for="p-safe">Safe pick: who survives? <span class="hint">+${sc.safe} · can't repeat last week's</span></label>
        <select id="p-safe" name="safe">${options(safeOpts, mine.safe)}</select></div>
      <button type="submit">${saved ? 'Update picks' : 'Lock in picks'}</button>
      ${saved ? `<span class="small muted" style="margin-left:8px">Saved ✓ you can change until lock</span>` : ''}
    </form>`;
  }

  function viewRevealed(ep) {
    const picks = S.data.revealedPicks.filter(p => p.episode === ep.number);
    if (!picks.length) return `<p class="muted">Nobody made picks for this episode.</p>`;
    const r = ep.scored ? ep.results : null;
    const mark = (ok) => r ? (ok ? ' <span class="hit">✓</span>' : ' <span class="miss">✗</span>') : '';
    const out = (r?.votedOut || []).map(Number), imm = (r?.immunity || []).map(String);
    const rows = picks.map(p => `<tr><td>${esc(mgrName(p.manager_id))}</td>
      <td>${esc(castName(p.boot))}${p.boot != null ? mark(out.includes(p.boot)) : ''}</td>
      <td>${esc(immLabel(p.immunity))}${p.immunity ? mark(imm.includes(p.immunity)) : ''}</td>
      <td>${p.idol == null ? '—' : p.idol ? 'Yes' : 'No'}${p.idol != null && r && typeof r.idolPlayed === 'boolean' ? mark(p.idol === r.idolPlayed) : ''}</td>
      <td>${esc(castName(p.safe))}${p.safe != null ? mark(!out.includes(p.safe)) : ''}</td></tr>`).join('');
    return `${r ? resultsLine(ep) : '<p class="small muted">Waiting for the commissioner to enter results.</p>'}
      <div class="table-wrap"><table><thead><tr><th>Player</th><th>Boot</th><th>Immunity</th><th>Idol</th><th>Safe</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function resultsLine(ep) {
    const r = ep.results || {};
    return `<p><strong>Out:</strong> ${esc((r.votedOut || []).map(castName).join(', ') || 'nobody')} ·
      <strong>Immunity:</strong> ${esc((r.immunity || []).map(immLabel).join(', ') || '—')} ·
      <strong>Idol played:</strong> ${r.idolPlayed === true ? 'yes' : r.idolPlayed === false ? 'no' : '—'}</p>`;
  }

  function viewPlayerGate() {
    const join = S.joinMode === 'join';
    return `<div class="card"><div class="card-head"><h2>${join ? 'Join the league' : 'Sign in'}</h2>
      <button class="link" data-action="join-mode">${join ? 'Already joined? Sign in' : 'New here? Join'}</button></div>
      <form data-form="${join ? 'join' : 'signin'}">
        ${join ? `<div class="field"><label for="j-code">Join code <span class="hint">from your commissioner</span></label>
          <input id="j-code" name="code" type="text" autocomplete="off" autocapitalize="characters" required></div>` : ''}
        <div class="row">
          <div class="field"><label for="j-name">Your name</label><input id="j-name" name="name" type="text" maxlength="24" autocomplete="nickname" required></div>
          <div class="field"><label for="j-pin">4-digit PIN</label><input id="j-pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" required></div>
        </div>
        <p class="small muted">No account needed. Remember your PIN — you'll use it if you switch phones.</p>
        <button type="submit">${join ? 'Join' : 'Sign in'}</button>
      </form></div>`;
  }

  function viewWinnerCard() {
    const sc = scoring();
    const locked = S.data.league.winner_locked;
    const champ = S.data.castaways.find(c => c.status === 'winner');
    const counts = {};
    S.data.winnerPicks.forEach(w => { counts[w.castaway_id] = (counts[w.castaway_id] || 0) + 1; });
    const popular = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, n]) => `<span class="chip${cast(id)?.status === 'out' ? ' out' : ''}">${esc(castName(id))} ×${n}</span>`).join('');
    let mineHtml = '';
    if (S.me) {
      const w = S.mine?.winner;
      const worth = w ? Math.max(sc.winnerMin, sc.winner - sc.winnerChangePenalty * w.changes) : sc.winner;
      mineHtml = `<p>Your pick: <strong>${esc(w ? castName(w.castaway_id) : 'none yet')}</strong>
        ${w ? `<span class="muted small"> · worth ${worth} pts${w.changes ? ` (${w.changes} change${w.changes > 1 ? 's' : ''})` : ''}</span>` : ''}</p>`;
      if (!locked && !champ) {
        mineHtml += `<form data-form="winner" class="row" style="align-items:end">
          <div class="field" style="margin:0"><label for="w-pick" class="small">${w ? `Change pick (costs ${sc.winnerChangePenalty} pt)` : 'Pick your Sole Survivor'}</label>
          <select id="w-pick" name="castaway">${options(inPlay().map(c => ({ value: c.id, label: c.name })), w?.castaway_id)}</select></div>
          <button type="submit" style="flex:0 0 auto">Save</button></form>`;
      }
    }
    return `<div class="card"><div class="card-head"><h2>Sole Survivor pick</h2>
      <span class="pill">${champ ? 'winner: ' + esc(champ.name) : locked ? 'locked' : '+' + sc.winner + ' pts'}</span></div>
      ${mineHtml}
      ${popular ? `<p class="small muted" style="margin-top:8px">League favorites</p><div class="chips">${popular}</div>` : ''}</div>`;
  }

  function viewRulesCard() {
    const s = scoring();
    return `<details class="card"><summary><strong>How scoring works</strong></summary>
      <ul class="small" style="margin:10px 0 0;padding-left:18px">
        <li>Correct boot pick: <strong>+${s.boot}</strong></li>
        <li>Correct immunity pick (tribe before the merge, person after): <strong>+${s.immunity}</strong></li>
        <li>Correct idol call (yes/no): <strong>+${s.idol}</strong></li>
        <li>Safe pick survives: <strong>+${s.safe}</strong> (can't use the same person two weeks running)</li>
        <li>Sole Survivor: <strong>+${s.winner}</strong>, minus ${s.winnerChangePenalty} per change (min ${s.winnerMin})</li>
        <li>You can change your weekly picks as often as you like until the episode's lock time.</li>
        <li>Missed a week? You score 0 for it.</li>
      </ul></details>`;
  }

  // ---- Standings
  function viewStandings() {
    const rows = table();
    if (!rows.length) return `<div class="card"><h2>Standings</h2><p class="muted">No players yet.</p></div>`;
    const eps = S.data.episodes.filter(e => e.scored).sort((a, b) => b.number - a.number);
    const items = rows.map(r => `<details class="standing"><summary>
        <span class="rank">${r.rank}</span>
        <span><strong>${esc(r.name)}</strong><br><span class="sub">last week ${r.lastWeek >= 0 ? '+' : ''}${r.lastWeek} · ${r.accuracy == null ? 'no picks scored' : Math.round(r.accuracy * 100) + '% right'}</span></span>
        <span class="total">${r.total}</span></summary>
      <div class="breakdown small">
        ${eps.map(e => { const b = r.byEpisode[e.number]; return `<div>Ep ${e.number}: <strong>${b.total}</strong>
          <span class="muted">(boot ${b.boot}, imm ${b.immunity}, idol ${b.idol}, safe ${b.safe})</span></div>`; }).join('') || '<div class="muted">No scored episodes yet.</div>'}
        ${r.winner ? `<div>Sole Survivor bonus: <strong>${r.winner}</strong></div>` : ''}
      </div></details>`).join('');
    return `<div class="card"><h2>Standings</h2><p class="small muted">Tap a player for their week-by-week points.</p>${items}</div>`;
  }

  // ---- History
  function viewHistory() {
    const eps = S.data.episodes.filter(e => epStatus(e) !== 'open').sort((a, b) => b.number - a.number);
    if (!eps.length) return `<div class="card"><h2>History</h2><p class="muted">Nothing has aired yet.</p></div>`;
    return eps.map(ep => `<div class="card"><div class="card-head"><h3>${esc(ep.title || 'Episode ' + ep.number)}</h3>
      <span class="pill ${epStatus(ep)}">${epStatus(ep)}</span></div>${viewRevealed(ep)}</div>`).join('');
  }

  // ---- Castaways
  function viewCast() {
    const bootCounts = {};
    S.data.revealedPicks.forEach(p => { if (p.boot != null) bootCounts[p.boot] = (bootCounts[p.boot] || 0) + 1; });
    const card = c => `<div class="cast${c.status === 'out' ? ' out' : ''}">${avatar(c)}
      <div class="cast-info"><div class="name">${esc(c.name)}${c.status === 'winner' ? ' 🏆' : ''}</div>
      <div class="sub">${esc(c.tribe || 'no tribe')}${c.status === 'out' ? ` · out ep ${esc(c.out_episode ?? '?')}` : ''}</div>
      <div class="sub">picked to go home ${bootCounts[c.id] || 0}×</div></div></div>`;
    const live = S.data.castaways.filter(c => c.status !== 'out');
    const out = S.data.castaways.filter(c => c.status === 'out').sort((a, b) => (b.out_episode || 0) - (a.out_episode || 0));
    const groups = S.data.league.merged ? [['Merged tribe', live]]
      : [...new Set(live.map(c => c.tribe || 'No tribe'))].sort().map(t => [t, live.filter(c => (c.tribe || 'No tribe') === t)]);
    if (!S.data.castaways.length) return `<div class="card"><h2>Castaways</h2><p class="muted">The commissioner hasn't added the cast yet.</p></div>`;
    return groups.map(([t, list]) => `<div class="card"><h2>${esc(t)} <span class="muted small">${list.length} left</span></h2>
      <div class="grid-cast">${list.map(card).join('')}</div></div>`).join('')
      + (out.length ? `<div class="card"><h2>Out of the game</h2><div class="grid-cast">${out.map(card).join('')}</div></div>` : '');
  }

  // ---- Commissioner
  function viewAdminLogin() {
    return `<div class="card"><h2>Commissioner sign-in</h2>
      <form data-form="admin-login">
        <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="a-pw">Password</label><input id="a-pw" name="password" type="password" autocomplete="current-password" required></div>
        <button type="submit">Sign in</button> <button type="button" class="ghost" data-action="tab" data-tab="week">Cancel</button>
      </form></div>`;
  }

  function viewAdmin() {
    const L = S.data.league, sc = scoring();
    const scoreFields = [['boot', 'Boot'], ['immunity', 'Immunity'], ['idol', 'Idol call'], ['safe', 'Safe pick'],
      ['winner', 'Sole Survivor'], ['winnerChangePenalty', 'Winner change penalty'], ['winnerMin', 'Winner minimum']];
    const nextEp = Math.max(0, ...S.data.episodes.map(e => e.number)) + 1;

    const castRows = [...S.data.castaways].sort((a, b) => (a.status === 'out') - (b.status === 'out') || a.name.localeCompare(b.name))
      .map(c => `<tr data-cast="${c.id}"><td><span class="name-cell">${avatar(c, 'sm')}${esc(c.name)}</span></td>
        <td><input type="text" name="tribe" value="${attr(c.tribe || '')}" data-cast-field="tribe" aria-label="Tribe for ${attr(c.name)}"></td>
        <td><input type="text" name="photo_url" value="${attr(c.photo_url || '')}" data-cast-field="photo_url" placeholder="img/cast/name.webp" aria-label="Photo link for ${attr(c.name)}"></td>
        <td><select data-cast-field="status" aria-label="Status for ${attr(c.name)}">
          ${['in', 'out', 'winner'].map(s => `<option${c.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
        <td class="num">${c.out_episode ?? ''}</td>
        <td><button class="danger small" data-action="del-cast" data-id="${c.id}" aria-label="Remove ${attr(c.name)}">✕</button></td></tr>`).join('');

    const epRows = [...S.data.episodes].sort((a, b) => b.number - a.number).map(ep => `
      <div class="standing" style="padding:10px 0">
        <div class="card-head"><strong>${esc(ep.title || 'Episode ' + ep.number)}</strong><span class="pill ${epStatus(ep)}">${epStatus(ep)}</span></div>
        <form data-form="episode-time" data-episode="${ep.number}" class="row" style="align-items:end;margin-top:6px">
          <div class="field" style="margin:0"><label class="small" for="title-${ep.number}">Title</label>
          <input id="title-${ep.number}" type="text" name="title" value="${attr(ep.title || '')}" placeholder="Episode ${ep.number}"></div>
          <div class="field" style="margin:0"><label class="small" for="lock-${ep.number}">Picks lock <span class="hint">(your time, ${esc(myZone)})</span></label>
          <input id="lock-${ep.number}" type="datetime-local" name="lock_at" value="${attr(toLocalInput(ep.lock_at))}" required></div>
          <button type="submit" class="ghost small" style="flex:0 0 auto">Save</button>
          <button type="button" class="small" style="flex:0 0 auto" data-action="toggle-results" data-episode="${ep.number}">${S.openResults === ep.number ? 'Close' : ep.scored ? 'Edit results' : 'Enter results'}</button>
          <button type="button" class="danger small" style="flex:0 0 auto" data-action="del-ep" data-episode="${ep.number}">Delete</button>
        </form>
        ${S.openResults === ep.number ? viewResultsForm(ep) : ''}
      </div>`).join('');

    const mgrRows = S.data.managers.map(m => `<tr><td>${esc(m.name)}</td>
      <td><button class="ghost small" data-action="reset-pin" data-id="${attr(m.id)}" data-name="${attr(m.name)}">Reset PIN</button>
      <button class="danger small" data-action="del-mgr" data-id="${attr(m.id)}" data-name="${attr(m.name)}">Remove</button></td></tr>`).join('');

    return `
    <div class="card"><h2>League</h2>
      <form data-form="league">
        <div class="field"><label for="l-name">League name</label><input id="l-name" name="name" type="text" value="${attr(L.name)}" required></div>
        <div class="choices field">
          <label class="choice"><input type="checkbox" name="merged"${L.merged ? ' checked' : ''}> Tribes have merged (individual immunity)</label>
          <label class="choice"><input type="checkbox" name="winner_locked"${L.winner_locked ? ' checked' : ''}> Lock Sole Survivor picks</label>
        </div>
        <h3>Points</h3>
        <div class="row">${scoreFields.map(([k, l]) => `<div class="field"><label class="small" for="s-${k}">${l}</label>
          <input id="s-${k}" name="s_${k}" type="number" step="1" value="${attr(sc[k])}"></div>`).join('')}</div>
        <button type="submit">Save league</button>
      </form>
      <hr>
      <form data-form="join-code" class="row" style="align-items:end">
        <div class="field" style="margin:0"><label for="jc">Join code <span class="hint">share this with friends; setting a new one replaces the old</span></label>
        <input id="jc" name="code" type="text" autocomplete="off" minlength="4" required></div>
        <button type="submit" style="flex:0 0 auto">Set code</button>
      </form>
    </div>

    <div class="card"><h2>Episodes</h2>
      <div class="row" style="align-items:center">
        <button type="button" data-action="lookup-ep" style="flex:0 0 auto"${S.lookingUp ? ' disabled' : ''}>${S.lookingUp ? 'Checking the wiki…' : `Look up Episode ${nextEp}`}</button>
        <span class="small muted">Checks the Survivor ${esc(season())} wiki page and adds Episode ${nextEp} if it's listed, with picks locking 8pm ET on its air date.</span>
      </div>
      ${S.lookupMsg ? `<p class="small lookup-msg ${S.lookupMsg.ok ? 'ok' : ''}" role="status">${esc(S.lookupMsg.text)}</p>` : ''}
      <details class="custom-ep" style="margin-top:10px"><summary class="small">Add an episode by hand</summary>
      <form data-form="new-episode" class="row" style="align-items:end;margin-top:10px">
        <div class="field" style="margin:0;flex:0 1 90px"><label class="small" for="ne-n">Number</label><input id="ne-n" name="number" type="number" min="1" value="${nextEp}" required></div>
        <div class="field" style="margin:0"><label class="small" for="ne-t">Title <span class="hint">optional</span></label><input id="ne-t" name="title" type="text"></div>
        <div class="field" style="margin:0"><label class="small" for="ne-l">Picks lock <span class="hint">(your time, ${esc(myZone)})</span></label><input id="ne-l" name="lock_at" type="datetime-local" required></div>
        <button type="submit" style="flex:0 0 auto">Add episode</button>
      </form></details>
      ${epRows || '<p class="muted" style="margin-top:12px">No episodes yet.</p>'}
    </div>

    <div class="card"><h2>Castaways</h2>
      <form data-form="add-cast">
        <div class="field"><label for="ac">Add castaways <span class="hint">one per line: Name, Tribe</span></label>
        <textarea id="ac" name="lines" placeholder="Rowan, Sela&#10;Priya, Lumo"></textarea></div>
        <button type="submit">Add</button>
      </form>
      ${castRows ? `<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Name</th><th>Tribe</th><th>Photo</th><th>Status</th><th class="num">Out ep</th><th></th></tr></thead>
        <tbody>${castRows}</tbody></table></div><p class="small muted">Tribe, photo and status save as soon as you change them. Photos can be a file in the site's <code>img/cast/</code> folder or a full https link.</p>` : ''}
    </div>

    <div class="card"><h2>Players</h2>
      ${mgrRows ? `<div class="table-wrap"><table><tbody>${mgrRows}</tbody></table></div>` : '<p class="muted">Nobody has joined yet.</p>'}
    </div>`;
  }

  function viewResultsForm(ep) {
    const r = ep.results || {};
    const out = (r.votedOut || []).map(Number), imm = (r.immunity || []).map(String);
    const eligible = S.data.castaways.filter(c => c.status === 'in' || out.includes(c.id) || c.out_episode === ep.number);
    const allTribes = [...new Set(S.data.castaways.map(c => c.tribe).filter(Boolean))].sort();
    const check = (name, value, on, label) =>
      `<label class="choice"><input type="checkbox" name="${name}" value="${attr(value)}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
    return `<form data-form="results" data-episode="${ep.number}" style="margin-top:12px">
      <div class="field"><label>Voted out / left the game</label>
        <div class="choices">${eligible.map(c => check('votedOut', c.id, out.includes(c.id), c.name)).join('')}</div></div>
      <div class="field"><label>Immunity winner(s)</label>
        <div class="choices">${allTribes.map(t => check('immunity', 't:' + t, imm.includes('t:' + t), t + ' tribe')).join('')}
        ${eligible.map(c => check('immunity', 'c:' + c.id, imm.includes('c:' + c.id), c.name)).join('')}</div></div>
      <div class="field"><label>Was an idol played?</label>
        <div class="choices">
          <label class="choice"><input type="radio" name="idolPlayed" value="true"${r.idolPlayed === true ? ' checked' : ''}> Yes</label>
          <label class="choice"><input type="radio" name="idolPlayed" value="false"${r.idolPlayed === false ? ' checked' : ''}> No</label>
        </div></div>
      <p class="small muted">${ep.scored
        ? 'Fixing a mistake? Change the boxes and save again. Standings recalculate, and anyone you untick goes back to "in".'
        : 'Saving marks the episode scored and moves voted-out castaways to "out".'}</p>
      <button type="submit">${ep.scored ? 'Save corrected results' : 'Save results'}</button>
    </form>`;
  }

  // ------------------------------------------------------------ wiki lookup
  const season = () => (window.TF_CONFIG && window.TF_CONFIG.season) || 51;

  async function lookupNextEpisode() {
    const latest = Math.max(0, ...S.data.episodes.map(e => e.number));
    const want = latest + 1;
    S.lookingUp = true; S.lookupMsg = null; render();
    try {
      const ep = await window.Wiki.nextEpisode(season(), latest);
      if (!ep) {
        S.lookupMsg = { ok: false, text: `Episode ${want} isn't on the wiki yet. It usually shows up a few days before it airs, so try again later.` };
      } else {
        const title = ep.title ? `Episode ${ep.number} — "${ep.title}"` : null;
        await API.upsertEpisode({ number: ep.number, title, lock_at: ep.lock_at });
        await refresh();
        S.lookupMsg = { ok: true, text: `Added ${title || 'Episode ' + ep.number}. It airs ${ep.airDate} and picks lock ${fmtDate(ep.lock_at)}. ${new Date(ep.lock_at) > new Date() ? 'Picks are open now.' : 'That lock time has already passed, so the episode is locked.'}`
          + (ep.title ? '' : ' The wiki has no title yet; you can add one below.') };
      }
    } catch (e) {
      S.lookupMsg = { ok: false, text: e.message || String(e) };
    }
    S.lookingUp = false; render();
  }

  // ------------------------------------------------------------ events
  const num = v => (v === '' || v == null ? null : Number(v));

  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const fd = new FormData(f), v = k => (fd.get(k) ?? '').toString();
    const epNum = Number(f.dataset.episode);

    switch (f.dataset.form) {
      case 'join': return run(async () => {
        await API.joinLeague(v('code'), v('name'), v('pin'));
        S.me = { name: v('name').trim(), pin: v('pin') }; saveMe(S.me);
      }, "You're in! Make your picks.");
      case 'signin': return run(async () => {
        await API.myPicks(v('name'), v('pin'));
        S.me = { name: v('name').trim(), pin: v('pin') }; saveMe(S.me);
      }, 'Welcome back');
      case 'picks': return run(() => API.submitPicks(S.me.name, S.me.pin, epNum, {
        boot: num(v('boot')), immunity: v('immunity') || null,
        idol: v('idol') === '' ? null : v('idol') === 'true', safe: num(v('safe')),
      }), 'Picks saved');
      case 'winner': return run(() => {
        if (!v('castaway')) throw new Error('Choose a castaway');
        return API.setWinnerPick(S.me.name, S.me.pin, Number(v('castaway')));
      }, 'Sole Survivor pick saved');
      case 'admin-login': return run(async () => {
        await API.signIn(v('email'), v('password'));
        S.showAdminLogin = false; S.tab = 'admin';
      }, 'Signed in');
      case 'league': return run(() => {
        const sc = {};
        ['boot', 'immunity', 'idol', 'safe', 'winner', 'winnerChangePenalty', 'winnerMin'].forEach(k => { sc[k] = Number(v('s_' + k)) || 0; });
        return API.updateLeague({ name: v('name').trim(), merged: fd.has('merged'), winner_locked: fd.has('winner_locked'), scoring: sc });
      }, 'League saved');
      case 'join-code': return run(() => API.setJoinCode(v('code')), 'Join code set');
      case 'new-episode': return run(() => {
        const n = Number(v('number'));
        if (S.data.episodes.some(e => e.number === n)) throw new Error(`Episode ${n} already exists. Edit it in the list below instead.`);
        return API.upsertEpisode({ number: n, title: v('title').trim() || null, lock_at: new Date(v('lock_at')).toISOString() });
      }, 'Episode added');
      case 'episode-time': return run(() => {
        const ep = S.data.episodes.find(e => e.number === epNum);
        const lock = new Date(v('lock_at'));
        // Once an episode has locked, its lock time can't move back into the future (that would reopen picks).
        if (ep && new Date(ep.lock_at) <= new Date() && lock > new Date()) {
          throw new Error(`Episode ${epNum} is already locked, so its lock time can't be moved later. Picks stay closed.`);
        }
        return API.upsertEpisode({ number: epNum, title: v('title').trim() || null, lock_at: lock.toISOString() });
      }, 'Episode saved');
      case 'add-cast': return run(() => {
        const rows = v('lines').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const [name, tribe] = l.split(',').map(s => s.trim());
          return { name, tribe: tribe || null };
        }).filter(r => r.name);
        if (!rows.length) throw new Error('Type at least one name');
        return API.addCastaways(rows);
      }, 'Castaways added');
      case 'results': return run(async () => {
        const votedOut = fd.getAll('votedOut').map(Number);
        const results = { votedOut, immunity: fd.getAll('immunity').map(String),
          idolPlayed: v('idolPlayed') === '' ? null : v('idolPlayed') === 'true' };
        await API.saveResults(epNum, results, true);
        for (const c of S.data.castaways) {
          if (votedOut.includes(c.id) && c.status !== 'out') await API.updateCastaway(c.id, { status: 'out', out_episode: epNum });
          else if (!votedOut.includes(c.id) && c.status === 'out' && c.out_episode === epNum) await API.updateCastaway(c.id, { status: 'in', out_episode: null });
        }
        S.openResults = null;
      }, 'Results saved — standings updated');
    }
  });

  document.addEventListener('change', e => {
    const el = e.target.closest('[data-cast-field]'); if (!el) return;
    const id = Number(el.closest('tr').dataset.cast);
    const patch = { [el.dataset.castField]: el.value.trim() || null };
    if (patch.status === 'in') patch.out_episode = null;
    run(() => API.updateCastaway(id, patch), 'Saved');
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const a = b.dataset.action;
    if (a === 'tab') { S.tab = b.dataset.tab; S.showAdminLogin = false; render(); window.scrollTo(0, 0); }
    else if (a === 'refresh') run(() => null, 'Up to date');
    else if (a === 'join-mode') { S.joinMode = S.joinMode === 'join' ? 'signin' : 'join'; render(); }
    else if (a === 'player-signout') { S.me = null; S.mine = null; saveMe(null); S.tab = 'week'; render(); }
    else if (a === 'admin-login') { S.showAdminLogin = true; S.tab = 'admin'; render(); }
    else if (a === 'admin-signout') run(async () => { await API.signOut(); S.tab = 'week'; }, 'Signed out');
    else if (a === 'reset-demo') { if (confirm('Reset all demo data?')) { API.resetDemo(); S.me = null; saveMe(null); run(() => null, 'Demo reset'); } }
    else if (a === 'lookup-ep') lookupNextEpisode();
    else if (a === 'toggle-results') { const n = Number(b.dataset.episode); S.openResults = S.openResults === n ? null : n; render(); }
    else if (a === 'del-cast') { if (confirm('Remove this castaway? Picks that named them will be cleared.')) run(() => API.deleteCastaway(Number(b.dataset.id)), 'Removed'); }
    else if (a === 'del-ep') { if (confirm('Delete this episode and everyone\'s picks for it?')) run(() => API.deleteEpisode(Number(b.dataset.episode)), 'Episode deleted'); }
    else if (a === 'del-mgr') { if (confirm(`Remove ${b.dataset.name} and all their picks?`)) run(() => API.deleteManager(b.dataset.id), 'Player removed'); }
    else if (a === 'reset-pin') {
      const pin = prompt(`New 4-digit PIN for ${b.dataset.name}:`);
      if (pin) run(() => API.resetPin(b.dataset.id, pin.trim()), 'PIN reset — tell them the new one');
    }
  });

  // Keep the countdown fresh without refetching.
  setInterval(() => { if (S.tab === 'week' && !document.querySelector('#app :focus')) render(); }, 60000);

  // ------------------------------------------------------------ start
  S.me = loadMe();
  refresh().catch(e => {
    $('#app').innerHTML = `<div class="card"><h2>Couldn't load the league</h2><p class="muted">${esc(e.message)}</p>
      <p class="small">Check <code>config.js</code> and that <code>supabase/schema.sql</code> has been run.</p></div>`;
  });
})();
