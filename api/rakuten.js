export default async function handler(req, res) {
  const keyword = req.query.keyword;

  if (!keyword) {
    return res.status(400).json({ error: "keyword is required" });
  }

  const appId = process.env.RAKUTEN_APP_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;

  if (!appId || !accessKey) {
    return res.status(500).json({
      error: "RAKUTEN_APP_ID or RAKUTEN_ACCESS_KEY is missing"
    });
  }

  try {
    const params = new URLSearchParams({
      applicationId: appId,
      accessKey: accessKey,
      keyword: keyword,
      sort: "+itemPrice",
      hits: "10",
      format: "json",
      formatVersion: "2"
    });

    const url =
      "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?" +
      params.toString();

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(502).json({
        error: "rakuten api error",
        status: response.status,
        rakutenError: data
      });
    }

    const items = (data.items || [])
      .filter(Boolean)
      .sort((a, b) => Number(a.itemPrice) - Number(b.itemPrice));

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
      error: "server error",
      message: error.message
    });
  }
}
