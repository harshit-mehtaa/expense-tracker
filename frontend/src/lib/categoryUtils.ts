export interface CategoryLike {
  id: string;
  name: string;
  type?: string;
  icon?: string | null;
  parentId?: string | null;
  parent?: CategoryLike | null;
}

export function getCategoryPath(category: CategoryLike, categories: CategoryLike[] = []): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: CategoryLike | null | undefined = category;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parent ?? (current.parentId ? byId.get(current.parentId) : null);
  }

  return parts.join(' / ');
}

export function getCategoryLabel(category: CategoryLike, categories: CategoryLike[] = []): string {
  const icon = category.icon ? `${category.icon} ` : '';
  return `${icon}${getCategoryPath(category, categories)}`;
}

export function sortCategoriesByPath<T extends CategoryLike>(categories: T[]): T[] {
  return [...categories].sort((a, b) => {
    const typeCompare = (a.type ?? '').localeCompare(b.type ?? '');
    if (typeCompare !== 0) return typeCompare;
    return getCategoryPath(a, categories).localeCompare(getCategoryPath(b, categories));
  });
}

export function sortCategoriesByNameAsc<T extends CategoryLike>(categories: T[]): T[] {
  return [...categories].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;
    return getCategoryPath(a, categories).localeCompare(getCategoryPath(b, categories), undefined, {
      sensitivity: 'base',
    });
  });
}

export function isCategoryDescendant(
  candidate: CategoryLike,
  ancestorId: string,
  categories: CategoryLike[],
): boolean {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let current: CategoryLike | null | undefined = candidate;

  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }

  return false;
}

export interface CategoryTreeOption<T extends CategoryLike> {
  category: T;
  /** 0 for a top-level category, 1 for its children, and so on. */
  depth: number;
}

/**
 * Flattens categories into the order a tree would render them: each parent immediately
 * followed by its own children, siblings alphabetical, to any depth.
 *
 * Pickers used to sort by leaf name, so "Cab" filed under C and "Travel" under T — a
 * sub-category and its parent could sit twenty rows apart, and the only clue they were
 * related was the path in the label.
 *
 * Categories whose parent is missing from the supplied list are treated as roots. That
 * matters because every picker filters by type first: a child whose parent is a different
 * type would otherwise vanish from the list entirely.
 */
export function toCategoryTreeOptions<T extends CategoryLike>(categories: T[]): CategoryTreeOption<T>[] {
  const present = new Set(categories.map((c) => c.id));
  const childrenOf = new Map<string | null, T[]>();

  for (const c of categories) {
    const parentId = c.parentId && present.has(c.parentId) ? c.parentId : null;
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), c]);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  const out: CategoryTreeOption<T>[] = [];
  const walk = (parentId: string | null, depth: number, seen: Set<string>) => {
    for (const c of childrenOf.get(parentId) ?? []) {
      // A cycle is rejected on write, but a bad row must not spin this forever.
      if (seen.has(c.id)) continue;
      out.push({ category: c, depth });
      walk(c.id, depth + 1, new Set([...seen, c.id]));
    }
  };
  walk(null, 0, new Set());
  return out;
}

/**
 * A `<select>` option label for a tree row: indented by depth, icon, then the plain name.
 *
 * The name alone rather than the full path — the indentation and the parent directly
 * above already say where it sits, and repeating "Travel › " on every child wastes the
 * width a native select has.
 *
 * Indented with a non-breaking space because browsers collapse ordinary leading spaces
 * in an <option>.
 */
export function getCategoryTreeOptionLabel(category: CategoryLike, depth: number): string {
  const indent = '\u00A0\u00A0\u00A0\u00A0'.repeat(depth);
  const branch = depth > 0 ? '└ ' : '';
  const icon = category.icon ? `${category.icon} ` : '';
  return `${indent}${branch}${icon}${category.name}`;
}
