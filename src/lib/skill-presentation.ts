/**
 * 快捷 Skill 的展示信息（参照 Seko）：缩略图、选中后输入框里的专属引导语。
 * Skill 本身的定义在服务端（lib/server/agent-skills），这里只管首页怎么展示。
 * 没登记的 Skill 退回通用占位：无缩略图（用首字），引导语用它的 description。
 */
type SkillPresentation = { cover?: string; placeholder: string; example?: string; tagline?: string };

const PRESENTATIONS: Record<string, SkillPresentation> = {
    "ecommerce-image": { cover: "/skills/ecommerce.webp", placeholder: "上传商品图，说明要做主图、详情页还是种草图，以及风格和卖点", example: "为这款琥珀色香水做一张电商主图：米色石台、柔和棚拍光，突出瓶身质感，再出一张小红书风格的种草图", tagline: "主图、详情页、种草图一次出齐" },
    "yanai-natural-beauty": { cover: "/skills/beauty.webp", placeholder: "上传人像照片，说明想调整的地方，比如肤色、光线、瑕疵，会保留真实肤质", example: "帮我精修这张人像：提亮肤色、去掉痘印和黑眼圈，保留皮肤纹理，整体自然不要磨皮感", tagline: "保留真实肤质的自然精修" },
    "character-design": { cover: "/skills/character.webp", placeholder: "输入角色设定，如年龄、性别、职业、性格特征、服装风格等等", example: "18 岁少女，银色短发，红色机能夹克，性格开朗但嘴硬，赛博都市快递员，需要正侧背三视图和 4 个表情", tagline: "一致的角色三视图与表情" },
    "image-motion": { cover: "/skills/motion.webp", placeholder: "上传一张图片，描述想让画面怎么动，比如镜头推近、人物转身、水面流动", example: "让画面里的锦鲤缓缓游动，水面泛起涟漪，镜头轻微推近，时长 5 秒", tagline: "让静态画面自然动起来" },
    "drama-planning": { cover: "/skills/drama.webp", placeholder: "输入短剧主题或一句话故事，如题材、主角关系、核心冲突、想要的集数", example: "都市逆袭题材，被退婚的女主三年后以集团继承人身份回归，前男友成了她的下属，10 集，每集 1 分钟", tagline: "一句话变成可开拍的分镜" },
};

export function skillPresentation(skill: { id: string; description?: string }): SkillPresentation {
    return PRESENTATIONS[skill.id] || { placeholder: skill.description || "描述你的创作需求" };
}
