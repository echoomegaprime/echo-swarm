import { createFileRoute } from "@tanstack/react-router";
import { SwarmApp } from "@/components/swarm/app-shell";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <SwarmApp />;
}
