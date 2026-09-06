import { Nav } from "@/components/marketing-v3/Nav";
import { Footer } from "@/components/marketing-v3/Footer";
import { marketingFontClasses } from "@/lib/marketing-fonts";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`sf-page-v3 ${marketingFontClasses}`}>
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
