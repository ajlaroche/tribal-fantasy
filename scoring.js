// Tribal Fantasy scoring — pure functions, no DOM, no database.
// Works in the browser (window.Scoring) and in Node (require('./scoring.js')).
(function (root) {
  const DEFAULT_SCORING = {
    boot: 5,               // correctly picked who gets voted out
    immunity: 3,           // correctly picked the immunity winner (person or tribe)
    idol: 2,               // correctly called whether an idol gets played
    safe: 1,               // your "safe" castaway survived the episode
    winner: 15,            // Sole Survivor pick is right
    winnerChangePenalty: 1,// minus this per change of your Sole Survivor pick
    winnerMin: 5,          // ...but never below this
  };

  function withDefaults(scoring) {
    return Object.assign({}, DEFAULT_SCORING, scoring || {});
  }

  // Points for one manager's pick on one scored episode.
  // Returns null if the episode has no results yet.
  function scoreEpisode(pick, episode, scoring) {
    if (!episode || !episode.scored || !episode.results) return null;
    const s = withDefaults(scoring);
    const r = episode.results;
    const out = (r.votedOut || []).map(Number);
    const imm = (r.immunity || []).map(String);
    const res = { boot: 0, immunity: 0, idol: 0, safe: 0, total: 0, correct: 0, attempted: 0 };
    if (!pick) return res;

    if (pick.boot != null) {
      res.attempted++;
      if (out.includes(Number(pick.boot))) { res.boot = s.boot; res.correct++; }
    }
    if (pick.immunity) {
      res.attempted++;
      if (imm.includes(String(pick.immunity))) { res.immunity = s.immunity; res.correct++; }
    }
    if (pick.idol != null && typeof r.idolPlayed === 'boolean') {
      res.attempted++;
      if (pick.idol === r.idolPlayed) { res.idol = s.idol; res.correct++; }
    }
    if (pick.safe != null) {
      res.attempted++;
      if (!out.includes(Number(pick.safe))) { res.safe = s.safe; res.correct++; }
    }
    res.total = res.boot + res.immunity + res.idol + res.safe;
    return res;
  }

  // Sole Survivor bonus. winnerPick = {castaway_id, changes}
  function winnerPoints(winnerPick, castaways, scoring) {
    if (!winnerPick || winnerPick.castaway_id == null) return 0;
    const s = withDefaults(scoring);
    const champ = (castaways || []).find(c => c.status === 'winner');
    if (!champ || Number(champ.id) !== Number(winnerPick.castaway_id)) return 0;
    const changes = Math.max(0, Number(winnerPick.changes) || 0);
    return Math.max(s.winnerMin, s.winner - s.winnerChangePenalty * changes);
  }

  // Full leaderboard.
  // managers: [{id, name}]
  // picks: [{manager_id, episode, boot, immunity, idol, safe}]
  // episodes: [{number, scored, results}]
  // winnerPicks: [{manager_id, castaway_id, changes}]
  function standings({ managers, picks, episodes, castaways, winnerPicks, scoring }) {
    const scored = (episodes || []).filter(e => e.scored && e.results)
      .sort((a, b) => a.number - b.number);
    const lastEp = scored.length ? scored[scored.length - 1].number : null;

    const rows = (managers || []).map(m => {
      const byEpisode = {};
      let total = 0, correct = 0, attempted = 0;
      for (const ep of scored) {
        const pick = (picks || []).find(p => p.manager_id === m.id && p.episode === ep.number);
        const r = scoreEpisode(pick, ep, scoring);
        byEpisode[ep.number] = r;
        total += r.total; correct += r.correct; attempted += r.attempted;
      }
      const wp = (winnerPicks || []).find(w => w.manager_id === m.id);
      const winner = winnerPoints(wp, castaways, scoring);
      total += winner;
      return {
        id: m.id,
        name: m.name,
        total,
        winner,
        lastWeek: lastEp != null && byEpisode[lastEp] ? byEpisode[lastEp].total : 0,
        correct,
        attempted,
        accuracy: attempted ? correct / attempted : null,
        byEpisode,
      };
    });

    rows.sort((a, b) => b.total - a.total || b.correct - a.correct || a.name.localeCompare(b.name));
    let rank = 0, prev = null;
    rows.forEach((r, i) => {
      if (prev === null || r.total !== prev) rank = i + 1;
      r.rank = rank; prev = r.total;
    });
    return rows;
  }

  const api = { DEFAULT_SCORING, scoreEpisode, winnerPoints, standings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
