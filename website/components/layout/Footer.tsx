const PRODUCT_LINKS = [
  {
    label: "Download Desktop",
    href: "https://github.com/slopedrop/contop/releases/latest",
    external: true,
  },
  {
    label: "Download Mobile",
    href: "https://github.com/slopedrop/contop/releases/latest",
    external: true,
  },
  {
    label: "GitHub",
    href: "https://github.com/slopedrop/contop",
    external: true,
  },
];

const RESOURCE_LINKS = [
  {
    label: "Documentation",
    href: "https://docs.contop.app",
    external: true,
  },
  { label: "How It Works", href: "#how-it-works", external: false },
  { label: "Features", href: "#features", external: false },
];

const PROJECT_LINKS = [
  {
    label: "Open Source",
    href: "https://github.com/slopedrop/contop",
    external: true,
  },
  {
    label: "GitHub Stars",
    href: "https://github.com/slopedrop/contop/stargazers",
    external: true,
  },
  {
    label: "Credits",
    href: "https://github.com/slopedrop/contop#credits",
    external: true,
  },
];

function FooterLink({
  href,
  external,
  children,
}: {
  href: string;
  external: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
      className="block text-sm text-text-secondary transition-colors duration-200 hover:text-accent-light"
    >
      {children}
    </a>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string; external: boolean }[];
}) {
  return (
    <div>
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-text-secondary">
        {title}
      </p>
      <ul className="flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.label}>
            <FooterLink href={link.href} external={link.external}>
              {link.label}
            </FooterLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer
      className="border-t border-white/[0.06] bg-surface-1"
      aria-label="Site footer"
    >
      <div className="mx-auto max-w-5xl px-6 py-16 sm:px-8">
        {/* Brand */}
        <p className="mb-10 text-xl font-bold tracking-tight text-text-primary">
          Contop
        </p>

        {/* Link columns */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Resources" links={RESOURCE_LINKS} />
          <FooterColumn title="Project" links={PROJECT_LINKS} />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-8">
          <p className="text-xs text-text-muted">
            &copy; 2026 Contop. Open source under MIT license.
          </p>
        </div>
      </div>
    </footer>
  );
}
