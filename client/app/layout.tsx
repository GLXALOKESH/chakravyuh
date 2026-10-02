import type { Metadata } from "next";
import { Anek_Devanagari, Anek_Latin } from "next/font/google";
import { EnterScreen } from "@/components/ui/EnterScreen";
import "./globals.css";

const anek = Anek_Latin({
  variable: "--font-anek",
  subsets: ["latin"],
  axes: ["wdth"],
});

const anekDeva = Anek_Devanagari({
  variable: "--font-anek-deva",
  subsets: ["devanagari"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "Chakravyuh: Fraud Network Intelligence",
  description:
    "Turns a flagged bank account into an investigator-ready case: the fraud ring, each account's role, the tainted money trail, the accounts to freeze, and the likely next recruit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${anek.variable} ${anekDeva.variable} antialiased`} suppressHydrationWarning>
      <body>
        <EnterScreen />
        {children}
      </body>
    </html>
  );
}
