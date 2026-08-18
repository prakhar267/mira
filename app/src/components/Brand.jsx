import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function navigate(path) {
  const destination = new URL(path, window.location.href);
  const isCurrentLocation = window.location.pathname === destination.pathname
    && window.location.search === destination.search
    && window.location.hash === destination.hash;

  if (!isCurrentLocation) window.history.pushState({}, "", destination);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Link({ to, className, children, onClick, ...props }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          !event.currentTarget.hasAttribute("download") &&
          (!event.currentTarget.target || event.currentTarget.target === "_self") &&
          to.startsWith("/")
        ) {
          event.preventDefault();
          navigate(to);
        }
      }}
      {...props}
    >
      {children}
    </a>
  );
}

export function Logo({ compact = false }) {
  return (
    <Link to="/" className={`logo ${compact ? "logo--compact" : ""}`} aria-label="Saathkind home">
      <span aria-hidden="true">s</span>
      {!compact && "saathkind"}
    </Link>
  );
}

const NAV_ITEMS = [
  ["How it works", "#how-it-works"],
  ["Memory", "#memory"],
  ["Safety", "#safety"],
  ["Pricing", "#pricing"],
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef(null);
  const menuButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstLink = drawerRef.current?.querySelector("a");
    firstLink?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll("a, button")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleAnchor = () => setOpen(false);

  return (
    <header className="site-header">
      <div className="site-header__inner container">
        <Logo />
        <nav className="desktop-nav" aria-label="Main navigation">
          {NAV_ITEMS.map(([label, href]) => (
            <Link key={href} to={`/${href}`}>{label}</Link>
          ))}
          <Link className="button button--ghost button--small" to="/app">Open beta demo</Link>
        </nav>
        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button mobile-menu-button"
          aria-label="Open navigation menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="mobile-drawer-backdrop" onMouseDown={() => setOpen(false)}>
          <nav
            ref={drawerRef}
            className="mobile-drawer"
            aria-label="Mobile navigation"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mobile-drawer__top">
              <Logo />
              <button
                type="button"
                className="icon-button"
                aria-label="Close navigation menu"
                onClick={() => {
                  setOpen(false);
                  menuButtonRef.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="mobile-drawer__links">
              {NAV_ITEMS.map(([label, href]) => (
                <Link key={href} to={`/${href}`} onClick={handleAnchor}>{label}</Link>
              ))}
            </div>
            <Link to="/app" className="button button--primary button--wide" onClick={handleAnchor}>
              Explore the beta demo <ArrowRight aria-hidden="true" />
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Logo />
          <p>A thoughtful AI companion beta with continuity controls you can inspect.</p>
          <span className="ai-disclosure">AI companion · Adults 18+</span>
        </div>
        <div>
          <h3>Product</h3>
          <Link to="/#how-it-works">How it works</Link>
          <Link to="/#memory">Memory</Link>
          <Link to="/#pricing">Pricing</Link>
          <Link to="/app">Open beta demo</Link>
        </div>
        <div>
          <h3>Trust</h3>
          <Link to="/safety">Safety</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/refund">Cancellation & refunds</Link>
        </div>
        <div>
          <h3>Company</h3>
          <Link to="/contact">Beta contact status</Link>
          <span>Support channels pending</span>
          <span>Made thoughtfully in India</span>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} Saathkind</span>
        <span>Not therapy or emergency care.</span>
      </div>
    </footer>
  );
}
