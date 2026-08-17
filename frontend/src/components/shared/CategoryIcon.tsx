import { Tag } from 'lucide-react';
import { getBrandMark } from '@/lib/brandIcons';
import { cn } from '@/lib/utils';

/**
 * A category's icon: the official brand mark where one exists, otherwise its emoji.
 *
 * The stored `icon` is a plain string, so it can only ever hold an emoji. That is a fair
 * approximation for "Groceries", and a poor one for "Netflix", which has an actual mark.
 * Brand names resolve to a real logo; everything else keeps the emoji it already had.
 *
 * NOTE: this cannot be used inside a `<select>`. An `<option>` renders text only, so the
 * category dropdowns keep the emoji — a limitation of the element, not of this component.
 */
export function CategoryIcon({
  name,
  icon,
  color,
  className,
  size = 18,
}: {
  name: string;
  icon?: string | null;
  color?: string | null;
  className?: string;
  size?: number;
}) {
  const brand = getBrandMark(name);

  if (brand) {
    return (
      <svg
        role="img"
        aria-label={brand.title}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        // The brand's own colour, which is the point of using its mark rather than a
        // generic glyph.
        fill={`#${brand.hex}`}
        className={cn('shrink-0', className)}
      >
        <title>{brand.title}</title>
        <path d={brand.path} />
      </svg>
    );
  }

  if (icon) {
    return (
      <span className={cn('leading-none', className)} style={{ fontSize: size }} aria-hidden>
        {icon}
      </span>
    );
  }

  return (
    <Tag
      className={cn('text-muted-foreground shrink-0', className)}
      style={{ width: size, height: size, color: color ?? undefined }}
      aria-hidden
    />
  );
}
