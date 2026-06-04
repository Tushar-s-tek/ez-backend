import React from "react";
import { useI18n } from "@/lib/i18n";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export default function LanguageToggle() {
    const { lang, setLang } = useI18n();
    return (
        <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="w-24 h-8 text-xs" data-testid="lang-toggle">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">हिन्दी</SelectItem>
            </SelectContent>
        </Select>
    );
}
