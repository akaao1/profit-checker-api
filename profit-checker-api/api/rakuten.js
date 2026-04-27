export default async function handler(req, res) {
  const { keyword } = req.query;

  if (!keyword) {
    return res.status(400).json({ error: "keyword is required" });
  }

  const appId = process.env.RAKUTEN_APP_ID;

  const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?applicationId=${appId}&keyword=${encodeURIComponent(keyword)}&hits=5&sort=+itemPrice`;

  try {
    const response = await fetch(url, {
      headers: {
        Referer: "https://example.com/"
      }
    });

    const data = await response.json();

    if (!data.Items || data.Items.length === 0) {
      return res.status(200).json({ item: null });
    }

    const item = data.Items[0].Item;

    return res.status(200).json({
      item: {
        name: item.itemName,
        price: item.itemPrice,
        url: item.itemUrl,
        shopName: item.shopName
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
