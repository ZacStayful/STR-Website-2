// Shared state machine for the Jarvis eye / narrator. Mirrors the states used
// in the Stayful Jarvis UI repo so the eye component can be reused verbatim.
//   idle      — ambient, waiting
//   thinking  — generating the summary (waiting on the model / TTS)
//   speaking  — audio is playing
//   listening — capturing microphone input (reserved; not used by the analyser
//               narrator yet, but kept so the eye stays drop-in compatible)
export type JARVISState = "idle" | "thinking" | "speaking" | "listening";
