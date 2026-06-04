import React, { useState } from "react";

/**
 * BrandLogo — TekWissen — EZ Workplace brand mark.
 *
 * Renders the TekWissen wide logo (`/tekwissen-logo.jpg`) + an "EZ" pill
 * beside it. The TEKWISSEN wordmark is already in the logo art, so we don't
 * repeat the company name in text.
 *
 * Falls back to a styled "TW" tile + "TekWissen" wordmark if the image
 * fails to load (e.g., the file was removed).
 *
 * Props:
 *   height     — pixel height for the logo image (default 32)
 *   variant    — "dark" | "light" — affects the EZ pill colours
 *   showSuffix — whether to render the "EZ" pill beside the logo (default true)
 */
export default function BrandLogo({
    height = 32,
    variant = "dark",
    showSuffix = true,
}) {
    const [errored, setErrored] = useState(false);

    // EZ pill colours per surface
    const ezClass = variant === "light"
        ? "bg-white text-[#0055FF]"
        : "bg-[#0055FF] text-white";

    return (
        <span className="inline-flex items-center gap-2 select-none" data-testid="brand-logo">
            {!errored ? (
                <span
                    className="inline-flex items-center bg-white rounded-md overflow-hidden shrink-0"
                    style={{ height, padding: 2 }}
                >
                    <img
                        src="/tekwissen-logo.jpg"
                        alt="TekWissen"
                        onError={() => setErrored(true)}
                        style={{ height: height - 4 }}
                        className="object-contain"
                    />
                </span>
            ) : (
                <span
                    aria-label="TekWissen"
                    style={{ height, paddingInline: 8 }}
                    className={`rounded-md inline-flex items-center shrink-0 font-display font-bold tracking-tight ${
                        variant === "light"
                            ? "bg-white text-[#0055FF]"
                            : "bg-[#0055FF] text-white"
                    }`}
                >
                    <span style={{ fontSize: Math.round(height * 0.36) }}>TekWissen</span>
                </span>
            )}
            {showSuffix && (
                <span
                    style={{ height, paddingInline: 8 }}
                    className={`rounded-md inline-flex items-center font-display font-bold tracking-wider text-sm shrink-0 ${ezClass}`}
                >
                    EZ
                </span>
            )}
        </span>
    );
}
