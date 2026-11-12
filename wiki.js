// Looks up a season's episode guide on the Survivor wiki (survivor.fandom.com) from the browser.
// Used by the Commissioner tab's "Look up next episode" button.
(function () {
  const API = 'https://survivor.fandom.com/api.php';

  async function call(params) {
    const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`The wiki didn't respond (${r.status}). Try again in a minute.`);
    return r.json();
  }

  // Picks lock at `hour` (default 8pm) Eastern on the air date. Returns a UTC ISO string.
  function lockAt(airDate, hour = 20) {
    const d = new Date(airDate + ' 12:00 UTC');
    const guess = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
    const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(guess)).find(p => p.type === 'timeZoneName').value; // "GMT-5"
    return new Date(guess - Number(tz.replace('GMT', '') || 0) * 36e5).toISOString();
  }

  // All episodes the wiki lists with an air date: [{number, title, airDate, lock_at}]
  async function episodes(season) {
    const src = (await call({ action: 'parse', page: `Template:S${season}epguide`, prop: 'wikitext' })).parse?.wikitext;
    if (!src) throw new Error(`Couldn't find the Season ${season} episode guide on the wiki.`);
    const found = [];
    const re = new RegExp(String.raw`\{\{Ep\|${season}(\d\d)\}\}[^\n]*\n\|[^\n]*?([A-Z][a-z]+ \d{1,2}, \d{4})`, 'g');
    for (const m of src.matchAll(re)) found.push({ number: Number(m[1]), code: season + m[1], airDate: m[2] });
    if (!found.length) return [];

    // Titles: {{Ep|5108}} expands to a link to the episode's page.
    const exp = (await call({ action: 'expandtemplates', prop: 'wikitext',
      text: found.map(e => `${e.code}=={{Ep|${e.code}}}`).join('\n') })).expandtemplates.wikitext;
    for (const line of exp.split('\n')) {
      const [code, rest = ''] = line.split('==');
      const t = rest.match(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/)?.[1]?.replace(/^"|"$/g, '').trim();
      const ep = found.find(e => e.code === code);
      if (ep && t && !/^(TBA|TBD)$/i.test(t)) ep.title = t;
    }
    return found.map(e => ({ number: e.number, title: e.title || null, airDate: e.airDate, lock_at: lockAt(e.airDate) }));
  }

  // The first episode after `latest` that the wiki has listed, or null if it isn't up yet.
  async function nextEpisode(season, latest) {
    return (await episodes(season)).filter(e => e.number > latest).sort((a, b) => a.number - b.number)[0] || null;
  }

  window.Wiki = { episodes, nextEpisode, lockAt };
})();
