import {
  ArrowRight,
  BellRing,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Edit3,
  Eye,
  Goal,
  HeartHandshake,
  Languages,
  LockKeyhole,
  MessageCircle,
  Pause,
  Pin,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { useState } from "react";
import { Footer, Link, SiteHeader } from "../components/Brand.jsx";

const memoriesSeed = [
  {
    id: 1,
    text: "You have a presentation tomorrow and sleep has been low.",
    source: "This conversation · 10:33 AM",
    confidence: "High",
    pinned: false,
  },
  {
    id: 2,
    text: "You prefer a listening ear before suggestions when work feels heavy.",
    source: "Approved by you · 3 days ago",
    confidence: "Confirmed",
    pinned: true,
  },
];

const faqs = [
  [
    "Is Saathkind a real person?",
    "No. Saathkind is an AI companion concept and never pretends to be human. The current deterministic beta fallback does not use saved memories to generate replies; the memory experience is a control preview until an approved provider is connected.",
  ],
  [
    "Does it remember everything I say?",
    "Connected beta conversations are stored as history until you delete the account or its 30-day expiry. Optional memory is separate: Saathkind proposes only selected details, and you can approve, edit, pin, pause, or forget those memories at any time.",
  ],
  [
    "Can I speak in Hindi or Hinglish?",
    "You can preview English, Hindi, and Hinglish preferences. The current no-provider fallback is primarily English, while Hindi and Hinglish crisis routing is included. Full multilingual generation remains gated on an approved AI provider and evaluation.",
  ],
  [
    "Is this therapy or crisis support?",
    "No. Saathkind is for everyday supportive conversation, reflection, and gentle follow-through. It does not diagnose or replace professional care. In an emergency, contact local emergency services; in India, Tele-MANAS is available at 14416.",
  ],
  [
    "Can I subscribe to a paid plan today?",
    "Not yet. Billing, renewals, and cancellation are not enabled in this beta. The prices and plan limits on this page are launch hypotheses, not a live offer, and you will not be charged.",
  ],
];

function ConversationProof() {
  const [memory, setMemory] = useState("You have a presentation tomorrow and sleep has been low.");
  const [forgotten, setForgotten] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory);

  return (
    <div className="conversation-proof" aria-label="Example Saathkind conversation and memory receipt">
      <div className="conversation-proof__header">
        <div className="companion-avatar" aria-hidden="true">S</div>
        <div>
          <strong>saathkind</strong>
          <span><LockKeyhole size={14} aria-hidden="true" /> Synthetic beta example</span>
        </div>
      </div>
      <div className="conversation-proof__messages">
        <div className="bubble bubble--assistant">
          <p>What’s on your mind today?</p>
          <time>10:32 AM</time>
        </div>
        <div className="bubble bubble--user">
          <p>Aaj thoda overwhelmed feel kar raha hoon. Kal presentation hai aur neend bhi kam hui.</p>
          <time>10:33 AM <CheckCheck size={15} aria-label="Delivered" /></time>
        </div>
        <div className="bubble bubble--assistant bubble--wide">
          <p>That sounds heavy. Let’s sort what you can control first. Ready to map it out together?</p>
          <time>10:33 AM</time>
        </div>
      </div>
      <div className="receipt-block">
        <div className="receipt-block__label">
          <Sparkles aria-hidden="true" />
          <div>
            <strong>Memory receipt</strong>
            <span>Saathkind remembers selectively. You’re in control.</span>
          </div>
        </div>
        {forgotten ? (
          <div className="receipt-empty" role="status">
            <span>This memory was forgotten.</span>
            <button type="button" className="text-button" onClick={() => setForgotten(false)}>Undo</button>
          </div>
        ) : (
          <div className="memory-receipt">
            <div className="memory-receipt__content">
              {editing ? (
                <label className="inline-edit">
                  <span className="sr-only">Edit memory</span>
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows="3" />
                </label>
              ) : (
                <p>{memory}</p>
              )}
              <span>Source: This conversation · 10:33 AM</span>
            </div>
            <div className="memory-confidence"><i aria-hidden="true" /> <span>Confidence</span><strong>High</strong></div>
            <div className="memory-receipt__actions">
              <button
                type="button"
                onClick={() => {
                  if (editing) setMemory(draft.trim() || memory);
                  setEditing((value) => !value);
                }}
              >
                {editing ? <Check aria-hidden="true" /> : <Edit3 aria-hidden="true" />}
                {editing ? "Save" : "Edit"}
              </button>
              <button type="button" className="danger" onClick={() => setForgotten(true)}>
                <Trash2 aria-hidden="true" /> Forget
              </button>
            </div>
          </div>
        )}
        <p className="receipt-note"><ShieldCheck aria-hidden="true" /> Interactive preview only. This sample memory is not stored and resets with the page.</p>
      </div>
    </div>
  );
}

function MemoryLab() {
  const [memories, setMemories] = useState(memoriesSeed);
  const [paused, setPaused] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  const editMemory = (memory) => {
    setEditingId(memory.id);
    setDraft(memory.text);
  };

  const saveMemory = (id) => {
    setMemories((items) => items.map((item) => (item.id === id ? { ...item, text: draft.trim() || item.text } : item)));
    setEditingId(null);
  };

  return (
    <div className="memory-lab">
      <div className="memory-lab__top">
        <div>
          <span className="eyebrow">Interactive memory preview</span>
          <h3>Nothing hidden in the background.</h3>
        </div>
        <button type="button" className={`toggle-button ${paused ? "is-paused" : ""}`} onClick={() => setPaused((value) => !value)}>
          <Pause aria-hidden="true" /> {paused ? "Memory paused" : "Pause memory"}
        </button>
      </div>
      {paused && <div className="memory-paused" role="status">Preview paused. No sample memories will be suggested until you resume.</div>}
      <div className="memory-stack">
        {memories.map((memory) => (
          <article className="memory-card" key={memory.id}>
            <div className="memory-card__icon"><Sparkles aria-hidden="true" /></div>
            <div className="memory-card__body">
              {editingId === memory.id ? (
                <textarea aria-label="Memory text" value={draft} onChange={(event) => setDraft(event.target.value)} rows="3" autoFocus />
              ) : (
                <p>{memory.text}</p>
              )}
              <span>{memory.source} · {memory.confidence}</span>
            </div>
            <div className="memory-card__actions">
              <button type="button" aria-label={memory.pinned ? "Unpin memory" : "Pin memory"} className={memory.pinned ? "is-active" : ""} onClick={() => setMemories((items) => items.map((item) => item.id === memory.id ? { ...item, pinned: !item.pinned } : item))}>
                <Pin aria-hidden="true" />
              </button>
              <button type="button" aria-label={editingId === memory.id ? "Save memory" : "Edit memory"} onClick={() => editingId === memory.id ? saveMemory(memory.id) : editMemory(memory)}>
                {editingId === memory.id ? <Check aria-hidden="true" /> : <Edit3 aria-hidden="true" />}
              </button>
              <button type="button" aria-label="Forget memory" className="danger" onClick={() => setMemories((items) => items.filter((item) => item.id !== memory.id))}>
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
        {!memories.length && <div className="empty-state">No saved memories. You can still chat normally.</div>}
      </div>
    </div>
  );
}

function Pricing() {
  const [annual, setAnnual] = useState(false);
  const corePrice = annual ? 339 : 399;
  const plusPrice = annual ? 679 : 799;

  const plans = [
    {
      name: "Free",
      description: "Explore the current non-sensitive product demo.",
      price: 0,
      features: ["Synthetic chat experience", "Interactive memory controls", "Follow-up and quiet-hours preview", "No card or payment required"],
      cta: "Explore the demo",
    },
    {
      name: "Core",
      description: "A proposed plan for continuity across conversations.",
      price: corePrice,
      badge: "Launch hypothesis",
      features: ["Planned monthly message allowance", "Planned editable cloud memory", "Planned opt-in follow-ups", "Planned goals and reflection", "Planned email support"],
      cta: "Core coming soon",
    },
    {
      name: "Plus",
      description: "A proposed plan for more room and personalization.",
      price: plusPrice,
      features: ["Everything proposed for Core", "Planned higher message allowance", "Planned voice-note access", "Planned personalization", "Planned early feature access"],
      cta: "Plus coming soon",
    },
  ];

  return (
    <section className="section pricing-section" id="pricing">
      <div className="container">
        <div className="section-heading section-heading--center">
          <span className="eyebrow">Proposed launch pricing</span>
          <h2>Preview the plans we’re considering.</h2>
          <p>Billing is not enabled. These prices, limits, and entitlements are product hypotheses—not a live offer.</p>
          <div className="billing-toggle" aria-label="Proposed billing period">
            <button type="button" className={!annual ? "is-active" : ""} onClick={() => setAnnual(false)} aria-pressed={!annual}>Monthly</button>
            <button type="button" className={annual ? "is-active" : ""} onClick={() => setAnnual(true)} aria-pressed={annual}>Annual estimate <span>target 15%</span></button>
          </div>
        </div>
        <div className="pricing-grid">
          {plans.map((plan) => (
            <article className={`price-card ${plan.badge ? "price-card--featured" : ""}`} key={plan.name}>
              {plan.badge && <span className="price-badge">{plan.badge}</span>}
              <h3>{plan.name}</h3>
              <p>{plan.description}</p>
              <div className="price"><span>₹</span><strong>{plan.price}</strong><small>{plan.price ? "/ month target" : "demo"}</small></div>
              {annual && plan.price > 0 && <p className="annual-note">Planning estimate only. Annual billing is not available today.</p>}
              <ul>
                {plan.features.map((feature) => <li key={feature}><Check aria-hidden="true" /> {feature}</li>)}
              </ul>
              <Link to="/app" className={`button button--wide ${plan.badge ? "button--primary" : "button--ghost"}`}>{plan.cta}</Link>
            </article>
          ))}
        </div>
        <p className="pricing-footnote">No payments, subscriptions, renewals, cancellations, or paid-plan allowances are active in this beta.</p>
      </div>
    </section>
  );
}

function Faq() {
  const [openIndex, setOpenIndex] = useState(0);
  return (
    <section className="section faq-section" aria-labelledby="faq-title">
      <div className="container faq-layout">
        <div className="section-heading">
          <span className="eyebrow">Questions, answered plainly</span>
          <h2 id="faq-title">Trust should not live in the fine print.</h2>
          <p>Still unsure? <Link to="/contact">Check the beta contact status</Link> before sharing any personal information.</p>
        </div>
        <div className="faq-list">
          {faqs.map(([question, answer], index) => {
            const isOpen = openIndex === index;
            return (
              <div className={`faq-item ${isOpen ? "is-open" : ""}`} key={question}>
                <h3>
                  <button type="button" aria-expanded={isOpen} aria-controls={`faq-answer-${index}`} onClick={() => setOpenIndex(isOpen ? -1 : index)}>
                    {question}<ChevronDown aria-hidden="true" />
                  </button>
                </h3>
                <div id={`faq-answer-${index}`} hidden={!isOpen}><p>{answer}</p></div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function MarketingPage() {
  return (
    <div className="marketing-page">
      <SiteHeader />
      <main>
        <section className="hero">
          <img className="hero__art" src="/assets/saathkind-horizon.png" alt="" aria-hidden="true" />
          <div className="container hero__grid">
            <div className="hero__copy">
              <span className="hero-kicker"><Sparkles aria-hidden="true" /> Built for the conversations between everything else</span>
              <h1>Talk freely.<br />Come back known.</h1>
              <p>A hands-on beta of a thoughtful AI companion, with continuity controls you can inspect.</p>
              <div className="hero__actions">
                <Link to="/app" className="button button--primary">Explore the beta demo <ArrowRight aria-hidden="true" /></Link>
                <a href="#memory" className="button button--ghost">See how memory works</a>
              </div>
              <div className="hero__trust">
                <span>18+</span><i aria-hidden="true" />
                <span>Clearly AI</span><i aria-hidden="true" />
                <span>Memory you can inspect</span>
              </div>
            </div>
            <ConversationProof />
          </div>
        </section>

        <section className="trust-strip" aria-label="Product commitments">
          <div className="container trust-strip__inner">
            <span><LockKeyhole aria-hidden="true" /> Privacy controls visible</span>
            <span><Languages aria-hidden="true" /> Language preference preview</span>
            <span><Eye aria-hidden="true" /> Inspectable memory</span>
            <span><UserRoundCheck aria-hidden="true" /> You set the pace</span>
          </div>
        </section>

        <section className="section how-section" id="how-it-works">
          <div className="container">
            <div className="section-heading section-heading--center">
              <span className="eyebrow">How it works</span>
              <h2>Continuity without the creepiness.</h2>
              <p>An interactive preview of a loop designed around clarity and control.</p>
            </div>
            <ol className="steps-grid">
              <li>
                <span className="step-number">01</span>
                <div className="step-icon"><MessageCircle aria-hidden="true" /></div>
                <h3>Speak naturally</h3>
                <p>Set an English, Hindi, or Hinglish preference. General multilingual AI remains limited until an approved provider is connected.</p>
              </li>
              <li>
                <span className="step-number">02</span>
                <div className="step-icon"><Sparkles aria-hidden="true" /></div>
                <h3>Approve what matters</h3>
                <p>Review a sample memory receipt before anything becomes part of the conversation context.</p>
              </li>
              <li>
                <span className="step-number">03</span>
                <div className="step-icon"><BellRing aria-hidden="true" /></div>
                <h3>Pick up the thread</h3>
                <p>Preview how opt-in follow-ups could work inside the hours and topics you choose.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section memory-section" id="memory">
          <div className="container split-layout">
            <div className="section-heading sticky-copy">
              <span className="eyebrow">Memory, with receipts</span>
              <h2>Remember fewer things. Remember them right.</h2>
              <p>This beta previews selective memory controls using synthetic examples. Changes below stay on this page and reset when it reloads; durable retention is not promised.</p>
              <ul className="feature-list">
                <li><Check aria-hidden="true" /> See why a memory was saved</li>
                <li><Check aria-hidden="true" /> Edit, pin, or forget it in one step</li>
                <li><Check aria-hidden="true" /> Pause memory without pausing conversation</li>
              </ul>
              <Link to="/app" className="text-link">Try the memory controls <ArrowRight aria-hidden="true" /></Link>
            </div>
            <MemoryLab />
          </div>
        </section>

        <section className="section continuity-section">
          <div className="container">
            <div className="section-heading section-heading--center">
              <span className="eyebrow">Planned thoughtful follow-through</span>
              <h2>There when you asked. Quiet when you didn’t.</h2>
              <p>This beta previews cadence, quiet hours, topics, and channel controls. It does not deliver outbound notifications.</p>
            </div>
            <div className="continuity-grid">
              <article className="followup-card">
                <div className="mock-topline"><span>Tomorrow</span><span>After 6 PM</span></div>
                <div className="notification-card">
                  <div className="notification-icon"><BellRing aria-hidden="true" /></div>
                  <div><strong>How did the presentation go?</strong><p>You asked me to check in after work.</p></div>
                </div>
                <div className="mock-actions"><button type="button">Reply</button><button type="button">Snooze</button><button type="button">Turn off</button></div>
              </article>
              <div className="continuity-features">
                <article><CalendarClock aria-hidden="true" /><h3>Follow up on open loops</h3><p>Choose the moment yourself or let Saathkind suggest one for approval.</p></article>
                <article><Clock3 aria-hidden="true" /><h3>Quiet hours are a boundary</h3><p>No nudges during sleep, meetings, or any time block you protect.</p></article>
                <article><RefreshCcw aria-hidden="true" /><h3>Snooze without guilt</h3><p>Pause a topic, a goal, or all proactive contact—no streaks, no pressure copy.</p></article>
              </div>
            </div>
          </div>
        </section>

        <section className="section reflection-section">
          <div className="container reflection-grid">
            <div className="reflection-board">
              <div className="reflection-board__header"><span>Weekly reflection</span><strong>12–18 Aug</strong></div>
              <div className="reflection-summary">
                <div><span>Most present</span><strong>Steady</strong></div>
                <div><span>Small win</span><strong>3 evening walks</strong></div>
              </div>
              <div className="reflection-note"><HeartHandshake aria-hidden="true" /><p>You seemed lighter after making time for people you trust. Does that feel accurate?</p></div>
              <div className="reflection-buttons"><button type="button">Yes, keep this</button><button type="button">Edit reflection</button></div>
            </div>
            <div className="section-heading">
              <span className="eyebrow">Goals without guilt</span>
              <h2>Notice progress. Never manufacture pressure.</h2>
              <p>Create a small goal, change your mind, take a pause, or mark it done. Reflection is optional, editable, and framed with uncertainty.</p>
              <div className="mini-feature"><Goal aria-hidden="true" /><div><strong>Your goals stay yours</strong><span>No public streaks, shame loops, or forced check-ins.</span></div></div>
            </div>
          </div>
        </section>

        <section className="section safety-section" id="safety">
          <div className="container safety-panel">
            <div className="safety-panel__icon"><ShieldCheck aria-hidden="true" /></div>
            <div className="section-heading">
              <span className="eyebrow">Clear boundaries, built in</span>
              <h2>Companion, not clinician. Helpful, never possessive.</h2>
              <p>Saathkind is for everyday supportive conversation. It does not diagnose, provide treatment, or replace human care. It is designed to encourage real-world support when that matters.</p>
            </div>
            <div className="safety-links">
              <Link to="/safety">Read our safety approach <ArrowRight aria-hidden="true" /></Link>
              <span>India crisis support: Tele-MANAS 14416</span>
            </div>
          </div>
        </section>

        <Pricing />
        <Faq />

        <section className="final-cta">
          <div className="container final-cta__inner">
            <Sparkles aria-hidden="true" />
            <h2>Start with what’s on your mind.</h2>
            <p>No perfect prompt. No need to perform. Try the experience with non-sensitive demo content.</p>
            <Link to="/app" className="button button--light">Explore the beta demo <ArrowRight aria-hidden="true" /></Link>
            <span>Free to explore · No payments enabled · Adults 18+</span>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
