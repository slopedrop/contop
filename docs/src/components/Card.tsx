import React from 'react';

interface CardProps {
  title: string;
  description: string;
  href?: string;
}

export function Card({ title, description, href }: CardProps) {
  const content = (
    <div className="feature-card">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );

  if (href) {
    return <a href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>{content}</a>;
  }
  return content;
}

interface CardGridProps {
  children: React.ReactNode;
}

export function CardGrid({ children }: CardGridProps) {
  return <div className="feature-grid">{children}</div>;
}
