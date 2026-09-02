"use client";

import type { Icon } from "@phosphor-icons/react";
import {
  ChatCircle,
  Heart,
  House,
  Phone,
  Sparkle,
  UserCircle,
} from "@phosphor-icons/react";
import { brand } from "@companion/config";
import type { AppView } from "@/lib/state";

const navigation: Array<{ id: AppView; label: string; icon: Icon }> = [
  { id: "home", label: "Home", icon: House },
  { id: "chat", label: "Chat", icon: ChatCircle },
  { id: "moments", label: "Moments", icon: Sparkle },
  { id: "companion", label: "Wardrobe", icon: Heart },
  { id: "profile", label: "You", icon: UserCircle },
];

export function AppShell({
  active,
  onNavigate,
  onCall,
  companionName,
  relationshipStage,
  relationshipLevel,
  children,
  immersive = false,
}: {
  active: AppView;
  onNavigate: (view: AppView) => void;
  onCall?: () => void;
  companionName: string;
  relationshipStage: string;
  relationshipLevel: number;
  children: React.ReactNode;
  immersive?: boolean;
}) {
  return (
    <div className={`app-frame ${immersive ? "app-frame--immersive" : ""}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <button className="sidebar__brand" type="button" onClick={() => onNavigate("home")} aria-label={`Go to ${companionName} home`}>
          <span>{brand.displayName}</span>
          <Sparkle aria-hidden="true" size={14} weight="fill" />
        </button>
        <nav className="sidebar__nav">
          {navigation.map(({ id, label, icon: IconComponent }) => (
            <button
              key={id}
              type="button"
              className={`nav-item ${active === id ? "nav-item--active" : ""}`}
              aria-current={active === id ? "page" : undefined}
              onClick={() => onNavigate(id)}
            >
              <IconComponent aria-hidden="true" size={22} weight={active === id ? "fill" : "regular"} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar__relationship">
          <Heart aria-hidden="true" weight="fill" />
          <span><strong>{relationshipStage} · {relationshipLevel}</strong><small>{brand.disclosure}</small></span>
        </div>
      </aside>

      <main className="app-main">{children}</main>

      {onCall && active !== "home" && active !== "chat" ? (
        <button type="button" className="floating-call" onClick={onCall} aria-label={`Call ${companionName}`}>
          <Phone aria-hidden="true" weight="fill" />
          <span>Call {companionName}</span>
        </button>
      ) : null}

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {navigation.map(({ id, label, icon: IconComponent }) => (
          <button
            key={id}
            type="button"
            className={active === id ? "bottom-nav__item bottom-nav__item--active" : "bottom-nav__item"}
            aria-label={label}
            aria-current={active === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <IconComponent aria-hidden="true" size={23} weight={active === id ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
