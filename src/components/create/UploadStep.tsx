"use client";

import { useState } from "react";
import { WALL_IDS, type WallId } from "@/lib/game/schema";
import { prepareImage } from "@/lib/image";
import { OWN_KEY_STORAGE, type WallPhotos } from "./CreateFlow";

const WALL_LABELS: Record<WallId, string> = { N: "Wall 1", E: "Wall 2", S: "Wall 3", W: "Wall 4" };

type Props = {
  photos: Partial<WallPhotos>;
  onChange: (photos: Partial<WallPhotos>) => void;
  onScan: (photos: WallPhotos) => void;
  onUseScan: () => void;
  error?: string;
};

export function UploadStep({ photos, onChange, onScan, onUseScan, error }: Props) {
  const [busy, setBusy] = useState<WallId | null>(null);
  const [localError, setLocalError] = useState("");
  const ready = WALL_IDS.every((id) => photos[id]);

  async function pick(id: WallId, file: File | undefined) {
    if (!file) return;
    setBusy(id);
    setLocalError("");
    try {
      const prepared = await prepareImage(file);
      if (photos[id]) URL.revokeObjectURL(photos[id].url);
      onChange({ ...photos, [id]: prepared });
    } catch {
      setLocalError("That file could not be read as a photo. Try a JPEG or PNG.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">Step 1 of 2</p>
      <h1 className="mt-3 text-3xl font-semibold text-stone-50">Photograph your four walls</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-stone-300">
        Stand in the middle of the room and turn clockwise, taking one landscape photo of each wall, straight on, with
        the lights on. Include a door if you can.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4">
        {WALL_IDS.map((id) => {
          const photo = photos[id];
          return (
            <label
              key={id}
              className="group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-stone-700 bg-stone-900 text-center hover:border-amber-400 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber-300"
            >
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt={`${WALL_LABELS[id]} preview`} className="absolute inset-0 h-full w-full object-cover" />
              )}
              <span className={`relative rounded-full px-3 py-1 text-sm ${photo ? "bg-black/70 text-stone-100" : "text-stone-300"}`}>
                {busy === id ? "Preparing…" : photo ? `${WALL_LABELS[id]} · change` : `${WALL_LABELS[id]} · add photo`}
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  pick(id, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          );
        })}
      </div>

      <ul className="mt-6 space-y-1 text-sm text-stone-400">
        <li>Photos are shrunk and stripped of location data in your browser before they are sent.</li>
        <li>
          The scan uses Google&apos;s Gemini API free tier, which may use submitted images to improve Google products.
          Move anything private out of frame first.
        </li>
      </ul>

      <p role="alert" className="mt-4 min-h-6 text-sm text-red-300">
        {localError || error || ""}
      </p>

      <button
        disabled={!ready || busy !== null}
        onClick={() => onScan(photos as WallPhotos)}
        className="mt-2 self-start rounded-full bg-amber-400 px-8 py-3 font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
      >
        Scan my room
      </button>

      <OwnKey />

      <div className="mt-4 rounded-xl bg-stone-900 p-4 ring-1 ring-stone-800">
        <p className="font-medium text-stone-100">Want players to walk around your room?</p>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          Scan it in 3D with a free phone app and upload the file. The game then plays in first person, inside the
          real room.
        </p>
        <button
          onClick={onUseScan}
          className="mt-3 rounded-full border border-amber-400/70 px-5 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-400/10"
        >
          Use a 3D scan
        </button>
      </div>
    </main>
  );
}

/** Lets a creator use their own free Gemini key, so room making does not depend on the shared daily quota. */
function OwnKey() {
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState("");

  return (
    <details
      className="mt-10 rounded-xl bg-stone-900 p-4 ring-1 ring-stone-800"
      onToggle={() => {
        try {
          setSaved(Boolean(window.localStorage.getItem(OWN_KEY_STORAGE)));
        } catch {}
      }}
    >
      <summary className="cursor-pointer font-medium text-stone-100">Scan failing or busy? Use your own free AI key</summary>
      <p className="mt-2 text-sm leading-relaxed text-stone-400">
        This site shares one free Gemini quota between everyone, and it runs out. A key from Google AI Studio is free
        and gives you your own. It is saved only in this browser and sent only with your scan requests.
      </p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (value.trim()) window.localStorage.setItem(OWN_KEY_STORAGE, value.trim());
            setSaved(Boolean(value.trim()) || saved);
            setValue("");
          } catch {}
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Gemini API key"
          placeholder={saved ? "A key is saved. Paste another to replace it." : "Paste your Gemini API key"}
          className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus-visible:outline-2 focus-visible:outline-amber-300"
        />
        <button type="submit" disabled={!value.trim()} className="rounded-full bg-amber-400 px-5 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-300 disabled:opacity-40">
          Save
        </button>
        {saved && (
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.removeItem(OWN_KEY_STORAGE);
              } catch {}
              setSaved(false);
            }}
            className="rounded-full border border-stone-700 px-5 py-2 text-sm text-stone-300 hover:bg-stone-800"
          >
            Remove saved key
          </button>
        )}
      </form>
      <p className="mt-2 text-sm text-stone-500" role="status">
        {saved ? "Your own key is in use on this device." : "No key saved: the shared quota is used."}
      </p>
    </details>
  );
}
