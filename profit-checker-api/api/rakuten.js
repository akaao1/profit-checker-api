export default async function handler(req, res) {
  try {
    const keyword = req.query.keyword;

    if (!keyword) {
      return res.status(400).json({ error: "keyword required" });
    }

    const appId = process.env.RAKUTEN_APP_ID;

    const keywords = [
      keyword,
      keyword.split(" ")[1] || keyword, // 型番だけ
      keyword.split(" ")[0] || keyword, // ブランドだけ
      keyword.replace(/[A-Z]{2,}/g, "").trim(), // 型番抜き
    ];

    let allItems = [];

    for (let i = 0; i < keywords.length; i++) {
      const k = keywords[i];
      if (!k) continue;

      const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${appId}&keyword=${encodeURIComponent(
        k
      )}&hits=10`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.Items) {
        const items = data.Items.map((i) => i.Item);
        allItems = allItems.concat(items);
      }

      // ←これが超重要（API制限回避）
      await new Promise((r) => setTimeout(r, 700));
    }

    // 重複削除
    const seen = new Set();
    const unique = allItems.filter((item) => {
      const key = item.itemName;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.status(200).json({
      candidates: unique.slice(0, 20),
    });
  } catch (e) {
    return res.status(500).json({
      error: "rakuten api error",
      message: e.message,
    });
  }
}
