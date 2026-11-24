export function videoModelFamily(model: string) {
    const name = model.trim().toLowerCase();
    if (name === "seedance-2.0-mini" || /^sd2\.0-mini933-720p-x(?:10s|15s|5-15s)$/.test(name) || /^doubao-seedance-2\.0-mini$/.test(name)) return { id: "seedance-2.0-mini", name: "Seedance 2.0 Mini" };
    if (name === "seedance-2.0-fast" || /^sd2\.0-933-720p-fast-x(?:10s|15s|5-15s)$/.test(name) || /^doubao-seedance-2\.0-fast$/.test(name)) return { id: "seedance-2.0-fast", name: "Seedance 2.0 Fast" };
    if (name === "seedance-2.0" || /^doubao-seedance-2\.0$/.test(name)) return { id: "seedance-2.0", name: "Seedance 2.0" };
    if (name === "seedance-2.5" || /^doubao-seedance-2\.5$/.test(name)) return { id: "seedance-2.5", name: "Seedance 2.5" };
    // MiniMax H3 全部上游名归到一个模型，清晰度由前端参数面板选择（480 / 768 / 1440）
    if (
        name === "minimax-h3" ||
        name === "minimax-h3-768p" ||
        name === "minimax-h3-1440p" ||
        name === "minimax-h3-480p" ||
        name === "minimax-h3-ref" ||
        name === "minimax-h3-720p" ||
        name === "minimax-h3-1080p" ||
        name === "minimax-h3-2k" ||
        /^minimax-h3-\d+p-933-(?:10s|15s|10s-15s|10-15s)$/.test(name) ||
        /^minimax-h3-933-(?:768p|1440p)-(?:10s|15s|10s-15s|10-15s)$/.test(name)
    ) {
        return { id: "minimax-h3-768p", name: "MiniMax H3" };
    }
    if (/^minimaxh3-(?:480p|720p|2k)-sec$/.test(name)) {
        return { id: "minimax-h3-discount", name: "MiniMax H3" };
    }
    if (/^minimaxh3-(?:480p|720p|2k)$/.test(name)) {
        return { id: "minimax-h3-request", name: "MiniMax H3 按次" };
    }
    if (/^minimaxh3-(?:480p|720p)-realistic-sec$/.test(name)) {
        return { id: "minimax-h3-realistic", name: "MiniMax H3 Realistic" };
    }
    if (/^minimaxh3-(?:480p|720p)-realistic$/.test(name)) {
        return { id: "minimax-h3-realistic-request", name: "MiniMax H3 Realistic 按次" };
    }
    return undefined;
}
