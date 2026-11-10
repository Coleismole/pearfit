// The two page layouts: a main screen with the bottom tab bar, and a sub-screen with a back arrow and a title.
import type { ReactNode } from "react";
import { link } from "../lib/router.ts";
import { BackIcon, HangerIcon, HomeIcon, PersonIcon } from "./Icons.tsx";

export type Tab = "home" | "wardrobe" | "account";

const TABS: { tab: Tab; label: string; href: string; icon: ReactNode }[] = [
  { tab: "home", label: "Home", href: link(), icon: <HomeIcon /> },
  { tab: "wardrobe", label: "Wardrobe", href: link("wardrobe"), icon: <HangerIcon /> },
  { tab: "account", label: "Account", href: link("account"), icon: <PersonIcon /> },
];

function TabBar({ active }: { active: Tab }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <a key={t.tab} className="tabbar__tab" href={t.href} aria-current={t.tab === active ? "page" : undefined}>
          {t.icon}
          {t.label}
        </a>
      ))}
    </nav>
  );
}

export function TabScreen({ active, children }: { active: Tab; children: ReactNode }) {
  return (
    <>
      <main className="screen screen--tabs">{children}</main>
      <TabBar active={active} />
    </>
  );
}

// `back` is where the arrow leads and `backLabel` says so for screen readers.
export function SubScreen({ title, back, backLabel, children }: { title: string; back: string; backLabel: string; children: ReactNode }) {
  return (
    <main className="screen">
      <div className="topbar">
        <a className="icon-button" href={back} aria-label={backLabel}>
          <BackIcon />
        </a>
        <h1 className="title">{title}</h1>
      </div>
      {children}
    </main>
  );
}

// A back link with a visible label ("‹ Wardrobe"), used on the item and category pages.
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="back-link" href={href}>
      <BackIcon />
      {children}
    </a>
  );
}
