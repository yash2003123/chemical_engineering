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

// How long the ephemeral token stays valid. OpenAI's default (when this is
// omitted) has been too short in practice, so we ask for a generous window
// explicitly rather than racing the network.
const EXPIRES_AFTER_SECONDS = 600;

async function mintCurrent(key) {
  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: EXPIRES_AFTER_SECONDS },
      session: {
        type: "realtime",
        model: MODEL,
        instructions: INSTRUCTIONS,
        audio: {
          input: {
            turn_detection: { type: "server_vad", silence_duration_ms: 620 },
          },
          output: { voice: VOICE },
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`client_secrets ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return { token: d.value || d.client_secret?.value, expiresAt: d.expires_at ?? d.client_secret?.expires_at };
}

async function mintLegacy(key) {
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "realtime=v1",
    },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      instructions: INSTRUCTIONS,
      turn_detection: { type: "server_vad", silence_duration_ms: 620 },
    }),
  });
  if (!r.ok) throw new Error(`sessions ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return { token: d.client_secret?.value || d.value, expiresAt: d.client_secret?.expires_at };
}

export async function GET() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  const mintedAt = Date.now();
  let result, firstError;
  try {
    result = await mintCurrent(key);
  } catch (e) {
    firstError = e.message;
    try {
      result = await mintLegacy(key);
    } catch (e2) {
      return Response.json(
        { error: `Could not open a session. ${firstError} | ${e2.message}` },
        { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }
  }

  if (!result?.token) {
    return Response.json(
      { error: "No token came back from OpenAI." },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
  return Response.json(
    { token: result.token, model: MODEL, expiresAt: result.expiresAt ?? null, mintedAt },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
