import { Download, FolderDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applySwarmFiles } from "@/lib/swarm/actions";
import { downloadZip, filesFromMessages } from "@/lib/swarm/files";
import { useSwarm } from "@/lib/swarm/store";

export function ArtifactsBar() {
  const session = useSwarm((s) => s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!);
  const files = filesFromMessages(session.messages);
  if (!files.length) return null;

  async function apply() {
    const result = await applySwarmFiles({
      data: { slug: session.title, files: files.map((f) => ({ path: f.path, content: f.content })) },
    });
    if (result.ok) toast(`Wrote ${result.written.length} files to ${result.dir}`);
    else toast(result.error);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 pb-2">
      <p className="text-xs text-subtle">{files.length} path-tagged files</p>
      <div className="flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => downloadZip(files, session.title)}>
          <Download className="size-4" />
          Zip
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void apply()}>
          <FolderDown className="size-4" />
          Apply
        </Button>
      </div>
    </div>
  );
}
