import { DM_Sans, DM_Mono, Fraunces } from "next/font/google";
import { Providers } from "./providers";
import "../src/styles.css";

// next/font handles subsetting, self-hosting, and FOUT prevention automatically
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata = {
  title: {
    default: "Sprout — Understand your codebase",
    template: "%s — Sprout",
  },
  description:
    "Sprout turns tangled projects into visual maps and explains every line in language that actually makes sense.",
  authors: [{ name: "Sprout" }],
  openGraph: {
    type: "website",
    title: "Sprout — Understand your codebase",
    description:
      "A visual AI coding assistant for understanding every corner of your codebase.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} ${fraunces.variable}`}
    >
      <head>
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
