import Link from "next/link";

// Thin strip shown to signed-in users so they can move between the two
// members-only surfaces (the analyser and the Market Explorer). Admins also
// get the admin dashboard link that used to live inline in estimate/layout.
export function AppSwitcher({ active, admin }: { active: "estimate" | "markets"; admin?: boolean }) {
  const linkStyle = (isActive: boolean): React.CSSProperties => ({
    color: isActive ? "#fff" : "#B9D5C6",
    fontWeight: 600,
    textDecoration: "none",
    borderBottom: isActive ? "2px solid #B9D5C6" : "2px solid transparent",
    paddingBottom: 2,
  });

  return (
    <nav
      aria-label="Stayful apps"
      style={{
        display: "flex",
        gap: 18,
        justifyContent: "center",
        alignItems: "center",
        padding: "7px 12px",
        fontSize: 13,
        background: "#2E3D2B",
        color: "#fff",
        fontFamily: "var(--font-dmsans), var(--font-sans), system-ui, sans-serif",
      }}
    >
      {admin && <span style={{ opacity: 0.8 }}>Admin</span>}
      <Link href="/estimate" style={linkStyle(active === "estimate")} aria-current={active === "estimate" ? "page" : undefined}>
        Analyser
      </Link>
      <Link href="/markets" style={linkStyle(active === "markets")} aria-current={active === "markets" ? "page" : undefined}>
        Market Explorer
      </Link>
      {admin && (
        <Link href="/admin" style={linkStyle(false)}>
          Dashboard
        </Link>
      )}
    </nav>
  );
}
