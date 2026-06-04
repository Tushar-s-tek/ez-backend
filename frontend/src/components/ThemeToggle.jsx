import React from "react";
import { useTheme } from "@/lib/theme";
import { Sun, Moon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export default function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const dark = theme === "dark";
    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(dark ? "light" : "dark")}
            data-testid="theme-toggle-btn"
            className="text-gray-600 dark:text-gray-300"
            aria-label="Toggle theme"
        >
            {dark ? <Sun size={18} weight="regular" /> : <Moon size={18} weight="regular" />}
        </Button>
    );
}
