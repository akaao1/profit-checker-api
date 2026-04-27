export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "method not allowed"
    });
  }

  const keyword = req.query.keyword;

  if (!keyword) {
    return res.status(400).json({
      error: "keyword is required"
    });
  }

  const appId = process.env.RAKUTEN_APP_ID;

  if (!appId) {
    return res.status(500).json({
      error: "RAKUTEN_APP_ID is missing"
    });
  }

  try {
    const params = new URLSearchParams();
    params.set("applicationId", appId);
    params.set("keyword", keyword);
    params.set("sort", "+itemPrice");
    params.set("hits", "10");
    params.set("format", "json");

    const rakutenUrl =
      "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?" +
      params.toString();

    const response = await fetch(rakutenUrl);
    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(502).json({
        error: "rakuten api error",
        status: response.status,
        rakutenError: data
      });
    }

    const items = (data.Items || [])
      .map((x) => x.Item)
      .filter(Boolean)
      .sort((a, b) => Number(a.itemPrice) - Number(b.itemPrice));

    if (items.length === 0) {
      return res.status(200).json({
        item: null
      });
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
