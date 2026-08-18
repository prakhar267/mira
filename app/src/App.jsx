import { useEffect, useRef, useState } from "react";
import { MarketingPage } from "./pages/MarketingPage.jsx";
import { ProductDemo } from "./pages/ProductDemo.jsx";
import { LegalPage } from "./pages/LegalPage.jsx";
import { Footer, Link, SiteHeader } from "./components/Brand.jsx";

const LEGAL_ROUTES = ["/privacy", "/terms", "/safety", "/refund", "/contact"];

const ROUTE_META = {
  "/": {
    title: "Saathkind — Talk freely. Come back known.",
    description: "Explore a synthetic AI companion beta with inspectable continuity controls and language preferences; general multilingual generation is not yet connected.",
  },
  "/app": {
    title: "Conversation beta · Saathkind",
    description: "Explore Saathkind’s consent-first AI companion beta and its inspectable memory, follow-up, and privacy controls.",
  },
  "/privacy": { title: "Privacy notice · Saathkind", description: "How Saathkind handles conversations, memories, account data, retention, and your privacy choices." },
  "/terms": { title: "Terms of use · Saathkind", description: "Plain-language boundaries, eligibility, acceptable use, subscriptions, and service terms for Saathkind." },
  "/safety": { title: "Safety approach · Saathkind", description: "Saathkind’s AI identity, healthy-use guardrails, crisis boundaries, safety testing, and reporting approach." },
  "/refund": { title: "Cancellation and refunds · Saathkind", description: "Saathkind’s intended cancellation, refund, renewal, and plan-change policy." },
  "/contact": { title: "Beta contact status · Saathkind", description: "See which Saathkind support, privacy, and safety channels are not yet connected for this synthetic beta." },
};

function currentLocation() {
  return { pathname: window.location.pathname, hash: window.location.hash };
}

function normalizePathname(pathname) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function useLocation() {
  const [location, setLocation] = useState(() => ({ ...currentLocation(), navigationKey: 0 }));
  useEffect(() => {
    const update = () => setLocation((previous) => ({
      ...currentLocation(),
      navigationKey: previous.navigationKey + 1,
    }));
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  return location;
}

function setMeta(selector, attribute, value) {
  document.head.querySelector(selector)?.setAttribute(attribute, value);
}

function NotFound() {
  return (
    <div className="legal-page">
      <SiteHeader />
      <main className="legal-main container">
        <div className="legal-hero">
          <span className="eyebrow">404 · Page not found</span>
          <h1>This page wandered off.</h1>
          <p>The address may have changed, or the page may never have existed. The conversation can still begin from home.</p>
          <Link to="/" className="button button--primary">Back to Saathkind</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function App() {
  const location = useLocation();
  const pathname = normalizePathname(location.pathname);
  const isKnownRoute = pathname === "/" || pathname === "/app" || LEGAL_ROUTES.includes(pathname);
  const shouldIndex = isKnownRoute && pathname !== "/app";
  const hasRendered = useRef(false);

  useEffect(() => {
    if (location.pathname === pathname) return;
    window.history.replaceState({}, "", `${pathname}${window.location.search}${location.hash}`);
  }, [location.hash, location.pathname, pathname]);

  useEffect(() => {
    const meta = ROUTE_META[pathname] || {
      title: "Page not found · Saathkind",
      description: "The requested Saathkind page could not be found.",
    };
    const canonicalUrl = `${window.location.origin}${pathname}`;
    const socialImageUrl = `${window.location.origin}/assets/saathkind-horizon.png`;

    document.title = meta.title;
    setMeta('meta[name="description"]', "content", meta.description);
    setMeta('meta[name="robots"]', "content", shouldIndex ? "index, follow" : "noindex, nofollow");
    setMeta('meta[property="og:title"]', "content", meta.title);
    setMeta('meta[property="og:description"]', "content", meta.description);
    setMeta('meta[property="og:url"]', "content", canonicalUrl);
    setMeta('meta[property="og:image"]', "content", socialImageUrl);
    setMeta('meta[name="twitter:title"]', "content", meta.title);
    setMeta('meta[name="twitter:description"]', "content", meta.description);
    setMeta('meta[name="twitter:image"]', "content", socialImageUrl);
    setMeta('link[rel="canonical"]', "href", canonicalUrl);
  }, [pathname, shouldIndex]);

  useEffect(() => {
    const isClientNavigation = hasRendered.current;
    hasRendered.current = true;

    const frame = window.requestAnimationFrame(() => {
      if (location.hash) {
        let id = location.hash.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // A malformed fragment should not break the whole route.
        }
        const target = document.getElementById(id);
        if (!target) return;
        target.scrollIntoView({ block: "start" });
        const focusTarget = target.matches("h1, h2, h3") ? target : target.querySelector("h1, h2, h3");
        if (focusTarget) {
          focusTarget.tabIndex = -1;
          focusTarget.focus({ preventScroll: true });
        }
        return;
      }

      if (!isClientNavigation) return;
      window.scrollTo({ top: 0, behavior: "instant" });
      const heading = document.querySelector("main h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.navigationKey, pathname]);

  if (pathname === "/") return <MarketingPage />;
  if (pathname === "/app") return <ProductDemo />;
  if (LEGAL_ROUTES.includes(pathname)) return <LegalPage type={pathname.slice(1)} />;
  return <NotFound />;
}
