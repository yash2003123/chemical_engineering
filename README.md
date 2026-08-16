# ChemE Tutor

A voice tutor you open on your phone and talk to. Your phone connects straight to
OpenAI over WebRTC, so latency is roughly 300 to 500 ms and you can interrupt it
mid-sentence. Vercel only mints a short-lived token, so your API key never
touches the browser.

## Deploy

1. Push this folder to a new GitHub repo.
2. In Vercel, import the repo. Framework detection picks up Next.js on its own.
3. Add one environment variable before the first deploy:
   - `OPENAI_API_KEY` = your key
4. Deploy. Open the URL on your phone, allow the microphone, tap **Start call**.
5. Share sheet, **Add to Home Screen**. It then opens fullscreen like a native app.

Run it locally with `npm install && npm run dev`, after putting your key in a
`.env.local` file (copy `.env.example`).

## Retuning it

Everything about how the tutor behaves lives in `app/prompt.js`. Change
`INSTRUCTIONS` to match your actual courses and it will pitch at your level.
Change `VOICE` if you dislike the default one.

Two settings worth knowing about in `app/api/session/route.js`:

- `silence_duration_ms: 620` is how long you have to pause before it decides you
  are done talking. Raise it to 900 or so if it keeps cutting you off while you
  think. Lower it to 450 if it feels sluggish.
- `whisper-1` handles the transcript. It is only used for the on-screen text, not
  for the conversation itself.

## Cost

Realtime audio is billed per minute of audio in and out, and it is meaningfully
more expensive than text. Budget on the order of a few tens of cents per ten
minute session, but check OpenAI's current pricing page rather than trusting that
number, since it has moved several times. Set a hard spend limit in your OpenAI
account before you put this on your phone. It is very easy to leave a call open
in a background tab.

## If something breaks

**"Could not open a session"** with a 404. OpenAI has renamed the realtime
endpoints before. Both `route.js` and `page.js` already try the current path then
the older one, so a 404 on both means the shape changed again. Check the current
realtime WebRTC docs and update the two URL lists.

**Microphone does nothing on iPhone.** iOS needs HTTPS, which Vercel gives you,
but it will not work over a plain `http://` local address. Test on the deployed
URL, not your laptop's LAN IP.

**You hear nothing but the transcript scrolls.** iOS blocks audio that did not
follow a tap. The call starts from a button press so this should not happen, but
if it does, hang up and start the call again rather than reloading.

**It talks over itself or hears its own voice.** Use headphones. Echo
cancellation is on, but phone speakers at high volume still defeat it.
