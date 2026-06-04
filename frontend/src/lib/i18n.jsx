import React, { createContext, useContext, useEffect, useState } from "react";

const STRINGS = {
    en: {
        "app.name": "TekWissen — EZ Workplace",
        "landing.headline": "One-touch service for every room, cabin & hall.",
        "landing.sub": "Replace calls, walk-ins and chat pings with a calm, intelligent request system.",
        "landing.room_access": "Room Access",
        "landing.room_access_sub": "For tablets in meeting rooms",
        "landing.enter_pin": "Enter Room PIN",
        "landing.access_btn": "Access Room",
        "landing.staff_signin": "Staff & Admin Sign In",
        "kiosk.how": "How can we help?",
        "kiosk.tap": "Tap to request",
        "kiosk.recent": "Recent from this room",
        "kiosk.mode_request": "Request",
        "kiosk.mode_order": "Order Food",
        "kiosk.mode_controls": "Room Controls",
        "kiosk.cart": "Cart",
        "kiosk.checkout": "Place order",
        "kiosk.empty_cart": "Your cart is empty",
        "kiosk.exit": "Exit",
        "common.cancel": "Cancel",
        "common.confirm": "Confirm",
        "common.delete": "Delete",
        "common.save": "Save",
    },
    hi: {
        "app.name": "टेकविसेन — EZ वर्कप्लेस",
        "landing.headline": "हर कमरे, केबिन और हॉल के लिए वन-टच सर्विस।",
        "landing.sub": "कॉल, वॉक-इन और चैट के बजाय एक शांत, बुद्धिमान अनुरोध प्रणाली।",
        "landing.room_access": "रूम एक्सेस",
        "landing.room_access_sub": "मीटिंग रूम के टैबलेट के लिए",
        "landing.enter_pin": "रूम पिन दर्ज करें",
        "landing.access_btn": "रूम में जाएं",
        "landing.staff_signin": "स्टाफ और एडमिन साइन इन",
        "kiosk.how": "हम कैसे मदद कर सकते हैं?",
        "kiosk.tap": "अनुरोध के लिए टैप करें",
        "kiosk.recent": "इस कमरे से हाल के अनुरोध",
        "kiosk.mode_request": "अनुरोध",
        "kiosk.mode_order": "खाना ऑर्डर करें",
        "kiosk.mode_controls": "रूम कंट्रोल",
        "kiosk.cart": "कार्ट",
        "kiosk.checkout": "ऑर्डर दें",
        "kiosk.empty_cart": "कार्ट खाली है",
        "kiosk.exit": "बाहर",
        "common.cancel": "रद्द",
        "common.confirm": "पुष्टि",
        "common.delete": "हटाएं",
        "common.save": "सहेजें",
    },
};

const I18nCtx = createContext({ lang: "en", t: (k) => k, setLang: () => {} });

export function I18nProvider({ children }) {
    const [lang, setLang] = useState(() => localStorage.getItem("sw_lang") || "en");
    useEffect(() => {
        localStorage.setItem("sw_lang", lang);
    }, [lang]);
    const t = (key) => STRINGS[lang]?.[key] || STRINGS.en[key] || key;
    return <I18nCtx.Provider value={{ lang, t, setLang }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
