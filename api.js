// Data layer. Two implementations with the same methods:
//  - SupabaseApi: the real shared league
//  - DemoApi: fake league stored in this browser's localStorage, for trying things out
(function () {
  const cfg = window.TF_CONFIG || {};
  const demo = !cfg.supabaseUrl || !cfg.supabaseAnonKey || new URLSearchParams(location.search).has('demo');

  // ------------------------------------------------------------ Supabase
  function SupabaseApi() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

    return {
      demo: false,
      async loadPublic() {
        const [league, castaways, episodes, managers, revealedPicks, winnerPicks] = await Promise.all([
          sb.from('league').select('*').eq('id', 1).single().then(must),
          sb.from('castaways').select('*').order('name').then(must),
          sb.from('episodes').select('*').order('number').then(must),
          sb.from('manager_list').select('*').order('name').then(must),
          sb.from('revealed_picks').select('*').then(must),
          sb.from('winner_pick_list').select('*').then(must),
        ]);
        return { league, castaways, episodes, managers, revealedPicks, winnerPicks };
      },
      joinLeague: (code, name, pin) => sb.rpc('join_league', { p_code: code, p_name: name, p_pin: pin }).then(must),
      myPicks: (name, pin) => sb.rpc('my_picks', { p_name: name, p_pin: pin }).then(must),
      submitPicks: (name, pin, episode, p) => sb.rpc('submit_picks', {
        p_name: name, p_pin: pin, p_episode: episode,
        p_boot: p.boot, p_immunity: p.immunity, p_idol: p.idol, p_safe: p.safe,
      }).then(must),
      setWinnerPick: (name, pin, id) => sb.rpc('set_winner_pick', { p_name: name, p_pin: pin, p_castaway: id }).then(must),

      async getUserId() { const { data } = await sb.auth.getSession(); return data.session?.user.id || null; },
      signIn: (email, password) => sb.auth.signInWithPassword({ email, password }).then(must),
      signOut: () => sb.auth.signOut(),

      updateLeague: patch => sb.from('league').update(patch).eq('id', 1).then(must),
      setJoinCode: code => sb.rpc('set_join_code', { p_code: code }).then(must),
      addCastaways: rows => sb.from('castaways').insert(rows).then(must),
      updateCastaway: (id, patch) => sb.from('castaways').update(patch).eq('id', id).then(must),
      deleteCastaway: id => sb.from('castaways').delete().eq('id', id).then(must),
      upsertEpisode: ep => sb.from('episodes').upsert(ep).then(must),
      deleteEpisode: n => sb.from('episodes').delete().eq('number', n).then(must),
      saveResults: (n, results, scored) => sb.from('episodes').update({ results, scored }).eq('number', n).then(must),
      resetPin: (id, pin) => sb.rpc('reset_pin', { p_manager: id, p_pin: pin }).then(must),
      deleteManager: id => sb.from('managers').delete().eq('id', id).select('id').then(must)
        .then(rows => { if (!rows.length) throw new Error('Could not remove that player (are you signed in as commissioner?)'); }),
    };
  }

  // ------------------------------------------------------------ Demo
  function DemoApi() {
    const KEY = 'tf-demo-v1';
    const day = 864e5;
    const fail = msg => { throw new Error(msg); };

    function seed() {
      const now = Date.now();
      const names = [
        ['Rowan', 'Sela'], ['Mika', 'Sela'], ['Dez', 'Sela'], ['Juniper', 'Sela'], ['Tobias', 'Sela'],
        ['Priya', 'Lumo'], ['Hank', 'Lumo'], ['Sasha', 'Lumo'], ['Leo', 'Lumo'], ['Wren', 'Lumo'],
      ];
      const castaways = names.map(([name, tribe], i) => ({ id: i + 1, name, tribe, status: 'in', out_episode: null }));
      castaways[2].status = 'out'; castaways[2].out_episode = 6;   // Dez
      castaways[8].status = 'out'; castaways[8].out_episode = 7;   // Leo
      const managers = [
        { id: 'm1', name: 'Sam', pin: '1111', created_at: new Date(now - 9 * day).toISOString() },
        { id: 'm2', name: 'Jordan', pin: '2222', created_at: new Date(now - 9 * day).toISOString() },
      ];
      return {
        league: { id: 1, name: 'Tribal Fantasy (demo)', scoring: { ...window.Scoring.DEFAULT_SCORING },
          merged: false, winner_locked: false, admin_uid: 'demo-admin' },
        joinCode: 'ISLAND',
        castaways,
        episodes: [
          { number: 6, title: 'Episode 6', lock_at: new Date(now - 14 * day).toISOString(), scored: true,
            results: { votedOut: [3], immunity: ['t:Lumo'], idolPlayed: false } },
          { number: 7, title: 'Episode 7', lock_at: new Date(now - 7 * day).toISOString(), scored: true,
            results: { votedOut: [9], immunity: ['t:Sela'], idolPlayed: true } },
          { number: 8, title: 'Episode 8', lock_at: new Date(now + 3 * day).toISOString(), scored: false, results: null },
        ],
        managers,
        picks: [
          { manager_id: 'm1', episode: 6, boot: 3, immunity: 't:Lumo', idol: false, safe: 1 },
          { manager_id: 'm2', episode: 6, boot: 7, immunity: 't:Sela', idol: false, safe: 6 },
          { manager_id: 'm1', episode: 7, boot: 5, immunity: 't:Sela', idol: true, safe: 6 },
          { manager_id: 'm2', episode: 7, boot: 9, immunity: 't:Lumo', idol: false, safe: 2 },
          { manager_id: 'm2', episode: 8, boot: 7, immunity: 't:Lumo', idol: true, safe: 1 },
        ],
        winnerPicks: [
          { manager_id: 'm1', castaway_id: 6, changes: 0 },
          { manager_id: 'm2', castaway_id: 1, changes: 1 },
        ],
      };
    }

    function load() {
      try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (e) { /* ignore */ }
      const s = seed(); save(s); return s;
    }
    function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
    function mutate(fn) { const s = load(); const r = fn(s); save(s); return Promise.resolve(r); }
    const clone = x => JSON.parse(JSON.stringify(x));
    const findMgr = (s, name, pin) =>
      s.managers.find(m => m.name.toLowerCase() === String(name).trim().toLowerCase() && m.pin === pin)
      || fail('Wrong name or PIN');

    return {
      demo: true,
      resetDemo() { save(seed()); },
      async loadPublic() {
        const s = load(); const now = Date.now();
        const locked = new Set(s.episodes.filter(e => new Date(e.lock_at) <= now).map(e => e.number));
        return clone({
          league: s.league,
          castaways: [...s.castaways].sort((a, b) => a.name.localeCompare(b.name)),
          episodes: [...s.episodes].sort((a, b) => a.number - b.number),
          managers: s.managers.map(({ id, name, created_at }) => ({ id, name, created_at })),
          revealedPicks: s.picks.filter(p => locked.has(p.episode)),
          winnerPicks: s.winnerPicks,
        });
      },
      joinLeague: (code, name, pin) => mutate(s => {
        name = name.trim();
        if (code.trim().toUpperCase() !== s.joinCode) fail('Wrong join code');
        if (!name || name.length > 24) fail('Name must be 1-24 characters');
        if (!/^\d{4}$/.test(pin)) fail('PIN must be 4 digits');
        if (s.managers.some(m => m.name.toLowerCase() === name.toLowerCase())) fail('That name is taken — pick another or sign in');
        const id = 'm' + Date.now();
        s.managers.push({ id, name, pin, created_at: new Date().toISOString() });
        return id;
      }),
      myPicks: (name, pin) => mutate(s => {
        const m = findMgr(s, name, pin);
        return clone({ id: m.id, name: m.name, picks: s.picks.filter(p => p.manager_id === m.id),
          winner: s.winnerPicks.find(w => w.manager_id === m.id) || null });
      }),
      submitPicks: (name, pin, episode, p) => mutate(s => {
        const m = findMgr(s, name, pin);
        const ep = s.episodes.find(e => e.number === episode) || fail('No such episode');
        if (Date.now() >= new Date(ep.lock_at)) fail('Picks for this episode are locked');
        const isIn = id => s.castaways.some(c => c.id === id && c.status === 'in');
        if (p.boot != null && !isIn(p.boot)) fail('Boot pick must be a castaway still in the game');
        if (p.safe != null && !isIn(p.safe)) fail('Safe pick must be a castaway still in the game');
        if (p.boot != null && p.boot === p.safe) fail("Your boot pick and safe pick can't be the same person");
        const prev = s.picks.filter(x => x.manager_id === m.id && x.episode < episode).sort((a, b) => b.episode - a.episode)[0];
        if (p.safe != null && prev && prev.safe === p.safe) fail('You used that safe pick last week — choose someone else');
        s.picks = s.picks.filter(x => !(x.manager_id === m.id && x.episode === episode));
        s.picks.push({ manager_id: m.id, episode, ...p });
      }),
      setWinnerPick: (name, pin, cid) => mutate(s => {
        const m = findMgr(s, name, pin);
        if (s.league.winner_locked) fail('Sole Survivor picks are locked');
        if (!s.castaways.some(c => c.id === cid && c.status === 'in')) fail('Pick a castaway still in the game');
        const w = s.winnerPicks.find(x => x.manager_id === m.id);
        if (!w) s.winnerPicks.push({ manager_id: m.id, castaway_id: cid, changes: 0 });
        else if (w.castaway_id !== cid) { w.castaway_id = cid; w.changes++; }
      }),

      getUserId: async () => 'demo-admin',
      signIn: async () => {},
      signOut: async () => {},

      updateLeague: patch => mutate(s => { Object.assign(s.league, patch); }),
      setJoinCode: code => mutate(s => {
        if (code.trim().length < 4) fail('Join code must be at least 4 characters');
        s.joinCode = code.trim().toUpperCase();
      }),
      addCastaways: rows => mutate(s => {
        let id = Math.max(0, ...s.castaways.map(c => c.id));
        rows.forEach(r => s.castaways.push({ id: ++id, status: 'in', out_episode: null, tribe: null, ...r }));
      }),
      updateCastaway: (id, patch) => mutate(s => { Object.assign(s.castaways.find(c => c.id === id), patch); }),
      deleteCastaway: id => mutate(s => { s.castaways = s.castaways.filter(c => c.id !== id); }),
      upsertEpisode: ep => mutate(s => {
        const e = s.episodes.find(x => x.number === ep.number);
        if (e) Object.assign(e, ep); else s.episodes.push({ scored: false, results: null, ...ep });
      }),
      deleteEpisode: n => mutate(s => {
        s.episodes = s.episodes.filter(e => e.number !== n);
        s.picks = s.picks.filter(p => p.episode !== n);
      }),
      saveResults: (n, results, scored) => mutate(s => { Object.assign(s.episodes.find(e => e.number === n), { results, scored }); }),
      resetPin: (id, pin) => mutate(s => {
        if (!/^\d{4}$/.test(pin)) fail('PIN must be 4 digits');
        s.managers.find(m => m.id === id).pin = pin;
      }),
      deleteManager: id => mutate(s => {
        s.managers = s.managers.filter(m => m.id !== id);
        s.picks = s.picks.filter(p => p.manager_id !== id);
        s.winnerPicks = s.winnerPicks.filter(w => w.manager_id !== id);
      }),
    };
  }

  window.API = demo ? DemoApi() : SupabaseApi();
})();
