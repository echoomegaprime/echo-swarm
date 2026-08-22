import { CLOUD_IDS, FLEET_IDS, MODELS, MODEL_IDS, idsIn, type ModelId } from "@/lib/swarm/catalog";
import { isConnected, useSwarm } from "@/lib/swarm/store";
import { cn } from "@/lib/utils";

function polar(ids: ModelId[], radius: number, startDeg = -90) {
  const n = Math.max(ids.length, 1);
  return ids.map((id, i) => {
    const rad = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    return { id, x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad) };
  });
}

const INNER = polar(CLOUD_IDS, 22);
const MID = polar([...idsIn("router"), ...idsIn("speed")], 34, -70);
const OUTER = polar([...idsIn("search"), ...idsIn("github"), ...FLEET_IDS], 44, -40);
const POINTS = [...INNER, ...MID, ...OUTER];

export function Constellation() {
  const host = useSwarm((s) => s.host);
  const seats = useSwarm((s) => s.seats);
  const thinking = useSwarm((s) => s.thinking);
  const keys = useSwarm((s) => s.keys);
  const live = useSwarm((s) => s.live);
  const setHost = useSwarm((s) => s.setHost);
  const toggleSeat = useSwarm((s) => s.toggleSeat);
  const setConnectOpen = useSwarm((s) => s.setConnectOpen);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[280px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r="22"
          fill="none"
          className="ring-orbit stroke-border"
          strokeWidth="0.35"
        />
        <circle
          cx="50"
          cy="50"
          r="34"
          fill="none"
          className="stroke-border"
          strokeWidth="0.3"
        />
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          className="stroke-border"
          strokeWidth="0.25"
          strokeDasharray="1.1 1.5"
        />
        <circle cx="50" cy="50" r="4.5" className="fill-raised stroke-border" strokeWidth="0.5" />
        {INNER.map((p, i) => {
          const next = INNER[(i + 1) % INNER.length]!;
          const liveEdge = seats.includes(p.id) && isConnected(p.id, keys, live);
          return (
            <line
              key={`${p.id}-edge`}
              x1={p.x}
              y1={p.y}
              x2={next.x}
              y2={next.y}
              className={liveEdge ? "stroke-border-strong" : "stroke-border"}
              strokeWidth="0.35"
            />
          );
        })}
        {POINTS.map((p) => (
          <line
            key={`${p.id}-spoke`}
            x1="50"
            y1="50"
            x2={p.x}
            y2={p.y}
            className="stroke-border"
            strokeWidth="0.28"
          />
        ))}
      </svg>
      {POINTS.map((p) => {
        const def = MODELS[p.id];
        const onLive = isConnected(p.id, keys, live);
        const on = seats.includes(p.id);
        const busy = thinking.includes(p.id);
        const ring = def.group === "cloud" ? "in" : def.group === "speed" || def.group === "router" ? "mid" : "out";
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              if (!onLive) {
                setConnectOpen(true);
                return;
              }
              if (on && host !== p.id) setHost(p.id);
              else toggleSeat(p.id);
            }}
            className={cn(
              "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
              "font-medium tracking-wide",
              "transition-[opacity,transform,box-shadow] duration-200",
              ring === "in" ? "size-9" : "size-8",
              host === p.id
                ? "bg-accent text-accent-fg"
                : onLive && on
                  ? "bg-raised text-fg shadow-[var(--shadow-border)]"
                  : "bg-surface text-subtle shadow-[var(--shadow-border)] opacity-45",
              busy && "seat-thinking",
            )}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            aria-label={`${def.name}${host === p.id ? ", host" : ""}${busy ? ", speaking" : ""}`}
            title={def.name}
          >
            <span className="font-serif text-xs leading-none">{def.monogram}</span>
          </button>
        );
      })}
      <p className="sr-only">
        Seats: {MODEL_IDS.map((id) => MODELS[id].name).join(", ")}. Host is {MODELS[host].name}.
      </p>
    </div>
  );
}
