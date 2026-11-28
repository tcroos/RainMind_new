import type { Metadata } from "next";

import { SkillPlaza } from "./skill-plaza";

export const metadata: Metadata = {
    title: "Skill 广场",
    robots: { index: false, follow: false },
};

export default function SkillsPage() {
    return <SkillPlaza />;
}
