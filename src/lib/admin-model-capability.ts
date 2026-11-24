import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store-types";
import { emptyAdvancedConfig, protocolCatalogCapability, protocolModelConfig, resolveChannelModelConfig } from "@/lib/channel-protocol-registry";
import { normalizeModelId } from "@/lib/model-capability";

/** Apply only explicit capability edits; ordinary channel saves remain channel-authoritative. */
export function applyLogicalModelCapabilityEdits(previous: LogicalModel[], submitted: LogicalModel[], channels: SystemModelChannel[]) {
    const edits = submitted.filter(model => previous.some(old => old.id === model.id && old.capability !== model.capability));
    if (!edits.length) return channels;
    const targets = new Map<string, LogicalModel["capability"]>();
    for (const model of edits) {
        for (const binding of model.bindings) {
            const key = `${binding.channelId}\0${normalizeModelId(binding.upstreamModel)}`;
            if (targets.has(key) && targets.get(key) !== model.capability) throw new Error(`上游模型 ${binding.upstreamModel} 的能力修改冲突`);
            targets.set(key, model.capability);
        }
    }
    return channels.map(channel => {
        let advanced = channel.advancedConfig;
        for (const upstreamModel of channel.models) {
            const key = normalizeModelId(upstreamModel);
            const capability = targets.get(`${channel.id}\0${key}`);
            if (!capability) continue;
            const base = advanced || emptyAdvancedConfig();
            const catalogCapability = protocolCatalogCapability(base.protocol);
            if (catalogCapability && catalogCapability !== capability) throw new Error(`${channel.name} 的渠道协议不支持 ${capability}，请先修改渠道协议`);
            const current = resolveChannelModelConfig(base, upstreamModel);
            const protocol = current?.protocol || base.protocol;
            // Keep an explicitly supplied matching operation; never reuse an old text path.
            const operation = base.operationConfigs?.[capability];
            const config = current?.capability === capability ? current : operation?.capability === capability ? operation : protocolModelConfig(protocol, capability, upstreamModel);
            if (!config) throw new Error(`${channel.name} / ${upstreamModel} 缺少 ${capability} 协议配置，请先在渠道中配置该模型的能力、协议和路径`);
            advanced = {
                ...base,
                modelCapabilities: { ...base.modelCapabilities, [key]: capability },
                modelConfigs: { ...base.modelConfigs, [key]: { ...config, capability, source: "manual" } },
            };
        }
        return advanced === channel.advancedConfig ? channel : { ...channel, advancedConfig: advanced };
    });
}
