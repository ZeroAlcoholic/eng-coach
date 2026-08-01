// D1 — minimal shadowing (跟讀): the coach modelled a phrase, you say it back,
// then you flip between the two clips.
//
// Deliberately NOT here (ROADMAP's line for D1): no score, no percentage, no
// "how close were you" analysis, no pitch curve. Self-comparison IS the
// mechanism — hearing your own clip against the model is what fixes prosody, and
// a number would only invite gaming it.
//
// Only offered while the session is PAUSED. That is not incidental: while live,
// the mic streams to Gemini, so a shadowing attempt would be heard as a
// conversational turn and the coach would answer it. Paused, the mic is released,
// so this takes a short-lived stream of its own and nothing reaches the model.
//
// A/B replay is two big buttons rather than <audio controls>: one tap each, which
// is what this app is for (phone in a pocket, hands on a wheel).

import { useEffect, useMemo, useRef, useState } from "react";

import { encodeWav } from "../../audio/pcm";
import type { CoachClip } from "../../audio/AudioEngine";
import { describeError } from "../../kernel/errors";

type Side = "coach" | "mine";

export function Shadowing(props: { clip: CoachClip | null }) {
  const [recording, setRecording] = useState(false);
  const [mine, setMine] = useState<string | null>(null); // object URL of my clip
  const [playing, setPlaying] = useState<Side | null>(null);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mineUrlRef = useRef<string | null>(null);

  // Derived from the clip, not stored: a newer coach turn simply re-encodes.
  const coachUrl = useMemo(
    () =>
      props.clip
        ? URL.createObjectURL(
            new Blob([encodeWav(props.clip.samples, props.clip.sampleRate)], { type: "audio/wav" }),
          )
        : null,
    [props.clip],
  );
  useEffect(() => (coachUrl ? () => URL.revokeObjectURL(coachUrl) : undefined), [coachUrl]);

  // Release the mic, stop playback and free my clip if the screen goes away.
  // Tapping ▶ 接續 mid-recording unmounts this, so the recorder must be silenced
  // FIRST — otherwise its onstop fires after cleanup and mints an object URL that
  // nothing will ever revoke.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        recorder.onerror = null;
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          /* already torn down */
        }
      }
      stopPlayback();
      stopTracks();
      if (mineUrlRef.current) URL.revokeObjectURL(mineUrlRef.current);
    },
    [],
  );

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function stopPlayback() {
    audioRef.current?.pause();
    audioRef.current = null;
  }

  function play(side: Side) {
    const url = side === "coach" ? coachUrl : mine;
    if (!url) return;
    if (playing === side) {
      stopPlayback();
      setPlaying(null);
      return;
    }
    stopPlayback(); // A/B: only one side is ever audible
    const audio = new Audio(url);
    audio.onended = () => setPlaying(null);
    audio.onerror = () => {
      setPlaying(null);
      setError("這段音訊播不出來。");
    };
    audioRef.current = audio;
    setPlaying(side);
    void audio.play().catch((err) => {
      setPlaying(null);
      setError(describeError(err));
    });
  }

  async function record() {
    if (recording) return;
    setError("");
    stopPlayback();
    setPlaying(null);
    try {
      // A stream of its own, released the moment recording stops — the mic light
      // must not stay on after a 跟讀 attempt.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stopTracks();
        setRecording(false);
        // A muted mic or a hardware mute switch yields zero bytes. That must not
        // masquerade as a take — otherwise the learner only finds out on playback,
        // and the message would blame the audio instead of the recording.
        if (!chunks.reduce((n, c) => n + c.size, 0)) {
          setError("沒有錄到聲音 — 確認麥克風沒有被靜音，再按「換我說」。");
          return;
        }
        if (mineUrlRef.current) URL.revokeObjectURL(mineUrlRef.current);
        const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
        mineUrlRef.current = url;
        setMine(url);
      };
      // Without this, a device that dies mid-recording (headset unplugged, OS takes
      // the mic) never fires onstop: the button would stay 「■ 錄完了」 forever and
      // the mic would stay open with nothing said about it.
      recorder.onerror = (event) => {
        stopTracks();
        setRecording(false);
        setError(describeError((event as unknown as { error?: unknown }).error ?? event));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      stopTracks();
      setRecording(false);
      setError(describeError(err));
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    try {
      recorder?.stop();
    } catch (err) {
      // stop() on an already-failed recorder throws InvalidStateError; that would
      // escape a sync click handler and leave the UI stuck with no message.
      stopTracks();
      setRecording(false);
      setError(describeError(err));
    }
  }

  if (!props.clip) {
    return (
      <div className="card" style={{ marginTop: 8, width: "100%" }}>
        <b>🔁 跟讀</b>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          等教練說完一句，就可以在這裡跟著說一次，然後兩段來回比對。
        </p>
      </div>
    );
  }

  const label = (side: Side, text: string) => (playing === side ? "■ 停" : `▶ ${text}`);

  return (
    <div className="card" style={{ marginTop: 8, width: "100%" }}>
      <b>🔁 跟讀</b>
      <p className="muted" style={{ margin: "6px 0 10px" }}>
        聽教練剛才那句，跟著說一次，再左右對照。這裡不打分數，只讓你自己聽出差別。
      </p>
      <div className="row">
        {recording ? (
          <button className="btn btn--danger grow" onClick={stopRecording}>
            ■ 錄完了
          </button>
        ) : (
          <button className="btn btn--primary grow" onClick={record}>
            ● {mine ? "重錄一次" : "換我說"}
          </button>
        )}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn--ghost grow" onClick={() => play("coach")} disabled={recording}>
          {label("coach", "教練的")}
        </button>
        <button
          className="btn btn--ghost grow"
          onClick={() => play("mine")}
          disabled={recording || !mine}
        >
          {label("mine", "我的")}
        </button>
      </div>
      {!mine && !error && (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          還沒錄你的版本 — 按「換我說」。
        </p>
      )}
      {error && <p className="notice">跟讀失敗：{error}</p>}
    </div>
  );
}
