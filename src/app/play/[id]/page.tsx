import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GameEngine } from "@/components/GameEngine";
import { RoomLoader } from "@/components/RoomLoader";
import { GameDraft } from "@/lib/game/schema";
import { sealGame } from "@/lib/game/seal";
import { verifyGame } from "@/lib/game/solver";
import { loadRoom } from "@/lib/store";

async function Room({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await loadRoom(id);
  if (!room?.published) notFound();

  // Checked again on every load: a room that cannot be escaped is never served.
  const draft = GameDraft.parse(room.draft);
  const report = verifyGame(draft);
  if (!report.ok) {
    throw new Error(`Room "${id}" failed verification: ${report.issues.map((i) => i.message).join(" ")}`);
  }

  // Answers are hashed here, on the server. The browser never sees them.
  return <GameEngine game={await sealGame(draft)} ranked />;
}

export default function PlayPage({ params }: PageProps<"/play/[id]">) {
  return (
    <Suspense fallback={<RoomLoader label="Finding the room" className="m-auto" />}>
      <Room params={params} />
    </Suspense>
  );
}
