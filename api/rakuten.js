export default async function handler(req, res) {
  const appId = process.env.RAKUTEN_APP_ID;

  return res.status(200).json({
    appId: appId,
    length: appId ? appId.length : null
  });
}
