import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/i18n/client";
import { ClientRoot } from "@/client/root";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider><ClientRoot /></I18nProvider></StrictMode>);
