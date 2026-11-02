let searchActive = false;

export function setSearchActive(active: boolean): void {
  searchActive = active;
}

export function isSearchActive(): boolean {
  return searchActive;
}
