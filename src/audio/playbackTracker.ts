// Tracks which scheduled playback nodes are still audible so the engine can say
// when the coach has ACTUALLY finished speaking. The protocol's turnComplete
// arrives when the model finished generating, which at 0.85× speed or on a long
// sentence can be seconds before the loudspeaker goes quiet — cueing「換你說」on
// that signal makes the learner talk over the coach.
//
// Pure bookkeeping, no Web Audio: `AudioEngine` feeds it node identities and
// their `onended` events, so the maths here is unit-testable and rate-agnostic
// (a slower rate simply delays `ended`).

export class PlaybackTracker<Node> {
  private readonly playing = new Set<Node>();

  constructor(private readonly onDrained: () => void) {}

  scheduled(node: Node): void {
    this.playing.add(node);
  }

  /** A node finished on its own. The LAST one to finish drains the queue. */
  ended(node: Node): void {
    if (!this.playing.delete(node)) return;
    if (this.playing.size === 0) this.onDrained();
  }

  /** Everything was cut off (barge-in / pause / stop). Not a drain: the owner
   *  already knows the turn was aborted and decides the cue itself. Returns the
   *  nodes so the caller can silence them. */
  flush(): Node[] {
    const nodes = [...this.playing];
    this.playing.clear();
    return nodes;
  }

  isPlaying(): boolean {
    return this.playing.size > 0;
  }
}
