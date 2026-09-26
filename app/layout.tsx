import "./globals.css";
import type {Viewport} from "next";
export const metadata={title:"Cross-Border Seller Radar",description:"ポケモンカードの買取価格レーダー"};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>}