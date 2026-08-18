import { ArrowLeft, LifeBuoy, Mail, ShieldCheck } from "lucide-react";
import { Footer, Link, SiteHeader } from "../components/Brand.jsx";

const pages = {
  privacy: {
    eyebrow: "Privacy notice",
    title: "Your conversations are personal. Our controls should be concrete.",
    intro: "This pre-launch draft describes the current synthetic beta and its intended controls. It is not a counsel-approved production notice; use non-sensitive test content only.",
    updated: "18 August 2026",
    sections: [
      ["What the beta stores", ["The demo UI does not collect an email address. Bootstrap records adult confirmation, display name, language, pronouns, timezone, and separate consent choices.", "When cloud-connected, one SQLite-backed Cloudflare Durable Object holds the synthetic account document and authoritative session: profile and consent state, conversations, messages, memories you approve, planner items, goals, and usage counters. Separate token-hash objects hold a request fingerprint plus opaque bootstrap/deletion status on the same fixed horizon; after deletion only status, expiry, and an opaque receipt remain. Separate hashed IP/account/global objects hold short-lived abuse counts.", "Cloudflare KV holds only opaque session-routing pointers until the account expiry—not conversation content, memories, a user registry, rate counters, or deletion receipts. The browser also stores demo profile and interface state locally so the experience can reopen on the same device; after a reset it may retain only a content-free revocation-pending marker until cloud logout is confirmed. Reflection answers, payment records, notification-delivery records, and server-side export archives are not stored because those systems are not live."]],
      ["Why we use it", ["To operate and evaluate the synthetic beta, continue demo conversations, exercise consent controls, prevent obvious abuse, and let you test export and deletion flows.", "The current beta has no advertising, data-broker, payment, or outbound-notification integration."]],
      ["AI providers and processors", ["The deployed beta has no Gemini secret, so ordinary chat uses a deterministic response clearly labelled as a fallback. No claim is made that a paid AI processing agreement is active.", "Before private conversations are accepted, Saathkind needs an approved paid provider agreement, a verified subprocessor list, deletion commitments, and multilingual privacy and safety evaluation."]],
      ["Your choices", ["View, correct, pin, forget, or pause demo memory; disable planner and reflection preferences separately; and export or immediately delete connected beta state from Settings. Export is generated synchronously as authenticated JSON and is not placed in Queue or R2.", "The cloud demo account and its non-renewable session automatically expire 30 days after bootstrap. You may export or irreversibly delete sooner. No support or grievance mailbox is active yet; do not send sensitive requests to an unverified address."]],
      ["Retention and security", ["The account Durable Object uses whole-document compare-and-swap revisions to reject stale concurrent writes. A per-account alarm irreversibly removes the cloud account document 30 days after bootstrap and leaves a content-free tombstone; token-claim metadata follows the same fixed horizon, while rate records expire after their short fixed windows. This is not a global Cron or a production retention policy. Manual deletion does the same sooner, reduces the token object to deletion status/expiry/receipt, and best-effort clears active KV routing pointers. There is no grace/cancellation window, processor-wide deletion evidence, or tested backup-erasure proof.", "The coordinator topology is a synthetic-beta mitigation, not an approved private-data architecture. Its rollout intentionally invalidates older synthetic sessions instead of promising migration. Browser-local copies may remain on the device after cloud expiry until the browser/product clears them. Verified identity, reviewed production storage and export design, key rotation, restore evidence, durable audit monitoring, and independent security/legal review remain launch gates."]],
    ],
  },
  terms: {
    eyebrow: "Terms of use",
    title: "Plain boundaries for using Saathkind.",
    intro: "These terms are a transparent product draft, not a substitute for final legal review. They describe the intended service and its limits.",
    updated: "18 August 2026",
    sections: [
      ["Eligibility and account", ["You must be at least 18 years old. Keep your account access secure and provide accurate eligibility information.", "The service is offered for personal, lawful use and may not be used to harm, exploit, impersonate, or deceive another person."]],
      ["What Saathkind is", ["Saathkind is an AI companion. It is not human, conscious, a therapist, a doctor, an emergency service, or an authoritative source of medical, legal, or financial advice.", "AI output can be incomplete or wrong. Use your judgment and consult qualified people for consequential decisions."]],
      ["Subscriptions", ["Subscriptions, checkout, renewals, cancellation, taxes, and refunds are not enabled in this beta. Prices and plan limits shown on the website are research hypotheses, not an offer for sale.", "A future paid launch must show the exact price, tax, billing period, renewal date, trial terms, limits, cancellation path, and approved refund policy before payment."]],
      ["Acceptable use", ["Do not attempt to access another user’s data, bypass safeguards, scrape the service, introduce malware, exploit minors, or generate unlawful or abusive content.", "We may rate-limit or suspend access when necessary to protect users, the service, or legal compliance, with a reasonable appeal path where appropriate."]],
      ["Content and availability", ["You retain rights in the content you provide. You grant the limited permission needed to process it for the features you request.", "We aim for reliable service but do not promise uninterrupted availability. Material changes to these terms will be communicated clearly before they take effect."]],
    ],
  },
  safety: {
    eyebrow: "Safety approach",
    title: "Supportive by design, with honest limits.",
    intro: "Saathkind is designed for everyday conversation and reflection—not emotional dependency, diagnosis, treatment, or crisis care.",
    updated: "18 August 2026",
    sections: [
      ["Persistent AI identity", ["Saathkind identifies itself as AI throughout onboarding and the product. It does not claim feelings, consciousness, a human body, or exclusive attachment.", "Synthetic voice or imagery, if introduced later, will be labelled clearly and use documented commercial rights."]],
      ["Healthy-use guardrails", ["No guilt-based streaks, possessive language, manufactured jealousy, or pressure to keep talking.", "The beta stores planner examples and quiet hours but does not deliver proactive contact. Any future delivery must be separately opt-in, bounded by quiet hours and topic controls, and independently tested.", "The product encourages trusted people, restorative activities, and professional support when appropriate."]],
      ["High-risk situations", ["This synthetic beta includes a limited, keyword-based routing preview for some explicit high-risk phrases in English, Hindi, and Hinglish. It is not comprehensive, clinically reviewed, or safety-evaluated, and it can miss or misclassify a message. Never rely on Saathkind to detect an emergency.", "In immediate danger, contact local emergency services. In India, Tele-MANAS provides 24/7 support at 14416 or 1800-89-14416."]],
      ["Testing and reporting", ["Before a private or paid launch, Saathkind needs documented safety evaluations, red-team exercises, privacy testing, cross-user leakage tests, incident drills, and qualified review.", "Safety reporting and an in-app case system are not connected in this synthetic beta. The message menu states that limitation instead of claiming a report was filed."]],
    ],
  },
  refund: {
    eyebrow: "Cancellation & refunds",
    title: "Billing is not live in this beta.",
    intro: "No payment method is accepted, so there is currently no subscription to cancel and no charge to refund. The policy below describes gates for a future paid launch.",
    updated: "18 August 2026",
    sections: [
      ["Current beta", ["Billing, trials, renewals, upgrades, downgrades, and paid entitlements are disabled. You will not be charged for exploring the beta.", "Account export and deletion are separate data controls in Settings; they are available for testing without a subscription."]],
      ["Future cancellation and refunds", ["Before taking payment, Saathkind must connect an approved payment provider, publish counsel-reviewed cancellation and refund terms, provide a working support channel, and test signed webhooks and reconciliation.", "The checkout must show the exact amount, tax, renewal, cancellation, and refund terms before confirmation. No future policy stated here should be treated as active today."]],
      ["Plan changes", ["Research prices and discounts may change before launch. No current user has a paid period, renewal date, or prorated balance."]],
    ],
  },
};

function ContactPage() {
  return (
    <div className="legal-page">
      <SiteHeader />
      <main className="legal-main container">
        <Link to="/" className="back-link"><ArrowLeft aria-hidden="true" /> Back home</Link>
        <div className="legal-hero"><span className="eyebrow">Contact status</span><h1>Support channels are not live yet.</h1><p>This synthetic beta does not have a verified support, privacy, safety, or grievance mailbox. Do not send personal conversations or credentials to an assumed Saathkind address.</p></div>
        <div className="contact-grid">
          <article className="contact-card"><Mail aria-hidden="true" /><h2>General support</h2><p>A monitored product-help channel is required before invited users are onboarded.</p><span>Not connected</span></article>
          <article className="contact-card"><ShieldCheck aria-hidden="true" /><h2>Privacy & grievance</h2><p>A verified access, correction, export, deletion, and grievance route is a launch gate.</p><span>Not connected</span></article>
          <article className="contact-card"><LifeBuoy aria-hidden="true" /><h2>Safety reporting</h2><p>A staffed case workflow and escalation path must be tested before private use.</p><span>Not connected</span></article>
        </div>
        <div className="crisis-banner"><strong>Need urgent help?</strong><p>Saathkind is not an emergency service. Contact local emergency services. In India, Tele-MANAS is available 24/7 at <a href="tel:14416">14416</a> or <a href="tel:18008914416">1800-89-14416</a>.</p></div>
      </main>
      <Footer />
    </div>
  );
}

export function LegalPage({ type }) {
  if (type === "contact") return <ContactPage />;
  const page = pages[type] || pages.privacy;
  return (
    <div className="legal-page">
      <SiteHeader />
      <main className="legal-main container">
        <Link to="/" className="back-link"><ArrowLeft aria-hidden="true" /> Back home</Link>
        <header className="legal-hero"><span className="eyebrow">{page.eyebrow}</span><h1>{page.title}</h1><p>{page.intro}</p><small>Last updated: {page.updated}</small></header>
        <div className="legal-layout">
          <aside><strong>On this page</strong>{page.sections.map(([heading], index) => <a href={`#section-${index}`} key={heading}>{heading}</a>)}</aside>
          <article className="legal-copy">{page.sections.map(([heading, paragraphs], index) => <section id={`section-${index}`} key={heading}><h2>{heading}</h2>{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}<div className="legal-contact"><h2>Questions or requests</h2><p>No verified mailbox is active in this synthetic beta. <Link to="/contact">See the contact status</Link> and avoid sharing sensitive information until a monitored channel is published.</p></div></article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
