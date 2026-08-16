import { INSTRUCTIONS, VOICE } from "../../prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.REALTIME_MODEL || "gpt-realtime";

/*
  Your OpenAI key stays on Vercel. The phone only ever receives an ephemeral
  token that expires in about a minute, which is long enough to open the
  WebRTC connection and useless to anyone who scrapes it afterwards.

  OpenAI moved this endpoint once already, so we try the current shape first
  and fall back to the older one rather than hard-failing on a 404.
*/

async function mintCurrent(key) {
  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        instructions: INSTRUCTIONS,
        audio: {
          input: {
            transcription: { model: "whisper-1" },
            turn_detection: { type: "server_vad", silence_duration_ms: 1500 },
          },
          output: { voice: VOICE },
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`client_secrets ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.value || d.client_secret?.value;
}

async function mintLegacy(key) {
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "realtime=v1",
    },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      instructions: INSTRUCTIONS,
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: { type: "server_vad", silence_duration_ms: 1500 },
    }),
  });
  if (!r.ok) throw new Error(`sessions ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.client_secret?.value || d.value;
}

export async function GET() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  let token, firstError;
  try {
    token = await mintCurrent(key);
  } catch (e) {
    firstError = e.message;
    try {
      token = await mintLegacy(key);
    } catch (e2) {
      return Response.json(
        { error: `Could not open a session. ${firstError} | ${e2.message}` },
        { status: 502 }
      );
    }
  }

  if (!token) {
    return Response.json({ error: "No token came back from OpenAI." }, { status: 502 });
  }
  return Response.json({ token, model: MODEL });
}
