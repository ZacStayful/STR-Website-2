import { createSupabaseServerClient } from "@/lib/supabase/server";

// Streams audio back from ElevenLabs. The v3 model is more expressive but
// slower than the turbo models, so give it generous headroom over the 10s
// Hobby default.
export const maxDuration = 60;

// ElevenLabs' well-known default voice ("Rachel") — used unless ELEVENLABS_VOICE_ID
// is set to a specific cloned/branded voice.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Voice isn't configured yet (missing ELEVENLABS_API_KEY)." },
      { status: 503 },
    );
  }
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  // Match the narrator route: never synthesise for an unauthenticated request.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "You need to sign in to use the narrator." }, { status: 401 });
  }

  let text: string;
  try {
    const body = (await request.json()) as { text?: unknown };
    text = String(body.text ?? "").slice(0, 5000);
    if (!text.trim()) throw new Error("empty");
  } catch {
    return Response.json({ error: "No text to speak." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          // Eleven v3 — the most expressive model. Note v3 treats `stability`
          // as discrete steps (0.0 Creative / 0.5 Natural / 1.0 Robust) rather
          // than a free float, and effectively ignores `style`.
          model_id: "eleven_v3",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );
  } catch (err) {
    console.error("[api/speak] network error:", err);
    return Response.json({ error: "Could not reach the voice service." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("[api/speak] ElevenLabs error", upstream.status, detail.slice(0, 500));
    return Response.json({ error: "Voice synthesis failed." }, { status: 502 });
  }

  // Stream the MP3 straight through to the client.
  return new Response(upstream.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
    },
  });
}
