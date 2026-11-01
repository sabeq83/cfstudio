import "./theme.css";
import "./globals.css";
export const metadata = {
  title: "CF Studio V3",
  description: "Produksi konten otomatis dengan review manusia",
};
export default function RootLayout({ children }) {
  return (
    <html lang="id" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
