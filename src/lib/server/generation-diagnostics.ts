/** Opt-in structured measurements. Only explicit identifiers/counters may be passed; never payloads or URLs. */
export function generationDiagnostic(event: string, fields: Record<string, string | number | boolean | null | undefined>) {
    if (process.env.VOZEB_PRO_GENERATION_DIAGNOSTICS !== "1") return;
    console.info("GENERATION_DIAGNOSTIC", JSON.stringify({ event, at: Date.now(), ...fields }));
}
