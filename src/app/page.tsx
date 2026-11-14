import Link from "next/link";
import { Suspense } from "react";
import { formatTime } from "@/lib/format";
import { getStore, loadRoom } from "@/lib/store";

const STEPS = [
  { title: "Photograph four walls", text: "Stand in the middle of any room and take one photo of each wall. Location data is removed on your device." },
  { title: "Check what the AI saw", text: "The AI lists objects and facts it can count or read. You fix its mistakes and blur anything private." },
  { title: "A solver proves it", text: "The AI chains your real objects into puzzles. A solver rejects any room that cannot be escaped." },
  { title: "Race your friends", text: "Share one link. Everyone plays in the browser and the fastest escape tops the board." },
];

const THEME_NAMES = { detective: "Detective", horror: "Horror", scifi: "Sci-fi" } as const;

/** Rooms anyone can play without creating one: the built-in demo, plus ids listed in FEATURED_ROOMS. */
async function FeaturedRooms() {
  const ids = ["demo", ...(process.env.FEATURED_ROOMS ?? "").split(",").map((id) => id.trim()).filter(Boolean)].slice(0, 6);
  const rooms = (
    await Promise.all(
      ids.map(async (id) => {
        const room = await loadRoom(id).catch(() => null);
        if (!room?.published) return null;
        const [best] = await getStore().topRuns(id, 1).catch(() => []);
        return { id, draft: room.draft, best };
      }),
    )
  ).filter((r) => r !== null);

  return (
    <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rooms.map(({ id, draft, best }) => (
        <li key={id}>
          <Link
            href={`/play/${id}`}
            className="group block overflow-hidden rounded-xl bg-stone-900 ring-1 ring-stone-800 hover:ring-amber-400/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.walls[0].imageUrl} alt="" loading="lazy" className="aspect-video w-full object-cover opacity-80 transition group-hover:opacity-100" />
            <div className="px-4 py-3">
              <p className="font-medium text-stone-50">{draft.title}</p>
              <p className="mt-1 text-sm text-stone-400">
                {THEME_NAMES[draft.theme]} · {draft.puzzles.length} puzzles
                {best ? ` · best ${formatTime(best.ms)}` : " · no escapes yet"}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-14 sm:py-20">
      <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">Roomscape</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight text-stone-50 sm:text-5xl">
        Your room is the escape room.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-300">
        Photograph four walls. AI turns the things you actually own into a chain of puzzles, a solver proves the room
        can be escaped, and your friends race to get out.
      </p>
      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          href="/create"
          className="rounded-full bg-amber-400 px-8 py-3 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200"
        >
          Create a room
        </Link>
        <Link
          href="/play/demo"
          className="rounded-full border border-stone-600 px-8 py-3 font-semibold text-stone-100 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200"
        >
          Play the demo room
        </Link>
      </div>

      <section aria-labelledby="how" className="mt-16">
        <h2 id="how" className="text-xs uppercase tracking-widest text-stone-500">
          How it works
        </h2>
        <ol className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <p className="font-mono text-sm text-amber-300">0{i + 1}</p>
              <p className="mt-1 font-medium text-stone-100">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-stone-400">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="rooms" className="mt-16">
        <h2 id="rooms" className="text-xs uppercase tracking-widest text-stone-500">
          Rooms to play right now
        </h2>
        <Suspense fallback={<p className="mt-5 text-sm text-stone-500">Loading rooms…</p>}>
          <FeaturedRooms />
        </Suspense>
      </section>

      <footer className="mt-16 border-t border-stone-800 pt-6 text-sm text-stone-500">
        Built for IceHacks 2026. Photos are processed by Google Gemini; nothing is stored unless you publish a room.
      </footer>
    </main>
  );
}
