// AudioWorklet capture processor: batches mic samples and posts Float32 chunks
// to the main thread (which resamples to 16kHz + converts to PCM16). Loaded via
// audioContext.audioWorklet.addModule('/capture-worklet.js').
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this._buf[this._n++] = channel[i];
      if (this._n >= this._buf.length) {
        this.port.postMessage(this._buf.slice(0, this._n));
        this._n = 0;
      }
    }
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);
