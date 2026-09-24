import { describe, expect, it, vi } from "vitest";

import type { LiveSendRealtimeInputParameters, LiveServerMessage } from "@google/genai";
import {
  GeminiLiveDirect,
  type GeminiDirectHandlers,
  type LiveConnectRequest,
  type LiveConnector,
  type LiveSocket,
} from "./gemini-direct";

// Stand-in at the ONE injection boundary the transport has: the SDK socket.
// It records what was sent and lets a test play server messages / closes.
class FakeSocket implements LiveSocket {
  readonly sent: LiveSendRealtimeInputParameters[] = [];
  closed = false;
  constructor(readonly req: LiveConnectRequest) {}
  sendRealtimeInput(input: LiveSendRealtimeInputParameters): void {
    this.sent.push(input);
  }
  close(): void {
    this.closed = true;
  }
  /** Server → client. Plain objects stand in for the SDK's message class. */
  serverSays(m: Record<string, unknown>): void {
    this.req.callbacks.onmessage(m as unknown as LiveServerMessage);
  }
  serverCloses(reason = "closed"): void {
    this.req.callbacks.onclose?.({ reason } as CloseEvent);
  }
}

function harness(handlerOverrides: Partial<GeminiDirectHandlers> = {}) {
  const sockets: FakeSocket[] = [];
  const pending: Array<(s: FakeSocket) => void> = [];
  let holdNext = false;
  let failNext: Error | null = null;
  const connector: LiveConnector = (req) => {
    if (failNext) {
      const e = failNext;
      failNext = null;
      return Promise.reject(e);
    }
    const s = new FakeSocket(req);
    sockets.push(s);
    if (holdNext) {
      holdNext = false;
      return new Promise<LiveSocket>((resolve) => pending.push(() => resolve(s)));
    }
    return Promise.resolve(s);
  };
  const handlers: GeminiDirectHandlers = {
    onAudio: vi.fn(),
    onUserTranscript: vi.fn(),
    onAssistantTranscript: vi.fn(),
    onInterrupted: vi.fn(),
    onTurnState: vi.fn(),
    onOpen: vi.fn(),
    onReconnecting: vi.fn(),
    onResumed: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
    ...handlerOverrides,
  };
  const client = new GeminiLiveDirect({
    apiKey: "unused-in-tests",
    model: "any-live-model",
    systemInstruction: "sys",
    handlers,
    connector,
    handoverTimeoutMs: 30,
  });
  return {
    client,
    handlers,
    sockets,
    holdNextConnect: () => (holdNext = true),
    releaseHeld: () => pending.splice(0).forEach((r) => r(sockets[sockets.length - 1])),
    failNextConnect: (e: Error) => (failNext = e),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("GeminiLiveDirect — setup config", () => {
  it("asks for context-window compression, proactive audio and affective dialog by default", async () => {
    const h = harness();
    await h.client.connect();
    const cfg = h.sockets[0].req.config;
    expect(cfg.contextWindowCompression).toEqual({ slidingWindow: {} });
    expect(cfg.proactivity).toEqual({ proactiveAudio: true });
    expect(cfg.enableAffectiveDialog).toBe(true);
    expect(cfg.sessionResumption).toEqual({});
  });

  it("each feature is an independent flag", async () => {
    const h = harness();
    const seen: LiveConnectRequest[] = [];
    const client = new GeminiLiveDirect({
      apiKey: "unused",
      model: "m",
      systemInstruction: "s",
      features: { proactiveAudio: false, affectiveDialog: true },
      handlers: h.handlers,
      connector: (req) => {
        seen.push(req);
        return Promise.resolve(new FakeSocket(req));
      },
    });
    await client.connect();
    expect(seen[0].config.proactivity).toEqual({ proactiveAudio: false });
    expect(seen[0].config.enableAffectiveDialog).toBe(true);
  });
});

describe("GeminiLiveDirect — GoAway hand-over", () => {
  it("reconnects once with the issued resumption handle; old socket's late events are ignored", async () => {
    const h = harness();
    await h.client.connect();
    const first = h.sockets[0];
    first.serverSays({ setupComplete: {} });
    first.serverSays({ sessionResumptionUpdate: { resumable: true, newHandle: "h-1" } });

    first.serverSays({ goAway: { timeLeft: "5s" } });
    expect(h.handlers.onReconnecting).toHaveBeenCalledTimes(1);
    await flush();

    expect(h.sockets).toHaveLength(2);
    expect(first.closed).toBe(true);
    expect(h.sockets[1].req.config.sessionResumption).toEqual({ handle: "h-1" });
    expect(h.handlers.onResumed).toHaveBeenCalledWith(true);
    expect(h.handlers.onClose).not.toHaveBeenCalled();

    // The retired socket finally closes on the server side, and a stray message
    // arrives on it: neither may reach the session.
    first.serverCloses("aborted");
    first.serverSays({ serverContent: { inputTranscription: { text: "ghost" } } });
    expect(h.handlers.onClose).not.toHaveBeenCalled();
    expect(h.handlers.onUserTranscript).not.toHaveBeenCalled();
    expect(h.client.isOpen()).toBe(true);
  });

  it("a GoAway mid coach turn closes that turn like a barge-in (its turnComplete will never come)", async () => {
    const h = harness();
    await h.client.connect();
    h.sockets[0].serverSays({ data: "AAAA" }); // coach speaking
    h.sockets[0].serverSays({ goAway: {} });
    expect(h.handlers.onInterrupted).toHaveBeenCalledTimes(1);
    expect((h.handlers.onTurnState as ReturnType<typeof vi.fn>).mock.calls).toEqual([["coach"], ["you"]]);
    await flush();
    // the resumed socket's first audio is a NEW turn
    h.sockets[1].serverSays({ data: "AAAA" });
    expect((h.handlers.onTurnState as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual(["coach"]);
  });

  it("buffers mic audio during the hand-over and flushes it once the new socket is ready", async () => {
    const h = harness();
    await h.client.connect();
    h.sockets[0].serverSays({ setupComplete: {} });
    h.holdNextConnect();
    h.sockets[0].serverSays({ goAway: {} });
    h.client.sendAudio(new Uint8Array([1, 2]).buffer);
    h.client.sendAudio(new Uint8Array([3, 4]).buffer);
    h.releaseHeld();
    await flush();
    const second = h.sockets[1];
    expect(second.sent).toHaveLength(0); // not before setupComplete
    second.serverSays({ setupComplete: {} });
    expect(second.sent.map((s) => s.audio?.data)).toEqual(["AQI=", "AwQ="]);
  });

  it("a failed hand-over reports onClose exactly once and does not retry", async () => {
    const h = harness();
    await h.client.connect();
    h.failNextConnect(new Error("resume refused"));
    h.sockets[0].serverSays({ goAway: {} });
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.handlers.onResumed).not.toHaveBeenCalled();
    expect(h.handlers.onClose).toHaveBeenCalledTimes(1);
    expect(h.handlers.onClose).toHaveBeenCalledWith("resume refused");
    expect(h.client.isOpen()).toBe(false);
  });

  it("a hand-over that hangs times out into the failed path; the socket that opens later is closed, not adopted", async () => {
    const h = harness();
    await h.client.connect();
    h.holdNextConnect();
    h.sockets[0].serverSays({ goAway: {} });
    await new Promise((r) => setTimeout(r, 60)); // past the 30 ms test deadline
    expect(h.handlers.onClose).toHaveBeenCalledTimes(1);
    expect(h.handlers.onClose).toHaveBeenCalledWith("重新連線逾時");
    expect(h.client.isOpen()).toBe(false);
    h.releaseHeld();
    await flush();
    expect(h.sockets[1].closed).toBe(true);
    expect(h.handlers.onResumed).not.toHaveBeenCalled();
  });

  it("a second GoAway on the resumed socket uses the newest handle", async () => {
    const h = harness();
    await h.client.connect();
    h.sockets[0].serverSays({ sessionResumptionUpdate: { resumable: true, newHandle: "h-1" } });
    h.sockets[0].serverSays({ goAway: {} });
    await flush();
    h.sockets[1].serverSays({ sessionResumptionUpdate: { resumable: true, newHandle: "h-2" } });
    h.sockets[1].serverSays({ goAway: {} });
    await flush();
    expect(h.sockets[2].req.config.sessionResumption).toEqual({ handle: "h-2" });
    expect(h.sockets[1].closed).toBe(true);
  });

  it("mic audio buffered before setupComplete is capped, dropping the oldest", async () => {
    const h = harness();
    await h.client.connect();
    const chunk = () => new ArrayBuffer(100_000);
    for (let i = 0; i < 5; i++) h.client.sendAudio(chunk());
    h.sockets[0].serverSays({ setupComplete: {} });
    expect(h.sockets[0].sent.filter((s) => s.audio)).toHaveLength(3); // 3 × 100 KB ≤ 320 KB
  });

  it("onResumed(false) when the server never issued a handle (conversation restarts)", async () => {
    const h = harness();
    await h.client.connect();
    h.sockets[0].serverSays({ goAway: {} });
    await flush();
    expect(h.handlers.onResumed).toHaveBeenCalledWith(false);
  });
});

describe("GeminiLiveDirect — user Stop wins over GoAway", () => {
  it("a GoAway that lands after close() does not open a new socket", async () => {
    const h = harness();
    await h.client.connect();
    const first = h.sockets[0];
    h.client.close();
    first.serverSays({ goAway: {} });
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.handlers.onReconnecting).not.toHaveBeenCalled();
  });

  it("close() during an in-flight hand-over closes the new socket instead of adopting it", async () => {
    const h = harness();
    await h.client.connect();
    h.holdNextConnect();
    h.sockets[0].serverSays({ goAway: {} });
    h.client.close(); // user stopped while reconnecting
    h.releaseHeld();
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1].closed).toBe(true);
    expect(h.handlers.onResumed).not.toHaveBeenCalled();
    expect(h.client.isOpen()).toBe(false);
  });

  it("the server's onclose after a user close() is silent — a Stop is not a「連線中斷」", async () => {
    const h = harness();
    await h.client.connect();
    const first = h.sockets[0];
    h.client.close();
    expect(first.sent.at(-1)).toEqual({ audioStreamEnd: true });
    first.serverCloses();
    expect(h.handlers.onClose).not.toHaveBeenCalled();
  });

  it("audio buffered before setupComplete is discarded by close(), not sent to a closed socket", async () => {
    const h = harness();
    await h.client.connect();
    h.client.sendAudio(new Uint8Array([1]).buffer);
    h.client.close();
    h.sockets[0].serverSays({ setupComplete: {} }); // late, on the closed socket
    expect(h.sockets[0].sent).toEqual([{ audioStreamEnd: true }]);
  });

  it("close() during the initial connect closes the socket that arrives late", async () => {
    const h = harness();
    h.holdNextConnect();
    const connecting = h.client.connect();
    h.client.close();
    h.releaseHeld();
    await connecting;
    expect(h.sockets[0].closed).toBe(true);
    expect(h.client.isOpen()).toBe(false);
  });
});

describe("GeminiLiveDirect — protocol turn state", () => {
  it("audio + turnComplete in one message: coach, then you (protocol level; drain is the owner's job)", async () => {
    const h = harness();
    await h.client.connect();
    h.sockets[0].serverSays({ data: "AAAA", serverContent: { turnComplete: true } });
    expect((h.handlers.onTurnState as ReturnType<typeof vi.fn>).mock.calls).toEqual([["coach"], ["you"]]);
    expect(h.handlers.onAudio).toHaveBeenCalledTimes(1);
  });

  it("interrupted flushes and hands the turn over immediately", async () => {
    const h = harness();
    await h.client.connect();
    h.sockets[0].serverSays({ data: "AAAA" });
    h.sockets[0].serverSays({ serverContent: { interrupted: true } });
    expect(h.handlers.onInterrupted).toHaveBeenCalledTimes(1);
    expect((h.handlers.onTurnState as ReturnType<typeof vi.fn>).mock.calls).toEqual([["coach"], ["you"]]);
  });
});
