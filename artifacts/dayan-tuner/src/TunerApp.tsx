import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ArrowUpLeft,
  ArrowUpRight,
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  Crosshair,
  Mic,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Upload,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  centsDifference,
  formatCents,
  frequencyToNoteName,
  noteNameToFrequency,
  SUPPORTED_NOTES,
  tuningStatus,
  type TuningStatus,
} from "./audio/musicTheory";
import { OnsetDetector } from "./audio/onsetDetection";
import { startMicrophone, type MicrophoneHandle } from "./audio/microphone";
import { estimatePitch } from "./audio/pitchDetection";
import { median } from "./audio/signalUtils";
import {
  PhotoAlignment,
  type PhotoSetupStep,
} from "./components/photo-alignment";
import { PhotoCanvas } from "./components/photo-canvas";
import { RegionReference } from "./components/region-reference";
import { PhotoSetupModal } from "./components/photo-setup-modal";
import { PhotoInteraction } from "./components/photo-interaction";
import { StrapBoundaries } from "./components/strap-boundaries";
import {
  autofillBoundaries,
  boundaryArc,
  moveBoundary,
  strapRange,
  type PhotoAnchor,
} from "./vision/photoMapping";
import {
  detectTablaHead,
  renderTablaReference,
  type HeadGeometry,
} from "./vision/tablaDetection";

type MicState = "idle" | "requesting" | "ready" | "denied";
type ViewMode = "heatmap" | "overlay";
type WorkspaceView = "session" | "guide" | "settings";

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
  label: `Straps ${strapRange(index + 1)}${index === 0 ? " · anchored region" : ""}`,
  short: strapRange(index + 1),
  angle: index * 45,
  strikes: [],
  averageFrequency: null,
  confidence: 0,
}));

const TARGET_TOLERANCES = [3, 5, 10, 15];
const MAX_STRIKE_VARIANCE_CENTS = 140;
const STRIKE_CAPTURE_WINDOW_MS = 180;

function freshRegions(): Region[] {
  return REGIONS.map((region) => ({ ...region, strikes: [] }));
}

function formatHz(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function normalizeFrequencyToReference(
  frequency: number,
  reference: number,
): number {
  if (
    !Number.isFinite(frequency) ||
    !Number.isFinite(reference) ||
    reference <= 0
  )
    return Number.NaN;

  let normalized = frequency;
  // Autocorrelation can occasionally choose the octave above or below. Fold
  // that candidate into the reference octave before comparing strike spread.
  while (normalized / reference > 1.5) normalized /= 2;
  while (normalized / reference < 0.667) normalized *= 2;
  return normalized;
}

function getRegionStatus(
  region: Region,
  targetHz: number,
  tolerance: number,
): TuningStatus | "awaiting" {
  if (region.averageFrequency == null) return "awaiting";
  return tuningStatus(
    centsDifference(region.averageFrequency, targetHz),
    tolerance,
  );
}

function statusLabel(status: TuningStatus | "awaiting"): string {
  if (status === "in-tune") return "In tune";
  if (status === "sharp") return "Sharp";
  if (status === "flat") return "Flat";
  return "Awaiting";
}

function heatColor(
  region: Region,
  targetHz: number,
  tolerance: number,
): string {
  if (region.averageFrequency == null) return "#5a6470";
  const deviation = Math.abs(
    centsDifference(region.averageFrequency, targetHz),
  );
  if (deviation <= tolerance) return "#4f8e78";
  if (deviation <= tolerance * 2) return "#c7a44f";
  if (deviation <= tolerance * 4) return "#c68149";
  return "#b75a4b";
}

function wedgePath(
  startAngle: number,
  endAngle: number,
  innerRadius = 22,
  outerRadius = 48,
): string {
  const start = ((startAngle - 90) * Math.PI) / 180;
  const end = ((endAngle - 90) * Math.PI) / 180;
  const point = (radius: number, radians: number) => [
    50 + Math.cos(radians) * radius,
    50 + Math.sin(radians) * radius,
  ];
  const [outerStartX, outerStartY] = point(outerRadius, start);
  const [outerEndX, outerEndY] = point(outerRadius, end);
  const [innerEndX, innerEndY] = point(innerRadius, end);
  const [innerStartX, innerStartY] = point(innerRadius, start);
  return `M ${outerStartX} ${outerStartY} A ${outerRadius} ${outerRadius} 0 0 1 ${outerEndX} ${outerEndY} L ${innerEndX} ${innerEndY} A ${innerRadius} ${innerRadius} 0 0 0 ${innerStartX} ${innerStartY} Z`;
}

function App({ initialNote = "D4" }: { initialNote?: string }) {
  return (
    <ErrorBoundary>
      <TunerConsole initialNote={initialNote} />
    </ErrorBoundary>
  );
}

function TunerConsole({ initialNote }: { initialNote: string }) {
  const [activeView, setActiveView] = useState<WorkspaceView>("session");
  const [targetNote, setTargetNote] = useState(initialNote);
  const [tolerance, setTolerance] = useState(5);
  const [fileName, setFileName] = useState("");
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const imageRequestRef = useRef(0);
  const [normalizedImageUrl, setNormalizedImageUrl] = useState("");
  const [geometry, setGeometry] = useState<HeadGeometry | null>(null);
  const initialGeometryRef = useRef<HeadGeometry | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [photoStep, setPhotoStep] = useState<PhotoSetupStep>("fit");
  const [anchor, setAnchor] = useState<PhotoAnchor | null>(null);
  const [anchorName, setAnchorName] = useState("");
  const [boundaries, setBoundaries] = useState<number[] | null>(null);
  const [firstBoundary, setFirstBoundary] = useState<number | null>(null);
  const [selectedBoundary, setSelectedBoundary] = useState(0);
  const [boundaryError, setBoundaryError] = useState("");
  const [micState, setMicState] = useState<MicState>("idle");
  const resultsRef = useRef<HTMLElement>(null);
  const [scrollToResults, setScrollToResults] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [message, setMessage] = useState(
    "Upload a top-down image to align the tuning surface.",
  );
  const [currentRegion, setCurrentRegion] = useState(1);
  const [hoveredRegion, setHoveredRegion] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("heatmap");
  const [regions, setRegions] = useState<Region[]>(freshRegions);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState(0);
  const streamRef = useRef<MicrophoneHandle | null>(null);
  const mountedRef = useRef(true);
  const microphoneRequestRef = useRef(0);
  const onsetRef = useRef(new OnsetDetector());
  const strikeCaptureRef = useRef<StrikeCapture | null>(null);
  const lastFrameUiUpdateRef = useRef(0);
  const regionsRef = useRef(regions);
  const currentRegionRef = useRef(currentRegion);
  const targetHzRef = useRef(noteNameToFrequency(targetNote));
  const toleranceRef = useRef(tolerance);

  const targetHz = useMemo(() => noteNameToFrequency(targetNote), [targetNote]);
  const selectedRegion =
    regions.find((region) => region.id === currentRegion) ?? regions[0];
  const measuredFrequency = selectedRegion.averageFrequency;
  const measuredNote =
    measuredFrequency == null ? "—" : frequencyToNoteName(measuredFrequency);
  const measuredCents =
    measuredFrequency == null
      ? Number.NaN
      : centsDifference(measuredFrequency, targetHz);
  const hoveredOrSelected = hoveredRegion ?? currentRegion;
  const completedCount = regions.filter(
    (region) => region.averageFrequency != null,
  ).length;
  const tunedCount = regions.filter(
    (region) => getRegionStatus(region, targetHz, tolerance) === "in-tune",
  ).length;
  const totalStrikes = regions.reduce(
    (total, region) => total + region.strikes.length,
    0,
  );
  const alignmentLocked =
    totalStrikes > 0 || micState === "ready" || micState === "requesting";
  const photoReady =
    photoStep === "ready" &&
    anchor !== null &&
    Boolean(anchorName.trim()) &&
    Boolean(normalizedImageUrl) &&
    boundaries !== null;
  const regionArc = (id: number) =>
    boundaries
      ? boundaryArc(id, boundaries)
      : {
          start: (id - 1) * 45 - 22.5,
          end: (id - 1) * 45 + 22.5,
          center: (id - 1) * 45,
        };
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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      microphoneRequestRef.current += 1;
      imageRequestRef.current += 1;
      streamRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!scrollToResults) return;
    if (activeView !== "session" || micState !== "idle") {
      setScrollToResults(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const results = resultsRef.current;
      results?.focus({ preventScroll: true });
      results?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      setScrollToResults(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToResults, activeView, micState]);

  const processPitch = useCallback((frequency: number, confidence: number) => {
    const regionId = currentRegionRef.current;
    const target = targetHzRef.current;
    const current = regionsRef.current.find((region) => region.id === regionId);
    if (!current || current.strikes.length >= 3) return;

    const reference =
      current.strikes.length > 0 ? median(current.strikes) : target;
    const normalizedFrequency = normalizeFrequencyToReference(
      frequency,
      reference,
    );

    if (confidence < 0.46 || !Number.isFinite(normalizedFrequency)) {
      setRejectedCount((count) => count + 1);
      setMessage(
        "No stable pitch registered. Strike once, let it ring, and try again.",
      );
      return;
    }

    if (current.strikes.length > 0) {
      const center = median(current.strikes);
      const signedDifference = centsDifference(normalizedFrequency, center);
      const spread = Math.abs(signedDifference);
      if (!Number.isFinite(spread) || spread > MAX_STRIKE_VARIANCE_CENTS) {
        const candidateTargetDistance = Math.abs(
          centsDifference(normalizedFrequency, target),
        );
        const centerTargetDistance = Math.abs(centsDifference(center, target));

        // If the first accepted strike was an octave/error outlier, allow a
        // clearly better candidate to restart the cluster instead of trapping
        // every later strike behind the stale reference.
        if (
          current.strikes.length === 1 &&
          candidateTargetDistance + 60 < centerTargetDistance
        ) {
          const nextRegions = regionsRef.current.map((region) =>
            region.id === regionId
              ? {
                  ...region,
                  strikes: [normalizedFrequency],
                  averageFrequency: null,
                  confidence: Math.min(1, confidence),
                }
              : region,
          );
          regionsRef.current = nextRegions;
          setRegions(nextRegions);
          setMessage(
            "The first reading was unstable. Re-centered on the clearer strike; repeat it twice.",
          );
          return;
        }

        setRejectedCount((count) => count + 1);
        setMessage(
          `Pitch jump ${formatCents(signedDifference)}. Keep the same spot, let it ring, and strike again.`,
        );
        return;
      }
    }

    const strikes = [...current.strikes, normalizedFrequency];
    const averageFrequency = strikes.length === 3 ? median(strikes) : null;
    const nextRegions = regionsRef.current.map((region) =>
      region.id === regionId
        ? {
            ...region,
            strikes,
            averageFrequency,
            confidence: Math.min(1, confidence),
          }
        : region,
    );
    regionsRef.current = nextRegions;
    setRegions(nextRegions);

    if (strikes.length < 3) {
      setMessage(
        `Strike ${strikes.length} of 3 accepted for ${current.label}.`,
      );
      return;
    }

    const next = nextRegions.find((region) => region.averageFrequency == null);
    const cents = centsDifference(averageFrequency ?? frequency, target);
    if (next) {
      currentRegionRef.current = next.id;
      setCurrentRegion(next.id);
      setMessage(
        `${current.label} complete at ${formatCents(cents)}. Continue with ${next.label}.`,
      );
    } else {
      setMessage(
        "All eight regions captured. Review the heat map and adjust any warm regions.",
      );
    }
  }, []);

  const finalizeStrikeCapture = useCallback(() => {
    const capture = strikeCaptureRef.current;
    if (!capture) return;

    strikeCaptureRef.current = null;
    if (capture.samples.length === 0) {
      setRejectedCount((count) => count + 1);
      setMessage(
        "No stable pitch registered. Strike once, let it ring, and try again.",
      );
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
    setBoundaryError("");
    setPhotoStep("fit");
    setViewMode("overlay");
  };

  const changePhotoStep = (step: PhotoSetupStep) => {
    if (alignmentLocked) return;
    if (step === "ready" && !boundaries) return;
    setPhotoStep(step);
    setSetupOpen(true);
    setViewMode("overlay");
    if (step === "fit") setAnchor(null);
    if (step === "fit") {
      setBoundaries(null);
      setFirstBoundary(null);
      setBoundaryError("");
    }
    setMessage(
      step === "fit"
        ? "Drag, zoom, and rotate the photo to fit the head inside the circle."
        : "Tap a physical mark near the rim, then name it and confirm it as R1.",
    );
  };

  const chooseAnchor = (next: PhotoAnchor) => {
    if (alignmentLocked || photoStep !== "anchor") return;
    setAnchor(next);
    setBoundaryError("");
    setHoveredRegion(null);
    setCurrentRegion(1);
    currentRegionRef.current = 1;
    setMessage(
      "Anchor placed. Name the physical mark and confirm that you can find it on the actual tabla.",
    );
  };

  const confirmAnchor = () => {
    if (alignmentLocked || !anchor || !anchorName.trim()) return;
    setAnchorName(anchorName.trim());
    setPhotoStep(boundaries ? "review" : "boundaries");
    setBoundaryError("");
    setMessage(
      boundaries
        ? "Orientation anchor updated. Your region boundaries are unchanged."
        : "Orientation anchor saved. Now separately select strap 1 and strap 3 to define the first region.",
    );
  };

  const placeBoundary = (angle: number) => {
    if (alignmentLocked || !anchor) return;
    setBoundaryError("");
    if (photoStep === "review" && boundaries) {
      const next = moveBoundary(boundaries, selectedBoundary, angle);
      if (!next) {
        setBoundaryError(
          "Keep this strap between its neighboring boundaries. The orientation anchor stays separate.",
        );
        return;
      }
      setBoundaries(next);
      return;
    }
    if (photoStep !== "boundaries") return;
    if (firstBoundary === null) {
      setFirstBoundary(angle);
      setMessage(
        "Strap 1 set. Count clockwise past strap 2 and tap boundary strap 3.",
      );
      return;
    }
    const next = autofillBoundaries(firstBoundary, angle);
    if (!next) {
      setBoundaryError(
        "Choose strap 3 clockwise from strap 1, with one middle strap between the two boundaries. If the first edge is wrong, reselect the boundaries.",
      );
      return;
    }
    setBoundaries(next);
    setSelectedBoundary(2);
    setPhotoStep("review");
    setMessage(
      "Eight regions filled. Check each estimated boundary against the straps, adjust if needed, then confirm.",
    );
  };

  const confirmRegions = () => {
    if (alignmentLocked || !boundaries || !anchor || !anchorName.trim()) return;
    setPhotoStep("ready");
    setSetupOpen(false);
    setCurrentRegion(1);
    currentRegionRef.current = 1;
    setMessage(
      `Orientation reference: “${anchorName}”. R1 spans your selected straps 1–3. Start the microphone when ready.`,
    );
  };

  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || alignmentLocked) return;
    const request = ++imageRequestRef.current;
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (request !== imageRequestRef.current) return;
      // A capture made while the file picker was open must not be remapped.
      if (
        regionsRef.current.some((region) => region.strikes.length > 0) ||
        streamRef.current
      )
        return;
      const result = detectTablaHead(image);
      const next = result?.geometry ?? {
        centerX: image.naturalWidth / 2,
        centerY: image.naturalHeight / 2,
        radiusX: Math.min(image.naturalWidth, image.naturalHeight) * 0.45,
        radiusY: Math.min(image.naturalWidth, image.naturalHeight) * 0.45,
        rotation: 0,
        confidence: 0,
      };
      const canvas =
        result?.normalizedCanvas ?? renderTablaReference(image, next);
      if (!canvas) {
        setMessage(
          "This photo could not be processed. Try another JPG, PNG, or WebP image.",
        );
        return;
      }
      sourceImageRef.current = image;
      initialGeometryRef.current = next;
      setAnchor(null);
      setAnchorName("");
      setBoundaries(null);
      setFirstBoundary(null);
      setBoundaryError("");
      setPhotoStep("fit");
      setSetupOpen(true);
      setGeometry(next);
      setNormalizedImageUrl(canvas.toDataURL("image/jpeg", 0.9));
      setFileName(file.name);
      setViewMode("overlay");
      setActiveView("session");
      setMessage(
        result
          ? "Photo loaded. Drag the image to fit the circle, then choose a physical R1 anchor."
          : "Head not detected. Use the photo alignment controls to center and size the head manually.",
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      if (request === imageRequestRef.current)
        setMessage(
          "This image could not be opened. Try a JPG, PNG, or WebP photo.",
        );
    };
    image.src = objectUrl;
  };

  const stopMicrophone = useCallback((showResults = false) => {
    microphoneRequestRef.current += 1;
    streamRef.current?.stop();
    streamRef.current = null;
    strikeCaptureRef.current = null;
    onsetRef.current.reset();
    setInputLevel(0);
    setNoiseFloor(0);
    setMicState("idle");
    setScrollToResults(showResults);
    setMessage(
      showResults
        ? "Microphone stopped. Review the captured results below."
        : "Microphone stopped. Start it only when you are ready to measure.",
    );
  }, []);

  const requestMicrophone = async () => {
    if (micState === "ready" || micState === "requesting") return;
    if (!photoReady) {
      setMessage(
        "Fit the photo, set the R1 anchor and boundary straps, then confirm the region map before starting the microphone.",
      );
      return;
    }
    imageRequestRef.current += 1;
    const microphoneRequest = ++microphoneRequestRef.current;
    setMicState("requesting");
    setMessage("Waiting for microphone permission…");
    try {
      const handle = await startMicrophone((frame) => {
        if (
          !mountedRef.current ||
          microphoneRequest !== microphoneRequestRef.current
        )
          return;
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
            capture.samples.push({
              frequency: pitch.frequency,
              confidence: pitch.confidence,
            });
          }
        } else {
          finalizeStrikeCapture();
        }
      });
      // Permission can resolve after the user leaves the tuning tab or homepage.
      if (
        !mountedRef.current ||
        microphoneRequest !== microphoneRequestRef.current
      ) {
        handle.stop();
        return;
      }
      streamRef.current = handle;
      setMicState("ready");
      setMessage(
        "Microphone is listening. Strike the highlighted region three times.",
      );
    } catch {
      if (
        !mountedRef.current ||
        microphoneRequest !== microphoneRequestRef.current
      )
        return;
      setMicState("denied");
      setMessage(
        "Microphone access is required to analyze tabla strikes. Allow access and retry.",
      );
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
    setMessage(
      "Measurements cleared. Find your physical R1 anchor before starting the next pass.",
    );
  };

  const clearSelectedRegion = () => {
    const next = regionsRef.current.map((region) =>
      region.id === currentRegion
        ? { ...region, strikes: [], averageFrequency: null, confidence: 0 }
        : region,
    );
    regionsRef.current = next;
    setRegions(next);
    setMessage(`${selectedRegion.label} cleared. Capture three fresh strikes.`);
  };

  const photoPreview = (
    <div
      data-testid="photo-overlay"
      className={`relative aspect-square ${setupOpen ? "photo-setup-preview" : "w-full max-w-[430px]"}`}
    >
      <div
        className={`absolute inset-0 rounded-full border border-[#39424e] bg-[#20242b] shadow-[inset_0_0_0_10px_#191c21,inset_0_0_0_11px_#303640] ${geometry ? "instrument-ring" : ""}`}
      >
        {viewMode === "overlay" && normalizedImageUrl ? (
          <>
            {geometry && sourceImageRef.current && (
              <PhotoCanvas image={sourceImageRef.current} geometry={geometry} />
            )}
          </>
        ) : (
          <div className="absolute inset-[22px] rounded-full bg-[radial-gradient(circle_at_48%_40%,#5c5145_0%,#3c3835_35%,#292b2e_65%,#1c2025_100%)] opacity-90">
            <div className="absolute left-1/2 top-1/2 h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#b99b72]/30 bg-[#292725] shadow-[0_0_30px_rgba(202,160,91,.12)]" />
          </div>
        )}
      </div>
      <svg
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {(boundaries ? regions : []).map((region) => {
          const color = heatColor(region, targetHz, tolerance);
          return (
            <path
              key={region.id}
              d={wedgePath(
                regionArc(region.id).start,
                regionArc(region.id).end,
              )}
              fill={color}
              fillOpacity={
                photoStep === "fit"
                  ? 0.04
                  : viewMode === "overlay"
                    ? hoveredOrSelected === region.id
                      ? 0.32
                      : 0.12
                    : 0.78
              }
              stroke={hoveredOrSelected === region.id ? "#f0c276" : "#2e3640"}
              strokeWidth={hoveredOrSelected === region.id ? 0.85 : 0.45}
              className={`${photoReady ? "pointer-events-auto cursor-pointer" : "pointer-events-none"} transition-[fill-opacity]`}
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
      {boundaries &&
        regions.map((region) => {
          const rad = (regionArc(region.id).center - 90) * (Math.PI / 180);
          const markerRadius = photoReady ? 39 : 28;
          const left = 50 + Math.cos(rad) * markerRadius;
          const top = 50 + Math.sin(rad) * markerRadius;
          const active = hoveredOrSelected === region.id;
          const inTune =
            getRegionStatus(region, targetHz, tolerance) === "in-tune";
          return (
            <button
              key={region.id}
              data-testid={`button-region-${region.id}`}
              disabled={!photoReady}
              onMouseEnter={() => setHoveredRegion(region.id)}
              onMouseLeave={() => setHoveredRegion(null)}
              onClick={() => {
                setCurrentRegion(region.id);
                currentRegionRef.current = region.id;
                setMessage(
                  `${region.label} selected. ${3 - region.strikes.length} strikes remaining.`,
                );
              }}
              aria-label={`Select Region ${region.id}, ${region.label}`}
              aria-pressed={currentRegion === region.id}
              onFocus={() => setHoveredRegion(region.id)}
              onBlur={() => setHoveredRegion(null)}
              className={`absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border font-mono text-[10px] transition ${active ? "border-[#e4ae5d] bg-[#d6a354] text-[#17181c] shadow-[0_0_0_4px_rgba(214,163,84,.15)]" : inTune ? "border-[#82c8a0]/70 bg-[#274538] text-[#9fdbb6]" : "border-[#596270] bg-[#1a1e24] text-[#a1a9b3] hover:border-[#d6a354]/70"}`}
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <span className="font-semibold">R{region.id}</span>
              <span className="text-[8px]">{strapRange(region.id)}</span>
            </button>
          );
        })}
      {(boundaries || firstBoundary !== null) && (
        <svg
          data-testid="strap-boundary-pins"
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
          aria-label="Shared boundary straps"
        >
          {(boundaries ?? [firstBoundary!]).map((angle, index) => {
            const x = 50 + Math.sin((angle * Math.PI) / 180) * 47;
            const y = 50 - Math.cos((angle * Math.PI) / 180) * 47;
            return (
              <g key={index}>
                <line
                  x1={50 + Math.sin((angle * Math.PI) / 180) * 22}
                  y1={50 - Math.cos((angle * Math.PI) / 180) * 22}
                  x2={x}
                  y2={y}
                  stroke="#edc17b"
                  strokeWidth="0.5"
                />
                <circle
                  cx={x}
                  cy={y}
                  r="2.1"
                  fill={
                    photoStep === "review" && selectedBoundary === index
                      ? "#edc17b"
                      : "#20242b"
                  }
                  stroke="#edc17b"
                  strokeWidth="0.4"
                />
                <text
                  x={x}
                  y={y + 0.8}
                  textAnchor="middle"
                  fill={
                    photoStep === "review" && selectedBoundary === index
                      ? "#12151a"
                      : "#edc17b"
                  }
                  fontSize="2.2"
                >
                  {index * 2 + 1}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {setupOpen && (
        <svg
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke={photoStep === "fit" ? "#f2bb62" : "#8ddbd5"}
            strokeWidth="0.8"
            strokeDasharray={photoStep === "fit" ? undefined : "2 2"}
          />
          {photoStep === "fit" && (
            <path
              d="M 45 50 H 55 M 50 45 V 55"
              stroke="#f2bb62"
              strokeWidth="0.6"
            />
          )}
        </svg>
      )}
      {anchor && (
        <svg
          data-testid="anchor-pin"
          aria-label={`Orientation anchor A: ${anchorName || "unnamed mark"}`}
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
        >
          <line
            x1="50"
            y1="50"
            x2={
              50 +
              Math.sin((anchor.angle * Math.PI) / 180) * anchor.radius * 100
            }
            y2={
              50 -
              Math.cos((anchor.angle * Math.PI) / 180) * anchor.radius * 100
            }
            stroke="#8ddbd5"
            strokeWidth="0.5"
            strokeDasharray="1.5 1.5"
          />
          <path
            transform={`translate(${50 + Math.sin((anchor.angle * Math.PI) / 180) * anchor.radius * 100}, ${50 - Math.cos((anchor.angle * Math.PI) / 180) * anchor.radius * 100})`}
            d="M 0 -2 L 2 0 L 0 2 L -2 0 Z"
            fill="#8ddbd5"
            stroke="#10272a"
            strokeWidth="0.5"
          />
        </svg>
      )}
      {setupOpen &&
        geometry &&
        normalizedImageUrl &&
        photoStep !== "ready" &&
        !alignmentLocked && (
          <PhotoInteraction
            mode={photoStep}
            geometry={geometry}
            shortestSide={
              sourceImageRef.current
                ? Math.min(
                    sourceImageRef.current.naturalWidth,
                    sourceImageRef.current.naturalHeight,
                  )
                : 820
            }
            onChange={updatePhotoGeometry}
            onAnchor={(point) =>
              photoStep === "anchor"
                ? chooseAnchor(point)
                : placeBoundary(point.angle)
            }
            onInvalidAnchor={() => {
              setBoundaryError(
                "For an anchor, tap a recognizable off-center mark. For a boundary, tap a strap near the outer rim.",
              );
              setMessage("Tap a visible feature near the outer rim.");
            }}
          />
        )}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center">
        <span className="font-mono text-[9px] uppercase tracking-[.2em] text-[#9b8a70]">
          dayan
        </span>
        <span
          data-testid="text-target-on-surface"
          className="mt-1 font-mono text-[18px] text-[#dfb875]"
        >
          {targetNote}
        </span>
      </div>
    </div>
  );
  const photoControls = (
    <>
      {geometry && sourceImageRef.current && (
        <PhotoAlignment
          image={sourceImageRef.current}
          geometry={geometry}
          locked={alignmentLocked}
          step={photoStep}
          anchor={anchor}
          anchorName={anchorName}
          onChange={updatePhotoGeometry}
          onReset={() => {
            if (initialGeometryRef.current)
              updatePhotoGeometry(initialGeometryRef.current);
          }}
          onStep={changePhotoStep}
          onAnchor={chooseAnchor}
          onAnchorName={setAnchorName}
          onConfirm={confirmAnchor}
        >
          {(photoStep === "boundaries" || photoStep === "review") && (
            <StrapBoundaries
              boundaries={boundaries}
              firstBoundary={firstBoundary}
              selected={selectedBoundary}
              error={boundaryError}
              locked={alignmentLocked}
              onSelect={(index) => {
                setSelectedBoundary(index);
                setBoundaryError("");
              }}
              onPlace={placeBoundary}
              onRestart={() => {
                setBoundaries(null);
                setFirstBoundary(null);
                setBoundaryError("");
                setPhotoStep("boundaries");
              }}
              onConfirm={confirmRegions}
              onBack={() => changePhotoStep("anchor")}
            />
          )}
        </PhotoAlignment>
      )}
    </>
  );

  const openPhotoSetup = () => {
    if (alignmentLocked) return;
    if (photoReady) changePhotoStep("fit");
    else {
      setSetupOpen(true);
      setViewMode("overlay");
    }
  };
  const currentStep = !normalizedImageUrl ? 0 : !photoReady ? 1 : 2;
  const selectTarget = (value: string) => {
    setTargetNote(value);
    setMessage(
      "Target updated. Your captured strikes are now compared with the new note.",
    );
  };
  const targetControls = (
    <>
      <label className="tune-label" htmlFor="target-note">
        Target note <span>A4 = 440 Hz</span>
      </label>
      <div className="tune-select-wrap">
        <select
          id="target-note"
          data-testid="select-target-note"
          value={targetNote}
          onChange={(event) => selectTarget(event.target.value)}
        >
          {SUPPORTED_NOTES.map((note) => (
            <option key={note} value={note}>
              {note} — {formatHz(noteNameToFrequency(note))} Hz
            </option>
          ))}
        </select>
        <ChevronDown size={17} />
      </div>
      <fieldset className="tune-tolerance">
        <legend className="tune-label">
          In-tune tolerance <span>cents</span>
        </legend>
        <div>
          {TARGET_TOLERANCES.map((value) => (
            <button
              key={value}
              data-testid={`button-tolerance-${value}`}
              aria-pressed={tolerance === value}
              onClick={() => setTolerance(value)}
            >
              ±{value}¢
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );

  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => {
        if (micState === "ready" || micState === "requesting") stopMicrophone();
        setActiveView(value as WorkspaceView);
      }}
      className="tune-workspace"
    >
      <PhotoSetupModal
        open={setupOpen}
        onOpenChange={setSetupOpen}
        step={photoStep}
        firstBoundary={firstBoundary}
        selectedBoundary={selectedBoundary}
        anchorPlaced={anchor !== null}
        anchorName={anchorName}
        preview={photoPreview}
        controls={photoControls}
        error={boundaryError}
      />
      <header className="tune-nav">
        <a href="#" className="brand" aria-label="Dayan home">
          <AudioLines size={24} strokeWidth={1.5} />
          <span>
            DAYAN<span className="brand-dot">.</span>
          </span>
          <span className="brand-detail">TABLA TUNER</span>
        </a>
        <TabsList className="tune-nav-tabs" aria-label="Tuning workspace">
          <TabsTrigger value="session" data-testid="button-session-active">
            Tuning session
          </TabsTrigger>
          <TabsTrigger value="guide" data-testid="button-guide">
            How it works
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="button-settings">
            Settings
          </TabsTrigger>
        </TabsList>
        <a href="#" className="tune-home-link">
          <ArrowUpLeft size={15} /> Back to home
        </a>
      </header>
      <main className="tune-main">
        <TabsContent value="session" className="tune-tab-content">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="tune-page-heading">
              <div>
                <p className="tune-eyebrow">
                  <span>01 /</span> YOUR TUNING SESSION
                </p>
                <h1>FIND YOUR BALANCE.</h1>
                <p>One drum. Eight regions. A clearer picture of your sound.</p>
              </div>
              <div className="tune-session-meta">
                <span
                  className={`tune-live-status ${micState === "ready" ? "is-live" : ""}`}
                  data-testid="status-session"
                >
                  <i />
                  {micState === "ready" ? "MICROPHONE LIVE" : "MICROPHONE OFF"}
                </span>
                <span>
                  <ShieldCheck size={14} /> Private, on your device
                </span>
              </div>
            </div>
            <ol className="tune-steps" aria-label="Tuning progress">
              {[
                {
                  title: "Frame your tabla",
                  detail: normalizedImageUrl
                    ? "Photo added"
                    : "Add a top-down photo",
                  icon: Camera,
                },
                {
                  title: "Make your map",
                  detail: photoReady
                    ? "Eight regions aligned"
                    : "Fit, anchor, and align",
                  icon: Crosshair,
                },
                {
                  title: "Find your sound",
                  detail: `${completedCount} of 8 regions captured`,
                  icon: AudioLines,
                },
              ].map(({ title, detail, icon: Icon }, index) => (
                <li
                  key={title}
                  className={
                    currentStep === index
                      ? "is-current"
                      : currentStep > index
                        ? "is-complete"
                        : ""
                  }
                  aria-current={currentStep === index ? "step" : undefined}
                >
                  <span className="tune-step-number">
                    {currentStep > index ? (
                      <Check size={17} />
                    ) : (
                      `0${index + 1}`
                    )}
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <span>{detail}</span>
                  </div>
                  <Icon size={20} strokeWidth={1.3} />
                </li>
              ))}
            </ol>
            {isTuned && (
              <div
                className="tune-success"
                data-testid="status-dayan-tuned"
                role="status"
              >
                <Check size={20} />
                <div>
                  <strong>Your dayan is in tune.</strong>
                  <p>
                    All eight regions are within ±{tolerance} cents of{" "}
                    {targetNote}.
                  </p>
                </div>
              </div>
            )}
            <div className="tune-session-grid">
              <section
                className="tune-panel tune-surface-panel"
                aria-labelledby="surface-heading"
              >
                <div className="tune-panel-heading">
                  <div>
                    <p className="tune-eyebrow">YOUR INSTRUMENT</p>
                    <h2 id="surface-heading">THE TUNING SURFACE.</h2>
                  </div>
                  {normalizedImageUrl && (
                    <div
                      className="tune-view-toggle"
                      aria-label="Surface display"
                    >
                      {(["overlay", "heatmap"] as const).map((mode) => (
                        <button
                          key={mode}
                          data-testid={`button-view-${mode}`}
                          aria-pressed={viewMode === mode}
                          disabled={mode === "heatmap" && !photoReady}
                          onClick={() => setViewMode(mode)}
                        >
                          {mode === "overlay" ? "Photo" : "Heat map"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  className={`tune-upload-actions ${normalizedImageUrl ? "has-photo" : ""}`}
                >
                  <label
                    className={`tune-button ${normalizedImageUrl ? "tune-button-secondary" : ""}`}
                    data-testid="button-upload-image"
                  >
                    <Upload size={16} />
                    {normalizedImageUrl ? "Replace photo" : "Upload your photo"}
                    <input
                      data-testid="input-upload-image"
                      type="file"
                      accept="image/*"
                      onChange={handleImage}
                      disabled={alignmentLocked}
                    />
                  </label>
                  <label className="tune-button tune-button-secondary">
                    <Camera size={16} />
                    Take a photo
                    <input
                      data-testid="input-camera-photo"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImage}
                      disabled={alignmentLocked}
                    />
                  </label>
                </div>
                {normalizedImageUrl ? (
                  <>
                    <div className="tune-photo-stage">
                      <span className="tune-stage-caption">
                        {photoReady
                          ? `REGION ${currentRegion} / STRAPS ${selectedRegion.short}`
                          : "PHOTO SETUP / PREVIEW"}
                      </span>
                      <span className="tune-stage-direction">CLOCKWISE ↻</span>
                      {!setupOpen && photoPreview}
                      <span className="tune-photo-anchor">
                        {photoReady
                          ? `◆ ${anchorName} · orientation mark`
                          : "Continue setup to align your regions"}
                      </span>
                    </div>
                    <div className="tune-photo-actions">
                      <div>
                        <span className="tune-file-name">{fileName}</span>
                        <p>
                          {alignmentLocked
                            ? "Stop the mic and clear the pass to edit your map."
                            : photoReady
                              ? "Your map is ready. Match the orientation mark on your tabla."
                              : "Fit the photo, add an anchor, and confirm the boundary straps."}
                        </p>
                      </div>
                      <Button
                        data-testid="button-open-photo-setup"
                        className="tune-button tune-button-secondary"
                        disabled={alignmentLocked}
                        onClick={openPhotoSetup}
                      >
                        {photoReady ? "Edit map" : "Continue setup"}
                        <ArrowUpRight size={16} />
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="tune-empty-state">
                    <RegionReference />
                    <h3>One head. Eight tuning regions.</h3>
                    <p>
                      Each region spans three straps and shares its edges with
                      its neighbours. Select a region to see its boundary
                      straps, then upload your photo to make your own map.
                    </p>
                  </div>
                )}
                {!normalizedImageUrl && (
                  <p className="tune-upload-note">
                    <ShieldCheck size={13} /> Your photo stays in this browser.
                  </p>
                )}
              </section>
              <section
                className="tune-panel tune-listening-panel"
                aria-labelledby="listen-heading"
              >
                <div className="tune-panel-heading">
                  <div>
                    <p className="tune-eyebrow">LISTEN WITH INTENTION</p>
                    <h2 id="listen-heading">YOUR SOUND.</h2>
                  </div>
                  <AudioLines size={24} strokeWidth={1.3} />
                </div>
                <div className="tune-control-body">
                  {targetControls}
                  <div className="tune-readout">
                    <div className="tune-label">
                      <span>
                        {photoReady
                          ? `Region ${selectedRegion.id} · ${selectedRegion.strikes.length}/3 strikes`
                          : "Detected pitch"}
                      </span>
                      <span>
                        {measuredFrequency == null
                          ? "AWAITING STRIKES"
                          : statusLabel(
                              getRegionStatus(
                                selectedRegion,
                                targetHz,
                                tolerance,
                              ),
                            )}
                      </span>
                    </div>
                    <div className="tune-readout-values">
                      <strong data-testid="text-measured-note">
                        {measuredNote}
                      </strong>
                      <div>
                        <span data-testid="text-measured-frequency">
                          {formatHz(measuredFrequency)} Hz
                        </span>
                        <span data-testid="text-measured-cents">
                          {formatCents(measuredCents)}
                        </span>
                      </div>
                    </div>
                    <div
                      className="tune-pitch-scale"
                      aria-label={
                        measuredFrequency == null
                          ? "No pitch measured"
                          : `${formatCents(measuredCents)} from target`
                      }
                    >
                      <span>FLAT</span>
                      <div>
                        <i className="tune-center-mark" />
                        {measuredFrequency != null && (
                          <i
                            className="tune-pitch-needle"
                            style={{
                              left: `${50 + Math.max(-50, Math.min(50, measuredCents))}%`,
                            }}
                          />
                        )}
                      </div>
                      <span>SHARP</span>
                    </div>
                    <div className="tune-readout-target">
                      <span>TARGET {targetNote}</span>
                      <span data-testid="text-target-frequency">
                        {formatHz(targetHz)} Hz
                      </span>
                    </div>
                  </div>
                  <div className="tune-input">
                    <div className="tune-label">
                      <span>Input monitor</span>
                      <span>
                        {micState === "ready" ? "LISTENING" : "MIC OFF"}
                      </span>
                    </div>
                    <div
                      className={`tune-input-bars ${micState === "ready" ? "is-live" : ""}`}
                      aria-hidden="true"
                    >
                      {Array.from({ length: 40 }, (_, index) => (
                        <span
                          key={index}
                          style={{
                            height: `${micState === "ready" ? Math.max(3, Math.min(36, inputLevel * 340 + ((index * 5) % 8))) : 3}px`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <Button
                    data-testid="button-microphone-access"
                    className={`tune-button tune-mic-button ${micState === "ready" ? "is-recording" : ""}`}
                    onClick={() =>
                      micState === "ready"
                        ? stopMicrophone(true)
                        : void requestMicrophone()
                    }
                    disabled={
                      micState === "requesting" ||
                      (!photoReady && micState !== "ready")
                    }
                  >
                    {micState === "ready" ? (
                      <Square size={14} fill="currentColor" />
                    ) : (
                      <Mic size={17} />
                    )}
                    {micState === "requesting"
                      ? "Requesting access…"
                      : micState === "ready"
                        ? "Stop microphone"
                        : micState === "denied"
                          ? "Retry microphone"
                          : "Start microphone"}
                    {micState !== "ready" && <ArrowUpRight size={16} />}
                  </Button>
                  <p
                    className="tune-status-message"
                    data-testid="status-instruction"
                    role="status"
                    aria-live="polite"
                  >
                    {message}
                  </p>
                </div>
              </section>
            </div>
            <section
              ref={resultsRef}
              data-testid="tuning-results"
              tabIndex={-1}
              aria-labelledby="results-heading"
              className="tune-results"
            >
              <div className="tune-results-heading">
                <div>
                  <p className="tune-eyebrow">
                    <span>02 /</span> THE WHOLE PICTURE
                  </p>
                  <h2 id="results-heading">EVERY REGION. EVERY DETAIL.</h2>
                </div>
                <div className="tune-results-actions">
                  <span data-testid="text-progress">
                    <strong>{completedCount}</strong> / 8 regions
                  </span>
                  <Button
                    data-testid="button-reset-measurements"
                    className="tune-button tune-button-secondary"
                    onClick={resetMeasurements}
                    disabled={totalStrikes === 0}
                  >
                    <RotateCcw size={14} />
                    Clear pass
                  </Button>
                </div>
              </div>
              <div className="tune-results-grid">
                <div className="tune-panel">
                  <div className="tune-table-header">
                    <span>REGION / STRAPS</span>
                    <span>PITCH BALANCE</span>
                    <span>CENTS</span>
                    <span>STATUS</span>
                  </div>
                  <div className="tune-region-rows">
                    {regions.map((region) => (
                      <HeatRow
                        key={region.id}
                        region={region}
                        targetHz={targetHz}
                        tolerance={tolerance}
                        active={currentRegion === region.id}
                        disabled={!photoReady}
                        onHover={setHoveredRegion}
                        onClick={() => {
                          setCurrentRegion(region.id);
                          currentRegionRef.current = region.id;
                        }}
                      />
                    ))}
                  </div>
                  <div className="tune-table-footer">
                    <span data-testid="text-measurement-count">
                      {totalStrikes} / 24 strikes captured
                    </span>
                    <span>{rejectedCount} rejected</span>
                    <div
                      role="progressbar"
                      aria-label="Strikes captured"
                      aria-valuemin={0}
                      aria-valuemax={24}
                      aria-valuenow={totalStrikes}
                    >
                      <i style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
                <aside className="tune-panel tune-guidance">
                  <p className="tune-eyebrow">A LITTLE DIRECTION</p>
                  <h3>
                    {isTuned
                      ? "That’s your sweet spot."
                      : !photoReady
                        ? "First, make it yours."
                        : completedCount === 8
                          ? "Listen to the details."
                          : "Let each strike ring."}
                  </h3>
                  <p>
                    {!photoReady
                      ? "Add your photo and align the regions. Your own instrument becomes the map."
                      : selectedRegion.averageFrequency == null
                        ? `Play region ${selectedRegion.id} ${3 - selectedRegion.strikes.length} more time${selectedRegion.strikes.length === 2 ? "" : "s"}. Let each strike decay before the next.`
                        : guidance(selectedRegion, targetHz, tolerance)}
                  </p>
                  <div className="tune-guidance-list">
                    <span>
                      <i className="in-tune" />
                      In tune <small>Within ±{tolerance} cents</small>
                    </span>
                    <span>
                      <i className="near" />
                      Flat <small>Increase tension</small>
                    </span>
                    <span>
                      <i className="far" />
                      Sharp <small>Lower tension</small>
                    </span>
                  </div>
                  <Button
                    data-testid="button-remeasure-selected"
                    className="tune-button tune-button-secondary"
                    disabled={selectedRegion.strikes.length === 0}
                    onClick={clearSelectedRegion}
                  >
                    <RotateCcw size={14} />
                    Re-measure region {selectedRegion.id}
                  </Button>
                  <details className="tune-diagnostics">
                    <summary>Input details</summary>
                    <p>
                      Noise floor: {noiseFloor.toFixed(3)} · Rejected strikes:{" "}
                      {rejectedCount}
                    </p>
                  </details>
                </aside>
              </div>
            </section>
          </motion.div>
        </TabsContent>
        <TabsContent value="guide" className="tune-tab-content">
          <div className="tune-page-heading">
            <div>
              <p className="tune-eyebrow">
                <span>THE FIELD GUIDE /</span> THREE DELIBERATE MOVES
              </p>
              <h1>GET CLOSER TO YOUR SOUND.</h1>
              <p>A clear reference. A consistent strike. A small adjustment.</p>
            </div>
          </div>
          <div className="tune-guide-grid">
            {[
              {
                title: "Frame your tabla.",
                number: "01",
                icon: Camera,
                text: "Photograph the complete dayan head from directly above. Upload it, then drag, zoom, and rotate until the outer head fits the circle.",
                detail: "A clear, top-down photo",
              },
              {
                title: "Make your map.",
                number: "02",
                icon: Crosshair,
                text: "Tap a recognizable mark and give it a name. Then select straps 1 and 3 around the first region. Review all eight boundaries before confirming.",
                detail: "Your anchor keeps the orientation",
              },
              {
                title: "Find your balance.",
                number: "03",
                icon: AudioLines,
                text: "Choose your target, start the microphone, and play three clean strikes in each highlighted region. Continue clockwise, then review and re-measure.",
                detail: "Eight regions. Three strikes each.",
              },
            ].map(({ title, number, icon: Icon, text, detail }) => (
              <article className="tune-panel tune-guide-card" key={number}>
                <div>
                  <Icon size={32} strokeWidth={1.3} />
                  <span className="tune-eyebrow">{number} /</span>
                </div>
                <h2>{title}</h2>
                <p>{text}</p>
                <span className="tune-guide-detail">{detail}</span>
              </article>
            ))}
          </div>
          <div className="tune-guide-bottom">
            <p>
              <ShieldCheck size={19} /> Your photo and microphone audio stay in
              this browser. Nothing listens until you start it.
            </p>
            <Button
              className="tune-button"
              onClick={() => setActiveView("session")}
            >
              Back to your session
              <ArrowUpRight size={16} />
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="settings" className="tune-tab-content">
          <div className="tune-page-heading">
            <div>
              <p className="tune-eyebrow">
                <span>YOUR INSTRUMENT /</span> YOUR PREFERENCES
              </p>
              <h1>TUNE ON YOUR TERMS.</h1>
              <p>
                Choose the reference that suits your instrument and your music.
              </p>
            </div>
          </div>
          <div className="tune-settings-grid">
            <section className="tune-panel">
              <div className="tune-panel-heading">
                <div>
                  <p className="tune-eyebrow">THE REFERENCE</p>
                  <h2>YOUR STARTING NOTE.</h2>
                </div>
                <SlidersHorizontal size={23} />
              </div>
              <div className="tune-control-body">
                {targetControls}
                <p className="tune-settings-description">
                  Changing the target or tolerance updates the comparison for
                  every region. Your captured strikes stay available.
                </p>
              </div>
            </section>
            <section className="tune-panel tune-privacy-card">
              <ShieldCheck size={30} strokeWidth={1.3} />
              <h2>JUST YOU AND YOUR TABLA.</h2>
              <p>
                The microphone only starts when you ask it to, after your region
                map is ready. It stops when you leave the tuning tab or return
                home.
              </p>
              <p>
                Photos and audio are processed in your browser. Your session is
                kept in memory and clears when you return home or reload.
              </p>
              <span className="tune-live-status">
                <i />
                MICROPHONE OFF
              </span>
            </section>
          </div>
          <Button
            className="tune-button tune-settings-back"
            onClick={() => setActiveView("session")}
          >
            Return to your session
            <ArrowUpRight size={16} />
          </Button>
        </TabsContent>
        <footer className="tune-footer">
          <span>DAYAN / TRADITION MEETS PRECISION.</span>
          <span>
            <ShieldCheck size={13} />
            LOCAL TO YOUR BROWSER
          </span>
        </footer>
      </main>
    </Tabs>
  );
}

function guidance(region: Region, targetHz: number, tolerance: number): string {
  if (region.averageFrequency == null) return "No valid measurement yet.";
  const cents = centsDifference(region.averageFrequency, targetHz);
  const status = tuningStatus(cents, tolerance);
  if (status === "in-tune")
    return `Region ${region.id} is in tune at ${formatCents(cents)}.`;
  if (status === "sharp")
    return `Region ${region.id} is sharp by ${Math.abs(Math.round(cents))} cents. Lower tension in this region.`;
  return `Region ${region.id} is flat by ${Math.abs(Math.round(cents))} cents. Increase tension in this region.`;
}

function HeatRow({
  region,
  targetHz,
  tolerance,
  active,
  disabled,
  onHover,
  onClick,
}: {
  region: Region;
  targetHz: number;
  tolerance: number;
  active: boolean;
  disabled: boolean;
  onHover: (id: number | null) => void;
  onClick: () => void;
}) {
  const status = getRegionStatus(region, targetHz, tolerance);
  const cents =
    region.averageFrequency == null
      ? null
      : centsDifference(region.averageFrequency, targetHz);
  const color = heatColor(region, targetHz, tolerance);
  return (
    <button
      data-testid={`row-region-${region.id}`}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`Region ${region.id}, ${region.label}, ${statusLabel(status)}`}
      onFocus={() => onHover(region.id)}
      onBlur={() => onHover(null)}
      onMouseEnter={() => onHover(region.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      className={`tune-region-row ${active && !disabled ? "is-selected" : ""}`}
    >
      <span className="tune-region-name">
        <strong>R{region.id}</strong>
        <span>Straps {region.short}</span>
      </span>
      <span className="tune-region-meter">
        <i className="tune-meter-center" />
        {cents !== null && (
          <i
            className="tune-meter-reading"
            style={{
              left: `${50 + Math.max(-48, Math.min(48, cents))}%`,
              background: color,
            }}
          />
        )}
      </span>
      <span
        className="tune-region-cents"
        style={{ color: cents === null ? undefined : color }}
      >
        {cents === null ? "—" : formatCents(cents)}
      </span>
      <span className={`tune-region-status ${status}`}>
        {statusLabel(status)}
      </span>
    </button>
  );
}

export default App;
