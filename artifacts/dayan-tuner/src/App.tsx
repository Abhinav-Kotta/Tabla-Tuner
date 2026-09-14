import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Activity,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Gauge,
  Info,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Upload,
  Waves,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { centsDifference, formatCents, frequencyToNoteName, noteNameToFrequency, SUPPORTED_NOTES, tuningStatus, type TuningStatus } from './audio/musicTheory';
import { OnsetDetector } from './audio/onsetDetection';
import { startMicrophone, type MicrophoneHandle } from './audio/microphone';
import { estimatePitch } from './audio/pitchDetection';
import { median } from './audio/signalUtils';
import { PhotoAlignment, type PhotoSetupStep } from './components/photo-alignment';
import { PhotoCanvas } from './components/photo-canvas';
import { PhotoSetupModal } from './components/photo-setup-modal';
import { PhotoInteraction } from './components/photo-interaction';
import { StrapBoundaries } from './components/strap-boundaries';
import { autofillBoundaries, boundaryArc, moveBoundary, strapRange, type PhotoAnchor } from './vision/photoMapping';
import { detectTablaHead, renderTablaReference, type HeadGeometry } from './vision/tablaDetection';

type MicState = 'idle' | 'requesting' | 'ready' | 'denied';
type ViewMode = 'heatmap' | 'overlay';
type WorkspaceView = 'session' | 'new' | 'guide' | 'settings';

type Region = {
  id: number;
  label: string;
  short: string;
  angle: number;
  strikes: number[];
  averageFrequency: number | null;
  confidence: number;
};

type StrikePitchSample = {
  frequency: number;
  confidence: number;
};

type StrikeCapture = {
  startedAt: number;
  samples: StrikePitchSample[];
};

const REGIONS: Region[] = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  label: `Straps ${strapRange(index + 1)}${index === 0 ? ' · anchored region' : ''}`,
  short: strapRange(index + 1),
  angle: index * 45,
  strikes: [],
  averageFrequency: null,
  confidence: 0,
}));

const TARGET_TOLERANCES = [3, 5, 10, 15];
const MAX_STRIKE_VARIANCE_CENTS = 80;
const STRIKE_CAPTURE_WINDOW_MS = 180;

function freshRegions(): Region[] {
  return REGIONS.map((region) => ({ ...region, strikes: [] }));
}

function formatHz(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

function getRegionStatus(region: Region, targetHz: number, tolerance: number): TuningStatus | 'awaiting' {
  if (region.averageFrequency == null) return 'awaiting';
  return tuningStatus(centsDifference(region.averageFrequency, targetHz), tolerance);
}

function statusLabel(status: TuningStatus | 'awaiting'): string {
  if (status === 'in-tune') return 'In tune';
  if (status === 'sharp') return 'Sharp';
  if (status === 'flat') return 'Flat';
  return 'Awaiting';
}

function heatColor(region: Region, targetHz: number, tolerance: number): string {
  if (region.averageFrequency == null) return '#5a6470';
  const deviation = Math.abs(centsDifference(region.averageFrequency, targetHz));
  if (deviation <= tolerance) return '#4f8e78';
  if (deviation <= tolerance * 2) return '#c7a44f';
  if (deviation <= tolerance * 4) return '#c68149';
  return '#b75a4b';
}

function wedgePath(startAngle: number, endAngle: number, innerRadius = 22, outerRadius = 48): string {
  const start = ((startAngle - 90) * Math.PI) / 180;
  const end = ((endAngle - 90) * Math.PI) / 180;
  const point = (radius: number, radians: number) => [50 + Math.cos(radians) * radius, 50 + Math.sin(radians) * radius];
  const [outerStartX, outerStartY] = point(outerRadius, start);
  const [outerEndX, outerEndY] = point(outerRadius, end);
  const [innerEndX, innerEndY] = point(innerRadius, end);
  const [innerStartX, innerStartY] = point(innerRadius, start);
  return `M ${outerStartX} ${outerStartY} A ${outerRadius} ${outerRadius} 0 0 1 ${outerEndX} ${outerEndY} L ${innerEndX} ${innerEndY} A ${innerRadius} ${innerRadius} 0 0 0 ${innerStartX} ${innerStartY} Z`;
}

function App() {
  return (
    <ErrorBoundary>
      <TunerConsole />
    </ErrorBoundary>
  );
}

function TunerConsole() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>('session');
  const [targetNote, setTargetNote] = useState('D4');
  const [tolerance, setTolerance] = useState(5);
  const [fileName, setFileName] = useState('');
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const imageRequestRef = useRef(0);
  const [normalizedImageUrl, setNormalizedImageUrl] = useState('');
  const [geometry, setGeometry] = useState<HeadGeometry | null>(null);
  const initialGeometryRef = useRef<HeadGeometry | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [photoStep, setPhotoStep] = useState<PhotoSetupStep>('fit');
  const [anchor, setAnchor] = useState<PhotoAnchor | null>(null);
  const [anchorName, setAnchorName] = useState('');
  const [boundaries, setBoundaries] = useState<number[] | null>(null);
  const [firstBoundary, setFirstBoundary] = useState<number | null>(null);
  const [selectedBoundary, setSelectedBoundary] = useState(0);
  const [boundaryError, setBoundaryError] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const resultsRef = useRef<HTMLElement>(null);
  const [scrollToResults, setScrollToResults] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [message, setMessage] = useState('Upload a top-down image to align the tuning surface.');
  const [currentRegion, setCurrentRegion] = useState(1);
  const [hoveredRegion, setHoveredRegion] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('heatmap');
  const [regions, setRegions] = useState<Region[]>(freshRegions);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState(0);
  const streamRef = useRef<MicrophoneHandle | null>(null);
  const onsetRef = useRef(new OnsetDetector());
  const strikeCaptureRef = useRef<StrikeCapture | null>(null);
  const lastFrameUiUpdateRef = useRef(0);
  const regionsRef = useRef(regions);
  const currentRegionRef = useRef(currentRegion);
  const targetHzRef = useRef(noteNameToFrequency(targetNote));
  const toleranceRef = useRef(tolerance);

  const targetHz = useMemo(() => noteNameToFrequency(targetNote), [targetNote]);
  const selectedRegion = regions.find((region) => region.id === currentRegion) ?? regions[0];
  const measuredFrequency = selectedRegion.averageFrequency;
  const measuredNote = measuredFrequency == null ? '—' : frequencyToNoteName(measuredFrequency);
  const measuredCents = measuredFrequency == null ? Number.NaN : centsDifference(measuredFrequency, targetHz);
  const hoveredOrSelected = hoveredRegion ?? currentRegion;
  const completedCount = regions.filter((region) => region.averageFrequency != null).length;
  const tunedCount = regions.filter((region) => getRegionStatus(region, targetHz, tolerance) === 'in-tune').length;
  const totalStrikes = regions.reduce((total, region) => total + region.strikes.length, 0);
  const alignmentLocked = totalStrikes > 0 || micState === 'ready' || micState === 'requesting';
  const photoReady = photoStep === 'ready' && anchor !== null && Boolean(anchorName.trim()) && Boolean(normalizedImageUrl) && boundaries !== null;
  const regionArc = (id: number) => boundaries ? boundaryArc(id, boundaries) : { start: (id - 1) * 45 - 22.5, end: (id - 1) * 45 + 22.5, center: (id - 1) * 45 };
  const isTuned = tunedCount === 8;
  const progress = Math.round((totalStrikes / 24) * 100);

  useEffect(() => {
    regionsRef.current = regions;
    currentRegionRef.current = currentRegion;
  }, [regions, currentRegion]);

  useEffect(() => {
    targetHzRef.current = targetHz;
    toleranceRef.current = tolerance;
  }, [targetHz, tolerance]);

  useEffect(() => {
    return () => {
      streamRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!scrollToResults) return;
    if (activeView !== 'session' || micState !== 'idle') {
      setScrollToResults(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const results = resultsRef.current;
      results?.focus({ preventScroll: true });
      results?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      setScrollToResults(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToResults, activeView, micState]);

  const processPitch = useCallback((frequency: number, confidence: number) => {
    const regionId = currentRegionRef.current;
    const target = targetHzRef.current;
    const current = regionsRef.current.find((region) => region.id === regionId);
    if (!current || current.strikes.length >= 3) return;

    if (confidence < 0.46 || !Number.isFinite(frequency)) {
      setRejectedCount((count) => count + 1);
      setMessage('Pitch unclear. Strike the highlighted area again.');
      return;
    }

    if (current.strikes.length > 0) {
      const center = median(current.strikes);
      const spread = Math.abs(centsDifference(frequency, center));
      if (!Number.isFinite(spread) || spread > MAX_STRIKE_VARIANCE_CENTS) {
        setRejectedCount((count) => count + 1);
        setMessage('That strike was inconsistent. Try again.');
        return;
      }
    }

    const strikes = [...current.strikes, frequency];
    const averageFrequency = strikes.length === 3 ? median(strikes) : null;
    const nextRegions = regionsRef.current.map((region) =>
      region.id === regionId
        ? { ...region, strikes, averageFrequency, confidence: Math.min(1, confidence) }
        : region,
    );
    regionsRef.current = nextRegions;
    setRegions(nextRegions);

    if (strikes.length < 3) {
      setMessage(`Strike ${strikes.length} of 3 accepted for ${current.label}.`);
      return;
    }

    const next = nextRegions.find((region) => region.averageFrequency == null);
    const cents = centsDifference(averageFrequency ?? frequency, target);
    if (next) {
      currentRegionRef.current = next.id;
      setCurrentRegion(next.id);
      setMessage(`${current.label} complete at ${formatCents(cents)}. Continue with ${next.label}.`);
    } else {
      setMessage('All eight regions captured. Review the heat map and adjust any warm regions.');
    }
  }, []);

  const finalizeStrikeCapture = useCallback(() => {
    const capture = strikeCaptureRef.current;
    if (!capture) return;

    strikeCaptureRef.current = null;
    if (capture.samples.length === 0) {
      setRejectedCount((count) => count + 1);
      setMessage('Pitch unclear. Strike the highlighted area again.');
      return;
    }

    // A strike produces several frames. Median aggregation keeps one noisy
    // frame from moving the accepted measurement or creating an octave jump.
    processPitch(
      median(capture.samples.map((sample) => sample.frequency)),
      median(capture.samples.map((sample) => sample.confidence)),
    );
  }, [processPitch]);

  const updatePhotoGeometry = (next: HeadGeometry) => {
    if (alignmentLocked || !sourceImageRef.current) return;
    setGeometry(next);
    setAnchor(null);
    setBoundaries(null);
    setFirstBoundary(null);
    setBoundaryError('');
    setPhotoStep('fit');
    setViewMode('overlay');
  };

  const changePhotoStep = (step: PhotoSetupStep) => {
    if (alignmentLocked) return;
    if (step === 'ready' && !boundaries) return;
    setPhotoStep(step);
    setSetupOpen(true);
    setViewMode('overlay');
    if (step === 'fit') setAnchor(null);
    if (step === 'fit') {
      setBoundaries(null);
      setFirstBoundary(null);
      setBoundaryError('');
    }
    setMessage(step === 'fit' ? 'Drag, zoom, and rotate the photo to fit the head inside the circle.' : 'Tap a physical mark near the rim, then name it and confirm it as R1.');
  };

  const chooseAnchor = (next: PhotoAnchor) => {
    if (alignmentLocked || photoStep !== 'anchor') return;
    setAnchor(next);
    setBoundaryError('');
    setHoveredRegion(null);
    setCurrentRegion(1);
    currentRegionRef.current = 1;
    setMessage('Anchor placed. Name the physical mark and confirm that you can find it on the actual tabla.');
  };

  const confirmAnchor = () => {
    if (alignmentLocked || !anchor || !anchorName.trim()) return;
    setAnchorName(anchorName.trim());
    setPhotoStep(boundaries ? 'review' : 'boundaries');
    setBoundaryError('');
    setMessage(boundaries ? 'Orientation anchor updated. Your region boundaries are unchanged.' : 'Orientation anchor saved. Now separately select strap 1 and strap 3 to define the first region.');
  };

  const placeBoundary = (angle: number) => {
    if (alignmentLocked || !anchor) return;
    setBoundaryError('');
    if (photoStep === 'review' && boundaries) {
      const next = moveBoundary(boundaries, selectedBoundary, angle);
      if (!next) {
        setBoundaryError('Keep this strap between its neighboring boundaries. The orientation anchor stays separate.');
        return;
      }
      setBoundaries(next);
      return;
    }
    if (photoStep !== 'boundaries') return;
    if (firstBoundary === null) {
      setFirstBoundary(angle);
      setMessage('Strap 1 set. Count clockwise past strap 2 and tap boundary strap 3.');
      return;
    }
    const next = autofillBoundaries(firstBoundary, angle);
    if (!next) {
      setBoundaryError('Choose strap 3 clockwise from strap 1, with one middle strap between the two boundaries. If the first edge is wrong, reselect the boundaries.');
      return;
    }
    setBoundaries(next);
    setSelectedBoundary(2);
    setPhotoStep('review');
    setMessage('Eight regions filled. Check each estimated boundary against the straps, adjust if needed, then confirm.');
  };

  const confirmRegions = () => {
    if (alignmentLocked || !boundaries || !anchor || !anchorName.trim()) return;
    setPhotoStep('ready');
    setSetupOpen(false);
    setCurrentRegion(1);
    currentRegionRef.current = 1;
    setMessage(`Orientation reference: “${anchorName}”. R1 spans your selected straps 1–3. Start the microphone when ready.`);
  };

  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || alignmentLocked) return;
    const request = ++imageRequestRef.current;
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (request !== imageRequestRef.current) return;
      // A capture made while the file picker was open must not be remapped.
      if (regionsRef.current.some((region) => region.strikes.length > 0) || streamRef.current) return;
      const result = detectTablaHead(image);
      const next = result?.geometry ?? {
        centerX: image.naturalWidth / 2,
        centerY: image.naturalHeight / 2,
        radiusX: Math.min(image.naturalWidth, image.naturalHeight) * 0.45,
        radiusY: Math.min(image.naturalWidth, image.naturalHeight) * 0.45,
        rotation: 0,
        confidence: 0,
      };
      const canvas = result?.normalizedCanvas ?? renderTablaReference(image, next);
      if (!canvas) {
        setMessage('This photo could not be processed. Try another JPG, PNG, or WebP image.');
        return;
      }
      sourceImageRef.current = image;
      initialGeometryRef.current = next;
      setAnchor(null);
      setAnchorName('');
      setBoundaries(null);
      setFirstBoundary(null);
      setBoundaryError('');
      setPhotoStep('fit');
      setSetupOpen(true);
      setGeometry(next);
      setNormalizedImageUrl(canvas.toDataURL('image/jpeg', 0.9));
      setFileName(file.name);
      setViewMode('overlay');
      setActiveView('session');
      setMessage(result ? 'Photo loaded. Drag the image to fit the circle, then choose a physical R1 anchor.' : 'Head not detected. Use the photo alignment controls to center and size the head manually.');
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      if (request === imageRequestRef.current) setMessage('This image could not be opened. Try a JPG, PNG, or WebP photo.');
    };
    image.src = objectUrl;
  };

  const stopMicrophone = useCallback((showResults = false) => {
    streamRef.current?.stop();
    streamRef.current = null;
    strikeCaptureRef.current = null;
    onsetRef.current.reset();
    setInputLevel(0);
    setNoiseFloor(0);
    setMicState('idle');
    setScrollToResults(showResults);
    setMessage(showResults ? 'Microphone stopped. Review the captured results below.' : 'Microphone stopped. Start it only when you are ready to measure.');
  }, []);

  const requestMicrophone = async () => {
    if (micState === 'ready' || micState === 'requesting') return;
    if (!photoReady) {
      setMessage('Fit the photo, set the R1 anchor and boundary straps, then confirm the region map before starting the microphone.');
      return;
    }
    imageRequestRef.current += 1;
    setMicState('requesting');
    setMessage('Waiting for microphone permission…');
    try {
      const handle = await startMicrophone((frame) => {
        const now = performance.now();
        const onset = onsetRef.current.process(frame.samples, now);
        if (now - lastFrameUiUpdateRef.current > 70) {
          lastFrameUiUpdateRef.current = now;
          setInputLevel(frame.level);
          setNoiseFloor(onset.noiseFloor);
        }

        if (onset.detected) {
          strikeCaptureRef.current = { startedAt: now, samples: [] };
        }

        const capture = strikeCaptureRef.current;
        if (!capture) return;

        if (now - capture.startedAt <= STRIKE_CAPTURE_WINDOW_MS) {
          const pitch = estimatePitch(frame.samples, frame.sampleRate);
          if (pitch.frequency != null) {
            capture.samples.push({ frequency: pitch.frequency, confidence: pitch.confidence });
          }
        } else {
          finalizeStrikeCapture();
        }
      });
      streamRef.current = handle;
      setMicState('ready');
      setMessage('Microphone is listening. Strike the highlighted region three times.');
    } catch {
      setMicState('denied');
      setMessage('Microphone access is required to analyze tabla strikes. Allow access and retry.');
    }
  };

  const resetMeasurements = () => {
    const next = freshRegions();
    regionsRef.current = next;
    currentRegionRef.current = 1;
    strikeCaptureRef.current = null;
    onsetRef.current.reset();
    setRegions(next);
    setCurrentRegion(1);
    setRejectedCount(0);
    setMessage('Measurements cleared. Find your physical R1 anchor before starting the next pass.');
  };

  const clearSelectedRegion = () => {
    const next = regionsRef.current.map((region) =>
      region.id === currentRegion ? { ...region, strikes: [], averageFrequency: null, confidence: 0 } : region,
    );
    regionsRef.current = next;
    setRegions(next);
    setMessage(`${selectedRegion.label} cleared. Capture three fresh strikes.`);
  };

  const photoPreview = (
<div data-testid="photo-overlay" className={`relative aspect-square ${setupOpen ? 'photo-setup-preview' : 'w-full max-w-[430px]'}`}>
                    <div className={`absolute inset-0 rounded-full border border-[#39424e] bg-[#20242b] shadow-[inset_0_0_0_10px_#191c21,inset_0_0_0_11px_#303640] ${geometry ? 'instrument-ring' : ''}`}>
                      {viewMode === 'overlay' && normalizedImageUrl ? <>{geometry && sourceImageRef.current && <PhotoCanvas image={sourceImageRef.current} geometry={geometry} />}</> : <div className="absolute inset-[22px] rounded-full bg-[radial-gradient(circle_at_48%_40%,#5c5145_0%,#3c3835_35%,#292b2e_65%,#1c2025_100%)] opacity-90"><div className="absolute left-1/2 top-1/2 h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#b99b72]/30 bg-[#292725] shadow-[0_0_30px_rgba(202,160,91,.12)]" /></div>}
                    </div>
                    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full">
                      {(boundaries ? regions : []).map((region) => {
                        const color = heatColor(region, targetHz, tolerance);
                        return (
                          <path
                            key={region.id}
                            d={wedgePath(regionArc(region.id).start, regionArc(region.id).end)}
                            fill={color}
                            fillOpacity={photoStep === 'fit' ? 0.04 : viewMode === 'overlay' ? (hoveredOrSelected === region.id ? 0.32 : 0.12) : 0.78}
                            stroke={hoveredOrSelected === region.id ? '#f0c276' : '#2e3640'}
                            strokeWidth={hoveredOrSelected === region.id ? 0.85 : 0.45}
                            className={`${photoReady ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'} transition-[fill-opacity]`}
                            onMouseEnter={() => setHoveredRegion(region.id)}
                            onMouseLeave={() => setHoveredRegion(null)}
                            onClick={() => {
                              setCurrentRegion(region.id);
                              currentRegionRef.current = region.id;
                            }}
                          />
                        );
                      })}
                    </svg>
                    {boundaries && regions.map((region) => { const rad = (regionArc(region.id).center - 90) * (Math.PI / 180); const markerRadius = photoReady ? 39 : 28; const left = 50 + Math.cos(rad) * markerRadius; const top = 50 + Math.sin(rad) * markerRadius; const active = hoveredOrSelected === region.id; const inTune = getRegionStatus(region, targetHz, tolerance) === 'in-tune'; return <button key={region.id} data-testid={`button-region-${region.id}`} disabled={!photoReady} onMouseEnter={() => setHoveredRegion(region.id)} onMouseLeave={() => setHoveredRegion(null)} onClick={() => { setCurrentRegion(region.id); currentRegionRef.current = region.id; setMessage(`${region.label} selected. ${3 - region.strikes.length} strikes remaining.`); }} aria-label={`Select Region ${region.id}, ${region.label}`} aria-pressed={currentRegion === region.id} onFocus={() => setHoveredRegion(region.id)} onBlur={() => setHoveredRegion(null)} className={`absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border font-mono text-[10px] transition ${active ? 'border-[#e4ae5d] bg-[#d6a354] text-[#17181c] shadow-[0_0_0_4px_rgba(214,163,84,.15)]' : inTune ? 'border-[#82c8a0]/70 bg-[#274538] text-[#9fdbb6]' : 'border-[#596270] bg-[#1a1e24] text-[#a1a9b3] hover:border-[#d6a354]/70'}`} style={{ left: `${left}%`, top: `${top}%` }}><span className="font-semibold">R{region.id}</span><span className="text-[8px]">{strapRange(region.id)}</span></button>; })}
                    {(boundaries || firstBoundary !== null) && <svg data-testid="strap-boundary-pins" viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible" aria-label="Shared boundary straps">
                      {(boundaries ?? [firstBoundary!]).map((angle, index) => {
                        const x = 50 + Math.sin(angle * Math.PI / 180) * 47;
                        const y = 50 - Math.cos(angle * Math.PI / 180) * 47;
                        return <g key={index}>
                          <line x1={50 + Math.sin(angle * Math.PI / 180) * 22} y1={50 - Math.cos(angle * Math.PI / 180) * 22} x2={x} y2={y} stroke="#edc17b" strokeWidth="0.5" />
                          <circle cx={x} cy={y} r="2.1" fill={photoStep === 'review' && selectedBoundary === index ? '#edc17b' : '#20242b'} stroke="#edc17b" strokeWidth="0.4" />
                          <text x={x} y={y + 0.8} textAnchor="middle" fill={photoStep === 'review' && selectedBoundary === index ? '#12151a' : '#edc17b'} fontSize="2.2">{index * 2 + 1}</text>
                        </g>;
                      })}
                    </svg>}
                    {setupOpen && <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden="true">
                      <circle cx="50" cy="50" r="48" fill="none" stroke={photoStep === 'fit' ? '#f2bb62' : '#8ddbd5'} strokeWidth="0.8" strokeDasharray={photoStep === 'fit' ? undefined : '2 2'} />
                      {photoStep === 'fit' && <path d="M 45 50 H 55 M 50 45 V 55" stroke="#f2bb62" strokeWidth="0.6" />}
                    </svg>}
                    {anchor && <svg data-testid="anchor-pin" aria-label={`Orientation anchor A: ${anchorName || 'unnamed mark'}`} viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
                      <line x1="50" y1="50" x2={50 + Math.sin(anchor.angle * Math.PI / 180) * anchor.radius * 100} y2={50 - Math.cos(anchor.angle * Math.PI / 180) * anchor.radius * 100} stroke="#8ddbd5" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
                      <path transform={`translate(${50 + Math.sin(anchor.angle * Math.PI / 180) * anchor.radius * 100}, ${50 - Math.cos(anchor.angle * Math.PI / 180) * anchor.radius * 100})`} d="M 0 -2 L 2 0 L 0 2 L -2 0 Z" fill="#8ddbd5" stroke="#10272a" strokeWidth="0.5" />
                    </svg>}
                    {setupOpen && geometry && normalizedImageUrl && photoStep !== 'ready' && !alignmentLocked && <PhotoInteraction mode={photoStep} geometry={geometry} shortestSide={sourceImageRef.current ? Math.min(sourceImageRef.current.naturalWidth, sourceImageRef.current.naturalHeight) : 820} onChange={updatePhotoGeometry} onAnchor={(point) => photoStep === 'anchor' ? chooseAnchor(point) : placeBoundary(point.angle)} onInvalidAnchor={() => { setBoundaryError('For an anchor, tap a recognizable off-center mark. For a boundary, tap a strap near the outer rim.'); setMessage('Tap a visible feature near the outer rim.'); }} />}
                    <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"><span className="font-mono text-[9px] uppercase tracking-[.2em] text-[#9b8a70]">dayan</span><span data-testid="text-target-on-surface" className="mt-1 font-mono text-[18px] text-[#dfb875]">{targetNote}</span></div>
                  </div>
  );
  const photoControls = (<>{geometry && sourceImageRef.current && <PhotoAlignment image={sourceImageRef.current} geometry={geometry} locked={alignmentLocked} step={photoStep} anchor={anchor} anchorName={anchorName} onChange={updatePhotoGeometry} onReset={() => { if (initialGeometryRef.current) updatePhotoGeometry(initialGeometryRef.current); }} onStep={changePhotoStep} onAnchor={chooseAnchor} onAnchorName={setAnchorName} onConfirm={confirmAnchor}>
                  {(photoStep === 'boundaries' || photoStep === 'review') && <StrapBoundaries boundaries={boundaries} firstBoundary={firstBoundary} selected={selectedBoundary} error={boundaryError} locked={alignmentLocked} onSelect={(index) => { setSelectedBoundary(index); setBoundaryError(''); }} onPlace={placeBoundary} onRestart={() => { setBoundaries(null); setFirstBoundary(null); setBoundaryError(''); setPhotoStep('boundaries'); }} onConfirm={confirmRegions} onBack={() => changePhotoStep('anchor')} />}
                </PhotoAlignment>}</>);

  return (
    <div className="console-noise min-h-[100dvh] bg-[#121419] text-[#d9dde4]">
      <PhotoSetupModal open={setupOpen} onOpenChange={setSetupOpen} step={photoStep} firstBoundary={firstBoundary} selectedBoundary={selectedBoundary} anchorPlaced={anchor !== null} anchorName={anchorName} preview={photoPreview} controls={photoControls} error={boundaryError} />
      <div className="flex min-h-[100dvh]">
        <aside className={`${collapsed ? 'w-[68px]' : 'w-[220px]'} hidden shrink-0 border-r border-[#282d36] bg-[#101216] transition-[width] duration-300 md:flex md:flex-col`}>
          <div className="flex h-[72px] items-center border-b border-[#282d36] px-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d6a354]/40 bg-[#d6a354]/10 text-[#dfa656]"><Gauge size={19} strokeWidth={1.6} /></div>
            {!collapsed && <div className="ml-3 leading-none"><p className="text-[13px] font-extrabold tracking-[.16em] text-[#ece7de]">DAYAN</p><p className="mt-1 font-mono text-[9px] tracking-[.3em] text-[#7d8592]">TUNER / 01</p></div>}
          </div>
          <div className="flex flex-1 flex-col px-3 py-5">
            {!collapsed && <p className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[.2em] text-[#59616d]">Session</p>}
            <button data-testid="button-session-active" onClick={() => setActiveView('session')} className={`mb-1 flex items-center gap-3 border px-3 py-2.5 text-left text-[11px] font-semibold transition ${activeView === 'session' ? 'border-[#d6a354]/30 bg-[#d6a354]/10 text-[#ebc17b]' : 'border-transparent text-[#737b88] hover:bg-[#1b1f26] hover:text-[#bdc4ce]'} ${collapsed ? 'justify-center' : ''}`}><Activity size={15} />{!collapsed && 'Tuning session'}</button>
            <button data-testid="button-session-new" onClick={() => { stopMicrophone(); resetMeasurements(); setActiveView('new'); }} className={`flex items-center gap-3 border px-3 py-2.5 text-left text-[11px] transition ${activeView === 'new' ? 'border-[#d6a354]/30 bg-[#d6a354]/10 text-[#ebc17b]' : 'border-transparent text-[#737b88] hover:bg-[#1b1f26] hover:text-[#bdc4ce]'} ${collapsed ? 'justify-center' : ''}`}><Crosshair size={15} />{!collapsed && 'New measurement'}</button>
            <div className="my-6 h-px bg-[#252a32]" />
            {!collapsed && <p className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[.2em] text-[#59616d]">Reference</p>}
            <button data-testid="button-guide" onClick={() => setActiveView('guide')} className={`flex items-center gap-3 border px-3 py-2.5 text-left text-[11px] transition ${activeView === 'guide' ? 'border-[#d6a354]/30 bg-[#d6a354]/10 text-[#ebc17b]' : 'border-transparent text-[#737b88] hover:bg-[#1b1f26] hover:text-[#bdc4ce]'} ${collapsed ? 'justify-center' : ''}`}><CircleHelp size={15} />{!collapsed && 'How it works'}</button>
            <button data-testid="button-settings" onClick={() => setActiveView('settings')} className={`flex items-center gap-3 border px-3 py-2.5 text-left text-[11px] transition ${activeView === 'settings' ? 'border-[#d6a354]/30 bg-[#d6a354]/10 text-[#ebc17b]' : 'border-transparent text-[#737b88] hover:bg-[#1b1f26] hover:text-[#bdc4ce]'} ${collapsed ? 'justify-center' : ''}`}><Settings2 size={15} />{!collapsed && 'Instrument settings'}</button>
          </div>
          <div className="border-t border-[#282d36] p-3">
            <button data-testid="button-collapse-sidebar" onClick={() => setCollapsed(!collapsed)} className="flex w-full items-center justify-center gap-2 py-2 text-[#666f7b] transition hover:text-[#c1c7cf]" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /><span className="font-mono text-[9px] uppercase tracking-[.15em]">Collapse</span></>}</button>
          </div>
        </aside>

        <main className="console-grid min-w-0 flex-1">
          <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[#282d36] bg-[#14161b]/95 px-5 py-3 backdrop-blur-sm md:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center border border-[#d6a354]/40 bg-[#d6a354]/10 text-[#dfa656] md:hidden"><Gauge size={16} /></div>
              <div><p className="font-mono text-[9px] uppercase tracking-[.26em] text-[#6e7682]">Precision tuning workspace</p><h1 className="mt-1 text-[17px] font-semibold tracking-[-.02em] text-[#e7e9ec]">{activeView === 'session' ? 'Dayan / surface analysis' : activeView === 'new' ? 'New measurement / setup' : activeView === 'guide' ? 'How it works / field guide' : 'Instrument settings / local'}</h1></div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-2 sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${micState === 'ready' ? 'bg-[#82c8a0]' : 'bg-[#646b76]'}`} /><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[#777f8b]">{micState === 'ready' ? 'Input ready' : 'Input idle'}</span></div>
              <div className="h-5 w-px bg-[#2b3038]" />
              <span data-testid="status-session" className="font-mono text-[10px] uppercase tracking-[.14em] text-[#929aa5]">Local session</span>
            </div>
          </header>

          {activeView === 'session' ? (
          <div className="mx-auto max-w-[1500px] p-4 md:p-7">
            <section className="mb-5 flex flex-col justify-between gap-4 border-b border-[#282d36] pb-5 lg:flex-row lg:items-end">
              <div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#d6a354]"><span className="h-px w-5 bg-[#d6a354]" />01 / calibrate</div><h2 className="text-2xl font-semibold tracking-[-.04em] text-[#eef0f2] md:text-[29px]">Find the center before you chase the note.</h2><p className="mt-2 max-w-[610px] text-[12px] leading-5 text-[#818995]">A clean top-down reference and three consistent strikes per region reveal how evenly the dayan is carrying pitch.</p></div>
              <div className="flex shrink-0 items-center gap-3"><div className="text-right"><p className="font-mono text-[9px] uppercase tracking-[.17em] text-[#626a76]">Session progress</p><p data-testid="text-progress" className="mt-1 font-mono text-[15px] text-[#d8dde3]">{completedCount}<span className="text-[#646c77]"> / 8 regions</span></p></div><div className="h-10 w-px bg-[#303640]" /><button data-testid="button-reset-measurements" onClick={resetMeasurements} className="flex items-center gap-2 border border-[#343a44] bg-[#1a1e24] px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-[#99a2ad] transition hover:border-[#d6a354]/50 hover:text-[#e2b56b]"><RotateCcw size={13} />Reset</button></div>
            </section>

            {isTuned && <div data-testid="status-dayan-tuned" className="mb-5 flex items-center gap-3 border border-[#82c8a0]/30 bg-[#193026] px-4 py-3 text-[#a9dfbd] shadow-[0_0_28px_rgba(130,200,160,.08)]"><Check size={16} /><div><p className="text-[12px] font-semibold">Dayan Tuned</p><p className="mt-0.5 text-[10px] text-[#86ba9b]">All 8 regions are within ±{tolerance} cents of {targetNote}.</p></div></div>}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.22fr)_minmax(340px,.78fr)]">
              <section className="panel-inset border border-[#2d333d] bg-[#171a20] reveal">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#292f38] px-4 py-3">
                  <div className="flex items-center gap-2"><Crosshair size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Visual reference</h3><span className="font-mono text-[9px] uppercase tracking-[.13em] text-[#646d78]">top view / guide</span></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex border border-[#343a44] bg-[#1a1e24] p-0.5"><button data-testid="button-view-heatmap" onClick={() => setViewMode('heatmap')} disabled={Boolean(normalizedImageUrl) && photoStep !== 'ready'} className={`px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] disabled:cursor-not-allowed disabled:opacity-40 ${viewMode === 'heatmap' ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691]'}`}>Heat map</button><button data-testid="button-view-overlay" onClick={() => setViewMode('overlay')} disabled={!normalizedImageUrl} className={`px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] disabled:cursor-not-allowed disabled:opacity-40 ${viewMode === 'overlay' ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691]'}`}>Tabla overlay</button></div>
                    <label data-testid="button-upload-image" className="has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40 flex cursor-pointer items-center gap-2 border border-[#39414c] bg-[#1e232a] px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-[#c3c9d0] transition hover:border-[#d6a354]/60 hover:text-[#edc17b]"><Upload size={13} />{fileName ? 'Replace image' : 'Upload image'}<input data-testid="input-upload-image" className="sr-only" type="file" accept="image/*" onChange={handleImage} disabled={alignmentLocked} /></label>
                    <label className="flex cursor-pointer items-center gap-2 border border-[#39414c] bg-[#1e232a] px-3 py-2 font-mono text-[10px] uppercase text-[#c3c9d0] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40"><Camera size={13} />Take photo<input data-testid="input-camera-photo" className="sr-only" type="file" accept="image/*" capture="environment" onChange={handleImage} disabled={alignmentLocked} /></label>
                  </div>
                </div>
                {normalizedImageUrl && <div className="border-b border-[#303742] bg-[#202832] px-4 py-3 break-words text-[12px] text-[#e2e8ed]" role="status">
                  {photoReady ? `◆ ${anchorName} · R1: straps 1–3 · count clockwise` : 'Setup paused — choose Continue photo setup to resume.'}
                </div>}
                <div className="relative flex min-h-[425px] items-center justify-center overflow-hidden p-5 md:min-h-[520px]">
                  <div className="absolute left-5 top-5 font-mono text-[9px] uppercase tracking-[.16em] text-[#59616c]">{photoReady ? 'Physical anchor / R1' : 'Photo setup / preview'}</div><div className="absolute right-5 top-5 font-mono text-[9px] text-[#59616c]">Clockwise →</div>
                  {!setupOpen && photoPreview}
                  <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[90%] text-center font-mono text-[10px] text-[#8ddbd5]">{photoReady ? '◆ A = orientation · numbered straps = region edges' : 'Anchor R1, then select its two boundary straps'}</div>
                  <div className="sr-only"><span className="h-2 w-2 rounded-full border border-[#d6a354] bg-[#d6a354]" />Selected region <span className="ml-2 h-2 w-2 rounded-full border border-[#4f8e78] bg-[#4f8e78]" />In tune</div>
                  {fileName && <div className="absolute bottom-0 right-5 flex max-w-[46%] items-center gap-2 truncate font-mono text-[9px] text-[#6f7884]"><span className={`h-1.5 w-1.5 rounded-full ${geometry ? 'bg-[#82c8a0]' : 'bg-[#c68149]'}`} />{fileName}</div>}
                </div>
                <div className="border-t border-[#292f38] px-4 py-3 text-[11px] leading-5 text-[#aeb6c0]">
                  <strong className="text-[#e4b86b]">{photoReady ? `R${selectedRegion.id} — ${selectedRegion.label}` : 'Choose a physical reference before measuring'}</strong>
                  <p>{photoReady ? `Match the photo orientation using “${anchorName}” on the actual tabla. R1 is between the separately selected straps 1 and 3; the other regions follow clockwise.` : 'Screen position does not identify a spot on the tabla. Fit your photo, then anchor R1 and select its boundary straps.'}</p>
                  {!normalizedImageUrl && <p className="mt-1 text-[#929ba7]">Upload a photo or use Take photo on your phone. Include the whole head, directly from above. On desktop, Take photo may open the file picker.</p>}
                </div>
                {normalizedImageUrl && <div className="border-t border-[#394451] p-4">
                  <button data-testid="button-open-photo-setup" disabled={alignmentLocked} className="min-h-11 w-full rounded border border-[#d6a354] bg-[#302819] px-4 py-3 text-sm font-semibold text-[#f4cf91] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { if (photoReady) changePhotoStep('fit'); else { setSetupOpen(true); setViewMode('overlay'); } }}>{photoReady ? 'Edit photo, anchor & straps' : 'Continue photo setup'}</button>
                  {alignmentLocked && <p className="mt-2 text-sm text-[#c0cad7]">Stop the microphone and reset measurements to edit this map.</p>}
                </div>}
              </section>

              <section className="panel-inset border border-[#2d333d] bg-[#171a20] reveal" style={{ animationDelay: '80ms' }}>
                <div className="border-b border-[#292f38] px-5 py-4"><div className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Measurement control</h3></div><p data-testid="status-instruction" role="status" aria-live="polite" className="mt-3 rounded border border-[#7d6948] bg-[#352d20] p-3 text-[15px] font-medium leading-6 text-[#ffe0a8]">{message}</p></div>
                <div className="space-y-5 p-5">
                  <div><label htmlFor="target-note" className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]"><span>Target note</span><span className="text-[#d6a354]">A4 = 440 Hz</span></label><div className="relative"><select id="target-note" data-testid="select-target-note" value={targetNote} onChange={(event) => { setTargetNote(event.target.value); setMessage('Target updated. Existing region measurements remain available for comparison.'); }} className="w-full appearance-none border border-[#39414b] bg-[#1c2026] px-3 py-3 text-[13px] font-semibold text-[#e4e7ea] outline-none transition focus:border-[#d6a354]">{SUPPORTED_NOTES.map((note) => <option key={note} value={note}>{note} — {formatHz(noteNameToFrequency(note))} Hz</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-[#8b94a0]" size={15} /></div></div>
                  <div><label className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]"><span>In tune tolerance</span><span className="text-[#d6a354]">cents</span></label><div className="grid grid-cols-4 border border-[#39414b] bg-[#1c2026] p-0.5">{TARGET_TOLERANCES.map((value) => <button key={value} data-testid={`button-tolerance-${value}`} onClick={() => setTolerance(value)} className={`py-2 font-mono text-[10px] ${tolerance === value ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691] hover:text-[#d9dde4]'}`}>±{value}¢</button>)}</div></div>
                  <div className="border border-[#303742] bg-[#1b1f25] p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-[#6f7884]">Selected region</span><span data-testid="text-selected-region" className="font-mono text-[10px] uppercase tracking-[.12em] text-[#d6a354]">Region {selectedRegion.id} / {selectedRegion.label}</span></div><div className="flex items-end justify-between gap-4"><div><span className="block font-mono text-[9px] uppercase tracking-[.14em] text-[#6e7783]">Detected note</span><span data-testid="text-measured-note" className="font-mono text-[33px] leading-none text-[#e8ebed]">{measuredNote}</span><span data-testid="text-measured-frequency" className="ml-2 font-mono text-[11px] text-[#717a86]">{formatHz(measuredFrequency)} Hz</span></div><div className="text-right"><span className="block font-mono text-[10px] uppercase tracking-[.12em] text-[#6e7783]">target {targetNote}</span><span data-testid="text-target-frequency" className="block font-mono text-[12px] text-[#c6cdd5]">{formatHz(targetHz)} Hz</span><span data-testid="text-measured-cents" className="mt-1 block font-mono text-[12px] text-[#edc17b]">{formatCents(measuredCents)}</span></div></div><div className="mt-4 h-1 bg-[#2d333b]"><div className="h-full bg-[#d6a354] transition-[width]" style={{ width: `${measuredFrequency == null ? 4 : Math.min(100, Math.max(4, 100 - Math.abs(measuredCents) * 1.4))}%` }} /></div></div>
                  <div><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]">Input monitor</span><span className={`flex items-center gap-1 font-mono text-[9px] uppercase tracking-[.12em] ${micState === 'ready' ? 'text-[#82c8a0]' : 'text-[#737c88]'}`}><span className={`h-1.5 w-1.5 rounded-full ${micState === 'ready' ? 'meter-pulse bg-[#82c8a0]' : 'bg-[#555d68]'}`} />{micState === 'ready' ? 'listening' : 'offline'}</span></div><div className="flex h-12 items-center gap-[3px] border border-[#303640] bg-[#12151a] px-3">{Array.from({ length: 42 }).map((_, index) => <span key={index} className={`w-[2px] ${micState === 'ready' ? 'bg-[#4f8e78]' : 'bg-[#343b45]'}`} style={{ height: `${micState === 'ready' ? `${Math.max(4, Math.min(39, inputLevel * 340 + ((index * 5) % 8)))}px` : `${6 + ((index * 7) % 8)}px`}`, opacity: micState === 'ready' ? .55 + ((index % 4) * .1) : .7 }} />)}</div><p className="mt-1 font-mono text-[9px] text-[#626b76]">Noise floor {noiseFloor.toFixed(3)}</p></div>
                  <button data-testid="button-microphone-access" onClick={() => micState === 'ready' ? stopMicrophone(true) : void requestMicrophone()} disabled={micState === 'requesting' || (!photoReady && micState !== 'ready')} className={`flex w-full items-center justify-center gap-2 border px-3 py-3 font-mono text-[10px] uppercase tracking-[.13em] transition ${micState === 'ready' ? 'border-[#b75a4b]/50 bg-[#321f20] text-[#e6aaa2] hover:border-[#d57b70]' : 'border-[#39414a] bg-[#22272f] text-[#d6dce3] hover:border-[#d6a354]/60 hover:text-[#e6b970]'} disabled:cursor-not-allowed disabled:opacity-60`}>{micState === 'ready' ? <Square size={12} fill="currentColor" /> : <Mic size={14} />}{micState === 'requesting' ? 'Requesting access…' : micState === 'ready' ? 'Stop microphone' : micState === 'denied' ? 'Retry microphone access' : !photoReady ? 'Confirm the region map to start' : 'Start microphone'}</button>
                  <div className="flex items-start gap-2 border-t border-[#292f38] pt-4 text-[10px] leading-4 text-[#69727e]"><Info size={13} className="mt-0.5 shrink-0 text-[#8d7551]" /><span>{micState === 'ready' ? 'Microphone is active. Stop it when you are done; audio is not captured while it is off.' : !photoReady ? 'Upload and fit a photo, then anchor R1, select its boundary straps, and confirm the region map to enable measurement.' : `Microphone is off. Use “${anchorName}” to match the photo orientation, then locate R1 between straps 1–3.`}</span></div>
                </div>
              </section>
            </div>

            <section ref={resultsRef} data-testid="tuning-results" tabIndex={-1} aria-labelledby="results-heading" className="mt-5 grid scroll-mt-5 gap-5 outline-none xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)]">
              <div className="panel-inset border border-[#2d333d] bg-[#171a20] reveal" style={{ animationDelay: '140ms' }}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#292f38] px-5 py-4"><div><div className="flex items-center gap-2"><Waves size={15} className="text-[#d6a354]" /><h3 id="results-heading" className="text-[16px] font-semibold text-[#dfe3e8]">Results / regional heat map</h3></div><p className="mt-1 text-[10px] text-[#69727e]">Distance from target, averaged across valid strikes</p></div><div className="flex items-center gap-4 font-mono text-[9px] uppercase tracking-[.12em] text-[#737c88]"><span className="flex items-center gap-1.5"><i className="h-2 w-5 bg-[#4f8e78]" />within tolerance</span><span className="flex items-center gap-1.5"><i className="h-2 w-5 bg-[#c7a44f]" />near</span><span className="flex items-center gap-1.5"><i className="h-2 w-5 bg-[#b75a4b]" />far</span></div></div>
                <div className="divide-y divide-[#272d35] px-5">{regions.map((region) => <HeatRow key={region.id} region={region} targetHz={targetHz} tolerance={tolerance} active={hoveredOrSelected === region.id} disabled={!photoReady} onHover={setHoveredRegion} onClick={() => { setCurrentRegion(region.id); currentRegionRef.current = region.id; }} />)}</div>
                <div className="flex items-center justify-between border-t border-[#292f38] px-5 py-3"><span data-testid="text-measurement-count" className="font-mono text-[10px] uppercase tracking-[.14em] text-[#68717c]">{totalStrikes} / 24 strikes captured <span className="ml-2 text-[#525c67]">({rejectedCount} rejected)</span></span><div className="h-1 w-28 bg-[#2e343d]"><div className="h-full bg-[#d6a354] transition-[width]" style={{ width: `${progress}%` }} /></div></div>
              </div>
              <div className="panel-inset border border-[#2d333d] bg-[#171a20] reveal" style={{ animationDelay: '180ms' }}>
                <div className="border-b border-[#292f38] px-5 py-4"><div className="flex items-center gap-2"><Radio size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Readout guidance</h3></div><p className="mt-1 text-[10px] text-[#69727e]">What the pattern is telling you</p></div>
                <div className="p-5"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d6a354]/40 bg-[#d6a354]/10"><Waves size={17} className="text-[#d6a354]" /></div><div><p className="text-[12px] font-semibold text-[#d8dde2]">{isTuned ? 'Surface is in tune' : !photoReady ? 'Set up your physical reference' : completedCount === 8 ? 'Review the warm regions' : 'Build the surface map'}</p><p className="mt-1 text-[10px] leading-4 text-[#717a85]">{!photoReady ? 'Fit the photo, anchor R1, and confirm the boundary straps before measuring.' : selectedRegion.averageFrequency == null ? `Strike Region ${selectedRegion.id} three times to continue.` : guidance(selectedRegion, targetHz, tolerance)}</p></div></div><div className="space-y-3 border-l border-[#3b4149] pl-4"><GuidanceLine number="01" title="Strike the highlighted marker" body="Match the photo using your orientation mark, then strike R1 between straps 1–3. Continue clockwise to R2 (3–5)." /><GuidanceLine number="02" title="Three clean strikes per region" body="A stable cluster matters more than a single perfect number." /><GuidanceLine number="03" title="Adjust the warm bands" body="Sharp means lower tension; flat means increase tension in that region." /></div><button data-testid="button-remeasure-selected" onClick={clearSelectedRegion} disabled={selectedRegion.strikes.length === 0} className="mt-6 flex w-full items-center justify-center gap-2 border border-[#39414a] bg-[#20252c] px-3 py-2.5 font-mono text-[10px] uppercase tracking-[.11em] text-[#b5bdc7] transition hover:border-[#d6a354]/60 hover:text-[#e2b56b] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={13} />Re-measure Region {selectedRegion.id}</button></div>
              </div>
            </section>
            <footer className="flex flex-col justify-between gap-2 py-6 font-mono text-[9px] uppercase tracking-[.14em] text-[#555e69] sm:flex-row"><span>Dayan Tuner / local analysis console</span><span className="flex items-center gap-2"><ShieldCheck size={11} /> microphone data stays in this browser</span></footer>
          </div>
          ) : activeView === 'new' ? (
            <NewMeasurementView
              fileName={fileName}
              geometry={geometry}
              targetNote={targetNote}
              tolerance={tolerance}
              onTargetNoteChange={(value) => {
                setTargetNote(value);
                setMessage('Target updated. Start the microphone when you are ready to measure.');
              }}
              onToleranceChange={setTolerance}
              onImageChange={handleImage}
              onReset={resetMeasurements}
              onOpenSession={() => setActiveView('session')}
            />
          ) : activeView === 'guide' ? (
            <GuideView onOpenSession={() => setActiveView('session')} />
          ) : (
            <SettingsView
              targetNote={targetNote}
              tolerance={tolerance}
              micState={micState}
              onTargetNoteChange={setTargetNote}
              onToleranceChange={setTolerance}
              onOpenSession={() => setActiveView('session')}
            />
          )}
        </main>
      </div>
    </div>
  );
}

type MeasurementViewProps = {
  fileName: string;
  geometry: HeadGeometry | null;
  targetNote: string;
  tolerance: number;
  onTargetNoteChange: (value: string) => void;
  onToleranceChange: (value: number) => void;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
  onOpenSession: () => void;
};

function NewMeasurementView({
  fileName,
  geometry,
  targetNote,
  tolerance,
  onTargetNoteChange,
  onToleranceChange,
  onImageChange,
  onReset,
  onOpenSession,
}: MeasurementViewProps) {
  return (
    <div className="mx-auto max-w-[1180px] p-4 md:p-7">
      <section className="mb-6 border-b border-[#282d36] pb-6">
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#d6a354]"><span className="h-px w-5 bg-[#d6a354]" />02 / prepare</div>
        <h2 className="max-w-[760px] text-3xl font-semibold tracking-[-.05em] text-[#eef0f2]">Set up one clean measurement pass.</h2>
        <p className="mt-3 max-w-[650px] text-[12px] leading-5 text-[#818995]">Align the head, choose the note, then enter the tuning session when the room and the microphone are ready. Nothing listens until you start it.</p>
      </section>
      <div className="grid gap-5 lg:grid-cols-[1.12fr_.88fr]">
        <section className="panel-inset border border-[#2d333d] bg-[#171a20]">
          <div className="border-b border-[#292f38] px-5 py-4">
            <div className="flex items-center gap-2"><Crosshair size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Reference image</h3></div>
            <p className="mt-2 text-[11px] leading-5 text-[#7d8692]">Use a complete top-down image with the full dayan head visible. The image stays local to this browser.</p>
          </div>
          <div className="space-y-4 p-5">
            <label className="flex min-h-[190px] cursor-pointer flex-col items-center justify-center border border-dashed border-[#4a5059] bg-[#1a1e24] px-6 text-center transition hover:border-[#d6a354]/70 hover:bg-[#20242b]">
              <Upload size={22} className="mb-3 text-[#d6a354]" />
              <span className="text-[12px] font-semibold text-[#dfe3e8]">{fileName ? 'Replace aligned image' : 'Upload a top-down dayan image'}</span>
              <span className="mt-2 max-w-[310px] text-[10px] leading-4 text-[#707985]">{fileName || 'JPG, PNG, or WebP. Detection runs locally after selection.'}</span>
              <input data-testid="input-new-measurement-image" className="sr-only" type="file" accept="image/*" onChange={onImageChange} />
            </label>
            <div className={`flex items-center justify-between border px-3 py-3 font-mono text-[9px] uppercase tracking-[.12em] ${geometry ? 'border-[#82c8a0]/30 bg-[#193026] text-[#9fdbb6]' : 'border-[#303742] bg-[#1c2026] text-[#737c88]'}`}>
              <span>{geometry ? 'Photo ready for alignment review' : 'Waiting for image'}</span>
              <span>{geometry ? 'Review in session' : 'Not ready'}</span>
            </div>
          </div>
        </section>
        <section className="panel-inset border border-[#2d333d] bg-[#171a20]">
          <div className="border-b border-[#292f38] px-5 py-4">
            <div className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Pass settings</h3></div>
            <p className="mt-2 text-[11px] leading-5 text-[#7d8692]">These settings apply to the next tuning session.</p>
          </div>
          <div className="space-y-5 p-5">
            <label htmlFor="new-target-note" className="block font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]">Target note</label>
            <select id="new-target-note" data-testid="select-new-target-note" value={targetNote} onChange={(event) => onTargetNoteChange(event.target.value)} className="w-full border border-[#39414b] bg-[#1c2026] px-3 py-3 text-[13px] font-semibold text-[#e4e7ea] outline-none focus:border-[#d6a354]">{SUPPORTED_NOTES.map((note) => <option key={note} value={note}>{note} — {formatHz(noteNameToFrequency(note))} Hz</option>)}</select>
            <div>
              <div className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]"><span>In tune tolerance</span><span className="text-[#d6a354]">±{tolerance} cents</span></div>
              <div className="grid grid-cols-4 border border-[#39414b] bg-[#1c2026] p-0.5">{TARGET_TOLERANCES.map((value) => <button key={value} onClick={() => onToleranceChange(value)} className={`py-2 font-mono text-[10px] ${tolerance === value ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691] hover:text-[#d9dde4]'}`}>±{value}¢</button>)}</div>
            </div>
            <div className="border-l border-[#d6a354]/50 bg-[#1b1f25] px-4 py-3 text-[10px] leading-4 text-[#89919d]">Microphone state: <strong className="text-[#d6a354]">off</strong>. You will start and stop it manually inside the session.</div>
            <div className="flex gap-3 pt-2">
              <button onClick={onReset} className="flex flex-1 items-center justify-center gap-2 border border-[#39414a] bg-[#20252c] px-3 py-3 font-mono text-[10px] uppercase tracking-[.1em] text-[#b5bdc7] hover:border-[#d6a354]/60"><RotateCcw size={13} />Clear pass</button>
              <button onClick={onOpenSession} className="flex flex-[1.35] items-center justify-center gap-2 bg-[#d6a354] px-3 py-3 font-mono text-[10px] uppercase tracking-[.1em] text-[#191a1d] hover:bg-[#e4b86b]">Open tuning session <Crosshair size={13} /></button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function GuideView({ onOpenSession }: { onOpenSession: () => void }) {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const steps = [
    { number: '01', kicker: 'Photo setup', title: 'Make the photo your map.', body: 'Fit the head, then tap a unique mark to set orientation. The mark tells you which physical area is region 1.', detail: 'Drag · pinch · rotate', visual: 'photo' },
    { number: '02', kicker: 'Region setup', title: 'Give region 1 its real width.', body: 'Select the two edge straps around region 1. Strap 2 sits between straps 1 and 3; every next region shares an edge.', detail: 'region 1 → region 2', visual: 'regions' },
    { number: '03', kicker: 'Tuning pass', title: 'Follow the highlight around.', body: 'Start the microphone only when ready. Strike the highlighted region three times, then continue clockwise.', detail: '3 clean strikes per region', visual: 'audio' },
  ] as const;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const nextIndex = Number((visible.target as HTMLElement).dataset.stepIndex);
        if (Number.isInteger(nextIndex)) setActiveStep(nextIndex);
      },
      { rootMargin: '-38% 0px -38% 0px', threshold: [0.15, 0.35, 0.6, 0.85] },
    );
    stepRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const jumpToStep = (index: number) => {
    stepRefs.current[index]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  };

  return (
    <div className="guide-stage mx-auto max-w-[1320px] p-4 md:p-7">
      <section className="guide-hero">
        <div className="guide-hero-copy">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#d6a354]"><span className="h-px w-5 bg-[#d6a354]" />03 / field guide</div>
          <h2>Turn one photo into a repeatable tuning pass.</h2>
          <p>Scroll through the ritual: orient the head, divide the surface, then listen for balance.</p>
        </div>
        <div className="guide-hero-mark" aria-hidden="true"><span>DAYAN</span><strong>01</strong><small>region first</small><i /></div>
      </section>

      <section className="guide-grid" aria-label="How a tuning pass works">
        <div className="guide-grid-intro">
          <div>
            <span className="guide-kicker">THE PASS / 03 MOVES</span>
            <h3>One surface. Three deliberate moves.</h3>
            <p>Each card isolates one decision so the image, instruction, and next action stay clear while you move through the pass.</p>
          </div>
          <div className="guide-grid-controls">
            <div className="guide-story-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(activeStep + 1) / steps.length})` }} /></div>
            <nav className="guide-story-nav" aria-label="Jump to guide step">{steps.map((item, index) => <button key={item.number} aria-current={activeStep === index ? 'step' : undefined} className={activeStep === index ? 'active' : ''} onClick={() => jumpToStep(index)}><span>{item.number}</span><small>{item.kicker}</small></button>)}</nav>
          </div>
        </div>

        <div className="guide-grid-list">
          {steps.map((item, index) => <article key={item.number} ref={(node) => { stepRefs.current[index] = node; }} data-step-index={index} tabIndex={-1} className={`guide-grid-card ${activeStep === index ? 'is-active' : ''}`}>
            <div className="guide-grid-card-top"><span className="guide-kicker">{item.number} / {item.kicker}</span><span className="guide-card-state">{activeStep === index ? 'current' : 'next'}</span></div>
            <div className={`guide-grid-visual guide-visual-${item.visual}`} aria-hidden="true">
              <div className="guide-visual-art">
                {item.visual === 'photo' && <div className="guide-photo-ring"><i /></div>}
                {item.visual === 'regions' && <div className="guide-region-dial"><i /><span className="guide-region-label guide-region-label-1">R1</span><span className="guide-region-label guide-region-label-2">R2</span><span className="guide-region-label guide-region-label-3">R3</span><span className="guide-region-label guide-region-label-4">R4</span></div>}
                {item.visual === 'audio' && <><div className="guide-audio-bars">{Array.from({ length: 20 }, (_, barIndex) => <i key={barIndex} style={{ height: `${18 + ((barIndex * 17) % 48)}%` }} />)}</div><svg className="guide-recording-wave" viewBox="0 0 320 72" role="img" aria-label="Recording soundwave"><path d="M4 38h14l7-8 7 18 8-30 8 43 8-29 8 17 8-8 8 4 8-16 8 35 8-48 8 61 8-36 8 12 8-6 8 8 8-20 8 29 8-44 8 55 8-35 8 14 8-8 8 3 8-15 8 31 8-42 8 51 8-30 8 13 8-6 8 2 8-13 8 26 8-36 8 43 8-26 8 11 8-5 8 2 8-9 8 18 8-25 8 28 8-17 8 8 14 0" /></svg></>}
              </div>
            </div>
            <div className="guide-grid-copy"><span className="guide-grid-caption">{item.visual === 'photo' ? 'Orientation mark locked' : item.visual === 'regions' ? 'Shared edges / clockwise' : 'Stable clusters reveal the note'}</span><h3>{item.title}</h3><p>{item.body}</p><span className="guide-detail">{item.detail}</span></div>
          </article>)}
        </div>
      </section>

      <section className="guide-footer-grid"><div className="guide-privacy"><ShieldCheck size={18} /><div><h3>Local by design.</h3><p>Photo and microphone frames stay in this browser session. Nothing listens until you start it.</p></div></div><button onClick={onOpenSession} className="guide-open-session"><span><small>Ready to tune?</small><strong>Open tuning session</strong></span><Crosshair size={22} /></button></section>
    </div>
  );
}

function SettingsView({ targetNote, tolerance, micState, onTargetNoteChange, onToleranceChange, onOpenSession }: { targetNote: string; tolerance: number; micState: MicState; onTargetNoteChange: (value: string) => void; onToleranceChange: (value: number) => void; onOpenSession: () => void }) {
  return (
    <div className="mx-auto max-w-[920px] p-4 md:p-7">
      <section className="mb-6 border-b border-[#282d36] pb-6">
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#d6a354]"><span className="h-px w-5 bg-[#d6a354]" />04 / instrument</div>
        <h2 className="text-3xl font-semibold tracking-[-.05em] text-[#eef0f2]">Tune the way you work.</h2>
        <p className="mt-3 max-w-[620px] text-[12px] leading-5 text-[#818995]">Target and tolerance are session-wide controls. Microphone access is always user-triggered and is currently {micState === 'ready' ? 'active' : 'off'}.</p>
      </section>
      <div className="space-y-4">
        <section className="panel-inset border border-[#2d333d] bg-[#171a20] p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><h3 className="text-[13px] font-semibold text-[#dfe3e8]">Target pitch</h3><p className="mt-1 text-[11px] text-[#737c88]">Choose the note the eight regions will be compared against.</p></div><select data-testid="select-settings-target-note" value={targetNote} onChange={(event) => onTargetNoteChange(event.target.value)} className="border border-[#39414b] bg-[#1c2026] px-3 py-3 text-[13px] font-semibold text-[#e4e7ea] outline-none focus:border-[#d6a354]">{SUPPORTED_NOTES.map((note) => <option key={note} value={note}>{note} — {formatHz(noteNameToFrequency(note))} Hz</option>)}</select></div>
        </section>
        <section className="panel-inset border border-[#2d333d] bg-[#171a20] p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><h3 className="text-[13px] font-semibold text-[#dfe3e8]">Pass tolerance</h3><p className="mt-1 text-[11px] text-[#737c88]">A region is green when its median reading falls inside this band.</p></div><div className="grid grid-cols-4 border border-[#39414b] bg-[#1c2026] p-0.5">{TARGET_TOLERANCES.map((value) => <button key={value} onClick={() => onToleranceChange(value)} className={`px-4 py-2 font-mono text-[10px] ${tolerance === value ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691] hover:text-[#d9dde4]'}`}>±{value}¢</button>)}</div></div>
        </section>
        <section className="panel-inset border border-[#2d333d] bg-[#171a20] p-5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center border border-[#4a5059] bg-[#1c2026]"><Mic size={15} className="text-[#d6a354]" /></div><div><h3 className="text-[13px] font-semibold text-[#dfe3e8]">Microphone privacy</h3><p className="mt-1 text-[11px] text-[#737c88]">The tuner never starts the stream automatically. Use Start microphone in the session, then Stop microphone when done.</p></div></div></section>
        <button onClick={onOpenSession} className="flex items-center gap-2 border border-[#d6a354]/40 bg-[#d6a354]/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[.12em] text-[#e9c887] hover:bg-[#d6a354]/15">Return to tuning session <Crosshair size={13} /></button>
      </div>
    </div>
  );
}

function guidance(region: Region, targetHz: number, tolerance: number): string {
  if (region.averageFrequency == null) return 'No valid measurement yet.';
  const cents = centsDifference(region.averageFrequency, targetHz);
  const status = tuningStatus(cents, tolerance);
  if (status === 'in-tune') return `Region ${region.id} is in tune at ${formatCents(cents)}.`;
  if (status === 'sharp') return `Region ${region.id} is sharp by ${Math.abs(Math.round(cents))} cents. Lower tension in this region.`;
  return `Region ${region.id} is flat by ${Math.abs(Math.round(cents))} cents. Increase tension in this region.`;
}

function HeatRow({ region, targetHz, tolerance, active, disabled, onHover, onClick }: { region: Region; targetHz: number; tolerance: number; active: boolean; disabled: boolean; onHover: (id: number | null) => void; onClick: () => void }) {
  const status = getRegionStatus(region, targetHz, tolerance);
  const cents = region.averageFrequency == null ? null : centsDifference(region.averageFrequency, targetHz);
  const color = heatColor(region, targetHz, tolerance);
  const width = cents == null ? 7 : Math.max(10, 100 - Math.min(92, Math.abs(cents) * 1.2));
  return <button data-testid={`row-region-${region.id}`} disabled={disabled} aria-label={`Region ${region.id}, ${region.label}, ${statusLabel(status)}`} onFocus={() => onHover(region.id)} onBlur={() => onHover(null)} onMouseEnter={() => onHover(region.id)} onMouseLeave={() => onHover(null)} onClick={onClick} className={`grid w-full grid-cols-[minmax(90px,1.2fr)_minmax(20px,1fr)_55px_54px] items-center gap-2 py-3 text-left transition hover:bg-[#1d2229] ${active ? 'bg-[#1b2026]' : ''}`}><span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#aeb6c0]">R{region.id} <span className="text-[#929ba7]">{region.short}</span><span className="mt-1 block font-sans text-[10px] normal-case tracking-normal text-[#929ba7]">{region.id === 1 ? 'Anchored · 3 straps' : '3 straps · shared edges'}</span></span><div className="relative h-2 bg-[#282f37]"><div className="h-full transition-[width]" style={{ width: `${width}%`, backgroundColor: color }} /><span className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-[#8a929c]" /></div><span className="text-right font-mono text-[10px]" style={{ color: cents == null ? '#626b76' : color }}>{cents == null ? '—' : formatCents(cents)}</span><span className="text-right font-mono text-[9px] uppercase tracking-[.08em] text-[#68717c]">{statusLabel(status)}</span></button>;
}

function GuidanceLine({ number, title, body }: { number: string; title: string; body: string }) {
  return <div className="relative"><span className="absolute -left-[21px] top-0 flex h-3 w-3 items-center justify-center bg-[#171a20] font-mono text-[8px] text-[#d6a354]">{number}</span><p className="text-[11px] font-semibold text-[#c9d0d7]">{title}</p><p className="mt-1 text-[10px] leading-4 text-[#717a85]">{body}</p></div>;
}

export default App;
