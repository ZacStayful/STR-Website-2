import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { startAction } from "@/lib/credit/action";
import { runMetered } from "@/lib/credit/context";
import { InsufficientCreditError } from "@/lib/credit/ledger";
import { insufficientCreditResponse } from "@/lib/credit/http";
import { meter } from "@/lib/credit/meter";
import { VOICE, ttsVoiceSettings, voiceId as personaVoiceId } from "@/lib/persona/stayful-intelligence";

// Streams audio back from ElevenLabs. Give it headroom over the 10s Hobby
// default so longer summaries finish synthesising.
export const maxDuration = 30;


export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Voice isn't configured yet (missing ELEVENLABS_API_KEY)." },
      { status: 503 },
    );
  }
  // Batch 23, Part 0: the one Stayful Intelligence voice, shared with the phone agent.
  const voiceId = personaVoiceId();

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

  // Credit: ElevenLabs bills per character, known before the call.
  let action;
  try {
    action = await startAction({ userId: user.id, admin: isAdminEmail(user.email), action: "speak" });
  } catch (err) {
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(err, "speak");
    throw err;
  }

  let upstream: Response;
  try {
    upstream = await runMetered(action.ctx, () =>
      meter(
        { provider: "elevenlabs", unit: "character", quantity: text.length, description: "AI narration voice", failed: (r) => !r.ok },
        () =>
          fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "content-type": "application/json",
              accept: "audio/mpeg",
            },
            // Batch 21 (G7): give up inside the route's 30 s, so the credit reservation is released rather than held to its TTL.
            signal: AbortSignal.timeout(15_000),
            body: JSON.stringify({
              text,
              // Model and voice settings: the persona's (src/lib/persona), so the
              // analyser and calls sound the same.
              model_id: VOICE.modelId,
              voice_settings: ttsVoiceSettings(),
            }),
          }),
      ),
    );
  } catch (err) {
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(err, "speak");
    console.error("[api/speak] network error:", err);
    return Response.json({ error: "Could not reach the voice service." }, { status: 502 });
  } finally {
    await action.finish().catch(() => {});
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
