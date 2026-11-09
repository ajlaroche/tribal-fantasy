# Tribal Fantasy

A weekly pick'em fantasy league for the rest of this Survivor season. Friends play with a **name + 4-digit PIN**, so nobody needs an account. Only you, the commissioner, have a login.

Built as a quick concept test before a full app next season: a static page (HTML/CSS/JS, no build step) with a free [Supabase](https://supabase.com) Postgres database.

## How the game works
Each episode, every player picks:
- **Who gets voted out**: +5
- **Who wins immunity** (a tribe before the merge, a person after): +3
- **Will an idol be played?** (yes/no): +2
- **A "safe" castaway who survives**: +1 (you can't pick the same person two weeks in a row)

There's also a season-long **Sole Survivor** pick worth +15, minus 1 for each time you change it (never less than 5). You can change all point values in the Commissioner tab, and the whole season re-scores instantly.

Picks lock at the time you set for each episode, and the server enforces it. Everyone's picks are revealed once an episode locks.

## Try it locally (demo mode)
```bash
node dev-server.js
```
Open http://localhost:5173. While `config.js` is empty, the app runs a fake demo league saved only in your browser. The join code is `ISLAND` and the sample players are Sam / 1111 and Jordan / 2222. In demo mode you're automatically the commissioner.

Run the scoring tests:
```bash
node scoring.test.js
```

## Go live (about 15 minutes)
1. **Create a Supabase project** at supabase.com (free tier).
2. **Create the database:** in Supabase go to SQL Editor → New query, paste all of `supabase/schema.sql`, and click Run.
3. **Create your commissioner login:** go to Authentication → Users → Add user → Create new user. Use your email and a password, and tick "Auto confirm".
4. **Make yourself commissioner:** in the SQL Editor, run this with your email:
   ```sql
   update league set admin_uid = (select id from auth.users where email = 'you@example.com') where id = 1;
   ```
5. **Connect the page:** go to Project Settings → API, then copy the Project URL and the `anon` public key into `config.js`.
6. **Set it up:** open the site, click **Commissioner sign-in** at the bottom, then add the cast, add the next episode with its lock time, and set a **join code**.
7. **Put it online for free:** push this folder to a GitHub repo, then go to Settings → Pages → Deploy from branch → `main` / root. Share the URL and join code with your friends.

## Weekly routine
1. Before the episode, make sure the next episode exists with the right lock time. For example, a Wednesday 8pm episode.
2. After it airs, go to Commissioner → Episodes → **Enter results**. Tick who went out, who won immunity, and whether an idol was played, then click Save. The standings update immediately.
3. At the merge, tick **Tribes have merged** so immunity picks switch to individuals.
4. At the finale, set the winner's status to `winner` to award the Sole Survivor points.

## Files
| File | What it does |
|---|---|
| `index.html`, `styles.css` | Page shell and styling (light and dark) |
| `app.js` | All the screens and buttons |
| `api.js` | Talks to Supabase, plus the built-in demo backend |
| `scoring.js` | Scoring rules as pure functions (tested by `scoring.test.js`) |
| `config.js` | Your Supabase URL and anon key |
| `supabase/schema.sql` | Tables, security rules, and PIN-checked functions |

## Security notes
- The anon key is meant to be public. Row Level Security blocks everything except what `schema.sql` allows.
- PINs and the join code are stored as bcrypt hashes. Players can only save picks through server functions that check the PIN and the lock time.
- A 4-digit PIN is fine among friends, but it isn't bank-grade security. The full app planned for next season will use real accounts.
- This is a fan project and isn't affiliated with CBS or Survivor. Don't add network logos or official cast photos.
