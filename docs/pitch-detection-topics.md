# Pitch detection topics to study

The app turns microphone samples into a note estimate in this order:

`microphone frame → RMS level → onset → autocorrelation → candidate lag → frequency → note name / cents`

## Start here

1. **Digital audio fundamentals**
   Look up: *sample rate, audio samples, frame size, Nyquist frequency*. The app samples the microphone at the browser's rate and analyzes 4096-sample frames.

2. **Amplitude and RMS**
   Look up: *root mean square audio amplitude, dBFS, noise floor, signal-to-noise ratio*. RMS is used to decide whether there is enough sound to analyze.

3. **Onset detection**
   Look up: *audio onset detection, attack transient, envelope follower, adaptive threshold, debounce/cooldown*. The detector watches for a level above both a minimum and an adaptive noise-based threshold.

4. **Period and frequency**
   Look up: *frequency period relationship* and `frequency = sample_rate / lag`. Autocorrelation finds the lag where the waveform best resembles a delayed copy of itself.

## Then study the detector's decisions

5. **Autocorrelation pitch detection**
   Look up: *normalized autocorrelation fundamental frequency*. Learn why a repeating waveform produces peaks at its period and at multiples of its period.

6. **Fundamental frequency, harmonics, and partials**
   Look up: *harmonic series, partials, missing fundamental, octave errors*. Tabla spectra can contain strong overtones, so the loudest frequency is not always the perceived pitch.

7. **Candidate scoring and confidence**
   Look up: *classification confidence, score margin, peak prominence*. This app combines the autocorrelation value, repetition agreement, and the gap between the best and second-best candidates.

8. **Parabolic interpolation**
   Look up: *quadratic/parabolic interpolation of a discrete peak*. The best lag is initially an integer; interpolation estimates a fraction between neighboring lag bins for a smoother Hz value.

9. **Robust statistics**
   Look up: *median versus mean, outliers, robust estimator*. Each strike now collects several valid frames and uses their median, so one noisy frame is less likely to cause a wrong note or octave jump.

10. **Windowing and spectral leakage**
    Look up: *Hann window, spectral leakage, FFT window functions*. This is useful if you later add an FFT-based cross-check or spectrum display.

## Useful next-step algorithms

11. **YIN pitch detection**
    Look up: *YIN fundamental frequency algorithm*. It is a strong time-domain alternative that often handles ambiguous periodic signals better than a basic autocorrelation search.

12. **McLeod Pitch Method (MPM)**
    Look up: *McLeod Pitch Method normalized square difference function*. It is another practical monophonic pitch detector with a useful clarity/confidence measure.

13. **FFT-based harmonic methods**
    Look up: *harmonic product spectrum, cepstrum pitch detection, spectral peak interpolation*. These can complement autocorrelation when the tabla's waveform is asymmetric or noisy.

## Understand the displayed note

14. **Equal temperament and MIDI note numbers**
    Look up: *12-tone equal temperament, MIDI note number, A4 440 Hz*. The app converts Hz to the nearest conventional note label using `A4 = 440 Hz`.

15. **Cents and tuning deviation**
    Look up: *cents musical interval*. The app uses `1200 × log2(measured / target)`: positive means sharp, negative means flat.

16. **Tabla acoustics and tuning**
    Look up: *tabla dayan syahi harmonics, tabla tuning, modal frequencies*. This gives the signal-processing numbers musical meaning and helps decide whether one target note is appropriate for every region.

The Python walkthrough is in `pitch_detection_reference.py`. It mirrors the browser code, including the corrected out-of-range harmonic checks and per-strike median aggregation.
