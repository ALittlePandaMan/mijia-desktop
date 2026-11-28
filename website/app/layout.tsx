import type {Metadata} from 'next';
import {siteThemeInit} from './site-theme';
import {siteAsset} from './site-path';
import './promo.css';
const title = '米家Desktop · 在电脑上用米家';
const description = '米家Desktop 是免费开源的 Windows 客户端，可管理米家设备、同屏查看多路监控，并通过 MCP 接入兼容的 AI 助手。';
const siteUrl = new URL('https://mijia.panda626.site/');

export const metadata: Metadata = {
 title,
 description,
 metadataBase: siteUrl,
 alternates: {canonical:siteUrl.href},
 openGraph: {
  title,
  description,
  url: siteUrl,
  locale: 'zh_CN',
  type: 'website',
  images: [{url:new URL('social-preview.svg',siteUrl),width:1200,height:630,alt:'米家Desktop · 设备管理、多路监控和智能家居 MCP'}]
 },
 icons: {icon:siteAsset('app-icon-blue.svg')},
 robots: {index:true,follow:true}
};
const fontFace = `@font-face{font-family:MiSans;src:url('${siteAsset('demo/fonts/MiSansVF.ttf')}') format('truetype');font-weight:100 900;font-display:swap}`;

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){
 return <html lang="zh-CN" suppressHydrationWarning>
  <head><script dangerouslySetInnerHTML={{__html:siteThemeInit}}/><style>{fontFace}</style></head>
  <body>{children}</body>
 </html>;
}
