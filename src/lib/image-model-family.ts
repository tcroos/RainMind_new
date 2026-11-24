export function imageModelFamily(model: string) {
    const name = model
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
    if (/^nano-banana-2(?:-[24]k)?$/.test(name) || /^gemini-3\.1-flash-image(?:-preview)?$/.test(name)) return { id: "nano-banana-2", name: "Nano Banana 2" };
    if (/^nano-banana-pro(?:-[24]k)?$/.test(name) || /^gemini-3-pro-image(?:-preview)?$/.test(name)) return { id: "nano-banana-pro", name: "Nano Banana Pro" };
    if (/^gpt-image-2(?:-4k|-adobe|-count|-gpt02)?$/.test(name)) return { id: "gpt-image-2", name: "GPT Image 2" };
    if (/^gpt-image-2\.5(?:-gpt02)?$/.test(name)) return { id: "gpt-image-2.5", name: "GPT Image 2.5" };
    const gpt25 = name.match(/^gpt-image-2\.5-(flare|sunburst)(?:-adobe|-count|-gpt02)?$/);
    if (gpt25) return { id: `gpt-image-2.5-${gpt25[1]}`, name: `GPT Image 2.5 ${gpt25[1] === "flare" ? "Flare" : "Sunburst"}` };
    return undefined;
}
