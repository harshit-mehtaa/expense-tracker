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
