import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Camera,
  Check,
  Crosshair,
  Headphones,
  Menu,
  Pause,
  Play,
  ShieldCheck,
  Waves,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { noteNameToFrequency, SUPPORTED_NOTES } from "./audio/musicTheory";

const TunerApp = lazy(() => import("./TunerApp"));
const asset = (name: string) => `${import.meta.env.BASE_URL}images/${name}`;
const pitches = [
  { note: "C4", name: "The foundation", image: "after-hours.jpg" },
  { note: "C#4", name: "A little brighter", image: "blue-hour.jpg" },
  { note: "D4", name: "Find your center", image: "no-signal.jpg" },
  { note: "D#4", name: "A different shade", image: "slow-burn.jpg" },
  { note: "E4", name: "Clear and present", image: "weightless.jpg" },
  { note: "F4", name: "Into the higher register", image: "concrete.jpg" },
];
const links = [
  ["Reference notes", "notes"],
  ["How it works", "process"],
  ["Features", "features"],
  ["The instrument", "instrument"],
];
const features = [
  ["Photo-guided tuning", "YOUR INSTRUMENT, YOUR MAP", "01"],
  ["Eight tuning regions", "ONE COMPLETE PICTURE", "02"],
  ["Three strikes per region", "CONSISTENCY BEFORE CONFIDENCE", "03"],
  ["Live pitch detection", "FREQUENCY + NOTE + CENTS", "04"],
  ["Adjustable target note", "C3 THROUGH B4", "05"],
  ["Visual pitch heat map", "FLAT · IN TUNE · SHARP", "06"],
  ["Flexible pitch tolerance", "±3 / ±5 / ±10 / ±15 CENTS", "07"],
  ["Private by design", "PHOTO + AUDIO STAY IN YOUR BROWSER", "08"],
];
const faqs = [
  [
    "What do I need to get started?",
    "Your dayan, a quiet space, and a phone or computer with a microphone. Take a clear, top-down photo of the whole drumhead, then follow the guided setup in the tuner. No account or additional equipment is required.",
  ],
  [
    "Which note should I tune to?",
    "Choose the tonic that suits your instrument and the music you are playing. The reference tones below are starting points for listening, not a recommendation to force your tabla into a particular range. The tuner supports C3 through B4.",
  ],
  [
    "How does a tuning pass work?",
    "Fit your photo to the drumhead, mark a recognizable physical point, and set the straps that bound the first region. Work clockwise, giving each of the eight regions three clean strikes. The map shows how each region compares with your chosen target.",
  ],
  [
    "Is my microphone always listening?",
    "No. Microphone access starts only when you press the microphone button after photo setup. You can stop it at any time. Your photo and audio are processed locally in your browser.",
  ],
];

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.5, delay }}
    >
      {children}
    </motion.div>
  );
}

function Waveform() {
  const reduced = useReducedMotion();
  return (
    <div className="hero-waveform" aria-hidden="true">
      {Array.from({ length: 40 }, (_, i) => {
        const seed = ((i * 17 + 13) % 41) / 41;
        return (
          <motion.span
            key={i}
            style={{ height: 8 + seed * 56, opacity: 0.12 + seed * 0.48 }}
            animate={
              reduced ? undefined : { scaleY: [1, 0.2 + seed * 0.65, 1] }
            }
            transition={{
              duration: 0.8 + seed * 0.6,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.04,
            }}
          />
        );
      })}
    </div>
  );
}

function useReferenceTone() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const context = useRef<AudioContext | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const stop = () => {
    request.current += 1;
    if (timeout.current) clearTimeout(timeout.current);
    const current = context.current;
    context.current = null;
    if (current && current.state !== "closed") void current.close();
    setPlaying(null);
  };
  useEffect(
    () => () => {
      request.current += 1;
      if (timeout.current) clearTimeout(timeout.current);
      if (context.current && context.current.state !== "closed")
        void context.current.close();
    },
    [],
  );
  const play = async (note: string) => {
    const same = playing === note;
    stop();
    setError("");
    if (same) return;
    const id = request.current;
    try {
      const audio = new AudioContext();
      context.current = audio;
      await audio.resume();
      if (request.current !== id) return;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = noteNameToFrequency(note);
      gain.gain.setValueAtTime(0, audio.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, audio.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, audio.currentTime + 3.7);
      gain.gain.linearRampToValueAtTime(0, audio.currentTime + 4);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 4);
      setPlaying(note);
      timeout.current = setTimeout(stop, 4100);
    } catch {
      stop();
      setError(
        "Audio could not start. Try again in a browser that supports Web Audio.",
      );
    }
  };
  return { playing, play, stop, error };
}

function Landing({ onStart }: { onStart: (note?: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const tone = useReferenceTone();
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuToggle.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  const start = (note = "D4") => {
    tone.stop();
    onStart(note);
  };
  return (
    <div className="landing">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-nav">
        <a href="#" className="brand" aria-label="Dayan home">
          <AudioLines size={23} strokeWidth={1.5} />
          <span>
            DAYAN<span className="brand-dot">.</span>
          </span>
          <span className="brand-detail">TABLA TUNER</span>
        </a>
        <nav aria-label="Main navigation" className="desktop-nav">
          {links.map(([label, id]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <Button className="site-button nav-cta" onClick={() => start()}>
            Start tuning <ArrowUpRight size={14} />
          </Button>
          <button
            ref={menuToggle}
            className="menu-toggle"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {menuOpen && (
          <nav
            id="mobile-nav"
            className="mobile-nav"
            aria-label="Mobile navigation"
          >
            {links.map(([label, id]) => (
              <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>
                {label}
                <ArrowUpRight size={16} />
              </a>
            ))}
            <a href="#guide" onClick={() => setMenuOpen(false)}>
              Quick guide
              <ArrowUpRight size={16} />
            </a>
          </nav>
        )}
      </header>
      <main id="main">
        <section className="hero">
          <div className="hero-topline">
            <span className="eyebrow">
              <span className="status-dot" /> ROOTED IN TRADITION. TUNED WITH
              PRECISION.
            </span>
            <span className="eyebrow hero-edition">THE DAYAN PROJECT / 01</span>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="resonance-ring ring-one" />
            <div className="resonance-ring ring-two" />
            <div className="resonance-ring ring-three" />
            <img src={asset("tabla.png")} alt="" fetchPriority="high" />
            <span className="art-caption">
              A TIMELESS INSTRUMENT.
              <br />A FINER WAY TO LISTEN.
            </span>
          </div>
          <Reveal className="hero-copy">
            <p className="eyebrow hero-kicker">
              YOUR TABLA. IN PERFECT HARMONY.
            </p>
            <h1>
              FIND YOUR NOTE.
              <br />
              FEEL THE
              <br />
              <span className="resonance-word">RESONANCE.</span>
            </h1>
            <p className="hero-description">
              A little tradition. A little precision. Bring every region of your
              dayan into tune with photo-guided mapping and live pitch analysis.
            </p>
            <div className="hero-actions">
              <Button className="site-button" onClick={() => start()}>
                Tune your tabla <ArrowUpRight size={16} />
              </Button>
              <Button className="site-button ghost-button" asChild>
                <a href="#notes">
                  <Headphones size={16} />
                  Hear the notes
                </a>
              </Button>
            </div>
            <div className="hero-trust">
              <span>
                <Check size={12} /> Free to use
              </span>
              <span>
                <Check size={12} /> No downloads
              </span>
              <span>
                <Check size={12} /> Entirely private
              </span>
            </div>
          </Reveal>
          <Waveform />
          <a href="#notes" className="scroll-cue">
            <ArrowDown size={13} />
            <span>SCROLL TO EXPLORE</span>
          </a>
        </section>
        <div
          className="marquee"
          aria-label="Dha, Dhin, Na, Tin, Ta, Ge, Ke, Tun"
        >
          <div className="marquee-track" aria-hidden="true">
            {[0, 1, 2, 3].map((copy) => (
              <div className="marquee-group" key={copy}>
                {["DHA", "DHIN", "NA", "TIN", "TA", "GE", "KE", "TUN"].map(
                  (bol) => (
                    <span key={bol}>
                      {bol}
                      <i />
                    </span>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        <section className="section-shell" id="notes">
          <Reveal className="section-heading">
            <div>
              <p className="eyebrow">
                <span className="section-index">01 /</span> A PLACE TO BEGIN
              </p>
              <h2>FIND YOUR FREQUENCY.</h2>
            </div>
            <p>
              Every great session starts with a note.
              <br />
              Listen, find your tonic, and make it yours.
            </p>
          </Reveal>
          <div className="pitch-grid">
            {pitches.map((pitch, i) => (
              <Reveal key={pitch.note} delay={(i % 3) * 0.08}>
                <article
                  className={`pitch-card ${tone.playing === pitch.note ? "is-playing" : ""}`}
                >
                  <button
                    className="pitch-art"
                    aria-label={`${tone.playing === pitch.note ? "Stop" : "Play"} ${pitch.note} reference tone`}
                    aria-pressed={tone.playing === pitch.note}
                    onClick={() => void tone.play(pitch.note)}
                  >
                    <img src={asset(pitch.image)} alt="" loading="lazy" />
                    <span className="cover-index">
                      DAYAN / REFERENCE {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="cover-note">
                      {pitch.note.replace("4", "")}
                      <small>4</small>
                    </span>
                    <span className="cover-bottom">
                      PURE TONE<span>440 Hz STANDARD</span>
                    </span>
                    <span className="play-overlay">
                      {tone.playing === pitch.note ? (
                        <Pause size={19} fill="currentColor" />
                      ) : (
                        <Play size={19} fill="currentColor" />
                      )}
                    </span>
                  </button>
                  <div className="pitch-info">
                    <div>
                      <h3>
                        {pitch.note} <span>— {pitch.name}</span>
                      </h3>
                      <p className="eyebrow">
                        REFERENCE TONE{" "}
                        <span>
                          {noteNameToFrequency(pitch.note).toFixed(2)} Hz
                        </span>
                      </p>
                    </div>
                    <button
                      className="pitch-select"
                      aria-label={`Tune to ${pitch.note}`}
                      onClick={() => start(pitch.note)}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
          <div className="notes-footer">
            <span>
              <Headphones size={13} /> Synthesized reference tones · listen at a
              comfortable volume
            </span>
            <span>
              FULL RANGE C3—B4 IN THE TUNER <ArrowUpRight size={12} />
            </span>
          </div>
          <p className="sr-only" role="status">
            {tone.playing
              ? `Playing ${tone.playing} reference tone`
              : "Reference tone stopped"}
          </p>
          {tone.error && (
            <p role="alert" className="audio-error">
              {tone.error}
            </p>
          )}
        </section>
        <section className="process-section" id="process">
          <div className="section-shell">
            <Reveal className="section-heading">
              <div>
                <p className="eyebrow">
                  <span className="section-index">02 /</span> LESS GUESSWORK.
                  MORE PLAYING.
                </p>
                <h2>THREE STEPS. ONE SWEET SPOT.</h2>
              </div>
            </Reveal>
            <div className="process-grid">
              {[
                {
                  icon: Camera,
                  title: "Frame your tabla.",
                  text: "Take a top-down photo of your dayan. Fit the drumhead so every part of your instrument has its place.",
                  label: "01 / CAPTURE",
                },
                {
                  icon: Crosshair,
                  title: "Make your map.",
                  text: "Mark your starting point and align the boundary straps. Eight regions, grounded in your actual tabla.",
                  label: "02 / ALIGN",
                },
                {
                  icon: AudioLines,
                  title: "Listen. Adjust. Repeat.",
                  text: "Play three clear strikes in each region. Follow the pitch map, refine the tension, and find your resonance.",
                  label: "03 / TUNE",
                },
              ].map(({ icon: Icon, title, text, label }, i) => (
                <Reveal key={label} delay={i * 0.08} className="process-card">
                  <div className="process-card-top">
                    <Icon size={27} strokeWidth={1.3} />
                    <span className="eyebrow">{label}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <button className="text-link" onClick={() => start()}>
                    Let’s get started <ArrowRight size={15} />
                  </button>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <section className="section-shell features-section" id="features">
          <Reveal className="section-heading">
            <div>
              <p className="eyebrow">
                <span className="section-index">03 /</span> BUILT FOR THE
                DETAILS
              </p>
              <h2>EVERY STRIKE TELLS A STORY.</h2>
            </div>
            <p>
              Everything you need to tune with intention.
              <br />
              Nothing between you and your instrument.
            </p>
          </Reveal>
          <div className="feature-table">
            {features.map(([title, detail, number], i) => (
              <Reveal key={number} delay={i * 0.03} className="feature-row">
                <span className="feature-number">{number}</span>
                <h3>{title}</h3>
                <span className="feature-detail">{detail}</span>
                <ArrowUpRight size={16} />
              </Reveal>
            ))}
          </div>
        </section>
        <section className="section-shell instrument-section" id="instrument">
          <Reveal className="instrument-copy">
            <p className="eyebrow">
              <span className="section-index">04 /</span> THE HEART OF THE
              RHYTHM
            </p>
            <h2>
              OLD SOUL.
              <br />
              NEW PRECISION.
            </h2>
            <p>
              Your tabla has a voice of its own. Dayan helps you listen more
              closely—with a visual map of the drumhead and clear feedback on
              every tuning region.
            </p>
            <p>
              From the first reference note to the final adjustment, keep your
              attention where it belongs. On the skin, the sound, and the
              feeling.
            </p>
            <div className="gear-chips">
              {["8 REGIONS", "LIVE PITCH", "PHOTO MAPPING", "100% LOCAL"].map(
                (chip) => (
                  <span key={chip}>{chip}</span>
                ),
              )}
            </div>
            <a href="#guide" className="text-link">
              Get to know your tuner <ArrowUpRight size={15} />
            </a>
          </Reveal>
          <Reveal className="instrument-art">
            <div className="instrument-art-header">
              <span className="eyebrow">THE INSTRUMENT / TABLA</span>
              <span className="small-cross">+</span>
            </div>
            <img
              src={asset("tabla.png")}
              alt="Illustrated pair of tabla drums with warm wooden shells, cream heads, and red support rings"
              loading="lazy"
            />
            <div className="instrument-art-footer">
              <span>TRADITION IN EVERY DETAIL.</span>
              <Waves size={27} strokeWidth={1} />
            </div>
          </Reveal>
        </section>
        <section className="section-shell faq-section" id="guide">
          <Reveal>
            <p className="eyebrow">
              <span className="section-index">05 /</span> BEFORE YOUR FIRST
              STRIKE
            </p>
            <h2>A FEW GOOD NOTES.</h2>
          </Reveal>
          <Reveal>
            <Accordion type="single" collapsible>
              {faqs.map(([question, answer], i) => (
                <AccordionItem value={`faq-${i}`} key={question}>
                  <AccordionTrigger>{question}</AccordionTrigger>
                  <AccordionContent>{answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </section>
        <section className="closing-section">
          <Reveal>
            <p className="eyebrow">
              <span className="status-dot" /> YOUR NEXT SESSION STARTS HERE
            </p>
            <h2>LET’S FIND YOUR SOUND.</h2>
            <p>
              A well-tuned tabla changes everything. Give yours the attention it
              deserves.
            </p>
            <Button className="site-button" onClick={() => start()}>
              Start tuning <ArrowUpRight size={16} />
            </Button>
            <span className="closing-note">
              <ShieldCheck size={14} /> In your browser. On your terms. Always
              private.
            </span>
          </Reveal>
        </section>
      </main>
      <footer className="site-footer">
        <div className="footer-main">
          <div>
            <a className="brand" href="#">
              <AudioLines size={21} />
              <span>
                DAYAN<span className="brand-dot">.</span>
              </span>
            </a>
            <p>Tradition meets precision.</p>
          </div>
          <div className="footer-links">
            {links.map(([label, id]) => (
              <a href={`#${id}`} key={id}>
                {label}
              </a>
            ))}
            <a href="#guide">Quick guide</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} DAYAN TABLA TUNER</span>
          <span>MADE FOR THE LOVE OF THE RHYTHM.</span>
          <a href="#">BACK TO TOP ↑</a>
        </div>
      </footer>
    </div>
  );
}

function readRoute() {
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.split("?")[1]);
  const note = params.get("note") ?? "D4";
  return {
    tuner: hash.split("?")[0] === "#tuner",
    note: SUPPORTED_NOTES.includes(note) ? note : "D4",
  };
}
export default function App() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (route.tuner || !window.location.hash)
      window.scrollTo({ top: 0, behavior: "instant" });
  }, [route.tuner]);
  return (
    <MotionConfig reducedMotion="user">
      {route.tuner ? (
        <div className="tuner-page">
          <div className="workspace-topbar">
            <a href="#">
              <ArrowLeft size={15} /> Back to Dayan
            </a>
            <span className="eyebrow">YOUR INSTRUMENT. YOUR SESSION.</span>
          </div>
          <Suspense
            fallback={
              <div className="tuner-loading">
                <AudioLines size={30} />
                <p>Preparing your tuning workspace…</p>
              </div>
            }
          >
            <TunerApp key={route.note} initialNote={route.note} />
          </Suspense>
        </div>
      ) : (
        <Landing
          onStart={(note = "D4") => {
            window.location.hash = `tuner?note=${encodeURIComponent(note)}`;
          }}
        />
      )}
    </MotionConfig>
  );
}
