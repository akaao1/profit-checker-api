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
      hits: "5",
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

    return res.status(200).json({
      status: response.status,
      keys: Object.keys(data),
      rawSample: data
    });
  } catch (error) {
    return res.status(500).json({
      error: "server error",
      message: error.message
    });
  }
}
