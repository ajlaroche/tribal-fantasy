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

  // ---- castaway profiles (spoiler-free: infobox basics + the pre-season "Profile" Q&A only)
  // Turn wiki markup into plain text.
  function plain(s) {
    let t = String(s || '');
    t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
    for (let i = 0; i < 5; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');   // templates, innermost first
    t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')               // [[Page|Text]] -> Text
         .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')                   // [url text] -> text
         .replace(/'''|''/g, '')
         .replace(/<br\s*\/?>/gi, '\n')
         .replace(/<[^>]+>/g, '')
         .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    return t.replace(/[ \t]+/g, ' ').trim();
  }

  function ageFrom(birth) {
    const m = String(birth || '').match(/Birth date and age\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i);
    if (!m) return null;
    const b = new Date(+m[1], +m[2] - 1, +m[3]), now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age--;
    return age;
  }

  const profileCache = {};
  async function castawayProfile(name) {
    if (profileCache[name]) return profileCache[name];
    const j = await call({ action: 'parse', page: name, prop: 'wikitext', redirects: '1' });
    if (j.error || !j.parse) throw new Error(`The Survivor Wiki has no page for ${name}.`);
    const src = j.parse.wikitext;
    const title = j.parse.title;

    // Infobox fields: "| key = value" lines inside {{Contestant ... }}
    const box = (src.match(/\{\{Contestant([\s\S]*?)\n\}\}/) || [])[1] || '';
    const field = k => (box.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^\\n]*)`)) || [])[1] || '';

    // Profile section only (stops at the next heading, so nothing about how the season goes).
    const prof = (src.match(/==\s*Profile\s*==\n([\s\S]*?)(?=\n==[^=])/) || [])[1] || '';
    const source = plain((prof.match(/^''(Retrieved from[^']*)''/m) || [])[1] || '');
    const qa = [];
    for (const line of prof.split('\n')) {
      const m = line.match(/^'''(.+?):?'''\s*(.*)$/);
      if (!m) continue;
      const q = plain(m[1]).replace(/:$/, ''), a = plain(m[2]);
      if (q && a) qa.push({ q, a });
    }
    const pick = q => qa.find(x => x.q.toLowerCase() === q)?.a;

    const out = {
      title,
      url: 'https://survivor.fandom.com/wiki/' + encodeURIComponent(title.replace(/ /g, '_')),
      age: ageFrom(field('birthdate')) ?? (pick('age') ? Number(pick('age')) : null),
      hometown: plain(field('hometown')) || pick('hometown') || null,
      occupation: plain(field('occupation')) || pick('occupation') || null,
      source,
      // Skip the basics already shown above the Q&A.
      qa: qa.filter(x => !['age', 'birthdate', 'hometown', 'current residence', 'occupation', 'name'].includes(x.q.toLowerCase())),
      residence: pick('current residence') || null,
    };
    profileCache[name] = out;
    return out;
  }

  window.Wiki = { episodes, nextEpisode, lockAt, castawayProfile };
})();
