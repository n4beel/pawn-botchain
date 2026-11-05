import type { Metadata, Viewport } from "next";
import { Arvo, Roboto_Condensed } from "next/font/google";
import { EvmProvider } from "@/components/providers/EvmProvider";
import { ToastProvider } from "@/components/ui/Toast";
import WrongNetworkBar from "@/components/botchain/WrongNetworkBar";
import { app } from "@/lib/app-config";
import "./globals.css";

const pawnTicketTitleFont = Arvo({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const pawnTicketBodyFont = Roboto_Condensed({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: `Pawn Counter: ${app.name}`,
  description: "Borrow BOT against ERC-20 token collateral with lender-stipulated terms.",
};

export const viewport: Viewport = {
  themeColor: "#005C09",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${pawnTicketTitleFont.variable} ${pawnTicketBodyFont.variable}`}>
      <body className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] antialiased font-sans flex flex-col">
        <EvmProvider>
          <ToastProvider>
            <WrongNetworkBar />
            <div className="flex-1 w-full flex flex-col">{children}</div>
          </ToastProvider>
        </EvmProvider>
      </body>
    </html>
  );
}
