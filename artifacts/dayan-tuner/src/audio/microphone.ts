export interface MicrophoneFrame {
  samples: Float32Array;
  level: number;
  frequencyData: Uint8Array;
  sampleRate: number;
}

export type MicrophoneFrameHandler = (frame: MicrophoneFrame) => void;

export interface MicrophoneHandle {
  context: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  stop: () => void;
}

export async function startMicrophone(
  onFrame: MicrophoneFrameHandler,
): Promise<MicrophoneHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.18;
  source.connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  const frequencyData = new Uint8Array(analyser.frequencyBinCount);
  let animationFrame = 0;
  let active = true;

  const tick = () => {
    if (!active) {
      return;
    }
    analyser.getFloatTimeDomainData(samples);
    analyser.getByteFrequencyData(frequencyData);
    let sumSquares = 0;
    for (const sample of samples) {
      sumSquares += sample * sample;
    }
    onFrame({
      samples: new Float32Array(samples),
      level: Math.sqrt(sumSquares / samples.length),
      frequencyData: new Uint8Array(frequencyData),
      sampleRate: context.sampleRate,
    });
    animationFrame = requestAnimationFrame(tick);
  };

  await context.resume();
  tick();

  return {
    context,
    stream,
    analyser,
    stop: () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}