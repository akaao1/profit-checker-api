export default async function handler(req, res) {
  const keyword = req.query.keyword;

  if (!keyword) {
    return res.status(400).json({ error: "keyword is required" });
  }

  const appId = process.env.RAKUTEN_APP_ID;

  if (!appId) {
    return res.status(500).json({ error: "RAKUTEN_APP_ID is missing" });
  }

  try {
    const params = new URLSearchParams({
      applicationId: appId,
      keyword,
      sort: "+itemPrice",
      hits: "10",
      format: "json"
    });

    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params}`;

    const response = await fetch(url);
    const data = await response.json();

    const items = (data.Items || [])
      .map(x => x.Item)
      .filter(Boolean)
      .sort((a, b) => a.itemPrice - b.itemPrice);

    if (items.length === 0) {
      return res.status(200).json({ item: null });
    }

    const item = items[0];

    return res.status(200).json({
      item: {
        name: item.itemName,
        price: item.itemPrice,
        url: item.itemUrl,
        shopName: item.shopName
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "rakuten api failed",
      message: error.message
    });
  }
}