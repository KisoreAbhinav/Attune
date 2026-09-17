"use client";

import dynamic from "next/dynamic";

const HardwareShowcase = dynamic(
  () => import("@/components/hardware-showcase").then((module) => module.HardwareShowcase),
  {
    ssr: false,
    loading: () => <div className="min-h-[70svh] animate-pulse border-y bg-muted/20" aria-label="Loading hardware showcase" />,
  },
);

export function HardwareShowcaseClient() {
  return <HardwareShowcase />;
}
