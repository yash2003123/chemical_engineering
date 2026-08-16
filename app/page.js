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

/*
  How long you can pause mid-sentence before it decides you are finished.
  Chemical engineering questions involve a lot of thinking out loud, so the
  default sits deliberately high.
*/
const PACES = [
  { key: "quick", label: "QUICK", ms: 700 },
  { key: "normal", label: "NORMAL", ms: 1500 },
  { key: "patient", label: "PATIENT", ms: 2800 },
];

/*
  Realtime audio bills for however long the mic stays connected, silence
  included, so a call left open unattended quietly racks up cost. Hang up
  automatically once nobody has said anything for this long.
*/
const IDLE_HANGUP_MS = 120_000;

export default function Page() {
  const [phase, setPhase] = useState("idle"); // idle | connecting | live | ended
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [lines, setLines] = useState([]);
  const [secs, setSecs] = useState(0);
  const [pace, setPace] = useState(PACES[1]);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const micRef = useRef(null);
  const audioRef = useRef(null);
  const logRef = useRef(null);
  const partialRef = useRef("");
  const paceRef = useRef(PACES[1]);
  const heldRef = useRef(false);
  const quietErrorsRef = useRef(0); // suppress schema-shape errors from session.update
  const autoMutedRef = useRef(false); // true when muted() was us ducking her voice, not the user
  const lastActivityRef = useRef(Date.now());

  useEffect(() => { paceRef.current = pace; }, [pace]);
  useEffect(() => { heldRef.current = held; }, [held]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (phase !== "live" || held) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase, held]);

  // Auto hang-up on silence, independent of the display timer above so it
  // still counts down while held.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_HANGUP_MS) {
        setError(`Call ended after ${Math.round(IDLE_HANGUP_MS / 60000)} minutes of silence to avoid running up cost.`);
        hangUp();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [phase]);

  // Duck the mic while she's talking so background noise can't barge in;
  // interrupting takes a deliberate tap on UNMUTE.
  useEffect(() => {
    if (phase !== "live" || heldRef.current) return;
    const tr = micRef.current?.getAudioTracks?.()[0];
    if (speaking) {
      if (!muted) {
        setMuted(true);
        if (tr) tr.enabled = false;
        autoMutedRef.current = true;
      }
    } else if (autoMutedRef.current) {
      setMuted(false);
      if (tr) tr.enabled = true;
      autoMutedRef.current = false;
    }
  }, [speaking, phase]);

  /* ---------------- session control ---------------- */

  const bumpActivity = () => { lastActivityRef.current = Date.now(); };

  const send = (obj) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(obj));
  };

  /*
    Turn detection lives at a different path depending on which revision of the
    realtime API your account is on. Rather than guessing, push both shapes and
    let the wrong one bounce. We swallow the resulting complaint so it does not
    show up as a scary red box.
  */
  const applyTurnDetection = (enabled) => {
    const td = enabled
      ? { type: "server_vad", silence_duration_ms: paceRef.current.ms, threshold: 0.5 }
      : null;

    quietErrorsRef.current = 2;
    send({ type: "session.update", session: { audio: { input: { turn_detection: td } } } });
    send({ type: "session.update", session: { turn_detection: td } });
  };

  const hold = () => {
    bumpActivity();
    setHeld(true);
    send({ type: "response.cancel" });        // stop it composing
    send({ type: "output_audio_buffer.clear" }); // stop audio already queued
    applyTurnDetection(false);                // and stop it listening for a cue
    const tr = micRef.current?.getAudioTracks?.()[0];
    if (tr) tr.enabled = false;
    setSpeaking(false);
    setHearing(false);
  };

  const resume = () => {
    bumpActivity();
    setHeld(false);
    applyTurnDetection(true);
    const tr = micRef.current?.getAudioTracks?.()[0];
    if (tr) tr.enabled = !muted;
  };

  const changePace = (p) => {
    bumpActivity();
    setPace(p);
    paceRef.current = p;
    if (phase === "live" && !heldRef.current) applyTurnDetection(true);
  };

  /* ---------------- transcript ---------------- */

  const pushLine = (role, text) => {
    const clean = (text || "").trim();
    if (!clean) return;
    setLines((prev) => [...prev, { role, text: clean, id: Math.random() }]);
  };

  const handleEvent = (ev) => {
    const t = ev.type || "";
    bumpActivity();

    if (t.endsWith("audio_transcript.delta")) {
      partialRef.current += ev.delta || "";
      if (!heldRef.current) setSpeaking(true);
      return;
    }
    if (t.endsWith("audio_transcript.done")) {
      pushLine("tutor", ev.transcript || partialRef.current);
      partialRef.current = "";
      return;
    }
    if (t === "conversation.item.input_audio_transcription.completed") {
      pushLine("you", ev.transcript);
      return;
    }
    if (t === "input_audio_buffer.speech_started") { setHearing(true); setSpeaking(false); return; }
    if (t === "input_audio_buffer.speech_stopped") { setHearing(false); return; }
    if (t === "response.done" || t === "output_audio_buffer.stopped") { setSpeaking(false); return; }
    if (t === "error") {
      if (quietErrorsRef.current > 0) { quietErrorsRef.current -= 1; return; }
      setError(ev.error?.message || "The session hit an error.");
    }
  };

  /* ---------------- connect ---------------- */

  const connect = async (opener) => {
    setError("");
    setPhase("connecting");
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
          audioRef.current.play().catch(() => {});
        }
      };

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micRef.current = mic;
      mic.getTracks().forEach((tr) => pc.addTrack(tr, mic));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch (_) {} };
      dc.onopen = () => {
        applyTurnDetection(true); // push the chosen pace as soon as we can
        if (opener) {
          send({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: opener }] },
          });
          send({ type: "response.create" });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer = await exchangeSdp(offer.sdp);
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      setPhase("live");
      setHeld(false);
      setSecs(0);
      bumpActivity();
    } catch (e) {
      setError(e.message || String(e));
      setPhase("idle");
      teardown();
    }
  };

  /*
    Mint the ephemeral token as late as possible, right before it is used —
    it expires in under a minute, and minting it before the mic permission
    prompt (which can sit open indefinitely) let it go stale before it was
    ever used. Each URL attempt below gets its own freshly minted token
    rather than reusing one across attempts, since a failed attempt can
    burn a single-use token and make the next attempt fail for an unrelated
    reason that also surfaces as "expired".
  */
  async function mintToken() {
    const s = await fetch("/api/session");
    const sd = await s.json();
    if (!s.ok) throw new Error(sd.error || "Session request failed.");
    return sd;
  }

  async function exchangeSdp(sdp) {
    const paths = ["/v1/realtime/calls", "/v1/realtime"];
    const failures = [];
    for (const path of paths) {
      const before = Date.now();
      const { token, model, expiresAt, mintedAt } = await mintToken();
      const mintMs = Date.now() - before;
      const r = await fetch(`https://api.openai.com${path}?model=${encodeURIComponent(model)}`, {
        method: "POST",
        body: sdp,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
      });
      if (r.ok) return await r.text();
      const secsLeft = expiresAt ? (expiresAt * 1000 - Date.now()) / 1000 : "unknown";
      failures.push(
        `${path} -> ${r.status} ${await r.text()} [mint took ${mintMs}ms, minted ${mintedAt ? Date.now() - mintedAt : "?"}ms ago, ${secsLeft}s left on token when used]`
      );
    }
    throw new Error(`Could not reach the voice endpoint. ${failures.join(" | ")}`);
  }

  function teardown() {
    try { dcRef.current?.close(); } catch (_) {}
    try { pcRef.current?.close(); } catch (_) {}
    micRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null; pcRef.current = null; micRef.current = null;
  }

  const hangUp = () => {
    teardown();
    setPhase("ended"); setSpeaking(false); setHearing(false); setHeld(false);
    autoMutedRef.current = false;
  };

  const toggleMute = () => {
    bumpActivity();
    autoMutedRef.current = false; // manual tap always overrides the auto-duck
    const next = !muted;
    setMuted(next);
    const tr = micRef.current?.getAudioTracks?.()[0];
    if (tr && !heldRef.current) tr.enabled = !next;
  };

  useEffect(() => () => teardown(), []);

  /* ---------------- render ---------------- */

  const lamp =
    phase === "connecting" ? { c: C.amber, t: "CONNECTING" } :
    phase !== "live" ? { c: C.rule, t: "STANDBY" } :
    held ? { c: C.amber, t: "HELD" } :
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
          <span style={{ width: 9, height: 9, borderRadius: 99, background: lamp.c, boxShadow: phase === "live" && !held ? `0 0 10px ${lamp.c}` : "none" }} />
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: C.dim }}>{lamp.t}</span>
        </div>
      </header>

      <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: "22px 18px" }}>
        {phase === "idle" && lines.length === 0 && (
          <div style={{ maxWidth: 520 }}>
            <p style={{ color: C.paper, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
              Tap the call button and say what is confusing you. Hold the line whenever you need
              time to read or think, it will wait.
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

      <footer style={{ borderTop: `1px solid ${C.rule}`, background: C.panel, padding: "14px 18px calc(14px + env(safe-area-inset-bottom))" }}>
        {/* Pace selector: how long it waits before assuming you are done */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: C.dim }}>WAIT</span>
          {PACES.map((p) => (
            <button
              key={p.key}
              onClick={() => changePace(p)}
              style={{
                fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", cursor: "pointer",
                padding: "6px 10px",
                color: pace.key === p.key ? C.chassis : C.dim,
                background: pace.key === p.key ? C.cyan : "transparent",
                border: `1px solid ${pace.key === p.key ? C.cyan : C.rule}`,
              }}
            >
              {p.label}
            </button>
          ))}
          {phase === "live" && (
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: C.dim, marginLeft: "auto" }}>
              {mmss}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                onClick={held ? resume : hold}
                style={{
                  flex: 1.4, padding: "16px", fontFamily: MONO, fontSize: 12, letterSpacing: "0.14em", cursor: "pointer",
                  color: held ? C.chassis : C.amber,
                  background: held ? C.amber : "transparent",
                  border: `1px solid ${C.amber}`,
                }}
              >
                {held ? "RESUME" : "HOLD"}
              </button>
              <button
                onClick={toggleMute}
                disabled={held}
                style={{
                  flex: 1, padding: "16px", fontFamily: MONO, fontSize: 12, letterSpacing: "0.14em",
                  cursor: held ? "default" : "pointer", opacity: held ? 0.35 : 1,
                  color: muted ? C.amber : C.paper, background: "transparent",
                  border: `1px solid ${muted ? C.amber : C.rule}`,
                }}
              >
                {muted ? "UNMUTE" : "MUTE"}
              </button>
              <button
                onClick={hangUp}
                style={{ flex: 1, background: "#B4553F", color: C.paper, border: "none", padding: "16px", fontFamily: MONO, fontSize: 12, letterSpacing: "0.14em", cursor: "pointer" }}
              >
                END
              </button>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
