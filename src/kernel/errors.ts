// Map raw failures — Google API error blobs, getUserMedia DOMExceptions,
// WebSocket close reasons — to ONE Traditional-Chinese sentence that includes
// the next step. Matching is best-effort substring sniffing over the raw text;
// anything unrecognised keeps its original message so real diagnostics are
// never hidden behind a generic apology.

export function describeError(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
  const m = raw.toLowerCase();

  // getUserMedia — the mic never even opened.
  if (m.includes("notallowederror") || m.includes("permission denied") || m.includes("permission dismissed"))
    return "麥克風權限被拒 — 請在瀏覽器的網站設定裡允許麥克風，再重新開始。";
  if (m.includes("notfounderror") || m.includes("devices not found"))
    return "找不到麥克風 — 請確認裝置有麥克風且未被其他 app 佔用。";
  if (m.includes("notreadableerror"))
    return "麥克風被其他程式佔用中 — 請關閉其他使用麥克風的 app 再試。";

  // Gemini API — key problems.
  if (m.includes("api_key_invalid") || m.includes("api key not valid") || m.includes("api key expired"))
    return "金鑰無效或已停用 — 請到 Google AI Studio（aistudio.google.com/apikey）確認後，在 ⚙️ 更換金鑰。";
  if (m.includes("permission_denied") || m.includes("403"))
    return "這把金鑰沒有權限使用此模型 — 請到 Google AI Studio 檢查金鑰狀態與方案。";

  // Gemini API — quota / load.
  if (m.includes("resource_exhausted") || m.includes("429") || m.includes("quota"))
    return "API 額度已用完（免費層有每分鐘／每日上限）— 請過幾分鐘再試，或到 Google AI Studio 查看用量。重試前先等一下，連續重試不會成功。";
  if (m.includes("503") || m.includes("overloaded") || m.includes("unavailable"))
    return "Google 模型暫時忙碌 — 請過一會兒再試。";

  // Model renamed / retired — the ⚙️ override exists exactly for this.
  if (m.includes("not_found") || (m.includes("404") && m.includes("model")) || m.includes("is not found"))
    return "找不到模型（可能已改名或下架）— 可在 ⚙️ 的「語音模型」欄填入新的模型名稱。";

  // Plain connectivity.
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network error") || m.includes("load failed"))
    return "網路連線失敗 — 請確認手機網路後再試。";

  return raw || "未知錯誤";
}
