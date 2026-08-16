"use client";

import { useState, useRef, useEffect } from "react";

const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const C = {
  chassis: "#0E1A1E",
  panel: "#14262C",
  rule: "#25454E",
  amber: "#E8A33D",
  cyan: "#5CC5DC",
  green: "#8ED08C",
  paper: "#F2EDE2",
  dim: "#7FA3AC",
};

const TOPICS = [
  "Transport phenomena",
  "Thermodynamics",
  "Reaction engineering",
  "Separations",
  "Process control",
];

export default function Page() {
  const [phase, setPhase] = useState("idle"); // idle | connecting | live | ended
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false); // tutor is talking
  const [hearing, setHearing] = useState(false); // student is talking
  const [lines, setLines] = useState([]);
  const [secs, setSecs] = useState(0);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const micRef = useRef(null);
  const audioRef = useRef(null);
  const logRef = useRef(null);
  const partialRef = useRef("");

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  /* ---------------- transcript plumbing ---------------- */

  const pushLine = (role, text) => {
    const clean = (text || "").trim();
    if (!clean) return;
    setLines((prev) => [...prev, { role, text: clean, id: Math.random() }]);
  };

  const handleEvent = (ev) => {
    const t = ev.type || "";

    // The tutor's speech, streamed as text alongside the audio.
    if (t.endsWith("audio_transcript.delta")) {
      partialRef.current += ev.delta || "";
      setSpeaking(true);
      return;
    }
    if (t.endsWith("audio_transcript.done")) {
      pushLine("tutor", ev.transcript || partialRef.current);
      partialRef.current = "";
      return;
    }

    // What you said, transcribed after the fact.
    if (t === "conversation.item.input_audio_transcription.completed") {
      pushLine("you", ev.transcript);
      return;
    }

    if (t === "input_audio_buffer.speech_started") { setHearing(true); setSpeaking(false); return; }
    if (t === "input_audio_buffer.speech_stopped") { setHearing(false); return; }
    if (t === "response.done" || t === "output_audio_buffer.stopped") { setSpeaking(false); return; }
    if (t === "error") { setError(ev.error?.message || "The session hit an error."); }
  };

  /* ---------------- connect ---------------- */

  const connect = async (opener) => {
    setError("");
    setPhase("connecting");
    try {
      const s = await fetch("/api/session");
      const sd = await s.json();
      if (!s.ok) throw new Error(sd.error || "Session request failed.");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Tutor's voice arrives on this track.
      pc.ontrack = (e) => {
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
          audioRef.current.play().catch(() => {});
        }
      };

      // Your microphone goes the other way.
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micRef.current = mic;
      mic.getTracks().forEach((tr) => pc.addTrack(tr, mic));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => {
        try { handleEvent(JSON.parse(e.data)); } catch (_) {}
      };
      dc.onopen = () => {
        if (opener) {
          dc.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: opener }],
            },
          }));
          dc.send(JSON.stringify({ type: "response.create" }));
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer = await exchangeSdp(offer.sdp, sd.token, sd.model);
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      setPhase("live");
      setSecs(0);
    } catch (e) {
      setError(e.message || String(e));
      setPhase("idle");
      teardown();
    }
  };

  // OpenAI renamed this path once, so try the current one then the old one.
  async function exchangeSdp(sdp, token, model) {
    const urls = [
      `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    ];
    let last = "";
    for (const url of urls) {
      const r = await fetch(url, {
        method: "POST",
        body: sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
        },
      });
      if (r.ok) return await r.text();
      last = `${r.status} ${await r.text()}`;
    }
    throw new Error(`Could not reach the voice endpoint. ${last}`);
  }

  function teardown() {
    try { dcRef.current?.close(); } catch (_) {}
    try { pcRef.current?.close(); } catch (_) {}
    micRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null; pcRef.current = null; micRef.current = null;
  }

  const hangUp = () => { teardown(); setPhase("ended"); setSpeaking(false); setHearing(false); };

  const toggleMute = () => {
    const tr = micRef.current?.getAudioTracks?.()[0];
    if (!tr) return;
    tr.enabled = !tr.enabled;
    setMuted(!tr.enabled);
  };

  useEffect(() => () => teardown(), []);

  /* ---------------- render ---------------- */

  const lamp =
    phase === "connecting" ? { c: C.amber, t: "CONNECTING" } :
    phase !== "live" ? { c: C.rule, t: "STANDBY" } :
    speaking ? { c: C.green, t: "TUTOR SPEAKING" } :
    hearing ? { c: C.cyan, t: "LISTENING" } :
    { c: C.cyan, t: "ON CALL" };

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <main style={{ minHeight: "100dvh", background: C.chassis, display: "flex", flexDirection: "column" }}>
      <audio ref={audioRef} autoPlay playsInline />

      <header style={{ padding: "14px 18px", borderBottom: `1px solid ${C.rule}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.22em", color: C.dim }}>OFFICE HOURS</div>
          <div style={{ color: C.paper, fontSize: 17, fontWeight: 600 }}>Chemical Engineering Tutor</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: lamp.c, boxShadow: phase === "live" ? `0 0 10px ${lamp.c}` : "none" }} />
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: C.dim }}>{lamp.t}</span>
        </div>
      </header>

      <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: "22px 18px" }}>
        {phase === "idle" && lines.length === 0 && (
          <div style={{ maxWidth: 520 }}>
            <p style={{ color: C.paper, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
              Tap the call button and say what is confusing you. It interrupts and gets interrupted,
              so talk over it whenever you want.
            </p>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color: C.dim, marginTop: 26 }}>
              OR OPEN ON A TOPIC
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {TOPICS.map((t) => (
                <button
                  key={t}
                  onClick={() => connect(`I want to work on ${t.toLowerCase()}. Ask me one question to find out where I am.`)}
                  style={{ fontFamily: MONO, fontSize: 11, color: C.paper, background: C.panel, border: `1px solid ${C.rule}`, padding: "8px 12px", cursor: "pointer" }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.amber, border: `1px solid ${C.amber}`, padding: "10px 12px", marginBottom: 18, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
          {lines.map((l) => (
            <div key={l.id} style={{ paddingLeft: 12, borderLeft: `2px solid ${l.role === "you" ? C.cyan : C.amber}` }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color: l.role === "you" ? C.cyan : C.amber }}>
                {l.role === "you" ? "YOU" : "TUTOR"}
              </div>
              <div style={{ color: C.paper, fontSize: 15.5, lineHeight: 1.6, marginTop: 4 }}>{l.text}</div>
            </div>
          ))}
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${C.rule}`, background: C.panel, padding: "16px 18px calc(16px + env(safe-area-inset-bottom))" }}>
        {phase === "live" && (
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: C.dim, marginBottom: 12 }}>
            {mmss} ELAPSED
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {phase !== "live" ? (
            <button
              onClick={() => connect(null)}
              disabled={phase === "connecting"}
              style={{ flex: 1, background: C.green, color: C.chassis, border: "none", padding: "16px", fontFamily: MONO, fontSize: 12, letterSpacing: "0.18em", cursor: "pointer" }}
            >
              {phase === "connecting" ? "OPENING LINE..." : phase === "ended" ? "CALL AGAIN" : "START CALL"}
            </button>
          ) : (
            <>
              <button
                onClick={toggleMute}
                style={{ flex: 1, background: "transparent", color: muted ? C.amber : C.paper, border: `1px solid ${muted ? C.amber : C.rule}`, padding: "16px", fontFamily: MONO, fontSize: 12, letterSpacing: "0.16em", cursor: "pointer" }}
              >
                {muted ? "UNMUTE" : "MUTE"}
              </button>
              <button
                onClick={hangUp}
                style={{ flex: 1, background: "#B4553F", color: C.paper, border: "none", padding: "16px", fontFamily: MONO, fontSize: 12, letterSpacing: "0.16em", cursor: "pointer" }}
              >
                HANG UP
              </button>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
