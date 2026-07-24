import { useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TickerBar from "./TickerBar";
import AIChatWidget from "./AIChatWidget";
import OnboardingBanner from "./OnboardingBanner";

interface Props {
  title: string;
  children: ReactNode;
  fullHeight?: boolean;
}

export default function Layout({ title, children, fullHeight }: Props) {
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TickerBar title={title} onMenuClick={() => setMobileNavOpen(true)} />
        <main className={fullHeight ? "flex-1 overflow-y-auto lg:flex lg:flex-col lg:overflow-hidden" : "flex-1 overflow-y-auto"}>
          <OnboardingBanner />
          <div key={pathname} className={`page-enter ${fullHeight ? "lg:flex-1 lg:flex lg:flex-col lg:h-full" : ""}`}>
            {children}
          </div>
        </main>
      </div>
      <AIChatWidget />
    </div>
  );
}
