import * as PhosphorIcons from "@phosphor-icons/react";
import { Question } from "@phosphor-icons/react";

export function PhosphorIcon({ name, weight = "duotone", size = 32, className = "", color }) {
    const Cmp = PhosphorIcons[name] || Question;
    return <Cmp size={size} weight={weight} className={className} color={color} />;
}

export default PhosphorIcon;
