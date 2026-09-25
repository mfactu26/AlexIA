import type {Metadata,Viewport} from "next";import "./globals.css";
export const metadata:Metadata={title:"AlexIA",description:"Votre IA personnelle, autonome et toujours disponible",manifest:"/manifest.webmanifest",icons:{icon:"/icon.svg",apple:"/icon.svg"},appleWebApp:{capable:true,title:"AlexIA",statusBarStyle:"black-translucent"}};
export const viewport:Viewport={themeColor:"#765cff",width:"device-width",initialScale:1,viewportFit:"cover"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="fr"><body>{children}</body></html>}