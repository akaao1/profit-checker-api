export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const keyword = req.query.keyword;

  if (!keyword) {
    return res.status(400).json({
      error: "keyword is required"
    });
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
      hits: "10",
      format: "json",
      formatVersion: "2"
    });

    const url =
      "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?" +
      params.toString();

    const response = await fetch(url, {
      headers: {
        referer: "https://profit-checker-api.vercel.app/",
        origin: "https://profit-checker-api.vercel.app"
      }
    });

    const data = await response.json();

    if (!response.ok || data.error || data.errors) {
      return res.status(502).json({
        error: "rakuten api error",
        status: response.status,
        rakutenError: data
      });
    }

    const rawItems = data.Items || data.items || [];

    const normalizedItems = rawItems
      .map((x) => x.Item || x)
      .filter(Boolean)
      .map((item) => ({
        name: item.itemName || item.name || "",
        price: Number(item.itemPrice || item.itemPriceMin || item.price || 0),
        url: item.itemUrl || item.url || "",
        shopName: item.shopName || ""
      }))
      .filter((item) => item.price > 0)
      .sort((a, b) => a.price - b.price);

    if (normalizedItems.length === 0) {
      return res.status(200).json({
        item: null
      });
    }

    const item = normalizedItems[0];

    return res.status(200).json({
      item: {
        name: item.name,
        price: item.price,
        url: item.url,
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
