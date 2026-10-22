import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// 入力チェックの決まりの文を日本語にする（すべての画面に効く）
import "./lib/zod-ja";

if ("serviceWorker" in navigator) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {});
}

createRoot(document.getElementById("root")!).render(<App />);
