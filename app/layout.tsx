import type { Metadata } from "next";
import "./integration.css";
import "./readability.css";
import "./premium.css";

export const metadata: Metadata = {
  title: "IntegrationOS — Command Center",
  description:
    "Your systems, in sync. Workflow orchestration and execution observability.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
