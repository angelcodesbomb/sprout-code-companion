import { Link } from "@tanstack/react-router";
import { SproutMark } from "../shared/SproutMark";
import { ActionButton } from "../shared/ActionButton";
import { ThemeToggle } from "../shared/ThemeToggle";

export function NavBar({ links, isDark, onThemeToggle, ctaLabel }) {
  return (
    <header className="site-nav">
      <Link to="/" className="site-nav__logo"><SproutMark /></Link>
      <nav className="site-nav__links" aria-label="Main navigation">
        {links.map((link) => link.to.startsWith("/") ? <Link key={link.label} to={link.to}>{link.label}</Link> : <a key={link.label} href={link.to}>{link.label}</a>)}
      </nav>
      <div className="site-nav__actions">
        <ThemeToggle isDark={isDark} onToggle={onThemeToggle} />
        <ActionButton href="/workspace" tone="mint">{ctaLabel}</ActionButton>
      </div>
    </header>
  );
}
