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
  Upload,
  Waves,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { centsDifference, formatCents, frequencyToNoteName, noteNameToFrequency, SUPPORTED_NOTES, tuningStatus, type TuningStatus } from './audio/musicTheory';
import { OnsetDetector } from './audio/onsetDetection';
import { startMicrophone, type MicrophoneHandle } from './audio/microphone';
import { estimatePitch } from './audio/pitchDetection';
import { median } from './audio/signalUtils';
import { detectTablaHead, type HeadGeometry } from './vision/tablaDetection';

type MicState = 'idle' | 'requesting' | 'ready' | 'denied';
type ViewMode = 'heatmap' | 'overlay';

type Region = {
  id: number;
  label: string;
  short: string;
  angle: number;
  strikes: number[];
  averageFrequency: number | null;
  confidence: number;
};

const REGIONS: Region[] = [
  { id: 1, label: 'North edge', short: 'N', angle: 0, strikes: [], averageFrequency: null, confidence: 0 },
  { id: 2, label: 'North-east', short: 'NE', angle: 45, strikes: [], averageFrequency: null, confidence: 0 },
  { id: 3, label: 'East edge', short: 'E', angle: 90, strikes: [], averageFrequency: null, confidence: 0 },
  { id: 4, label: 'South-east', short: 'SE', angle: 135, strikes: [], averageFrequency: null, confidence: 0 },
  { id: 5, label: 'South edge', short: 'S', angle: 180, strikes: [], averageFrequency: null, confidence: 0 },
  { id: 6, label: 'South-west', short: 'SW', angle: 225, strikes: [], averageFrequency: null, confidence: 0 },
  { id: 7, label: 'West edge', short: 'W', angle: 270, strikes: [], averageFrequency: null, confidence: 0 },
  { id: 8, label: 'North-west', short: 'NW', angle: 315, strikes: [], averageFrequency: null, confidence: 0 },
];

const TARGET_TOLERANCES = [3, 5, 10, 15];
const MAX_STRIKE_VARIANCE_CENTS = 80;

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

function wedgePath(angle: number, innerRadius = 22, outerRadius = 48): string {
  const start = ((angle - 22.5 - 90) * Math.PI) / 180;
  const end = ((angle + 22.5 - 90) * Math.PI) / 180;
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
  const [targetNote, setTargetNote] = useState('D4');
  const [tolerance, setTolerance] = useState(5);
  const [fileName, setFileName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [normalizedImageUrl, setNormalizedImageUrl] = useState('');
  const [geometry, setGeometry] = useState<HeadGeometry | null>(null);
  const [micState, setMicState] = useState<MicState>('idle');
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
  const lastFrameUiUpdateRef = useRef(0);
  const regionsRef = useRef(regions);
  const currentRegionRef = useRef(currentRegion);
  const targetHzRef = useRef(noteNameToFrequency(targetNote));
  const toleranceRef = useRef(tolerance);

  const targetHz = useMemo(() => noteNameToFrequency(targetNote), [targetNote]);
  const selectedRegion = regions.find((region) => region.id === currentRegion) ?? regions[0];
  const hoveredOrSelected = hoveredRegion ?? currentRegion;
  const completedCount = regions.filter((region) => region.averageFrequency != null).length;
  const tunedCount = regions.filter((region) => getRegionStatus(region, targetHz, tolerance) === 'in-tune').length;
  const totalStrikes = regions.reduce((total, region) => total + region.strikes.length, 0);
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
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

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

  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const result = detectTablaHead(image);
      if (!result) {
        setGeometry(null);
        setNormalizedImageUrl('');
        setMessage("Couldn't detect the tabla head. Try a clearer photo taken directly from above.");
        return;
      }
      setGeometry(result.geometry);
      setNormalizedImageUrl(result.normalizedCanvas.toDataURL('image/jpeg', 0.9));
      setMessage('Tabla head aligned. Grant microphone access, then strike the highlighted region.');
    };
    image.src = objectUrl;
    setFileName(file.name);
    setImageUrl(objectUrl);
    event.target.value = '';
  };

  const requestMicrophone = async () => {
    if (micState === 'ready') return;
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
          const pitch = estimatePitch(frame.samples, frame.sampleRate);
          if (pitch.frequency != null) {
            processPitch(pitch.frequency, pitch.confidence);
          } else {
            setRejectedCount((count) => count + 1);
            setMessage('Pitch unclear. Strike the highlighted area again.');
          }
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
    onsetRef.current.reset();
    setRegions(next);
    setCurrentRegion(1);
    setRejectedCount(0);
    setMessage('Measurements cleared. North edge is ready.');
  };

  const clearSelectedRegion = () => {
    const next = regionsRef.current.map((region) =>
      region.id === currentRegion ? { ...region, strikes: [], averageFrequency: null, confidence: 0 } : region,
    );
    regionsRef.current = next;
    setRegions(next);
    setMessage(`${selectedRegion.label} cleared. Capture three fresh strikes.`);
  };

  return (
    <div className="console-noise min-h-[100dvh] bg-[#121419] text-[#d9dde4]">
      <div className="flex min-h-[100dvh]">
        <aside className={`${collapsed ? 'w-[68px]' : 'w-[220px]'} hidden shrink-0 border-r border-[#282d36] bg-[#101216] transition-[width] duration-300 md:flex md:flex-col`}>
          <div className="flex h-[72px] items-center border-b border-[#282d36] px-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d6a354]/40 bg-[#d6a354]/10 text-[#dfa656]"><Gauge size={19} strokeWidth={1.6} /></div>
            {!collapsed && <div className="ml-3 leading-none"><p className="text-[13px] font-extrabold tracking-[.16em] text-[#ece7de]">DAYAN</p><p className="mt-1 font-mono text-[9px] tracking-[.3em] text-[#7d8592]">TUNER / 01</p></div>}
          </div>
          <div className="flex flex-1 flex-col px-3 py-5">
            {!collapsed && <p className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[.2em] text-[#59616d]">Session</p>}
            <button data-testid="button-session-active" className={`mb-1 flex items-center gap-3 border border-[#d6a354]/30 bg-[#d6a354]/10 px-3 py-2.5 text-left text-[11px] font-semibold text-[#ebc17b] ${collapsed ? 'justify-center' : ''}`}><Activity size={15} />{!collapsed && 'Tuning session'}</button>
            <button data-testid="button-session-new" onClick={resetMeasurements} className={`flex items-center gap-3 px-3 py-2.5 text-left text-[11px] text-[#737b88] transition hover:bg-[#1b1f26] hover:text-[#bdc4ce] ${collapsed ? 'justify-center' : ''}`}><Crosshair size={15} />{!collapsed && 'New measurement'}</button>
            <div className="my-6 h-px bg-[#252a32]" />
            {!collapsed && <p className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[.2em] text-[#59616d]">Reference</p>}
            <button data-testid="button-guide" onClick={() => setMessage('Three valid strikes per region reject outliers and reveal uneven tension.')} className={`flex items-center gap-3 px-3 py-2.5 text-left text-[11px] text-[#737b88] transition hover:bg-[#1b1f26] hover:text-[#bdc4ce] ${collapsed ? 'justify-center' : ''}`}><CircleHelp size={15} />{!collapsed && 'How it works'}</button>
            <button data-testid="button-settings" onClick={() => setMessage('All audio and image analysis stays local to this browser.')} className={`flex items-center gap-3 px-3 py-2.5 text-left text-[11px] text-[#737b88] transition hover:bg-[#1b1f26] hover:text-[#bdc4ce] ${collapsed ? 'justify-center' : ''}`}><Settings2 size={15} />{!collapsed && 'Instrument settings'}</button>
          </div>
          <div className="border-t border-[#282d36] p-3">
            <button data-testid="button-collapse-sidebar" onClick={() => setCollapsed(!collapsed)} className="flex w-full items-center justify-center gap-2 py-2 text-[#666f7b] transition hover:text-[#c1c7cf]" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /><span className="font-mono text-[9px] uppercase tracking-[.15em]">Collapse</span></>}</button>
          </div>
        </aside>

        <main className="console-grid min-w-0 flex-1">
          <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[#282d36] bg-[#14161b]/95 px-5 py-3 backdrop-blur-sm md:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center border border-[#d6a354]/40 bg-[#d6a354]/10 text-[#dfa656] md:hidden"><Gauge size={16} /></div>
              <div><p className="font-mono text-[9px] uppercase tracking-[.26em] text-[#6e7682]">Precision tuning workspace</p><h1 className="mt-1 text-[17px] font-semibold tracking-[-.02em] text-[#e7e9ec]">Dayan / surface analysis</h1></div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-2 sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${micState === 'ready' ? 'bg-[#82c8a0]' : 'bg-[#646b76]'}`} /><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[#777f8b]">{micState === 'ready' ? 'Input ready' : 'Input idle'}</span></div>
              <div className="h-5 w-px bg-[#2b3038]" />
              <span data-testid="status-session" className="font-mono text-[10px] uppercase tracking-[.14em] text-[#929aa5]">Local session</span>
            </div>
          </header>

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
                  <div className="flex items-center gap-2">
                    <div className="flex border border-[#343a44] bg-[#1a1e24] p-0.5"><button data-testid="button-view-heatmap" onClick={() => setViewMode('heatmap')} className={`px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] ${viewMode === 'heatmap' ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691]'}`}>Heat map</button><button data-testid="button-view-overlay" onClick={() => setViewMode('overlay')} disabled={!normalizedImageUrl} className={`px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] disabled:cursor-not-allowed disabled:opacity-40 ${viewMode === 'overlay' ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691]'}`}>Tabla overlay</button></div>
                    <label data-testid="button-upload-image" className="flex cursor-pointer items-center gap-2 border border-[#39414c] bg-[#1e232a] px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-[#c3c9d0] transition hover:border-[#d6a354]/60 hover:text-[#edc17b]"><Upload size={13} />{fileName ? 'Replace image' : 'Upload image'}<input data-testid="input-upload-image" className="sr-only" type="file" accept="image/*" onChange={handleImage} /></label>
                  </div>
                </div>
                <div className="relative flex min-h-[425px] items-center justify-center overflow-hidden p-5 md:min-h-[520px]">
                  <div className="absolute left-5 top-5 font-mono text-[9px] uppercase tracking-[.16em] text-[#59616c]">Reference plane / 01</div><div className="absolute right-5 top-5 font-mono text-[9px] text-[#59616c]">N ↑</div>
                  <div className="relative aspect-square w-[min(78vw,430px)]">
                    <div className={`absolute inset-0 rounded-full border border-[#39424e] bg-[#20242b] shadow-[inset_0_0_0_10px_#191c21,inset_0_0_0_11px_#303640] ${geometry ? 'instrument-ring' : ''}`}>
                      {viewMode === 'overlay' && normalizedImageUrl ? <img src={normalizedImageUrl} alt="Detected top-down dayan reference" className="absolute inset-[12px] h-[calc(100%-24px)] w-[calc(100%-24px)] rounded-full object-cover opacity-80" /> : <div className="absolute inset-[22px] rounded-full bg-[radial-gradient(circle_at_48%_40%,#5c5145_0%,#3c3835_35%,#292b2e_65%,#1c2025_100%)] opacity-90"><div className="absolute left-1/2 top-1/2 h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#b99b72]/30 bg-[#292725] shadow-[0_0_30px_rgba(202,160,91,.12)]" /></div>}
                    </div>
                    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-[7%] h-[86%] w-[86%]">
                      {regions.map((region) => {
                        const color = heatColor(region, targetHz, tolerance);
                        return (
                          <path
                            key={region.id}
                            d={wedgePath(region.angle)}
                            fill={color}
                            fillOpacity={viewMode === 'overlay' ? 0.56 : 0.78}
                            stroke={hoveredOrSelected === region.id ? '#f0c276' : '#2e3640'}
                            strokeWidth={hoveredOrSelected === region.id ? 0.85 : 0.45}
                            className="pointer-events-auto cursor-pointer transition-[fill-opacity]"
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
                    {regions.map((region) => { const rad = (region.angle - 90) * (Math.PI / 180); const left = 50 + Math.cos(rad) * 41; const top = 50 + Math.sin(rad) * 41; const active = currentRegion === region.id; const done = region.averageFrequency != null; return <button key={region.id} data-testid={`button-region-${region.id}`} onMouseEnter={() => setHoveredRegion(region.id)} onMouseLeave={() => setHoveredRegion(null)} onClick={() => { setCurrentRegion(region.id); currentRegionRef.current = region.id; setMessage(`${region.label} selected. ${3 - region.strikes.length} strikes remaining.`); }} aria-label={`Select ${region.label}`} className={`absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-mono text-[10px] transition ${active ? 'border-[#e4ae5d] bg-[#d6a354] text-[#17181c] shadow-[0_0_0_4px_rgba(214,163,84,.15)]' : done ? 'border-[#82c8a0]/70 bg-[#274538] text-[#9fdbb6]' : 'border-[#596270] bg-[#1a1e24] text-[#a1a9b3] hover:border-[#d6a354]/70'}`} style={{ left: `${left}%`, top: `${top}%` }}>{done ? <Check size={14} /> : region.id}</button>; })}
                    <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"><span className="font-mono text-[9px] uppercase tracking-[.2em] text-[#9b8a70]">dayan</span><span data-testid="text-target-on-surface" className="mt-1 font-mono text-[18px] text-[#dfb875]">{targetNote}</span></div>
                  </div>
                  <div className="absolute bottom-5 left-5 flex items-center gap-2 text-[10px] text-[#666f7b]"><span className="h-2 w-2 rounded-full border border-[#d6a354] bg-[#d6a354]" />Selected region <span className="ml-2 h-2 w-2 rounded-full border border-[#4f8e78] bg-[#4f8e78]" />In tune</div>
                  {fileName && <div className="absolute bottom-5 right-5 flex max-w-[46%] items-center gap-2 truncate font-mono text-[9px] text-[#6f7884]"><span className={`h-1.5 w-1.5 rounded-full ${geometry ? 'bg-[#82c8a0]' : 'bg-[#c68149]'}`} />{fileName}</div>}
                </div>
              </section>

              <section className="panel-inset border border-[#2d333d] bg-[#171a20] reveal" style={{ animationDelay: '80ms' }}>
                <div className="border-b border-[#292f38] px-5 py-4"><div className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Measurement control</h3></div><p data-testid="status-instruction" className="mt-2 text-[11px] leading-5 text-[#7d8692]">{message}</p></div>
                <div className="space-y-5 p-5">
                  <div><label htmlFor="target-note" className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]"><span>Target note</span><span className="text-[#d6a354]">A4 = 440 Hz</span></label><div className="relative"><select id="target-note" data-testid="select-target-note" value={targetNote} onChange={(event) => { setTargetNote(event.target.value); setMessage('Target updated. Existing region measurements remain available for comparison.'); }} className="w-full appearance-none border border-[#39414b] bg-[#1c2026] px-3 py-3 text-[13px] font-semibold text-[#e4e7ea] outline-none transition focus:border-[#d6a354]">{SUPPORTED_NOTES.map((note) => <option key={note} value={note}>{note} — {formatHz(noteNameToFrequency(note))} Hz</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-[#8b94a0]" size={15} /></div></div>
                  <div><label className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]"><span>In tune tolerance</span><span className="text-[#d6a354]">cents</span></label><div className="grid grid-cols-4 border border-[#39414b] bg-[#1c2026] p-0.5">{TARGET_TOLERANCES.map((value) => <button key={value} data-testid={`button-tolerance-${value}`} onClick={() => setTolerance(value)} className={`py-2 font-mono text-[10px] ${tolerance === value ? 'bg-[#d6a354] text-[#191a1d]' : 'text-[#7d8691] hover:text-[#d9dde4]'}`}>±{value}¢</button>)}</div></div>
                  <div className="border border-[#303742] bg-[#1b1f25] p-4"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-[#6f7884]">Selected region</span><span data-testid="text-selected-region" className="font-mono text-[10px] uppercase tracking-[.12em] text-[#d6a354]">Region {selectedRegion.id} / {selectedRegion.label}</span></div><div className="flex items-end justify-between"><div><span data-testid="text-measured-frequency" className="font-mono text-[33px] leading-none text-[#e8ebed]">{formatHz(selectedRegion.averageFrequency)}</span><span className="ml-2 font-mono text-[11px] text-[#717a86]">Hz</span></div><div className="text-right"><span className="block font-mono text-[10px] text-[#6e7783]">target</span><span data-testid="text-target-frequency" className="font-mono text-[12px] text-[#c6cdd5]">{formatHz(targetHz)} Hz</span></div></div><div className="mt-4 h-1 bg-[#2d333b]"><div className="h-full bg-[#d6a354] transition-[width]" style={{ width: `${selectedRegion.averageFrequency == null ? 4 : Math.min(100, Math.max(4, 100 - Math.abs(centsDifference(selectedRegion.averageFrequency, targetHz)) * 1.4))}%` }} /></div></div>
                  <div><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-[#737c88]">Input monitor</span><span className={`flex items-center gap-1 font-mono text-[9px] uppercase tracking-[.12em] ${micState === 'ready' ? 'text-[#82c8a0]' : 'text-[#737c88]'}`}><span className={`h-1.5 w-1.5 rounded-full ${micState === 'ready' ? 'meter-pulse bg-[#82c8a0]' : 'bg-[#555d68]'}`} />{micState === 'ready' ? 'listening' : 'offline'}</span></div><div className="flex h-12 items-center gap-[3px] border border-[#303640] bg-[#12151a] px-3">{Array.from({ length: 42 }).map((_, index) => <span key={index} className={`w-[2px] ${micState === 'ready' ? 'bg-[#4f8e78]' : 'bg-[#343b45]'}`} style={{ height: `${micState === 'ready' ? `${Math.max(4, Math.min(39, inputLevel * 340 + ((index * 5) % 8)))}px` : `${6 + ((index * 7) % 8)}px`}`, opacity: micState === 'ready' ? .55 + ((index % 4) * .1) : .7 }} />)}</div><p className="mt-1 font-mono text-[9px] text-[#626b76]">Noise floor {noiseFloor.toFixed(3)}</p></div>
                  <button data-testid="button-microphone-access" onClick={requestMicrophone} disabled={micState === 'requesting' || micState === 'ready'} className="flex w-full items-center justify-center gap-2 border border-[#39414a] bg-[#22272f] px-3 py-3 font-mono text-[10px] uppercase tracking-[.13em] text-[#d6dce3] transition hover:border-[#d6a354]/60 hover:text-[#e6b970] disabled:cursor-default disabled:opacity-60">{micState === 'ready' ? <ShieldCheck size={14} className="text-[#82c8a0]" /> : <Mic size={14} />}{micState === 'requesting' ? 'Requesting access…' : micState === 'ready' ? 'Microphone connected' : micState === 'denied' ? 'Retry microphone access' : 'Grant microphone access'}</button>
                  <div className="flex items-start gap-2 border-t border-[#292f38] pt-4 text-[10px] leading-4 text-[#69727e]"><Info size={13} className="mt-0.5 shrink-0 text-[#8d7551]" /><span>Strike the highlighted outer region. The tuner listens continuously, rejects uncertain pitches, and accepts three consistent readings.</span></div>
                </div>
              </section>
            </div>

            <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)]">
              <div className="panel-inset border border-[#2d333d] bg-[#171a20] reveal" style={{ animationDelay: '140ms' }}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#292f38] px-5 py-4"><div><div className="flex items-center gap-2"><Waves size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Regional heat map</h3></div><p className="mt-1 text-[10px] text-[#69727e]">Distance from target, averaged across valid strikes</p></div><div className="flex items-center gap-4 font-mono text-[9px] uppercase tracking-[.12em] text-[#737c88]"><span className="flex items-center gap-1.5"><i className="h-2 w-5 bg-[#4f8e78]" />within tolerance</span><span className="flex items-center gap-1.5"><i className="h-2 w-5 bg-[#c7a44f]" />near</span><span className="flex items-center gap-1.5"><i className="h-2 w-5 bg-[#b75a4b]" />far</span></div></div>
                <div className="divide-y divide-[#272d35] px-5">{regions.map((region) => <HeatRow key={region.id} region={region} targetHz={targetHz} tolerance={tolerance} active={hoveredOrSelected === region.id} onHover={setHoveredRegion} onClick={() => { setCurrentRegion(region.id); currentRegionRef.current = region.id; }} />)}</div>
                <div className="flex items-center justify-between border-t border-[#292f38] px-5 py-3"><span data-testid="text-measurement-count" className="font-mono text-[10px] uppercase tracking-[.14em] text-[#68717c]">{totalStrikes} / 24 strikes captured <span className="ml-2 text-[#525c67]">({rejectedCount} rejected)</span></span><div className="h-1 w-28 bg-[#2e343d]"><div className="h-full bg-[#d6a354] transition-[width]" style={{ width: `${progress}%` }} /></div></div>
              </div>
              <div className="panel-inset border border-[#2d333d] bg-[#171a20] reveal" style={{ animationDelay: '180ms' }}>
                <div className="border-b border-[#292f38] px-5 py-4"><div className="flex items-center gap-2"><Radio size={15} className="text-[#d6a354]" /><h3 className="text-[12px] font-semibold text-[#dfe3e8]">Readout guidance</h3></div><p className="mt-1 text-[10px] text-[#69727e]">What the pattern is telling you</p></div>
                <div className="p-5"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d6a354]/40 bg-[#d6a354]/10"><Waves size={17} className="text-[#d6a354]" /></div><div><p className="text-[12px] font-semibold text-[#d8dde2]">{isTuned ? 'Surface is in tune' : completedCount === 8 ? 'Review the warm regions' : 'Build the surface map'}</p><p className="mt-1 text-[10px] leading-4 text-[#717a85]">{selectedRegion.averageFrequency == null ? `Strike Region ${selectedRegion.id} three times to continue.` : guidance(selectedRegion, targetHz, tolerance)}</p></div></div><div className="space-y-3 border-l border-[#3b4149] pl-4"><GuidanceLine number="01" title="Strike the highlighted marker" body="Keep the mic still while you work around the outer playing surface." /><GuidanceLine number="02" title="Three clean strikes per region" body="A stable cluster matters more than a single perfect number." /><GuidanceLine number="03" title="Adjust the warm bands" body="Sharp means lower tension; flat means increase tension in that region." /></div><button data-testid="button-remeasure-selected" onClick={clearSelectedRegion} disabled={selectedRegion.strikes.length === 0} className="mt-6 flex w-full items-center justify-center gap-2 border border-[#39414a] bg-[#20252c] px-3 py-2.5 font-mono text-[10px] uppercase tracking-[.11em] text-[#b5bdc7] transition hover:border-[#d6a354]/60 hover:text-[#e2b56b] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={13} />Re-measure Region {selectedRegion.id}</button></div>
              </div>
            </section>
            <footer className="flex flex-col justify-between gap-2 py-6 font-mono text-[9px] uppercase tracking-[.14em] text-[#555e69] sm:flex-row"><span>Dayan Tuner / local analysis console</span><span className="flex items-center gap-2"><ShieldCheck size={11} /> microphone data stays in this browser</span></footer>
          </div>
        </main>
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

function HeatRow({ region, targetHz, tolerance, active, onHover, onClick }: { region: Region; targetHz: number; tolerance: number; active: boolean; onHover: (id: number | null) => void; onClick: () => void }) {
  const status = getRegionStatus(region, targetHz, tolerance);
  const cents = region.averageFrequency == null ? null : centsDifference(region.averageFrequency, targetHz);
  const color = heatColor(region, targetHz, tolerance);
  const width = cents == null ? 7 : Math.max(10, 100 - Math.min(92, Math.abs(cents) * 1.2));
  return <button data-testid={`row-region-${region.id}`} onMouseEnter={() => onHover(region.id)} onMouseLeave={() => onHover(null)} onClick={onClick} className={`grid w-full grid-cols-[82px_minmax(0,1fr)_68px_76px] items-center gap-3 py-3 text-left transition hover:bg-[#1d2229] ${active ? 'bg-[#1b2026]' : ''}`}><span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#aeb6c0]">R{region.id} <span className="hidden text-[#626b76] sm:inline">{region.short}</span></span><div className="relative h-2 bg-[#282f37]"><div className="h-full transition-[width]" style={{ width: `${width}%`, backgroundColor: color }} /><span className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-[#8a929c]" /></div><span className="text-right font-mono text-[10px]" style={{ color: cents == null ? '#626b76' : color }}>{cents == null ? '—' : formatCents(cents)}</span><span className="text-right font-mono text-[9px] uppercase tracking-[.08em] text-[#68717c]">{statusLabel(status)}</span></button>;
}

function GuidanceLine({ number, title, body }: { number: string; title: string; body: string }) {
  return <div className="relative"><span className="absolute -left-[21px] top-0 flex h-3 w-3 items-center justify-center bg-[#171a20] font-mono text-[8px] text-[#d6a354]">{number}</span><p className="text-[11px] font-semibold text-[#c9d0d7]">{title}</p><p className="mt-1 text-[10px] leading-4 text-[#717a85]">{body}</p></div>;
}

export default App;