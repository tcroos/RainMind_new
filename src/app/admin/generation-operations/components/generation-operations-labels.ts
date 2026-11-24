/** Labels shared by the task troubleshooting table and the cancel review queue. */

export function chargeLabel(charged: boolean, amount?: number) {
    if (!charged) return "未扣款";
    return amount !== undefined ? `已扣款 ${amount} 积分` : "已扣款";
}

export function surfaceLabel(value?: string | null) {
    return value === "canvas" ? "Canvas" : value === "drama" ? "短剧" : value === "chat" ? "创作对话" : "专业工作台";
}
